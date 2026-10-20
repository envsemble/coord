// Running programs, the slow part: the output limit, timeouts, output files left by a process that
// exits mid-run, and finishing when the program exits even when another thread starts long-lived
// programs at the same moment (on Windows they could inherit a pipe and hold it open).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ProgramError, runProgram } from './run.ts';

const node = process.execPath;
const module = pathToFileURL(path.join(import.meta.dirname, 'run.ts')).href;

test('output beyond the limit stops the program, a program reads the input given, and no files are left behind', async t => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'atlas-run-test-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const started = Date.now();
  await assert.rejects(runProgram(node, ['-e', 'setInterval(() => process.stdout.write("x".repeat(65536)), 1)'], { maxBuffer: 256 * 1024, timeout: 20000, outputDirectory }), /more than/);
  assert.ok(Date.now() - started < 10000, 'stopped well before its timeout');
  await runProgram(node, ['-e', '1'], { outputDirectory });
  assert.equal((await runProgram(node, ['-e', 'process.stdin.pipe(process.stdout)'], { outputDirectory, input: 'given input' })).stdout, 'given input');
  assert.deepEqual(readdirSync(outputDirectory), [], 'output and input files are removed');
});

test('a process that exits during a run leaves no output files', async t => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'atlas-run-test-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  // The process exits once the program it runs has started and written its first output.
  const script = `import { readdirSync, statSync } from 'node:fs'; import path from 'node:path'; import { runProgram } from ${JSON.stringify(module)}; const folder = ${JSON.stringify(outputDirectory)}; void runProgram(process.execPath, ['-e', 'process.stdout.write("started"); setTimeout(() => {}, 3000)'], { outputDirectory: folder }); setInterval(() => { if (readdirSync(folder).some(name => name.endsWith('.out') && statSync(path.join(folder, name)).size)) process.exit(0); }, 5);`;
  await runProgram(node, ['--input-type=module', '-e', script], { timeout: 20000 });
  assert.deepEqual(readdirSync(outputDirectory), []);
});

test('the main thread removes output files a worker left when the process exits', async () => {
  // The worker starts a run in the default temporary folder; the process exits once its program has started.
  const worker = `import { readdirSync, statSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path'; import { parentPort } from 'node:worker_threads'; import { runProgram } from ${JSON.stringify(module)};
    void runProgram(process.execPath, ['-e', 'process.stdout.write("started"); setTimeout(() => {}, 3000)']);
    const started = name => name.startsWith('atlas-run-' + process.pid + '-') && name.endsWith('.out') && statSync(path.join(tmpdir(), name)).size > 0;
    const running = setInterval(() => { if (readdirSync(tmpdir()).some(started)) { clearInterval(running); parentPort.postMessage('running'); } }, 5);`;
  const script = `import { Worker } from 'node:worker_threads'; import { runProgram } from ${JSON.stringify(module)}; await runProgram(process.execPath, ['-e', '1']); new Worker(${JSON.stringify(worker)}, { eval: true }).once('message', () => { process.stdout.write(String(process.pid)); process.exit(0); });`;
  const { stdout: pid } = await runProgram(node, ['--input-type=module', '-e', script], { timeout: 20000 });
  assert.match(pid, /^\d+$/);
  assert.deepEqual(readdirSync(tmpdir()).filter(name => name.startsWith(`atlas-run-${pid}-`)), []);
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
