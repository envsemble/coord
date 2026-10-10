import { useCallback, useEffect, useState } from 'react';
import { AtlasPanel, ViewerErrorBoundary } from '@envsemble/atlas-diagrams/react';
import type { PlanningContext, ViewerPayload } from '@envsemble/atlas-diagrams';
import '@envsemble/atlas-diagrams/embedded.css';
import type { Catalog, CatalogEntry, Snapshot, Target, Work } from './types';
import { api } from './api';
import { documentTarget, workTarget } from './targets';
import { samePath } from './links';
import { selectModelHandle } from './modelSelection';
import { resolveRecordPath } from '@envsemble/atlas-planning/paths';
import type { ProvenanceKind } from '@envsemble/atlas-planning/provenance';
import { CheckIcon, TriangleDownIcon, WorkflowIcon } from './icons';
import { Blankslate, ProvenanceLabel, Spinner } from './ui';
import { Popover } from './components/Popover';
import { useWorkbench } from './workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;
type Explains = CatalogEntry['explains'][number];

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
  return <Popover label="Choose a diagram" className="model-picker" buttonClassName="btn model-picker-button" button={<>
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
  </Popover>;
}

export function AtlasWorkPanel({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { open, retarget, revision } = useWorkbench();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [modelError, setModelError] = useState('');
  const [payload, setPayload] = useState<ViewerPayload | null>(null);
  const [loaded, setLoaded] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [defaultHandle, setDefaultHandle] = useState('');
  const models = catalog?.models ?? [];
  const handle = selectModelHandle(models, defaultHandle, target.diagram || '', catalog?.invalidHandles ?? []);
  const modelRevision = models.find(entry => entry.handle === handle)?.revision;

  // The catalog is read again whenever the folder changes on disk.
  useEffect(() => {
    let current = true;
    api.models(work.id).then(next => {
      if (!current) return;
      setCatalog(next); setDefaultHandle(previous => selectModelHandle(next.models, previous, '', next.invalidHandles)); setCatalogError('');
    }).catch(error => {
      if (!current) return;
      setCatalogError((error as Error).message); setCatalog(previous => previous ?? { models: [], issues: [], invalidHandles: [] });
    });
    return () => { current = false; };
  }, [work.id, revision]);
  useEffect(() => {
    if (!handle) { setPayload(null); setLoaded(''); setModelError(''); return; }
    if (loaded !== handle) { setPayload(null); setModelError(''); }
    let current = true;
    api.model(work.id, handle).then(next => {
      if (!current) return;
      setPayload(next as ViewerPayload); setLoaded(handle); setReferenceError(''); setModelError('');
    }).catch(error => { if (current) setModelError((error as Error).message); });
    return () => { current = false; };
    // A model whose file is invalid keeps its last valid view; a folder change retries it.
  }, [handle, modelRevision, work.id, catalog?.invalidHandles.includes(handle) ? revision : 0]);

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
    const owner = snapshot.work.find(item => item.id === file.workId);
    open(documentTarget(file, owner, typeof record.section === 'string' ? record.section : null), { pin: true });
  }, [snapshot, work.id, work.path, open]);

  const select = (next: string) => retarget(workTarget(work.id, 'diagrams', { diagram: next }));
  const picker = models.length > 0 || handle ? <ModelPicker models={models} handle={handle} onSelect={select} /> : null;
  const notices = [catalogError, modelError, referenceError, ...(catalog?.issues ?? [])].filter(Boolean);
  const ready = payload && loaded === handle;
  const empty = catalog && !models.length && !handle;

  return <section className={'diagrams' + (fullscreen ? ' fullscreen' : '')} aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {ready ? <ViewerErrorBoundary key={handle} resetKey={payload.model.document?.revision.id}>
        <AtlasPanel payload={payload} theme="dark" focus={target.element ? { kind: 'node', id: target.element } : null} onReference={onReference}
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
