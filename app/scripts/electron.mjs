// Run an Electron tool (electron-vite, Playwright) as the desktop app. A shell that sets
// ELECTRON_RUN_AS_NODE (some editors and agents do) would otherwise start Electron as plain Node.
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/electron.mjs <command> [arguments]');
  process.exit(2);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// npm puts node_modules/.bin on PATH; the shell finds the .cmd shims on Windows. Arguments come from package.json.
const child = spawn([command, ...args].join(' '), { stdio: 'inherit', env, shell: true });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
