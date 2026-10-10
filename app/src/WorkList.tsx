import type { ReactNode } from 'react';
import { IssueOpenedIcon, SearchIcon, WorkflowIcon, XIcon } from './icons';
import type { Snapshot, Work } from './types';
import { designNote, workStatus } from './status';
import { absoluteDate, relativeDate, workNumber } from './format';
import { navigate, routeHref } from './routes';
import { Blankslate, Label, StatusIcon } from './ui';

export function SearchInput({ value, onChange, label }: { value: string; onChange(value: string): void; label: string }) {
  return <div className="search-box"><SearchIcon size={16} /><input value={value} onChange={event => onChange(event.target.value)} placeholder={label} aria-label={label} />{value && <button type="button" aria-label="Clear search" onClick={() => onChange('')}><XIcon size={16} /></button>}</div>;
}

function WorkRow({ work }: { work: Work }) {
  const status = workStatus(work);
  const note = designNote(work);
  const updated = work.progress?.updated ?? work.updated;
  const href = routeHref({ view: 'work', work: work.id });
  return <li className="work-row">
    <StatusIcon status={status} />
    <div className="work-row-main">
      <div className="work-row-title">
        <a href={href} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigate({ view: 'work', work: work.id }); } }}>{work.title}</a>
        {work.repositories.map(id => <Label key={id} tone="muted">{id}</Label>)}
      </div>
      <div className="work-row-meta">
        <span>{workNumber(work.id)}</span>
        <span className={'status-text status-' + status.tone}>{status.label}</span>
        {note && <span>{note}</span>}
        {work.location === 'archived' && <span>Archived</span>}
        {status.key === 'blocked' && work.progress?.blocked && <span className="blocked-reason" title={work.progress.blocked}>{work.progress.blocked}</span>}
      </div>
      {work.progress?.current && status.key !== 'complete' && <p className="work-row-focus">{work.progress.current}</p>}
    </div>
    <div className="work-row-side">
      {!!work.diagrams && <a className="diagram-count" href={routeHref({ view: 'work', work: work.id, tab: 'diagrams' })} title={work.diagrams + (work.diagrams === 1 ? ' diagram' : ' diagrams')} aria-label={work.diagrams + (work.diagrams === 1 ? ' diagram' : ' diagrams')}><WorkflowIcon size={16} />{work.diagrams}</a>}
      {updated && <span className="muted" title={'Updated ' + absoluteDate(updated)}>{relativeDate(updated)}</span>}
    </div>
  </li>;
}

export function WorkList({ snapshot, repository, location, setLocation, search, setSearch, repositoryMenu }: {
  snapshot: Snapshot; repository: string; location: string; setLocation(value: string): void; search: string; setSearch(value: string): void; repositoryMenu: ReactNode;
}) {
  const work = snapshot.work.filter(item => repository === 'all' || item.repositories.includes(repository));
  const term = search.toLowerCase();
  const matches = (item: Work) => [item.title, item.id, workNumber(item.id), ...item.repositories, item.progress?.current ?? ''].join(' ').toLowerCase().includes(term);
  const counts = { active: work.filter(item => item.location === 'active').length, archived: work.filter(item => item.location === 'archived').length, all: work.length };
  const visible = work.filter(item => (location === 'all' || item.location === location) && matches(item)).sort((a, b) => b.id.localeCompare(a.id));
  return <>
    <h1 className="page-heading">Work</h1>
    <div className="toolbar">
      <div className="segmented" role="group" aria-label="Work location">{(['active', 'archived', 'all'] as const).map(value => <button key={value} type="button" className={location === value ? 'active' : ''} aria-pressed={location === value} onClick={() => setLocation(value)}>{value === 'active' ? 'Active' : value === 'archived' ? 'Archived' : 'All'}<span className="counter-label">{counts[value]}</span></button>)}</div>
      <SearchInput value={search} onChange={setSearch} label="Search work" />
      {repositoryMenu}
    </div>
    {visible.length ? <ul className="box work-list">{visible.map(item => <WorkRow key={item.id} work={item} />)}</ul>
      : <div className="box"><Blankslate icon={<IssueOpenedIcon size={24} />} title={search ? 'No matching work' : location === 'archived' ? 'No archived work' : 'No work here yet'} /></div>}
  </>;
}
