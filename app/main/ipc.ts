// The fixed list of messages a window may send. Each channel declares a validator per argument;
// calls with the wrong number or shape of arguments, from a subframe, or from a page that is not
// the Atlas renderer are rejected. Results and errors cross back as structured values. Planning
// requests go to the host that owns the window's folder; a folder on another computer only reads.
import { lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { HostRequestError, type HostClient } from '@envsemble/atlas-host';
import { resolveDocument } from '@envsemble/atlas-planning';
import { accessSettings } from '@envsemble/atlas-host/validate';
import { invokeChannels, type ImportPreview, type InvokeChannel, type PairingLinkView, type Result } from '../shared/contract.ts';
import { absolutePath, argumentsOf, command, folderId, ipAddress, modelHandle, nullable, optional, pairingCode, relativePath, string, token, uiState, url, viewEvent, workId, type Validator } from '../shared/validate.ts';
import { AtlasError, toErrorValue } from './errors.ts';
import type { FolderView } from './folderView.ts';
import { originOf, rendererOrigin } from './protocol.ts';
import { externalUrl, type AtlasWindow, type WindowManager } from './windows.ts';

type Handler = (window: AtlasWindow, ...args: never[]) => unknown;
interface Channel { args: Validator<unknown>[]; handle: Handler }

const hostId = string({ min: 8, max: 64, pattern: /^[a-zA-Z0-9-]+$/ });
const deviceId = string({ min: 34, max: 34, pattern: /^d-[a-f0-9]{32}$/ });
const pairingLink = string({ min: 3, max: 2048 });

/** Import previews belong to the window that chose the file. */
const pendingImports = new Map<string, { window: number; folder: FolderView }>();
export async function dropImports(matches: (entry: { window: number; folder: FolderView }, key: string) => boolean) {
  for (const [key, entry] of [...pendingImports]) {
    if (!matches(entry, key)) continue;
    pendingImports.delete(key);
    await entry.folder.request('plan.importDrop', { token: key }).catch(() => undefined);
  }
}

/** Reveal a file or folder inside the window's planning folder on this computer (never outside it, never hidden parts). */
async function revealInside(folder: FolderView, relative: string) {
  if (folder.remote) throw new AtlasError('forbidden', 'Files of a planning folder on another computer cannot be shown in a folder here.');
  const root = folder.root;
  try { shell.showItemInFolder(await resolveDocument(root, relative)); return; } catch { /* Perhaps a folder. */ }
  const base = await realpath(root);
  const candidate = await realpath(path.resolve(base, relative)).catch(() => null);
  const inside = candidate ? path.relative(base, candidate) : '..';
  if (!candidate || inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some(part => part.startsWith('.')) || !(await lstat(candidate)).isDirectory()) {
    throw new AtlasError('forbidden', 'Only files and folders inside the open planning folder can be shown.');
  }
  shell.showItemInFolder(candidate);
}

/** Local writes (import, recording views) and the host's own settings are this computer's only. */
function local(folder: FolderView, action: string) {
  if (folder.remote) throw new AtlasError('forbidden', `${action} is not available for a planning folder on another computer; it opens read-only here.`);
  return folder;
}

export function channels(manager: WindowManager, actions: { openLogs(): void; about(window: AtlasWindow): void }): Record<InvokeChannel, Channel> {
  const folder = (window: AtlasWindow): FolderView => {
    const view = window.requireFolder();
    if (!view.folderId) throw new AtlasError(view.status === 'missing' ? 'folder-missing' : 'folder-invalid', view.error ?? 'This planning folder cannot be read.');
    return view;
  };
  const { connections } = manager.context;
  const owner = (): HostClient => connections.local;
  return {
    'window:info': { args: [], handle: window => window.info() },
    'window:recents': { args: [], handle: () => manager.recents() },
    'planning:snapshot': { args: [], handle: window => { const view = folder(window); return view.request('folder.snapshot', { folderId: view.folderId }); } },
    'planning:document': { args: [relativePath], handle: (window, file: string) => { const view = folder(window); return view.request('folder.document', { folderId: view.folderId, path: file }); } },
    'planning:models': { args: [workId], handle: (window, work: string) => { const view = folder(window); return view.request('folder.models', { folderId: view.folderId, work }); } },
    'planning:model': { args: [workId, modelHandle], handle: (window, work: string, handle: string) => { const view = folder(window); return view.request('folder.model', { folderId: view.folderId, work, handle }); } },
    'planning:references': { args: [nullable(workId), relativePath], handle: (window, work: string | null, file: string) => { const view = folder(window); return view.request('folder.references', { folderId: view.folderId, work, path: file }); } },
    'planning:diagrams': { args: [], handle: window => { const view = folder(window); return view.request('folder.diagrams', { folderId: view.folderId }); } },
    'usage:view': {
      args: [viewEvent],
      // Views are this computer's usage statistics; a folder on another computer is not counted here.
      handle: async (window, event) => { const view = folder(window); if (!view.remote) await view.request('folder.recordView', { folderId: view.folderId, event }); },
    },
    'ui:load': { args: [], handle: window => manager.context.state.ui(window.requireFolder().root) },
    'ui:save': { args: [uiState], handle: (window, state) => { manager.context.state.updateFolder(window.requireFolder().root, { ui: state }); } },
    'shell:reveal': { args: [relativePath], handle: (window, file: string) => revealInside(folder(window), file) },
    'shell:openExternal': {
      args: [url],
      handle: async (_window, value: string) => {
        const external = externalUrl(value);
        if (!external) throw new AtlasError('forbidden', 'Only web and mail links open outside Atlas.');
        await shell.openExternal(external);
      },
    },
    'shell:copy': { args: [string({ min: 1, max: 10000 })], handle: (_window, text: string) => { clipboard.writeText(text); } },
    'app:command': {
      args: [command, optional(absolutePath)],
      handle: async (window, name: string, argument?: string) => {
        switch (name) {
          case 'openFolder': await manager.chooseFolder(window); return;
          case 'openRecent': if (!argument) throw new AtlasError('invalid-argument', 'Choose a recent folder.'); await manager.openRecent(argument, window); return;
          case 'newWindow': await manager.create(null); return;
          case 'locate': await manager.locate(window); return;
          case 'closeWindow': window.win.close(); return;
          case 'openLogs': actions.openLogs(); return;
          case 'about': actions.about(window); return;
        }
      },
    },
    'plan:export': {
      args: [workId],
      handle: async (window, work: string) => {
        const view = folder(window);
        const prepared = await view.request('plan.exportPrepare', { folderId: view.folderId, work });
        try {
          if (prepared.warnings.length) {
            const { response } = await dialog.showMessageBox(window.win, { type: 'warning', title: 'Export plan', message: 'Export this plan anyway?', detail: prepared.warnings.join('\n'), buttons: ['Export', 'Cancel'], defaultId: 0, cancelId: 1 });
            if (response !== 0) return null;
          }
          const choice = await dialog.showSaveDialog(window.win, {
            title: 'Export plan', buttonLabel: 'Export',
            defaultPath: path.join(app.getPath('documents'), prepared.fileName),
            filters: [{ name: 'Atlas plan export', extensions: ['html'] }],
          });
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
      args: [],
      handle: async window => {
        const view = local(folder(window), 'Importing a plan');
        const choice = await dialog.showOpenDialog(window.win, { title: 'Import plan', buttonLabel: 'Preview', properties: ['openFile'], filters: [{ name: 'Atlas plan export', extensions: ['html'] }] });
        if (choice.canceled || !choice.filePaths[0]) return null;
        const file = choice.filePaths[0];
        let read;
        try { read = await view.request('plan.importRead', { folderId: view.folderId, file }); } catch (error) {
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
        const view = folder(window);
        if (!pending || pending.window !== window.id || pending.folder !== view) throw new AtlasError('invalid-argument', 'This import preview expired. Choose the file again.');
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
    'remote:list': { args: [], handle: () => connections.list() },
    'remote:pair': {
      args: [pairingLink, nullable(pairingCode)],
      handle: async (_window, link: string, code: string | null) => {
        try { return await connections.pair(link, code ?? undefined); }
        catch (error) { throw error instanceof HostRequestError ? new AtlasError(error.code === 'unauthorized' ? 'forbidden' : error.code, error.message) : error; }
      },
    },
    'remote:folders': { args: [hostId], handle: (_window, id: string) => connections.client(id).request('folders.shared', {}, { timeout: 20000 }) },
    'remote:open': { args: [hostId, folderId], handle: async (window, id: string, folder: string) => { await manager.openRemote(id, folder, window); } },
    'remote:forget': {
      args: [hostId],
      handle: async (_window, id: string) => {
        for (const other of manager.all()) if (other.remote?.hostId === id) other.win.close();
        connections.forget(id);
      },
    },
    'access:state': { args: [], handle: () => owner().request('access.state', {}) },
    'access:update': { args: [accessSettings], handle: (_window, settings) => owner().request('access.update', { settings: settings as never }) },
    'access:chooseFolder': {
      args: [],
      handle: async window => {
        const choice = await dialog.showOpenDialog(window.win, { title: 'Share a planning folder', buttonLabel: 'Share', properties: ['openDirectory'] });
        if (choice.canceled || !choice.filePaths[0]) return null;
        const { inspectPlanningRoot } = await import('@envsemble/atlas-planning');
        try { return (await inspectPlanningRoot(choice.filePaths[0])).path; }
        catch (error) { throw new AtlasError('invalid-argument', 'This folder is not a planning folder: ' + (error as Error).message); }
      },
    },
    'access:pairingCreate': {
      args: [nullable(ipAddress)],
      handle: async (_window, address: string | null): Promise<PairingLinkView> => {
        const link = await owner().request('access.pairingCreate', { address });
        const qrSvg = link.url ? await QRCode.toString(link.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } }) : null;
        return { ...link, qrSvg };
      },
    },
    'access:pairingRevoke': { args: [pairingCode], handle: (_window, code: string) => owner().request('access.pairingRevoke', { code }) },
    'access:devices': { args: [], handle: () => owner().request('access.devices', {}) },
    'access:deviceRevoke': { args: [deviceId], handle: (_window, id: string) => owner().request('access.deviceRevoke', { deviceId: id }) },
  };
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

export function registerIpc(manager: WindowManager, actions: { openLogs(): void; about(window: AtlasWindow): void }) {
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
