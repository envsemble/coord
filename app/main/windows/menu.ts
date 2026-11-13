import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { WindowManager } from './windowManager.ts';

/**
 * The application menu. On macOS it is the system's menu bar; elsewhere windows draw their own menu
 * in their title bar, and this menu stays hidden, keeping its shortcuts.
 */
export function buildMenu(manager: WindowManager, actions: { openLogs(): void; devTools: boolean }) {
  const window = () => manager.focused();
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New &Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => { manager.create(window()?.computer ?? null); } },
        { label: 'New &Project…', click: () => manager.sendMenu('newProject') },
        { type: 'separator' },
        // The shown file in the chosen editor, as the title bar's Open in button does; the window takes the key itself.
        { label: 'Open in &Editor', accelerator: 'CmdOrCtrl+O', click: () => manager.sendMenu('openInEditor') },
        { type: 'separator' },
        // Settings: the agents on this computer, and the computers; the window takes the key itself too.
        { label: '&Settings…', accelerator: 'CmdOrCtrl+,', click: () => manager.sendMenu('settings') },
        { type: 'separator' },
        { label: 'Close Win&dow', accelerator: 'CmdOrCtrl+Shift+W', click: () => window()?.win.close() },
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
        // Every plan, and all plans' statistics.
        { label: '&Plans', click: () => manager.sendMenu('plans') },
        { label: 'S&tatistics', click: () => manager.sendMenu('statistics') },
        { type: 'separator' },
        { label: '&Search…', accelerator: 'CmdOrCtrl+P', click: () => manager.sendMenu('quickOpen') },
        { label: 'F&iles', accelerator: 'CmdOrCtrl+Shift+E', click: () => manager.sendMenu('toggleFiles') },
        { type: 'separator' },
        // Zoom keeps the title bar's window buttons as tall as the bar above its line.
        { label: 'Zoom &In', accelerator: 'CmdOrCtrl+Plus', click: () => window()?.zoom('in') },
        { label: 'Zoom &Out', accelerator: 'CmdOrCtrl+-', click: () => window()?.zoom('out') },
        { label: '&Actual Size', accelerator: 'CmdOrCtrl+0', click: () => window()?.zoom('reset') },
        { role: 'togglefullscreen' },
        ...(actions.devTools ? [{ type: 'separator' } as const, { role: 'reload' } as const, { role: 'toggleDevTools' } as const] : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open &Logs', click: actions.openLogs },
        { type: 'separator' },
        { label: '&About Atlas', click: () => manager.sendMenu('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
