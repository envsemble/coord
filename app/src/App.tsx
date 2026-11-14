import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoadedUi, WindowInfo } from './types';
import { defaultUiState } from '../shared/contract';
import { api } from './api';
import { Scaffold, Spinner, TopBar, useToast } from '@envsemble/envui';
import { EmptyState } from './ui/EmptyState';
import { ErrorIcon } from './ui/icons';
import { AtlasWindow } from './window/Window';
import { AppActionsContext, type AppActions } from './appActions';
import { AboutDialog } from './titleBar/AboutDialog';
import { AtlasLogo } from './titleBar/TitleBar';
import { Onboarding } from './onboarding/Onboarding';

/**
 * One window shows the projects of one computer, this one or another one. Main reads them; this
 * component waits for the window's facts, its saved layout and whether the onboarding is done, then
 * shows the onboarding until it is finished, and the window (AtlasWindow) after it; and it
 * draws the dialog every window has: About.
 */
export default function App() {
  const [info, setInfo] = useState<WindowInfo | null>(null);
  const [ui, setUi] = useState<LoadedUi | null>(null);
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [failure, setFailure] = useState('');
  const [about, setAbout] = useState(false);
  const toast = useToast();
  const warn = useCallback((message: string) => { toast.show({ message, tone: 'info' }); }, [toast]);
  const actions = useMemo<AppActions>(() => ({ about: () => setAbout(true) }), []);
  useEffect(() => api.onMenu(command => {
    if (command === 'about') actions.about();
  }), [actions]);

  useEffect(() => {
    api.info().then(setInfo, error => setFailure((error as Error).message));
    api.loadUi().then(setUi, () => setUi(defaultUiState));
    // A window whose onboarding cannot be read shows itself: Settings › Agents connects the agents too.
    api.onboarding().then(state => setOnboarding(!state.done), () => setOnboarding(false));
  }, []);
  // Finished in another window, the onboarding gives way here too as this window comes forward.
  useEffect(() => {
    if (!onboarding) return;
    const again = () => { api.onboarding().then(state => { if (state.done) setOnboarding(false); }, () => undefined); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [onboarding]);
  useEffect(() => { document.title = info && info.computer.hostId !== null ? info.computer.name + ' — Atlas' : 'Atlas'; }, [info]);

  const bare = (body: ReactNode) => <Scaffold className="atlas-window" scroll="body" topBarSpan="full" topBar={<TopBar titleBar className="window-title-bar" start={<AtlasLogo />} />}>{body}</Scaffold>;
  const content = failure ? bare(<div className="page-state"><EmptyState icon={<ErrorIcon />} headingLevel={1} title="Atlas could not start this window" description={failure} /></div>)
    : !info || !ui || onboarding === null ? bare(<div className="page-state"><Spinner size="lg" label="Starting Atlas" /></div>)
    : onboarding ? bare(<Onboarding onDone={() => setOnboarding(false)} />)
    : <AtlasWindow info={info} initialUi={ui} />;
  return <AppActionsContext.Provider value={actions}>{content}{about && <AboutDialog onClose={() => setAbout(false)} onError={warn} />}</AppActionsContext.Provider>;
}
