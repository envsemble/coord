// The only bridge between the sandboxed window and the main process. It exposes one object,
// `window.atlas`, whose methods map one-to-one onto the fixed channel list; the renderer never
// sees ipcRenderer itself. Results, including errors, cross as plain structured values.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { eventChannels, menuCommands, type AccessState, type AtlasBridge, type EventChannel, type FolderChange, type InvokeChannel, type MenuCommand, type Result } from '../shared/contract.ts';

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
const isAccess = (value: unknown): value is AccessState => Boolean(value && typeof value === 'object' && 'settings' in value && 'status' in value);

const api: AtlasBridge = {
  info: () => call('window:info'),
  recents: () => call('window:recents'),
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
  command: (command, argument) => argument === undefined ? call('app:command', command) : call('app:command', command, argument),
  exportPlan: work => call('plan:export', work),
  chooseImport: () => call('plan:importChoose'),
  confirmImport: token => call('plan:importConfirm', token),
  cancelImport: token => call('plan:importCancel', token),
  remoteHosts: () => call('remote:list'),
  pairRemote: (link, code) => call('remote:pair', link, code),
  remoteFolders: hostId => call('remote:folders', hostId),
  openRemote: (hostId, folderId) => call('remote:open', hostId, folderId),
  forgetRemote: hostId => call('remote:forget', hostId),
  accessState: () => call('access:state'),
  updateAccess: settings => call('access:update', settings),
  chooseSharedFolder: () => call('access:chooseFolder'),
  createPairing: address => call('access:pairingCreate', address),
  revokePairing: code => call('access:pairingRevoke', code),
  devices: () => call('access:devices'),
  revokeDevice: deviceId => call('access:deviceRevoke', deviceId),
  onChanged: listener => subscribe('planning:changed', isChange, listener),
  onMenu: listener => subscribe('menu:command', isMenu, listener),
  onAccessChanged: listener => subscribe('access:changed', isAccess, listener),
};

contextBridge.exposeInMainWorld('atlas', api);
