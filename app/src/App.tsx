import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LoadedUi, WindowInfo } from './types';
import { defaultUiState } from '../shared/contract';
import { api } from './api';
import { EmptyState, Spinner, TitleBar, useToast, WindowFrame } from '@envsemble/envui';
import { AtlasMark } from '@envsemble/atlas-diagrams/mark';
import { ErrorIcon } from './ui/icons';
import { AtlasWindow } from './window/Window';
import { ConnectDialog } from './computers/ConnectDialog';
import { RemoteAccessDialog } from './computers/RemoteAccessDialog';
import { ComputersDialog } from './computers/ComputerMenu';
import { AppActionsContext, type AppActions } from './appActions';
import { AboutDialog } from './titleBar/AboutDialog';

type OpenDialog = { kind: 'connect' } | { kind: 'access' } | { kind: 'computers' } | { kind: 'about' } | null;

/**
 * One window shows the projects of one computer, this one or another one. Main reads them; this
 * component waits for the window's facts and its saved layout, then shows the window (AtlasWindow),
 * and draws the dialogs every window has: pairing, remote access, the computers and About.
 */
export default function App() {
  const [info, setInfo] = useState<WindowInfo | null>(null);
  const [ui, setUi] = useState<LoadedUi | null>(null);
  const [failure, setFailure] = useState('');
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const toast = useToast();
  const warn = useCallback((message: string) => { toast.show({ message, variant: 'info' }); }, [toast]);
  const actions = useMemo<AppActions>(() => ({
    connect: () => setDialog({ kind: 'connect' }),
    remoteAccess: () => setDialog({ kind: 'access' }),
    manageComputers: () => setDialog({ kind: 'computers' }),
    about: () => setDialog({ kind: 'about' }),
  }), []);
  useEffect(() => api.onMenu(command => {
    if (command === 'about') actions.about();
  }), [actions]);

  useEffect(() => {
    api.info().then(setInfo, error => setFailure((error as Error).message));
    api.loadUi().then(setUi, () => setUi(defaultUiState));
  }, []);
  useEffect(() => { document.title = info && info.computer.hostId !== null ? info.computer.name + ' — Atlas' : 'Atlas'; }, [info]);

  const close = () => setDialog(null);
  const computer = info?.computer ?? null;
  const dialogs = <>
    {dialog?.kind === 'connect' && <ConnectDialog onClose={close} />}
    {dialog?.kind === 'access' && computer && <RemoteAccessDialog onClose={close} computer={computer} />}
    {dialog?.kind === 'computers' && computer && <ComputersDialog current={computer} onClose={close} />}
    {dialog?.kind === 'about' && <AboutDialog onClose={close} onError={warn} />}
  </>;
  const content = info && ui ? <AtlasWindow info={info} initialUi={ui} />
    : <WindowFrame titleBar={<TitleBar className="window-title-bar" start={<span className="title-bar-brand"><AtlasMark size={20} label="" /></span>} />}>
      {failure ? <main className="page-state"><EmptyState icon={<ErrorIcon />} headingLevel={1} title="Atlas could not start this window" description={failure} /></main>
        : <main className="page-state"><Spinner size="large" label="Starting Atlas" /></main>}
    </WindowFrame>;
  return <AppActionsContext.Provider value={actions}>{content}{dialogs}</AppActionsContext.Provider>;
}
