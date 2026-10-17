// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by where it stands, a table each with the same columns: work in progress and
// blocked work in taller rows with the step being worked on or why it is blocked, drafts and other
// open work in compact ones, closed work with how it ended. A project filter (part of the place, so
// back and forward and a plan's breadcrumb set it) and a state filter narrow it; the search field
// above them opens the search. One click opens a plan.
import { useMemo, type MouseEvent } from 'react';
import { Button, EmptyState, Kbd, Notice, SearchField, SegmentedControl, Select, Spinner, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from '@envsemble/envui';
import { WorkIcon } from '../ui/icons';
import type { Project } from '../types';
import { hubGroups, hubItems, hubRowFacts, hubStatus, inState, type HubItem, type HubRowFacts, type HubState } from './hubPlans';
import { absoluteDate, relativeDate, workNumber } from '../ui/format';
import { hubPlace, projectsPlace, workTarget, type Place } from '../navigation/targets';
import { StatusIcon } from '../ui/ui';
import { StepBar } from '../ui/LedgerProgress';
import { ProviderMark } from '../ui/AiModel';
import { Page } from '../ui/Pages';
import { modifierKey } from '../menu/AppMenu';

/** The hub's state filter, kept while the window is open. */
export interface HubFilters { state: HubState }

/** Steps done of all, the planning steps among them in their own colour. */
function Progress({ progress, wide }: { progress: NonNullable<HubRowFacts['progress']>; wide?: boolean }) {
  const left = progress.total - progress.done - progress.doing;
  return <span className="hub-row-steps" title={progress.text + ' steps done'}>
    <StepBar counts={{ total: progress.total, done: progress.done, doing: progress.doing, todo: left, remaining: left + progress.doing }} planning={progress.planning} compact />
    <span className="hub-row-steps-text">{wide ? progress.text : progress.text.replace(' planning', '')}</span>
  </span>;
}

/** What agents spent on it: the main model and how many others, then agent time, tokens and subagents (the time's split by phase on hover). */
function Spent({ facts }: { facts: HubRowFacts }) {
  const { model, time, tokens, subagents } = facts;
  const split = time && [time.planning && 'planning ' + time.planning, time.implementation && 'implementation ' + time.implementation].filter(Boolean).join(', ');
  const totals = [time?.total, tokens, subagents].filter(Boolean).join(' · ');
  if (!model && !totals) return <span className="muted">—</span>;
  return <span className="hub-row-stats">
    {model && <span className="hub-row-model" title={model.id}><ProviderMark provider={model.provider} />{model.name}{model.others > 0 && <span className="muted"> +{model.others}</span>}</span>}
    {totals && <small className="cell-note" title={split ? 'Agent time: ' + split : undefined}>{totals}</small>}
  </span>;
}

/** When it last changed, relative, with the date on hover. */
const Changed = ({ value }: { value: string | null }) => value ? <span className="hub-row-updated" title={'Changed ' + absoluteDate(value)}>{relativeDate(value)}</span> : null;

/** Plan, project, progress, agents, changed: the same widths in every group, so the columns line up. */
const columnWidths = [44, 13, 15, 18, 10];

/**
 * A plan: the whole row opens it. A plan in progress says where it stands under its title: why it is
 * blocked, else the step being worked on or next. Its summary shows on the title's hover. The status
 * icon carries the colour; the text stays neutral.
 */
function HubRow({ item, go }: { item: HubItem; go(place: Place): void }) {
  const { work, project } = item;
  const status = hubStatus(work);
  const facts = hubRowFacts(work);
  const open = (event: MouseEvent) => { event.preventDefault(); go({ project: project.folderId, target: workTarget(work.id) }); };
  const large = facts.size === 'large';
  return <TableRow interactive className={'hub-row' + (large ? ' hub-row-large' : facts.size === 'closed' ? ' hub-row-closed' : '')} data-work={work.id} data-size={facts.size}
    onClick={event => { if (!event.defaultPrevented && !(event.target as Element).closest('a, button') && !window.getSelection()?.toString()) open(event); }}>
    <TableCell>
      <span className="hub-row-title">
        <StatusIcon status={status} />
        <a href="#" className="hub-row-link" draggable={false} title={work.summary ?? undefined} onClick={open}>{work.title}</a>
        <span className="hub-row-number">{workNumber(work.id)}</span>
        {item.live && <span className="hub-row-live" role="img" aria-label="An agent is working on it"><span className="project-live-dot" />{large && <span aria-hidden="true">agent working</span>}</span>}
      </span>
      {large && (facts.blocked ? <small className="cell-note hub-row-blocked">Blocked: {facts.blocked}</small>
        : facts.step && <small className="cell-note hub-row-step" data-phase={facts.step.phase} data-status={facts.step.label === 'Now' ? 'doing' : 'todo'} title={(facts.step.phase === 'planning' ? 'Planning' : 'Implementation') + ' step'}>{facts.step.label}: {facts.step.title}</small>)}
    </TableCell>
    <TableCell><span className="hub-row-project">{project.name}</span></TableCell>
    <TableCell>{facts.ended ? <span className="hub-row-ended">{facts.ended.label}{facts.ended.date && <span className="muted" title={absoluteDate(facts.ended.date)}> {relativeDate(facts.ended.date)}</span>}</span>
      : facts.progress ? <Progress progress={facts.progress} wide={large} /> : <span className="muted">—</span>}</TableCell>
    <TableCell><Spent facts={facts} /></TableCell>
    <TableCell numeric nowrap>{facts.changed ? <Changed value={facts.changed} /> : <span className="muted">—</span>}</TableCell>
  </TableRow>;
}

export function Hub({ projects, error, filter, filters, setFilters, go, query, search, left, platform }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void;
  /** The search's query while it is open; the field shows it. */
  query: string;
  /** Open the search with what was typed (none: what it has); `focused`: the field took focus (the window decides whether that opens it). */
  search(query?: string, focused?: boolean): void;
  /** The search field lost focus. */
  left(): void;
  /** The computer's platform, for the search's shortcut keys. */
  platform: string;
}) {
  const items = useMemo(() => hubItems(projects ?? [], filter), [projects, filter]);
  const groups = useMemo(() => hubGroups(items, filters.state), [items, filters.state]);
  const counts = useMemo(() => ({ open: items.filter(item => inState(item, 'open')).length, closed: items.filter(item => inState(item, 'closed')).length, all: items.length }), [items]);
  const filtered = projects?.find(project => project.folderId === filter);
  // The projects to filter by: the active ones, and the one filtered to whatever its state.
  const choices = (projects ?? []).filter(project => project.state === 'active' || project.folderId === filter);
  const unread = (projects ?? []).filter(project => (project.state === 'active' || project.folderId === filter) && project.summary === null);
  if (!projects) return <div className="page-state" aria-busy="true"><Spinner size="large" label="Loading the plans" /></div>;
  // The computer did not list its projects (another computer that does not answer, say).
  if (!projects.length && error) return <Page className="hub">
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="The projects can’t be listed right now" description={error + ' Atlas lists them again as soon as it can.'} />
  </Page>;
  if (!projects.length) return <Page className="hub">
    <EmptyState className="page-empty" icon={<WorkIcon />} headingLevel={1} title="No projects yet"
      description="Plans live in projects. Make one in Projects › New project, or ask an agent to."
      action={<Button variant="secondary" onClick={() => go(projectsPlace())}>Projects</Button>} />
  </Page>;
  const empty = filters.state === 'open' ? 'No open plans' : filters.state === 'closed' ? 'No closed plans' : 'No plans yet';
  return <Page className="hub" title={filtered?.name ?? 'Plans'} toolbar={<>
    <span className="spacer" />
    <Select className="hub-project" density="compact" aria-label="Project" value={filter ?? 'all'} onValueChange={value => go(hubPlace(!value || value === 'all' ? null : value))}
      options={[{ value: 'all', label: 'All projects' }, ...choices.map(project => ({ value: project.folderId, label: project.name }))]} />
    <SegmentedControl aria-label="Plan state" size="compact" value={filters.state} onValueChange={state => setFilters({ ...filters, state: state as HubState })}
      options={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'closed', label: 'Closed', count: counts.closed }, { value: 'all', label: 'All', count: counts.all }]} />
  </>}>
    {/* The search, centred above the plans: it opens the search popup with what is typed, and never filters this list. */}
    <div className="hub-search-bar">
      <SearchField className="hub-search" label="Search" placeholder="Search every project" value={query} aria-haspopup="dialog" compact={false} showLabel={false}
        aria-keyshortcuts={platform === 'darwin' ? 'Meta+P' : 'Control+P'} suffix={query ? undefined : <Kbd keys={[modifierKey(platform), 'P']} />}
        onValueChange={search} onFocus={() => search(undefined, true)} onBlur={left} onClick={() => search()} />
    </div>
    {error && <Notice tone="warning">{error}</Notice>}
    {unread.length > 0 && <Text variant="caption" tone="muted" className="hub-note">{unread.map(project => project.name).join(', ')}: the planning folder could not be read.</Text>}
    {groups.map(group => <section key={group.id} className="hub-group" aria-label={group.label}>
      <Text as="h2" variant="section-heading" className="hub-group-heading">{group.label} <span className="muted">{group.items.length}</span></Text>
      <Table className="hub-list" aria-label={group.label} columnWidths={columnWidths}>
        <TableHead><TableRow><TableHeaderCell>Plan</TableHeaderCell><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell>{group.id === 'closed' ? 'Ended' : 'Steps'}</TableHeaderCell><TableHeaderCell>Agents</TableHeaderCell><TableHeaderCell numeric>Changed</TableHeaderCell></TableRow></TableHead>
        <TableBody>{group.items.map(item => <HubRow key={item.project.folderId + ':' + item.work.id} item={item} go={go} />)}</TableBody>
      </Table>
    </section>)}
    {!groups.length && <EmptyState className="page-empty" icon={<WorkIcon />} title={empty} />}
  </Page>;
}
