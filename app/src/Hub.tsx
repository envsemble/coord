// The hub: where a window starts, and the plan list and nothing else. Every plan of every active
// project, grouped by where it stands, with a search, a project filter (part of the place, so back
// and forward and a plan's breadcrumb set it) and a state filter. One click opens a plan.
import { useMemo, type MouseEvent } from 'react';
import { Button, EmptyState, GroupedRows, Link, Notice, Row, SearchField, SegmentedControl, Select, Spinner, Text } from '@envsemble/envui';
import { WorkIcon } from './icons';
import type { Project } from './types';
import { hubGroups, hubItems, hubMatches, hubStatus, inState, type HubItem, type HubState } from './hubPlans';
import { absoluteDate, relativeDate, workNumber } from './format';
import { hubPlace, projectsPlace, workTarget, type Place } from './targets';
import { StatusIcon } from './ui';
import { StepBar } from './LedgerProgress';
import { Page } from './Pages';

/** The hub's search and state filter, kept while the window is open. */
export interface HubFilters { query: string; state: HubState }

/** A plan: the whole row opens it (its title link covers the row). */
function HubRow({ item, go }: { item: HubItem; go(place: Place): void }) {
  const { work, project } = item;
  const status = hubStatus(work);
  const open = (event: MouseEvent) => { event.preventDefault(); go({ project: project.folderId, target: workTarget(work.id) }); };
  const steps = work.steps && work.steps.total > 0 && work.state !== 'closed' ? work.steps : null;
  return <Row interactive className="hub-row" data-work={work.id}
    onClick={event => { if (!event.defaultPrevented && !(event.target as Element).closest('a, button') && !window.getSelection()?.toString()) open(event); }}
    title={<span className="hub-row-title">
      <StatusIcon status={status} />
      <Link href="#" underline={false} data-row-target="" draggable={false} onClick={open}>{work.title}</Link>
      <span className="hub-row-number">{workNumber(work.id)}</span>
      <span className="hub-row-project">{project.name}</span>
    </span>}
    detail={work.summary ? <span className="hub-row-summary" title={work.summary}>{work.summary}</span> : undefined}
    action={<span className="hub-row-side">
      {steps && <span className="hub-row-steps" title={`${steps.done} of ${steps.total} steps done`}><StepBar counts={{ total: steps.total, done: steps.done, doing: 0, todo: steps.total - steps.done, remaining: steps.total - steps.done }} compact /><span>{steps.done}/{steps.total}</span></span>}
      {item.live && <span className="hub-row-live" role="img" aria-label="An agent is working on it"><span className="project-live-dot" /></span>}
      {work.updated && <span className="hub-row-updated" title={'Changed ' + absoluteDate(work.updated)}>{relativeDate(work.updated)}</span>}
    </span>} />;
}

export function Hub({ projects, error, filter, filters, setFilters, go }: {
  projects: Project[] | null; error: string; filter: string | null; filters: HubFilters; setFilters(filters: HubFilters): void; go(place: Place): void;
}) {
  const items = useMemo(() => hubItems(projects ?? [], filter), [projects, filter]);
  const groups = useMemo(() => hubGroups(items, filters.state, filters.query), [items, filters]);
  const counts = useMemo(() => {
    const found = items.filter(item => hubMatches(item, filters.query));
    return { open: found.filter(item => inState(item, 'open')).length, closed: found.filter(item => inState(item, 'closed')).length, all: found.length };
  }, [items, filters.query]);
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
  const empty = filters.query.trim() ? 'No plans match' : filters.state === 'open' ? 'No open plans' : filters.state === 'closed' ? 'No closed plans' : 'No plans yet';
  return <Page className="hub" title={filtered?.name ?? 'Plans'} toolbar={<>
    <SearchField className="hub-search" label="Search plans" placeholder="Search plans" value={filters.query} onValueChange={query => setFilters({ ...filters, query })} />
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
    {!groups.length && <EmptyState className="page-empty" icon={<WorkIcon />} title={empty}
      description={filters.query.trim() ? 'Try other words, another project or another state.' : undefined} />}
  </Page>;
}
