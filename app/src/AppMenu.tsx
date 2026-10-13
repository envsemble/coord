// The window's title bar: the logo, File, Edit, View and Help, and the computer the window works on.
// On macOS the system's menu bar holds the menus instead (main's application menu), and the traffic
// lights take the start of the title bar.
import { useRef, type ReactNode } from 'react';
import { Menubar, MenubarMenu, MenuItem, MenuSeparator, TitleBar, type MenubarMenuOpenChangeDetails } from '@envsemble/envui';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import type { AppCommand } from '../shared/contract';
import type { ComputerFolder, ViewName, WindowInfo } from './types';
import { api, AtlasError } from './api';
import { viewLabels } from './targets';
import { ComputerMenu, openFolderOn, RecentFolders, useAppActions } from './Computers';
import { ThemeMenu, ThemeSubmenu } from './ThemeMenu';

/** What the workbench adds to the menus: its tabs, pages, sidebar and plans. */
export interface WorkbenchMenus {
  quickOpen(): void;
  showPage(view: ViewName): void;
  showExplorer(): void;
  toggleSidebar(): void;
  sidebarVisible: boolean;
  closeTab(): void;
  canCloseTab: boolean;
  importPlan(): void;
  exportPlan(): void;
  /** File › Close Folder, after saving the window's layout. */
  closeFolder(): void;
  /** The folder this window shows, in its computer's folder list. */
  isCurrent(folder: ComputerFolder): boolean;
  /** Where Open Folder… starts browsing on another computer. */
  near: string | null;
}

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';

export function AppMenubar({ info, workbench, onError }: { info: WindowInfo; workbench?: WorkbenchMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const computer = info.computer;
  const mod = modifierKey(info.platform);
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
      <MenuSeparator />
      <MenuItem shortcut={mod + '+O'} onClick={() => openFolderOn(computer, actions, onError, workbench?.near ?? null)}>Open Folder…</MenuItem>
      <RecentFolders computer={computer} isCurrent={workbench?.isCurrent} onError={onError} />
      <MenuItem disabled={!info.folder} onClick={workbench?.closeFolder ?? run('closeFolder')}>Close Folder</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={actions.connect}>Connect to Another Atlas…</MenuItem>
      <MenuItem onClick={actions.remoteAccess}>Remote Access…</MenuItem>
      {workbench && <>
        <MenuSeparator />
        <MenuItem onClick={workbench.importPlan}>Import Plan…</MenuItem>
        <MenuItem onClick={workbench.exportPlan}>Export Plan…</MenuItem>
      </>}
      <MenuSeparator />
      {workbench && <MenuItem shortcut={mod + '+W'} disabled={!workbench.canCloseTab} onClick={workbench.closeTab}>Close Tab</MenuItem>}
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
      {workbench && <>
        <MenuItem shortcut={mod + '+P'} onClick={workbench.quickOpen}>Search…</MenuItem>
        <MenuSeparator />
        {(['work', 'activity', 'statistics'] as const).map(view => <MenuItem key={view} onClick={() => workbench.showPage(view)}>{viewLabels[view]}</MenuItem>)}
        <MenuSeparator />
        <MenuItem shortcut={mod + '+Shift+E'} onClick={workbench.showExplorer}>Explorer</MenuItem>
        <MenuItem shortcut={mod + '+B'} onClick={workbench.toggleSidebar}>{workbench.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar'}</MenuItem>
        <MenuSeparator />
      </>}
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
      <MenuItem onClick={run('about')}>About Atlas</MenuItem>
    </MenubarMenu>
  </Menubar>;
}

/** The start of the title bar after the logo: the menus (except on macOS) and the computer. */
export function TitleBarStart({ info, workbench, onError }: { info: WindowInfo; workbench?: WorkbenchMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    {info.platform !== 'darwin' && <AppMenubar info={info} workbench={workbench} onError={onError} />}
    <ComputerMenu current={info.computer} onError={onError} />
  </div>;
}

/** The title bar of a window without the workbench: its welcome page, a folder problem, loading. */
export function WindowTitleBar({ info, onError, end }: { info: WindowInfo | null; onError(message: string): void; end?: ReactNode }) {
  return <TitleBar className="window-title-bar"
    start={<>
      <span className="title-bar-brand"><AtlasMark size={20} label="" /></span>
      {info && <TitleBarStart info={info} onError={onError} />}
    </>}
    end={<>{end}{info && <ThemeMenu />}</>} />;
}
