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
  recents: () => unwrap(bridge().recents()),
  snapshot: () => unwrap(bridge().snapshot()),
  document: path => unwrap(bridge().document(path)),
  models: work => unwrap(bridge().models(work)),
  model: (work, handle) => unwrap(bridge().model(work, handle)),
  references: (work, path) => unwrap(bridge().references(work, path)),
  diagrams: () => unwrap(bridge().diagrams()),
  recordView: event => unwrap(bridge().recordView(event)),
  loadUi: () => unwrap(bridge().loadUi()),
  saveUi: state => unwrap(bridge().saveUi(state)),
  reveal: path => unwrap(bridge().reveal(path)),
  openExternal: url => unwrap(bridge().openExternal(url)),
  command: (command, argument) => unwrap(bridge().command(command, argument)),
  exportPlan: work => unwrap(bridge().exportPlan(work)),
  chooseImport: () => unwrap(bridge().chooseImport()),
  confirmImport: token => unwrap(bridge().confirmImport(token)),
  cancelImport: token => unwrap(bridge().cancelImport(token)),
  onChanged: listener => bridge().onChanged(listener),
  onMenu: listener => bridge().onMenu(listener),
};

/** A file inside this window's planning folder, served by the window's own `atlas:` protocol. */
export function fileUrl(path: string) {
  return 'atlas://planning/' + path.split('/').map(encodeURIComponent).join('/');
}
