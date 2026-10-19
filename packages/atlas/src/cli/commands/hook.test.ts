import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withDatabase, workSessions, workTimeline } from '../../planning/index.ts';
import { runHook } from './hook.ts';
import { nextState, type Activity } from './sessionState.ts';
import { environment, homeWithPlanning, planText, reportsIn, run, temporary, usageIn, within, write } from '../testing.ts';

const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
interface LinkRow { workId: string; amending: boolean; planningFolder: string; linked: string }
/** The session's links to work items, as the home database has them. */
const linksIn = (home: string): LinkRow[] => withDatabase(home, database => (database.db.prepare('SELECT session_work.*, project.folder FROM session_work JOIN project ON project.id = project_id WHERE session_id = ? ORDER BY session_work.id').all(session) as Record<string, unknown>[])
  .map(row => ({ planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending), linked: String(row.linked_at) })));
/** Run a hook in this process as `atlas hook <event>` runs it on its stdin: what it prints. */
const hookIn = (env: NodeJS.ProcessEnv, event: string, input: object | string) => within({ env }, () => runHook(event, typeof input === 'string' ? input : JSON.stringify(input)));
/** A synthetic Claude Code session log that started ten minutes ago, as the harness keeps it. */
function claudeLog(config: string) {
  const project = path.join(config, 'projects', 'C--work-shop');
  mkdirSync(project, { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 400 };
  const at = (offset: number) => new Date(Date.now() - offset).toISOString();
  const file = path.join(project, session + '.jsonl');
  writeFileSync(file, [
    { type: 'user', message: { role: 'user', content: 'Placeholder' }, timestamp: at(600000) },
    { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: 'end_turn', usage }, timestamp: at(540000) },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  return file;
}
/** The context a SessionStart hook gives a session in `cwd`. */
const contextIn = async (env: NodeJS.ProcessEnv, cwd: string): Promise<string> => JSON.parse(await hookIn(env, 'SessionStart', { session_id: session, cwd })).hookSpecificOutput.additionalContext;

test('hooks give the session its planning context, check and link planning edits, and record statistics at stop', async t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const hook = async (event: string, input: object) => {
    const output = await hookIn(env, event, { session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: event, ...input });
    return output ? JSON.parse(output) : null;
  };
  const links = () => linksIn(base.ATLAS_HOME!);
  /** Whether the database has the session's agent in a turn (the app's Working). */
  const working = () => withDatabase(base.ATLAS_HOME!, database => Number((database.db.prepare('SELECT working FROM session WHERE id = ?').get(session) as { working: number }).working));

  // SessionStart: the project, its planning folder and active work, and how to plan; outside a registered checkout, the home's projects.
  const started = await hook('SessionStart', { source: 'startup' });
  assert.equal(started.hookSpecificOutput.hookEventName, 'SessionStart');
  const context: string = started.hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`Atlas project "shop-planning" for this checkout: planning folder ${root} (repositories: shop).`), context);
  assert.ok(!context.includes('Several projects'), context);
  assert.ok(context.includes('- work-0001 "Cart" (draft, not_started): no ledger yet. Plan: ' + path.join(root, 'active', '0001-cart', 'plan.md')), context);
  assert.match(context, /ask before opening a work item/);
  const elsewhere = temporary(t);
  assert.equal(await contextIn(env, elsewhere), [
    `Atlas: no project registers this folder (${realpathSync.native(elsewhere)}). Active projects in the Atlas home:`,
    `- "shop-planning": ${realpathSync.native(root)} (1 active work item)`,
    "When the work involves Atlas (planning, recording, reviewing), ask the user which project it belongs to, or work across them; the Atlas tool where lists each project's repositories and active work.",
  ].join('\n'));

  // PostToolUse: a valid edit of a draft plan links the session, without amending; what the check
  // only warns about (an active plan without a summary) is said without stopping the agent.
  const plan = path.join(root, 'active', '0001-cart', 'plan.md');
  assert.deepEqual(await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: plan, old_string: 'a', new_string: 'b' }, tool_response: { success: true } }), { hookSpecificOutput: {
    hookEventName: 'PostToolUse', additionalContext: 'Atlas checked the planning files you edited; consider:\n- shop-planning: active/0001-cart/plan.md: no summary: add one to the header, two or three plain sentences on what the work is, why, and where it stands',
  } });
  writeFileSync(plan, planText('work-0001', 'Cart').replace('title: "Cart"', 'title: "Cart"\nsummary: "Carts that last."'));
  assert.equal(await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: plan, old_string: 'a', new_string: 'b' }, tool_response: { success: true } }), null);
  const [first] = links();
  assert.deepEqual(first, { planningFolder: realpathSync.native(root), workId: 'work-0001', amending: false, linked: first.linked });
  assert.ok(Date.parse(first.linked) > Date.now() - 60000, 'when the session started on the work');
  assert.equal(working(), 1, 'a session working on linked work is in a turn');
  // Editing the plan of an accepted design amends it.
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted'));
  await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: plan, content: '' } });
  assert.equal(links()[0].amending, true);
  // A broken edit is handed back to the agent to fix.
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted').replace('title: "Cart"', 'title: 1.5'));
  const blocked = await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: plan } });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /shop-planning: active\/0001-cart\/plan\.md: ambiguous implicit YAML scalar/);
  assert.equal(blocked.hookSpecificOutput.additionalContext, blocked.reason);
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted'));
  // Files outside the home are not Atlas's business, nor are files in the home outside a planning
  // folder: notes beside them, or a folder being set up before it has its planning.json.
  assert.equal(await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(checkout, 'src.ts') } }), null);
  const notes = path.join(path.dirname(root), 'notes.md'), setUp = path.join(path.dirname(root), 'new-planning', 'README.md');
  write(notes, '# Notes\n');
  write(setUp, '# Planning\n');
  assert.equal(await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: notes } }), null);
  assert.equal(await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: setUp } }), null);
  // Reading a planning file records it as document use, for the work item the session is linked to.
  assert.equal(await hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: plan } }), null);
  assert.deepEqual(withDatabase(base.ATLAS_HOME!, database => ({ ...database.db.prepare('SELECT path, work_id, session FROM document_use').get() })), { path: 'active/0001-cart/plan.md', work_id: 'work-0001', session });
  assert.equal(usageIn(root, base.ATLAS_HOME!)?.reports, 1);

  // Codex: apply_patch names its files in the patch, relative to the session's folder.
  assert.equal((await run(['work', 'create', '--title', 'Payments', '--summary', 'Payments by card.', '--repo', 'shop', '--planning-dir', root], { env })).status, 0);
  const patch = '*** Begin Patch\n*** Update File: active/0002-payments/plan.md\n@@\n-# Payments\n+# Payments today\n*** End Patch\n';
  assert.equal(await hookIn(env, 'PostToolUse', { session_id: session, transcript_path: null, cwd: root, hook_event_name: 'PostToolUse', model: 'gpt-5.5', permission_mode: 'default', tool_name: 'apply_patch', tool_input: { command: patch }, tool_response: 'Done', tool_use_id: 'call_1', turn_id: 't1' }), '');
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002']);
  // An Atlas MCP tool call that changes a work item links it, from its input or its result; reading one does not.
  await run(['work', 'create', '--title', 'Refunds', '--repo', 'shop', '--planning-dir', root], { env });
  const about = { tool_input: { work: 'work-0003' }, tool_response: [{ type: 'text', text: JSON.stringify({ workId: 'work-0003', planningFolder: root }) }] };
  await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__work_status', ...about });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002']);
  await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__step_add', ...about });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003']);
  // A session on several work items counts as working on the one it touched last.
  const activity = () => withDatabase(base.ATLAS_HOME!, database => [...database.workActivity().values()].flat().map(item => [item.workId, item.state]));
  assert.deepEqual(activity(), [['work-0003', 'working']]);

  // A session is on the work item it touched last: moving on recorded the report of the one it left,
  // up to then (each since the session came to it); Stop records the report of the one it is on,
  // measured from the session's log, and clears amending for the edits it counted.
  const spent = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 };
  const responded = Date.now();
  appendFileSync(transcript, JSON.stringify({ type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: 'end_turn', usage: spent }, timestamp: new Date(responded).toISOString() }) + '\n');
  while (Date.now() <= responded) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(await hook('Stop', { stop_hook_active: false }), null);
  for (const [workId, outputs] of [['work-0001', []], ['work-0002', []], ['work-0003', [4]]] as const) {
    const reports = reportsIn(root, workId, base.ATLAS_HOME!);
    assert.deepEqual(reports.map(report => [report.session, report.model]), [[session, 'claude-opus-5-5']], workId);
    assert.equal(reports[0].measured?.since, links().find(item => item.workId === workId)!.linked, workId + ': the first report measures from the link');
    assert.deepEqual(reports[0].measured!.models.map(item => item.output), outputs, workId + ': only what came while the session was on it');
  }
  assert.deepEqual(links().map(item => item.amending), [false, false, false]);
  assert.equal(working(), 0, 'the turn is over when the agent stops');
  // The next tool use, of any tool, puts the linked session back in a turn; a subagent stopping leaves it there.
  await hook('ToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(working(), 1);
  await hook('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: transcript });
  assert.equal(reportsIn(root, 'work-0003', base.ATLAS_HOME!).length, 2);
  assert.equal(working(), 1);
  // The session's state at once: a prompt starts a turn; a permission prompt waits for the person,
  // and the tool use after it continues the same turn; the turn's end waits, a later reminder
  // keeping when it began; the session's end is neither.
  const state = () => withDatabase(base.ATLAS_HOME!, database => ({ ...database.db.prepare('SELECT working, turn_at AS turn, waiting_at AS waiting FROM session WHERE id = ?').get(session) as { working: number; turn: string | null; waiting: string | null } }));
  await hook('UserPromptSubmit', { prompt: 'Placeholder' });
  const { turn } = state();
  assert.deepEqual(state(), { working: 1, turn, waiting: null });
  await hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.deepEqual({ ...state(), waiting: typeof state().waiting }, { working: 0, turn, waiting: 'string' });
  await hook('ToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(state(), { working: 1, turn, waiting: null });
  // A commit the session makes is recorded for the work item it is on, with its repository and page.
  await hook('ToolUse', { tool_name: 'Bash', tool_input: { command: 'git add -A && git commit -m "Add the cart"' }, tool_response: { stdout: '[main 1a2b3c4] Add the cart\n 1 file changed, 1 insertion(+)\n', stderr: '' } });
  await hook('Stop', { stop_hook_active: false, last_assistant_message: '**Needs your decision:** keep the cart for a week?' });
  const { waiting } = state();
  const project = withDatabase(base.ATLAS_HOME!, database => database.projectByFolder(realpathSync.native(root))!.id);
  const sessions = () => withDatabase(base.ATLAS_HOME!, database => workSessions(database, project, 'work-0003'));
  assert.deepEqual(sessions().products.map(({ kind, repository, id, title, url, branch }) => ({ kind, repository, id, title, url, branch })),
    [{ kind: 'commit', repository: 'shop', id: '1a2b3c4', title: 'Add the cart', url: 'https://github.com/example/shop/commit/1a2b3c4', branch: 'main' }]);
  // While it waits, the session shows its turn's last message, and how to resume it in its folder.
  const [waiter] = sessions().sessions;
  assert.deepEqual([waiter.state, waiter.message, waiter.folder, waiter.resume], ['waiting', '**Needs your decision:** keep the cart for a week?', checkout, 'claude --resume ' + session]);
  await hook('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.deepEqual(state(), { working: 0, turn: null, waiting });
  assert.deepEqual(activity(), [['work-0003', 'waiting']]);
  await hook('SessionEnd', { reason: 'prompt_input_exit' });
  assert.deepEqual([state(), activity()], [{ working: 0, turn: null, waiting: null }, []]);
  assert.deepEqual([sessions().sessions[0].state, sessions().sessions[0].message], ['ended', null]);
  // Its waits on the work item it is on (work-0003): both turns' ends and the permission prompt between them.
  const timeline = withDatabase(base.ATLAS_HOME!, database => workTimeline(database, project, 'work-0003', { created: null, accepted: null, completed: null }));
  assert.deepEqual([timeline.lanes.map(lane => [lane.session, lane.subagent, lane.waiting.length]), timeline.waitedMs > 0], [[[session, null, 3]], true]);
  assert.ok(!existsSync(path.join(root, 'active', '0001-cart', '.atlas')), 'nothing is written into the planning folder');
  assert.equal((await run(['planning', 'check', root], { env })).status, 0);
});

test('a session\'s state follows its events: a wait for the person is left out of its time, a long tool call stays in its turn, and a late event changes nothing', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 19, 10, 0) + minutes * 60_000).toISOString();
  let row = { working: 0, turn_at: null as string | null, waiting_at: null as string | null, counts_at: null as string | null, state_at: null as string | null, updated_at: at(0) };
  const step = (activity: Activity, minutes: number) => {
    row = { ...row, ...nextState(row, activity, at(minutes), at(minutes - 15)) };
    return [row.working, row.turn_at, row.waiting_at, row.counts_at];
  };
  assert.deepEqual(step('prompt', 0), [1, at(0), null, at(0)]);
  assert.deepEqual(step('ask', 5), [0, at(0), at(5), at(0)], 'a permission prompt waits within the turn');
  assert.deepEqual(step('ask', 6), [0, at(0), at(5), at(0)], 'asking again keeps when it began');
  assert.deepEqual(step('tool', 9), [1, at(0), null, at(4)], 'the four minutes of waiting are not counted');
  assert.deepEqual(step('tool', 40), [1, at(0), null, at(4)], 'a tool call of half an hour is the same turn');
  assert.deepEqual(step('stop', 50), [0, null, at(50), at(4)]);
  assert.deepEqual([step('tool', 45), step('prompt', 49)], [[0, null, at(50), at(4)], [0, null, at(50), at(4)]], 'hooks that ran before the stop and arrive after it');
  assert.deepEqual(step('prompt', 60), [1, at(60), null, at(14)], 'the last turn, not yet reported, counts on without the wait');
  assert.deepEqual(step('end', 70), [0, null, null, at(14)]);
  // A report during a wait (a subagent stopping) counted all until then: the time counts on from the resumption.
  step('prompt', 80);
  step('ask', 85);
  row.counts_at = at(87);
  assert.deepEqual(step('tool', 90), [1, at(80), null, at(90)]);
});

test('a stop clears amending only for edits its report counted', async t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const stop = () => hookIn(env, 'Stop', { session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: 'Stop' });
  const plan = path.join(root, 'active', '0001-cart', 'plan.md');
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted'));
  // Linked by an amending edit of the accepted plan.
  await hookIn(env, 'PostToolUse', { session_id: session, transcript_path: transcript, cwd: checkout, tool_name: 'Write', tool_input: { file_path: plan } });
  const amended = (when: string) => withDatabase(base.ATLAS_HOME!, database => database.db.prepare('UPDATE session_work SET amending = 1, amended_at = ?').run(when));
  // An amending edit recorded after the report began (here: later than now) stays for the next report.
  amended(new Date(Date.now() + 60000).toISOString());
  assert.equal(await stop(), '');
  assert.equal(linksIn(base.ATLAS_HOME!)[0].amending, true);
  assert.equal(reportsIn(root, 'work-0001', base.ATLAS_HOME!)[0].stage, 'planning', 'an amending session plans');
  amended(new Date(Date.now() - 1000).toISOString());
  await stop();
  assert.equal(linksIn(base.ATLAS_HOME!)[0].amending, false, 'the report counted the edit');
});

test('a session in a checkout that several projects register is told to ask which one to plan in', async t => {
  const { checkout, home, env } = homeWithPlanning(t);
  const other = path.join(home, 'planning', 'coord');
  write(path.join(other, 'planning.json'), JSON.stringify({ schema_version: 1, name: 'Coord', repositories: [{ id: 'shop', name: 'Shop', remote: 'https://github.com/example/shop' }], work_items: [] }));
  const context = await contextIn(env, checkout);
  assert.ok(context.includes('Atlas project "shop-planning"') && context.includes(`Atlas project "Coord" for this checkout: planning folder ${realpathSync.native(other)}`), context);
  assert.match(context, /Several projects register this checkout's repository \(Coord, shop-planning\): before planning, ask the user which project to plan in/);
  // The tools need the project: a work item only one of them registers names it; otherwise it is asked for.
  const created = await run(['work', 'create', '--title', 'Payments', '--repo', 'shop'], { env, cwd: checkout });
  assert.equal(created.status, 1);
  assert.match(created.stderr, /Several projects register this checkout's repository: Coord \(.*\), shop-planning \(.*\)\. Ask the user which project to plan in/);
  assert.equal((await run(['work', 'status', 'work-0001'], { env, cwd: checkout })).status, 0);
  const where = JSON.parse((await run(['where', '--cwd', checkout], { env })).stdout);
  assert.deepEqual(where.matches.map((match: { project: string }) => match.project), ['Coord', 'shop-planning']);
  // Once Coord covers the folder the checkout is in, the session belongs to Coord alone.
  write(path.join(other, 'planning.json'), JSON.stringify({ schema_version: 1, name: 'Coord', workspaces: [path.dirname(checkout)], repositories: [{ id: 'shop', name: 'Shop', remote: 'https://github.com/example/shop' }], work_items: [] }));
  assert.match(await contextIn(env, checkout), /^Atlas project "Coord" for this workspace folder: planning folder .*\(repositories: shop\)\.\nNo active work for this checkout\.\nPlanning: /);
});

test('a session in an empty Atlas home is told there are no projects and how to make one', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  assert.equal(await contextIn({ ...environment, ATLAS_HOME: home }, directory), `Atlas: no project registers this folder (${realpathSync.native(directory)}), and the Atlas home (${home}) has no projects yet; when the user wants to plan, make one with their agreement (the Atlas tool project_create, or atlas project create), or the user makes one in the app.`);
});

test('a hook never breaks the session: bad input prints nothing and is logged', async t => {
  const { env, home } = homeWithPlanning(t);
  for (const [event, input] of [['SessionStart', 'not json'], ['PostToolUse', '{"session_id": "../escape", "tool_name": "Edit"}'], ['Stop', '{"session_id": "unknown-session"}'], ['Unknown', '{}'], ['', '']]) {
    assert.equal(await hookIn(env, event, input), '', event + ' ' + input);
  }
  assert.match(readFileSync(path.join(home, 'logs', 'hooks.log'), 'utf8'), /"event":"SessionStart".*SyntaxError/);
});
