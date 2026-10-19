import { useEffect, useRef, type ReactNode } from 'react';
import { Breadcrumbs, Button, EmptyState, Notice, Text } from '@envsemble/envui';
import { stepCounts } from '@envsemble/atlas/planning/ledger';
import { DownloadIcon, FolderOpenIcon } from '../ui/icons';
import { api } from '../api';
import type { Document, LedgerStep, ProjectWork, Snapshot, Target, Work, WorkSession } from '../types';
import { defaultDocument, planDocument, stepPhase } from './work';
import { hubPlace, workStatisticsTarget, workTarget } from '../navigation/targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from '../ui/format';
import { workStatus, type WorkStatus } from '../ui/status';
import { StatusBadge } from '../ui/ui';
import { Reader, useReferences } from '../workbench/Reader';
import { LedgerSteps } from '../ui/LedgerProgress';
import { continuation, handoffs } from './handoffs';
import { ContinuedIn, HandoffEntries, type OpenHandoff } from './HandoffLinks';
import { WorkStatisticsSummary } from './WorkStatisticsSummary';
import { Waited } from './LiveAgentTime';
import { unreported, type LiveActivity } from './agentTime';
import { activityKey, NeedsYou, SessionsList, useWorkSessions } from './WorkSessions';
import { waitingSession } from './sessions';
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
 * sessions and its headline statistics, with the way to all of them and the timeline. It stays where
 * it is while the page scrolls, and scrolls on its own.
 */
function About({ work, snapshot, found, live, listed, sessions }: {
  work: Work; snapshot: Snapshot; found: string | null; live: LiveActivity | null; listed: ProjectWork | undefined; sessions: WorkSession[];
}) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const statistics = work.statistics;
  const reported = Boolean(statistics && (statistics.reports > 0 || unreported(live)));
  const column = useScrollsMark<HTMLElement>();
  // Handoffs: the work this plan continues opens its ledger, the work continuing it ends it.
  const { project, go } = useWorkbench();
  const links = handoffs(work, project);
  const openHandoff: OpenHandoff = to => go({ project: to.project, target: workTarget(to.work) });
  const before = links.continues.length > 0 ? <HandoffEntries items={links.continues} kind="continues" open={openHandoff} /> : null;
  const after = links.continuedIn.length > 0 ? <HandoffEntries items={links.continuedIn} kind="continuedIn" open={openHandoff} /> : null;
  const handoffList = (before || after) && <ol className="ledger-steps ledger-handoffs">{before}{after}</ol>;
  return <aside ref={column} className="about" aria-label="About this work">
    {issues.length > 0 && <Notice tone={issues.some(issue => issue.level === 'error') ? 'error' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Notice>}
    {progress && <AboutSection title="Progress" note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      <LedgerSteps steps={progress.steps} found={found} live={live?.state} before={before} after={after} />
    </AboutSection>}
    {!progress && handoffList && <AboutSection title="Handoffs">{handoffList}</AboutSection>}
    {sessions.length > 0 && <AboutSection title="Sessions"><SessionsList sessions={sessions} /></AboutSection>}
    {(reported || sessions.length > 0) && <AboutSection title="Statistics" note={statistics?.lastReport && <span title={absoluteDate(statistics.lastReport)}>reported {relativeDate(statistics.lastReport)}</span>}>
      {statistics && reported && <WorkStatisticsSummary statistics={statistics} activity={live} totals={listed?.statistics} />}
      <TargetLink target={workStatisticsTarget(work.id)} className="about-statistics-link">All statistics and the timeline</TargetLink>
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
  const { project, go } = useWorkbench();
  const closed = status.key === 'complete' || status.key === 'partial' || status.key === 'superseded' || status.key === 'abandoned';
  const continued = continuation(closed, work, project);
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
    {continued.length > 0 && <span className="work-status-fact"><ContinuedIn items={continued} open={to => go({ project: to.project, target: workTarget(to.work) })} /></span>}
    {work.location === 'archived' && <span className="work-status-fact">archived</span>}
  </div>;
}

/**
 * A work item: its plan (or, without one, its README or first document). The breadcrumb names its
 * project and number, with Export Plan… beside it; then the title, the status line, why it needs you
 * when it does, and the plan's summary. Beside it the work's progress, its sessions and statistics.
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
  // The plan's sessions, read again as its activity changes.
  const sessions = useWorkSessions(work.id, activityKey(agents));
  const waiting = status.key === 'waiting' && sessions ? waitingSession(sessions.sessions) : null;
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
          {waiting && <NeedsYou work={work.id} session={waiting} />}
          {summary && <p className="work-summary">{summary}</p>}
        </header>
        {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} plan={reading === plan} />
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan." />}
      </div>
      <About work={work} snapshot={snapshot} found={target.step ?? null} live={live} listed={listing} sessions={sessions?.sessions ?? []} />
    </div>
  </div>;
}

/**
 * A file on the page as a plan is: the breadcrumb (its project, its plan's number when it is one of a
 * plan's, its name, with its path on hover) with Show in folder quietly on its right, then the file as
 * the reader shows it.
 */
export function FileView({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const { project, notify, remote } = useWorkbench();
  const owner = snapshot.work.find(work => work.id === file.workId) ?? snapshot.work.find(work => file.path.startsWith(work.path + '/'));
  const references = useReferences(file, file.workId, file.format === 'markdown' && (Boolean(file.workId) || file.category === 'knowledge'));
  const reveal = () => { api.reveal(project, file.path).catch(error => notify((error as Error).message, 'warning')); };
  return <div className="page file-page">
    <div className="work-trail">
      <Trail items={[...(owner ? [{ label: workNumber(owner.id), target: workTarget(owner.id) }] : []), { label: <span title={file.path}>{file.name}</span> }]} />
      {!remote && <Button variant="text" className="work-export" startIcon={<FolderOpenIcon />} onClick={reveal} title="Show this file in your file manager">Show in folder</Button>}
    </div>
    <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} references={references} showWork={!file.workId} />
  </div>;
}
