// The window's title bar start: the logo (which leads to the hub), back and forward, the menu, and
// the computer the window works on. The menu is one button holding the app's commands; the shortcuts
// shown in it are taken by the window and main's application menu (on macOS, the system's menu bar).
import { IconButton, Menu, MenuItem, MenuSeparator, Tooltip } from '@envsemble/envui';
import { ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import { Menu as MenuIcon } from '@envsemble/envui/icons/Menu';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import type { AppCommand } from '../shared/contract';
import type { WindowInfo } from './types';
import { api, AtlasError } from './api';
import { ComputerMenu, useAppActions } from './Computers';

/** What the window adds to the title bar: the hub, back and forward, its pages and importing a plan. */
export interface WorkbenchMenus {
  goHome(): void;
  goBack(): void;
  goForward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  projects(): void;
  statistics(): void;
  importPlan(): void;
}

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';
/** Back and forward: Alt+← and Alt+→, ⌘[ and ⌘] on macOS; as shown, and for aria-keyshortcuts. */
const historyKeys = (platform: string) => platform === 'darwin'
  ? { back: '⌘[', forward: '⌘]', backKeys: 'Meta+[ BrowserBack', forwardKeys: 'Meta+] BrowserForward' }
  : { back: 'Alt+←', forward: 'Alt+→', backKeys: 'Alt+ArrowLeft BrowserBack', forwardKeys: 'Alt+ArrowRight BrowserForward' };

/** The one menu: windows, the pages, plans, other computers, the view, and the app. */
export function AppMenu({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const mod = modifierKey(info.platform);
  const run = (command: AppCommand) => () => { api.command(command).catch(error => { if ((error as AtlasError).code !== 'cancelled') onError((error as Error).message); }); };
  return <Menu aria-label="Menu" align="start" density="compact" className="app-menu"
    trigger={<IconButton variant="text" className="app-menu-button" icon={<MenuIcon />} aria-label="Menu" />}>
    <MenuItem shortcut={mod + '+Shift+N'} onClick={run('newWindow')}>New Window</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={workbench.projects}>Projects</MenuItem>
    <MenuItem onClick={workbench.statistics}>Statistics</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={workbench.importPlan}>Import Plan…</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={actions.connect}>Connect to Another Atlas…</MenuItem>
    <MenuItem onClick={actions.remoteAccess}>Remote Access…</MenuItem>
    <MenuSeparator />
    <MenuItem shortcut={mod + '++'} onClick={run('zoomIn')}>Zoom In</MenuItem>
    <MenuItem shortcut={mod + '+-'} onClick={run('zoomOut')}>Zoom Out</MenuItem>
    <MenuItem shortcut={mod + '+0'} onClick={run('resetZoom')}>Actual Size</MenuItem>
    <MenuItem shortcut={info.platform === 'darwin' ? 'Ctrl+⌘+F' : 'F11'} onClick={run('toggleFullScreen')}>Full Screen</MenuItem>
    {info.devTools && <>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+R'} onClick={run('reload')}>Reload</MenuItem>
      <MenuItem shortcut={info.platform === 'darwin' ? 'Alt+⌘+I' : mod + '+Shift+I'} onClick={run('toggleDevTools')}>Developer Tools</MenuItem>
    </>}
    <MenuSeparator />
    <MenuItem onClick={run('openLogs')}>Open Logs</MenuItem>
    <MenuItem onClick={actions.about}>About Atlas</MenuItem>
    <MenuSeparator />
    <MenuItem onClick={run('quit')}>Exit</MenuItem>
  </Menu>;
}

/** The start of the title bar: the logo, back and forward, the menu, and the computer. */
export function TitleBarStart({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    <Tooltip content="All plans" side="bottom">
      <IconButton variant="text" className="title-bar-home" icon={<AtlasMark size={20} label="" />} aria-label="All plans" onClick={workbench.goHome} />
    </Tooltip>
    <HistoryButtons platform={info.platform} workbench={workbench} />
    <AppMenu info={info} workbench={workbench} onError={onError} />
    <ComputerMenu current={info.computer} onError={onError} />
  </div>;
}

/** The title bar's quiet back and forward arrows. */
function HistoryButtons({ platform, workbench }: { platform: string; workbench: WorkbenchMenus }) {
  const keys = historyKeys(platform);
  return <div className="history-buttons">
    <Tooltip content={'Back (' + keys.back + ')'} side="bottom">
      <IconButton variant="text" icon={<ArrowBack />} aria-label="Back" aria-keyshortcuts={keys.backKeys} aria-disabled={!workbench.canGoBack || undefined} onClick={() => { if (workbench.canGoBack) workbench.goBack(); }} />
    </Tooltip>
    <Tooltip content={'Forward (' + keys.forward + ')'} side="bottom">
      <IconButton variant="text" icon={<ArrowForward />} aria-label="Forward" aria-keyshortcuts={keys.forwardKeys} aria-disabled={!workbench.canGoForward || undefined} onClick={() => { if (workbench.canGoForward) workbench.goForward(); }} />
    </Tooltip>
  </div>;
}
