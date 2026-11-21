// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by whose turn its agents say it is, a table each with the same columns: the
// user's turn first, then work agents are on, then work waiting on something or blocked, in taller
// rows with what their state is for (or the step worked on), then later work in compact ones, and
// closed work with how it ended. A part says its place in its group, a group how many of its parts
// are closed. The project menu (its choice part of the place, so back and forward and a plan's
// breadcrumb set it), where projects are also made and managed, and a state filter narrow it, on its heading's
// line with that project's statistics; the search stays in the title bar. One click opens a plan. A connected agent that does not run Coord (Codex not trusting its hooks, say)
// has a notice above the plans, linking to Settings › Agents, until it does.
import { memo, useMemo, type MouseEvent } from 'react';
import { Alert, Button, IconButton, Link, Menu, Row, SegmentedControl, Table, Text } from '@envsemble/envui';
import { IconFilterList } from '@envsemble/envui/icons/FilterList';
import { EmptyState } from '../ui/EmptyState';
import { StatisticsIcon, WorkIcon } from '../ui/icons';
import type { Project } from '../types';
import { hubGroups, hubItems, hubOnlyFilters, hubOnlyLabels, hubRowFacts, inState, matchesOnly, partsFacts, type HubItem, type HubOnly, type HubRowFacts, type HubState } from './hubPlans';
import { absoluteDate, plural, relativeDate, workNumber } from '../ui/format';
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
import { useLongWait } from '../ui/Loading';

/** The hub's state filter, kept while the window is open. */
/** Open, closed or all, and the filter menu's filters that are on. */
export interface HubFilters { state: HubState; only: readonly HubOnly[] }

/** Steps done of all, the planning steps among them in their own colour, the one in progress showing what agents do. */
function Progress({ progress, wide }: { progress: NonNullable<HubRowFacts['progress']>; wide?: boolean }) {
  const left = progress.total - progress.done - progress.doing;
  return <span className="hub-row-steps" title={progress.text + ' steps done'}>
    <StepBar counts={{ total: progress.total, done: progress.done, doing: progress.doing, todo: left, remaining: left + progress.doing }} planning={progress.planning} compact />
    <span className="hub-row-steps-text">{wide ? progress.text : progress.text.replace(' planning', '')}</span>
  </span>;
}

/**
 * What agents spent on it: the main model and how many others, then agent time (its split by stage on
 * hover), tokens and subagents, as reported.
 */
function Spent({ facts }: { facts: HubRowFacts }) {
  const { model, time, tokens, subagents } = facts;
  const rest = [tokens, subagents].filter(Boolean).join(' · ');
  if (!model && !time && !rest) return <span className="muted">—</span>;
  const stages = ([['Planning', time?.planning], ['Implementation', time?.implementation]] as const).flatMap(([label, value]) => value ? [label + ': ' + value] : []);
  return <span className="hub-row-stats">
    {model && <span className="hub-row-model"><ModelName model={model.id} effort={model.effort} />{model.others > 0 && <span className="muted" title={plural(model.others, 'other model')}>+{model.others}</span>}</span>}
    {(time || rest) && <small className="cell-note">
      {time && <span title={["Every agent's working time, added up", ...stages].join('\n')}>{time.total}</span>}
      {time && rest ? ' · ' + rest : rest}
    </small>}
  </span>;
}

/** When it last changed, relative, with the date on hover. */
// The column is headed Changed, so a date stands alone ("Oct 8", not "on Oct 8").
const Changed = ({ value }: { value: string | null }) => value ? <span className="hub-row-updated" title={'Changed ' + absoluteDate(value)}>{relativeDate(value).replace(/^on /, '')}</span> : null;

/**
 * Plan, project, progress, agents, changed: the same widths in every group, so the columns line up.
 * With one project shown, its name would repeat on every row: the column goes, and Plan takes its room.
 */
const columnWidths = [44, 13, 15, 18, 10];
const oneProjectWidths = [55, 17, 18, 10];

/**
 * The hub while the computer lists its projects: its heading at once, and where the plans will be, a
 * few rows as envUI's skeleton once the wait is long enough to notice, so the page fills in without
 * moving.
 */
function HubSkeleton() {
  const long = useLongWait(300);
  return <Page className="hub" title="Plans" controlSize="sm">
    <section className="hub-group" aria-busy="true" aria-label="Loading the plans">
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
 * Its summary shows on the title's hover. The status icon carries the colour; the text stays neutral
 * but for that line, amber on the user's turn.
 */
const HubRow = memo(function HubRow({ item, go, showProject }: { item: HubItem; go(place: Place): void; showProject: boolean }) {
  const { work, project, status } = item;
  const facts = hubRowFacts(work, status);
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
        <Link href="#" underline={false} className="hub-row-link" data-row-target draggable={false} title={work.summary ?? undefined} onClick={open}>{work.title}</Link>
        <span className="hub-row-number">{workNumber(work.id)}</span>
        {parts && <span className="hub-row-parts" data-kind={parts.kind}>{parts.kind === 'part' ? 'Part ' + parts.index + ' of ' + workNumber(parts.group) : plural(parts.count, 'part') + (parts.closed ? ' · ' + parts.closed + ' closed' : '')}</span>}
      </span>
      {large && (facts.blocked ? <small className="cell-note hub-row-blocked">Blocked: {facts.blocked}</small>
        : facts.note ? <small className="cell-note hub-row-note" data-status={status.key} title={facts.note}>{facts.note}</small>
        : facts.step && <small className="cell-note hub-row-step" data-phase={facts.step.phase} data-status={facts.step.label === 'Now' ? 'doing' : 'todo'}
          title={(facts.step.phase === 'planning' ? 'Planning' : 'Implementation') + ' step'}>
          {facts.step.label + ': ' + facts.step.title}
        </small>)}
    </Table.Cell>
    {showProject && <Table.Cell label="Project"><span className="hub-row-project" title={project.name}><ProjectAvatar project={project} /><span className="hub-row-project-name">{project.name}</span></span></Table.Cell>}
    <Table.Cell label={facts.ended ? 'Ended' : 'Steps'}>{facts.ended ? <span className="hub-row-ended">{facts.ended.label}{facts.ended.date && <span className="muted" title={absoluteDate(facts.ended.date)}> {relativeDate(facts.ended.date)}</span>}
      {continued.length > 0 && <small className="cell-note"><ContinuedIn items={continued} open={to => go({ projectId: to.projectId, target: workTarget(to.work) })} /></small>}</span>
      : facts.progress ? <Progress progress={facts.progress} wide={large} /> : <span className="muted">—</span>}</Table.Cell>
    <Table.Cell label="Agents"><Spent facts={facts} /></Table.Cell>
    <Table.Cell label="Changed" numeric nowrap>{facts.changed ? <Changed value={facts.changed} /> : <span className="muted">—</span>}</Table.Cell>
  </Table.Row>;
}, (before, after) => before.go === after.go && before.showProject === after.showProject && rowKey(before.item) === rowKey(after.item));

/** What a row shows of its plan, as text: a row whose plan reads the same in a new listing is not drawn again. */
const rowKeys = new WeakMap<HubItem, string>();
function rowKey(item: HubItem) {
  let key = rowKeys.get(item);
  if (key === undefined) rowKeys.set(item, key = JSON.stringify([item.project.id, item.project.name, item.work, item.status.key, partsFacts(item.work, item.project)]));
  return key;
}

export function Hub({ projects, error, filter: asked, filters, setFilters, go, computer, local, actions, newProject }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void;
  /** The window's computer, its name, and whether it is this one (whose folders can be chosen), for the project menu. */
  computer: string; local: boolean;
  actions: ProjectActions;
  /** Open Create project. */
  newProject(): void;
}) {
  // Archived projects are seen only in the project menu, to restore: the hub of one shows every project's plans.
  const filter = projects?.some(project => project.id === asked && project.state === 'active') ? asked : null;
  // The filter menu's filters narrow the plans before Open, Closed and All count and group them.
  const items = useMemo(() => hubItems(projects ?? [], filter).filter(item => matchesOnly(item, filters.only, Date.now())), [projects, filter, filters.only]);
  const groups = useMemo(() => hubGroups(items, filters.state), [items, filters.state]);
  const counts = useMemo(() => ({ open: items.filter(item => inState(item, 'open')).length, closed: items.filter(item => inState(item, 'closed')).length, all: items.length }), [items]);
  const filtered = projects?.find(project => project.id === filter);
  const showProject = new Set(items.map(item => item.project.id)).size > 1;
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
    {groups.map(group => <section key={group.id} className="hub-group" aria-label={group.label}>
      <Text render={<h2 />} variant="title" className="hub-group-heading">{group.label} <span className="muted">{group.items.length}</span></Text>
      <Table.Root className="hub-list" aria-label={group.label} narrowLayout="stack" stackBelow="46rem" columnWidths={showProject ? columnWidths : oneProjectWidths}>
        <Table.Head><Table.Row><Table.HeaderCell>Plan</Table.HeaderCell>{showProject && <Table.HeaderCell>Project</Table.HeaderCell>}<Table.HeaderCell>{group.id === 'closed' ? 'Ended' : 'Steps'}</Table.HeaderCell><Table.HeaderCell>Agents</Table.HeaderCell><Table.HeaderCell numeric>Changed</Table.HeaderCell></Table.Row></Table.Head>
        <Table.Body>{group.items.map(item => <HubRow key={item.project.id + ':' + item.work.id} item={item} go={go} showProject={showProject} />)}</Table.Body>
      </Table.Root>
    </section>)}
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
    trigger={<IconButton variant="ghost" size="sm" className="hub-filters" aria-label={label} title={label} data-active={only.length ? '' : undefined} icon={<IconFilterList />} />}>
    <Menu.Group label="Show only">
      {hubOnlyFilters.map(filter => <Menu.CheckboxItem key={filter} checked={only.includes(filter)} onCheckedChange={on => set(filter, on)}>{hubOnlyLabels[filter]}</Menu.CheckboxItem>)}
    </Menu.Group>
    {only.length > 0 && <><Menu.Separator /><Menu.Item onClick={() => onChange([])}>Clear filters</Menu.Item></>}
  </Menu.Root>;
}
