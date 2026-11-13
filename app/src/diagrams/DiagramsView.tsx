import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiagramPanel, ViewerErrorBoundary } from '@envsemble/atlas-diagrams/react';
import type { ViewerPayload } from '@envsemble/atlas-diagrams';
import '@envsemble/atlas-diagrams/embedded.css';
import type { DiagramEntry, Target, Work } from '../types';
import { api } from '../api';
import { diagramTarget } from '../navigation/targets';
import { selectDiagram } from './diagramSelection';
import { familyLayers, stepLayer } from './layers';
import { DiagramName, LayerMarker } from './LayerMarker';
import { elementId } from '@envsemble/atlas/planning/provenance';
import { Alert, Spinner, Surface, useThemePreference } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { DiagramIcon } from '../ui/icons';
import { useWindow } from '../window/windowContext';

type DiagramTarget = Extract<Target, { kind: 'diagram' }>;

/** A diagram's payload as the host answers: with the payloads of the rest of its family, laid out together. */
type Answer = ViewerPayload & { siblings?: { path: string; payload: ViewerPayload }[] };
/** Payloads that arrived together, by path, and the revisions of the files they were drawn from. */
interface Loaded { payloads: Map<string, ViewerPayload>; revisions: string }
function loadedFrom(path: string, answer: Answer, revisions: string): Loaded {
  const { siblings = [], ...payload } = answer;
  return { payloads: new Map<string, ViewerPayload>([[path, payload], ...siblings.map(item => [item.path, item.payload] as [string, ViewerPayload])]), revisions };
}

const noDiagrams: DiagramEntry[] = [];

/** What is wrong with a diagram that cannot be drawn, line by line. */
function Problems({ diagram }: { diagram: DiagramEntry }) {
  return <EmptyState icon={<DiagramIcon />} title="This diagram has problems" description={<>
    <span>{diagram.path} cannot be drawn until they are fixed. <code>atlas check</code> reports them too.</span>
    <ul className="diagram-problems">{diagram.problems.slice(0, 8).map((problem, index) => <li key={index}>Line {problem.line}, column {problem.column}: {problem.message}</li>)}</ul>
  </>} />;
}

/** Whether a key press belongs to a field, where `[` and `]` are typed. */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * A work item's diagram, one of its `.puml` files, filling the window below its top rows. A capture,
 * the later captures compared with it and the proposals over it are one diagram with layers: they
 * arrive together, laid out once, so another layer shows at once in the same panel with nothing
 * moving. The layer marker and `[` and `]` switch layers; each switch is a step Back returns from.
 * Another diagram opens from the Files tree, a plan's link or Search. Its elements can be dragged:
 * the arrangement, one for all the layers, is kept beside the family's first file.
 */
export function DiagramsView({ work, target }: { work: Work; target: DiagramTarget }) {
  const { projectId, retarget, files, notify } = useWindow();
  const { theme } = useThemePreference();
  const [diagrams, setDiagrams] = useState<DiagramEntry[] | null>(null);
  const [listError, setListError] = useState('');
  const [diagramError, setDiagramError] = useState<{ path: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [shown, setShown] = useState('');
  const listed = diagrams ?? noDiagrams;
  const selected = selectDiagram(listed, shown, target.path || '');
  const entry = listed.find(diagram => diagram.path === selected);
  // The files drawn with this one, at the revisions listed now: its family, and the scenarios a class diagram shows.
  const family = entry?.family ? listed.filter(diagram => diagram.family === entry.family) : entry ? [entry] : [];
  const drawn = [...family, ...listed.filter(diagram => family.some(member => member.path === diagram.scenarioOf))];
  const expected = drawn.map(diagram => diagram.path + '@' + diagram.revision).sort().join(' ');

  // The list is read again whenever the folder's files change, and kept when it reads the same.
  useEffect(() => {
    let current = true;
    api.diagrams(projectId, work.id).then(next => {
      if (!current) return;
      setDiagrams(previous => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next); setShown(previous => selectDiagram(next, previous)); setListError('');
    }).catch(error => {
      if (!current) return;
      setListError((error as Error).message); setDiagrams(previous => previous ?? []);
    });
    return () => { current = false; };
  }, [projectId, work.id, files]);
  useEffect(() => {
    // A diagram with problems is not drawn; its problems are shown instead.
    if (!selected || !diagrams || entry?.valid === false) { if (!selected) setLoaded(null); setDiagramError(null); return; }
    // A diagram that arrived with the one shown, at the revisions listed, needs no request.
    if (loaded?.payloads.has(selected) && loaded.revisions === expected) return;
    let current = true;
    api.diagram(projectId, work.id, selected).then(answer => {
      if (!current) return;
      setLoaded(loadedFrom(selected, answer as Answer, expected)); setDiagramError(null);
    }).catch(error => { if (current) setDiagramError({ path: selected, message: (error as Error).message }); });
    return () => { current = false; };
  }, [projectId, selected, expected, work.id, diagrams, entry?.valid]);

  // The arrangement the layers share, read again as the folder's files change. A scenario is not arranged.
  const arranging = entry?.valid && entry.role !== 'scenario' ? entry.family ?? entry.path : '';
  const [arrangement, setArrangement] = useState<{ root: string; positions: Record<string, [number, number]> | null } | null>(null);
  // Saves under way, and how many were made: a read begun before the last save ended may predate it.
  const writes = useRef({ pending: 0, made: 0 });
  useEffect(() => {
    if (!arranging) return;
    let current = true;
    const made = writes.current.made;
    api.arrangement(projectId, work.id, arranging).then(positions => {
      if (!current || writes.current.pending || writes.current.made !== made) return;
      setArrangement(previous => previous?.root === arranging && JSON.stringify(previous.positions) === JSON.stringify(positions) ? previous : { root: arranging, positions });
    }).catch(() => { if (current && !writes.current.made) setArrangement({ root: arranging, positions: null }); });
    return () => { current = false; };
  }, [projectId, work.id, arranging, files]);
  // The elements the family's layers draw: an element removed from them leaves the arrangement when it is next saved.
  const elements = useMemo(() => new Set([...(loaded?.payloads.values() ?? [])].flatMap(item => [
    ...item.model.classes, ...((item.comparison?.changeView?.model.classes as { id: string }[] | undefined) ?? []),
  ].map(element => element.id))), [loaded]);
  const arrange = useCallback((positions: Record<string, [number, number]> | null) => {
    if (!arranging) return;
    const kept = positions && Object.fromEntries(Object.entries(positions).filter(([id]) => elements.has(id)));
    writes.current.pending++; writes.current.made++;
    setArrangement({ root: arranging, positions: kept });
    api.arrange(projectId, work.id, arranging, kept)
      .catch(error => notify('The arrangement could not be saved: ' + (error as Error).message, 'warning'))
      .finally(() => { writes.current.pending--; });
  }, [projectId, work.id, arranging, notify, elements]);

  const layers = useMemo(() => familyLayers(listed, selected), [listed, selected]);
  const select = useCallback((next: string) => retarget(diagramTarget(work.id, next)), [retarget, work.id]);
  // `[` and `]` step to the previous and next layer, as the marker's tooltip says.
  useEffect(() => {
    if (!layers.length) return;
    const key = (event: KeyboardEvent) => {
      // AltGr, which some layouts need for [ and ], reports Ctrl and Alt together on Windows.
      const altGraph = event.ctrlKey && event.altKey;
      if ((event.key !== '[' && event.key !== ']') || (!altGraph && (event.ctrlKey || event.altKey)) || event.metaKey || event.defaultPrevented || typing(event.target)) return;
      const next = stepLayer(layers, selected, event.key === ']' ? 1 : -1);
      if (!next || next === selected) return;
      event.preventDefault();
      select(next);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [layers, selected, select]);

  // The diagram's name, or its layers (naming the one shown), at its top left. The viewer draws again
  // only when what it is given changes: the marker and the element in focus
  // stay the same objects while nothing of theirs does.
  const marker = useMemo(() => layers.length ? <LayerMarker layers={layers} value={selected} onChange={select} />
    : entry ? <DiagramName diagram={entry} /> : null, [layers, selected, select, entry]);
  const error = diagramError?.path === selected ? diagramError.message : '';
  const notices = [listError, error].filter(Boolean);
  const payload = entry?.valid === false ? undefined : loaded?.payloads.get(selected);
  const focus = useMemo(() => payload && target.element ? { kind: 'node' as const, id: elementId(payload.model, target.element) } : null, [payload, target.element]);
  // Drawn once the arrangement is read, so the automatic layout does not show first.
  const positions = !arranging ? null : arrangement?.root === arranging ? arrangement.positions : undefined;
  const empty = diagrams && !listed.length && !selected;

  return <section className="diagrams" aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {payload && positions !== undefined ? <ViewerErrorBoundary key={payload.family ?? selected} resetKey={payload.model.document?.revision.id}>
        <DiagramPanel payload={payload} theme={theme} focus={focus} leading={marker} arrangement={positions} onArrange={arranging ? arrange : undefined} />
      </ViewerErrorBoundary>
      : <>
        {marker && <div className="diagrams-islands">
          <Surface background="default" radius="full" padding={1} className="diagrams-island">{marker}</Surface>
        </div>}
        {!diagrams ? <div className="diagrams-state"><Spinner label="Loading diagrams" /></div>
          : empty ? <div className="diagrams-state"><EmptyState icon={<DiagramIcon />} title="No diagrams yet" description="Diagrams appear here when your agent writes PlantUML (.puml) files into this work folder; the atlas skill tells it how." /></div>
          : entry && !entry.valid ? <div className="diagrams-state"><Problems diagram={entry} /></div>
          : <div className="diagrams-state">{error ? null : <Spinner label="Loading the diagram" />}</div>}
      </>}
      {notices.length > 0 && <div className="diagrams-notices" role="status">{notices.map((message, index) => <Alert tone="warning" key={index}>{message}</Alert>)}</div>}
    </div>
  </section>;
}
