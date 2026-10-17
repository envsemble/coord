import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withDatabase } from '@envsemble/atlas-planning';
import { runHook } from './hook.ts';
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
  /** Whether the database has the session's agent in a turn (the app's live dot). */
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
  // An Atlas MCP tool call links the work item it was about, from its input or its result.
  await run(['work', 'create', '--title', 'Refunds', '--repo', 'shop', '--planning-dir', root], { env });
  await hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__work_status', tool_input: { work: 'work-0003' }, tool_response: [{ type: 'text', text: JSON.stringify({ workId: 'work-0003', planningFolder: root }) }] });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003']);

  // Stop records a report for each linked work item, measured from the session's log since the
  // session started on it, and clears amending.
  const spent = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 };
  const responded = Date.now();
  appendFileSync(transcript, JSON.stringify({ type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: 'end_turn', usage: spent }, timestamp: new Date(responded).toISOString() }) + '\n');
  while (Date.now() <= responded) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(await hook('Stop', { stop_hook_active: false }), null);
  for (const workId of ['work-0001', 'work-0002', 'work-0003']) {
    const reports = reportsIn(root, workId, base.ATLAS_HOME!);
    assert.deepEqual(reports.map(report => [report.session, report.model]), [[session, 'claude-opus-5-5']], workId);
    const linked = links().find(item => item.workId === workId)!.linked;
    assert.equal(reports[0].measured?.since, linked, workId + ': the first stop measures from the link');
    assert.deepEqual(reports[0].measured!.models.map(item => item.output), [4], workId + ': only what came after the link');
  }
  assert.deepEqual(links().map(item => item.amending), [false, false, false]);
  assert.equal(working(), 0, 'the turn is over when the agent stops');
  // The next tool use, on any file, puts the linked session back in a turn; a subagent stopping leaves it there.
  await hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(checkout, 'src.ts') } });
  assert.equal(working(), 1);
  await hook('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: transcript });
  assert.equal(reportsIn(root, 'work-0001', base.ATLAS_HOME!).length, 2);
  assert.equal(working(), 1);
  assert.ok(!existsSync(path.join(root, 'active', '0001-cart', '.atlas')), 'nothing is written into the planning folder');
  assert.equal((await run(['planning', 'check', root], { env })).status, 0);
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
