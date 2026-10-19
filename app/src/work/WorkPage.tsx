import { useEffect, useRef, type ReactNode } from 'react';
import { Breadcrumbs, Button, EmptyState, Notice, Surface, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { stepCounts } from '@envsemble/atlas/planning/ledger';
import { CommitIcon, DownloadIcon } from '../ui/icons';
import type { Document, LedgerStep, ProjectWork, Snapshot, Target, Work } from '../types';
import { defaultDocument, planDocument, stepPhase } from './work';
import { hubPlace, workTarget } from '../navigation/targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from '../ui/format';
import { workStatus, type WorkStatus } from '../ui/status';
import { RepositoryBadge, StatusBadge } from '../ui/ui';
import { Reader, useReferences } from '../workbench/Reader';
import { LedgerSteps } from '../ui/LedgerProgress';
import { WorkStatisticsSummary } from './WorkStatisticsSummary';
import { Waited } from './LiveAgentTime';
import { unreported, type LiveActivity } from './agentTime';
import { TargetLink, useWorkbench } from '../workbench/workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;

/** A trail of targets, after the project (which leads to its plans in the hub); the last item is the current page. */
export function Trail({ items }: { items: { label: ReactNode; target?: Target }[] }) {
  const { open, go, project, projectName } = useWorkbench();
  return <Breadcrumbs className="breadcrumb" items={[{ label: projectName, onClick: () => go(hubPlace(project)) }, ...items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!) : undefined }))]} />;
}

function AboutSection({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return <section className="about-section">
    <Text as="h2" variant="section-heading" className="about-heading">{title}{note && <span className="about-note"> · {note}</span>}</Text>
    {children}
  </section>;
}

/**
 * Mark an element while it is taller than its box (`data-scrolls`), so its styles can keep its
 * scrolling to itself only when it has something to scroll.
 */
function useScrollsMark<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const mark = () => element.toggleAttribute('data-scrolls', element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(mark);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    mark();
    return () => observer.disconnect();
  });
  return ref;
}

/**
 * The side column: the work's progress (its step in progress showing what agents do, `live`), its
 * dates and repositories, statistics and recent activity. It stays where it is while the page
 * scrolls, and scrolls on its own.
 */
function About({ work, snapshot, found, live, listed }: { work: Work; snapshot: Snapshot; found: string | null; live: LiveActivity | null; listed: ProjectWork | undefined }) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const hasStatus = Boolean(progress && (progress.steps || progress.current || progress.next.length || progress.blocked));
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  const commits = snapshot.history.filter(entry => entry.workIds.includes(work.id)).slice(0, 5);
  const statistics = work.statistics;
  const column = useScrollsMark<HTMLElement>();
  return <aside ref={column} className="about" aria-label="About this work">
    {issues.length > 0 && <Notice tone={issues.some(issue => issue.level === 'error') ? 'error' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Notice>}
    {hasStatus && progress && <AboutSection title={progress.steps ? 'Progress' : 'Status'} note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      {progress.steps ? <LedgerSteps steps={progress.steps} found={found} live={live?.state} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><Text as="h3" variant="caption" className="about-subheading">Next</Text><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
    </AboutSection>}
    {(dates.length > 0 || work.repositories.length > 0) && <AboutSection title="About">
      <dl className="facts">
        {dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={absoluteDate(value)}>{label === 'Updated' ? relativeDate(value) : shortDate(value)}</dd></div>)}
        {work.repositories.length > 0 && <div><dt>{work.repositories.length === 1 ? 'Repository' : 'Repositories'}</dt><dd className="about-repositories">{work.repositories.map(id => <RepositoryBadge key={id} id={id} />)}</dd></div>}
      </dl>
    </AboutSection>}
    {statistics && (statistics.reports > 0 || statistics.planRevisions !== null || unreported(live)) && <AboutSection title="Statistics" note={statistics.lastReport && <span title={absoluteDate(statistics.lastReport)}>reported {relativeDate(statistics.lastReport)}</span>}>
      <WorkStatisticsSummary work={work} statistics={statistics} activity={live} totals={listed?.statistics} />
    </AboutSection>}
    {commits.length > 0 && <AboutSection title="Recent activity">
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><CommitIcon className="about-commit-icon" /><div><span className="commit-title">{entry.title}</span><span className="muted"><Code>{entry.id.slice(0, 7)}</Code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </AboutSection>}
  </aside>;
}

/**
 * The status line under a plan's title: its status and one fact about it, muted: the steps done while
 * agents work on it or it is paused, how long an agent has waited for the person, why it is blocked
 * (cut short; the side column has all of it), the planning step of a draft, when closed work ended;
 * and whether it is archived.
 */
function StatusLine({ work, status, live }: { work: Work; status: WorkStatus; live: LiveActivity | null }) {
  const steps = work.progress?.steps ?? null;
  const counts = steps?.length ? stepCounts(steps) : null;
  const planning = (state: LedgerStep['status']) => steps?.find(step => stepPhase(step) === 'planning' && step.status === state);
  const ended = work.completed ?? work.updated;
  let fact: ReactNode = null;
  switch (status.key) {
    case 'working': case 'paused': fact = counts && counts.done + ' of ' + counts.total + ' steps'; break;
    case 'waiting': fact = live && <Waited activity={live} />; break;
    case 'blocked': fact = <span title={work.progress!.blocked!}>{work.progress!.blocked}</span>; break;
    case 'draft': fact = (planning('doing') ?? planning('todo'))?.title; break;
    case 'complete': case 'partial': case 'superseded': case 'abandoned': fact = ended && <span title={absoluteDate(ended)}>{shortDate(ended)}</span>; break;
  }
  return <div className="work-status">
    <StatusBadge status={status} />
    {fact && <span className="work-status-fact">{fact}</span>}
    {work.location === 'archived' && <span className="work-status-fact">archived</span>}
  </div>;
}

/**
 * A work item: its plan (or, without one, its README or first document). The breadcrumb names its
 * project and number, with Export Plan… beside it; then the title, the status line and the plan's
 * summary. Beside it the work's progress, its dates and repositories, statistics and recent activity.
 * Diagrams open from their cards in the plan.
 */
export function WorkPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { listed, activity, exportPlan } = useWorkbench();
  const plan = planDocument(work);
  const reading: Document | undefined = defaultDocument(work);
  const agents = activity(work.id);
  const status = workStatus(work, agents?.state ?? null);
  // Closed work keeps how it ended: what a session still does on it does not show.
  const live = status.key === 'working' || status.key === 'waiting' ? agents : null;
  const listing = listed(work.id), summary = listing?.summary;
  const references = useReferences(reading, work.id, reading?.format === 'markdown');
  return <div className="work-page">
    <div className="work-layout">
      <div className="work-main">
        <div className="work-trail">
          <Trail items={[{ label: workNumber(work.id) }]} />
          <Button variant="text" className="work-export" startIcon={<DownloadIcon />} onClick={() => exportPlan(work.id)}>Export Plan…</Button>
        </div>
        <header className="work-header">
          <Text as="h1" variant="page-heading">{work.title}</Text>
          <StatusLine work={work} status={status} live={live} />
          {summary && <p className="work-summary">{summary}</p>}
        </header>
        {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} plan={reading === plan} />
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan." />}
      </div>
      <About work={work} snapshot={snapshot} found={target.step ?? null} live={live} listed={listing} />
    </div>
  </div>;
}

export function FileView({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const owner = snapshot.work.find(work => work.id === file.workId);
  const references = useReferences(file, file.workId, file.format === 'markdown' && (Boolean(file.workId) || file.category === 'knowledge'));
  return <div className="page file-page">
    <Trail items={[...(owner ? [{ label: workNumber(owner.id) + ' ' + owner.title, target: workTarget(owner.id) }] : []), { label: file.path }]} />
    <Surface className="file-surface" padding={0}>
      <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} toolbar references={references} showWork={!file.workId} />
    </Surface>
  </div>;
}
