import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PlanWorkerClient, type WorkerLike } from './planWorkerClient.ts';

/** A stand-in worker that answers each request as the real one would. */
class FakeWorker extends EventEmitter implements WorkerLike {
  terminated = false;
  next = 0;
  postMessage(message: { id: number; op: string; token?: string }) {
    const value = message.op === 'export' ? { token: 'export-' + ++this.next, bytes: 10, warnings: [] }
      : message.op === 'read' ? { token: 'import-' + ++this.next, preview: {}, target: { workId: 'work-0005', path: 'active/0005-x' } }
      : message.op === 'import' ? { workId: 'work-0005', path: 'active/0005-x', files: 3, notes: [] }
      : message.op === 'take' ? '<html></html>'
      : null;
    queueMicrotask(() => this.emit('message', { id: message.id, ok: true, value }));
  }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

test('the worker stays up while it holds an export or a preview, and stops when idle', async () => {
  const workers: FakeWorker[] = [];
  const client = new PlanWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 20);
  const prepared = await client.prepare('/planning', 'work-0001');
  const read = await client.read('/planning', '/exports/plan.html');
  await pause(60);
  assert.equal(workers[0].terminated, false, 'an open save dialog and an open preview keep the worker');
  assert.equal(await client.take(prepared.token), '<html></html>');
  await pause(60);
  assert.equal(workers[0].terminated, false, 'the preview still needs it');
  assert.deepEqual(await client.import('/planning', read.token), { workId: 'work-0005', path: 'active/0005-x', files: 3, notes: [] });
  await pause(60);
  assert.equal(workers[0].terminated, true, 'nothing held and nothing pending: the worker stops');
  assert.equal(client.running, false);
});

test('a stopped worker’s late exit does not fail the next worker’s requests', async () => {
  const workers: FakeWorker[] = [];
  const client = new PlanWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 10);
  const first = await client.prepare('/planning', 'work-0001');
  await client.drop(first.token);
  await pause(40);
  assert.equal(workers[0].terminated, true);
  // A new request starts a new worker; then the old one reports its exit.
  const second = client.read('/planning', '/exports/plan.html');
  workers[0].emit('exit', 1);
  assert.equal((await second).target.workId, 'work-0005');
  // The current worker's exit does fail what is pending on it.
  const lost = client.prepare('/planning', 'work-0002');
  workers[1].emit('exit', 1);
  await assert.rejects(lost, /stopped unexpectedly/);
});

test('worker errors arrive as structured errors with their export code', async () => {
  class Failing extends FakeWorker {
    postMessage(message: { id: number }) { queueMicrotask(() => this.emit('message', { id: message.id, ok: false, error: { code: 'INTEGRITY', message: 'A file does not match its hash.' } })); }
  }
  const client = new PlanWorkerClient(() => new Failing(), 10);
  await assert.rejects(client.read('/planning', '/x.html'), (error: { code: string; reason: string; message: string }) => error.code === 'invalid-argument' && error.reason === 'INTEGRITY' && /hash/.test(error.message));
});
