import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComputerFolder, ComputerRef, Snapshot, UiState, WindowInfo } from './types';
import { defaultUiState } from '../shared/contract';
import { api } from './api';
import { EmptyState, Spinner } from '@envsemble/envui';
import { ErrorIcon } from './icons';
import { FolderProblem, Welcome } from './Welcome';
import { Workbench } from './Workbench';
import { ConnectDialog } from './ConnectDialog';
import { RemoteAccessDialog } from './RemoteAccessDialog';
import { FolderBrowser } from './FolderBrowser';
import { AppActionsContext, ComputersDialog, FoldersDialog, type AppActions } from './Computers';

type OpenDialog = { kind: 'connect' } | { kind: 'access' } | { kind: 'computers' } | { kind: 'folders'; computer: ComputerRef; isCurrent?: (folder: ComputerFolder) => boolean }
  | { kind: 'browse'; computer: ComputerRef & { hostId: string }; near: string | null } | null;

/**
 * One window shows one planning folder, on this computer or another one. The folder is read in
 * the main process; this component follows its state (loading, ready, unreadable, missing) and
 * refetches the snapshot when the folder changes. Without a folder, the window shows a computer's
 * folder list.
 */
export default function App() {
  const [info, setInfo] = useState<WindowInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [failure, setFailure] = useState('');
  // Pairing, remote access and the folder browser work in every window.
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const computer = info?.computer ?? null;
  const actions = useMemo<AppActions>(() => ({
    connect: () => setDialog({ kind: 'connect' }),
    remoteAccess: () => setDialog({ kind: 'access' }),
    browse: (target, near = null) => { if (target.hostId !== null) setDialog({ kind: 'browse', computer: { hostId: target.hostId, name: target.name }, near }); },
    manageComputers: () => setDialog({ kind: 'computers' }),
    manageFolders: (target, isCurrent) => setDialog({ kind: 'folders', computer: target, isCurrent }),
  }), []);
  // File › Open Folder… in a window on another computer browses it, beside the folder the window shows.
  const near = snapshot && info?.folder ? snapshot.root : null;
  useEffect(() => api.onMenu(command => {
    if (command === 'connectRemote') actions.connect();
    else if (command === 'remoteAccess') actions.remoteAccess();
    else if (command === 'browseFolder' && computer) actions.browse(computer, near);
  }), [actions, computer, near]);
  const latest = useRef(0);

  const refresh = useCallback(async (revision: number) => {
    latest.current = Math.max(latest.current, revision);
    try {
      const next = await api.snapshot();
      if (revision >= latest.current) { setSnapshot(next); setFailure(''); }
    } catch (error) { if (revision >= latest.current) setFailure((error as Error).message); }
  }, []);

  useEffect(() => {
    // Subscribe before asking for the state, so no change can slip in between.
    const off = api.onChanged(change => {
      setInfo(current => current ? { ...current, status: change.status, error: change.error, notice: change.notice, revision: change.revision } : current);
      // The workbench closes while the folder is missing; it reopens with the tabs saved since.
      if (change.status === 'missing') setUi(null);
      if (change.status === 'ready') void refresh(change.revision);
    });
    void api.info().then(next => {
      setInfo(current => current && current.revision > next.revision ? current : next);
      if (next.folder && next.status === 'ready') void refresh(next.revision);
    }).catch(error => setFailure((error as Error).message));
    return off;
  }, [refresh]);

  const showsWorkbench = Boolean(info?.folder && snapshot && info.status !== 'missing');
  useEffect(() => {
    if (!showsWorkbench || ui) return;
    api.loadUi().then(setUi).catch(() => setUi(defaultUiState));
  }, [showsWorkbench, ui]);

  useEffect(() => {
    document.title = info?.folder ? info.folder.name + ' — Atlas' : 'Atlas';
  }, [info?.folder]);

  const close = () => setDialog(null);
  const dialogs = <>
    {dialog?.kind === 'connect' && <ConnectDialog onClose={close} onBrowse={target => setDialog({ kind: 'browse', computer: target, near: null })} />}
    {dialog?.kind === 'access' && computer && <RemoteAccessDialog onClose={close} computer={computer} />}
    {dialog?.kind === 'browse' && <FolderBrowser computer={dialog.computer} near={dialog.near} onClose={close} />}
    {dialog?.kind === 'computers' && computer && <ComputersDialog current={computer} onClose={close} />}
    {dialog?.kind === 'folders' && <FoldersDialog computer={dialog.computer} isCurrent={dialog.isCurrent} onClose={close} />}
  </>;
  let content;
  if (!info) content = failure ? <main className="page-state"><EmptyState icon={<ErrorIcon />} headingLevel={1} title="Atlas could not start this window" description={failure} /></main> : <main className="page-state"><Spinner size="large" label="Starting Atlas" /></main>;
  else if (!info.folder) content = <Welcome info={info} />;
  else if (info.status === 'missing' || (info.status === 'invalid' && !snapshot)) content = <FolderProblem info={info} />;
  else if (!snapshot || !ui) content = <main className="page-state" aria-busy="true"><Spinner size="large" label={'Reading ' + info.folder.name + (info.remote ? ' on ' + info.remote.hostName : '')} /><span className="page-state-label">Reading {info.folder.name}{info.remote ? ' on ' + info.remote.hostName : ''}…</span></main>;
  else content = <Workbench info={info} snapshot={snapshot} initialUi={ui} />;
  return <AppActionsContext.Provider value={actions}>{content}{dialogs}</AppActionsContext.Provider>;
}
