import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, Text } from '@envsemble/envui';
import { EmptyState } from '../ui/EmptyState';
import { stepCounts } from '@envsemble/atlas/planning/ledger';
import { AttentionDot } from '../ui/AttentionDot';
import type { Document, LedgerStep, ProjectWork, Snapshot, Target, Work, WorkSession } from '../types';
import { defaultDocument, planDocument, stepPhase } from './work';
import { pageTarget, workStatisticsTarget, workTarget } from '../navigation/targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from '../ui/format';
import { statusOf, type StatusLook } from './status';
import { StatusBadge } from '../ui/badges';
import { Reader, useReferences } from '../reader/Reader';
import { LedgerSteps } from './LedgerProgress';
import { continuation, handoffs } from './handoffs';
import { ContinuedIn, HandoffEntries, type OpenHandoff } from './HandoffLinks';
import { WorkStatisticsSummary } from '../statistics/WorkStatisticsSummary';
import { Waited } from './LiveAgentTime';
import { unreported, type LiveActivity } from './agentTime';
import { activityKey, NeedsYou, SessionsList, useWorkSessions } from './WorkSessions';
import { waitingSession } from './sessions';
import { TargetLink, useWindow } from '../window/windowContext';
import { Trail } from '../ui/Trail';
import { Page } from '../ui/Page';
import { TagList } from './TagList';

type WorkTarget = Extract<Target, { kind: 'work' }>;

function AsideSection({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return <section className="plan-aside-section">
    <Text render={<h2 />} variant="title" className="plan-aside-heading">{title}{note && <span className="plan-aside-note"> · {note}</span>}</Text>
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
    // Children that come later (a section that appears) are observed as they come.
    const added = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) observer.observe(node);
      mark();
    });
    added.observe(element, { childList: true });
    mark();
    return () => { observer.disconnect(); added.disconnect(); };
  }, []);
  return ref;
}

/**
 * The side column: the work's progress (its step in progress showing what agents do, `live`), its
 * sessions and its headline statistics, with the way to all of them and the timeline. It stays where
 * it is while the page scrolls, and scrolls on its own.
 */
function PlanAside({ work, snapshot, found, live, listed, sessions }: {
  work: Work; snapshot: Snapshot; found: string | null; live: LiveActivity | null; listed: ProjectWork | undefined; sessions: WorkSession[];
}) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const statistics = work.statistics;
  const reported = Boolean(statistics && (statistics.reports > 0 || unreported(live)));
  const column = useScrollsMark<HTMLElement>();
  // Handoffs: the work this plan continues opens its ledger, the work continuing it ends it.
  const { projectId, go } = useWindow();
  const links = handoffs(work, projectId);
  const openHandoff: OpenHandoff = to => go({ projectId: to.projectId, target: workTarget(to.work) });
  const before = links.continues.length > 0 ? <HandoffEntries items={links.continues} kind="continues" open={openHandoff} /> : null;
  const after = links.continuedIn.length > 0 ? <HandoffEntries items={links.continuedIn} kind="continuedIn" open={openHandoff} /> : null;
  const handoffList = (before || after) && <ol className="ledger-steps ledger-handoffs">{before}{after}</ol>;
  return <aside ref={column} className="plan-aside" aria-label="About this work">
    {issues.length > 0 && <Alert tone={issues.some(issue => issue.level === 'error') ? 'danger' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Alert>}
    {progress && <AsideSection title="Progress" note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Alert tone="danger" className="plan-aside-blocked" title="Blocked">{progress.blocked}</Alert>}
      <LedgerSteps steps={progress.steps} found={found} live={live?.state} before={before} after={after} />
    </AsideSection>}
    {!progress && handoffList && <AsideSection title="Handoffs">{handoffList}</AsideSection>}
    {sessions.length > 0 && <AsideSection title="Sessions"><SessionsList sessions={sessions} /></AsideSection>}
    {(reported || sessions.length > 0) && <AsideSection title="Statistics" note={statistics?.lastReport && <span title={absoluteDate(statistics.lastReport)}>reported {relativeDate(statistics.lastReport)}</span>}>
      {statistics && reported && <WorkStatisticsSummary statistics={statistics} activity={live} totals={listed?.statistics} />}
      <TargetLink target={workStatisticsTarget(work.id)} className="plan-aside-statistics-link">All statistics and the timeline</TargetLink>
    </AsideSection>}
  </aside>;
}

/**
 * The status line under a plan's title: its status and one fact about it, muted: the steps done while
 * agents work on it or it is paused, how long an agent has waited for the person, why it is blocked
 * (cut short; the side column has all of it), the planning step of a draft, when closed work ended;
 * and whether it is archived.
 */
function StatusLine({ work, status, live }: { work: Work; status: StatusLook; live: LiveActivity | null }) {
  const steps = work.progress?.steps ?? null;
  const counts = steps?.length ? stepCounts(steps) : null;
  const planning = (state: LedgerStep['status']) => steps?.find(step => stepPhase(step) === 'planning' && step.status === state);
  const ended = work.completed ?? work.updated;
  const { projectId, go } = useWindow();
  const closed = status.key === 'complete' || status.key === 'partial' || status.key === 'superseded' || status.key === 'abandoned';
  const continued = continuation(closed, work, projectId);
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
    {continued.length > 0 && <span className="work-status-fact"><ContinuedIn items={continued} open={to => go({ projectId: to.projectId, target: workTarget(to.work) })} /></span>}
    {work.location === 'archived' && <span className="work-status-fact">archived</span>}
  </div>;
}

/**
 * A work item: its plan (or, without one, its README or first document). The breadcrumb names its
 * project and number; then the title, the status line, why it needs you
 * when it does, and the plan's summary. Beside it the work's progress, its sessions and statistics.
 * Diagrams open from their cards in the plan.
 */
export function PlanPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { listed, activity } = useWindow();
  const plan = planDocument(work);
  const reading: Document | undefined = defaultDocument(work);
  const agents = activity(work.id);
  const status = statusOf(work, agents?.state ?? null);
  // Closed work keeps how it ended: what a session still does on it does not show.
  const live = status.key === 'working' || status.key === 'waiting' ? agents : null;
  const listing = listed(work.id), summary = listing?.summary;
  const references = useReferences(reading, work.id, reading?.format === 'markdown');
  // The plan's sessions, read again as its activity changes.
  const sessions = useWorkSessions(work.id, activityKey(agents));
  // Its pages that need the person, as their agents said in their page.json.
  const asking = Object.entries(snapshot.attention ?? {}).filter(([page]) => page.startsWith(work.path + '/pages/'));
  const waiting = status.key === 'waiting' && sessions ? waitingSession(sessions.sessions) : null;
  return <Page className="work-page" breadcrumbs={<Trail work={work.id} items={[{ label: workNumber(work.id) }]} />}
    title={work.title} meta={<StatusLine work={work} status={status} live={live} />} description={summary}>
    <div className="work-layout">
      <div className="work-main">
        {(listing?.tags?.length || waiting || asking.length > 0) && <div className="work-header">
          {listing && <TagList tags={listing.tags ?? []} className="work-tags" />}
          {waiting && <NeedsYou work={work.id} session={waiting} />}
          {asking.length > 0 && <ul className="page-attention" aria-label="Pages that need you">
            {asking.map(([page, text]) => <li key={page}>
              <AttentionDot text={text} />
              <TargetLink target={pageTarget(page)} className="page-link">{page.slice(page.lastIndexOf('/') + 1)}</TargetLink>
              <span className="page-attention-text">{text}</span>
            </li>)}
          </ul>}
        </div>}
        {reading ? <div id="plan-reading"><Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} plan={reading === plan} /></div>
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan." />}
      </div>
      <PlanAside work={work} snapshot={snapshot} found={target.step ?? null} live={live} listed={listing} sessions={sessions?.sessions ?? []} />
    </div>
  </Page>;
}
