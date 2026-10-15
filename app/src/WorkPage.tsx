import type { ReactNode } from 'react';
import { Badge, Breadcrumbs, EmptyState, Notice, Surface, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { CommitIcon, LedgerIcon } from './icons';
import type { Document, Snapshot, Target, Work } from './types';
import { defaultDocument, primaryDocuments } from './work';
import { fileTarget, projectTarget, workTarget } from './targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from './format';
import { designNote, workStatus } from './status';
import { RepositoryBadge, StatusBadge } from './ui';
import { Reader, useReferences } from './Reader';
import { LedgerSteps } from './LedgerProgress';
import { WorkStatisticsSummary } from './WorkStatisticsSummary';
import { TargetLink, useWorkbench } from './workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;

/** A trail of targets; the last item is the current page. */
export function Trail({ items }: { items: { label: ReactNode; target?: Target }[] }) {
  const { open } = useWorkbench();
  return <Breadcrumbs className="breadcrumb" items={items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!, { pin: true }) : undefined }))} />;
}

function AboutSection({ title, note, children }: { title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return <section className="about-section">
    <Text as="h2" variant="section-heading" className="about-heading">{title}{note && <span className="about-note"> · {note}</span>}</Text>
    {children}
  </section>;
}

function About({ work, snapshot }: { work: Work; snapshot: Snapshot }) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const hasStatus = Boolean(progress && (progress.steps || progress.current || progress.next.length || progress.blocked));
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  const commits = snapshot.history.filter(entry => entry.workIds.includes(work.id)).slice(0, 5);
  const statistics = work.statistics;
  const { ledger } = primaryDocuments(work);
  return <aside className="about" aria-label="About this work">
    {ledger && <p className="about-ledger"><TargetLink target={fileTarget(ledger.path)}><LedgerIcon />Ledger</TargetLink></p>}
    {issues.length > 0 && <Notice tone={issues.some(issue => issue.level === 'error') ? 'error' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Notice>}
    {hasStatus && progress && <AboutSection title={progress.steps ? 'Progress' : 'Status'} note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      {progress.steps ? <LedgerSteps steps={progress.steps} /> : <>
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
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><CommitIcon className="about-commit-icon" /><div><span className="commit-title">{entry.title}</span><span className="muted"><Code appearance="subtle">{entry.id.slice(0, 7)}</Code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </AboutSection>}
  </aside>;
}

/**
 * A work item: its plan (or, without one, its ledger or first document) with the title as its
 * heading and the work number, and beside it the work's progress, dates, statistics and recent
 * activity, with a link to its ledger. Diagrams open from their cards in the plan.
 */
export function WorkPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { projectName } = useWorkbench();
  const reading: Document | undefined = primaryDocuments(work).plan ?? defaultDocument(work);
  const status = workStatus(work);
  const note = designNote(work);
  const references = useReferences(reading, work.id, reading?.format === 'markdown');
  return <div className="work-page">
    <div className="work-layout">
      <div className="work-main">
        <Trail items={[{ label: projectName, target: projectTarget() }, { label: workNumber(work.id) }]} />
        <header className="work-header">
          <Text as="h1" variant="page-heading">{work.title}</Text>
          <div className="work-header-meta">
            <span className="work-number">{workNumber(work.id)}</span>
            <StatusBadge status={status} />
            {work.location === 'archived' && <Badge tone="warning">Archived</Badge>}
            {note && <Badge>{note}</Badge>}
            {work.repositories.map(id => <RepositoryBadge key={id} id={id} />)}
          </div>
        </header>
        {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} />
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan." />}
      </div>
      <About work={work} snapshot={snapshot} />
    </div>
  </div>;
}

export function FileView({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const { projectName } = useWorkbench();
  const owner = snapshot.work.find(work => work.id === file.workId);
  const references = useReferences(file, file.workId, file.format === 'markdown' && (Boolean(file.workId) || file.category === 'knowledge'));
  return <div className="page file-page">
    <Trail items={[{ label: projectName, target: projectTarget() }, ...(owner ? [{ label: workNumber(owner.id) + ' ' + owner.title, target: workTarget(owner.id) }] : []), { label: file.path }]} />
    <Surface className="file-surface" padding={0}>
      <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} toolbar references={references} showWork={!file.workId} />
    </Surface>
  </div>;
}
