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
import { modelSummary, type ProvenanceKind } from '@envsemble/atlas-planning/provenance';
import { Button, EmptyState, Menu, MenuGroup, MenuRadioGroup, MenuRadioItem, Notice, Spinner, useThemePreference } from '@envsemble/envui';
import { ExpandMore } from '@envsemble/envui/icons/ExpandMore';
import { DiagramIcon } from './icons';
import { ProvenanceBadge } from './ui';
import { useWorkbench } from './workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;

const groups: { kind: ProvenanceKind; title: string }[] = [
  { kind: 'generated', title: 'From code and databases' },
  { kind: 'proposal', title: 'Proposals' },
  { kind: 'authored', title: 'Authored' },
  { kind: 'unknown', title: 'Other' },
];
/** The one chooser of what the Diagrams tab shows: a compact menu of the work item's models, by origin. */
function ModelPicker({ models, handle, onSelect }: { models: CatalogEntry[]; handle: string; onSelect(handle: string): void }) {
  const current = models.find(model => model.handle === handle);
  return <Menu aria-label="Choose a diagram" align="start" density="compact" className="model-menu"
    trigger={<Button variant="secondary" className="model-picker-button" startIcon={<DiagramIcon />} endIcon={<ExpandMore />}>
      <span className="model-picker-title">{current?.title ?? (handle ? 'Unavailable model' : 'Choose a diagram')}</span>
      {current && <ProvenanceBadge provenance={current.provenance} />}
    </Button>}>
    <MenuRadioGroup value={handle} onValueChange={onSelect}>
      {groups.map(group => {
        const items = models.filter(model => model.provenance.kind === group.kind);
        if (!items.length) return null;
        return <MenuGroup key={group.kind} label={group.title}>
          {items.map(model => <MenuRadioItem key={model.handle} value={model.handle} description={modelSummary(model) || undefined}>{model.title}</MenuRadioItem>)}
        </MenuGroup>;
      })}
    </MenuRadioGroup>
  </Menu>;
}

export function AtlasWorkPanel({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { open, retarget, revision } = useWorkbench();
  const { theme } = useThemePreference();
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
        <AtlasPanel payload={payload} theme={theme} focus={target.element ? { kind: 'node', id: target.element } : null} onReference={onReference}
          leading={picker} fullscreen={fullscreen} onFullscreenChange={setFullscreen} />
      </ViewerErrorBoundary>
      : <>
        {picker && <div className="diagrams-island">{picker}</div>}
        {!catalog ? <div className="diagrams-state"><Spinner label="Loading diagrams" /></div>
          : empty ? <div className="diagrams-state"><EmptyState icon={<DiagramIcon />} title="No diagrams yet" description="Ask your agent to model this plan with the atlas-model skill. Diagrams are saved in this work folder." /></div>
          : <div className="diagrams-state">{modelError ? null : <Spinner label="Loading the diagram" />}</div>}
      </>}
      {notices.length > 0 && <div className="diagrams-notices" role="status">{notices.map((message, index) => <Notice tone="warning" key={index}>{message}</Notice>)}</div>}
    </div>
  </section>;
}
