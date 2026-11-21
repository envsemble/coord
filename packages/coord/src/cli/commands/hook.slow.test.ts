// Hooks as the harness runs them: `coord hook <event>` processes with their input on stdin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { withDatabase } from '../../home/database.ts';
import { readActivity } from '../../agents/activity.ts';
import { coord, command, environment, homeWithPlanning, temporary, write } from '../testing.ts';

const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';

test('hooks of one session running at once keep each other\'s links', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const ids = Array.from({ length: 8 }, (_, index) => 'work-01' + String(index).padStart(2, '0'));
  await Promise.all(ids.map(work => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, 'hook', 'PostToolUse'], { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject).on('exit', resolve);
    child.stdin.end(JSON.stringify({ session_id: session, cwd: checkout, tool_name: 'mcp__coord__step', tool_input: { work, planningFolder: root } }));
  })));
  const linked = withDatabase(env.COORD_HOME!, database => (database.db.prepare('SELECT work_id FROM session_work WHERE session_id = ?').all(session) as { work_id: string }[]).map(row => row.work_id));
  assert.deepEqual(linked.sort(), ids);
  // The hooks that record the session's turns, as their own processes: the stamp beside the database
  // says what it holds. A tool use records no turn.
  const state = (event: string, input: object = {}) => coord(['hook', event], { env, input: JSON.stringify({ session_id: session, tool_name: 'Bash', ...input }) });
  const recorded = () => [withDatabase(env.COORD_HOME!, database => Number((database.db.prepare('SELECT working FROM session WHERE id = ?').get(session) as { working: number }).working)), readFileSync(path.join(env.COORD_HOME!, 'session-state', session), 'utf8')];
  state('SessionEnd', { reason: 'prompt_input_exit' });
  assert.deepEqual(recorded(), [0, 'ended']);
  state('ToolUse');
  assert.deepEqual(recorded(), [0, 'ended']);
  state('UserPromptSubmit');
  assert.deepEqual(recorded(), [1, 'working']);
});

test('a hook process given bad input exits 0 and prints nothing; a session starting notes the agent its hooks ran in', t => {
  const { env, checkout } = homeWithPlanning(t);
  assert.deepEqual(Object.values(coord(['hook', 'SessionStart'], { env, input: 'not json' })), [0, '', '']);
  // Codex's session log, under a CODEX_HOME of its own.
  const transcript = path.join(checkout, 'codex-home', 'sessions', '2026', '10', '22', 'rollout-2026-10-22T10-00-00-' + session + '.jsonl');
  assert.equal(coord(['hook', 'SessionStart'], { env, input: JSON.stringify({ session_id: session, cwd: checkout, transcript_path: transcript }) }).status, 0);
  assert.match(readActivity(env.COORD_HOME!, 'codex', 'hooks') ?? '', /^\d{4}-/);
  assert.equal(readActivity(env.COORD_HOME!, 'claude', 'hooks'), null);
  // A hook that cannot be told notes nothing; a Codex prompt without a log still has its turn_id.
  rmSync(path.join(env.COORD_HOME!, 'agent', 'activity'), { recursive: true, force: true });
  coord(['hook', 'UserPromptSubmit'], { env, input: JSON.stringify({ session_id: session, transcript_path: null }) });
  assert.deepEqual([readActivity(env.COORD_HOME!, 'codex', 'hooks'), readActivity(env.COORD_HOME!, 'claude', 'hooks')], [null, null]);
  coord(['hook', 'UserPromptSubmit'], { env, input: JSON.stringify({ session_id: session, transcript_path: null, turn_id: 'turn-1' }) });
  assert.match(readActivity(env.COORD_HOME!, 'codex', 'hooks') ?? '', /^\d{4}-/);
});

test('a PostToolUse with nothing to do is answered before the hook loads; one that edits a planning file is not', t => {
  const home = path.join(temporary(t), 'home'), env = { ...environment, COORD_HOME: home };
  write(path.join(home, 'planning', 'shop', 'planning.json'), JSON.stringify({ schema_version: 3, name: 'Shop', folders: [], work_items: [] }));
  const edit = (file: string) => coord(['hook', 'PostToolUse'], { env, input: JSON.stringify({ session_id: session, cwd: home, tool_name: 'Edit', tool_input: { file_path: file } }) });
  // The hook itself would open the home database; answered early, nothing is.
  assert.deepEqual(Object.values(edit(path.join(home, 'src.ts'))), [0, '', '']);
  assert.ok(!existsSync(path.join(home, 'coord.db')));
  assert.equal(edit('planning/shop/notes.md').status, 0);
  assert.ok(existsSync(path.join(home, 'coord.db')));
});
