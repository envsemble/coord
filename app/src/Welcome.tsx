import { useEffect, useState } from 'react';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { AlertIcon, DeviceDesktopIcon, FileDirectoryIcon, XIcon } from './icons';
import type { RecentFolder, RemoteHost, SharedFolder, WindowInfo } from './types';
import { api } from './api';
import { Blankslate, Label } from './ui';

const shortcut = (platform: string, key: string) => (platform === 'darwin' ? '⌘' : 'Ctrl+') + key;

/** A window without a folder: open one, pick a recent one, or open a folder another computer shares. */
export function Welcome({ info, onConnect }: { info: WindowInfo; onConnect(): void }) {
  const [recents, setRecents] = useState<RecentFolder[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.recents().then(setRecents).catch(() => setRecents([])); }, []);
  const run = (promise: Promise<unknown>) => { setError(''); promise.catch(failure => setError((failure as Error).message)); };
  return <main className="welcome">
    <div className="welcome-panel">
      <div className="welcome-brand"><AtlasMark size={40} label="" /><div><h1>Atlas</h1><p className="muted">Plans, models and shared understanding.</p></div></div>
      <section>
        <h2>Start</h2>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={() => run(api.command('openFolder'))}><FileDirectoryIcon size={16} />Open Folder…</button>
          <button type="button" className="btn" onClick={onConnect}><DeviceDesktopIcon size={16} />Connect to Another Atlas…</button>
        </div>
        <p className="muted welcome-hint">Open a planning folder: one with a <code>planning.json</code> registry. Each folder opens in its own window. <kbd>{shortcut(info.platform, 'O')}</kbd></p>
      </section>
      <OtherComputers onError={setError} />
      <section aria-label="Recent folders">
        <h2>Recent</h2>
        {recents === null ? null : recents.length ? <ul className="recent-list">{recents.map(item => <li key={item.path}>
          <button type="button" className="recent-item" disabled={!item.available} title={item.path} onClick={() => run(api.command('openRecent', item.path))}>
            <strong>{item.name}</strong><span className="muted recent-path">{item.parent}</span>
            {item.available ? item.workItems !== null && <span className="muted">{item.workItems} work {item.workItems === 1 ? 'item' : 'items'}</span> : <Label tone="attention">Missing</Label>}
          </button>
        </li>)}</ul> : <p className="muted">No recent folders.</p>}
      </section>
      {error && <div className="flash flash-warning"><AlertIcon size={16} />{error}</div>}
      <p className="muted welcome-version">Atlas {info.version} · works offline; nothing leaves this computer unless you turn on remote access.</p>
    </div>
  </main>;
}

/** Computers this one paired with, and the planning folders they share (read-only here). */
function OtherComputers({ onError }: { onError(message: string): void }) {
  const [hosts, setHosts] = useState<RemoteHost[] | null>(null);
  const [folders, setFolders] = useState<Record<string, SharedFolder[] | string>>({});
  const load = () => api.remoteHosts().then(list => {
    setHosts(list);
    for (const host of list) api.remoteFolders(host.hostId).then(items => setFolders(current => ({ ...current, [host.hostId]: items })), failure => setFolders(current => ({ ...current, [host.hostId]: (failure as Error).message })));
  }).catch(() => setHosts([]));
  useEffect(() => { void load(); }, []);
  if (!hosts?.length) return null;
  const forget = (host: RemoteHost) => { api.forgetRemote(host.hostId).then(() => load(), failure => onError((failure as Error).message)); };
  return <section aria-label="Other computers">
    <h2>Other computers</h2>
    <ul className="recent-list">{hosts.map(host => {
      const shared = folders[host.hostId];
      return <li key={host.hostId} className="remote-host">
        <div className="remote-host-head"><DeviceDesktopIcon size={16} /><strong>{host.name}</strong><span className="muted recent-path">{host.origin.replace(/^https?:\/\//, '')}</span>
          <button type="button" className="btn-octicon" aria-label={'Forget ' + host.name} title="Forget this computer" onClick={() => forget(host)}><XIcon size={16} /></button></div>
        {shared === undefined ? <p className="muted remote-host-note">Connecting…</p>
          : typeof shared === 'string' ? <p className="muted remote-host-note">{shared}</p>
          : shared.length ? <ul className="remote-folders">{shared.map(folder => <li key={folder.folderId}>
            <button type="button" className="recent-item" onClick={() => { api.openRemote(host.hostId, folder.folderId).catch(failure => onError((failure as Error).message)); }}><strong>{folder.name}</strong><Label tone="muted">Read-only</Label></button>
          </li>)}</ul> : <p className="muted remote-host-note">Shares no planning folders.</p>}
      </li>;
    })}</ul>
  </section>;
}

/** A folder that moved, was deleted, or cannot be read at all. */
export function FolderProblem({ info }: { info: WindowInfo }) {
  if (info.remote) return <main className="folder-problem">
    <div className="box">
      <Blankslate icon={<AlertIcon size={24} />} title={`This planning folder on ${info.remote.hostName} can’t be opened`} action={<div className="folder-problem-actions">
        <button type="button" className="btn" onClick={() => void api.command('closeWindow')}>Close</button>
      </div>}>
        {info.error && <span className="folder-problem-error">{info.error}</span>}
        <span>Atlas reconnects on its own while {info.remote.hostName} is paired and shares the folder.</span>
      </Blankslate>
    </div>
  </main>;
  const missing = info.status === 'missing';
  return <main className="folder-problem">
    <div className="box">
      <Blankslate icon={<AlertIcon size={24} />} title={missing ? 'This planning folder was moved or deleted' : 'This planning folder can’t be read'} action={<div className="folder-problem-actions">
        <button type="button" className="btn btn-primary" onClick={() => void api.command('locate')}>Locate…</button>
        <button type="button" className="btn" onClick={() => void api.command('closeWindow')}>Close</button>
      </div>}>
        <span className="folder-problem-path">{info.folder?.root}</span>
        {!missing && info.error && <span className="folder-problem-error">{info.error}</span>}
        <span>{missing ? 'Atlas reopens it if it comes back. Choose its new location to keep this window’s tabs.' : 'Atlas reloads it as soon as it can be read again.'}</span>
      </Blankslate>
    </div>
  </main>;
}
