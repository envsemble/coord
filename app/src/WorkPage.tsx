import type { ReactNode } from 'react';
import { Badge, Breadcrumbs, EmptyState, Notice, Surface, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { CommitIcon, LedgerIcon, PlanIcon } from './icons';
import type { Document, Snapshot, Target, Work } from './types';
import { defaultDocument, primaryDocuments } from './work';
import { ledgerTarget, projectTarget, workTarget } from './targets';
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

/**
 * The side column: the work's progress, then the link that shows its ledger in place of the plan (or
 * the plan again), its dates, statistics and recent activity. It scrolls on its own, beside the page.
 */
function About({ work, snapshot, showing }: { work: Work; snapshot: Snapshot; showing: 'plan' | 'ledger' }) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const hasStatus = Boolean(progress && (progress.steps || progress.current || progress.next.length || progress.blocked));
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  const commits = snapshot.history.filter(entry => entry.workIds.includes(work.id)).slice(0, 5);
  const statistics = work.statistics;
  const { plan, ledger } = primaryDocuments(work);
  // The other of the plan and the ledger, shown in place of the one on the page.
  const other = showing === 'ledger' ? plan && <TargetLink target={workTarget(work.id)}><PlanIcon />Plan</TargetLink>
    : ledger && <TargetLink target={ledgerTarget(work.id)}><LedgerIcon />Ledger</TargetLink>;
  const switcher = other && <p className="about-ledger">{other}</p>;
  return <aside className="about" aria-label="About this work">
    {issues.length > 0 && <Notice tone={issues.some(issue => issue.level === 'error') ? 'error' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Notice>}
    {hasStatus && progress && <AboutSection title={progress.steps ? 'Progress' : 'Status'} note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      {progress.steps ? <LedgerSteps steps={progress.steps} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><Text as="h3" variant="caption" className="about-subheading">Next</Text><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
      {switcher}
    </AboutSection>}
    {!(hasStatus && progress) && switcher}
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
 * A work item: its plan (or, without one, its ledger or first document), or its ledger in the plan's
 * place, with the title as its heading and the work number; beside it the work's progress with the
 * link between the plan and the ledger, its dates, statistics and recent activity. Diagrams open from
 * their cards in the plan.
 */
export function WorkPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { projectName } = useWorkbench();
  const { plan, ledger } = primaryDocuments(work);
  const showing = target.view === 'ledger' && ledger ? 'ledger' : 'plan';
  const reading: Document | undefined = showing === 'ledger' ? ledger : plan ?? defaultDocument(work);
  const status = workStatus(work);
  const note = designNote(work);
  const references = useReferences(reading, work.id, reading?.format === 'markdown');
  return <div className="work-page">
    <div className="work-layout">
      <div className="work-main">
        <Trail items={showing === 'ledger' ? [{ label: projectName, target: projectTarget() }, { label: workNumber(work.id), target: workTarget(work.id) }, { label: 'Ledger' }]
          : [{ label: projectName, target: projectTarget() }, { label: workNumber(work.id) }]} />
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
      <About work={work} snapshot={snapshot} showing={showing} />
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
