import { useState } from 'react';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { AlertIcon, DeviceDesktopIcon, FileDirectoryIcon, XIcon } from './icons';
import type { WindowInfo } from './types';
import { api } from './api';
import { ComputerMenu, FolderList, openFolderOn, useAppActions, useComputerFolders } from './Computers';
import { Blankslate } from './ui';

const shortcut = (platform: string, key: string) => (platform === 'darwin' ? '⌘' : 'Ctrl+') + key;

/** A window without a folder: one computer's folder list (this one, or a paired one chosen at the top), and a way to open another folder there. */
export function Welcome({ info }: { info: WindowInfo }) {
  const computer = info.computer;
  const { folders, error: listError } = useComputerFolders(computer.hostId);
  const [error, setError] = useState('');
  const actions = useAppActions();
  const here = computer.hostId === null;
  return <main className="welcome">
    <div className="welcome-panel">
      <div className="welcome-brand"><AtlasMark size={40} label="" /><div><h1>Atlas</h1><p className="muted">Plans, models and shared understanding.</p></div></div>
      <div className="welcome-computer"><ComputerMenu current={computer} onError={setError} /></div>
      <section>
        <h2>Start</h2>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={() => openFolderOn(computer, actions, setError)}><FileDirectoryIcon size={16} />Open Folder…</button>
          <button type="button" className="btn" onClick={actions.connect}><DeviceDesktopIcon size={16} />Connect to Another Atlas…</button>
        </div>
        <p className="muted welcome-hint">
          Open a planning folder{here ? '' : ' on ' + computer.name}: one with a <code>planning.json</code> registry. Each folder opens in its own window.{here && <> <kbd>{shortcut(info.platform, 'O')}</kbd></>}
        </p>
      </section>
      <section aria-label="Planning folders">
        <h2>{here ? 'Recent' : 'Planning folders on ' + computer.name}</h2>
        {folders === null ? null : folders.length ? <FolderList computer={computer} folders={folders} onError={setError} />
          : <p className="muted">{listError || (here ? 'No recent folders.' : 'No planning folders on ' + computer.name + ' yet. Open one to start.')}</p>}
      </section>
      {error && <div className="flash flash-warning" role="alert"><AlertIcon size={16} /><span className="flash-text">{error}</span><button type="button" className="btn-octicon" aria-label="Dismiss" onClick={() => setError('')}><XIcon size={16} /></button></div>}
      <p className="muted welcome-version">Atlas {info.version} · works offline; nothing leaves this computer unless you turn on remote access.</p>
    </div>
  </main>;
}

/** A folder that moved, was deleted, or cannot be read at all. */
export function FolderProblem({ info }: { info: WindowInfo }) {
  if (info.remote) return <main className="folder-problem">
    <div className="box">
      <Blankslate icon={<AlertIcon size={24} />} title={`This planning folder on ${info.remote.hostName} can’t be opened`} action={<div className="folder-problem-actions">
        <button type="button" className="btn" onClick={() => void api.command('closeWindow')}>Close</button>
      </div>}>
        {info.error && <span className="folder-problem-error">{info.error}</span>}
        <span>Atlas reconnects on its own while this computer is paired with {info.remote.hostName}.</span>
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
