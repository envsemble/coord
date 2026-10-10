import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, UiState, WindowInfo } from './types';
import { defaultUiState } from '../shared/contract';
import { api } from './api';
import { Blankslate, Spinner } from './ui';
import { FolderProblem, Welcome } from './Welcome';
import { Workbench } from './Workbench';

/**
 * One window shows one planning folder. The folder is read in the main process; this component
 * follows its state (loading, ready, unreadable, missing) and refetches the snapshot when the
 * folder changes on disk.
 */
export default function App() {
  const [info, setInfo] = useState<WindowInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [failure, setFailure] = useState('');
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

  if (!info) return failure ? <main className="page-state"><Blankslate title="Atlas could not start this window">{failure}</Blankslate></main> : <main className="page-state"><Spinner size={24} /></main>;
  if (!info.folder) return <Welcome info={info} />;
  if (info.status === 'missing' || (info.status === 'invalid' && !snapshot)) return <FolderProblem info={info} />;
  if (!snapshot || !ui) return <main className="page-state" aria-busy="true"><Spinner size={24} /><span className="muted">Reading {info.folder.name}…</span></main>;
  return <Workbench info={info} snapshot={snapshot} initialUi={ui} />;
}
