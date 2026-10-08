import { useEffect, useState } from 'react';
import { AtlasPanel, ViewerErrorBoundary } from 'ontouml-atlas/react';
import type { PlanningContext, ViewerPayload } from 'ontouml-atlas';
import 'ontouml-atlas/embedded.css';
import type { Snapshot, Work, Document } from './types';
import type { Route } from './routes';
import { documentRoute } from './routes';
import { samePath } from './links';

interface Entry { handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean }
export interface ModelReference { handle: string; workId: string; title: string; elementId: string; label: string; section: string | null }
async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Atlas could not load this model.');
  return result;
}
export function PlanDiagrams({ file, work, navigate }: { file: Document; work?: Work; navigate(route: Partial<Route>): void }) {
  const [links, setLinks] = useState<ModelReference[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    get<ModelReference[]>('/api/atlas/references?' + new URLSearchParams({ ...(work ? { work: work.id } : {}), path: file.path }), controller.signal).then(setLinks).catch(() => setLinks([]));
    return () => controller.abort();
  }, [work?.id, file.path, file.modified]);
  return links.length > 0 ? <nav className="plan-diagrams" aria-label="Referenced diagrams">{links.map((link, index) => <button key={index} onClick={() => navigate({ view: 'work', work: link.workId, tab: 'diagrams', diagram: link.handle, element: link.elementId })}>{link.title} · {link.label}</button>)}</nav> : null;
}
export function AtlasWorkPanel({ work, snapshot, route, navigate }: { work: Work; snapshot: Snapshot; route: Route; navigate(route: Partial<Route>): void }) {
  const [catalog, setCatalog] = useState<{ models: Entry[]; issues: string[] }>({ models: [], issues: [] });
  const [catalogError, setCatalogError] = useState('');
  const [modelError, setModelError] = useState('');
  const [payload, setPayload] = useState<ViewerPayload | null>(null);
  const [loaded, setLoaded] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [defaultHandle, setDefaultHandle] = useState('');
  const handle = route.diagram || defaultHandle || catalog.models[0]?.handle || '';
  const revision = catalog.models.find(entry => entry.handle === handle)?.revision;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await get<typeof catalog>('/api/atlas/models?' + new URLSearchParams({ work: work.id }), controller.signal); if (!controller.signal.aborted) { setCatalog(next); setDefaultHandle(previous => previous || next.models[0]?.handle || ''); setCatalogError(''); } }
      catch (error) { if (!controller.signal.aborted) setCatalogError((error as Error).message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [work.id]);
  useEffect(() => {
    if (!handle) return;
    const controller = new AbortController();
    if (loaded !== handle) { setPayload(null); setModelError(''); }
    let timer: ReturnType<typeof setTimeout>;
    let retryDelay = 2000;
    const load = async () => {
      try {
        const next = await get<ViewerPayload>('/api/atlas/model?' + new URLSearchParams({ work: work.id, handle }), controller.signal);
        if (!controller.signal.aborted) { setPayload(next); setLoaded(handle); setReferenceError(''); setModelError(''); }
      } catch (error) {
        if (!controller.signal.aborted) { setModelError((error as Error).message); timer = setTimeout(load, retryDelay); retryDelay = Math.min(30000, retryDelay * 2); }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [handle, revision, work.id]);
  const onReference = (record: PlanningContext['records'][number]) => {
    const file = snapshot.documents.find(file => typeof record.path === 'string' && samePath(file.path, record.path, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths) && (file.workId === work.id || file.category === 'knowledge'));
    if (!file) { setReferenceError('This reference is not available in the connected planning folder.'); return; }
    navigate(documentRoute(file, typeof record.section === 'string' ? record.section : null));
  };
  return <section className={'atlas-work ' + (maximized ? 'maximized' : '')} aria-label="Work diagrams">
    <div className="atlas-work-toolbar"><select aria-label="Atlas model" value={handle} onChange={event => navigate({ view: 'work', work: work.id, tab: 'diagrams', diagram: event.target.value })}>{catalog.models.map(entry => <option key={entry.handle} value={entry.handle}>{entry.title}</option>)}{handle && !catalog.models.some(entry => entry.handle === handle) && <option value={handle}>Unavailable model</option>}</select><button aria-pressed={maximized} onClick={() => setMaximized(value => !value)}>{maximized ? 'Exit full view' : 'Full view'}</button></div>
    {[catalogError, modelError, referenceError, ...catalog.issues].filter(Boolean).map((message, i) => <div className="notice warning" key={i}>{message}</div>)}
    <div className="atlas-work-canvas">{payload ? <ViewerErrorBoundary key={handle}><AtlasPanel payload={payload} theme="dark" focus={route.element ? { kind: 'node', id: route.element } : null} onReference={onReference} /></ViewerErrorBoundary> : <div className="empty"><h3>{handle ? 'Loading diagram…' : 'No models for this work item'}</h3>{!handle && <p>Create or load a model with Atlas and set its workId to {work.id}.</p>}</div>}</div>
  </section>;
}
