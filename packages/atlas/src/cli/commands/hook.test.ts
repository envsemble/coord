import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withDatabase, withDatabaseAsync } from '../../home/database.ts';
import { workSessions, workTimeline } from '../../planning/reports/workSessions.ts';
import { runHook } from './hook.ts';
import { nextState, type Activity } from './sessionState.ts';
import { environment, homeWithPlanning, planText, reportsIn, run, temporary, within, write } from '../testing.ts';

const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
interface LinkRow { workId: string; amending: boolean; planningFolder: string; linked: string }
/** The session's links to work items, as the home database has them. */
const linksIn = (home: string): LinkRow[] => withDatabase(home, database => (database.db.prepare('SELECT session_work.*, project.folder FROM session_work JOIN project ON project.id = project_id WHERE session_id = ? ORDER BY session_work.id').all(session) as Record<string, unknown>[])
  .map(row => ({ planningFolder: String(row.folder), workId: String(row.work_id), amending: Boolean(row.amending), linked: String(row.linked_at) })));
/** Run a hook in this process as `atlas hook <event>` runs it on its stdin: what it prints. */
const hookIn = (env: NodeJS.ProcessEnv, event: string, input: object | string) => within({ env }, () => runHook(event, typeof input === 'string' ? input : JSON.stringify(input)));
/** The folder the synthetic session started in, as its log says. */
const startedIn = (config: string) => path.join(config, 'workspace');
/** A synthetic Claude Code session log that started ten minutes ago, as the harness keeps it. */
function claudeLog(config: string) {
  const project = path.join(config, 'projects', 'C--work-shop');
  mkdirSync(project, { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 400 };
  const at = (offset: number) => new Date(Date.now() - offset).toISOString();
  const file = path.join(project, session + '.jsonl');
  writeFileSync(file, [
    { type: 'user', message: { role: 'user', content: 'Placeholder' }, cwd: startedIn(config), timestamp: at(600000) },
    { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: 'end_turn', usage }, timestamp: at(540000) },
    // Claude Code titles the session, and titles it again as it goes on: the latest counts.
    { type: 'ai-title', aiTitle: 'Shop cart', sessionId: session }, { type: 'ai-title', aiTitle: 'Carts that last', sessionId: session },
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

  // SessionStart: the project, its planning folder once and active work (how to plan is in the Atlas tools' instructions); outside every project's folders, the home's projects.
  const started = await hook('SessionStart', { source: 'startup' });
  assert.equal(started.hookSpecificOutput.hookEventName, 'SessionStart');
  const context: string = started.hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`Atlas project "shop-planning" for this folder: planning folder ${root}.`), context);
  assert.ok(!context.includes('Several projects'), context);
  assert.ok(context.endsWith('\n- work-0001 "Cart" (draft, not_started): No steps agreed yet. Plan: active/0001-cart/plan.md'), context);
  const elsewhere = temporary(t);
  assert.equal(await contextIn(env, elsewhere), [
    `Atlas: no project covers this folder (${realpathSync.native(elsewhere)}). Active projects in the Atlas home:`,
    `- "shop-planning": ${realpathSync.native(root)} (1 active work item)`,
    "When the work involves Atlas (planning, recording, reviewing), ask the user which project it belongs to, or work across them; the Atlas tool where lists each project's folders and active work.",
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
  // Reading a planning file does nothing.
  assert.equal(await hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: plan } }), null);

  // Codex: apply_patch names its files in the patch, relative to the session's folder.
  assert.equal((await run(['work', 'create', '--title', 'Payments', '--summary', 'Payments by card.', '--planning-dir', root], { env })).status, 0);
  const patch = '*** Begin Patch\n*** Update File: active/0002-payments/plan.md\n@@\n-# Payments\n+# Payments today\n*** End Patch\n';
  assert.equal(await hookIn(env, 'PostToolUse', { session_id: session, transcript_path: null, cwd: root, hook_event_name: 'PostToolUse', model: 'gpt-5.5', permission_mode: 'default', tool_name: 'apply_patch', tool_input: { command: patch }, tool_response: 'Done', tool_use_id: 'call_1', turn_id: 't1' }), '');
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002']);
  // An Atlas MCP tool call that changes a work item links it, from its input or its result; reading one does not.
  await run(['work', 'create', '--title', 'Refunds', '--planning-dir', root], { env });
  const about = { tool_input: { work: 'work-0003' }, tool_response: [{ type: 'text', text: JSON.stringify({ workId: 'work-0003', planningFolder: root }) }] };
  for (const tool of ['work_status', 'work_search']) await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__' + tool, ...about });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002']);
  await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__state', ...about });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003'], 'saying whose turn it is changes the work item too');
  // A session on several work items counts as working on the one it touched last.
  const activity = () => withDatabase(base.ATLAS_HOME!, database => [...database.workActivity().values()].flat().map(item => [item.workId, item.state]));
  assert.deepEqual(activity(), [['work-0003', 'working']]);

  // A session is on the work item it touched last: moving on leaves the report of the one it left,
  // up to then (each since the session came to it), to the turn's end; Stop records those and the
  // report of the one it is on, measured from the session's log, and clears amending for the edits it counted.
  assert.deepEqual(['work-0001', 'work-0002'].map(workId => reportsIn(root, workId, base.ATLAS_HOME!).length), [0, 0]);
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
  // A tool use records only what it made, never a turn: it says nothing of whose turn the work is. A subagent stopping is reported.
  await hook('ToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(working(), 0);
  await hook('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: transcript });
  assert.equal(reportsIn(root, 'work-0003', base.ATLAS_HOME!).length, 2);
  // The session's turns, for the sessions a plan lists: a prompt starts one, its end ends it, and the session's end is neither.
  const state = () => withDatabase(base.ATLAS_HOME!, database => ({ ...database.db.prepare('SELECT working, turn_at AS turn, waiting_at AS waiting FROM session WHERE id = ?').get(session) as { working: number; turn: string | null; waiting: string | null } }));
  await hook('UserPromptSubmit', { prompt: 'Placeholder' });
  const { turn } = state();
  assert.deepEqual(state(), { working: 1, turn, waiting: null });
  // A commit the session makes is recorded for the work item it is on, with its repository (owner/repo, from the checkout's remote) and page;
  // an amended one replaces it, and one on a detached HEAD has no branch.
  const commit = (command: string, stdout: string) => hook('ToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '' } });
  await commit('git add -A && git commit -m "Add the cart"', '[main 0f0f0f0] Add a cart\n 1 file changed, 1 insertion(+)\n');
  await commit('git commit --amend -m "Add the cart"', '[main 1a2b3c4] Add the cart\n Date: Mon Oct 19 12:00:00 2026 +0200\n');
  await commit('git -C "' + checkout + '" commit -m "Try it"', '[detached HEAD 9e8d7c6] Try it\n');
  await hook('Stop', { stop_hook_active: false, last_assistant_message: '**Needs your decision:** keep the cart for a week?' });
  assert.equal(state().working, 0);
  const project = withDatabase(base.ATLAS_HOME!, database => database.projectByFolder(realpathSync.native(root))!.id);
  const sessions = (local = true) => withDatabaseAsync(base.ATLAS_HOME!, database => workSessions(database, project, 'work-0003', { local }));
  assert.deepEqual((await sessions()).commits.map(({ kind, repository, id, title, url, branch }) => ({ kind, repository, id, title, url, branch })),
    [{ kind: 'commit', repository: 'example/shop', id: '9e8d7c6', title: 'Try it', url: 'https://github.com/example/shop/commit/9e8d7c6', branch: null },
      { kind: 'commit', repository: 'example/shop', id: '1a2b3c4', title: 'Add the cart', url: 'https://github.com/example/shop/commit/1a2b3c4', branch: 'main' }]);
  // The session lists with its title and how to resume it in the folder it started in (as its log
  // says, wherever its hooks ran since); a paired device gets no folder. Its turn's end is no wait for anyone.
  const [listed] = (await sessions()).sessions;
  assert.deepEqual([listed.state, listed.title, listed.message, listed.folder, listed.resume], ['idle', 'Carts that last', null, startedIn(config), 'claude --resume ' + session]);
  const [remote] = (await sessions(false)).sessions;
  assert.deepEqual([remote.folder, remote.resume], [null, null]);
  await hook('SessionEnd', { reason: 'prompt_input_exit' });
  assert.deepEqual(state(), { working: 0, turn: null, waiting: null });
  const [ended] = (await sessions()).sessions;
  assert.deepEqual([ended.state, ended.message], ['ended', null]);
  // Nothing was a wait for the person: Atlas no longer guesses one.
  const timeline = withDatabase(base.ATLAS_HOME!, database => workTimeline(database, project, 'work-0003', { created: null, accepted: null, completed: null }));
  assert.deepEqual([timeline.lanes.flatMap(lane => lane.waiting), timeline.waitedMs], [[], 0]);
  // The atlas command in a shell links the work item it changes, as the tools do; reading a work item with it does not.
  await run(['work', 'create', '--title', 'Fees', '--planning-dir', root], { env });
  // A shell command reaches the hooks as ToolUse only (the plugin runs PostToolUse for edits and the tools).
  const shell = (command: string) => hook('ToolUse', { tool_name: 'Bash', tool_input: { command, description: 'Plan' }, tool_response: { stdout: '', stderr: '' } });
  await shell(`atlas work status work-0004 --planning-dir "${root}"`);
  await shell(`atlas work step set work-0099 "Nothing" done --planning-dir "${root}"`);
  // An edit whose text only shows such a command (a test, a doc) is no use of it.
  await hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(checkout, 'notes.md'), new_string: 'atlas work accept work-0004' } });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003'], 'reads, unregistered work and edits link nothing');
  await shell(`cd somewhere && atlas work step set work-0004 "Understand the request" done --planning-dir "${root}"`);
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003', 'work-0004']);
  assert.ok(!existsSync(path.join(root, 'active', '0001-cart', '.atlas')), 'nothing is written into the planning folder');
  assert.equal((await run(['check', root], { env })).status, 0);
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

test('a Stop and a SubagentStop at once report the work item once', async t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const input = (event: string, extra: object = {}) => JSON.stringify({ session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: event, ...extra });
  await runHook('PostToolUse', input('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'active', '0001-cart', 'plan.md') } }), env);
  // Both measure from the link; the one that records second finds the other's report and leaves it at that.
  await Promise.all([runHook('Stop', input('Stop'), env), runHook('SubagentStop', input('SubagentStop', { agent_id: 'a1' }), env)]);
  assert.equal(reportsIn(root, 'work-0001', base.ATLAS_HOME!).length, 1);
});

test('a work item the session left is reported at its end when no turn end measured it', async t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const hook = (event: string, input: object) => hookIn(env, event, { session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: event, ...input });
  assert.equal((await run(['work', 'create', '--title', 'Payments', '--planning-dir', root], { env })).status, 0);
  await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'active', '0001-cart', 'plan.md') } });
  await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__step', tool_input: { work: 'work-0002', planningFolder: root } });
  const leaves = () => withDatabase(base.ATLAS_HOME!, database => Number((database.db.prepare('SELECT count(*) AS n FROM session_leave').get() as { n: number }).n));
  // A turn end that cannot read the log keeps the leave for later.
  await hook('StopFailure', { transcript_path: path.join(directory, 'missing.jsonl') });
  assert.deepEqual([leaves(), reportsIn(root, 'work-0001', base.ATLAS_HOME!).length], [1, 0]);
  // A report without measured time, made in the session, does not take the leave's place.
  assert.equal((await run(['work', 'report', root, '--work', 'work-0001', '--model', 'model-a', '--session', session], { env })).status, 0);
  // Interrupted, then exited: no Stop, and the session's end reports the work item it left.
  await hook('SessionEnd', { reason: 'prompt_input_exit' });
  assert.deepEqual([leaves(), reportsIn(root, 'work-0001', base.ATLAS_HOME!).filter(report => report.measured).map(report => report.session)], [0, [session]]);
});

test('a session in a folder that several projects cover is told to ask which one to plan in', async t => {
  const { checkout, home, env } = homeWithPlanning(t);
  const other = path.join(home, 'planning', 'harbor');
  write(path.join(other, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Harbor', folders: [checkout], work_items: [] }));
  const context = await contextIn(env, checkout);
  assert.ok(context.includes('Atlas project "shop-planning"') && context.includes(`Atlas project "Harbor" for this folder: planning folder ${realpathSync.native(other)}`), context);
  assert.match(context, /Several projects cover this folder \(Harbor, shop-planning\): before planning, ask the user which project to plan in/);
  // The tools need the project: a work item only one of them registers names it; otherwise it is asked for.
  const created = await run(['work', 'create', '--title', 'Payments'], { env, cwd: checkout });
  assert.equal(created.status, 1);
  assert.match(created.stderr, /Several projects cover this folder: Harbor \(.*\), shop-planning \(.*\)\. Ask the user which project to plan in/);
  assert.equal((await run(['work', 'status', 'work-0001'], { env, cwd: checkout })).status, 0);
  const where = JSON.parse((await run(['where', '--cwd', checkout], { env })).stdout);
  assert.deepEqual(where.matches.map((match: { project: string }) => match.project), ['Harbor', 'shop-planning']);
  // Once Harbor covers only the folder around the checkout, the deeper folder decides.
  write(path.join(other, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Harbor', folders: [path.dirname(checkout)], work_items: [] }));
  assert.match(await contextIn(env, checkout), /^Atlas project "shop-planning" for this folder: planning folder .*\.\nActive work \(plans relative to the planning folder\):\n/);
  assert.equal(await contextIn(env, path.dirname(checkout)), `Atlas project "Harbor" for this folder: planning folder ${realpathSync.native(other)}.\nNo active work in this project.`);
});

test('choices made on a page reach the session with its next message, once, while they are open', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const choices = path.join(root, 'active', '0001-cart', 'pages', 'layout', 'choices.json');
  write(path.join(path.dirname(choices), 'page.tsx'), 'export default function Page() { return null; }\n');
  const told = async () => { const output = await hookIn(env, 'PageChoices', { session_id: session, cwd: checkout }); return output ? JSON.parse(output).hookSpecificOutput.additionalContext as string : ''; };
  assert.equal(await told(), '');
  // The page asks for the user's attention: the agent is reminded of it with the choice.
  write(path.join(path.dirname(choices), 'page.json'), JSON.stringify({ attention: 'Pick a layout' }));
  write(choices, JSON.stringify({ layout: { value: 'tiles', chosenAt: '2026-11-13T10:00:00Z' } }));
  const notice = await told();
  assert.match(notice, /work-0001 .*page layout .*: layout = "tiles"\. Its page\.json still asks the user: Pick a layout/);
  assert.match(notice, /"closed": true/);
  // Heard once; a closed choice is not told again.
  assert.equal(await told(), '');
  write(choices, JSON.stringify({ layout: { value: 'tiles', chosenAt: '2026-11-13T10:00:00Z', closed: true } }));
  assert.equal(await told(), '');
});

test('a session in an empty Atlas home is told there are no projects and how to make one', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  assert.equal(await contextIn({ ...environment, ATLAS_HOME: home }, directory), `Atlas: no project covers this folder (${realpathSync.native(directory)}), and the Atlas home (${home}) has no projects yet; when the user wants to plan, make one with their agreement (the Atlas tool project_create, or atlas project create), or the user makes one in the app.`);
});

test('a hook never breaks the session: bad input prints nothing and is logged', async t => {
  const { env, home } = homeWithPlanning(t);
  for (const [event, input] of [['SessionStart', 'not json'], ['PostToolUse', '{"session_id": "../escape", "tool_name": "Edit"}'], ['Stop', '{"session_id": "unknown-session"}'], ['Unknown', '{}'], ['', '']]) {
    assert.equal(await hookIn(env, event, input), '', event + ' ' + input);
  }
  assert.match(readFileSync(path.join(home, 'logs', 'hooks.log'), 'utf8'), /"event":"SessionStart".*SyntaxError/);
});
