// Where the Coord home is, apart from everything kept in it, so the hooks that run on every tool
// call find it without loading the rest.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// `~/` and, on Windows, `~\` start a path in the user's home folder.
const tilde = process.platform === 'win32' ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
const expand = (value: string, home: string) => path.resolve(value.replace(tilde, () => home));

/**
 * The Coord home: `~/.coord`, or COORD_HOME; an explicit override (such as --home) takes precedence
 * over both. Its `planning/` folder holds the planning folders (the projects), and Coord keeps its
 * own state beside them: the home database (coord.db) and logs. Electron's own caches stay in
 * Electron's per-user folder.
 */
export function coordHome(override?: string, environment: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chosen = override || environment.COORD_HOME;
  return chosen ? expand(chosen, home) : path.join(home, '.coord');
}

/**
 * The home a command installed in a home's agent folder belongs to: run as
 * `<home>/agent/command/<build>/bin/coord.js` (where the app copies it, main/agent/agentFolder.ts),
 * it is `<home>`, which the agent folder's state.json marks. bin/coord.js uses it when COORD_HOME is
 * not set, so the release's copy in ~/.coord/agent keeps using ~/.coord, and Coord Dev's copy in
 * ~/.coord-dev/agent uses that copy of the data. Null for a command run from anywhere else, such as
 * a checkout.
 */
export function installedHome(script: string, exists: (file: string) => boolean = existsSync): string | null {
  const bin = path.dirname(script), command = path.dirname(path.dirname(bin)), agent = path.dirname(command);
  if (path.basename(script) !== 'coord.js' || path.basename(bin) !== 'bin' || path.basename(command) !== 'command' || path.basename(agent) !== 'agent') return null;
  return exists(path.join(agent, 'state.json')) ? path.dirname(agent) : null;
}

/**
 * Under the test runner (scripts/test-home.mjs sets COORD_TEST_FORBIDDEN_HOME), a home that is the
 * user's own throws, so a test that loses its temporary home fails instead of touching real data.
 */
export function guardTestHome(home: string) {
  const forbidden = process.env.COORD_TEST_FORBIDDEN_HOME;
  if (!forbidden) return;
  const same = (a: string, b: string) => process.platform === 'win32' || process.platform === 'darwin' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
  if (same(home, forbidden)) throw new Error(`A test reached the user's own Coord home (${home}); give it a temporary one.`);
}
