import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hostname, release } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atlas, command, homeWithPlanning, planText, temporary, write } from './testing.ts';

const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
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

test('hooks give the session its planning context, check and link planning edits, and record statistics at stop', t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const hook = (event: string, input: object) => {
    const result = atlas(['hook', event], { env, input: JSON.stringify({ session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: event, ...input }) });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    return result.stdout ? JSON.parse(result.stdout) : null;
  };
  const links = () => JSON.parse(readFileSync(path.join(base.ATLAS_HOME!, 'sessions', session + '.json'), 'utf8')).work as { workId: string; amending: boolean; planningFolder: string; linked: string }[];

  // SessionStart: the planning folder, its active work, and how to plan; nothing outside a registered checkout.
  const started = hook('SessionStart', { source: 'startup' });
  assert.equal(started.hookSpecificOutput.hookEventName, 'SessionStart');
  const context: string = started.hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`Atlas planning folder for this checkout: ${root} (repositories: shop).`), context);
  assert.ok(context.includes('- work-0001 "Cart" (draft, not_started): no ledger yet. Plan: ' + path.join(root, 'active', '0001-cart', 'plan.md')), context);
  assert.match(context, /ask before opening a work item/);
  assert.equal(atlas(['hook', 'SessionStart'], { env, input: JSON.stringify({ session_id: session, cwd: temporary(t) }) }).stdout, '');

  // PostToolUse: a valid edit of a draft plan links the session, without amending.
  const plan = path.join(root, 'active', '0001-cart', 'plan.md');
  assert.equal(hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: plan, old_string: 'a', new_string: 'b' }, tool_response: { success: true } }), null);
  const [first] = links();
  assert.deepEqual(first, { planningFolder: root, workId: 'work-0001', amending: false, linked: first.linked });
  assert.ok(Date.parse(first.linked) > Date.now() - 60000, 'when the session started on the work');
  // Editing the plan of an accepted design amends it.
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted'));
  hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: plan, content: '' } });
  assert.equal(links()[0].amending, true);
  // A broken edit is handed back to the agent to fix.
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted').replace('title: "Cart"', 'title: 1.5'));
  const blocked = hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: plan } });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /shop-planning: active\/0001-cart\/plan\.md: ambiguous implicit YAML scalar/);
  assert.equal(blocked.hookSpecificOutput.additionalContext, blocked.reason);
  writeFileSync(plan, planText('work-0001', 'Cart', 'accepted'));
  // Files outside the home are not Atlas's business, nor are files in the home outside a planning
  // folder: notes beside them, or a folder being set up before it has its planning.json.
  assert.equal(hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(checkout, 'src.ts') } }), null);
  const notes = path.join(path.dirname(root), 'notes.md'), setUp = path.join(path.dirname(root), 'new-planning', 'README.md');
  write(notes, '# Notes\n');
  write(setUp, '# Planning\n');
  assert.equal(hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: notes } }), null);
  assert.equal(hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: setUp } }), null);
  // Reading a planning file records it as document use, for the work item the session is linked to.
  assert.equal(hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: plan } }), null);
  const usage = path.join(base.ATLAS_HOME!, 'usage');
  const database = new DatabaseSync(path.join(usage, readdirSync(usage)[0], 'usage.sqlite'));
  assert.deepEqual({ ...database.prepare('SELECT path, task_id, session_id FROM events').get() }, { path: 'active/0001-cart/plan.md', task_id: 'work-0001', session_id: session });
  database.close();

  // Codex: apply_patch names its files in the patch, relative to the session's folder.
  assert.equal(atlas(['work', 'create', '--title', 'Payments', '--repo', 'shop', '--planning-dir', root], { env }).status, 0);
  const patch = '*** Begin Patch\n*** Update File: active/0002-payments/plan.md\n@@\n-# Payments\n+# Payments today\n*** End Patch\n';
  const codex = atlas(['hook', 'PostToolUse'], { env, input: JSON.stringify({ session_id: session, transcript_path: null, cwd: root, hook_event_name: 'PostToolUse', model: 'gpt-5.5', permission_mode: 'default', tool_name: 'apply_patch', tool_input: { command: patch }, tool_response: 'Done', tool_use_id: 'call_1', turn_id: 't1' }) });
  assert.deepEqual([codex.status, codex.stdout], [0, '']);
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002']);
  // An Atlas MCP tool call links the work item it was about, from its input or its result.
  atlas(['work', 'create', '--title', 'Refunds', '--repo', 'shop', '--planning-dir', root], { env });
  hook('PostToolUse', { tool_name: 'mcp__plugin_atlas_atlas__work_status', tool_input: { work: 'work-0003' }, tool_response: [{ type: 'text', text: JSON.stringify({ workId: 'work-0003', planningFolder: root }) }] });
  assert.deepEqual(links().map(item => item.workId), ['work-0001', 'work-0002', 'work-0003']);

  // Stop records a report for each linked work item, measured from the session's log since the
  // session started on it, and clears amending.
  const spent = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 };
  appendFileSync(transcript, JSON.stringify({ type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', role: 'assistant', content: [], stop_reason: 'end_turn', usage: spent }, timestamp: new Date().toISOString() }) + '\n');
  assert.equal(hook('Stop', { stop_hook_active: false }), null);
  for (const folder of ['0001-cart', '0002-payments', '0003-refunds']) {
    const reports = readFileSync(path.join(root, 'active', folder, '.atlas', 'statistics.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(reports.map(report => [report.session, report.model]), [[session, 'claude-opus-5-5']], folder);
    const linked = links().find(item => folder.startsWith(item.workId.slice(5)))!.linked;
    assert.equal(reports[0].measured?.since, linked, folder + ': the first stop measures from the link');
    assert.deepEqual(reports[0].measured.models.map((item: { output: number }) => item.output), [4], folder + ': only what came after the link');
  }
  assert.deepEqual(links().map(item => item.amending), [false, false, false]);
  hook('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: transcript });
  assert.equal(readFileSync(path.join(root, 'active', '0001-cart', '.atlas', 'statistics.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(atlas(['planning', 'check', root], { env }).status, 0);
});

test('hooks of one session running at once keep each other\'s links', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const ids = Array.from({ length: 8 }, (_, index) => 'work-01' + String(index).padStart(2, '0'));
  await Promise.all(ids.map(work => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, 'hook', 'PostToolUse'], { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject).on('exit', resolve);
    child.stdin.end(JSON.stringify({ session_id: session, cwd: checkout, tool_name: 'mcp__atlas__work_status', tool_input: { work, planningFolder: root } }));
  })));
  const linked = JSON.parse(readFileSync(path.join(env.ATLAS_HOME!, 'sessions', session + '.json'), 'utf8')).work.map((item: { workId: string }) => item.workId);
  assert.deepEqual(linked.sort(), ids);
  assert.deepEqual(readdirSync(path.join(env.ATLAS_HOME!, 'sessions')), [session + '.json'], 'no lock is left behind');
});

test('a stop clears amending only for edits its report counted, and a dead hook\'s lock is taken over at once', t => {
  const { root, checkout, directory, env: base } = homeWithPlanning(t);
  const config = path.join(directory, 'claude');
  const transcript = claudeLog(config);
  const env = { ...base, CLAUDE_CONFIG_DIR: config };
  const file = path.join(base.ATLAS_HOME!, 'sessions', session + '.json');
  const stop = () => atlas(['hook', 'Stop'], { env, input: JSON.stringify({ session_id: session, transcript_path: transcript, cwd: checkout, hook_event_name: 'Stop' }) });
  const linkedAmending = (amended: string) => write(file, JSON.stringify({ session, transcriptPath: transcript, updated: amended, work: [{ planningFolder: root, workId: 'work-0001', amending: true, linked: new Date(Date.now() - 60000).toISOString(), amended }] }));
  const amending = () => JSON.parse(readFileSync(file, 'utf8')).work[0].amending;
  // An amending edit recorded after the report began (here: later than now) stays for the next report.
  linkedAmending(new Date(Date.now() + 60000).toISOString());
  // A lock left by a hook that died names its process: it does not hold the stop up.
  write(file + '.lock', JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform, release: release(), token: 'gone', createdAt: new Date().toISOString() }));
  const started = Date.now();
  assert.equal(stop().status, 0);
  assert.ok(Date.now() - started < 8000, 'the dead hook\'s lock was taken over without waiting for it to go stale');
  assert.ok(!existsSync(file + '.lock'));
  assert.equal(amending(), true);
  linkedAmending(new Date(Date.now() - 1000).toISOString());
  stop();
  assert.equal(amending(), false, 'the report counted the edit');
});

test('a hook never breaks the session: bad input prints nothing, exits 0 and is logged', t => {
  const { env, home } = homeWithPlanning(t);
  for (const [event, input] of [['SessionStart', 'not json'], ['PostToolUse', '{"session_id": "../escape", "tool_name": "Edit"}'], ['Stop', '{"session_id": "unknown-session"}'], ['Unknown', '{}'], ['', '']]) {
    const result = atlas(['hook', ...event ? [event] : []], { env, input });
    assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', ''], event + ' ' + input);
  }
  assert.ok(existsSync(path.join(home, 'logs', 'hooks.log')));
  assert.match(readFileSync(path.join(home, 'logs', 'hooks.log'), 'utf8'), /"event":"SessionStart".*SyntaxError/);
});
