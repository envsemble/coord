// The fixed list of messages a window may send. Each channel declares a validator per argument;
// calls with the wrong number or shape of arguments, from a subframe, or from a page that is not
// the Atlas renderer are rejected. Results and errors cross back as structured values.
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { resolveDocument } from '@envsemble/atlas-planning';
import { invokeChannels, type InvokeChannel, type Result } from '../shared/contract.ts';
import { absolutePath, argumentsOf, command, modelHandle, nullable, optional, relativePath, token, uiState, url, viewEvent, workId, type Validator } from '../shared/validate.ts';
import { AtlasError, toErrorValue } from './errors.ts';
import { describeImport, describePreview, expectedTarget, planExport, unavailableMessage } from './planExport.ts';
import { originOf, rendererOrigin } from './protocol.ts';
import { externalUrl, type AtlasWindow, type WindowManager } from './windows.ts';

type Handler = (window: AtlasWindow, ...args: never[]) => unknown;
interface Channel { args: Validator<unknown>[]; handle: Handler }

const pendingImports = new Map<string, { window: number; file: string; size: number; modified: number; expires: number }>();

/** Reveal a file or folder inside the window's planning folder (never outside it, never hidden parts). */
async function revealInside(root: string, relative: string) {
  try { shell.showItemInFolder(await resolveDocument(root, relative)); return; } catch { /* Perhaps a folder. */ }
  const base = await realpath(root);
  const candidate = await realpath(path.resolve(base, relative)).catch(() => null);
  const inside = candidate ? path.relative(base, candidate) : '..';
  if (!candidate || inside.startsWith('..') || path.isAbsolute(inside) || inside.split(path.sep).some(part => part.startsWith('.')) || !(await lstat(candidate)).isDirectory()) {
    throw new AtlasError('forbidden', 'Only files and folders inside the open planning folder can be shown.');
  }
  shell.showItemInFolder(candidate);
}

export function channels(manager: WindowManager, actions: { openLogs(): void; about(window: AtlasWindow): void }): Record<InvokeChannel, Channel> {
  const folder = (window: AtlasWindow) => window.requireFolder();
  return {
    'window:info': { args: [], handle: window => window.info() },
    'window:recents': { args: [], handle: () => manager.recents() },
    'planning:snapshot': { args: [], handle: window => folder(window).snapshot() },
    'planning:document': { args: [relativePath], handle: (window, file: string) => folder(window).document(file) },
    'planning:models': { args: [workId], handle: (window, work: string) => folder(window).models(work) },
    'planning:model': { args: [workId, modelHandle], handle: (window, work: string, handle: string) => folder(window).model(work, handle) },
    'planning:references': { args: [nullable(workId), relativePath], handle: (window, work: string | null, file: string) => folder(window).references(work, file) },
    'planning:diagrams': { args: [], handle: window => folder(window).diagrams() },
    'usage:view': { args: [viewEvent], handle: (window, event) => folder(window).recordView(event) },
    'ui:load': { args: [], handle: window => manager.context.state.ui(folder(window).root) },
    'ui:save': { args: [uiState], handle: (window, state) => { manager.context.state.updateFolder(folder(window).root, { ui: state }); } },
    'shell:reveal': { args: [relativePath], handle: (window, file: string) => revealInside(folder(window).root, file) },
    'shell:openExternal': {
      args: [url],
      handle: async (_window, value: string) => {
        const external = externalUrl(value);
        if (!external) throw new AtlasError('forbidden', 'Only web and mail links open outside Atlas.');
        await shell.openExternal(external);
      },
    },
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
        const current = folder(window);
        const item = current.snapshot().work.find(entry => entry.id === work);
        if (!item) throw new AtlasError('not-found', 'This work item is not in the open planning folder.');
        const prepared = await planExport.prepare(current.root, work);
        try {
          if (prepared.warnings.length) {
            const { response } = await dialog.showMessageBox(window.win, { type: 'warning', title: 'Export plan', message: 'Export this plan anyway?', detail: prepared.warnings.join('\n'), buttons: ['Export', 'Cancel'], defaultId: 0, cancelId: 1 });
            if (response !== 0) return null;
          }
          const choice = await dialog.showSaveDialog(window.win, {
            title: 'Export plan', buttonLabel: 'Export',
            defaultPath: path.join(app.getPath('documents'), path.posix.basename(item.path) + '.html'),
            filters: [{ name: 'Atlas plan export', extensions: ['html'] }],
          });
          if (choice.canceled || !choice.filePath) return null;
          await planExport.write(prepared.token, choice.filePath);
          manager.context.log.info('Plan exported', { work, bytes: prepared.bytes });
          return { path: choice.filePath, bytes: prepared.bytes, warnings: prepared.warnings };
        } finally {
          await planExport.discard(prepared.token).catch(() => undefined);
        }
      },
    },
    'plan:importChoose': {
      args: [],
      handle: async window => {
        const current = folder(window);
        if (!(await planExport.available())) throw new AtlasError('unavailable', unavailableMessage);
        const choice = await dialog.showOpenDialog(window.win, { title: 'Import plan', buttonLabel: 'Preview', properties: ['openFile'], filters: [{ name: 'Atlas plan export', extensions: ['html'] }] });
        if (choice.canceled || !choice.filePaths[0]) return null;
        const file = choice.filePaths[0];
        const read = await planExport.read(current.root, file);
        const described = describePreview(read.preview);
        const target = read.target ?? expectedTarget(current.root, described.title, described.location);
        const key = randomUUID();
        for (const [old, entry] of pendingImports) if (entry.expires < Date.now() || entry.window === window.id) pendingImports.delete(old);
        pendingImports.set(key, { window: window.id, file, size: read.size, modified: read.modified, expires: Date.now() + 10 * 60000 });
        return { token: key, file: path.basename(file), ...described, newId: target?.workId ?? null, newFolder: target?.path ?? null, warnings: [] };
      },
    },
    'plan:importConfirm': {
      args: [token],
      handle: async (window, key: string) => {
        const pending = pendingImports.get(key);
        pendingImports.delete(key);
        if (!pending || pending.window !== window.id || pending.expires < Date.now()) throw new AtlasError('invalid-argument', 'This import preview expired. Choose the file again.');
        // The explicit user action that writes into the planning folder; nothing is committed.
        const result = describeImport(await planExport.import(folder(window).root, pending.file, pending.size, pending.modified));
        manager.context.log.info('Plan imported', { workId: result.workId, files: result.files });
        await folder(window).reload();
        return result;
      },
    },
    'plan:importCancel': { args: [token], handle: (_window, key: string) => { pendingImports.delete(key); } },
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
