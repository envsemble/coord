import { useEffect, useState, type FormEvent } from 'react';
import { AlertIcon, BookIcon, CheckIcon, FileDirectoryIcon, GraphIcon, IssueOpenedIcon, PulseIcon, SyncIcon, TriangleDownIcon } from './icons';
import type { Issue, PlanningRootInfo, PlanningRoots, Snapshot } from './types';
import { Dropdown, Spinner } from './ui';
import { navigate, type Route } from './routes';
import { absoluteDate, relativeDate, workNumber } from './format';
import worktrailIcon from '../../assets/worktrail-icon.svg';

export const navigation = [
  { id: 'work', label: 'Work', icon: <IssueOpenedIcon size={16} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookIcon size={16} /> },
  { id: 'records', label: 'Files', icon: <FileDirectoryIcon size={16} /> },
  { id: 'history', label: 'Activity', icon: <PulseIcon size={16} /> },
  { id: 'insights', label: 'Statistics', icon: <GraphIcon size={16} /> },
];

function folderParts(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return { name: parts.at(-1) ?? path, parent: parts.at(-2) ?? '' };
}

function RootOption({ root, current, onOpen }: { root: PlanningRootInfo; current?: boolean; onOpen?(path: string): void }) {
  const content = <>
    <span className="menu-check">{current && <CheckIcon size={16} />}</span>
    <span className="menu-text">
      <span className="menu-item-heading"><strong>{root.name}</strong>{root.workItems !== null && <span className="muted">{root.workItems} work {root.workItems === 1 ? 'item' : 'items'}</span>}</span>
      <span className="menu-description path" title={root.path}>{root.parent}</span>
    </span>
  </>;
  return current ? <div className="menu-item menu-item-rich is-current" aria-current="true" title={root.path}>{content}</div>
    : <button type="button" role="menuitem" className="menu-item menu-item-rich" title={root.path} onClick={() => onOpen?.(root.path)}>{content}</button>;
}

function FolderMenu({ roots, onOpen, busy, error }: { roots: PlanningRoots | null; onOpen(path: string): void; busy: boolean; error: string }) {
  const [path, setPath] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); if (path.trim()) onOpen(path.trim()); };
  return <div className="action-menu folder-menu" role="menu">
    {!roots ? <div className="menu-loading"><Spinner /> Finding planning folders…</div> : <>
      <div className="menu-title">Current</div>
      <RootOption root={roots.current} current />
      {roots.current.error && <div className="menu-error">{roots.current.error}</div>}
      {roots.recent.length > 0 && <><div className="menu-title">Recent</div>{roots.recent.map(root => <RootOption key={root.path} root={root} onOpen={onOpen} />)}</>}
      {roots.discovered.length > 0 && <><div className="menu-title">Nearby</div>{roots.discovered.map(root => <RootOption key={root.path} root={root} onOpen={onOpen} />)}</>}
    </>}
    <form className="folder-form" onSubmit={submit}>
      <label className="menu-title" htmlFor="planning-folder-path">Open folder…</label>
      <div className="folder-form-row">
        <input id="planning-folder-path" className="input" placeholder="Full path to a planning folder" value={path} onChange={event => setPath(event.target.value)} spellCheck={false} autoComplete="off" />
        <button type="submit" className="btn btn-primary" disabled={busy || !path.trim()}>{busy ? <Spinner /> : 'Open'}</button>
      </div>
      {error && <div className="menu-error" role="alert">{error}</div>}
    </form>
  </div>;
}

function FolderSwitcher({ root, onSwitched }: { root: string; onSwitched(): void }) {
  const [roots, setRoots] = useState<PlanningRoots | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => fetch('/api/planning-roots').then(response => response.json()).then((next: PlanningRoots) => setRoots(next)).catch(() => undefined);
  useEffect(() => { void load(); }, [root]);
  const shown = root || roots?.current.path || '';
  const { name, parent } = folderParts(shown);
  async function open(path: string, close: () => void) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/planning-root', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'This folder could not be opened.');
      close(); onSwitched();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Dropdown label="Planning folder" className="folder-switcher" buttonClassName="folder-button" title={shown} onOpenChange={next => { setError(''); if (next) void load(); }} button={<>
    <FileDirectoryIcon size={16} />
    <span className="folder-text nav-label"><strong>{name || 'Planning folder'}</strong>{parent && <span>{parent}</span>}</span>
    <TriangleDownIcon size={16} className="folder-caret nav-label" />
  </>}>
    {close => <FolderMenu roots={roots} busy={busy} error={error} onOpen={path => void open(path, close)} />}
  </Dropdown>;
}

function Health({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const errors = issues.some(issue => issue.level === 'error');
  const label = issues.length + ' record health ' + (issues.length === 1 ? 'note' : 'notes');
  return <Dropdown label="Record health" className="health" buttonClassName={'health-button' + (errors ? ' has-errors' : '')} title={label} button={<><AlertIcon size={16} /><span className="nav-label">{issues.length} {issues.length === 1 ? 'note' : 'notes'}</span></>}>
    {close => <div className="action-menu health-menu">
      <div className="menu-title">Record health</div>
      <ul>{issues.map((issue, index) => <li key={index} className={issue.level}>
        <AlertIcon size={16} />
        <span>{issue.workId && <><button type="button" className="link-button" onClick={() => { close(); navigate({ view: 'work', work: issue.workId }); }}>{workNumber(issue.workId)}</button>{' '}</>}{issue.message}</span>
      </li>)}</ul>
    </div>}
  </Dropdown>;
}

export function Sidebar({ snapshot, route, refreshing, loadedAt, onRefresh, onSwitched, onNavigate }: {
  snapshot: Snapshot | null; route: Route; refreshing: boolean; loadedAt: string | null; onRefresh(): void; onSwitched(): void; onNavigate(view: string): void;
}) {
  const [, tick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => tick(value => value + 1), 15000); return () => clearInterval(timer); }, []);
  const active = snapshot?.work.filter(work => work.location === 'active').length;
  const updated = loadedAt ? relativeDate(loadedAt) : '';
  return <aside className="app-sidebar">
    <a className="brand" href="#view=work" aria-label="Worktrail"><img src={worktrailIcon} alt="" width={24} height={24} /><strong className="nav-label">Worktrail</strong></a>
    <div className="sidebar-folder">
      <FolderSwitcher root={snapshot?.root ?? ''} onSwitched={onSwitched} />
      <Health issues={snapshot?.issues ?? []} />
    </div>
    <nav className="workspace-nav" aria-label="Workspace">
      {navigation.map(item => <button key={item.id} type="button" className={route.view === item.id ? 'active' : ''} aria-label={item.label} aria-current={route.view === item.id ? 'page' : undefined} title={item.label} onClick={() => onNavigate(item.id)}>
        {item.icon}<span className="nav-label">{item.label}</span>{item.id === 'work' && active !== undefined && <span className="counter-label nav-count">{active}</span>}
      </button>)}
    </nav>
    <div className="sidebar-footer">
      <button type="button" className="refresh-button" onClick={onRefresh} title={(loadedAt ? 'Updated ' + absoluteDate(loadedAt) + '. ' : '') + 'Refreshes every 20 seconds; click to refresh now.'} aria-label="Refresh records">
        <SyncIcon size={16} className={refreshing ? 'spinning' : ''} /><span className="nav-label">{refreshing ? 'Refreshing…' : updated ? 'Updated ' + updated : 'Refresh'}</span>
      </button>
    </div>
  </aside>;
}
