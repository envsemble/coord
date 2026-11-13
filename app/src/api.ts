// The renderer's view of the main process: typed calls over the preload bridge. Failures arrive as
// structured values and are rethrown here as AtlasError (app/shared/errors.ts), so components can check `code`.
import { withWorkDocuments } from '@envsemble/atlas/host/contract';
import type { AtlasBridge, Result, Snapshot } from '../shared/contract';
import { AtlasError } from '../shared/errors';

export { AtlasError };

declare global {
  interface Window { atlas: AtlasBridge }
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

/** The snapshot arrives with each document once; the work items get theirs again here. */
export const api: Omit<Unwrapped, 'snapshot'> & { snapshot(projectId: string): Promise<Snapshot> } = {
  info: () => unwrap(bridge().info()),
  projects: () => unwrap(bridge().projects()),
  createProject: (name, folders) => unwrap(bridge().createProject(name, folders)),
  search: query => unwrap(bridge().search(query)),
  chooseFolder: () => unwrap(bridge().chooseFolder()),
  updateProject: (projectId, change) => unwrap(bridge().updateProject(projectId, change)),
  openProject: projectId => unwrap(bridge().openProject(projectId)),
  closeProject: projectId => unwrap(bridge().closeProject(projectId)),
  snapshot: projectId => unwrap(bridge().snapshot(projectId)).then(withWorkDocuments),
  work: projectId => unwrap(bridge().work(projectId)),
  document: (projectId, path) => unwrap(bridge().document(projectId, path)),
  diagrams: (projectId, work) => unwrap(bridge().diagrams(projectId, work)),
  diagram: (projectId, work, path) => unwrap(bridge().diagram(projectId, work, path)),
  references: (projectId, work, path) => unwrap(bridge().references(projectId, work, path)),
  diagramIndex: projectId => unwrap(bridge().diagramIndex(projectId)),
  projectStatistics: (projectId, from, to, unit) => unwrap(bridge().projectStatistics(projectId, from, to, unit)),
  allStatistics: (from, to, unit) => unwrap(bridge().allStatistics(from, to, unit)),
  loadUi: () => unwrap(bridge().loadUi()),
  saveUi: state => unwrap(bridge().saveUi(state)),
  resolveReferences: (projectId, items) => unwrap(bridge().resolveReferences(projectId, items)),
  workSessions: (projectId, work) => unwrap(bridge().workSessions(projectId, work)),
  workTimeline: (projectId, work) => unwrap(bridge().workTimeline(projectId, work)),
  reveal: (projectId, path) => unwrap(bridge().reveal(projectId, path)),
  openExternal: url => unwrap(bridge().openExternal(url)),
  openReference: (projectId, reference) => unwrap(bridge().openReference(projectId, reference)),
  copy: text => unwrap(bridge().copy(text)),
  command: command => unwrap(bridge().command(command)),
  theme: () => unwrap(bridge().theme()),
  setTheme: preference => unwrap(bridge().setTheme(preference)),
  about: () => unwrap(bridge().about()),
  computers: () => unwrap(bridge().computers()),
  switchComputer: (hostId, newWindow) => unwrap(bridge().switchComputer(hostId, newWindow)),
  pairComputer: (link, code) => unwrap(bridge().pairComputer(link, code)),
  forgetComputer: hostId => unwrap(bridge().forgetComputer(hostId)),
  accessState: hostId => unwrap(bridge().accessState(hostId)),
  updateAccess: settings => unwrap(bridge().updateAccess(settings)),
  createPairing: (hostId, address, grant) => unwrap(bridge().createPairing(hostId, address, grant)),
  revokePairing: (hostId, code) => unwrap(bridge().revokePairing(hostId, code)),
  devices: hostId => unwrap(bridge().devices(hostId)),
  revokeDevice: (hostId, deviceId) => unwrap(bridge().revokeDevice(hostId, deviceId)),
  agents: () => unwrap(bridge().agents()),
  agentChecks: () => unwrap(bridge().agentChecks()),
  chooseAgentProgram: id => unwrap(bridge().chooseAgentProgram(id)),
  clearAgentProgram: id => unwrap(bridge().clearAgentProgram(id)),
  agentFolder: () => unwrap(bridge().agentFolder()),
  connectAgent: id => unwrap(bridge().connectAgent(id)),
  disconnectAgent: id => unwrap(bridge().disconnectAgent(id)),
  onboarding: () => unwrap(bridge().onboarding()),
  finishOnboarding: () => unwrap(bridge().finishOnboarding()),
  onChanged: listener => bridge().onChanged(listener),
  onProjectsChanged: listener => bridge().onProjectsChanged(listener),
  onMenu: listener => bridge().onMenu(listener),
  onAccessChanged: listener => bridge().onAccessChanged(listener),
};

/** A file inside a project's planning folder, served by the window's own `atlas:` protocol. */
export function fileUrl(projectId: string, path: string) {
  return 'atlas://planning/' + projectId + '/' + path.split('/').map(encodeURIComponent).join('/');
}
