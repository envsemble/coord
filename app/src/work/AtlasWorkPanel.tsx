import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtlasPanel, ViewerErrorBoundary, changeCount } from '@envsemble/atlas-diagrams/react';
import type { ViewerPayload } from '@envsemble/atlas-diagrams';
import '@envsemble/atlas-diagrams/embedded.css';
import type { DiagramEntry, Target, Work } from '../types';
import { api } from '../api';
import { diagramTarget } from '../navigation/targets';
import { selectDiagram } from '../workbench/diagramSelection';
import { elementId, modelSummary } from '@envsemble/atlas/planning/provenance';
import { Button, EmptyState, Menu, MenuGroup, MenuRadioGroup, MenuRadioItem, Notice, Spinner, Surface, useThemePreference } from '@envsemble/envui';
import { ExpandMore } from '@envsemble/envui/icons/ExpandMore';
import { DiagramIcon } from '../ui/icons';
import { ProvenanceBadge } from '../ui/ui';
import { useWorkbench } from '../workbench/workbenchContext';

type DiagramTarget = Extract<Target, { kind: 'diagram' }>;

const byTitle = (a: DiagramEntry, b: DiagramEntry) => a.title.localeCompare(b.title, undefined, { numeric: true });
const problemCount = (diagram: DiagramEntry) => diagram.problems.filter(problem => problem.severity === 'error').length;
/**
 * The picker's groups: each family (a capture, the later captures compared with it and the
 * proposals over them) under its first capture's title; the other diagrams, each class diagram with
 * the scenarios that exemplify it after it; and the diagrams that have problems.
 */
function pickerGroups(diagrams: DiagramEntry[]): { key: string; title: string; items: DiagramEntry[] }[] {
  const valid = diagrams.filter(diagram => diagram.valid);
  const groups: { key: string; title: string; items: DiagramEntry[] }[] = [];
  const roots = [...new Set(valid.flatMap(diagram => diagram.family ? [diagram.family] : []))];
  for (const root of roots) {
    const members = valid.filter(diagram => diagram.family === root);
    const order = (diagram: DiagramEntry) => diagram.path === root ? 0 : diagram.role === 'capture' ? 1 : 2;
    members.sort((a, b) => order(a) - order(b) || (a.capturedAt ?? '').localeCompare(b.capturedAt ?? '') || byTitle(a, b));
    groups.push({ key: 'family:' + root, title: members[0].title, items: members });
  }
  const alone = valid.filter(diagram => !diagram.family);
  const scenarios = alone.filter(diagram => diagram.role === 'scenario' && alone.some(other => other.path === diagram.scenarioOf));
  const others = alone.filter(diagram => !scenarios.includes(diagram)).sort(byTitle)
    .flatMap(diagram => [diagram, ...scenarios.filter(scenario => scenario.scenarioOf === diagram.path).sort(byTitle)]);
  if (others.length) groups.push({ key: 'diagrams', title: 'Diagrams', items: others });
  const invalid = diagrams.filter(diagram => !diagram.valid).sort(byTitle);
  if (invalid.length) groups.push({ key: 'problems', title: 'With problems', items: invalid });
  return groups;
}
function describe(diagram: DiagramEntry, diagrams: DiagramEntry[], payload: ViewerPayload | undefined) {
  if (!diagram.valid) { const count = problemCount(diagram); return count === 1 ? '1 problem' : count + ' problems'; }
  if (diagram.role === 'scenario') return 'Scenario of ' + (diagrams.find(other => other.path === diagram.scenarioOf)?.title ?? diagram.scenarioOf);
  return modelSummary(diagram, changeCount(payload));
}
/**
 * The one chooser of what the Diagrams section shows: a compact menu of the work item's diagrams, by
 * family. A proposal says how many changes it makes once it is here, so alternatives read apart. Its
 * owner keeps whether it is open: the picker moves into the drawn diagram's toolbar when the diagram
 * arrives, and a menu opened while it loaded stays open there.
 */
function DiagramPicker({ diagrams, selected, payloads, open, onOpenChange, onSelect }: {
  diagrams: DiagramEntry[]; selected: string; payloads: Map<string, ViewerPayload>; open: boolean; onOpenChange(open: boolean): void; onSelect(path: string): void;
}) {
  const current = diagrams.find(diagram => diagram.path === selected);
  return <Menu aria-label="Choose a diagram" align="start" density="compact" className="model-menu" open={open} onOpenChange={onOpenChange}
    trigger={<Button variant="secondary" className="model-picker-button" startIcon={<DiagramIcon />} endIcon={<ExpandMore />}>
      <span className="model-picker-title">{current?.title ?? (selected ? 'Unavailable diagram' : 'Choose a diagram')}</span>
      {current && <ProvenanceBadge provenance={current.provenance} />}
    </Button>}>
    <MenuRadioGroup value={selected} onValueChange={onSelect}>
      {pickerGroups(diagrams).map(group => <MenuGroup key={group.key} label={group.title}>
        {group.items.map(diagram => <MenuRadioItem key={diagram.path} value={diagram.path} description={describe(diagram, diagrams, payloads.get(diagram.path)) || undefined}>{diagram.title}</MenuRadioItem>)}
      </MenuGroup>)}
    </MenuRadioGroup>
  </Menu>;
}

/** A diagram's payload as the host answers: with the payloads of the rest of its family, laid out together. */
type Answer = ViewerPayload & { siblings?: { path: string; payload: ViewerPayload }[] };
/** Payloads that arrived together, by path, and the revisions of the files they were drawn from. */
interface Loaded { payloads: Map<string, ViewerPayload>; revisions: string }
function loadedFrom(path: string, answer: Answer, revisions: string): Loaded {
  const { siblings = [], ...payload } = answer;
  return { payloads: new Map<string, ViewerPayload>([[path, payload], ...siblings.map(item => [item.path, item.payload] as [string, ViewerPayload])]), revisions };
}

const noPayloads = new Map<string, ViewerPayload>();
const noDiagrams: DiagramEntry[] = [];

/** What is wrong with a diagram that cannot be drawn, line by line. */
function Problems({ diagram }: { diagram: DiagramEntry }) {
  return <EmptyState icon={<DiagramIcon />} title="This diagram has problems" description={<>
    <span>{diagram.path} cannot be drawn until they are fixed. <code>atlas check</code> reports them too.</span>
    <ul className="diagram-problems">{diagram.problems.slice(0, 8).map((problem, index) => <li key={index}>Line {problem.line}, column {problem.column}: {problem.message}</li>)}</ul>
  </>} />;
}

/**
 * A work item's diagram, one of its `.puml` files, in a tab of its own. A capture and the proposals
 * over it arrive together, laid out once, so choosing another of them shows it at once in the same
 * panel, with nothing moving; another diagram loads. Its controls start at the top left; the way
 * back to the plan is the tab's history or the plan's own tab.
 */
export function AtlasWorkPanel({ work, target }: { work: Work; target: DiagramTarget }) {
  const { project, retarget, files, inspectorWidth, setInspectorWidth } = useWorkbench();
  const { theme } = useThemePreference();
  const [diagrams, setDiagrams] = useState<DiagramEntry[] | null>(null);
  const [listError, setListError] = useState('');
  const [diagramError, setDiagramError] = useState<{ path: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [shown, setShown] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
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
    api.diagrams(project, work.id).then(next => {
      if (!current) return;
      setDiagrams(previous => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next); setShown(previous => selectDiagram(next, previous)); setListError('');
    }).catch(error => {
      if (!current) return;
      setListError((error as Error).message); setDiagrams(previous => previous ?? []);
    });
    return () => { current = false; };
  }, [project, work.id, files]);
  useEffect(() => {
    // A diagram with problems is not drawn; its problems are shown instead.
    if (!selected || !diagrams || entry?.valid === false) { if (!selected) setLoaded(null); setDiagramError(null); return; }
    // A diagram that arrived with the one shown, at the revisions listed, needs no request.
    if (loaded?.payloads.has(selected) && loaded.revisions === expected) return;
    let current = true;
    api.diagram(project, work.id, selected).then(answer => {
      if (!current) return;
      setLoaded(loadedFrom(selected, answer as Answer, expected)); setDiagramError(null);
    }).catch(error => { if (current) setDiagramError({ path: selected, message: (error as Error).message }); });
    return () => { current = false; };
  }, [project, selected, expected, work.id, diagrams, entry?.valid]);

  useEffect(() => {
    if (!fullscreen) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false); };
    window.addEventListener('keydown', key);
    document.body.classList.add('has-fullscreen');
    return () => { window.removeEventListener('keydown', key); document.body.classList.remove('has-fullscreen'); };
  }, [fullscreen]);

  // The viewer draws again only when what it is given changes: the picker and the element in focus
  // stay the same objects while nothing of theirs does.
  const select = useCallback((next: string) => retarget(diagramTarget(work.id, next)), [retarget, work.id]);
  const payloads = loaded?.payloads ?? noPayloads;
  const picker = useMemo(() => listed.length > 0 || selected ? <DiagramPicker diagrams={listed} selected={selected} payloads={payloads} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={select} /> : null,
    [listed, selected, payloads, pickerOpen, select]);
  const error = diagramError?.path === selected ? diagramError.message : '';
  const notices = [listError, error].filter(Boolean);
  const payload = entry?.valid === false ? undefined : loaded?.payloads.get(selected);
  const focus = useMemo(() => payload && target.element ? { kind: 'node' as const, id: elementId(payload.model, target.element) } : null, [payload, target.element]);
  const empty = diagrams && !listed.length && !selected;

  return <section className={'diagrams' + (fullscreen ? ' fullscreen' : '')} aria-label="Work diagrams">
    <div className="diagrams-canvas">
      {payload ? <ViewerErrorBoundary key={payload.family ?? selected} resetKey={payload.model.document?.revision.id}>
        <AtlasPanel payload={payload} theme={theme} focus={focus}
          leading={picker} fullscreen={fullscreen} onFullscreenChange={setFullscreen}
          inspectorWidth={inspectorWidth} onInspectorWidthChange={setInspectorWidth} />
      </ViewerErrorBoundary>
      : <>
        <div className="diagrams-islands">
          {picker && <Surface tone="pane" corners="pill" padding={1} density="compact" className="diagrams-island">{picker}</Surface>}
        </div>
        {!diagrams ? <div className="diagrams-state"><Spinner label="Loading diagrams" /></div>
          : empty ? <div className="diagrams-state"><EmptyState icon={<DiagramIcon />} title="No diagrams yet" description="Diagrams appear here when your agent writes PlantUML (.puml) files into this work folder; the atlas skill tells it how." /></div>
          : entry && !entry.valid ? <div className="diagrams-state"><Problems diagram={entry} /></div>
          : <div className="diagrams-state">{error ? null : <Spinner label="Loading the diagram" />}</div>}
      </>}
      {notices.length > 0 && <div className="diagrams-notices" role="status">{notices.map((message, index) => <Notice tone="warning" key={index}>{message}</Notice>)}</div>}
    </div>
  </section>;
}
