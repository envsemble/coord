// Running programs: output and failures. The output limit, timeouts and runs beside other threads'
// programs are in run.slow.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgramError, runProgram } from './run.ts';

const node = process.execPath;

test('a program\'s output and failures come back as execFile would give them', async () => {
  assert.deepEqual(await runProgram(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err")']), { stdout: 'out', stderr: 'err' });
  await assert.rejects(runProgram(node, ['-e', 'process.stderr.write("broken"); process.exit(3)']), (error: ProgramError) => error.code === 3 && /broken/.test(error.message) && error.stderr === 'broken');
  await assert.rejects(runProgram('coord-no-such-program', []), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
  await assert.rejects(runProgram(node, ['-e', 'process.stdout.write("x".repeat(2048))'], { maxBuffer: 1024 }), /more than 1024 bytes/);
});
