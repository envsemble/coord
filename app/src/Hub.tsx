// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by where it stands, one full-width row each: work in progress and blocked work
// with the most (its summary, progress, the step being worked on or why it is blocked, and what
// agents spent on it), drafts and other open work less, closed work how it ended. A project filter
// (part of the place, so back and forward and a plan's breadcrumb set it) and a state filter narrow
// it; the search field above them opens the search. One click opens a plan.
import { useMemo, type MouseEvent } from 'react';
import { Button, EmptyState, GroupedRows, Link, Notice, Row, SearchField, SegmentedControl, Select, Spinner, Text } from '@envsemble/envui';
import { BlockedIcon, WorkIcon } from './icons';
import type { Project } from './types';
import { hubGroups, hubItems, hubRowFacts, hubStatus, inState, type HubItem, type HubRowFacts, type HubState } from './hubPlans';
import { absoluteDate, relativeDate, workNumber } from './format';
import { hubPlace, projectsPlace, workTarget, type Place } from './targets';
import { StatusIcon } from './ui';
import { StepBar } from './LedgerProgress';
import { ProviderMark } from './AiModel';
import { Page } from './Pages';

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

/** What agents spent on it: the main model and how many others, agent time (split by phase on a large row), tokens and subagents. */
function Spent({ facts }: { facts: HubRowFacts }) {
  const { model, time, tokens, subagents } = facts;
  const split = time && [time.planning && 'planning ' + time.planning, time.implementation && 'implementation ' + time.implementation].filter(Boolean).join(', ');
  const parts = [
    model && <span key="model" className="hub-row-model" title={model.id}><ProviderMark provider={model.provider} />{model.name}{model.others > 0 && <span className="muted"> +{model.others}</span>}</span>,
    time && <span key="time">{time.total} agent time{split ? <span className="muted"> ({split})</span> : null}</span>,
    tokens && <span key="tokens">{tokens}</span>,
    subagents && <span key="subagents">{subagents}</span>,
  ].filter(Boolean);
  return parts.length ? <>{parts}</> : null;
}

/** When it last changed, relative, with the date on hover. */
const Changed = ({ value }: { value: string | null }) => value ? <span className="hub-row-updated" title={'Changed ' + absoluteDate(value)}>{relativeDate(value)}</span> : null;

/** A plan: the whole row opens it (its title link covers the row). */
function HubRow({ item, go }: { item: HubItem; go(place: Place): void }) {
  const { work, project } = item;
  const status = hubStatus(work);
  const facts = hubRowFacts(work);
  const open = (event: MouseEvent) => { event.preventDefault(); go({ project: project.folderId, target: workTarget(work.id) }); };
  const live = item.live && <span className="hub-row-live" role="img" aria-label="An agent is working on it"><span className="project-live-dot" />{facts.size === 'large' && <span aria-hidden="true">agent working</span>}</span>;
  const spent = <Spent facts={facts} />;
  const title = <span className="hub-row-title">
    <StatusIcon status={status} />
    <Link href="#" underline={false} data-row-target="" draggable={false} onClick={open}>{work.title}</Link>
    <span className="hub-row-number">{workNumber(work.id)}</span>
    <span className="hub-row-project">{project.name}</span>
    {facts.size === 'large' && live}
  </span>;
  const summary = work.summary ? <span className="hub-row-summary" title={work.summary}>{work.summary}</span> : undefined;
  const props = {
    interactive: true, 'data-work': work.id, 'data-size': facts.size, title, detail: summary,
    onClick: (event: MouseEvent) => { if (!event.defaultPrevented && !(event.target as Element).closest('a, button') && !window.getSelection()?.toString()) open(event); },
  };
  if (facts.size === 'large') return <Row {...props} className="hub-row hub-row-large">
    {(facts.progress || facts.step || facts.blocked) && <span className="hub-row-line hub-row-now">
      {facts.progress && <Progress progress={facts.progress} wide />}
      {facts.blocked ? <span className="hub-row-blocked"><BlockedIcon className="hub-row-blocked-icon" />Blocked: {facts.blocked}</span>
        : facts.step && <span className="hub-row-step" data-phase={facts.step.phase} data-status={facts.step.label === 'Now' ? 'doing' : 'todo'} title={(facts.step.phase === 'planning' ? 'Planning' : 'Implementation') + ' step'}>{facts.step.label}: {facts.step.title}</span>}
    </span>}
    <span className="hub-row-line hub-row-stats">{spent}<Changed value={facts.changed} /></span>
  </Row>;
  if (facts.size === 'closed') return <Row {...props} className="hub-row hub-row-closed" action={<span className="hub-row-side">
    <span className="hub-row-ended">{facts.ended!.label}{facts.ended!.date && <span className="muted" title={absoluteDate(facts.ended!.date)}> {relativeDate(facts.ended!.date)}</span>}</span>
    {facts.time && <span>{facts.time.total}</span>}
    {facts.tokens && <span>{facts.tokens}</span>}
  </span>} />;
  return <Row {...props} className="hub-row" action={<span className="hub-row-side">
    {facts.progress && <Progress progress={facts.progress} />}
    {live}
    <Changed value={facts.changed} />
  </span>}>
    {(facts.model || facts.time || facts.tokens) && <span className="hub-row-line hub-row-stats">{spent}</span>}
  </Row>;
}

export function Hub({ projects, error, filter, filters, setFilters, go, query, search, left }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void;
  /** The search's query while it is open; the field shows it. */
  query: string;
  /** Open the search with what was typed (none: what it has); `focused`: the field took focus (the window decides whether that opens it). */
  search(query?: string, focused?: boolean): void;
  /** The search field lost focus. */
  left(): void;
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
    {/* The search: it opens the search popup with what is typed, and never filters this list. */}
    <SearchField className="hub-search" label="Search" placeholder="Search every project" value={query} aria-haspopup="dialog"
      onValueChange={search} onFocus={() => search(undefined, true)} onBlur={left} onClick={() => search()} />
    <span className="spacer" />
    <Select className="hub-project" density="compact" aria-label="Project" value={filter ?? 'all'} onValueChange={value => go(hubPlace(!value || value === 'all' ? null : value))}
      options={[{ value: 'all', label: 'All projects' }, ...choices.map(project => ({ value: project.folderId, label: project.name }))]} />
    <SegmentedControl aria-label="Plan state" size="compact" value={filters.state} onValueChange={state => setFilters({ ...filters, state: state as HubState })}
      options={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'closed', label: 'Closed', count: counts.closed }, { value: 'all', label: 'All', count: counts.all }]} />
  </>}>
    {error && <Notice tone="warning">{error}</Notice>}
    {unread.length > 0 && <Text variant="caption" tone="muted" className="hub-note">{unread.map(project => project.name).join(', ')}: the planning folder could not be read.</Text>}
    {groups.map(group => <section key={group.id} className="hub-group" aria-label={group.label}>
      <Text as="h2" variant="section-heading" className="hub-group-heading">{group.label} <span className="muted">{group.items.length}</span></Text>
      <GroupedRows className="hub-list" aria-label={group.label}>{group.items.map(item => <HubRow key={item.project.folderId + ':' + item.work.id} item={item} go={go} />)}</GroupedRows>
    </section>)}
    {!groups.length && <EmptyState className="page-empty" icon={<WorkIcon />} title={empty} />}
  </Page>;
}
