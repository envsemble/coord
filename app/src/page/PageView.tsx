// A work item's page, in place: the page's build running in a frame of its own (atlas://page), which
// fills the window beside Files as a diagram does. The window builds the page through the page's
// host, hands the build to the frame, and answers the frame's requests (its files, the Atlas tools,
// the work item's diagrams). As the agent changes the page, it is built again and shown again, like
// a dev server's page; a change to a file the page only reads tells the page, which reads it again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Spinner, Text, useThemePreference } from '@envsemble/envui';
import type { PageBuild, PageProblem, Work } from '../types';
import { api } from '../api';
import { diagramTarget, documentTarget, pageAt, pageTarget, workTarget } from '../navigation/targets';
import { workRelative } from '@envsemble/atlas/platform/paths';
import { Trail } from '../ui/Trail';
import { workNumber } from '../ui/format';
import { useWindow } from '../window/windowContext';
import type { FrameInit, FromFrame, PageInfo, Request, ToFrame } from './pageMessages';

/** Where the frame's document is: atlas://page in the app, the dev server's in development. */
function frameUrl() {
  return location.protocol === 'atlas:' ? 'atlas://page/page-frame.html' : location.origin + '/page-frame.html';
}
/** Each file of the planning folder as last read: its time and size, to tell which changed. */
function fileStamps(documents: { path: string; modified: string | null; size: number }[]) {
  return new Map(documents.map(document => [document.path, document.modified + ':' + document.size]));
}

export function PageView({ work, folder, name }: { work: Work; folder: string; name: string }) {
  const { projectId, projectName, snapshot, files, open } = useWindow();
  const { theme } = useThemePreference();
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const [build, setBuild] = useState<PageBuild | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const builds = useRef(0);
  const latest = useRef<{ build: PageBuild | null; stamps: Map<string, string> }>({ build: null, stamps: new Map() });
  const info = useMemo<PageInfo>(() => ({ name, folder, work: { id: work.id, title: work.title, path: work.path }, project: { id: projectId, name: projectName } }), [name, folder, work.id, work.title, work.path, projectId, projectName]);

  const send = useCallback((message: ToFrame) => port.current?.postMessage(message), []);
  const showBuild = useCallback((result: PageBuild) => {
    latest.current.build = result;
    setBuild(result);
    if (result.ok) send({ type: 'build', code: result.code, css: result.css, imports: result.imports, build: ++builds.current });
  }, [send]);
  const rebuild = useCallback(() => {
    api.page(projectId, folder).then(showBuild, (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  }, [projectId, folder, showBuild]);

  // What the frame asks of Atlas.
  const answer = useCallback(async (request: Request): Promise<unknown> => {
    switch (request.method) {
      case 'read': return (await api.document(projectId, request.params.path)).body;
      case 'write': return api.writeFile(projectId, request.params.path, request.params.content);
      case 'tool': {
        const outcome = await api.tool(projectId, request.params.name, request.params.input);
        if (!outcome.ok) throw new Error(outcome.error);
        return outcome.value;
      }
      case 'diagram': {
        const path = request.params.path;
        if (!path.startsWith(work.path + '/')) throw new Error('A page shows the diagrams of its own work item.');
        return api.diagram(projectId, work.id, workRelative(path, work.path));
      }
      case 'open': {
        const path = request.params.path;
        const page = pageAt(path, snapshot.work);
        const document = snapshot.documents.find(item => item.path === path);
        const owner = document && snapshot.work.find(item => item.id === document.workId);
        if (page) open(pageTarget(page.folder));
        else if (document) open(documentTarget(document, owner));
        else if (path.endsWith('.puml') && path.startsWith(work.path + '/')) open(diagramTarget(work.id, workRelative(path, work.path)));
        else throw new Error(`${path} is not in the planning folder.`);
        return null;
      }
    }
  }, [projectId, work.id, work.path, snapshot, open]);

  // The frame is started when its document loads: again if it reloads.
  const started = useCallback(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    port.current?.close();
    const channel = new MessageChannel();
    port.current = channel.port1;
    channel.port1.onmessage = (event: MessageEvent<FromFrame>) => {
      const message = event.data;
      // A page that fails shows why in its frame.
      if (message.type !== 'request') return;
      answer(message).then(value => send({ type: 'answer', id: message.id, ok: true, value }),
        (error: unknown) => send({ type: 'answer', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
    };
    const init: FrameInit = { type: 'atlas-page:init', page: info, theme };
    target.postMessage(init, '*', [channel.port2]);
    if (latest.current.build?.ok) showBuild(latest.current.build); else rebuild();
  }, [answer, info, theme, send, showBuild, rebuild]);

  useEffect(() => () => { port.current?.close(); }, []);
  useEffect(() => { send({ type: 'theme', theme }); }, [theme, send]);
  // A page another than before starts afresh.
  useEffect(() => { latest.current = { build: null, stamps: fileStamps(snapshot.documents) }; setBuild(null); setFailure(null); if (port.current) rebuild(); }, [folder]);
  // Live: the files it is built from changed, it is built again; the page hears of every change.
  useEffect(() => {
    const stamps = fileStamps(snapshot.documents);
    const before = latest.current.stamps;
    latest.current.stamps = stamps;
    const changed = [...new Set([...stamps.keys(), ...before.keys()])].filter(path => stamps.get(path) !== before.get(path));
    if (!changed.length) return;
    const inputs = latest.current.build?.ok ? new Set(latest.current.build.inputs) : null;
    const source = /\.(?:tsx?|jsx?|css)$/i;
    if (!inputs || changed.some(path => inputs.has(path) || (path.startsWith(folder + '/') && source.test(path)))) rebuild();
    send({ type: 'changed', paths: changed });
  }, [files]);

  const trail = <Trail work={work.id} items={[{ label: workNumber(work.id), target: workTarget(work.id) }, { label: name }]} />;
  const problems = build && !build.ok ? build.problems : null;
  return <section className="page-view" aria-label={name}>
    <Text render={<h1 />} className="visually-hidden">{name}</Text>
    <div className="page-view-trail">{trail}</div>
    <div className="page-view-body">
      <iframe ref={frame} className="page-frame" title={name} src={frameUrl()} onLoad={started} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups"
        hidden={Boolean(problems)} />
      {!build && !failure && <div className="page-view-state"><Spinner label="Building the page" /></div>}
      {failure && <div className="page-view-state"><Alert tone="danger" title="This page can’t be built">{failure}</Alert></div>}
      {problems && <div className="page-view-state"><Problems problems={problems} /></div>}
    </div>
  </section>;
}

/** Why a page does not build, file by file, as `atlas check` says it. */
function Problems({ problems }: { problems: PageProblem[] }) {
  return <Alert tone="danger" title="This page doesn’t build">
    <ul className="page-problems">{problems.map((problem, index) => <li key={index}>
      {problem.file && <code>{problem.file}{problem.line ? ':' + problem.line : ''}</code>} {problem.text}
    </li>)}</ul>
  </Alert>;
}
