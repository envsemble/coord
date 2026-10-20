// Where the Atlas home is, apart from everything kept in it, so the hooks that run on every tool
// call find it without loading the rest.
import { homedir } from 'node:os';
import path from 'node:path';

// `~/` and, on Windows, `~\` start a path in the user's home folder.
const tilde = process.platform === 'win32' ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
const expand = (value: string, home: string) => path.resolve(value.replace(tilde, () => home));

/**
 * The Atlas home: `~/.atlas`, or ATLAS_HOME; an explicit override (such as --home) takes precedence
 * over both. Its `planning/` folder holds the planning folders (the projects), and Atlas keeps its
 * own state beside them: the home database (atlas.db) and logs. Electron's own caches stay in
 * Electron's per-user folder.
 */
export function atlasHome(override?: string, environment: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chosen = override || environment.ATLAS_HOME;
  return chosen ? expand(chosen, home) : path.join(home, '.atlas');
}

/**
 * Under the test runner (scripts/test-home.mjs sets ATLAS_TEST_FORBIDDEN_HOME), a home that is the
 * user's own throws, so a test that loses its temporary home fails instead of touching real data.
 */
export function guardTestHome(home: string) {
  const forbidden = process.env.ATLAS_TEST_FORBIDDEN_HOME;
  if (!forbidden) return;
  const same = (a: string, b: string) => process.platform === 'win32' || process.platform === 'darwin' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
  if (same(home, forbidden)) throw new Error(`A test reached the user's own Atlas home (${home}); give it a temporary one.`);
}
