// The start of the window's title bar, one row: the logo, back and forward, Plans, Settings and
// Help, the computer the window works on (with the computers to switch to) and Coord's update when
// there is one. Plans goes to every plan; the hub leads on to a project's plans and the statistics.
// The window's other commands keep their shortcuts, taken by the window and main's application menu
// (on macOS, the system's menu bar).
import { Button, IconButton, Menu, Tooltip } from '@envsemble/envui';
import { IconArrowBack as ArrowBack } from '@envsemble/envui/icons/ArrowBack';
import { IconArrowForward as ArrowForward } from '@envsemble/envui/icons/ArrowForward';
import { CoordMark } from '@envsemble/coord-diagrams/mark';
import type { AppCommand } from '../../shared/contract';
import type { SettingsSection, WindowInfo } from '../types';
import { api, CoordError } from '../api';
import { ComputerMenu } from '../computers/ComputerMenu';
import { useAppActions } from '../appActions';
import { UpdateButton } from '../settings/Updates';

/** What the window adds to the title bar: back and forward, Plans and Settings. */
export interface WindowMenus {
  goBack(): void;
  goForward(): void;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Whether the window shows the hub, for Plans to mark. */
  showsPlans: boolean;
  /** Whether the window shows Settings, for Settings to mark. */
  showsSettings: boolean;
  /** Show the hub: every plan, or one project's. */
  plans(projectId: string | null): void;
  /** Show Settings, at a section. */
  settings(section?: SettingsSection): void;
}

/** The modifier shortcuts use: ⌘ on macOS, Ctrl elsewhere. */
export const modifierKey = (platform: string) => platform === 'darwin' ? '⌘' : 'Ctrl';
/** Back and forward: Alt+← and Alt+→, ⌘[ and ⌘] on macOS; as shown, and for aria-keyshortcuts. */
const historyKeys = (platform: string) => platform === 'darwin'
  ? { back: '⌘[', forward: '⌘]', backKeys: 'Meta+[ BrowserBack', forwardKeys: 'Meta+] BrowserForward' }
  : { back: 'Alt+←', forward: 'Alt+→', backKeys: 'Alt+ArrowLeft BrowserBack', forwardKeys: 'Alt+ArrowRight BrowserForward' };

/**
 * The title bar's commands: Plans (the hub with every plan) and Settings, each a plain button, and the
 * Help menu (the logs and About Coord). The rest of the app's commands are on the page or behind
 * their shortcuts.
 */
export function AppMenus({ menus, onError }: { menus: WindowMenus; onError(message: string): void }) {
  const actions = useAppActions();
  const run = (command: AppCommand) => () => { api.command(command).catch(error => { if ((error as CoordError).code !== 'cancelled') onError((error as Error).message); }); };
  return <div className="title-bar-commands">
    <Button variant="ghost" size="sm" aria-current={menus.showsPlans ? 'page' : undefined} onClick={() => menus.plans(null)}>Plans</Button>
    <Button variant="ghost" size="sm" aria-current={menus.showsSettings ? 'page' : undefined} onClick={() => menus.settings()}>Settings</Button>
    <Menu.Root aria-label="Help" align="start" trigger={<Button variant="ghost" size="sm">Help</Button>}>
      <Menu.Item onClick={run('openLogs')}>Open Logs</Menu.Item>
      <Menu.Item onClick={actions.about}>About Coord</Menu.Item>
    </Menu.Root>
  </div>;
}

/** The start of the title bar: the logo, back and forward, the commands, the computer and the update. */
export function TitleBarStart({ info, menus, onError }: { info: WindowInfo; menus: WindowMenus; onError(message: string): void }) {
  return <div className="title-bar-start">
    <CoordLogo />
    <HistoryButtons platform={info.platform} menus={menus} />
    <AppMenus menus={menus} onError={onError} />
    <ComputerMenu current={info.computer} onError={onError} onSettings={() => menus.settings('computers')} />
    <UpdateButton />
  </div>;
}

/** Coord's mark at the start of the title bar: only a picture, as Plans goes to every plan. */
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
