// The start of the window's title bar, one row: the logo, back and forward, the Plans, File, View
// and Help menus, and the computer the window works on (with the computers to switch to). Plans
// goes to every plan, a project's plans and all plans' statistics; the breadcrumbs of each page lead
// back the same way. The shortcuts shown in the menus are taken by the window and main's
// application menu (on macOS, the system's menu bar).
import { IconButton, Menu, Menubar, Tooltip } from '@envsemble/envui';
import { IconArrowBack as ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { IconArrowForward as ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import { CoordMark } from '@envsemble/coord-diagrams/mark';
import type { AppCommand } from '../../shared/contract';
import type { Project, SettingsSection, WindowInfo } from '../types';
import { api, CoordError } from '../api';
import { ComputerMenu } from '../computers/ComputerMenu';
import { useAppActions } from '../appActions';
import { BuildBadge } from './BuildBadge';

/** What the window adds to the title bar: back and forward, the plans to go to, a new project and Settings. */
export interface WindowMenus {
  goBack(): void;
  goForward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The active projects, for Plans; null until listed. */
  projects: Project[] | null;
  /** The project whose plans the window shows, for Plans to mark; null for every plan or none. */
  shownProject: string | null;
  /** Show the hub: every plan, or one project's. */
  plans(projectId: string | null): void;
  /** Show all plans' statistics. */
  statistics(): void;
  newProject(): void;
  /** Show Settings, at a section. */
  settings(section?: SettingsSection): void;
}

/** Ask main to run a command; a failure other than a cancelled question is shown. */
const runCommand = (command: AppCommand, onError: (message: string) => void) => {
  api.command(command).catch(error => { if ((error as CoordError).code !== 'cancelled') onError((error as Error).message); });
};

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';
/** Back and forward: Alt+← and Alt+→, ⌘[ and ⌘] on macOS; as shown, and for aria-keyshortcuts. */
const historyKeys = (platform: string) => platform === 'darwin'
  ? { back: '⌘[', forward: '⌘]', backKeys: 'Meta+[ BrowserBack', forwardKeys: 'Meta+] BrowserForward' }
  : { back: 'Alt+←', forward: 'Alt+→', backKeys: 'Alt+ArrowLeft BrowserBack', forwardKeys: 'Alt+ArrowRight BrowserForward' };

/**
 * The window's menus: Plans (every plan, each active project's, and their statistics), File
 * (windows, projects and Settings), View (zoom and full screen,
 * and the developer's tools where offered) and Help. Alt and their letter open them, except on macOS.
 * The computers to switch to are in the computer menu.
 */
export function AppMenus({ info, menus, onError }: { info: WindowInfo; menus: WindowMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const mod = modifierKey(info.platform);
  const run = (command: AppCommand) => () => runCommand(command, onError);
  const active = (menus.projects ?? []).filter(project => project.state === 'active');
  return <Menubar.Root aria-label="Application menu" accessKeys={info.platform !== 'darwin'}>
    <Menubar.Menu label="Plans" accessKey="P">
      <Menu.Item onClick={() => menus.plans(null)}>All Plans</Menu.Item>
      {active.length > 0 && <Menu.Group label="Projects">
        {active.map(project => <Menu.Item key={project.id} aria-current={menus.shownProject === project.id ? 'page' : undefined} onClick={() => menus.plans(project.id)}>{project.name}</Menu.Item>)}
      </Menu.Group>}
      <Menu.Separator />
      <Menu.Item onClick={menus.statistics}>Statistics</Menu.Item>
    </Menubar.Menu>
    <Menubar.Menu label="File" accessKey="F">
      <Menu.Item shortcut={mod + '+Shift+N'} onClick={run('newWindow')}>New Window</Menu.Item>
      <Menu.Item onClick={menus.newProject}>New Project…</Menu.Item>
      <Menu.Separator />
      <Menu.Item shortcut={mod + '+,'} onClick={() => menus.settings()}>Settings…</Menu.Item>
      <Menu.Separator />
      <Menu.Item onClick={run('quit')}>Exit</Menu.Item>
    </Menubar.Menu>
    <Menubar.Menu label="View" accessKey="V">
      <Menu.Item shortcut={mod + '++'} onClick={run('zoomIn')}>Zoom In</Menu.Item>
      <Menu.Item shortcut={mod + '+-'} onClick={run('zoomOut')}>Zoom Out</Menu.Item>
      <Menu.Item shortcut={mod + '+0'} onClick={run('resetZoom')}>Actual Size</Menu.Item>
      <Menu.Item shortcut={info.platform === 'darwin' ? 'Ctrl+⌘+F' : 'F11'} onClick={run('toggleFullScreen')}>Full Screen</Menu.Item>
      {info.devTools && <>
        <Menu.Separator />
        <Menu.Item shortcut={mod + '+R'} onClick={run('reload')}>Reload</Menu.Item>
        <Menu.Item shortcut={info.platform === 'darwin' ? 'Alt+⌘+I' : mod + '+Shift+I'} onClick={run('toggleDevTools')}>Developer Tools</Menu.Item>
      </>}
    </Menubar.Menu>
    <Menubar.Menu label="Help" accessKey="H">
      <Menu.Item onClick={run('openLogs')}>Open Logs</Menu.Item>
      <Menu.Item onClick={actions.about}>About Coord</Menu.Item>
    </Menubar.Menu>
  </Menubar.Root>;
}

/** The start of the title bar: the logo, back and forward, the menus, and the computer. */
export function TitleBarStart({ info, menus, onError }: { info: WindowInfo; menus: WindowMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    <CoordLogo />
    <BuildBadge info={info} run={command => runCommand(command, onError)} />
    <HistoryButtons platform={info.platform} menus={menus} />
    <AppMenus info={info} menus={menus} onError={onError} />
    <ComputerMenu current={info.computer} onError={onError} onSettings={() => menus.settings('computers')} />
  </div>;
}

/** Coord's mark at the start of the title bar: only a picture, as the Plans menu goes to every plan. */
export function CoordLogo() {
  return <span className="title-bar-logo" aria-hidden="true"><CoordMark size={20} label="" /></span>;
}

/** The title bar's quiet back and forward arrows. */
function HistoryButtons({ platform, menus }: { platform: string; menus: WindowMenus }) {
  const keys = historyKeys(platform);
  return <div className="history-buttons">
    <Tooltip content={'Back (' + keys.back + ')'} side="bottom">
      <IconButton variant="ghost" size="sm" icon={<ArrowBack />} aria-label="Back" aria-keyshortcuts={keys.backKeys} aria-disabled={!menus.canGoBack || undefined} onClick={() => { if (menus.canGoBack) menus.goBack(); }} />
    </Tooltip>
    <Tooltip content={'Forward (' + keys.forward + ')'} side="bottom">
      <IconButton variant="ghost" size="sm" icon={<ArrowForward />} aria-label="Forward" aria-keyshortcuts={keys.forwardKeys} aria-disabled={!menus.canGoForward || undefined} onClick={() => { if (menus.canGoForward) menus.goForward(); }} />
    </Tooltip>
  </div>;
}
