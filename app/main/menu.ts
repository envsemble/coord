import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { RecentFolder } from '../shared/contract.ts';
import type { WindowManager } from './windows.ts';

export function buildMenu(manager: WindowManager, recents: RecentFolder[], actions: { openLogs(): void; about(): void; devTools: boolean }) {
  const window = () => manager.focused();
  const recentItems: MenuItemConstructorOptions[] = recents.length
    ? [
      ...recents.map((item): MenuItemConstructorOptions => ({
        label: item.path.replaceAll('&', '&&'),
        sublabel: item.available ? undefined : 'Missing',
        click: () => { void manager.openRecent(item.path, window()); },
      })),
      { type: 'separator' },
      { label: 'Clear Recently Opened', click: () => { void manager.clearRecents(); } },
    ]
    : [{ label: 'No recent folders', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New &Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => { void manager.create(null); } },
        { type: 'separator' },
        { label: '&Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => { void manager.chooseFolder(window()); } },
        { label: 'Open &Recent', id: 'open-recent', submenu: recentItems },
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
        { label: '&Quick Open…', accelerator: 'CmdOrCtrl+P', click: () => manager.sendMenu('quickOpen') },
        { type: 'separator' },
        { label: '&Explorer', accelerator: 'CmdOrCtrl+Shift+E', click: () => manager.sendMenu('showExplorer') },
        { label: 'Toggle &Sidebar', accelerator: 'CmdOrCtrl+B', click: () => manager.sendMenu('toggleSidebar') },
        { type: 'separator' },
        { label: '&Work', click: () => manager.sendMenu('openWorkList') },
        { label: '&Activity', click: () => manager.sendMenu('openActivity') },
        { label: 'S&tatistics', click: () => manager.sendMenu('openStatistics') },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
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
