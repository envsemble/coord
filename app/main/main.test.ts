// Unit tests for the main-process modules that do not need Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RotatingLog } from './log.ts';
import { containedFile, contentSecurityPolicy, originOf } from './protocol.ts';
import { HomeDatabase } from '@envsemble/atlas-planning';
import { DesktopState, placeRow, savedPlace } from './state.ts';
import { target as tabTarget } from '../shared/validate.ts';
import type { Target } from '../shared/contract.ts';

const temporary = () => mkdtempSync(path.join(tmpdir(), 'atlas-main-'));

test('the renderer and planning protocol never resolve outside their folder', () => {
  const base = path.resolve('/app/renderer');
  assert.equal(containedFile(base, '/index.html'), path.join(base, 'index.html'));
  assert.equal(containedFile(base, '/'), path.join(base, 'index.html'));
  for (const escape of ['/../main/index.js', '/..%2Fmain%2Findex.js', '/assets/..\\..\\x', '/%00', '/%E0%A4%A']) assert.equal(containedFile(base, escape), null, escape);
  assert.equal(originOf('atlas://app/index.html'), 'atlas://app');
  assert.equal(originOf('http://localhost:5173/x'), 'http://localhost:5173');
  assert.equal(originOf('not a url'), null);
  assert.match(contentSecurityPolicy, /default-src 'none'/);
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

test('the log rotates and keeps a bounded number of files', () => {
  const directory = temporary();
  try {
    const log = new RotatingLog(directory, { maxBytes: 400, keep: 2 });
    for (let index = 0; index < 40; index++) log.info('line ' + index, { index });
    assert.deepEqual(readdirSync(directory).sort(), ['atlas.1.log', 'atlas.2.log', 'atlas.log']);
    assert.match(readFileSync(path.join(directory, 'atlas.log'), 'utf8'), /line 39/);
    for (const line of readFileSync(path.join(directory, 'atlas.log'), 'utf8').trim().split('\n')) assert.ok(JSON.parse(line).time);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('windows, their places per computer and the shared settings are kept in the home database', () => {
  const directory = temporary();
  const database = HomeDatabase.open(directory);
  try {
    const state = new DesktopState(database);
    // The theme preference is kept for every window; the system's is the default and is not stored.
    assert.equal(state.theme, 'system');
    state.setTheme('dark');
    assert.equal(new DesktopState(database).theme, 'dark');
    state.setTheme('system');
    assert.equal(database.setting('theme'), null);
    assert.equal(state.inspectorWidth, null);
    state.setInspectorWidth(480);
    assert.equal(state.inspectorWidth, 480);
    // A window on this computer with tabs of a local project, and tabs of a paired computer's project it showed before.
    const local = database.addProject(path.join(directory, 'planning', 'shop'), 'Shop');
    database.db.prepare('INSERT INTO connection (id, host_id, name, origin, device_id, token, paired_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('c1', 'host-0001', 'Laptop', 'http://100.64.0.2:7346', 'd-' + 'a'.repeat(32), Buffer.from('plain:x'), '2026-10-15T00:00:00.000Z');
    const remote = database.addProject('/home/me/.atlas/planning/coord', 'Coord', 'c1');
    const window = state.addWindow(null, { x: 10, y: 20, width: 900, height: 700 });
    state.updateWindow(window, { maximized: true });
    assert.deepEqual(state.windows(), [{ id: window, connectionId: null, bounds: { x: 10, y: 20, width: 900, height: 700 }, maximized: true }]);
    state.saveTabs(window, null, [{ projectId: local.id, kind: 'project', target: null, active: false }, { projectId: local.id, kind: 'work', target: '{"work":"work-0001"}', active: true }], []);
    state.saveTabs(window, 'c1', [{ projectId: remote.id, kind: 'project', target: null, active: true }], []);
    state.saveTabs(window, null, [{ projectId: local.id, kind: 'file', target: '{"path":"README.md"}', active: true }], [local.id]);
    assert.deepEqual(state.tabs(window, null).map(tab => [tab.kind, tab.target, tab.active]), [['file', '{"path":"README.md"}', true]], 'saving replaces the computer\'s tabs');
    assert.deepEqual(state.tabs(window, 'c1').map(tab => tab.projectId), [remote.id], 'and keeps the other computer\'s');
    // A computer that did not answer at the start (nothing loaded), or a project whose folder was not
    // a planning folder then: saving keeps the tabs it could not show, after the others.
    const missing = database.addProject(path.join(directory, 'planning', 'gone'), 'Gone');
    state.saveTabs(window, null, [{ projectId: local.id, kind: 'project', target: null, active: false }, { projectId: missing.id, kind: 'file', target: '{"path":"a.md"}', active: true }], [local.id, missing.id]);
    state.saveTabs(window, 'c1', [], []);
    assert.deepEqual(state.tabs(window, 'c1').map(tab => tab.projectId), [remote.id], 'the offline computer keeps its tabs');
    state.saveTabs(window, null, [{ projectId: local.id, kind: 'work', target: '{"work":"work-0002"}', active: true }], [local.id]);
    assert.deepEqual(state.tabs(window, null).map(tab => [tab.projectId, tab.kind, tab.active]), [[local.id, 'work', true], [missing.id, 'file', false]], 'the missing folder keeps its tab, no longer active');
    state.saveTabs(window, null, [], [local.id, missing.id]);
    assert.deepEqual(state.tabs(window, null), [], 'once loaded, closing them removes them');
    // A work item's tab showing its ledger loads back showing it, saved and read as the window does.
    const { kind, ...rest } = { kind: 'work', work: 'work-0001', anchor: null, view: 'ledger' } satisfies Target;
    state.saveTabs(window, null, [{ projectId: local.id, kind, target: JSON.stringify(rest), active: true }], [local.id]);
    assert.deepEqual(state.tabs(window, null).map(saved => tabTarget({ kind: saved.kind, ...saved.target && JSON.parse(saved.target) })), [{ kind: 'work', work: 'work-0001', anchor: null, view: 'ledger' }]);
    // Twenty tabs kept for a folder not listed, then forty of another project: a window holds forty,
    // its own first, so its saves keep passing once the folder is listed again.
    const tab = (projectId: number, index: number) => ({ projectId, kind: 'file' as const, target: `{"path":"${index}.md"}`, active: false });
    state.saveTabs(window, null, Array.from({ length: 20 }, (_, index) => tab(missing.id, index)), [missing.id]);
    state.saveTabs(window, null, Array.from({ length: 40 }, (_, index) => tab(local.id, index)), [local.id]);
    assert.deepEqual(state.tabs(window, null).map(tab => tab.projectId), Array(40).fill(local.id));
    database.db.prepare('INSERT INTO tab (window_id, project_id, position, kind, target, active) VALUES (?, ?, 99, \'project\', NULL, 0)').run(window, missing.id);
    assert.equal(state.tabs(window, null).length, 40, 'a window never loads more than it can save');
    state.removeWindow(window);
    assert.deepEqual([state.windows(), state.tabs(window, null)], [[], []], 'a closed window goes with its tabs');
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function waitFor(condition: () => boolean, timeout = 5000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('Atlas refuses to start without its sandbox, and a released build refuses debuggers', async () => {
  const { startupRefusal } = await import('./refusal.ts');
  const check = (switches: string[], options: { packaged?: boolean; endToEndBuild?: boolean; environment?: NodeJS.ProcessEnv } = {}) =>
    startupRefusal({ hasSwitch: name => switches.includes(name), environment: options.environment ?? {}, packaged: options.packaged ?? true, endToEndBuild: options.endToEndBuild ?? false });
  assert.equal(check([]), null);
  assert.deepEqual(check(['no-sandbox']), { reason: 'sandbox', switches: ['no-sandbox'] });
  assert.deepEqual(check([], { environment: { ELECTRON_DISABLE_SANDBOX: '1' } }), { reason: 'sandbox', switches: ['ELECTRON_DISABLE_SANDBOX'] });
  assert.deepEqual(check(['no-sandbox'], { endToEndBuild: true }), { reason: 'sandbox', switches: ['no-sandbox'] }, 'no build may drop the sandbox');
  for (const name of ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']) assert.deepEqual(check([name]), { reason: 'debugging', switches: [name] }, name);
  assert.equal(check(['remote-debugging-port', 'inspect'], { endToEndBuild: true }), null, 'the end-to-end build lets Playwright attach');
  assert.equal(check(['remote-debugging-port'], { packaged: false }), null, 'development runs are not packaged');
});

test('a window saves the place it shows as a row of its project, and an older window loads its active tab', () => {
  const project = 'f-' + 'a'.repeat(32);
  const plan = { project, target: { kind: 'work' as const, work: 'work-0001', anchor: null, view: 'ledger' as const } };
  assert.deepEqual(placeRow(plan), { project, kind: 'work', target: '{"work":"work-0001","anchor":null,"view":"ledger"}' });
  assert.deepEqual(savedPlace(project, placeRow(plan)!), plan);
  // The hub filtered to a project, and a project's statistics, are rows of that project.
  for (const page of [{ page: 'hub' as const, project }, { page: 'statistics' as const, project }]) assert.deepEqual(savedPlace(project, placeRow(page)!), page);
  // The hub of every project and the Projects page are no row: a window without one opens on the hub.
  assert.equal(placeRow({ page: 'hub', project: null }), null);
  assert.equal(placeRow({ page: 'projects' }), null);
  // A project's page from before the hub opens as its plans in the hub; a row that cannot be read, as nothing.
  assert.deepEqual(savedPlace(project, { kind: 'project', target: null }), { page: 'hub', project });
  assert.deepEqual(savedPlace(project, { kind: 'file', target: '{"path":"README.md"}' }), { project, target: { kind: 'file', path: 'README.md' } });
  assert.equal(savedPlace(project, { kind: 'file', target: '{"path":"../x"}' }), null);
  assert.equal(savedPlace(project, { kind: 'work', target: 'not json' }), null);
});
