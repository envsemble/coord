// Shared by the command's tests: run `atlas` in this process or in a child process, with an
// environment of temporary folders, so no test reads or writes the user's Atlas home, harness logs or
// harness settings.
import type { TestContext } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storedReports, withDatabase } from '../planning/index.ts';
import { main } from './main.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const command = path.resolve(here, '../../bin/atlas.js');

// The command runs outside any agent harness, with no harness logs to find and its own home.
const isolated = realpathSync(mkdtempSync(path.join(tmpdir(), 'atlas-cli-isolated-')));
process.once('exit', () => rmSync(isolated, { recursive: true, force: true }));
export const environment: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: path.join(isolated, 'claude'), CODEX_HOME: path.join(isolated, 'codex'), ATLAS_HOME: path.join(isolated, 'home') };
for (const name of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'CLAUDECODE']) delete environment[name];

/** Run `atlas` in a child process: for what only a process shows, its exit code, stdio and concurrency. */
export function atlas(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const result = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', input: options.input, env: options.env ?? environment, cwd: options.cwd, windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Do `action` with `env` as this process's environment and `cwd` as its folder, as a command
 * started there would run, and restore both after. A file's tests run one at a time.
 */
export async function within<T>(options: { env?: NodeJS.ProcessEnv; cwd?: string }, action: () => Promise<T>): Promise<T> {
  const saved = { ...process.env }, folder = process.cwd();
  const apply = (env: NodeJS.ProcessEnv) => {
    for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name];
    Object.assign(process.env, env);
  };
  apply(options.env ?? environment);
  try {
    if (options.cwd) process.chdir(options.cwd);
    return await action();
  } finally { process.chdir(folder); apply(saved); }
}

/** Run `atlas` in this process (see within): its exit code and what it printed. */
export function run(args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  let stdout = '', stderr = '';
  const out = { stdout: (text: string) => { stdout += text + '\n'; }, stderr: (text: string) => { stderr += text + '\n'; } };
  return within(options, async () => ({ status: await main(args, out), stdout, stderr }));
}

export function temporary(t: TestContext, prefix = 'atlas-cli-') {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}
export function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=Atlas Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true });
}
export function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }

export const planText = (id: string, title: string, design = 'draft', implementation = 'not_started') => ['---', 'schema_version: 2', 'kind: plan', 'id: ' + id, 'title: ' + JSON.stringify(title), 'created: "2026-10-01"', 'updated: "2026-10-02"',
  'design_status: ' + design, 'implementation_status: ' + implementation, 'accepted_at: ' + (design === 'accepted' ? '"2026-10-02"' : 'null'), 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# ' + title, ''].join('\n');

/** The registry of homeWithPlanning's planning folder, covering these folders. */
const registryText = (folders: string[]) => JSON.stringify({ schema_version: 2, name: 'shop-planning', folders, work_items: [{ id: 'work-0001', path: 'active/0001-cart', current_plan: 'active/0001-cart/plan.md' }] }, null, 2) + '\n';

/** The folders homeWithPlanning copies, made with Git once per process. */
const template = path.join(isolated, 'template');
let templateMade = false;
function makeTemplate() {
  const root = path.join(template, 'home', 'planning', 'shop-planning');
  write(path.join(root, 'planning.json'), registryText([]));
  write(path.join(root, 'active/0001-cart/plan.md'), planText('work-0001', 'Cart'));
  write(path.join(root, 'README.md'), '# Planning\n\n- [Cart](active/0001-cart/plan.md)\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Start');
  const checkout = path.join(template, 'shop');
  mkdirSync(checkout);
  git(checkout, 'init', '-q');
  git(checkout, 'remote', 'add', 'origin', 'https://github.com/example/shop.git');
  templateMade = true;
}

/**
 * An Atlas home with one planning folder (a Git repository) whose project covers the checkout
 * `shop` (a Git checkout with a GitHub remote), with work-0001 (a draft). The folder it covers is
 * written after the copy, so the registry differs from its commit there.
 */
export function homeWithPlanning(t: TestContext) {
  const directory = temporary(t);
  if (!templateMade) makeTemplate();
  cpSync(template, directory, { recursive: true });
  const home = path.join(directory, 'home'), root = path.join(home, 'planning', 'shop-planning'), checkout = path.join(directory, 'shop');
  writeFileSync(path.join(root, 'planning.json'), registryText([checkout]));
  return { directory, home, root, checkout, env: { ...environment, ATLAS_HOME: home } };
}

/** A work item's reports in a home's database (the test environment's home unless given). */
export function reportsIn(root: string, workId: string, home = environment.ATLAS_HOME!) {
  return withDatabase(home, database => {
    const project = database.projectByFolder(realpathSync.native(root));
    return project ? storedReports(database, project.id, [workId]).get(workId) ?? [] : [];
  });
}
