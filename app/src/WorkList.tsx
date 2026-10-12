import { EmptyState, GroupedRows, Row, SearchField, SegmentedControl } from '@envsemble/envui';
import { stepCounts, stepSummary } from '@envsemble/atlas-planning/ledger';
import { DiagramIcon, WorkIcon } from './icons';
import type { Snapshot, Work } from './types';
import { designNote, workStatus } from './status';
import { absoluteDate, relativeDate, workNumber } from './format';
import { workTarget } from './targets';
import { RepositoryBadge, StatusIcon } from './ui';
import { TargetLink } from './workbenchContext';
import { StepBar } from './LedgerProgress';
import { Page, RepositorySelect, type RepositoryFilter } from './Pages';

function WorkRow({ work }: { work: Work }) {
  const status = workStatus(work);
  const note = designNote(work);
  const updated = work.progress?.updated ?? work.updated;
  const counts = work.progress?.steps ? stepCounts(work.progress.steps) : null;
  const finished = ['complete', 'superseded', 'abandoned'].includes(status.key);
  return <Row className="work-row"
    title={<span className="work-row-title">
      <StatusIcon status={status} />
      <TargetLink target={workTarget(work.id)}>{work.title}</TargetLink>
      {work.repositories.map(id => <RepositoryBadge key={id} id={id} />)}
    </span>}
    detail={<span className="work-row-meta">
      <span>{workNumber(work.id)}</span>
      <span className="status-text" data-tone={status.tone}>{status.label}</span>
      {note && <span>{note}</span>}
      {work.location === 'archived' && <span>Archived</span>}
      {status.key === 'blocked' && work.progress?.blocked && <span className="blocked-reason" title={work.progress.blocked}>{work.progress.blocked}</span>}
    </span>}
    action={<span className="work-row-side">
      {counts && counts.total > 0 && !finished && <span className="work-row-steps" title={stepSummary(counts)}><StepBar counts={counts} compact /><span>{counts.done}/{counts.total}</span></span>}
      {!!work.diagrams && <TargetLink className="diagram-count" target={workTarget(work.id, 'diagrams')} title={work.diagrams + (work.diagrams === 1 ? ' diagram' : ' diagrams')}><DiagramIcon />{work.diagrams}</TargetLink>}
      {updated && <span className="work-row-updated" title={'Updated ' + absoluteDate(updated)}>{relativeDate(updated)}</span>}
    </span>}>
    {work.progress?.current && status.key !== 'complete' && <p className="work-row-focus">{work.progress.current}</p>}
  </Row>;
}

export function WorkList({ snapshot, repository, setRepository, location, setLocation, search, setSearch }: RepositoryFilter & {
  snapshot: Snapshot; location: string; setLocation(value: string): void; search: string; setSearch(value: string): void;
}) {
  const work = snapshot.work.filter(item => repository === 'all' || item.repositories.includes(repository));
  const term = search.toLowerCase();
  const matches = (item: Work) => [item.title, item.id, workNumber(item.id), ...item.repositories, item.progress?.current ?? ''].join(' ').toLowerCase().includes(term);
  const counts = { active: work.filter(item => item.location === 'active').length, archived: work.filter(item => item.location === 'archived').length, all: work.length };
  const visible = work.filter(item => (location === 'all' || item.location === location) && matches(item)).sort((a, b) => b.id.localeCompare(a.id));
  return <Page title="Work" toolbar={<>
    <SegmentedControl aria-label="Work location" value={location} onValueChange={setLocation}
      options={[{ value: 'active', label: 'Active', count: counts.active }, { value: 'archived', label: 'Archived', count: counts.archived }, { value: 'all', label: 'All', count: counts.all }]} />
    <SearchField className="work-search" label="Search work" value={search} onValueChange={setSearch} />
    <RepositorySelect snapshot={snapshot} repository={repository} setRepository={setRepository} />
  </>}>
    {visible.length ? <GroupedRows className="work-list" aria-label="Work items">{visible.map(item => <WorkRow key={item.id} work={item} />)}</GroupedRows>
      : <EmptyState className="page-empty" icon={<WorkIcon />} title={search ? 'No matching work' : location === 'archived' ? 'No archived work' : 'No work here yet'} />}
  </Page>;
}
