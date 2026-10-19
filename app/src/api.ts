// The renderer's view of the main process: typed calls over the preload bridge. Failures arrive as
// structured values and are rethrown here as AtlasError, so components can check `code`.
import type { AtlasBridge, ErrorCode, Result } from '../shared/contract';

declare global {
  interface Window { atlas: AtlasBridge }
}

export class AtlasError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'AtlasError'; this.code = code; }
}

async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const result = await pending;
  if (result.ok) return result.value;
  throw new AtlasError(result.error.code, result.error.message);
}

type Unwrapped = {
  [K in keyof AtlasBridge]: AtlasBridge[K] extends (...args: infer A) => Promise<Result<infer R>> ? (...args: A) => Promise<R> : AtlasBridge[K];
};

const bridge = (): AtlasBridge => window.atlas;

export const api: Unwrapped = {
  info: () => unwrap(bridge().info()),
  projects: () => unwrap(bridge().projects()),
  createProject: (name, workspaces) => unwrap(bridge().createProject(name, workspaces)),
  search: query => unwrap(bridge().search(query)),
  scanFolder: folder => unwrap(bridge().scanFolder(folder)),
  chooseFolder: () => unwrap(bridge().chooseFolder()),
  updateProject: (project, change) => unwrap(bridge().updateProject(project, change)),
  adoptProject: project => unwrap(bridge().adoptProject(project)),
  openProject: project => unwrap(bridge().openProject(project)),
  closeProject: project => unwrap(bridge().closeProject(project)),
  snapshot: project => unwrap(bridge().snapshot(project)),
  document: (project, path) => unwrap(bridge().document(project, path)),
  diagrams: (project, work) => unwrap(bridge().diagrams(project, work)),
  diagram: (project, work, path) => unwrap(bridge().diagram(project, work, path)),
  references: (project, work, path) => unwrap(bridge().references(project, work, path)),
  diagramIndex: project => unwrap(bridge().diagramIndex(project)),
  recordView: (project, event) => unwrap(bridge().recordView(project, event)),
  loadUi: () => unwrap(bridge().loadUi()),
  saveUi: state => unwrap(bridge().saveUi(state)),
  resolveReferences: (project, work, items) => unwrap(bridge().resolveReferences(project, work, items)),
  workSessions: (project, work) => unwrap(bridge().workSessions(project, work)),
  workTimeline: (project, work) => unwrap(bridge().workTimeline(project, work)),
  reveal: (project, path) => unwrap(bridge().reveal(project, path)),
  openExternal: url => unwrap(bridge().openExternal(url)),
  openReference: (project, work, reference) => unwrap(bridge().openReference(project, work, reference)),
  openWorkFolder: (project, work) => unwrap(bridge().openWorkFolder(project, work)),
  resumeSession: (project, work, session) => unwrap(bridge().resumeSession(project, work, session)),
  editor: () => unwrap(bridge().editor()),
  setEditor: editor => unwrap(bridge().setEditor(editor)),
  copy: text => unwrap(bridge().copy(text)),
  command: command => unwrap(bridge().command(command)),
  theme: () => unwrap(bridge().theme()),
  setTheme: preference => unwrap(bridge().setTheme(preference)),
  about: () => unwrap(bridge().about()),
  exportPlan: (project, work) => unwrap(bridge().exportPlan(project, work)),
  chooseImport: project => unwrap(bridge().chooseImport(project)),
  confirmImport: token => unwrap(bridge().confirmImport(token)),
  cancelImport: token => unwrap(bridge().cancelImport(token)),
  computers: () => unwrap(bridge().computers()),
  switchComputer: (hostId, newWindow) => unwrap(bridge().switchComputer(hostId, newWindow)),
  pairRemote: (link, code) => unwrap(bridge().pairRemote(link, code)),
  forgetRemote: hostId => unwrap(bridge().forgetRemote(hostId)),
  accessState: hostId => unwrap(bridge().accessState(hostId)),
  updateAccess: settings => unwrap(bridge().updateAccess(settings)),
  createPairing: (hostId, address, grant) => unwrap(bridge().createPairing(hostId, address, grant)),
  revokePairing: (hostId, code) => unwrap(bridge().revokePairing(hostId, code)),
  devices: hostId => unwrap(bridge().devices(hostId)),
  revokeDevice: (hostId, deviceId) => unwrap(bridge().revokeDevice(hostId, deviceId)),
  onChanged: listener => bridge().onChanged(listener),
  onProjectsChanged: listener => bridge().onProjectsChanged(listener),
  onMenu: listener => bridge().onMenu(listener),
  onAccessChanged: listener => bridge().onAccessChanged(listener),
};

/** A file inside a project's folder, served by the window's own `atlas:` protocol. */
export function fileUrl(project: string, path: string) {
  return 'atlas://planning/' + project + '/' + path.split('/').map(encodeURIComponent).join('/');
}
