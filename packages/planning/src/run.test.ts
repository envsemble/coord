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

test('output beyond the limit stops the program, and no files are left behind', async t => {
  const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'atlas-run-test-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const started = Date.now();
  await assert.rejects(runProgram(node, ['-e', 'setInterval(() => process.stdout.write("x".repeat(65536)), 1)'], { maxBuffer: 256 * 1024, timeout: 20000, outputDirectory }), /more than/);
  assert.ok(Date.now() - started < 10000, 'stopped well before its timeout');
  await runProgram(node, ['-e', '1'], { outputDirectory });
  assert.deepEqual(readdirSync(outputDirectory), [], 'output files are removed');
});

test('a process that exits during a run leaves no output files', async t => {
  const { mkdtempSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'atlas-run-test-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const module = pathToFileURL(path.join(import.meta.dirname, 'run.ts')).href;
  const script = `import { runProgram } from ${JSON.stringify(module)}; void runProgram(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { outputDirectory: ${JSON.stringify(outputDirectory)} }); setTimeout(() => process.exit(0), 300);`;
  await runProgram(node, ['--input-type=module', '-e', script], { timeout: 20000 });
  assert.deepEqual(readdirSync(outputDirectory), []);
});

test('the main thread removes output files a worker left when the process exits', async () => {
  const { readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const module = pathToFileURL(path.join(import.meta.dirname, 'run.ts')).href;
  // The worker starts a run in the default temporary folder; the process exits while it runs.
  const worker = `import { runProgram } from ${JSON.stringify(module)}; void runProgram(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']);`;
  const script = `import { Worker } from 'node:worker_threads'; import { runProgram } from ${JSON.stringify(module)}; await runProgram(process.execPath, ['-e', '1']); new Worker(${JSON.stringify(worker)}, { eval: true }); setTimeout(() => { process.stdout.write(String(process.pid)); process.exit(0); }, 1000);`;
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
