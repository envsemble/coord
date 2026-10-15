// The fixed list of messages a window may send. Each channel declares a validator per argument;
// calls with the wrong number or shape of arguments, from a subframe, or from a page that is not
// the Atlas renderer are rejected. Results and errors cross back as structured values. Requests
// about a project go to the host of the window's computer, this one or a paired one.
import { createReadStream } from 'node:fs';
import { lstat, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import QRCode from 'qrcode';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron';
import { HostRequestError, parsePairing, type HostClient } from '@envsemble/atlas-host';
import { resolveDocument } from '@envsemble/atlas-planning';
import { accessSettings, deviceText } from '@envsemble/atlas-host/validate';
import { invokeChannels, type AboutInfo, type AccessSettings, type ImportPreview, type InvokeChannel, type PairingGrant, type PairingLinkView, type ProjectRepository, type ProjectState, type Result, type TabState, type ThemePreference, type UiState } from '../shared/contract.ts';
import { argumentsOf, array, boolean, command, diagramPath, folderId, integer, ipAddress, nullable, object, oneOf, optional, pairingCode, projectName, relativePath, string, target as tabTarget, themePreference, token, uiState, url, viewEvent, workId, type Validator } from '../shared/validate.ts';
import { AtlasError, toErrorValue } from './errors.ts';
import type { FolderView } from './folderView.ts';
import { originOf, rendererOrigin } from './protocol.ts';
import { externalUrl, type AtlasWindow, type WindowManager } from './windows.ts';

type Handler = (window: AtlasWindow, ...args: never[]) => unknown;
interface Channel { args: Validator<unknown>[]; handle: Handler }

const hostId = string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ });
/** A computer: a paired one by its host ID, or null for this one. */
const computer = nullable(hostId);
const deviceId = string({ min: 34, max: 34, pattern: /^d-[a-f0-9]{32}$/ });
const pairingLink = string({ min: 3, max: 2048 });
const grant: Validator<PairingGrant> = object<PairingGrant>({ label: nullable(deviceText(80)), manageAccess: boolean });
const repository: Validator<ProjectRepository> = object<ProjectRepository>({ id: string({ min: 1, max: 64, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }), name: deviceText(100), remote: nullable(string({ min: 1, max: 500 })) });
const projectChange = object<{ name?: string; state?: ProjectState; position?: number }>({ name: optional(projectName), state: optional(oneOf(['active', 'hidden', 'archived'] as const)), position: optional(integer(0, 100000)) });

/** Import previews belong to the window that chose the file. */
const pendingImports = new Map<string, { window: number; folder: FolderView }>();
export async function dropImports(matches: (entry: { window: number; folder: FolderView }, key: string) => boolean) {
  for (const [key, entry] of [...pendingImports]) {
    if (!matches(entry, key)) continue;
    pendingImports.delete(key);
    await entry.folder.request('plan.importDrop', { token: key }).catch(() => undefined);
  }
}

/** Reveal a file or folder inside a project's folder on this computer (never outside it, never hidden parts). */
async function revealInside(window: AtlasWindow, project: string, relative: string) {
  if (window.computer !== null) throw new AtlasError('forbidden', 'Files of a project on another computer cannot be shown in a folder here.');
  await window.readable(project);
  const root = (await window.projects()).find(entry => entry.folderId === project)?.path;
  if (!root) throw new AtlasError('not-found', 'This project is not on this computer.');
  try { shell.showItemInFolder(await resolveDocument(root, relative)); return; } catch { /* Perhaps a folder. */ }
  const base = await realpath(root);
  const candidate = await realpath(path.resolve(base, relative)).catch(() => null);
  const inside = candidate ? path.relative(base, candidate) : '..';
  if (!candidate || inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some(part => part.startsWith('.')) || !(await lstat(candidate)).isDirectory()) {
    throw new AtlasError('forbidden', 'Only files and folders inside the project\'s folder can be shown.');
  }
  shell.showItemInFolder(candidate);
}

/** Send a plan export on this computer to another computer's host, for its preview there. */
async function sendImport(folder: FolderView, file: string) {
  const size = (await stat(file)).size;
  const stream = createReadStream(file);
  let response: Response;
  // The file stays open only while it is sent (or until sending fails, the other computer being offline).
  try { response = await folder.client.fetch(`/api/folders/${folder.folderId}/imports`, 3600000, { method: 'POST', body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, length: size }); }
  finally { stream.destroy(); }
  const value = await response.json().catch(() => null) as (Omit<ImportPreview, 'file' | 'warnings'> & { code?: string; message?: string }) | null;
  if (!response.ok || !value || typeof value.token !== 'string') throw new AtlasError('invalid-argument', value?.message ?? 'The plan could not be sent to ' + (folder.remote?.hostName ?? 'the other computer') + ' (HTTP ' + response.status + ').');
  return value;
}

/** A page cannot fake a person's input: Paste, which reads the clipboard, waits for one. */
function requireActivation(window: AtlasWindow) {
  if (!window.takeActivation()) throw new AtlasError('forbidden', 'Paste needs a click or a key press in the window. Ctrl+V pastes too.');
}
/** A command a page could misuse runs after a person's press, or once they confirm it. */
async function confirmed(window: AtlasWindow, message: string, action: string, detail?: string) {
  if (!(await window.confirm(message, action, detail))) throw new AtlasError('cancelled', 'Cancelled.');
}
/** The computer pairing would reach, read from the link as pairing reads it. A link that cannot pair fails here, before the question. */
function pairingHost(link: string, code: string | null) {
  try { return new URL(parsePairing(link, code ?? undefined).origin).host; } catch (error) { throw hostError(error); }
}

/** A window's layout as the database keeps it: the shared settings, its sidebar's width, and its tabs of its computer's projects. */
async function loadUi(manager: WindowManager, window: AtlasWindow): Promise<UiState> {
  const { state, connections } = manager.context;
  const row = state.windows().find(entry => entry.id === window.rowId);
  const connectionId = window.computer === null ? null : connections.idOf(window.computer);
  await window.projects().catch(() => []);
  const items: TabState[] = [];
  let active: string | null = null;
  for (const tab of state.tabs(window.rowId, connectionId)) {
    const project = window.folderOf(tab.projectId);
    if (!project) continue;
    let target;
    try { target = tabTarget({ kind: tab.kind, ...tab.target && JSON.parse(tab.target) }); } catch { continue; }
    const id = String(items.length);
    items.push({ id, project, target, preview: false });
    if (tab.active) active = id;
  }
  const inspectorWidth = state.inspectorWidth;
  return { sidebar: { visible: state.sidebarVisible, width: row?.sidebarWidth ?? 280 }, tabs: { items, active }, ...inspectorWidth !== null && { inspectorWidth } };
}
async function saveUi(manager: WindowManager, window: AtlasWindow, ui: UiState) {
  const { state, connections } = manager.context;
  const computer = window.computer;
  state.setSidebarVisible(ui.sidebar.visible);
  state.setInspectorWidth(ui.inspectorWidth ?? null);
  state.updateWindow(window.rowId, { sidebarWidth: ui.sidebar.width });
  const rows = [];
  for (const tab of ui.tabs.items) {
    const projectId = await window.projectRow(tab.project).catch(() => null);
    if (projectId === null) continue;
    const { kind, ...rest } = tab.target;
    rows.push({ projectId, kind, target: kind === 'project' ? null : JSON.stringify(rest), active: tab.id === ui.tabs.active });
  }
  // The window may have moved to another computer meanwhile: these tabs are no longer its own.
  if (window.computer === computer) state.saveTabs(window.rowId, computer === null ? null : connections.idOf(computer), rows);
}

export function channels(manager: WindowManager, actions: { openLogs(): void; about(): AboutInfo }): Record<InvokeChannel, Channel> {
  const { connections } = manager.context;
  const owner = (): HostClient => connections.local;
  return {
    'window:info': { args: [], handle: window => window.info() },
    'projects:list': { args: [], handle: window => remoteErrors(window.projects()) },
    'projects:create': {
      args: [projectName, array(repository, 50)],
      handle: async (window, name: string, repositories: ProjectRepository[]) => remoteErrors(window.createProject(name, repositories)),
    },
    'projects:update': { args: [folderId, projectChange], handle: (window, project: string, change: { name?: string; state?: ProjectState; position?: number }) => remoteErrors(window.updateProject(project, change)) },
    'projects:adopt': {
      args: [folderId],
      handle: async (window, project: string) => {
        const name = (await window.projects()).find(entry => entry.folderId === project)?.name ?? 'this project';
        await confirmed(window, `Move ${name} into the Atlas home?`, 'Move', 'Its folder moves into the Atlas home, where agents find it.');
        return remoteErrors(window.adoptProject(project));
      },
    },
    'project:open': { args: [folderId], handle: async (window, project: string) => (await window.open(project)).change() },
    'planning:snapshot': { args: [folderId], handle: async (window, project: string) => (await window.readable(project)).request('folder.snapshot', { folderId: project }) },
    'planning:document': { args: [folderId, relativePath], handle: async (window, project: string, file: string) => (await window.readable(project)).request('folder.document', { folderId: project, path: file }) },
    'planning:diagrams': { args: [folderId, workId], handle: async (window, project: string, work: string) => (await window.readable(project)).request('folder.diagrams', { folderId: project, work }) },
    'planning:diagram': { args: [folderId, workId, diagramPath], handle: async (window, project: string, work: string, file: string) => (await window.readable(project)).request('folder.diagram', { folderId: project, work, path: file }) },
    'planning:references': { args: [folderId, nullable(workId), relativePath], handle: async (window, project: string, work: string | null, file: string) => (await window.readable(project)).request('folder.references', { folderId: project, work, path: file }) },
    'planning:diagramIndex': { args: [folderId], handle: async (window, project: string) => (await window.readable(project)).request('folder.diagramIndex', { folderId: project }) },
    // Views count in the document use of the computer the project is on.
    'usage:view': { args: [folderId, viewEvent], handle: async (window, project: string, event) => { await (await window.readable(project)).request('folder.recordView', { folderId: project, event }); } },
    'ui:load': { args: [], handle: window => loadUi(manager, window) },
    'ui:save': { args: [uiState], handle: (window, state: UiState) => saveUi(manager, window, state) },
    'shell:reveal': { args: [folderId, relativePath], handle: (window, project: string, file: string) => revealInside(window, project, file) },
    'shell:openExternal': {
      args: [url],
      handle: async (window, value: string) => {
        const external = externalUrl(value);
        if (!external) throw new AtlasError('forbidden', 'Only web and mail links open outside Atlas.');
        await confirmed(window, 'Open this address in your browser?', 'Open', external);
        await shell.openExternal(external);
      },
    },
    'shell:copy': { args: [string({ min: 1, max: 10000 })], handle: (_window, text: string) => { clipboard.writeText(text); } },
    'app:theme': { args: [], handle: () => manager.context.state.theme },
    // Every window follows the native theme through prefers-color-scheme, so one change reaches them all.
    'app:setTheme': { args: [themePreference], handle: (_window, preference: ThemePreference) => { manager.context.state.setTheme(preference); nativeTheme.themeSource = preference; } },
    // Help › About Atlas, which the window shows: versions and the data folder, nothing a page could misuse.
    'app:about': { args: [], handle: () => actions.about() },
    'app:command': {
      args: [command],
      handle: async (window, name: string) => {
        const contents = window.win.webContents;
        const devTools = manager.context.devTools;
        switch (name) {
          // A page cannot open windows without end, quit (also by closing the last window) or pile up
          // dialogs: these follow a person's press or their answer to Atlas's question.
          case 'newWindow': await confirmed(window, 'Open a new Atlas window?', 'Open'); manager.create(window.computer); return;
          case 'closeWindow': if (manager.all().filter(other => !other.closing && !other.win.isDestroyed()).length <= 1) await confirmed(window, 'Close the last window and exit Atlas?', 'Close'); window.win.close(); return;
          case 'quit': await confirmed(window, 'Exit Atlas?', 'Exit'); app.quit(); return;
          case 'openLogs': await confirmed(window, 'Open the folder with Atlas’s logs?', 'Open'); actions.openLogs(); return;
          // Edit acts on the window's focused element, as the native Edit menu does.
          case 'undo': contents.undo(); return;
          case 'redo': contents.redo(); return;
          case 'cut': contents.cut(); return;
          case 'copy': contents.copy(); return;
          case 'paste': requireActivation(window); contents.paste(); return;
          case 'selectAll': contents.selectAll(); return;
          case 'zoomIn': window.zoom('in'); return;
          case 'zoomOut': window.zoom('out'); return;
          case 'resetZoom': window.zoom('reset'); return;
          case 'toggleFullScreen': window.win.setFullScreen(!window.win.isFullScreen()); return;
          case 'reload': if (devTools) contents.reload(); return;
          case 'toggleDevTools': if (devTools) contents.toggleDevTools(); return;
        }
      },
    },
    'plan:export': {
      args: [folderId, workId],
      handle: async (window, project: string, work: string) => {
        const view = await window.readable(project);
        const prepared = await view.request('plan.exportPrepare', { folderId: view.folderId, work });
        try {
          if (prepared.warnings.length) {
            const { response } = await window.oneDialog(() => dialog.showMessageBox(window.win, { type: 'warning', title: 'Export plan', message: 'Export this plan anyway?', detail: prepared.warnings.join('\n'), buttons: ['Export', 'Cancel'], defaultId: 0, cancelId: 1 }));
            if (response !== 0) return null;
          }
          const choice = await window.oneDialog(() => dialog.showSaveDialog(window.win, {
            title: 'Export plan', buttonLabel: 'Export',
            defaultPath: path.join(app.getPath('documents'), prepared.fileName),
            filters: [{ name: 'Atlas plan export', extensions: ['html'] }],
          }));
          if (choice.canceled || !choice.filePath) return null;
          const download = await view.client.fetch('/api/exports/' + prepared.token, 300000);
          if (!download.ok) throw new AtlasError('unavailable', 'The export could not be downloaded from ' + (view.remote?.hostName ?? 'the host') + '. Export the plan again.');
          const bytes = Buffer.from(await download.arrayBuffer());
          await writeFile(choice.filePath, bytes);
          manager.context.log.info('Plan exported', { work, bytes: bytes.length, remote: Boolean(view.remote) });
          return { path: choice.filePath, bytes: bytes.length, warnings: prepared.warnings };
        } finally {
          await view.request('plan.exportDrop', { token: prepared.token }).catch(() => undefined);
        }
      },
    },
    'plan:importChoose': {
      args: [folderId],
      handle: async (window, project: string) => {
        const view = await window.readable(project);
        const choice = await window.oneDialog(() => dialog.showOpenDialog(window.win, { title: 'Import plan', buttonLabel: 'Preview', properties: ['openFile'], filters: [{ name: 'Atlas plan export', extensions: ['html'] }] }));
        if (choice.canceled || !choice.filePaths[0]) return null;
        const file = choice.filePaths[0];
        let read;
        // A folder on another computer gets the file sent to it; this computer's host reads it in place.
        try { read = view.remote ? await sendImport(view, file) : await view.request('plan.importRead', { folderId: view.folderId, file }); } catch (error) {
          // A file that is not a valid export, or a folder it cannot go into, is refused before anything is written.
          if (window.win.isDestroyed()) throw new AtlasError('cancelled', (error as Error).message);
          await dialog.showMessageBox(window.win, { type: 'error', title: 'Import plan', message: 'This file cannot be imported.', detail: (error as Error).message + '\n\nNothing was written.', buttons: ['OK'] });
          // Already explained in the dialog; the window does not repeat it.
          throw new AtlasError('cancelled', (error as Error).message);
        }
        if (window.win.isDestroyed()) { await view.request('plan.importDrop', { token: read.token }).catch(() => undefined); return null; }
        // One preview per window: a newer one replaces (and releases) the window's previous one.
        await dropImports(entry => entry.window === window.id);
        pendingImports.set(read.token, { window: window.id, folder: view });
        const preview: ImportPreview = { ...read, file: path.basename(file), warnings: [] };
        return preview;
      },
    },
    'plan:importConfirm': {
      args: [token],
      handle: async (window, key: string) => {
        const pending = pendingImports.get(key);
        if (!pending || pending.window !== window.id || window.views.get(pending.folder.folderId) !== pending.folder) throw new AtlasError('invalid-argument', 'This import preview expired. Choose the file again.');
        const view = pending.folder;
        pendingImports.delete(key);
        // The explicit user action that writes into the planning folder; nothing is committed.
        try { return await view.request('plan.importConfirm', { folderId: view.folderId, token: key }, { timeout: 600000 }); }
        catch (error) {
          if (/rolled back/i.test((error as Error).message)) await dialog.showMessageBox(window.win, { type: 'error', title: 'Import plan', message: 'The import was rolled back.', detail: (error as Error).message, buttons: ['OK'] });
          throw error;
        }
      },
    },
    'plan:importCancel': {
      args: [token],
      handle: async (window, key: string) => { await dropImports((entry, entryKey) => entryKey === key && entry.window === window.id); },
    },
    'computers:list': { args: [], handle: () => connections.computers() },
    'computers:switch': {
      args: [computer, boolean],
      handle: async (window, id: string | null, newWindow: boolean) => {
        if (id !== null && !connections.has(id)) throw new AtlasError('not-found', 'This computer is not paired. Connect to it again.');
        if (newWindow) await confirmed(window, 'Open that computer in a new window?', 'Open');
        void dropImports(entry => entry.window === window.id);
        manager.switchComputer(window, id, newWindow);
      },
    },
    'remote:pair': {
      args: [pairingLink, nullable(pairingCode)],
      handle: async (window, link: string, code: string | null) => {
        await confirmed(window, `Pair with the Atlas at ${pairingHost(link, code)}?`, 'Pair', 'This app can then work on that computer\'s projects.');
        const paired = await remoteErrors(connections.pair(link, code ?? undefined));
        // Windows already showing this computer read through the new pairing.
        manager.rebindRemote(paired.hostId!);
        return paired;
      },
    },
    'remote:forget': { args: [hostId], handle: (_window, id: string) => manager.forgetComputer(id) },
    // Remote access of a computer: this one's (settings too), or a paired one's when this app may manage access there.
    'access:state': { args: [computer], handle: (_window, id: string | null) => remoteErrors(connections.use(id, client => client.request('access.state', {}))) },
    'access:update': {
      args: [accessSettings],
      handle: async (window, settings: AccessSettings) => {
        // Turning remote access on, or moving it to another address, changes who can reach this
        // computer; another port does not. The press counts from when the change came: reading the
        // state may wait for Tailscale.
        const pressed = window.takeActivation();
        const current = (await owner().request('access.state', {})).settings.network;
        const next = settings.network;
        if (next.enabled && (!current.enabled || next.address !== current.address) && !pressed
          && !(await window.ask(`Let paired devices reach this computer${next.address ? ' at ' + next.address : ''}?`, 'Allow'))) throw new AtlasError('cancelled', 'Cancelled.');
        return owner().request('access.update', { settings: settings as never });
      },
    },
    'access:pairingCreate': {
      args: [computer, nullable(ipAddress), grant],
      handle: async (window, id: string | null, address: string | null, granted: PairingGrant): Promise<PairingLinkView> => {
        // A computer no longer paired fails here, before the question.
        if (id !== null && !connections.has(id)) throw new AtlasError('not-found', 'This computer is not paired. Connect to it again.');
        const detail = granted.manageAccess ? 'A device that uses it can work on the projects and manage who else has access.' : 'A device that uses it can work on the projects.';
        if (!(await window.ask(`Create a pairing link for ${id === null ? 'this computer' : connections.name(id)}?`, 'Create', detail))) throw new AtlasError('cancelled', 'Cancelled.');
        const link = await remoteErrors(connections.use(id, client => client.request('access.pairingCreate', { address, ...granted })));
        const qrSvg = link.url ? await QRCode.toString(link.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } }) : null;
        return { ...link, qrSvg };
      },
    },
    'access:pairingRevoke': { args: [computer, pairingCode], handle: (_window, id: string | null, code: string) => remoteErrors(connections.use(id, client => client.request('access.pairingRevoke', { code }))) },
    'access:devices': { args: [computer], handle: (_window, id: string | null) => remoteErrors(connections.use(id, client => client.request('access.devices', {}))) },
    'access:deviceRevoke': { args: [computer, deviceId], handle: (_window, id: string | null, device: string) => remoteErrors(connections.use(id, client => client.request('access.deviceRevoke', { deviceId: device }))) },
  };
}

/** A paired computer's errors as the window shows them (a refused credential is "forbidden" there). */
async function remoteErrors<T>(pending: Promise<T>): Promise<T> {
  try { return await pending; } catch (error) { throw hostError(error); }
}
function hostError(error: unknown) {
  return error instanceof HostRequestError ? new AtlasError(error.code === 'unauthorized' ? 'forbidden' : error.code, error.message) : error;
}

/** Accept only the Atlas renderer's own top-level frame. */
function trustedSender(event: IpcMainInvokeEvent, manager: WindowManager): AtlasWindow | null {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return null;
  const owner = BrowserWindow.fromWebContents(event.sender);
  const window = owner ? manager.fromId(owner.id) : undefined;
  if (!window) return null;
  const expected = originOf(manager.context.devUrl ?? rendererOrigin);
  return expected !== null && originOf(frame.url) === expected ? window : null;
}

export function registerIpc(manager: WindowManager, actions: { openLogs(): void; about(): AboutInfo }) {
  const table = channels(manager, actions);
  for (const name of invokeChannels) {
    const channel = table[name];
    ipcMain.handle(name, async (event, ...values: unknown[]): Promise<Result<unknown>> => {
      const window = trustedSender(event, manager);
      if (!window) {
        manager.context.log.warn('Rejected a message from an untrusted sender', { channel: name });
        return { ok: false, error: { code: 'forbidden', message: 'This window may not send that message.' } };
      }
      try {
        const args = argumentsOf(channel.args, values);
        return { ok: true, value: await (channel.handle as (window: AtlasWindow, ...args: unknown[]) => unknown)(window, ...args) ?? null };
      } catch (error) {
        const { value, expected } = toErrorValue(error);
        manager.context.log.write(expected ? 'info' : 'error', 'Request failed: ' + name, expected ? value : error);
        return { ok: false, error: value };
      }
    });
  }
}
