// The update logic without Electron: the channel it gives electron-updater, and an update's way from
// a check to the restart, with a failure shown as one line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Updates, type UpdaterEngine, type UpdatesOptions } from './updates.ts';
import type { UpdateState } from '../shared/contract.ts';

/** electron-updater's AppUpdater as far as Coord uses it, answering with what the test gives it. */
function fakeEngine(answer: () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>) {
  const listeners = new Map<string, (value: never) => void>();
  const engine = {
    channel: null as string | null, allowPrerelease: true, allowDowngrade: true, autoDownload: true, autoInstallOnAppQuit: true,
    installed: null as [boolean | undefined, boolean | undefined] | null,
    checkForUpdates: () => answer(),
    downloadUpdate: async () => { listeners.get('download-progress')?.({ percent: 41.6 } as never); return []; },
    quitAndInstall(silent?: boolean, run?: boolean) { this.installed = [silent, run]; },
    on(event: string, listener: (value: never) => void) { listeners.set(event, listener); return this; },
    // electron-updater's updater is an EventEmitter, with an off() of its own.
    off() { return this; },
  };
  return engine satisfies UpdaterEngine & { installed: unknown };
}

function updates(version: string, engine: UpdaterEngine | { off: string }, kept: string | null = null, changes?: UpdatesOptions['changes']) {
  const states: UpdateState[] = [];
  let saved = kept;
  const created = new Updates({ version, engine, changes, log: { info() {}, warn() {} }, onChange: state => states.push(state), setting: { get: () => saved, set: value => { saved = value; } } });
  return { updates: created, states, saved: () => saved };
}

test('a build follows its own channel until another is chosen, and never moves to an older build', async () => {
  const stable = fakeEngine(async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.9.0' } }));
  const { updates: fromStable, saved } = updates('0.9.0', stable);
  assert.equal(fromStable.state().channel, 'stable');
  assert.deepEqual([stable.channel, stable.allowPrerelease, stable.allowDowngrade, stable.autoDownload, stable.autoInstallOnAppQuit], ['latest', false, false, false, false]);
  await fromStable.setChannel('nightly');
  assert.deepEqual([stable.channel, stable.allowPrerelease, stable.allowDowngrade], ['nightly', true, false]);
  assert.equal(saved(), 'nightly');

  const nightly = fakeEngine(async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.9.0' } }));
  const { updates: fromNightly, saved: savedNightly } = updates('0.9.1-nightly.20261115.42', nightly);
  assert.equal(fromNightly.state().channel, 'nightly');
  const moved = await fromNightly.setChannel('stable');
  // electron-updater turns downgrades on when its channel is set; Coord turns them off after.
  assert.deepEqual([nightly.channel, nightly.allowPrerelease, nightly.allowDowngrade], ['latest', false, false]);
  assert.equal(moved.status.kind, 'idle');
  assert.equal(savedNightly(), 'stable');

  const { updates: off } = updates('0.9.0', { off: 'This is a development build.' });
  assert.deepEqual(off.state().status, { kind: 'off', reason: 'This is a development build.' });
  assert.equal((await off.check()).status.kind, 'off');
});

test('an update is offered, downloaded and installed only when asked, and a failure shows as one line', async () => {
  let answer: () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } }> = async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.9.1' } });
  const engine = fakeEngine(() => answer());
  // What the update changes is asked for once, for the build on offer, and stays with it.
  const asked: string[] = [];
  const changes = { version: '0.9.1', changes: [{ title: 'Faster updates', sha: 'abc1234', pull: 7 }], commits: 3, url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.9.1' };
  const { updates: app, states } = updates('0.9.0', engine, null, async (from, to) => { asked.push(`${from}...${to}`); return changes; });
  assert.deepEqual((await app.check()).status, { kind: 'available', version: '0.9.1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.state().changes, changes);
  assert.deepEqual(states.at(-1)?.changes, changes);
  assert.equal(engine.installed, null);
  assert.deepEqual((await app.download()).status, { kind: 'ready', version: '0.9.1' });
  assert.deepEqual([app.state().changes, asked], [changes, ['0.9.0...0.9.1']]);
  // Changes GitHub cannot give are asked for again at each stage of the update, not at each step of its download.
  let failures = 0;
  const { updates: unanswered } = updates('0.9.0', fakeEngine(() => answer()), null, async () => { failures++; throw new Error('Not Found'); });
  await unanswered.check();
  await unanswered.download();
  assert.equal(failures, 3);
  assert.ok(states.some(state => state.status.kind === 'downloading' && state.status.percent === 42));
  // A check while one is downloaded keeps it ready.
  assert.equal((await app.check()).status.kind, 'ready');
  app.install();
  assert.deepEqual(engine.installed, [true, true]);

  answer = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED\n<feed>…</feed>'); };
  const { updates: offline } = updates('0.9.0', fakeEngine(() => answer()));
  assert.deepEqual((await offline.check()).status, { kind: 'failed', message: 'net::ERR_INTERNET_DISCONNECTED' });
});
