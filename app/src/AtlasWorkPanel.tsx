import { apiFetch } from './api';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AtlasPanel, ViewerErrorBoundary } from '@envsemble/atlas-diagrams/react';
import type { PlanningContext, ViewerPayload } from '@envsemble/atlas-diagrams';
import '@envsemble/atlas-diagrams/embedded.css';
import type { Snapshot, Work } from './types';
import { documentRoute, type Route } from './routes';
import { samePath } from './links';
import { pollWhileVisible } from './visiblePoll';
import { selectModelHandle } from './modelSelection';
import { resolveRecordPath } from '@envsemble/atlas-planning/paths';
import type { Provenance, ProvenanceKind } from '@envsemble/atlas-planning/provenance';
import { CheckIcon, TriangleDownIcon, WorkflowIcon } from './icons';
import { Blankslate, Dropdown, ProvenanceLabel, Spinner } from './ui';

interface Explains { path: string | null; reference: string; section: string | null; title: string | null }
export interface CatalogEntry {
  handle: string; title: string; revision: string; profile: string; state: string; capturedAt: string | null; coverage: string | null; imported: boolean;
  provenance: Provenance; explains: Explains[];
}
interface Catalog { models: CatalogEntry[]; issues: string[]; invalidHandles: string[] }

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Atlas could not load this model.');
  return result;
}

const groups: { kind: ProvenanceKind; title: string }[] = [
  { kind: 'generated', title: 'Generated from code or database' },
  { kind: 'proposal', title: 'Agent proposals' },
  { kind: 'authored', title: 'Agent-authored' },
  { kind: 'unknown', title: 'Other models' },
];
function explainsText(item: Explains) {
  return item.section ? item.reference + ' › ' + item.section : item.reference;
}
function ModelPicker({ models, handle, onSelect }: { models: CatalogEntry[]; handle: string; onSelect(handle: string): void }) {
  const current = models.find(model => model.handle === handle);
  return <Dropdown label="Choose a diagram" className="model-picker" buttonClassName="btn model-picker-button" button={<>
    <WorkflowIcon size={16} />
    <span className="model-picker-title">{current?.title ?? (handle ? 'Unavailable model' : 'Choose a diagram')}</span>
    {current && <ProvenanceLabel provenance={current.provenance} />}
    <TriangleDownIcon size={16} />
  </>}>
    {close => <div className="action-menu model-menu" role="menu">
      {groups.map(group => {
        const items = models.filter(model => model.provenance.kind === group.kind);
        if (!items.length) return null;
        return <div key={group.kind} role="group" aria-label={group.title}>
          <div className="menu-title">{group.title}</div>
          {items.map(model => <button key={model.handle} type="button" role="menuitemradio" aria-checked={model.handle === handle} className="menu-item menu-item-rich" onClick={() => { onSelect(model.handle); close(); }}>
            <span className="menu-check">{model.handle === handle && <CheckIcon size={16} />}</span>
            <span className="menu-text">
              <span className="menu-item-heading"><strong>{model.title}</strong></span>
              {model.provenance.detail && <span className="menu-description">{model.provenance.detail}</span>}
              {model.explains.filter(item => item.path).slice(0, 3).map((item, index) => <span key={index} className="menu-description">Explains {explainsText(item)}</span>)}
            </span>
          </button>)}
        </div>;
      })}
    </div>}
  </Dropdown>;
}

export function AtlasWorkPanel({ work, snapshot, route, navigate }: { work: Work; snapshot: Snapshot; route: Route; navigate(route: Partial<Route>): void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [modelError, setModelError] = useState('');
  const [payload, setPayload] = useState<ViewerPayload | null>(null);
  const [loaded, setLoaded] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [defaultHandle, setDefaultHandle] = useState('');
  const section = useRef<HTMLElement>(null);
  const models = catalog?.models ?? [];
  const handle = selectModelHandle(models, defaultHandle, route.diagram || '', catalog?.invalidHandles ?? []);
  const revision = models.find(entry => entry.handle === handle)?.revision;

  useEffect(() => {
    return pollWhileVisible(async signal => {
      try {
        const next = await get<Catalog>('/api/atlas/models?' + new URLSearchParams({ work: work.id }), signal);
        if (!signal.aborted) { setCatalog(next); setDefaultHandle(previous => selectModelHandle(next.models, previous, '', next.invalidHandles)); setCatalogError(''); }
      } catch (error) { if (!signal.aborted) { setCatalogError((error as Error).message); setCatalog(current => current ?? { models: [], issues: [], invalidHandles: [] }); } }
      return 2000;
    });
  }, [work.id]);
  useEffect(() => {
    if (!handle) { setPayload(null); setLoaded(''); setModelError(''); return; }
    if (loaded !== handle) { setPayload(null); setModelError(''); }
    let retryDelay = 2000;
    return pollWhileVisible(async signal => {
      try {
        const next = await get<ViewerPayload>('/api/atlas/model?' + new URLSearchParams({ work: work.id, handle }), signal);
        if (!signal.aborted) { setPayload(next); setLoaded(handle); setReferenceError(''); setModelError(''); }
        return null;
      } catch (error) {
        if (!signal.aborted) setModelError((error as Error).message);
        const delay = retryDelay; retryDelay = Math.min(30000, retryDelay * 2);
        return delay;
      }
    });
  }, [handle, revision, work.id]);

  // Fill the viewport below the work header and tabs.
  useLayoutEffect(() => {
    const element = section.current;
    if (!element) return;
    const measure = () => { if (!element.classList.contains('fullscreen')) element.style.setProperty('--diagram-top', Math.max(0, element.getBoundingClientRect().top + window.scrollY) + 'px'); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false); };
    window.addEventListener('keydown', key);
    document.body.classList.add('has-fullscreen');
    return () => { window.removeEventListener('keydown', key); document.body.classList.remove('has-fullscreen'); };
  }, [fullscreen]);

  const onReference = useCallback((record: PlanningContext['records'][number]) => {
    const same = (a: string, b: string) => samePath(a, b, snapshot.caseSensitivePaths, snapshot.normalizationInsensitivePaths);
    const file = resolveRecordPath(record.path, work.path, snapshot.documents.filter(item => item.workId === work.id || item.category === 'knowledge'), same);
    if (!file) { setReferenceError('This passage is not in the open planning folder.'); return; }
    setFullscreen(false);
    navigate(documentRoute(file, typeof record.section === 'string' ? record.section : null));
  }, [snapshot, work.id, work.path, navigate]);

  const select = (next: string) => navigate({ view: 'work', work: work.id, tab: 'diagrams', diagram: next });
  const picker = models.length > 0 || handle ? <ModelPicker models={models} handle={handle} onSelect={select} /> : null;
  const notices = [catalogError, modelError, referenceError, ...(catalog?.issues ?? [])].filter(Boolean);
  const ready = payload && loaded === handle;
  const empty = catalog && !models.length && !handle;

  return <section ref={section} className={'diagrams' + (fullscreen ? ' fullscreen' : '')} aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {ready ? <ViewerErrorBoundary key={handle} resetKey={payload.model.document?.revision.id}>
        <AtlasPanel payload={payload} theme="dark" focus={route.element ? { kind: 'node', id: route.element } : null} onReference={onReference}
          leading={picker} fullscreen={fullscreen} onFullscreenChange={setFullscreen} />
      </ViewerErrorBoundary>
      : <>
        {picker && <div className="diagrams-island">{picker}</div>}
        {!catalog ? <div className="diagrams-state"><Spinner /> Loading diagrams…</div>
          : empty ? <div className="diagrams-state"><Blankslate icon={<WorkflowIcon size={24} />} title="No diagrams yet">Ask your agent to model this plan with the atlas-model skill. Diagrams are saved in this work folder.</Blankslate></div>
          : <div className="diagrams-state">{modelError ? null : <><Spinner /> Loading diagram…</>}</div>}
      </>}
      {notices.length > 0 && <div className="diagrams-notices" role="status">{notices.map((message, index) => <div className="flash flash-warning" key={index}>{message}</div>)}</div>}
    </div>
  </section>;
}
