import { useEffect, useState } from 'react';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { AlertIcon, FileDirectoryIcon } from './icons';
import type { RecentFolder, WindowInfo } from './types';
import { api } from './api';
import { Blankslate, Label } from './ui';

const shortcut = (platform: string, key: string) => (platform === 'darwin' ? '⌘' : 'Ctrl+') + key;

/** A window without a folder: open one, or pick a recent one. */
export function Welcome({ info }: { info: WindowInfo }) {
  const [recents, setRecents] = useState<RecentFolder[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.recents().then(setRecents).catch(() => setRecents([])); }, []);
  const run = (promise: Promise<unknown>) => { setError(''); promise.catch(failure => setError((failure as Error).message)); };
  return <main className="welcome">
    <div className="welcome-panel">
      <div className="welcome-brand"><AtlasMark size={40} label="" /><div><h1>Atlas</h1><p className="muted">Plans, models and shared understanding.</p></div></div>
      <section>
        <h2>Start</h2>
        <button type="button" className="btn btn-primary" onClick={() => run(api.command('openFolder'))}><FileDirectoryIcon size={16} />Open Folder…</button>
        <p className="muted welcome-hint">Open a planning folder: one with a <code>planning.json</code> registry. Each folder opens in its own window. <kbd>{shortcut(info.platform, 'O')}</kbd></p>
      </section>
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
      <p className="muted welcome-version">Atlas {info.version} · works offline; nothing leaves this computer.</p>
    </div>
  </main>;
}

/** A folder that moved, was deleted, or cannot be read at all. */
export function FolderProblem({ info }: { info: WindowInfo }) {
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
