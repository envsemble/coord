// The only bridge between the sandboxed window and the main process. It exposes one object,
// `window.atlas`, whose methods map one-to-one onto the fixed channel list; the renderer never
// sees ipcRenderer itself. Results, including errors, cross as plain structured values.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { eventChannels, menuCommands, type AccessChange, type AtlasBridge, type EventChannel, type InvokeChannel, type MenuCommand, type ProjectChange, type ProjectsChange, type Result } from '../shared/contract.ts';

function call<T>(channel: InvokeChannel, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args).catch(() => ({ ok: false, error: { code: 'internal', message: 'Atlas could not reach its main process.' } }));
}

function subscribe<T>(channel: EventChannel, accept: (value: unknown) => value is T, listener: (value: T) => void) {
  if (!eventChannels.includes(channel)) throw new Error('Unknown channel');
  const handler = (_event: IpcRendererEvent, value: unknown) => { if (accept(value)) listener(value); };
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}
const isChange = (value: unknown): value is ProjectChange => Boolean(value && typeof value === 'object' && typeof (value as ProjectChange).revision === 'number' && typeof (value as ProjectChange).project === 'string');
const isMenu = (value: unknown): value is MenuCommand => typeof value === 'string' && (menuCommands as readonly string[]).includes(value);
const isAccess = (value: unknown): value is AccessChange => Boolean(value && typeof value === 'object' && 'state' in value && 'hostId' in value);
const isProjects = (value: unknown): value is ProjectsChange => Boolean(value && typeof value === 'object' && 'hostId' in value);

const api: AtlasBridge = {
  info: () => call('window:info'),
  projects: () => call('projects:list'),
  createProject: (name, repositories) => call('projects:create', name, repositories),
  updateProject: (project, change) => call('projects:update', project, change),
  openProject: project => call('project:open', project),
  snapshot: project => call('planning:snapshot', project),
  document: (project, path) => call('planning:document', project, path),
  diagrams: (project, work) => call('planning:diagrams', project, work),
  diagram: (project, work, path) => call('planning:diagram', project, work, path),
  references: (project, work, path) => call('planning:references', project, work, path),
  diagramIndex: project => call('planning:diagramIndex', project),
  recordView: (project, event) => call('usage:view', project, event),
  loadUi: () => call('ui:load'),
  saveUi: state => call('ui:save', state),
  reveal: (project, path) => call('shell:reveal', project, path),
  openExternal: url => call('shell:openExternal', url),
  copy: text => call('shell:copy', text),
  theme: () => call('app:theme'),
  setTheme: preference => call('app:setTheme', preference),
  about: () => call('app:about'),
  command: command => call('app:command', command),
  exportPlan: (project, work) => call('plan:export', project, work),
  chooseImport: project => call('plan:importChoose', project),
  confirmImport: token => call('plan:importConfirm', token),
  cancelImport: token => call('plan:importCancel', token),
  computers: () => call('computers:list'),
  switchComputer: (hostId, newWindow) => call('computers:switch', hostId, newWindow),
  pairRemote: (link, code) => call('remote:pair', link, code),
  forgetRemote: hostId => call('remote:forget', hostId),
  accessState: hostId => call('access:state', hostId),
  updateAccess: settings => call('access:update', settings),
  createPairing: (hostId, address, grant) => call('access:pairingCreate', hostId, address, grant),
  revokePairing: (hostId, code) => call('access:pairingRevoke', hostId, code),
  devices: hostId => call('access:devices', hostId),
  revokeDevice: (hostId, deviceId) => call('access:deviceRevoke', hostId, deviceId),
  onChanged: listener => subscribe('planning:changed', isChange, listener),
  onProjectsChanged: listener => subscribe('projects:changed', isProjects, listener),
  onMenu: listener => subscribe('menu:command', isMenu, listener),
  onAccessChanged: listener => subscribe('access:changed', isAccess, listener),
};

contextBridge.exposeInMainWorld('atlas', api);
