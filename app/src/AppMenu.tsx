// The window's title bar: the logo, back and forward, File, Edit, View and Help, and the computer the
// window works on. On macOS the system's menu bar holds the menus instead (main's application menu),
// and the traffic lights take the start of the title bar.
import { useRef } from 'react';
import { IconButton, Menubar, MenubarMenu, MenuItem, MenuSeparator, Tooltip, type MenubarMenuOpenChangeDetails } from '@envsemble/envui';
import { ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import type { AppCommand } from '../shared/contract';
import type { WindowInfo } from './types';
import { api, AtlasError } from './api';
import { ComputerMenu, useAppActions } from './Computers';
import { ThemeSubmenu } from './ThemeMenu';

/** What the workbench adds to the menus: back and forward, its tabs, the sidebar, the file panel and plans. */
export interface WorkbenchMenus {
  goBack(): void;
  goForward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  quickOpen(): void;
  toggleFiles(): void;
  filesVisible: boolean;
  toggleSidebar(): void;
  sidebarVisible: boolean;
  closeTab(): void;
  closeAllTabs(): void;
  canCloseTab: boolean;
  importPlan(): void;
  exportPlan(): void;
}

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';
/** Back and forward: Alt+← and Alt+→, ⌘[ and ⌘] on macOS; as shown, and for aria-keyshortcuts. */
const historyKeys = (platform: string) => platform === 'darwin'
  ? { back: '⌘[', forward: '⌘]', backKeys: 'Meta+[ BrowserBack', forwardKeys: 'Meta+] BrowserForward' }
  : { back: 'Alt+←', forward: 'Alt+→', backKeys: 'Alt+ArrowLeft BrowserBack', forwardKeys: 'Alt+ArrowRight BrowserForward' };

export function AppMenubar({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const mod = modifierKey(info.platform);
  const history = historyKeys(info.platform);
  // Edit acts on what had focus before the menubar took it: focus moves back there before the command runs.
  const focused = useRef<HTMLElement | null>(null);
  const noteFocus = (open: boolean, { previousFocus }: MenubarMenuOpenChangeDetails) => {
    if (open) focused.current = previousFocus instanceof HTMLElement ? previousFocus : null;
  };
  const run = (command: AppCommand) => () => { api.command(command).catch(error => { if ((error as AtlasError).code !== 'cancelled') onError((error as Error).message); }); };
  const edit = (command: AppCommand) => () => {
    const target = focused.current;
    // The menu returns focus to its trigger as it closes; the command waits for that, then refocuses.
    window.setTimeout(() => {
      if (target?.isConnected) target.focus({ preventScroll: true });
      run(command)();
    }, 0);
  };
  return <Menubar aria-label="Application menu" accessKeys className="app-menubar">
    <MenubarMenu label="File" accessKey="F">
      <MenuItem shortcut={mod + '+Shift+N'} onClick={run('newWindow')}>New Window</MenuItem>
      <MenuItem onClick={actions.newProject}>New Project…</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={actions.connect}>Connect to Another Atlas…</MenuItem>
      <MenuItem onClick={actions.remoteAccess}>Remote Access…</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={workbench.importPlan}>Import Plan…</MenuItem>
      <MenuItem onClick={workbench.exportPlan}>Export Plan…</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+W'} disabled={!workbench.canCloseTab} onClick={workbench.closeTab}>Close Tab</MenuItem>
      <MenuItem disabled={!workbench.canCloseTab} onClick={workbench.closeAllTabs}>Close All Tabs</MenuItem>
      <MenuItem shortcut={mod + '+Shift+W'} onClick={run('closeWindow')}>Close Window</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={run('quit')}>Exit</MenuItem>
    </MenubarMenu>
    <MenubarMenu label="Edit" accessKey="E" onOpenChange={noteFocus}>
      <MenuItem shortcut={mod + '+Z'} onClick={edit('undo')}>Undo</MenuItem>
      <MenuItem shortcut={info.platform === 'win32' ? mod + '+Y' : mod + '+Shift+Z'} onClick={edit('redo')}>Redo</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+X'} onClick={edit('cut')}>Cut</MenuItem>
      <MenuItem shortcut={mod + '+C'} onClick={edit('copy')}>Copy</MenuItem>
      <MenuItem shortcut={mod + '+V'} onClick={edit('paste')}>Paste</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+A'} onClick={edit('selectAll')}>Select All</MenuItem>
    </MenubarMenu>
    <MenubarMenu label="View" accessKey="V">
      <MenuItem shortcut={history.back} disabled={!workbench.canGoBack} onClick={workbench.goBack}>Back</MenuItem>
      <MenuItem shortcut={history.forward} disabled={!workbench.canGoForward} onClick={workbench.goForward}>Forward</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+P'} onClick={workbench.quickOpen}>Search…</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={mod + '+Shift+E'} onClick={workbench.toggleFiles}>{workbench.filesVisible ? 'Hide Files' : 'Show Files'}</MenuItem>
      <MenuItem shortcut={mod + '+B'} onClick={workbench.toggleSidebar}>{workbench.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar'}</MenuItem>
      <MenuSeparator />
      <ThemeSubmenu />
      <MenuSeparator />
      <MenuItem shortcut={mod + '++'} onClick={run('zoomIn')}>Zoom In</MenuItem>
      <MenuItem shortcut={mod + '+-'} onClick={run('zoomOut')}>Zoom Out</MenuItem>
      <MenuItem shortcut={mod + '+0'} onClick={run('resetZoom')}>Actual Size</MenuItem>
      <MenuSeparator />
      <MenuItem shortcut={info.platform === 'darwin' ? 'Ctrl+⌘+F' : 'F11'} onClick={run('toggleFullScreen')}>Full Screen</MenuItem>
      {info.devTools && <>
        <MenuSeparator />
        <MenuItem shortcut={mod + '+R'} onClick={run('reload')}>Reload</MenuItem>
        <MenuItem shortcut={info.platform === 'darwin' ? 'Alt+⌘+I' : mod + '+Shift+I'} onClick={run('toggleDevTools')}>Developer Tools</MenuItem>
      </>}
    </MenubarMenu>
    <MenubarMenu label="Help" accessKey="H">
      <MenuItem onClick={run('openLogs')}>Open Logs</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={actions.about}>About Atlas</MenuItem>
    </MenubarMenu>
  </Menubar>;
}

/** The start of the title bar after the logo: back and forward, the menus (except on macOS), and the computer. */
export function TitleBarStart({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    <HistoryButtons platform={info.platform} workbench={workbench} />
    {info.platform !== 'darwin' && <AppMenubar info={info} workbench={workbench} onError={onError} />}
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
