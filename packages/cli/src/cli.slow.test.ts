// The command as a process: what its own process shows, its exit codes and stdio, and several of it
// writing at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atlas, command, homeWithPlanning, reportsIn, temporary } from './testing.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.resolve(here, '../package.json'), 'utf8')) as { version: string };

function atlasAsync(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('the atlas command exits 0 with its output on stdout, 1 when refused and 2 on usage errors, with the reason on stderr', t => {
  const shown = atlas(['--version']);
  assert.deepEqual([shown.status, shown.stdout, shown.stderr], [0, version + '\n', '']);
  const refused = atlas(['planning', 'check', path.join(temporary(t), 'missing')]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^ERROR: planning\.json: /m);
  const wrong = atlas(['tools']);
  assert.deepEqual([wrong.status, wrong.stdout], [2, '']);
  assert.match(wrong.stderr, /^Atlas [\s\S]*\natlas: error: unknown command: tools\n$/);
});

test('atlas work report records each report, even from several agents at once', async t => {
  const { root, home, env } = homeWithPlanning(t);
  // Several agents at once share the home database: each waits for the others.
  const writers = await Promise.all(Array.from({ length: 8 }, (_, index) => atlasAsync(['work', 'report', root, '--work', 'work-0001', '--model', 'model-b', '--tokens', String(index * 1000), '--session', 'parallel-' + index], env)));
  assert.ok(writers.every(result => result.status === 0 && result.stdout.includes('"recorded":true')), JSON.stringify(writers));
  assert.equal(reportsIn(root, 'work-0001', home).length, 8);
});
