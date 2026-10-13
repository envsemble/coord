// Agent time and tokens from harness session logs: turns and waiting, helpers, duplicate response
// lines, the interval, open turns, malformed lines, missing logs and the environment's defaults. The
// logs are small synthetic ones written here; the developer's own ~/.claude and ~/.codex are never read.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harnessSessions, measureSession, sessionLogs, type SessionLogs } from './sessionLog.ts';

delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CODEX_THREAD_ID;

const base = Date.UTC(2026, 9, 11, 9, 0);
const at = (minutes: number) => base + minutes * 60000;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();
const session = '0b6c3c9e-5a1f-4d2b-9a7e-1f2e3d4c5b6a';
const thread = '01a118ad-b889-71a3-a075-de1eee5ff2e2';
const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output, service_tier: 'standard' });

/** Claude Code log lines, as far as timing goes (bodies are placeholders). */
const claude = {
  prompt: (minutes: number, extra: object = {}) => ({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'Placeholder request' }, uuid: 'u' + minutes, timestamp: iso(minutes), ...extra }),
  imagePrompt: (minutes: number) => ({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'Placeholder' }] }, timestamp: iso(minutes) }),
  result: (minutes: number) => ({ type: 'user', message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'placeholder output' }] }, timestamp: iso(minutes) }),
  /** A response that calls a tool, or with `end_turn` the one that ends the turn; a partial line has no stop reason yet. */
  response: (minutes: number, id: string, model: string, tokens = usage(10, 100, 1000, 50), stop: string | null = 'tool_use') => ({ type: 'assistant', message: { model, id, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Placeholder' }], stop_reason: stop, usage: tokens }, timestamp: iso(minutes) }),
  meta: (minutes: number) => ({ type: 'user', isMeta: true, message: { role: 'user', content: 'Injected context' }, timestamp: iso(minutes) }),
  compaction: (minutes: number, durationMs: number, trigger: string) => ({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger, durationMs }, timestamp: iso(minutes) }),
  summary: (minutes: number) => ({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary' }, timestamp: iso(minutes) }),
  attachment: (minutes: number) => ({ type: 'attachment', attachment: { type: 'queued_command' }, timestamp: iso(minutes) }),
  title: () => ({ type: 'ai-title', aiTitle: 'A title', sessionId: session }),
};
const jsonl = (lines: unknown[]) => lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n';

function folders(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-sessions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'claude'), codex = path.join(root, 'codex'), home = path.join(root, 'home');
  mkdirSync(home);
  const environment = { CLAUDE_CONFIG_DIR: config, CODEX_HOME: codex };
  /** A Claude Code session's main log in a project folder, and its subagents' logs. */
  const claudeSession = (main: unknown[], helpers: unknown[][] = [], project = 'C--work-example') => {
    const folder = path.join(config, 'projects', project);
    mkdirSync(path.join(folder, session, 'subagents'), { recursive: true });
    writeFileSync(path.join(folder, session + '.jsonl'), jsonl(main));
    helpers.forEach((lines, index) => {
      writeFileSync(path.join(folder, session, 'subagents', `agent-a${index}.jsonl`), jsonl(lines));
      writeFileSync(path.join(folder, session, 'subagents', `agent-a${index}.meta.json`), JSON.stringify({ agentType: 'general-purpose' }));
    });
  };
  /** A Codex rollout in its dated folder. */
  const rollout = (id: string, lines: unknown[], name = `rollout-2026-10-11T11-00-00-${id}.jsonl`, day = '2026/10/11') => {
    const folder = path.join(codex, 'sessions', ...day.split('/'));
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, name), jsonl(lines));
    return path.join(folder, name);
  };
  return { root, config, codex, home, environment, claudeSession, rollout };
}

const minutes = (milliseconds: number) => milliseconds / 60000;
const measure = async (logs: SessionLogs | null, since: number | null, until: number, live = false) => {
  assert.ok(logs, 'the session\'s logs are found');
  return measureSession(logs, { since: since === null ? null : at(since), at: at(until), live });
};

test('a turn runs from its prompt to its last activity; waiting for the person is not agent time', async t => {
  const { claudeSession, environment, home } = folders(t);
  claudeSession([
    claude.title(),
    claude.prompt(0), claude.response(1, 'msg_1', 'claude-opus-5-5'), claude.result(5), claude.response(6, 'msg_2', 'claude-opus-5-5', undefined, 'end_turn'),
    claude.attachment(30), // a message queued while the person reads: not activity
    claude.meta(40), // injected context is not a prompt
    claude.imagePrompt(60), claude.response(70, 'msg_3', 'claude-opus-5-5', undefined, 'end_turn'),
    claude.prompt(90), // a prompt nobody answered yet
  ]);
  const logs = await sessionLogs([{ harness: 'claude-code', session }], { environment, home });
  const result = await measure(logs, -10, 100);
  assert.equal(minutes(result.agentMs), 6 + 10, 'two turns: 0–6 and 60–70; the 54 minutes between them were the person\'s');
  assert.equal(result.mainModel, 'claude-opus-5-5');
  assert.deepEqual(result.models.map(model => [model.model, minutes(model.agentMs), model.input, model.cacheRead, model.cacheWrite, model.output]), [['claude-opus-5-5', 16, 30, 3000, 150, 300]]);
});

test('helpers working at the same time count once; each model keeps its own time and tokens', async t => {
  const { claudeSession, environment, home } = folders(t);
  claudeSession(
    [claude.prompt(0), claude.response(2, 'msg_main_1', 'claude-opus-5-5', usage(5, 50, 2000, 100)), claude.result(28), claude.response(30, 'msg_main_2', 'claude-opus-5-5', usage(5, 70, 2500, 0), 'end_turn')],
    [
      [claude.prompt(10, { isSidechain: true }), claude.response(12, 'msg_helper_1', 'claude-haiku-5-5', usage(3, 30, 500, 40)), claude.result(40), claude.response(50, 'msg_helper_2', 'claude-haiku-5-5', usage(3, 20, 600, 0), 'end_turn')],
    ],
  );
  const logs = await sessionLogs([{ harness: 'claude-code', session }], { environment, home });
  const whole = await measure(logs, -1, 60);
  assert.equal(minutes(whole.agentMs), 50, 'the union of 0–30 and 10–50');
  assert.deepEqual(whole.models.map(model => [model.model, minutes(model.agentMs), model.input + model.cacheRead + model.cacheWrite + model.output]), [['claude-haiku-5-5', 40, 1196], ['claude-opus-5-5', 30, 4730]]);
  assert.equal(whole.mainModel, 'claude-opus-5-5', 'the main agent\'s model, though its helper worked longer');
  const later = await measure(logs, 20, 60);
  assert.equal(minutes(later.agentMs), 30, 'only (20, 60] counts');
  assert.deepEqual(later.models.map(model => [model.model, minutes(model.agentMs), model.output]), [['claude-haiku-5-5', 30, 20], ['claude-opus-5-5', 10, 70]], 'and only the responses in it');
  const start = await measure(logs, null, 60);
  assert.deepEqual([start.agentMs, start.models, start.mainModel], [0, [], 'claude-opus-5-5'], 'a first report is a starting point: only the model');
});

test('one response written as several lines counts once, by its last line; synthetic messages are not a model', async t => {
  const { claudeSession, environment, home } = folders(t);
  claudeSession([
    claude.prompt(0),
    claude.response(1, 'msg_1', 'claude-opus-5-5', usage(10, 5, 100, 10), null), // thinking block, partial count
    claude.response(2, 'msg_1', 'claude-opus-5-5', usage(10, 80, 100, 10)), // tool call block, final count
    claude.result(3),
    claude.response(4, 'msg_2', '<synthetic>', usage(0, 0)),
  ]);
  const result = await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment, home }), -1, 10);
  assert.deepEqual(result.models.map(model => [model.model, model.input, model.cacheRead, model.cacheWrite, model.output]), [['claude-opus-5-5', 10, 100, 10, 80]]);
  assert.equal(minutes(result.agentMs), 4, 'the synthetic message is still the turn at work');
});

test('waiting for the person inside a turn is not agent time: a question, a plan to approve, a permission prompt', async t => {
  const { claudeSession, environment, home } = folders(t);
  const toolCall = (minutes: number, id: string, name: string) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', id: 'msg_' + id, role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }], usage: usage(1, 1) }, timestamp: iso(minutes) });
  const toolResult = (minutes: number, id: string, source = 'config') => ({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'placeholder' }] }, permissionDecision: { decision: 'accept', source }, timestamp: iso(minutes) });
  claudeSession([
    claude.prompt(0),
    toolCall(1, 'toolu_1', 'Bash'), toolResult(3, 'toolu_1'), // approved by the configuration: the agent at work
    toolCall(4, 'toolu_2', 'AskUserQuestion'), toolResult(40, 'toolu_2'), // the person answered after 36 minutes
    toolCall(41, 'toolu_3', 'Bash'), toolResult(70, 'toolu_3', 'user_temporary'), // the person allowed it after 29 minutes
    toolCall(72, 'toolu_4', 'ExitPlanMode'), toolResult(90, 'toolu_4'), // the person approved the plan
    claude.response(95, 'msg_end', 'claude-opus-5-5'),
  ]);
  const result = await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment, home }), -1, 100);
  assert.equal(minutes(result.agentMs), 4 + 1 + 2 + 5);
});

test('reported from inside the session, a turn still under way runs until the report, unless it waits for the person', async t => {
  const { claudeSession, environment, home } = folders(t);
  const step = (minutes: number, id: string, stop: string | null, tool = 'Bash') => ({ type: 'assistant', message: { model: 'claude-opus-5-5', id, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_' + id, name: tool, input: {} }], stop_reason: stop, usage: usage(1, 1) }, timestamp: iso(minutes) });
  const answer = (minutes: number) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', id: 'msg_done', role: 'assistant', content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn', usage: usage(1, 1) }, timestamp: iso(minutes) });
  claudeSession(
    [claude.prompt(0), step(1, 'a', 'tool_use'), claude.result(10), answer(12)], // the main agent finished its turn and waits
    [
      [claude.prompt(5, { isSidechain: true }), step(6, 'b', 'tool_use')], // a helper waiting for its tests since minute 6
      [claude.prompt(7, { isSidechain: true }), step(8, 'c', null)], // a helper whose response is still being written
      [claude.prompt(9, { isSidechain: true }), step(11, 'd', 'tool_use', 'AskUserQuestion')], // a helper waiting for the person
    ],
  );
  const logs = await sessionLogs([{ harness: 'claude-code', session }], { environment, home });
  assert.equal(minutes((await measure(logs, -1, 18)).agentMs), 12, 'from outside, each turn ends at its last activity');
  assert.equal(minutes((await measure(logs, -1, 18, true)).agentMs), 18, 'from inside, the helpers at work are working now');
  assert.equal(minutes((await measure(logs, -1, 40, true)).agentMs), 12, 'helpers silent for more than a quarter of an hour have most likely stopped');
  const closed = folders(t);
  closed.claudeSession([claude.prompt(0), step(1, 'a', 'tool_use'), claude.result(10), answer(12)], [[claude.prompt(9, { isSidechain: true }), step(11, 'd', 'tool_use', 'AskUserQuestion')]]);
  assert.equal(minutes((await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment: closed.environment, home }), -1, 18, true)).agentMs), 12, 'a finished turn and a question to the person do not run on');
});

test('a helper resumed by its coordinator starts a new turn: the time it sat finished is not work', async t => {
  const { claudeSession, environment, home } = folders(t);
  const resumed = (minutes: number, kind: string) => ({ type: 'user', isMeta: true, origin: { kind }, message: { role: 'user', content: 'Placeholder' }, timestamp: iso(minutes) });
  claudeSession([claude.prompt(0), claude.response(1, 'msg_main', 'claude-opus-5-5', undefined, 'end_turn')], [[
    claude.prompt(0, { isSidechain: true }), claude.response(10, 'msg_1', 'claude-opus-5-5', undefined, 'end_turn'),
    resumed(100, 'coordinator'), claude.response(105, 'msg_2', 'claude-opus-5-5', undefined, 'end_turn'),
    claude.response(200, 'msg_3', 'claude-opus-5-5', undefined, 'end_turn'), // after a closing response, with no prompt seen
    resumed(300, 'task-notification'), claude.response(302, 'msg_4', 'claude-opus-5-5', undefined, 'end_turn'),
  ]]);
  const result = await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment, home }), -1, 400);
  assert.equal(minutes(result.agentMs), 10 + 5 + 2, 'neither the hours between turns nor the stray response bridge a wait');
});

test('a compaction is busy for its duration, but a manual one does not bridge the wait before it', async t => {
  const { claudeSession, environment, home } = folders(t);
  claudeSession([
    claude.prompt(0), claude.response(10, 'msg_1', 'claude-opus-5-5'),
    // Auto-compaction inside a turn: written when it ends, then the turn goes on.
    claude.compaction(14, 3 * 60000, 'auto'), claude.summary(14), claude.response(20, 'msg_2', 'claude-opus-5-5', undefined, 'end_turn'),
    // The person compacts by hand hours later: its boundary is written before the command's lines.
    claude.compaction(302, 2 * 60000, 'manual'), claude.summary(302), claude.prompt(300, { message: { role: 'user', content: '<command-name>/compact</command-name>' } }),
    claude.prompt(302.1, { message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } }),
  ]);
  const result = await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment, home }), -1, 400);
  assert.equal(minutes(result.agentMs), 20 + 2);
});

test('malformed and unknown lines are skipped; text may hold line separators', async t => {
  const { claudeSession, environment, home } = folders(t);
  claudeSession([
    'not json', '{"type":"user","timestamp":', '[]', '42', 'null', '',
    { type: 'user', timestamp: 'yesterday', message: { content: 'x' } },
    { type: 'assistant', timestamp: iso(1), message: 'not an object' },
    { type: 'mystery', timestamp: iso(2) },
    claude.prompt(0, { message: { role: 'user', content: 'A\u2028line\u2029separator' } }),
    claude.response(3, 'msg_1', 'claude-opus-5-5', { input_tokens: -5, output_tokens: 'many', cache_read_input_tokens: 1e3 } as never),
    claude.response(4, 'msg_2', 'model with spaces'),
    claude.result(5),
  ]);
  const result = await measure(await sessionLogs([{ harness: 'claude-code', session }], { environment, home }), -1, 10);
  assert.equal(minutes(result.agentMs), 5, 'the prompt holding U+2028 still starts the turn');
  assert.deepEqual(result.models.map(model => [model.model, minutes(model.agentMs), model.input, model.cacheRead, model.output]), [['claude-opus-5-5', 4, 0, 1000, 0]], 'unusable counts are zero; a response without a usable model id is still the turn at work');
});

test('logs are found by exact names only; missing logs and unusable ids find nothing', async t => {
  const { claudeSession, config, environment, home } = folders(t);
  claudeSession([claude.prompt(0), claude.response(1, 'msg_1', 'claude-opus-5-5')]);
  // Look-alikes: a longer name and a prefix.
  const project = path.join(config, 'projects', 'C--work-example');
  writeFileSync(path.join(project, session + '-copy.jsonl'), jsonl([claude.prompt(0)]));
  writeFileSync(path.join(project, session.slice(0, 8) + '.jsonl'), jsonl([claude.prompt(0)]));
  const logs = await sessionLogs([{ harness: 'claude-code', session }], { environment, home });
  assert.deepEqual(logs?.files.map(file => path.basename(file.file)), [session + '.jsonl']);
  assert.equal(await sessionLogs([{ harness: 'claude-code', session: '11111111-2222-4333-8444-555555555555' }], { environment, home }), null);
  for (const unusable of ['../' + session, session + '/..', 'C:' + session, '..', 'short']) assert.equal(await sessionLogs([{ harness: null, session: unusable }], { environment, home }), null, unusable);
  assert.equal(await sessionLogs([{ harness: null, session }], { environment: {}, home }), null, 'without CLAUDE_CONFIG_DIR, the home folder\'s .claude (empty here)');
  mkdirSync(path.join(home, '.claude', 'projects', 'p'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'projects', 'p', session + '.jsonl'), jsonl([claude.prompt(0)]));
  assert.ok(await sessionLogs([{ harness: null, session }], { environment: {}, home }), 'which is where it looks');
  const empty = folders(t);
  empty.claudeSession([claude.title()]);
  await assert.rejects(measure(await sessionLogs([{ harness: 'claude-code', session }], { environment: empty.environment, home }), -1, 10), /nothing Atlas can read/);
});

test('the environment names the session: Claude Code\'s, then Codex\'s', () => {
  assert.deepEqual(harnessSessions({}), []);
  assert.deepEqual(harnessSessions({ CLAUDE_CODE_SESSION_ID: session, CLAUDECODE: '1' }), [{ harness: 'claude-code', session }]);
  assert.deepEqual(harnessSessions({ CODEX_THREAD_ID: thread }), [{ harness: 'codex', session: thread }]);
  assert.deepEqual(harnessSessions({ CLAUDE_CODE_SESSION_ID: session, CODEX_THREAD_ID: thread }).map(entry => entry.harness), ['claude-code', 'codex']);
  assert.deepEqual(harnessSessions({ CLAUDE_CODE_SESSION_ID: '../etc', CODEX_THREAD_ID: '' }), [], 'an unusable id is ignored');
});

/** Codex rollout lines. */
const codex = {
  meta: (id: string, extra: object = {}) => ({ timestamp: iso(0), ordinal: 0, type: 'session_meta', payload: { id, session_id: id, cwd: 'C:\\work', originator: 'Codex Desktop', model_provider: 'openai', base_instructions: 'x'.repeat(30000), ...extra } }),
  started: (minutes: number, turn: string) => ({ timestamp: iso(minutes), ordinal: 1, type: 'event_msg', payload: { type: 'task_started', turn_id: turn, started_at: Math.floor(at(minutes) / 1000) } }),
  context: (minutes: number, turn: string, model: string) => ({ timestamp: iso(minutes), ordinal: 2, type: 'turn_context', payload: { turn_id: turn, cwd: 'C:\\work', model, effort: 'high' } }),
  item: (minutes: number) => ({ timestamp: iso(minutes), ordinal: 3, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '"type":"event_msg","payload":{"type":"task_complete"' }] } }),
  tokens: (minutes: number, input: number, cached: number, output: number, last: [number, number, number] = [input, cached, output]) => ({ timestamp: iso(minutes), ordinal: 4, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output }, last_token_usage: { input_tokens: last[0], cached_input_tokens: last[1], cache_write_input_tokens: 0, output_tokens: last[2], total_tokens: last[0] + last[2] } } } }),
  complete: (minutes: number, turn: string) => ({ timestamp: iso(minutes), ordinal: 5, type: 'event_msg', payload: { type: 'task_complete', turn_id: turn, duration_ms: 1 } }),
  aborted: (minutes: number, turn: string) => ({ timestamp: iso(minutes), ordinal: 6, type: 'event_msg', payload: { type: 'turn_aborted', turn_id: turn, reason: 'interrupted' } }),
};

test('Codex: turns from start to completion or abort, each with its model; tokens from the running count', async t => {
  const { rollout, environment, home } = folders(t);
  rollout(thread, [
    codex.meta(thread),
    codex.started(0, 't1'), codex.context(0.1, 't1', 'gpt-6.1-sol'), codex.item(1), codex.tokens(2, 1000, 800, 50), codex.complete(10, 't1'),
    codex.started(30, 't2'), codex.context(30, 't2', 'gpt-5-codex'), codex.tokens(31, 3000, 2600, 90), codex.aborted(35, 't2'),
    'garbage', '{"timestamp":"2026-10-11T09:40:00.000Z","type":"event_msg","payload":{"type":"task_started"', // cut off mid-write
  ]);
  const logs = await sessionLogs([{ harness: 'codex', session: thread }], { environment, home });
  const result = await measure(logs, -1, 60);
  assert.equal(minutes(result.agentMs), 10 + 5);
  assert.deepEqual(result.models.map(model => [model.model, minutes(model.agentMs), model.input, model.cacheRead, model.output]), [['gpt-6.1-sol', 10, 200, 800, 50], ['gpt-5-codex', 5, 200, 1800, 40]]);
  assert.equal(result.mainModel, 'gpt-6.1-sol');
  assert.equal((await measure(logs, null, 60)).mainModel, 'gpt-5-codex', 'without an interval, the latest model');
});

test('Codex: a question to the person pauses the turn until the answer', async t => {
  const { rollout, environment, home } = folders(t);
  const question = (minutes: number, call: string) => ({ timestamp: iso(minutes), ordinal: 7, type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', arguments: '{"questions":[]}', call_id: call } });
  const answer = (minutes: number, call: string) => ({ timestamp: iso(minutes), ordinal: 8, type: 'response_item', payload: { type: 'function_call_output', call_id: call, output: '{"answers":{}}' } });
  rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol'), question(5, 'call_1'), answer(50, 'call_1'), answer(51, 'call_2'), codex.complete(60, 't1')]);
  const result = await measure(await sessionLogs([{ harness: 'codex', session: thread }], { environment, home }), -1, 70);
  assert.equal(minutes(result.agentMs), 5 + 10, 'an output for a call that did not ask the person changes nothing');
});

test('Codex: a forked subagent\'s copy of its parent\'s history counts neither as its work nor as its tokens', async t => {
  const { rollout, environment, home } = folders(t);
  rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol'), codex.tokens(5, 900000, 800000, 9000), codex.complete(10, 't1')]);
  const fork = '01a118ae-0000-7000-8000-000000000009';
  // Copied at minute 30, in a burst of a second: a finished turn of the parent and its running count.
  const copied = (line: { timestamp: string }, offset: number) => ({ ...line, timestamp: new Date(at(30) + offset).toISOString() });
  rollout(fork, [
    { ...codex.meta(fork, { session_id: thread, parent_thread_id: thread, forked_from_id: thread }), timestamp: iso(30) },
    copied(codex.started(0, 't1'), 100), copied(codex.context(0, 't1', 'gpt-6.1-sol'), 200), copied(codex.tokens(5, 900000, 800000, 9000), 300), copied(codex.complete(10, 't1'), 400),
    // Its own work: a turn of five minutes, whose count continues the copied one.
    codex.started(31, 'f1'), codex.context(31, 'f1', 'gpt-5-codex-mini'), codex.tokens(33, 950000, 840000, 9500, [50000, 40000, 500]), codex.complete(36, 'f1'),
  ]);
  const result = await measure(await sessionLogs([{ harness: 'codex', session: thread }], { environment, home }), 20, 60);
  assert.equal(minutes(result.agentMs), 5);
  assert.deepEqual(result.models.map(model => [model.model, minutes(model.agentMs), model.input, model.cacheRead, model.output]), [['gpt-5-codex-mini', 5, 10000, 40000, 500]]);
});

test('Codex: questions are found whichever field a version writes first', async t => {
  const { rollout, environment, home } = folders(t);
  const question = (minutes: number, call: string) => ({ timestamp: iso(minutes), ordinal: 7, type: 'response_item', payload: { type: 'function_call', id: 'fc_1', name: 'request_user_input', arguments: '{}', call_id: call } });
  const answer = (minutes: number, call: string) => ({ timestamp: iso(minutes), ordinal: 8, type: 'response_item', payload: { type: 'function_call_output', id: 'fco_1', call_id: call, output: '{}' } });
  rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol'), question(5, 'call_1'), answer(50, 'call_1'), codex.complete(60, 't1')]);
  assert.equal(minutes((await measure(await sessionLogs([{ harness: 'codex', session: thread }], { environment, home }), -1, 70)).agentMs), 5 + 10);
});

test('Codex: an open turn ends at its last event, or now when the report comes from inside it', async t => {
  const { rollout, environment, home } = folders(t);
  rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol'), codex.tokens(20, 500, 0, 20)]);
  const logs = await sessionLogs([{ harness: 'codex', session: thread }], { environment, home });
  assert.equal(minutes((await measure(logs, -1, 30)).agentMs), 20);
  assert.equal(minutes((await measure(logs, -1, 30, true)).agentMs), 30, 'live: the turn is still under way');
});

test('Codex: later parts of a thread continue it, and subagent threads that name it are included', async t => {
  const { rollout, environment, home } = folders(t);
  rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol'), codex.tokens(5, 1000, 0, 100), codex.complete(10, 't1')]);
  // A later part starts its running count where the thread left it: only its last response is new.
  rollout(thread, [codex.meta(thread), codex.started(20, 't2'), codex.context(20, 't2', 'gpt-6.1-sol'), codex.tokens(25, 1600, 0, 130, [600, 0, 30]), codex.complete(30, 't2')], `rollout-2026-10-11T11-20-00-${thread}_01a111af-cdef-7471-b795-2b5bcc094643.jsonl`);
  const child = '01a118ae-0000-7000-8000-000000000001', grandchild = '01a118ae-0000-7000-8000-000000000002', stranger = '01a118ae-0000-7000-8000-000000000003';
  rollout(child, [codex.meta(child, { session_id: thread, parent_thread_id: thread, source: { subagent: { thread_spawn: { parent_thread_id: thread, depth: 1 } } } }), codex.started(22, 'c1'), codex.context(22, 'c1', 'gpt-5-codex-mini'), codex.tokens(23, 100, 0, 10), codex.complete(40, 'c1')]);
  rollout(grandchild, [codex.meta(grandchild, { session_id: thread, parent_thread_id: child }), codex.started(41, 'g1'), codex.context(41, 'g1', 'gpt-5-codex-mini'), codex.complete(45, 'g1')]);
  rollout(stranger, [codex.meta(stranger), codex.started(0, 's1'), codex.context(0, 's1', 'gpt-4.1'), codex.complete(59, 's1')]);
  // An old rollout from before the thread began is not read.
  rollout('01a00000-0000-7000-8000-000000000004', [codex.meta('01a00000-0000-7000-8000-000000000004', { session_id: thread })], 'rollout-2026-10-01T08-00-00-01a00000-0000-7000-8000-000000000004.jsonl', '2026/10/01');
  const logs = await sessionLogs([{ harness: 'codex', session: thread }], { environment, home });
  assert.equal(logs?.files.length, 2, 'both parts of the thread');
  const result = await measure(logs, 15, 60);
  assert.equal(minutes(result.agentMs), 40 - 20 + 45 - 41, '20–30 in the thread with 22–40 and 41–45 in its subagents; the stranger not at all');
  assert.deepEqual(result.models.map(model => [model.model, minutes(model.agentMs), model.input + model.cacheRead + model.output]), [['gpt-5-codex-mini', 22, 110], ['gpt-6.1-sol', 10, 630]]);
  assert.equal(result.mainModel, 'gpt-6.1-sol');
});

test('when both harnesses name a session, the one whose log was written last is measured', async t => {
  const { claudeSession, rollout, environment, home, config } = folders(t);
  claudeSession([claude.prompt(0), claude.response(1, 'msg_1', 'claude-opus-5-5')]);
  const file = rollout(thread, [codex.meta(thread), codex.started(0, 't1'), codex.context(0, 't1', 'gpt-6.1-sol')]);
  const old = new Date(at(-600));
  utimesSync(path.join(config, 'projects', 'C--work-example', session + '.jsonl'), old, old);
  const both = harnessSessions({ CLAUDE_CODE_SESSION_ID: session, CODEX_THREAD_ID: thread });
  assert.equal((await sessionLogs(both, { environment, home }))?.harness, 'codex');
  utimesSync(file, new Date(at(-900)), new Date(at(-900)));
  assert.equal((await sessionLogs(both, { environment, home }))?.harness, 'claude-code');
});
