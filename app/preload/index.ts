// The only bridge between the sandboxed window and the main process. It exposes one object,
// `window.atlas`, whose methods map one-to-one onto the fixed channel list; the renderer never
// sees ipcRenderer itself. Results, including errors, cross as plain structured values.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { eventChannels, menuCommands, type AccessChange, type AtlasBridge, type EventChannel, type FolderChange, type FoldersChange, type InvokeChannel, type MenuCommand, type Result } from '../shared/contract.ts';

function call<T>(channel: InvokeChannel, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args).catch(() => ({ ok: false, error: { code: 'internal', message: 'Atlas could not reach its main process.' } }));
}

function subscribe<T>(channel: EventChannel, accept: (value: unknown) => value is T, listener: (value: T) => void) {
  if (!eventChannels.includes(channel)) throw new Error('Unknown channel');
  const handler = (_event: IpcRendererEvent, value: unknown) => { if (accept(value)) listener(value); };
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}
const isChange = (value: unknown): value is FolderChange => Boolean(value && typeof value === 'object' && typeof (value as FolderChange).revision === 'number');
const isMenu = (value: unknown): value is MenuCommand => typeof value === 'string' && (menuCommands as readonly string[]).includes(value);
const isAccess = (value: unknown): value is AccessChange => Boolean(value && typeof value === 'object' && 'state' in value && 'hostId' in value);
const isFolders = (value: unknown): value is FoldersChange => Boolean(value && typeof value === 'object' && 'hostId' in value && Array.isArray((value as FoldersChange).folders));

const api: AtlasBridge = {
  info: () => call('window:info'),
  snapshot: () => call('planning:snapshot'),
  document: path => call('planning:document', path),
  models: work => call('planning:models', work),
  model: (work, handle) => call('planning:model', work, handle),
  references: (work, path) => call('planning:references', work, path),
  diagrams: () => call('planning:diagrams'),
  recordView: event => call('usage:view', event),
  loadUi: () => call('ui:load'),
  saveUi: state => call('ui:save', state),
  reveal: path => call('shell:reveal', path),
  openExternal: url => call('shell:openExternal', url),
  copy: text => call('shell:copy', text),
  command: command => call('app:command', command),
  exportPlan: work => call('plan:export', work),
  chooseImport: () => call('plan:importChoose'),
  confirmImport: token => call('plan:importConfirm', token),
  cancelImport: token => call('plan:importCancel', token),
  computers: () => call('computers:list'),
  switchComputer: (hostId, newWindow) => call('computers:switch', hostId, newWindow),
  folders: hostId => call('folders:list', hostId),
  openFolder: (hostId, path, newWindow) => call('folders:open', hostId, path, newWindow),
  chooseFolder: newWindow => call('folders:choose', newWindow),
  browse: (hostId, path) => call('folders:browse', hostId, path),
  removeFolder: (hostId, folderId) => call('folders:remove', hostId, folderId),
  pairRemote: (link, code) => call('remote:pair', link, code),
  forgetRemote: hostId => call('remote:forget', hostId),
  accessState: hostId => call('access:state', hostId),
  updateAccess: settings => call('access:update', settings),
  createPairing: (hostId, address, grant) => call('access:pairingCreate', hostId, address, grant),
  revokePairing: (hostId, code) => call('access:pairingRevoke', hostId, code),
  devices: hostId => call('access:devices', hostId),
  revokeDevice: (hostId, deviceId) => call('access:deviceRevoke', hostId, deviceId),
  onChanged: listener => subscribe('planning:changed', isChange, listener),
  onMenu: listener => subscribe('menu:command', isMenu, listener),
  onAccessChanged: listener => subscribe('access:changed', isAccess, listener),
  onFoldersChanged: listener => subscribe('folders:changed', isFolders, listener),
};

contextBridge.exposeInMainWorld('atlas', api);
