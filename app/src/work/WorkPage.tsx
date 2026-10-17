import { useEffect, useRef, type ReactNode } from 'react';
import { Badge, Breadcrumbs, Button, EmptyState, Notice, Surface, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { CommitIcon, DownloadIcon } from '../ui/icons';
import type { Document, Snapshot, Target, Work } from '../types';
import { defaultDocument, planDocument } from './work';
import { hubPlace, workTarget } from '../navigation/targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from '../ui/format';
import { designNote, workStatus } from '../ui/status';
import { RepositoryBadge, StatusBadge } from '../ui/ui';
import { Reader, useReferences } from '../workbench/Reader';
import { LedgerSteps } from '../ui/LedgerProgress';
import { WorkStatisticsSummary } from './WorkStatisticsSummary';
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
 * The side column: the work's progress, its dates, statistics and recent activity. It stays where it
 * is while the page scrolls, and scrolls on its own.
 */
function About({ work, snapshot, found }: { work: Work; snapshot: Snapshot; found: string | null }) {
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
      {progress.steps ? <LedgerSteps steps={progress.steps} found={found} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><Text as="h3" variant="caption" className="about-subheading">Next</Text><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
    </AboutSection>}
    {dates.length > 0 && <AboutSection title="About">
      <dl className="facts">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={absoluteDate(value)}>{label === 'Updated' ? relativeDate(value) : shortDate(value)}</dd></div>)}</dl>
    </AboutSection>}
    {statistics && (statistics.reports > 0 || statistics.planRevisions !== null) && <AboutSection title="Statistics" note={statistics.lastReport && <span title={absoluteDate(statistics.lastReport)}>reported {relativeDate(statistics.lastReport)}</span>}>
      <WorkStatisticsSummary work={work} statistics={statistics} />
    </AboutSection>}
    {commits.length > 0 && <AboutSection title="Recent activity">
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><CommitIcon className="about-commit-icon" /><div><span className="commit-title">{entry.title}</span><span className="muted"><Code>{entry.id.slice(0, 7)}</Code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </AboutSection>}
  </aside>;
}

/**
 * A work item: its plan (or, without one, its README or first document), with the title as its
 * heading and the work number; beside it the work's progress, its dates, statistics and recent
 * activity. Diagrams open from their cards in the plan.
 */
export function WorkPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { listed, exportPlan } = useWorkbench();
  const plan = planDocument(work);
  const reading: Document | undefined = defaultDocument(work);
  const status = workStatus(work);
  const note = designNote(work);
  const summary = listed(work.id)?.summary;
  const references = useReferences(reading, work.id, reading?.format === 'markdown');
  return <div className="work-page">
    <div className="work-layout">
      <div className="work-main">
        <Trail items={[{ label: workNumber(work.id) }]} />
        <header className="work-header">
          <Text as="h1" variant="page-heading">{work.title}</Text>
          <div className="work-header-meta">
            <span className="work-number">{workNumber(work.id)}</span>
            <StatusBadge status={status} />
            {work.location === 'archived' && <Badge tone="warning">Archived</Badge>}
            {note && <Badge>{note}</Badge>}
            {work.repositories.map(id => <RepositoryBadge key={id} id={id} />)}
            <span className="spacer" />
            <Button variant="text" className="work-export" startIcon={<DownloadIcon />} onClick={() => exportPlan(work.id)}>Export Plan…</Button>
          </div>
          {summary && <p className="work-summary">{summary}</p>}
        </header>
        {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} plan={reading === plan} />
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan." />}
      </div>
      <About work={work} snapshot={snapshot} found={target.step ?? null} />
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
