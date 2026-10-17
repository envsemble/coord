// Hooks as the harness runs them: `atlas hook <event>` processes with their input on stdin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { withDatabase } from '@envsemble/atlas-planning';
import { atlas, command, homeWithPlanning } from '../testing.ts';

const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';

test('hooks of one session running at once keep each other\'s links', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const ids = Array.from({ length: 8 }, (_, index) => 'work-01' + String(index).padStart(2, '0'));
  await Promise.all(ids.map(work => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, 'hook', 'PostToolUse'], { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject).on('exit', resolve);
    child.stdin.end(JSON.stringify({ session_id: session, cwd: checkout, tool_name: 'mcp__atlas__work_status', tool_input: { work, planningFolder: root } }));
  })));
  const linked = withDatabase(env.ATLAS_HOME!, database => (database.db.prepare('SELECT work_id FROM session_work WHERE session_id = ?').all(session) as { work_id: string }[]).map(row => row.work_id));
  assert.deepEqual(linked.sort(), ids);
});

test('a hook process given bad input exits 0 and prints nothing', t => {
  const { env } = homeWithPlanning(t);
  assert.deepEqual(Object.values(atlas(['hook', 'SessionStart'], { env, input: 'not json' })), [0, '', '']);
});
