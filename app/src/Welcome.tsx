import { useState } from 'react';
import { Button, EmptyState, Kbd, Notice, Surface, Text, useToast } from '@envsemble/envui';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { DevicesIcon, ErrorIcon, FolderIcon } from './icons';
import type { WindowInfo } from './types';
import { api, AtlasError } from './api';
import type { AppCommand } from '../shared/contract';
import { FolderRows, openFolderOn, useAppActions, useComputerFolders } from './Computers';

/** A window without a folder: one computer's folder list (this one, or a paired one chosen in the title bar), and a way to open another folder there. */
export function Welcome({ info }: { info: WindowInfo }) {
  const computer = info.computer;
  const { folders, error: listError } = useComputerFolders(computer.hostId);
  const [error, setError] = useState('');
  const actions = useAppActions();
  const here = computer.hostId === null;
  return <main className="welcome">
    <div className="welcome-panel">
      <header className="welcome-brand">
        <AtlasMark size={48} label="" />
        <div><Text as="h1" variant="display" className="welcome-title">Atlas</Text><Text tone="muted">Plans, models and shared understanding.</Text></div>
      </header>
      <section className="welcome-start" aria-label="Start">
        <div className="row-actions">
          <Button variant="primary" startIcon={<FolderIcon />} onClick={() => openFolderOn(computer, actions, setError)}>Open Folder…</Button>
          <Button variant="secondary" startIcon={<DevicesIcon />} onClick={actions.connect}>Connect to Another Atlas…</Button>
        </div>
        <Text variant="supporting" tone="muted">
          Open a planning folder{here ? '' : ' on ' + computer.name}: one with a <code>planning.json</code> registry.{here && <> <Kbd keys={[info.platform === 'darwin' ? '⌘' : 'Ctrl', 'O']} /></>}
        </Text>
      </section>
      <section className="welcome-folders" aria-label="Planning folders">
        <Text as="h2" variant="section-heading">{here ? 'Recent' : 'Planning folders on ' + computer.name}</Text>
        {folders === null ? null : folders.length ? <FolderRows computer={computer} folders={folders} onError={setError} />
          : <Text tone="muted">{listError || (here ? 'No recent folders.' : 'No planning folders on ' + computer.name + ' yet. Open one to start.')}</Text>}
      </section>
      {error && <Notice tone="warning" announce onDismiss={() => setError('')}>{error}</Notice>}
      <Text variant="caption" tone="muted" className="welcome-version">Atlas {info.version} · works offline; nothing leaves this computer unless you turn on remote access.</Text>
    </div>
  </main>;
}

/** A folder that moved, was deleted, or cannot be read at all. */
export function FolderProblem({ info }: { info: WindowInfo }) {
  const toast = useToast();
  const run = (command: AppCommand) => () => {
    api.command(command).catch(error => { if ((error as AtlasError).code !== 'cancelled') toast.show({ message: (error as Error).message, variant: 'error' }); });
  };
  // Back to the start page of the folder's computer, or close the window.
  const close = <>
    <Button variant="secondary" onClick={run('closeFolder')}>Close Folder</Button>
    <Button variant="secondary" onClick={run('closeWindow')}>Close</Button>
  </>;
  if (info.remote) return <main className="folder-problem">
    <Surface className="folder-problem-panel" padding={6}>
      <EmptyState icon={<ErrorIcon />} headingLevel={1} title={`This planning folder on ${info.remote.hostName} can’t be opened`} action={<div className="row-actions">{close}</div>}
        description={<>{info.error && <span className="folder-problem-error">{info.error}</span>}<span>Atlas reconnects on its own while this computer is paired with {info.remote.hostName}.</span></>} />
    </Surface>
  </main>;
  const missing = info.status === 'missing';
  return <main className="folder-problem">
    <Surface className="folder-problem-panel" padding={6}>
      <EmptyState icon={<ErrorIcon />} headingLevel={1} title={missing ? 'This planning folder was moved or deleted' : 'This planning folder can’t be read'}
        action={<div className="row-actions"><Button variant="primary" onClick={run('locate')}>Locate…</Button>{close}</div>}
        description={<>
          <span className="folder-problem-path"><bdi>{info.folder?.root}</bdi></span>
          {!missing && info.error && <span className="folder-problem-error">{info.error}</span>}
          <span>{missing ? 'Atlas reopens it if it comes back. Choose its new location to keep this window’s tabs.' : 'Atlas reloads it as soon as it can be read again.'}</span>
        </>} />
    </Surface>
  </main>;
}
