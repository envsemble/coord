import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { ComputerFolder } from '../shared/contract.ts';
import type { WindowManager } from './windows.ts';

/** How many of this computer's folders File › Open Recent lists; Manage Folders… has them all. */
const recentLimit = 10;

/**
 * The application menu. On macOS it is the system's menu bar; elsewhere windows draw the same menus
 * in their title bar, and this menu stays hidden, keeping its shortcuts.
 */
export function buildMenu(manager: WindowManager, folders: ComputerFolder[], actions: { openLogs(): void; about(): void; devTools: boolean }) {
  const window = () => manager.focused();
  const mac = process.platform === 'darwin';
  // This computer's folder list, which its other devices see too; a folder leaves it from Manage Folders…
  const recentItems: MenuItemConstructorOptions[] = folders.length
    ? folders.slice(0, recentLimit).map((item): MenuItemConstructorOptions => ({
      label: item.path.replaceAll('&', '&&'),
      sublabel: item.available ? undefined : 'Missing',
      enabled: item.available,
      click: () => { void manager.openRecent(item.path, window()); },
    }))
    : [{ label: 'No recent folders', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New &Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => { void manager.create(null); } },
        { type: 'separator' },
        { label: '&Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => manager.openFolderCommand(window()) },
        { label: 'Open &Recent', id: 'open-recent', submenu: recentItems },
        // The window's computer's whole list (macOS has no Open Recent of that computer in the window).
        { label: 'Manage &Folders…', click: () => manager.sendMenu('manageFolders') },
        // Through the window, which saves its layout first; only the window in front closes its folder.
        { label: 'Close &Folder', click: () => manager.sendMenu('closeFolder', true) },
        { type: 'separator' },
        { label: 'Co&nnect to Another Atlas…', click: () => manager.sendMenu('connectRemote') },
        { label: 'Re&mote Access…', click: () => manager.sendMenu('remoteAccess') },
        { type: 'separator' },
        { label: '&Import Plan…', click: () => manager.sendMenu('importPlan') },
        { label: '&Export Plan…', click: () => manager.sendMenu('exportPlan') },
        { type: 'separator' },
        { label: 'Close &Tab', accelerator: 'CmdOrCtrl+W', click: () => manager.sendMenu('closeTab') },
        { label: 'Close Win&dow', accelerator: 'CmdOrCtrl+Shift+W', click: () => window()?.win.close() },
        { type: 'separator' },
        { role: 'quit', label: 'E&xit' },
      ],
    },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: '&View',
      submenu: [
        // The window takes these keys itself, except in a field, where they reach this menu and the window ignores them.
        { label: '&Back', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: () => manager.sendMenu('goBack') },
        { label: '&Forward', accelerator: mac ? 'Cmd+]' : 'Alt+Right', click: () => manager.sendMenu('goForward') },
        { type: 'separator' },
        { label: '&Search…', accelerator: 'CmdOrCtrl+P', click: () => manager.sendMenu('quickOpen') },
        { type: 'separator' },
        { label: '&Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => manager.sendMenu('showExplorer') },
        { label: 'Toggle &Sidebar', accelerator: 'CmdOrCtrl+B', click: () => manager.sendMenu('toggleSidebar') },
        { type: 'separator' },
        { label: '&Work', click: () => manager.sendMenu('openWorkList') },
        { label: '&Activity', click: () => manager.sendMenu('openActivity') },
        { label: 'S&tatistics', click: () => manager.sendMenu('openStatistics') },
        { type: 'separator' },
        // Zoom keeps the title bar's window buttons as tall as the bar.
        { label: '&Actual Size', accelerator: 'CmdOrCtrl+0', click: () => window()?.zoom('reset') },
        { label: 'Zoom &In', accelerator: 'CmdOrCtrl+Plus', click: () => window()?.zoom('in') },
        { label: 'Zoom &Out', accelerator: 'CmdOrCtrl+-', click: () => window()?.zoom('out') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(actions.devTools ? [{ type: 'separator' } as const, { role: 'reload' } as const, { role: 'toggleDevTools' } as const] : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open &Logs', click: actions.openLogs },
        { type: 'separator' },
        { label: '&About Atlas', click: actions.about },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
