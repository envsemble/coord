// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by its status, a table each with the same columns: work under way (agents on it,
// blocked or paused) in taller rows with the step being worked on or why it is blocked, drafts and
// ready plans in compact ones, closed work with how it ended. While agents work on a plan its status
// and its step pulse and its agent time counts up; while one waits for the person they are amber and
// the row says for how long. A part says its place in its group, a group how many of its parts are
// closed. The project menu (its choice part of the place, so back and forward and a plan's breadcrumb
// set it), where projects are also made and managed, and a state filter narrow it, on its heading's
// line with the search field, which opens the search. One click opens a plan. A connected agent that does not run Atlas (Codex not trusting its hooks, say)
// has a notice above the plans, linking to Settings › Agents, until it does.
import { memo, useMemo, type MouseEvent } from 'react';
import { Alert, Button, Kbd, SearchField, SegmentedControl, Spinner, Table, Text } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { StatisticsIcon, WorkIcon } from '../ui/icons';
import type { Project } from '../types';
import { hubGroups, hubItems, hubRowFacts, inState, partsFacts, type HubItem, type HubRowFacts, type HubState } from './hubPlans';
import { absoluteDate, plural, relativeDate, workNumber } from '../ui/format';
import { settingsPlace, statisticsPlace, workTarget, type Place } from '../navigation/targets';
import { ProjectMenu } from '../projects/ProjectMenu';
import type { ProjectActions } from '../projects/ProjectDialogs';
import { AgentWarnings, useAgentChecks } from '../settings/AgentList';
import { StatusIcon } from '../ui/badges';
import { StepBar } from '../plan/LedgerProgress';
import { ModelName } from '../ui/ModelName';
import { continuation } from '../plan/handoffs';
import { ContinuedIn } from '../plan/HandoffLinks';
import { Page } from '../ui/Page';
import { modifierKey } from '../titleBar/TitleBar';
import { AgentTime, Waited } from '../plan/LiveAgentTime';
import { unreported, type LiveActivity } from '../plan/agentTime';

/** The hub's state filter, kept while the window is open. */
export interface HubFilters { state: HubState }

/** Steps done of all, the planning steps among them in their own colour, the one in progress showing what agents do. */
function Progress({ progress, wide, activity }: { progress: NonNullable<HubRowFacts['progress']>; wide?: boolean; activity: LiveActivity | null }) {
  const left = progress.total - progress.done - progress.doing;
  return <span className="hub-row-steps" title={progress.text + ' steps done'}>
    <StepBar counts={{ total: progress.total, done: progress.done, doing: progress.doing, todo: left, remaining: left + progress.doing }} planning={progress.planning} compact live={activity?.state} />
    <span className="hub-row-steps-text">{wide ? progress.text : progress.text.replace(' planning', '')}</span>
  </span>;
}

/**
 * What agents spent on it: the main model and how many others, then agent time (counting up while
 * agents work, its report by stage on hover), tokens and subagents.
 */
function Spent({ item, facts }: { item: HubItem; facts: HubRowFacts }) {
  const { model, time, tokens, subagents } = facts;
  const { activity } = item;
  const timed = Boolean(time) || unreported(activity);
  const rest = [tokens, subagents].filter(Boolean).join(' · ');
  if (!model && !timed && !rest) return <span className="muted">—</span>;
  const stages = ([['Planning', time?.planning], ['Implementation', time?.implementation]] as const).flatMap(([label, value]) => value ? [{ label, value }] : []);
  return <span className="hub-row-stats">
    {model && <span className="hub-row-model"><ModelName model={model.id} effort={model.effort} />{model.others > 0 && <span className="muted" title={plural(model.others, 'other model')}>+{model.others}</span>}</span>}
    {(timed || rest) && <small className="cell-note">
      {timed && <AgentTime totals={item.work.statistics ?? { agentMs: 0, activeMs: 0, unmergedMs: 0, lastReport: null }} activity={activity} sections={[{ heading: 'By stage', rows: stages }]} description="Every agent's working time, added up" />}
      {timed && rest ? ' · ' + rest : rest}
    </small>}
  </span>;
}

/** When it last changed, relative, with the date on hover. */
const Changed = ({ value }: { value: string | null }) => value ? <span className="hub-row-updated" title={'Changed ' + absoluteDate(value)}>{relativeDate(value)}</span> : null;

/** Plan, project, progress, agents, changed: the same widths in every group, so the columns line up. */
const columnWidths = [44, 13, 15, 18, 10];

/**
 * A plan: the whole row opens it. A plan under way says where it stands under its title: why it is
 * blocked, else the step being worked on or next, and how long an agent has waited for the person.
 * Its summary shows on the title's hover. The status icon carries the colour and pulses while agents
 * work; the text stays neutral but for that line, amber while one waits.
 */
const HubRow = memo(function HubRow({ item, go }: { item: HubItem; go(place: Place): void }) {
  const { work, project, status, activity } = item;
  const facts = hubRowFacts(work, status);
  const waiting = activity?.state === 'waiting' ? activity : null;
  const open = (event: MouseEvent) => { event.preventDefault(); go({ projectId: project.id, target: workTarget(work.id) }); };
  const large = facts.size === 'large';
  // Closed work says where it continues, small, under how it ended.
  const continued = continuation(Boolean(facts.ended), work, project.id);
  const parts = partsFacts(work, project);
  return <Table.Row interactive className={'hub-row' + (large ? ' hub-row-large' : facts.size === 'closed' ? ' hub-row-closed' : '')} data-work={work.id} data-size={facts.size}
    onClick={event => { if (!event.defaultPrevented && !(event.target as Element).closest('a, button') && !window.getSelection()?.toString()) open(event); }}>
    <Table.Cell>
      <span className="hub-row-title">
        <StatusIcon status={status} />
        <a href="#" className="hub-row-link" draggable={false} title={work.summary ?? undefined} onClick={open}>{work.title}</a>
        <span className="hub-row-number">{workNumber(work.id)}</span>
        {parts && <span className="hub-row-parts" data-kind={parts.kind}>{parts.kind === 'part' ? 'Part ' + parts.index + ' of ' + workNumber(parts.group) : plural(parts.count, 'part') + (parts.closed ? ' · ' + parts.closed + ' closed' : '')}</span>}
      </span>
      {large && (facts.blocked ? <small className="cell-note hub-row-blocked">Blocked: {facts.blocked}</small>
        : (facts.step || waiting) && <small className="cell-note hub-row-step" data-phase={facts.step?.phase} data-status={facts.step?.label === 'Now' ? 'doing' : 'todo'} data-live={waiting ? 'waiting' : undefined}
          title={facts.step ? (facts.step.phase === 'planning' ? 'Planning' : 'Implementation') + ' step' : undefined}>
          {facts.step && facts.step.label + ': ' + facts.step.title}{facts.step && waiting && ' · '}{waiting && <>waiting <Waited activity={waiting} /></>}
        </small>)}
    </Table.Cell>
    <Table.Cell><span className="hub-row-project" title={project.name}>{project.name}</span></Table.Cell>
    <Table.Cell>{facts.ended ? <span className="hub-row-ended">{facts.ended.label}{facts.ended.date && <span className="muted" title={absoluteDate(facts.ended.date)}> {relativeDate(facts.ended.date)}</span>}
      {continued.length > 0 && <small className="cell-note"><ContinuedIn items={continued} open={to => go({ projectId: to.projectId, target: workTarget(to.work) })} /></small>}</span>
      : facts.progress ? <Progress progress={facts.progress} wide={large} activity={activity} /> : <span className="muted">—</span>}</Table.Cell>
    <Table.Cell><Spent item={item} facts={facts} /></Table.Cell>
    <Table.Cell numeric nowrap>{facts.changed ? <Changed value={facts.changed} /> : <span className="muted">—</span>}</Table.Cell>
  </Table.Row>;
}, (before, after) => before.go === after.go && rowKey(before.item) === rowKey(after.item));

/** What a row shows of its plan, as text: a row whose plan reads the same in a new listing is not drawn again. */
const rowKeys = new WeakMap<HubItem, string>();
function rowKey(item: HubItem) {
  let key = rowKeys.get(item);
  if (key === undefined) rowKeys.set(item, key = JSON.stringify([item.project.id, item.project.name, item.work, item.activity, item.status.key]));
  return key;
}

export function Hub({ projects, error, filter: asked, filters, setFilters, go, query, search, left, platform, computer, local, actions, newProject }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void;
  /** The search's query while it is open; the field shows it. */
  query: string;
  /** Open the search with what was typed (none: what it has); `focused`: the field took focus (the window decides whether that opens it). */
  search(query?: string, focused?: boolean): void;
  /** The search field lost focus. */
  left(): void;
  /** The computer's platform, for the search's shortcut keys. */
  platform: string;
  /** The window's computer, its name, and whether it is this one (whose folders can be chosen), for the project menu. */
  computer: string; local: boolean;
  actions: ProjectActions;
  /** Open Create project. */
  newProject(): void;
}) {
  // Archived projects are seen only in the project menu, to restore: the hub of one shows every project's plans.
  const filter = projects?.some(project => project.id === asked && project.state === 'active') ? asked : null;
  const items = useMemo(() => hubItems(projects ?? [], filter), [projects, filter]);
  const groups = useMemo(() => hubGroups(items, filters.state), [items, filters.state]);
  const counts = useMemo(() => ({ open: items.filter(item => inState(item, 'open')).length, closed: items.filter(item => inState(item, 'closed')).length, all: items.length }), [items]);
  const filtered = projects?.find(project => project.id === filter);
  // The projects to filter by: the active ones.
  const choices = (projects ?? []).filter(project => project.state === 'active');
  const unread = choices.filter(project => project.summary === null);
  const agents = useAgentChecks();
  const warnings = <AgentWarnings agents={agents} action={<Button variant="text" underline onClick={() => go(settingsPlace('agents'))}>Settings › Agents</Button>} />;
  if (!projects) return <div className="page-state" aria-busy="true"><Spinner size="lg" label="Loading the plans" /></div>;
  // The computer did not list its projects (another computer that does not answer, say).
  if (!projects.length && error) return <Page className="hub">
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="The projects can’t be listed right now" description={error + ' Atlas lists them again as soon as it can.'} />
  </Page>;
  if (!projects.length) return <Page className="hub">
    {warnings}
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="No projects yet"
      description="Plans live in projects. Make one here, or ask an agent to."
      action={<Button variant="secondary" onClick={newProject}>New project</Button>} />
  </Page>;
  const empty = filters.state === 'open' ? 'No open plans' : filters.state === 'closed' ? 'No closed plans' : 'No plans yet';
  // One line: the heading (with its statistics: the project's, or all plans') at the left, the search and the filters together at the right.
  return <Page className="hub" heading={<div className="hub-heading">
    <div className="hub-lead">
      <Text render={<h1 />} variant="title" className="hub-title">{filtered?.name ?? 'Plans'}</Text>
      <Button variant="text" startIcon={<StatisticsIcon />} onClick={() => go(statisticsPlace(filtered?.id ?? null))}>Statistics</Button>
    </div>
    <div className="hub-filters">
      {/* The search opens the search popup with what is typed, and never filters this list. */}
      <SearchField className="hub-search" label="Search" placeholder="Search every project" value={query} aria-haspopup="dialog" showLabel={false}
        aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'} suffix={query ? undefined : <Kbd keys={[modifierKey(platform), 'P']} />}
        onValueChange={search} onFocus={() => search(undefined, true)} onBlur={left} onClick={() => search()} />
      <ProjectMenu projects={projects} chosen={filtered} computer={computer} local={local} actions={actions} newProject={newProject} />
      <SegmentedControl aria-label="Plan state" value={filters.state} onValueChange={state => setFilters({ ...filters, state: state as HubState })}
        items={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'closed', label: 'Closed', count: counts.closed }, { value: 'all', label: 'All', count: counts.all }]} />
    </div>
  </div>}>
    {error && <Alert tone="warning">{error}</Alert>}
    {warnings}
    {unread.length > 0 && <Text variant="caption" emphasis="muted" className="hub-note">{unread.map(project => project.name).join(', ')}: the planning folder could not be read.</Text>}
    {groups.map(group => <section key={group.id} className="hub-group" aria-label={group.label}>
      <Text render={<h2 />} variant="title" className="hub-group-heading">{group.label} <span className="muted">{group.items.length}</span></Text>
      <Table.Root className="hub-list" aria-label={group.label} columnWidths={columnWidths}>
        <Table.Head><Table.Row><Table.HeaderCell>Plan</Table.HeaderCell><Table.HeaderCell>Project</Table.HeaderCell><Table.HeaderCell>{group.id === 'closed' ? 'Ended' : 'Steps'}</Table.HeaderCell><Table.HeaderCell>Agents</Table.HeaderCell><Table.HeaderCell numeric>Changed</Table.HeaderCell></Table.Row></Table.Head>
        <Table.Body>{group.items.map(item => <HubRow key={item.project.id + ':' + item.work.id} item={item} go={go} />)}</Table.Body>
      </Table.Root>
    </section>)}
    {!groups.length && <EmptyState className="page-empty hub-empty" align="center" icon={<WorkIcon />} title={empty}
      description={filtered ? (filters.state === 'open' ? 'Every plan of ' + filtered.name + ' is closed.' : 'Nothing here for ' + filtered.name + ' yet.') : undefined} />}
  </Page>;
}
