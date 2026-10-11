// Running programs: output, failures and timeouts, and finishing when the program exits even when
// another thread starts long-lived programs at the same moment (on Windows they could inherit a
// pipe and hold it open).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { ProgramError, runProgram } from './run.ts';

const node = process.execPath;

test('a program\'s output and failures come back as execFile would give them', async () => {
  assert.deepEqual(await runProgram(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err")']), { stdout: 'out', stderr: 'err' });
  await assert.rejects(runProgram(node, ['-e', 'process.stderr.write("broken"); process.exit(3)']), (error: ProgramError) => error.code === 3 && /broken/.test(error.message) && error.stderr === 'broken');
  await assert.rejects(runProgram('atlas-no-such-program', []), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
  await assert.rejects(runProgram(node, ['-e', 'process.stdout.write("x".repeat(2048))'], { maxBuffer: 1024 }), /more than 1024 bytes/);
});

test('a program that runs too long is stopped', async () => {
  const started = Date.now();
  await assert.rejects(runProgram(node, ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 300 }), (error: ProgramError) => error.killed && /timed out/.test(error.message));
  assert.ok(Date.now() - started < 10000);
});

test('a run ends when its program ends, while another thread starts long-lived programs', async () => {
  // The worker starts children that live for five seconds, as esbuild's service lives on.
  const worker = new Worker(`
    const { spawn } = require('node:child_process');
    const { parentPort } = require('node:worker_threads');
    const children = [];
    parentPort.on('message', message => {
      if (message === 'spawn') { for (let i = 0; i < 6; i++) children.push(spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'pipe', windowsHide: true })); parentPort.postMessage('spawned'); }
      else { for (const child of children) child.kill(); parentPort.postMessage('done'); }
    });`, { eval: true });
  const ask = (message: string) => new Promise(resolve => { worker.once('message', resolve); worker.postMessage(message); });
  try {
    for (let round = 0; round < 5; round++) {
      const started = Date.now();
      const spawned = ask('spawn');
      const runs = Promise.all(Array.from({ length: 8 }, () => runProgram(node, ['-e', 'process.stdout.write("ok")'])));
      await spawned;
      assert.deepEqual((await runs).map(result => result.stdout), Array(8).fill('ok'));
      assert.ok(Date.now() - started < 4000, `round ${round} waited for the other thread's programs (${Date.now() - started} ms)`);
    }
  } finally {
    await ask('kill');
    await worker.terminate();
  }
});
