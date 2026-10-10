import test from 'node:test';
import assert from 'node:assert/strict';
import { pollWhileVisible } from './visiblePoll.ts';
class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) { this.hidden = hidden; this.dispatchEvent(new Event('visibilitychange')); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
test('hidden tabs make no requests; returning resumes without overlapping a pending request', async () => {
  const visibility = new Visibility(); visibility.hidden = true;
  let calls = 0, release!: (delay: number) => void;
  const stop = pollWhileVisible(async () => { calls++; return new Promise<number>(resolve => { release = resolve; }); }, visibility);
  try {
    await tick(); assert.equal(calls, 0);
    visibility.change(false); assert.equal(calls, 1);
    visibility.change(true); visibility.change(false); assert.equal(calls, 1);
    visibility.change(true); release(5); await tick(); assert.equal(calls, 1);
    visibility.change(false); assert.equal(calls, 2);
    release(5); await tick(); assert.equal(calls, 3);
  } finally { stop(); release(5); }
});
test('hiding cancels scheduled polling and cleanup aborts requests and removes the listener', async () => {
  const visibility = new Visibility(); let calls = 0, signal!: AbortSignal;
  const stop = pollWhileVisible(async input => { signal = input; calls++; return 5; }, visibility);
  await Promise.resolve(); visibility.change(true); await tick(); assert.equal(calls, 1);
  visibility.change(false); assert.equal(calls, 2); stop();
  assert.equal(signal.aborted, true); visibility.change(true); visibility.change(false);
  await tick(); assert.equal(calls, 2);
});
test('successful one-time loading remains finished across visibility changes', async () => {
  const visibility = new Visibility(); let calls = 0;
  const stop = pollWhileVisible(async () => { calls++; return null; }, visibility);
  await Promise.resolve(); visibility.change(true); visibility.change(false); await tick();
  assert.equal(calls, 1); stop();
});
