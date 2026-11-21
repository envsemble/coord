// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by whose turn its agents say it is, a table each with the same columns: the
// user's turn first, then work agents are on, then work waiting on something or blocked, in taller
// rows with what their state is for (or the step worked on), then later work in compact ones, and
// closed work with how it ended. What a row's state is for links the PRs it names, each with its live
// state, and work that waits says for how long, in place of when it changed. A part says its place in
// its group, a group how many of its parts are closed. The project menu (its choice part of the place,
// so back and forward and a plan's breadcrumb set it), where projects are also made and managed, and a state filter narrow it, on its heading's
// line with that project's statistics; the search stays in the title bar. One click opens a plan. A connected agent that does not run Coord (Codex not trusting its hooks, say)
// has a notice above the plans, linking to Settings › Agents, until it does.
import { Fragment, memo, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Alert, Button, IconButton, Link, Menu, Row, SegmentedControl, Table, Text, Tooltip } from '@envsemble/envui';
import { IconChevronRight } from '@envsemble/envui/icons/ChevronRight';
import { IconFilterList } from '@envsemble/envui/icons/FilterList';
import { EmptyState } from '../ui/EmptyState';
import { Hint, hintDelay } from '../ui/Hint';
import { StatisticsIcon, WorkIcon } from '../ui/icons';
import type { Project, ReferenceInput } from '../types';
import { api } from '../api';
import { entryInState, entryMatchesOnly, groupFacts, hubEntries, hubEntryGroups, hubOnlyFilters, hubOnlyLabels, hubRowFacts, members, noteParts, partsFacts, projectsOf, waits, type HubEntry, type HubItem, type HubOnly, type HubRowFacts, type HubState } from './hubPlans';
import { absoluteDate, elapsed, plural, relativeDate, workNumber } from '../ui/format';
import { settingsPlace, statisticsPlace, workTarget, type Place } from '../navigation/targets';
import { ProjectAvatar, ProjectMenu } from '../projects/ProjectMenu';
import type { ProjectActions } from '../projects/ProjectDialogs';
import { AgentWarnings, useAgentChecks } from '../settings/AgentList';
import { StatusIcon } from '../ui/badges';
import { StepBar } from '../plan/LedgerProgress';
import { ModelName } from '../ui/ModelName';
import { continuation } from '../plan/handoffs';
import { ContinuedIn } from '../plan/HandoffLinks';
import { Page } from '../ui/Page';
import { askReferences, PullMark, type Resolutions } from '../reader/ReferenceLink';
import { referenceKey } from '../reader/references';
import type { Notify } from '../window/windowContext';
import { useLongWait } from '../ui/Loading';
import { lines, partLines, PlanName, stepsHint } from './hubHints';
import { Settled } from './hubMotion';

/** The hub's state filter, kept while the window is open. */
/** Open, closed or all, and the filter menu's filters that are on. */
export interface HubFilters { state: HubState; only: readonly HubOnly[] }

/** Steps done of all, the planning steps among them in their own colour, the one in progress showing what agents do; spelled out (`hint`) when pointed at. */
function Progress({ progress, wide, hint }: { progress: NonNullable<HubRowFacts['progress']>; wide?: boolean; hint: ReactNode }) {
  const left = progress.total - progress.done - progress.doing;
  return <Hint content={hint}><span className="hub-row-steps">
    <StepBar counts={{ total: progress.total, done: progress.done, doing: progress.doing, todo: left, remaining: left + progress.doing }} planning={progress.planning} compact />
    <span className="hub-row-steps-text">{wide ? progress.text : progress.text.replace(' planning', '')}</span>
  </span></Hint>;
}

/**
 * What agents spent on it: the main model and how many others, then agent time (its split by stage
 * when pointed at), tokens and subagents, as reported.
 */
function Spent({ facts }: { facts: HubRowFacts }) {
  const { model, time, tokens, subagents } = facts;
  const rest = [tokens, subagents].filter(Boolean).join(' · ');
  if (!model && !time && !rest) return <span className="muted">—</span>;
  const stages = ([['Planning', time?.planning], ['Implementation', time?.implementation]] as const).flatMap(([label, value]) => value ? [label + ': ' + value] : []);
  return <span className="hub-row-stats">
    {model && <span className="hub-row-model"><ModelName model={model.id} effort={model.effort} hint />{model.others > 0 && <Hint content={plural(model.others, 'other model') + ' took part'}><span className="muted">+{model.others}</span></Hint>}</span>}
    {(time || rest) && <small className="cell-note">
      {time && <Hint content={lines("Every agent's working time, added up", ...stages)}><span>{time.total}</span></Hint>}
      {time && rest ? ' · ' + rest : rest}
    </small>}
  </span>;
}

/** When it last changed, relative, with the date when pointed at. */
// The column is headed Changed, so a date stands alone ("Oct 8", not "on Oct 8").
const Changed = ({ value }: { value: string | null }) => value ? <Hint content={'Changed ' + absoluteDate(value)}><span className="hub-row-updated">{relativeDate(value).replace(/^on /, '')}</span></Hint> : null;

/** How long work has waited: since its state (`state`, as its icon names it) was set, with the moment when pointed at; a dash when its plan does not say since when. */
const Waited = ({ since, waited, state }: { since: string | null; waited: string | null; state: string }) => since && waited ? <Hint content={state + ' since ' + absoluteDate(since)}><span className="hub-row-updated">{waited}</span></Hint> : <span className="muted">—</span>;

/** The time, told again every minute and when the window comes forward, so how long work has waited stays true while the hub shows. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tell = () => setNow(Date.now());
    const timer = window.setInterval(tell, 60_000);
    window.addEventListener('focus', tell);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tell); };
  }, []);
  return now;
}

/** How often, at most, the hub asks again about what its rows reference as its window comes forward (the host keeps a PR's state that long). */
const askAgainAfter = 60_000;
/**
 * What the rows' notes reference (PRs, issues, commits), resolved by the host, by project: each
 * project's in one request, as a document's are, asked when they change and again when the window
 * comes forward, so a PR merged meanwhile shows as merged.
 */
function useNoteReferences(items: HubItem[]): ReadonlyMap<string, Resolutions> {
  const [resolved, setResolved] = useState<ReadonlyMap<string, Resolutions>>(new Map());
  const [asked, setAsked] = useState(0);
  const wanted = useMemo(() => {
    const byProject = new Map<string, Map<string, ReferenceInput>>();
    for (const { project, work, status } of items) {
      const facts = hubRowFacts(work, status);
      const note = facts.note ?? facts.blocked;
      for (const part of note ? noteParts(note) : []) {
        if (typeof part === 'string') continue;
        if (!byProject.has(project.id)) byProject.set(project.id, new Map());
        byProject.get(project.id)!.set(referenceKey(part.input), part.input);
      }
    }
    return [...byProject].map(([projectId, inputs]) => ({ projectId, inputs: [...inputs.values()] }));
  }, [items]);
  const key = wanted.map(({ projectId, inputs }) => projectId + '\n' + inputs.map(referenceKey).join('\n')).join('\n\n');
  useEffect(() => {
    const stops = wanted.map(({ projectId, inputs }) => askReferences(projectId, inputs, answers => setResolved(previous => {
      const before = previous.get(projectId);
      // Asked again, the host may still be fetching what it told before (a PR's state, a commit's subject): that stays until it tells anew.
      const told = answers.map(([reference, answer]) => { const known = before?.get(reference); return [reference, answer && known ? { ...answer, pull: answer.pull ?? known.pull, title: answer.title ?? known.title } : answer] as const; });
      // Kept as it was when the answers say nothing new, so the rows are not drawn again.
      if (before && told.every(([reference, answer]) => before.has(reference) && JSON.stringify(before.get(reference)) === JSON.stringify(answer))) return previous;
      return new Map([...previous, [projectId, new Map([...before ?? [], ...told])]]);
    })));
    return () => stops.forEach(stop => stop());
  }, [key, asked]);
  useEffect(() => {
    if (!key) return;
    let last = Date.now();
    const again = () => { if (Date.now() - last >= askAgainAfter) { last = Date.now(); setAsked(count => count + 1); } };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [key]);
  return resolved;
}

/**
 * What a row's state is for, as text: a PR, issue or commit it names links to its page (a PR with
 * its state beside it, as a mark) once the host says where it leads.
 */
function Note({ note, resolved, notify }: { note: string; resolved: Resolutions | undefined; notify: Notify }) {
  const parts = useMemo(() => noteParts(note), [note]);
  return <>{parts.map((part, index) => {
    if (typeof part === 'string') return part;
    const answer = resolved?.get(referenceKey(part.input));
    if (!answer?.url) return part.text;
    const url = answer.url;
    const open = (event: MouseEvent) => { event.preventDefault(); api.openExternal(url).catch(error => { if ((error as { code?: string }).code !== 'cancelled') notify((error as Error).message, 'warning'); }); };
    return <Fragment key={index}><Hint content={answer.pull?.title ?? answer.title ?? url}><Link href={url} onClick={open}>{part.text}</Link></Hint>{answer.pull && <PullMark pull={answer.pull} />}</Fragment>;
  })}</>;
}

/**
 * Plan, project, progress, agents, changed: the same widths in every group, so the columns line up.
 * With one project shown, its name would repeat on every row: the column goes, and Plan takes its room.
 */
const columnWidths = [44, 13, 15, 18, 10];
const oneProjectWidths = [55, 17, 18, 10];

/** A group's parts as its row says them: whether they show, the element that holds them, how many they are and how many are the user's turn, and each in a line (`list`) for the folded group's hint. */
interface Fold { open: boolean; controls: string; count: number; turn: number; list: string[] }

/** The projects a plan is in: one with its name (whole when pointed at, where it is cut short), several as their avatars (their names when pointed at). */
function InProjects({ projects }: { projects: Project[] }) {
  return <Hint content={projects.length > 1 ? lines(...projects.map(project => project.name)) : null}><span className="hub-row-project">
    {projects.slice(0, 3).map(project => <ProjectAvatar key={project.id} project={project} />)}
    {projects.length === 1 ? <Hint content={projects[0].name} cut><span className="hub-row-project-name">{projects[0].name}</span></Hint> : projects.length > 3 && <span className="hub-row-project-name">+{projects.length - 3}</span>}
  </span></Hint>;
}

/**
 * The hub while the computer lists its projects: its heading at once, and where the plans will be, a
 * few rows as envUI's skeleton once the wait is long enough to notice, so the page fills in without
 * moving.
 */
function HubSkeleton() {
  const long = useLongWait(300);
  return <Page className="hub" title="Plans" controlSize="sm">
    <section className="hub-group" aria-busy="true">
      {long && <Table.Root className="hub-list" aria-label="Loading the plans" skeleton columnWidths={oneProjectWidths}>
        <Table.Head><Table.Row><Table.HeaderCell>Plan</Table.HeaderCell><Table.HeaderCell>Steps</Table.HeaderCell><Table.HeaderCell>Agents</Table.HeaderCell><Table.HeaderCell numeric>Changed</Table.HeaderCell></Table.Row></Table.Head>
        <Table.Body>{[0, 1, 2, 3, 4].map(row => <Table.Row key={row}>
          <Table.Cell>The title of a plan in this project</Table.Cell><Table.Cell>3 of 8</Table.Cell><Table.Cell>Claude Code</Table.Cell><Table.Cell numeric>2 hours ago</Table.Cell>
        </Table.Row>)}</Table.Body>
      </Table.Root>}
    </section>
  </Page>;
}

/**
 * A plan: the whole row opens it. A plan under way says under its title what its state is for (what
 * the user is to do, what it waits on, why it is blocked), else the step being worked on or next.
 * Its title opens a card with its summary once the pointer rests on it. The status icon carries the colour; the text stays neutral
 * but for that line, amber on the user's turn. A work item made of parts folds them away at a click
 * anywhere on its row (`fold`; its number opens its plan, its parts open theirs), with a chevron
 * before its icon that turns to say which way it is, and says how many they are while they are folded; the other rows of a
 * hub with such work leave that button's room (`gutter`), so every title starts on one edge and the
 * buttons stand alone. A part among its group's (`index`, its place) starts with its number.
 */
const HubRow = memo(function HubRow({ item, go, projects, waiting, waited, resolved, notify, index, gutter, fold, toggle }: {
  item: HubItem; go(place: Place): void; notify: Notify;
  /** The host's answers about what its project's rows reference. */
  resolved: Resolutions | undefined;
  /** How long it has waited, on work that waits and says since when. */
  waited: string | null;
  /** The projects it is in, where the table has the Project column; none to name for a part in its group's projects. */
  projects: Project[] | null;
  /** The table says how long work has waited, in place of when it changed. */
  waiting: boolean;
  /** A part's place among its group's parts. */
  index?: number;
  /** The hub has work made of parts: a row leaves the fold button's room before its icon. */
  gutter?: boolean;
  /** A group's parts: whether they show, the rows that hold them, how many they are and how many are the user's turn. */
  fold?: Fold; toggle?(): void;
}) {
  const { work, project, status } = item;
  const facts = hubRowFacts(work, status);
  const open = (event: MouseEvent) => { event.preventDefault(); go({ projectId: project.id, target: workTarget(work.id) }); };
  const large = facts.size === 'large';
  // Closed work says where it continues, small, under how it ended.
  const continued = continuation(Boolean(facts.ended), work, project.id);
  // A part in its group's projects has none to name: its title takes that column's room too.
  const wide = index !== undefined && projects !== null && projects.length === 0;
  // A part listed without its group says whose it is; under its group, its place says so.
  const parts = index === undefined && work.partOf ? partsFacts(work, project) : null;
  return <Table.Row interactive className={'hub-row' + (large ? ' hub-row-large' : facts.size === 'closed' ? ' hub-row-closed' : '') + (index === undefined ? '' : ' hub-row-part')} data-work={work.id} data-size={facts.size}
    onClick={event => { if (!event.defaultPrevented && !(event.target as Element).closest('a, button') && !window.getSelection()?.toString()) { if (fold) toggle?.(); else open(event); } }}>
    <Table.Cell colSpan={wide ? 2 : undefined} className={wide ? 'hub-row-run' : undefined}>
      <span className="hub-row-title">
        {/* The mark of a row that folds: the row is the button, the chevron only says which way it is. */}
        {fold ? <Hint content={(fold.open ? 'Hide its ' : 'Show its ') + plural(fold.count, 'part')}><span className="hub-row-fold" aria-hidden="true"><IconChevronRight /></span></Hint>
          : gutter && index === undefined && <span className="hub-row-fold" aria-hidden="true" />}
        {index !== undefined && <Hint content={'Part ' + index}><span className="hub-row-index" aria-label={'Part ' + index}>{index}</span></Hint>}
        <Hint content={status.label}><span className="hub-row-status"><StatusIcon status={status} /></span></Hint>
        {/* A group's row folds its parts wherever it is clicked: its title is the button that does, stretched over the row, and its number opens its plan. */}
        {fold ? <Button variant="text" className="hub-row-link hub-row-toggle" data-row-target aria-expanded={fold.open} aria-controls={fold.controls} onClick={toggle}><PlanName title={work.title} summary={work.summary} /></Button>
          : <Link href="#" underline={false} className="hub-row-link" data-row-target draggable={false} onClick={open}><PlanName title={work.title} summary={work.summary} /></Link>}
        {/* eslint-disable-next-line envui/no-link-in-clickable-row -- the row folds the group's parts; its plan needs a way in that is no new button, and the number is it */}
        {fold ? <Hint content="Open its plan"><Link href="#" underline={false} className="hub-row-number hub-row-open" draggable={false} onClick={open}>{workNumber(work.id)}</Link></Hint>
          : <span className="hub-row-number">{workNumber(work.id)}</span>}
        {parts?.kind === 'part' && <span className="hub-row-parts" data-kind="part">{'Part ' + parts.index + ' of ' + workNumber(parts.group)}</span>}
        {/* Folded away, its parts are said in a word: how many, and how many wait on the user. */}
        {fold && !fold.open && <Hint content={lines(...fold.list)}><span className="hub-row-parts" data-kind="group">{plural(fold.count, 'part')}{fold.turn > 0 && <span className="hub-row-parts-turn"> · {fold.turn} your turn</span>}</span></Hint>}
      </span>
      {/* A line cut short says itself whole once the pointer rests on it, under the row so its title stays in sight; a step says its phase. */}
      {large && (facts.blocked ? <Hint rest cut side="bottom" align="start" content={'Blocked: ' + facts.blocked}><small className="cell-note hub-row-blocked">Blocked: <Note note={facts.blocked} resolved={resolved} notify={notify} /></small></Hint>
        : facts.note ? <Hint rest cut side="bottom" align="start" content={facts.note}><small className="cell-note hub-row-note" data-status={status.key}><Note note={facts.note} resolved={resolved} notify={notify} /></small></Hint>
        : facts.step && <Hint rest side="bottom" align="start" content={lines((facts.step.phase === 'planning' ? 'Planning step' : 'Implementation step') + (facts.step.label === 'Now' ? ', in progress' : ', next to do'), facts.step.title)}>
          <small className="cell-note hub-row-step" data-phase={facts.step.phase} data-status={facts.step.label === 'Now' ? 'doing' : 'todo'}>{facts.step.label + ': ' + facts.step.title}</small>
        </Hint>)}
    </Table.Cell>
    {projects && !wide && <Table.Cell label="Project"><InProjects projects={projects} /></Table.Cell>}
    <Table.Cell label={facts.ended ? 'Ended' : 'Steps'}>{facts.ended ? <span className="hub-row-ended">{facts.ended.label}{facts.ended.date && <Hint content={absoluteDate(facts.ended.date)}><span className="muted"> {relativeDate(facts.ended.date)}</span></Hint>}
      {continued.length > 0 && <small className="cell-note"><ContinuedIn items={continued} open={to => go({ projectId: to.projectId, target: workTarget(to.work) })} /></small>}</span>
      : facts.progress ? <Progress progress={facts.progress} wide={large} hint={stepsHint(work, facts.progress.text.endsWith(' planning'))} /> : <span className="muted">—</span>}</Table.Cell>
    <Table.Cell label="Agents"><Spent facts={facts} /></Table.Cell>
    {/* A table of work that waits says for how long; a plan in it that does not wait (a group whose part does, a part beside one) has nothing to say there. */}
    {waiting ? <Table.Cell label="Waiting" numeric nowrap>{waits(status.key) ? <Waited since={facts.since} waited={waited} state={status.label} /> : <Hint content={facts.changed ? 'Not waiting; changed ' + absoluteDate(facts.changed) : null}><span className="muted">—</span></Hint>}</Table.Cell>
      : <Table.Cell label="Changed" numeric nowrap>{facts.changed ? <Changed value={facts.changed} /> : <span className="muted">—</span>}</Table.Cell>}
  </Table.Row>;
}, (before, after) => before.go === after.go && before.waiting === after.waiting && before.waited === after.waited && before.resolved === after.resolved && before.notify === after.notify && before.index === after.index && before.gutter === after.gutter && before.toggle === after.toggle
  && JSON.stringify(before.fold) === JSON.stringify(after.fold)
  && projectsKey(before.projects) === projectsKey(after.projects) && rowKey(before.item) === rowKey(after.item));

/** The projects a row names, as text: the row is drawn again only when they change. */
const projectsKey = (projects: Project[] | null) => projects ? projects.map(project => project.id + '\n' + project.name).join('\n') : '';

/** What a row shows of its plan, as text: a row whose plan reads the same in a new listing is not drawn again. */
const rowKeys = new WeakMap<HubItem, string>();
function rowKey(item: HubItem) {
  let key = rowKeys.get(item);
  if (key === undefined) rowKeys.set(item, key = JSON.stringify([item.project.id, item.project.name, item.work, item.status.key, partsFacts(item.work, item.project)]));
  return key;
}

/**
 * An entry of the hub: a plan's row, and for a work item made of parts, under it while it is
 * unfolded, its parts in their order: rows of the same table, so their columns are the table's, each
 * a tile of its own, set in and numbered. A part names its projects only where they are not its
 * group's.
 */
const HubEntryRows = memo(function HubEntryRows({ entry, open, toggleFold, gutter, showProject, waiting, now, byId, go, resolved, notify }: {
  entry: HubEntry; showProject: boolean; waiting: boolean;
  /** Its parts show; `toggleFold` folds or unfolds an entry by its key; `gutter`: the hub has work made of parts. */
  open: boolean; toggleFold(key: string): void; gutter: boolean;
  /** The time, for how long its plans have waited. */
  now: number;
  byId: ReadonlyMap<string, Project>; go(place: Place): void; resolved: Resolutions | undefined; notify: Notify;
}) {
  const { item, parts } = entry;
  const key = entryKey(entry);
  const facts = groupFacts(entry);
  const toggle = useCallback(() => toggleFold(key), [toggleFold, key]);
  const controls = 'hub-parts-' + key.replace(/[^\w-]/g, '-');
  const inProjects = (plan: HubItem) => projectsOf(plan).flatMap(id => byId.get(id) ?? []);
  const own = projectsOf(item).join('\n');
  const waited = (plan: HubItem) => waits(plan.status.key) ? elapsed(plan.work.turn?.since, now) || null : null;
  return <Table.Body id={facts ? controls : undefined} className={facts ? 'hub-entry hub-entry-group' : 'hub-entry'} data-open={facts && open ? '' : undefined}>
    <HubRow item={item} go={go} projects={showProject ? inProjects(item) : null} waiting={waiting} waited={waited(item)} resolved={resolved} notify={notify}
      gutter={gutter} fold={facts ? { open, controls, ...facts, list: partLines(parts) } : undefined} toggle={facts ? toggle : undefined} />
    {open && parts.map((part, at) => <HubRow key={part.work.id} item={part} index={at + 1} go={go} projects={showProject ? projectsOf(part).join('\n') === own ? [] : inProjects(part) : null}
      waiting={waiting} waited={waited(part)} resolved={resolved} notify={notify} />)}
  </Table.Body>;
}, (before, after) => before.open === after.open && before.toggleFold === after.toggleFold && before.gutter === after.gutter && before.showProject === after.showProject && before.waiting === after.waiting && before.now === after.now
  && before.go === after.go && before.resolved === after.resolved && before.notify === after.notify && inProjectsKey(before.entry, before.byId) === inProjectsKey(after.entry, after.byId)
  && members(before.entry).length === members(after.entry).length && members(before.entry).every((member, at) => rowKey(member) === rowKey(members(after.entry)[at])));

/** The projects an entry's plans are in, as the listing has them, as text: an entry is drawn again when one is renamed or listed anew, not whenever the projects are listed. */
const inProjectsKey = (entry: HubEntry, byId: ReadonlyMap<string, Project>) => members(entry).map(member => projectsOf(member).map(id => id + ':' + (byId.get(id)?.name ?? '')).join(',')).join('\n');

/** Where the groups folded on the hub are kept, on this computer. */
const foldedKey = 'coord.hub.folded';
/**
 * The groups whose parts are folded away, by their keys, and how to fold or unfold one. A group
 * shows its parts until it is folded, and stays as it was left, across windows and restarts.
 */
function useFolded(): [ReadonlySet<string>, (key: string) => void] {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => {
    try { const stored: unknown = JSON.parse(localStorage.getItem(foldedKey) ?? '[]'); return new Set(Array.isArray(stored) ? stored.filter(item => typeof item === 'string') : []); }
    catch { return new Set(); }
  });
  const toggle = useCallback((key: string) => setFolded(current => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    try { localStorage.setItem(foldedKey, JSON.stringify([...next])); } catch { /* It lasts while the hub shows. */ }
    return next;
  }), []);
  return [folded, toggle];
}

/** An entry's key: its plan's, among every project's. */
const entryKey = (entry: HubEntry) => entry.item.project.id + ':' + entry.item.work.id;

export function Hub({ projects, error, filter: asked, filters, setFilters, go, notify, computer, local, actions, newProject }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void; notify: Notify;
  /** The window's computer, its name, and whether it is this one (whose folders can be chosen), for the project menu. */
  computer: string; local: boolean;
  actions: ProjectActions;
  /** Open Create project. */
  newProject(): void;
}) {
  // Archived projects are seen only in the project menu, to restore: the hub of one shows every project's plans.
  const filter = projects?.some(project => project.id === asked && project.state === 'active') ? asked : null;
  // The filter menu's filters narrow the plans before Open, Closed and All count and group them.
  // A work item made of parts is one entry with them; a project's hub has the entries with a plan in it.
  const entries = useMemo(() => hubEntries(projects ?? [], filter).filter(entry => entryMatchesOnly(entry, filters.only, Date.now())), [projects, filter, filters.only]);
  const groups = useMemo(() => hubEntryGroups(entries, filters.state), [entries, filters.state]);
  const items = useMemo(() => entries.flatMap(members), [entries]);
  const resolved = useNoteReferences(items);
  const now = useNow();
  const counts = useMemo(() => ({ open: entries.filter(entry => entryInState(entry, 'open')).length, closed: entries.filter(entry => entryInState(entry, 'closed')).length, all: entries.length }), [entries]);
  const filtered = projects?.find(project => project.id === filter);
  const byId = useMemo(() => new Map((projects ?? []).map(project => [project.id, project])), [projects]);
  // The Project column shows when the plans listed, parts included, are in more than one project.
  const showProject = useMemo(() => new Set(entries.flatMap(members).flatMap(projectsOf)).size > 1, [entries]);
  // Work made of parts has a fold button before its icon: every row then leaves its room.
  const gutter = useMemo(() => entries.some(entry => entry.parts.length > 0), [entries]);
  const [folded, toggleFold] = useFolded();
  // The projects to filter by: the active ones.
  const choices = (projects ?? []).filter(project => project.state === 'active');
  const unread = choices.filter(project => project.summary === null);
  const agents = useAgentChecks();
  const warnings = <AgentWarnings agents={agents} action={<Button variant="text" underline onClick={() => go(settingsPlace('agents'))}>Settings › Agents</Button>} />;
  if (!projects) return <HubSkeleton />;
  // The computer did not list its projects (another computer that does not answer, say).
  if (!projects.length && error) return <Page className="hub">
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="The projects can’t be listed right now" description={error + ' Coord lists them again as soon as it can.'} />
  </Page>;
  if (!projects.length) return <Page className="hub">
    {warnings}
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="No projects yet"
      description="Plans live in projects. Make one here, or ask an agent to."
      action={<Button variant="secondary" onClick={newProject}>New project</Button>} />
  </Page>;
  const empty = filters.only.length ? 'No plans match the filters' : filters.state === 'open' ? 'No open plans' : filters.state === 'closed' ? 'No closed plans' : 'No plans yet';
  // The title (the project's name, or Plans), and on its row the project menu, that project's
  // statistics and the state filter. Search stays in the title bar, as on every page.
  return <Page className="hub" title={filtered?.name ?? 'Plans'} controlSize="sm"
    actions={<Row align="center" gap={2}>
      <ProjectMenu projects={projects} chosen={filtered} computer={computer} local={local} actions={actions} newProject={newProject} />
      <Button variant="secondary" size="sm" className="hub-statistics" start={<StatisticsIcon />} onClick={() => go(statisticsPlace(filtered?.id ?? null))}>Statistics</Button>
      {/* One filter widget: Open, Closed or All, and in the same capsule the menu of further filters. */}
      <div className="hub-filter-group" role="group" aria-label="Filter plans">
        <SegmentedControl aria-label="Plan state" size="sm" value={filters.state} onValueChange={state => setFilters({ ...filters, state: state as HubState })}
        items={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'closed', label: 'Closed', count: counts.closed }, { value: 'all', label: 'All', count: counts.all }]} />
        <FilterMenu only={filters.only} onChange={only => setFilters({ ...filters, only })} />
      </div>
    </Row>}>
    {error && <Alert tone="warning">{error}</Alert>}
    {warnings}
    {unread.length > 0 && <Text variant="caption" emphasis="muted" className="hub-note">{unread.map(project => project.name).join(', ')}: the planning folder could not be read.</Text>}
    {/* When the plans change under the eyes (a group folds, an agent reports), what stays is followed to its new place; other plans (a project, a filter) are shown at once. */}
    <Settled scene={[filter, filters.state, ...filters.only].join(' ')}>{groups.map(group => {
      const waiting = group.id === 'your_turn' || group.id === 'waiting';
      return <section key={group.id} className="hub-group" aria-label={group.label}>
        <Text render={<h2 />} variant="title" className="hub-group-heading">{group.label} <span className="muted">{group.entries.length}</span></Text>
        <Table.Root className="hub-list" aria-label={group.label} narrowLayout="stack" stackBelow="46rem" columnWidths={showProject ? columnWidths : oneProjectWidths}>
          <Table.Head><Table.Row><Table.HeaderCell>Plan</Table.HeaderCell>{showProject && <Table.HeaderCell>Project</Table.HeaderCell>}<Table.HeaderCell>{group.id === 'closed' ? 'Ended' : 'Steps'}</Table.HeaderCell><Table.HeaderCell>Agents</Table.HeaderCell><Table.HeaderCell numeric>{waiting ? 'Waiting' : 'Changed'}</Table.HeaderCell></Table.Row></Table.Head>
          {group.entries.map(entry => <HubEntryRows key={entryKey(entry)} entry={entry} open={!folded.has(entryKey(entry))} toggleFold={toggleFold} gutter={gutter}
            showProject={showProject} waiting={waiting} now={now} byId={byId} go={go} resolved={resolved.get(entry.item.project.id)} notify={notify} />)}
        </Table.Root>
      </section>;
    })}</Settled>
    {!groups.length && <EmptyState className="page-empty hub-empty" align="center" icon={<WorkIcon />} title={empty}
      description={filters.only.length ? undefined : filtered ? (filters.state === 'open' ? 'Every plan of ' + filtered.name + ' is closed.' : 'Nothing here for ' + filtered.name + ' yet.') : undefined}
      action={filters.only.length ? <Button variant="secondary" onClick={() => setFilters({ ...filters, only: [] })}>Clear filters</Button> : undefined} />}
  </Page>;
}

/** The hub's filter button: a menu of filters that narrow the plans shown, each on or off; the button marks that some are on. */
function FilterMenu({ only, onChange }: { only: readonly HubOnly[]; onChange(only: HubOnly[]): void }) {
  const set = (filter: HubOnly, on: boolean) => onChange(hubOnlyFilters.filter(item => item === filter ? on : only.includes(item)));
  const label = only.length ? 'Filters, ' + only.length + ' on' : 'Filters';
  return <Menu.Root aria-label="Filters" align="end"
    // envUI's own tooltip here, not Hint: the menu gives its trigger the props that open it, and the tooltip passes them on to the button.
    trigger={<Tooltip content={label} side="bottom" delay={hintDelay} underline={false}><IconButton variant="ghost" size="sm" className="hub-filters" aria-label={label} data-active={only.length ? '' : undefined} icon={<IconFilterList />} /></Tooltip>}>
    <Menu.Group label="Show only">
      {hubOnlyFilters.map(filter => <Menu.CheckboxItem key={filter} checked={only.includes(filter)} onCheckedChange={on => set(filter, on)}>{hubOnlyLabels[filter]}</Menu.CheckboxItem>)}
    </Menu.Group>
    {only.length > 0 && <><Menu.Separator /><Menu.Item onClick={() => onChange([])}>Clear filters</Menu.Item></>}
  </Menu.Root>;
}
