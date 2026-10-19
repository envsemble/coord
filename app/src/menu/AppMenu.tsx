// The window's two rows at the top, GitHub style. The title bar: the logo (which leads to the hub),
// back and forward, the File menu and the computer the window works on at its start. Below it, the
// sections: Plans (the hub, and every plan, ledger and diagram opened from it) and Projects (with
// each project's statistics), with their counts. The shortcuts shown in File are taken by the window and main's
// application menu (on macOS, the system's menu bar).
import { useState, type ReactNode } from 'react';
import { Counter, IconButton, Menubar, MenubarMenu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, NavigationItem, Tooltip } from '@envsemble/envui';
import { ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import { AtlasMark } from '@envsemble/atlas-diagrams/react';
import { editorNames, editors, type AppCommand, type Editor } from '../../shared/contract';
import type { WindowInfo } from '../types';
import { api, AtlasError } from '../api';
import { ComputerMenu, useAppActions } from '../remote/Computers';
import { FolderIcon, WorkIcon } from '../ui/icons';

/** What the window adds to the title bar: the hub, back and forward, a new project, importing a plan and exporting the one open. */
export interface WorkbenchMenus {
  goHome(): void;
  goBack(): void;
  goForward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  newProject(): void;
  importPlan(): void;
  /** Export the plan open; null when none is. */
  exportPlan: (() => void) | null;
}

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';
/** Back and forward: Alt+← and Alt+→, ⌘[ and ⌘] on macOS; as shown, and for aria-keyshortcuts. */
const historyKeys = (platform: string) => platform === 'darwin'
  ? { back: '⌘[', forward: '⌘]', backKeys: 'Meta+[ BrowserBack', forwardKeys: 'Meta+] BrowserForward' }
  : { back: 'Alt+←', forward: 'Alt+→', backKeys: 'Alt+ArrowLeft BrowserBack', forwardKeys: 'Alt+ArrowRight BrowserForward' };

/** The editor files and work folders open in, read again each time its menu opens (another window may have changed it). */
function EditorMenu() {
  const [choice, setChoice] = useState<Editor | null>(null);
  const choose = (value: string) => {
    const next = value as Editor;
    setChoice(next);
    api.setEditor(next).catch(() => setChoice(null));
  };
  return <MenuSubmenu label="Open Files In" onOpenChange={open => { if (open) api.editor().then(setChoice, () => setChoice('vscode')); }}>
    <MenuRadioGroup value={choice ?? ''} onValueChange={choose}>
      {editors.map(value => <MenuRadioItem key={value} value={value}>{editorNames[value]}</MenuRadioItem>)}
    </MenuRadioGroup>
  </MenuSubmenu>;
}

/** File: windows and projects, plans, other computers, the view, and the app. Alt+F opens it, except on macOS. */
export function FileMenu({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const mod = modifierKey(info.platform);
  const run = (command: AppCommand) => () => { api.command(command).catch(error => { if ((error as AtlasError).code !== 'cancelled') onError((error as Error).message); }); };
  return <Menubar aria-label="Application menu" accessKeys={info.platform !== 'darwin'} className="app-menubar">
    <MenubarMenu label="File" accessKey="F">
      <MenuItem shortcut={mod + '+Shift+N'} onClick={run('newWindow')}>New Window</MenuItem>
      <MenuItem onClick={workbench.newProject}>New Project…</MenuItem>
      <MenuSeparator />
      <MenuItem onClick={workbench.importPlan}>Import Plan…</MenuItem>
      {workbench.exportPlan && <MenuItem onClick={workbench.exportPlan}>Export Plan…</MenuItem>}
      <EditorMenu />
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
    </MenubarMenu>
  </Menubar>;
}

/** The start of the title bar: the logo, back and forward, File, and the computer. */
export function TitleBarStart({ info, workbench, onError }: { info: WindowInfo; workbench: WorkbenchMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    <Tooltip content="All plans" side="bottom">
      <IconButton variant="text" className="title-bar-home" icon={<AtlasMark size={20} label="" />} aria-label="All plans" onClick={workbench.goHome} />
    </Tooltip>
    <HistoryButtons platform={info.platform} workbench={workbench} />
    <FileMenu info={info} workbench={workbench} onError={onError} />
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

export type Section = 'plans' | 'projects';

/**
 * The second row: the window's sections, the one shown underlined as on GitHub, with the open plans
 * and the active projects counted (once listed).
 */
export function SectionBar({ section, counts, go }: { section: Section; counts: { plans: number; projects: number } | null; go(section: Section): void }) {
  const item = (id: Section, label: string, icon: ReactNode, count?: number, countLabel?: string) => <NavigationItem size="compact" className="section-tab" data-section={id}
    aria-current={section === id ? 'page' : undefined} icon={icon} onClick={() => go(id)}
    trailing={count === undefined ? undefined : <Counter value={count} aria-label={countLabel} />}>{label}</NavigationItem>;
  return <nav className="section-bar" aria-label="Sections">
    {item('plans', 'Plans', <WorkIcon />, counts?.plans, counts ? counts.plans + ' open' : undefined)}
    {item('projects', 'Projects', <FolderIcon />, counts?.projects, counts ? counts.projects + ' active' : undefined)}
  </nav>;
}
