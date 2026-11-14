// `npm run dev`: Coord Dev, the development app, beside the installed Coord (main/dev.ts).
//
// 1. Its home is ~/.coord-dev (or COORD_HOME, as `npm run dev:home` sets its demo home), never the
//    real ~/.coord: when it has no data yet, the real data is copied there (scripts/dev-home.mjs).
// 2. Its plugin is the release's agent bundle (agent-payload.cjs's assemble, as `npm run package`
//    builds it) renamed into coord-dev (dev-plugin.cjs), in artifacts/dev-agent. The app installs it
//    into its home's agent folder and turns it on in Claude Code and Codex.
// 3. It runs the app with electron-vite, as a development build, on that home (its own Electron
//    folder too, so it runs while the installed Coord does).
// 4. When the app asks for the real data again (Dev › Copy My Real Data Again, exiting with
//    refreshExitCode) it copies, then starts the app again; when the app ends otherwise, it turns
//    the dev plugin off in both agents, so its hooks run only while Coord Dev does.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { copyRealData } from './dev-home.mjs';

const appFolder = path.resolve(import.meta.dirname, '..');
const repository = path.resolve(appFolder, '..');
const require = createRequire(import.meta.url);
/** As main/dev.ts's. */
const refreshExitCode = 75;

const realHome = path.join(homedir(), '.coord');
const home = process.env.COORD_HOME ? path.resolve(process.env.COORD_HOME.replace(/^~(?=$|[\\/])/, homedir())) : path.join(homedir(), '.coord-dev');
const same = (/** @type {string} */ a, /** @type {string} */ b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
if (same(home, realHome)) {
  console.error(`Coord Dev runs on a copy of the Coord data, never on ${realHome} itself. Unset COORD_HOME, or point it elsewhere.`);
  process.exit(2);
}
const bundle = path.join(appFolder, 'artifacts', 'dev-agent');

function copy() {
  console.log(`Coord Dev: copying the Coord data in ${realHome} to ${home}…`);
  const { projects, empty } = copyRealData(realHome, home);
  console.log(empty ? 'Coord Dev: there is no Coord data to copy; it starts empty.' : `Coord Dev: copied, with ${projects} project${projects === 1 ? '' : 's'} on the copy.`);
}

/** The release's agent bundle, renamed into Coord Dev's. */
async function buildBundle() {
  const { assemble, nodeRuntime } = require('./agent-payload.cjs');
  const { devVariant } = require('./dev-plugin.cjs');
  const version = JSON.parse(readFileSync(path.join(appFolder, 'package.json'), 'utf8')).version;
  const started = Date.now();
  const runtime = await nodeRuntime(repository, process.platform, process.arch);
  assemble(repository, bundle, version, runtime);
  devVariant(bundle);
  console.log(`Coord Dev: its plugin is built (${Math.round((Date.now() - started) / 100) / 10} s).`);
}

/** The app, as `electron-vite dev` runs it, on Coord Dev's home; its exit status. */
function runApp() {
  const environment = { ...process.env, COORD_HOME: home, COORD_DEV_BUNDLE: bundle };
  // A shell that sets ELECTRON_RUN_AS_NODE (some editors and agents do) would start Electron as plain Node.
  delete environment.ELECTRON_RUN_AS_NODE;
  // electron-vite's own script on this Node, without a shell; arguments after `--` (npm run dev -- …) reach the app as they are.
  const electronVite = path.join(path.dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js');
  const child = spawn(process.execPath, [electronVite, 'dev', '--watch', '--', ...process.argv.slice(2)], { cwd: appFolder, stdio: 'inherit', env: environment });
  return new Promise(resolve => child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

/** Turn the dev plugin off in each agent it is on in. */
async function pluginOff() {
  const folder = path.join(home, 'agent');
  if (!existsSync(path.join(folder, '.claude-plugin', 'marketplace.json'))) return;
  const { agentStatus, harnesses, onPath, setPluginEnabled } = await import('../../packages/coord/src/agents/agents.ts');
  for (const harness of harnesses) {
    const program = onPath(harness.program, process.env);
    if (!program) continue;
    try {
      if (!(await agentStatus(harness, folder, process.env, program)).connected) continue;
      await setPluginEnabled(harness, folder, false, process.env, program);
      console.log(`Coord Dev: its plugin is off in ${harness.name}.`);
    } catch (error) { console.warn(`Coord Dev: its plugin could not be turned off in ${harness.name}: ${/** @type {Error} */ (error).message}`); }
  }
}

// Ctrl+C reaches the app too, which then ends; this waits for it and turns the plugin off.
process.on('SIGINT', () => {});
if (!existsSync(path.join(home, 'coord.db'))) copy();
await buildBundle();
for (;;) {
  const code = await runApp();
  if (code === refreshExitCode) {
    // A copy that fails (a file in use in the copy, say) leaves the one there was: Coord Dev starts on it again.
    try { copy(); } catch (error) { console.error(`Coord Dev: the data could not be copied again, so it starts on the copy it had: ${/** @type {Error} */ (error).message}`); }
    continue;
  }
  await pluginOff();
  process.exit(code);
}
