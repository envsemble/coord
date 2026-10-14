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
  snapshot: () => unwrap(bridge().snapshot()),
  document: path => unwrap(bridge().document(path)),
  diagrams: work => unwrap(bridge().diagrams(work)),
  diagram: (work, path) => unwrap(bridge().diagram(work, path)),
  references: (work, path) => unwrap(bridge().references(work, path)),
  diagramIndex: () => unwrap(bridge().diagramIndex()),
  recordView: event => unwrap(bridge().recordView(event)),
  loadUi: () => unwrap(bridge().loadUi()),
  saveUi: state => unwrap(bridge().saveUi(state)),
  reveal: path => unwrap(bridge().reveal(path)),
  openExternal: url => unwrap(bridge().openExternal(url)),
  copy: text => unwrap(bridge().copy(text)),
  command: command => unwrap(bridge().command(command)),
  theme: () => unwrap(bridge().theme()),
  setTheme: preference => unwrap(bridge().setTheme(preference)),
  about: () => unwrap(bridge().about()),
  exportPlan: work => unwrap(bridge().exportPlan(work)),
  chooseImport: () => unwrap(bridge().chooseImport()),
  confirmImport: token => unwrap(bridge().confirmImport(token)),
  cancelImport: token => unwrap(bridge().cancelImport(token)),
  computers: () => unwrap(bridge().computers()),
  switchComputer: (hostId, newWindow) => unwrap(bridge().switchComputer(hostId, newWindow)),
  folders: hostId => unwrap(bridge().folders(hostId)),
  openFolder: (hostId, path, newWindow) => unwrap(bridge().openFolder(hostId, path, newWindow)),
  chooseFolder: newWindow => unwrap(bridge().chooseFolder(newWindow)),
  browse: (hostId, path) => unwrap(bridge().browse(hostId, path)),
  removeFolder: (hostId, folderId) => unwrap(bridge().removeFolder(hostId, folderId)),
  pairRemote: (link, code) => unwrap(bridge().pairRemote(link, code)),
  forgetRemote: hostId => unwrap(bridge().forgetRemote(hostId)),
  accessState: hostId => unwrap(bridge().accessState(hostId)),
  updateAccess: settings => unwrap(bridge().updateAccess(settings)),
  createPairing: (hostId, address, grant) => unwrap(bridge().createPairing(hostId, address, grant)),
  revokePairing: (hostId, code) => unwrap(bridge().revokePairing(hostId, code)),
  devices: hostId => unwrap(bridge().devices(hostId)),
  revokeDevice: (hostId, deviceId) => unwrap(bridge().revokeDevice(hostId, deviceId)),
  onChanged: listener => bridge().onChanged(listener),
  onMenu: listener => bridge().onMenu(listener),
  onAccessChanged: listener => bridge().onAccessChanged(listener),
  onFoldersChanged: listener => bridge().onFoldersChanged(listener),
};

/** A file inside this window's planning folder, served by the window's own `atlas:` protocol. */
export function fileUrl(path: string) {
  return 'atlas://planning/' + path.split('/').map(encodeURIComponent).join('/');
}
