import type { ReactNode } from 'react';
import { Badge, Breadcrumbs, Button, Counter, EmptyState, Notice, Surface, Tabs, Text } from '@envsemble/envui';
import { Code } from '@envsemble/envui/content';
import { CommitIcon, DiagramIcon, LedgerIcon, PlanIcon } from './icons';
import type { Document, Snapshot, Target, Work, WorkSection } from './types';
import { defaultDocument, primaryDocuments } from './work';
import { viewTarget, workTarget } from './targets';
import { absoluteDate, compactNumber, duration, relativeDate, shortDate, workNumber } from './format';
import { designNote, workStatus } from './status';
import { RepositoryBadge, StatusBadge } from './ui';
import { Reader, useReferences } from './Reader';
import { AtlasWorkPanel } from './AtlasWorkPanel';
import { LedgerSteps } from './LedgerProgress';
import { useWorkbench } from './workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;

/** A trail of targets; the last item is the current page. */
export function Trail({ items }: { items: { label: ReactNode; target?: Target }[] }) {
  const { open } = useWorkbench();
  return <Breadcrumbs className="breadcrumb" items={items.map(item => ({ label: item.label, onClick: item.target ? () => open(item.target!, { pin: true }) : undefined }))} />;
}

/** The section a target opens: explicit, else the plan before implementation and the ledger after. */
export function workSection(target: Pick<WorkTarget, 'section'>, work: Work): WorkSection {
  const { plan, ledger } = primaryDocuments(work);
  if (target.section === 'diagrams') return 'diagrams';
  if (target.section === 'plan' && plan) return 'plan';
  if (target.section === 'ledger' && ledger) return 'ledger';
  const preferred = defaultDocument(work);
  if (preferred && preferred.path === ledger?.path) return 'ledger';
  if (plan) return 'plan';
  if (ledger) return 'ledger';
  return 'diagrams';
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
  return <aside className="about" aria-label="About this work">
    {issues.length > 0 && <Notice tone={issues.some(issue => issue.level === 'error') ? 'error' : 'warning'}>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</Notice>}
    {hasStatus && progress && <AboutSection title={progress.steps ? 'Progress' : 'Status'} note={progress.updated && <span title={absoluteDate(progress.updated)}>{relativeDate(progress.updated)}</span>}>
      {progress.blocked && <Notice tone="error" className="about-blocked" title="Blocked">{progress.blocked}</Notice>}
      {progress.steps ? <LedgerSteps steps={progress.steps} /> : <>
        {progress.current && <p className="about-current">{progress.current}</p>}
        {progress.next.length > 0 && <><Text as="h3" variant="caption" className="about-subheading">Next</Text><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
      </>}
    </AboutSection>}
    <AboutSection title="About">
      {dates.length > 0 && <dl className="facts">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={absoluteDate(value)}>{label === 'Updated' ? relativeDate(value) : shortDate(value)}</dd></div>)}</dl>}
      <p className="about-path" title={work.path}><bdi>{work.path}</bdi></p>
    </AboutSection>
    {statistics && (statistics.reports > 0 || statistics.planRevisions !== null) && <AboutSection title="Statistics" note={statistics.lastReport && <span title={absoluteDate(statistics.lastReport)}>reported {relativeDate(statistics.lastReport)}</span>}>
      <dl className="facts about-statistics">
        {statistics.primaryModel && <div><dt>Model</dt><dd><Code>{statistics.primaryModel}</Code>{statistics.models.length > 1 && <span className="muted" title={statistics.models.slice(1).map(model => model.model).join(', ')}> +{statistics.models.length - 1} more</span>}</dd></div>}
        {statistics.tokens !== null && <div><dt>Tokens</dt><dd title={statistics.tokens.toLocaleString() + ' tokens, self-reported'}>{compactNumber(statistics.tokens)}</dd></div>}
        {statistics.reports > 0 && <div><dt>Active time</dt><dd title="Time between reports in each session, self-reported">{duration(statistics.activeMs)}</dd></div>}
        {statistics.planRevisions !== null && <div><dt>Plan revisions</dt><dd title={work.completed ? 'Commits that changed the plan before completion' : 'Commits that changed the plan so far'}>{statistics.planRevisions}</dd></div>}
      </dl>
    </AboutSection>}
    {commits.length > 0 && <AboutSection title="Recent activity">
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><CommitIcon className="about-commit-icon" /><div><span className="commit-title">{entry.title}</span><span className="muted"><Code>{entry.id.slice(0, 7)}</Code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </AboutSection>}
  </aside>;
}

export function WorkPage({ work, snapshot, target }: { work: Work; snapshot: Snapshot; target: WorkTarget }) {
  const { retarget } = useWorkbench();
  const section = workSection(target, work);
  const { plan, ledger } = primaryDocuments(work);
  const status = workStatus(work);
  const note = designNote(work);
  const reading: Document | undefined = section === 'plan' ? plan : section === 'ledger' ? ledger : undefined;
  const references = useReferences(reading, work.id, section !== 'diagrams' && reading?.format === 'markdown');
  const sections: { id: WorkSection; label: string; icon: ReactNode; count?: number; hidden?: boolean }[] = [
    { id: 'plan', label: 'Plan', icon: <PlanIcon />, hidden: !plan },
    { id: 'ledger', label: 'Ledger', icon: <LedgerIcon />, hidden: !ledger },
    { id: 'diagrams', label: 'Diagrams', icon: <DiagramIcon />, count: work.diagrams ?? 0 },
  ];
  const body = section === 'diagrams' ? <AtlasWorkPanel key={work.id} work={work} snapshot={snapshot} target={target} />
    : <div className="work-layout">
      <div className="work-main">
        {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} />
          : <EmptyState className="page-empty" title="Nothing to read here" description="This work item has no plan or ledger." />}
      </div>
      <About work={work} snapshot={snapshot} />
    </div>;
  return <div className={'work-page section-' + section}>
    <header className="work-page-head">
      <Trail items={[{ label: 'Work', target: viewTarget('work') }, { label: workNumber(work.id) }]} />
      <div className="work-header">
        <Text as="h1" variant="page-heading">{work.title}</Text>
        <div className="work-header-meta">
          <StatusBadge status={status} />
          {work.location === 'archived' && <Badge tone="warning">Archived</Badge>}
          {note && <Badge>{note}</Badge>}
          {work.repositories.map(id => <RepositoryBadge key={id} id={id} />)}
        </div>
      </div>
    </header>
    <Tabs className="work-sections" aria-label="Work sections" value={section} activation="manual"
      onValueChange={value => { if (value) retarget(workTarget(work.id, value as WorkSection, value === 'diagrams' ? { diagram: target.diagram ?? null } : {})); }}
      items={sections.filter(item => !item.hidden).map(item => ({
        value: item.id,
        button: <Button variant="secondary" startIcon={item.icon}>{item.label}{item.count ? <> <Counter value={item.count} /></> : null}</Button>,
        content: item.id === section ? body : null,
      }))} />
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
