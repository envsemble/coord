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
const isChange = (value: unknown): value is ProjectChange => Boolean(value && typeof value === 'object' && typeof (value as ProjectChange).revision === 'number' && typeof (value as ProjectChange).projectId === 'string');
const isMenu = (value: unknown): value is MenuCommand => typeof value === 'string' && (menuCommands as readonly string[]).includes(value);
const isAccess = (value: unknown): value is AccessChange => Boolean(value && typeof value === 'object' && 'state' in value && 'hostId' in value);
const isProjects = (value: unknown): value is ProjectsChange => Boolean(value && typeof value === 'object' && 'hostId' in value);

const api: AtlasBridge = {
  info: () => call('window:info'),
  projects: () => call('projects:list'),
  createProject: (name, folders) => call('projects:create', name, folders),
  search: query => call('search:query', query),
  chooseFolder: () => call('projects:chooseFolder'),
  updateProject: (projectId, change) => call('projects:update', projectId, change),
  openProject: projectId => call('project:open', projectId),
  closeProject: projectId => call('project:close', projectId),
  snapshot: projectId => call('project:snapshot', projectId),
  work: projectId => call('project:work', projectId),
  document: (projectId, path) => call('project:document', projectId, path),
  diagrams: (projectId, work) => call('project:diagrams', projectId, work),
  diagram: (projectId, work, path) => call('project:diagram', projectId, work, path),
  references: (projectId, work, path) => call('project:references', projectId, work, path),
  diagramIndex: projectId => call('project:diagramIndex', projectId),
  projectStatistics: (projectId, from, to, unit) => call('project:statistics', projectId, from, to, unit),
  allStatistics: (from, to, unit) => call('projects:statistics', from, to, unit),
  loadUi: () => call('ui:load'),
  saveUi: state => call('ui:save', state),
  resolveReferences: (projectId, items) => call('references:resolve', projectId, items),
  workSessions: (projectId, work) => call('work:sessions', projectId, work),
  workTimeline: (projectId, work) => call('work:timeline', projectId, work),
  reveal: (projectId, path) => call('shell:reveal', projectId, path),
  openExternal: url => call('shell:openExternal', url),
  openReference: (projectId, reference) => call('shell:openReference', projectId, reference),
  openShown: (place, path) => call('shell:openShown', place, path),
  editor: () => call('app:editor'),
  setEditor: editor => call('app:setEditor', editor),
  copy: text => call('shell:copy', text),
  theme: () => call('app:theme'),
  setTheme: preference => call('app:setTheme', preference),
  about: () => call('app:about'),
  command: command => call('app:command', command),
  exportPlan: (projectId, work) => call('plan:export', projectId, work),
  chooseImport: projectId => call('plan:importChoose', projectId),
  confirmImport: token => call('plan:importConfirm', token),
  cancelImport: token => call('plan:importCancel', token),
  computers: () => call('computers:list'),
  switchComputer: (hostId, newWindow) => call('computers:switch', hostId, newWindow),
  pairComputer: (link, code) => call('computers:pair', link, code),
  forgetComputer: hostId => call('computers:forget', hostId),
  accessState: hostId => call('access:state', hostId),
  updateAccess: settings => call('access:update', settings),
  createPairing: (hostId, address, grant) => call('access:pairingCreate', hostId, address, grant),
  revokePairing: (hostId, code) => call('access:pairingRevoke', hostId, code),
  devices: hostId => call('access:devices', hostId),
  revokeDevice: (hostId, deviceId) => call('access:deviceRevoke', hostId, deviceId),
  onChanged: listener => subscribe('project:changed', isChange, listener),
  onProjectsChanged: listener => subscribe('projects:changed', isProjects, listener),
  onMenu: listener => subscribe('menu:command', isMenu, listener),
  onAccessChanged: listener => subscribe('access:changed', isAccess, listener),
};

contextBridge.exposeInMainWorld('atlas', api);
