import type { ReactNode } from 'react';
import { AlertIcon, BookIcon, GitCommitIcon, TasklistIcon, WorkflowIcon } from './icons';
import type { Document, Snapshot, Target, Work, WorkSection } from './types';
import { defaultDocument, primaryDocuments } from './work';
import { viewTarget, workTarget } from './targets';
import { absoluteDate, relativeDate, shortDate, workNumber } from './format';
import { designNote, workStatus } from './status';
import { Blankslate, Counter, Label, StateLabel } from './ui';
import { Reader, useReferences } from './Reader';
import { AtlasWorkPanel } from './AtlasWorkPanel';
import { TargetLink, useWorkbench } from './workbenchContext';

type WorkTarget = Extract<Target, { kind: 'work' }>;

export function Breadcrumb({ items }: { items: { label: ReactNode; target?: Target }[] }) {
  return <nav className="breadcrumb" aria-label="Breadcrumb"><ol>{items.map((item, index) => <li key={index}>{item.target ? <TargetLink target={item.target}>{item.label}</TargetLink> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>;
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

function About({ work, snapshot }: { work: Work; snapshot: Snapshot }) {
  const issues = snapshot.issues.filter(issue => issue.workId === work.id);
  const progress = work.progress;
  const hasStatus = Boolean(progress && (progress.current || progress.next.length || progress.blocked));
  const dates = ([['Created', work.created], ['Accepted', work.accepted], ['Completed', work.completed], ['Updated', work.updated]] as const).filter(([, value]) => value);
  const commits = snapshot.history.filter(entry => entry.workIds.includes(work.id)).slice(0, 5);
  return <aside className="about" aria-label="About this work">
    {issues.length > 0 && <div className={'flash ' + (issues.some(issue => issue.level === 'error') ? 'flash-danger' : 'flash-warning')}><AlertIcon size={16} /><div>{issues.map((issue, index) => <p key={index}>{issue.message}</p>)}</div></div>}
    {hasStatus && progress && <section className="about-section">
      <h2>Status{progress.updated && <span className="muted" title={absoluteDate(progress.updated)}> · {relativeDate(progress.updated)}</span>}</h2>
      {progress.blocked && <p className="about-blocked"><strong>Blocked:</strong> {progress.blocked}</p>}
      {progress.current && <p className="about-current">{progress.current}</p>}
      {progress.next.length > 0 && <><h3>Next</h3><ul className="about-next">{progress.next.map((step, index) => <li key={index}>{step}</li>)}</ul></>}
    </section>}
    <section className="about-section">
      <h2>About</h2>
      {dates.length > 0 && <dl className="about-dates">{dates.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={absoluteDate(value)}>{label === 'Updated' ? relativeDate(value) : shortDate(value)}</dd></div>)}</dl>}
      <p className="about-path muted" title={work.path}>{work.path}</p>
    </section>
    {commits.length > 0 && <section className="about-section">
      <h2>Recent activity</h2>
      <ul className="about-commits">{commits.map(entry => <li key={entry.id}><GitCommitIcon size={16} /><div><span className="commit-title">{entry.title}</span><span className="muted"><code>{entry.id.slice(0, 7)}</code> · <span title={absoluteDate(entry.date)}>{relativeDate(entry.date)}</span></span></div></li>)}</ul>
    </section>}
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
    { id: 'plan', label: 'Plan', icon: <TasklistIcon size={16} />, hidden: !plan },
    { id: 'ledger', label: 'Ledger', icon: <BookIcon size={16} />, hidden: !ledger },
    { id: 'diagrams', label: 'Diagrams', icon: <WorkflowIcon size={16} />, count: work.diagrams ?? 0 },
  ];
  return <div className={'work-page tab-' + section}>
    <div className="work-page-head">
      <Breadcrumb items={[{ label: 'Work', target: viewTarget('work') }, { label: workNumber(work.id) }]} />
      <header className="work-header">
        <h1>{work.title}</h1>
        <div className="work-header-meta">
          <StateLabel status={status} />
          {work.location === 'archived' && <Label tone="attention">Archived</Label>}
          {note && <Label>{note}</Label>}
          {work.repositories.map(id => <Label key={id} tone="muted">{id}</Label>)}
        </div>
      </header>
      <nav className="underline-nav" aria-label="Work sections">
        {sections.filter(item => !item.hidden).map(item => <a key={item.id} href="#" className={section === item.id ? 'selected' : ''} aria-current={section === item.id ? 'page' : undefined}
          onClick={event => { event.preventDefault(); retarget(workTarget(work.id, item.id, item.id === 'diagrams' ? { diagram: target.diagram ?? null } : {})); }}>
          {item.icon}<span>{item.label}</span>{item.count !== undefined && item.count > 0 && <Counter>{item.count}</Counter>}
        </a>)}
      </nav>
    </div>
    {section === 'diagrams' ? <AtlasWorkPanel key={work.id} work={work} snapshot={snapshot} target={target} />
      : <div className="work-layout">
        <div className="work-main">
          {reading ? <Reader key={reading.path} file={reading} snapshot={snapshot} anchor={target.anchor ?? null} references={references} hideTitle={work.title} />
            : <div className="box"><Blankslate title="Nothing to read here">This work item has no plan or ledger.</Blankslate></div>}
        </div>
        <About work={work} snapshot={snapshot} />
      </div>}
  </div>;
}

export function FileView({ file, snapshot, anchor }: { file: Document; snapshot: Snapshot; anchor: string | null }) {
  const owner = snapshot.work.find(work => work.id === file.workId);
  const references = useReferences(file, file.workId, file.format === 'markdown' && (Boolean(file.workId) || file.category === 'knowledge'));
  return <div className="page file-page">
    <Breadcrumb items={[...(owner ? [{ label: workNumber(owner.id) + ' ' + owner.title, target: workTarget(owner.id) }] : []), { label: file.path }]} />
    <Reader key={file.path} file={file} snapshot={snapshot} anchor={anchor} toolbar references={references} showWork={!file.workId} />
  </div>;
}
