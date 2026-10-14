import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AtlasPanel, ViewerErrorBoundary, changeCount } from '@envsemble/atlas-diagrams/react';
import type { PlanningContext, ViewerPayload } from '@envsemble/atlas-diagrams';
import '@envsemble/atlas-diagrams/embedded.css';
import type { Catalog, CatalogEntry, Snapshot, Target, Work } from './types';
import { api } from './api';
import { documentTarget, workTarget } from './targets';
import { samePath } from './links';
import { selectModelHandle } from './modelSelection';
import { resolveRecordPath } from '@envsemble/atlas-planning/paths';
import { modelSummary, type ProvenanceKind } from '@envsemble/atlas-planning/provenance';
import { Button, EmptyState, Menu, MenuGroup, MenuRadioGroup, MenuRadioItem, Notice, Spinner, Surface, useThemePreference } from '@envsemble/envui';
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
const byTitle = (a: CatalogEntry, b: CatalogEntry) => a.title.localeCompare(b.title, undefined, { numeric: true });
/**
 * The one chooser of what the Diagrams section shows: a compact menu of the work item's models, by
 * origin and title. A proposal says how many changes it makes once it is here, so alternatives over
 * one capture read apart.
 */
function ModelPicker({ models, handle, payloads, onSelect }: { models: CatalogEntry[]; handle: string; payloads: Map<string, ViewerPayload>; onSelect(handle: string): void }) {
  const current = models.find(model => model.handle === handle);
  return <Menu aria-label="Choose a diagram" align="start" density="compact" className="model-menu"
    trigger={<Button variant="secondary" className="model-picker-button" startIcon={<DiagramIcon />} endIcon={<ExpandMore />}>
      <span className="model-picker-title">{current?.title ?? (handle ? 'Unavailable model' : 'Choose a diagram')}</span>
      {current && <ProvenanceBadge provenance={current.provenance} />}
    </Button>}>
    <MenuRadioGroup value={handle} onValueChange={onSelect}>
      {groups.map(group => {
        const items = models.filter(model => model.provenance.kind === group.kind).sort(byTitle);
        if (!items.length) return null;
        return <MenuGroup key={group.kind} label={group.title}>
          {items.map(model => <MenuRadioItem key={model.handle} value={model.handle} description={modelSummary(model, changeCount(payloads.get(model.handle))) || undefined}>{model.title}</MenuRadioItem>)}
        </MenuGroup>;
      })}
    </MenuRadioGroup>
  </Menu>;
}

/**
 * A model's payload as the host answers: with the payloads of the models laid out with it, and the
 * rest of its family, which the host serves alone.
 */
type Answer = ViewerPayload & { siblings?: { handle: string; payload: ViewerPayload }[]; apart?: { handle: string; revision: string }[] };
/** Payloads that arrived together, by handle, and the revisions they (and the family's members served apart) were read at. */
interface Loaded { payloads: Map<string, ViewerPayload>; revisions: string }
const revisionsOf = (entries: [string, string][]) => entries.map(([handle, revision]) => handle + '@' + revision).sort().join(' ');
function loadedFrom(handle: string, answer: Answer): Loaded {
  const { siblings = [], apart = [], ...payload } = answer;
  const payloads = new Map<string, ViewerPayload>([[handle, payload], ...siblings.map(item => [item.handle, item.payload] as [string, ViewerPayload])]);
  const read: [string, string][] = [...payloads].map(([key, value]) => [key, value.model.document?.revision.id ?? '']);
  return { payloads, revisions: revisionsOf([...read, ...apart.map(item => [item.handle, item.revision] as [string, string])]) };
}

/**
 * A work item's diagrams. A capture and the proposals over it arrive together, laid out once, so
 * choosing another of them shows it at once in the same panel, with nothing moving; another model
 * loads. `sections` (the work page's switcher) comes first, at the top left, as it does elsewhere.
 */
export function AtlasWorkPanel({ work, snapshot, target, sections }: { work: Work; snapshot: Snapshot; target: WorkTarget; sections?: ReactNode }) {
  const { open, retarget, revision, inspectorWidth, setInspectorWidth } = useWorkbench();
  const { theme } = useThemePreference();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [modelError, setModelError] = useState<{ handle: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [defaultHandle, setDefaultHandle] = useState('');
  const models = catalog?.models ?? [];
  const handle = selectModelHandle(models, defaultHandle, target.diagram || '', catalog?.invalidHandles ?? []);
  const entry = models.find(model => model.handle === handle);
  // The models laid out with this one, at the revisions the catalog lists now.
  const family = entry?.family ? models.filter(model => model.family === entry.family) : entry ? [entry] : [];
  const expected = revisionsOf(family.map(model => [model.handle, model.revision]));
  const invalid = catalog?.invalidHandles.includes(handle) ?? false;

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
    if (!handle) { setLoaded(null); setModelError(null); return; }
    // A model that arrived with the one shown, at the revisions listed, needs no request.
    if (loaded?.payloads.has(handle) && loaded.revisions === expected) return;
    let current = true;
    api.model(work.id, handle).then(answer => {
      if (!current) return;
      setLoaded(loadedFrom(handle, answer as Answer)); setReferenceError(''); setModelError(null);
    }).catch(error => { if (current) setModelError({ handle, message: (error as Error).message }); });
    return () => { current = false; };
    // A model whose file is invalid keeps its last valid view; a folder change retries it.
  }, [handle, expected, work.id, invalid ? revision : 0]);

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
  const picker = models.length > 0 || handle ? <ModelPicker models={models} handle={handle} payloads={loaded?.payloads ?? new Map()} onSelect={select} /> : null;
  const error = modelError?.handle === handle ? modelError.message : '';
  const notices = [catalogError, error, referenceError, ...(catalog?.issues ?? [])].filter(Boolean);
  const payload = loaded?.payloads.get(handle);
  const empty = catalog && !models.length && !handle;

  return <section className={'diagrams' + (fullscreen ? ' fullscreen' : '')} aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {payload ? <ViewerErrorBoundary key={payload.family ?? handle} resetKey={payload.model.document?.revision.id}>
        <AtlasPanel payload={payload} theme={theme} focus={target.element ? { kind: 'node', id: target.element } : null} onReference={onReference}
          leading={picker} sections={sections} fullscreen={fullscreen} onFullscreenChange={setFullscreen}
          inspectorWidth={inspectorWidth} onInspectorWidthChange={setInspectorWidth} />
      </ViewerErrorBoundary>
      : <>
        {(sections || picker) && <div className="diagrams-islands">
          {sections}
          {picker && <Surface tone="pane" corners="pill" padding={1} density="compact" className="diagrams-island">{picker}</Surface>}
        </div>}
        {!catalog ? <div className="diagrams-state"><Spinner label="Loading diagrams" /></div>
          : empty ? <div className="diagrams-state"><EmptyState icon={<DiagramIcon />} title="No diagrams yet" description="Ask your agent to model this plan with the atlas-model skill. Diagrams are saved in this work folder." /></div>
          : <div className="diagrams-state">{error ? null : <Spinner label="Loading the diagram" />}</div>}
      </>}
      {notices.length > 0 && <div className="diagrams-notices" role="status">{notices.map((message, index) => <Notice tone="warning" key={index}>{message}</Notice>)}</div>}
    </div>
  </section>;
}
