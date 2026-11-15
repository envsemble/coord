import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { changesWork, devGate } from './devSession.ts';

test("Coord Dev's hooks do nothing outside a dev session; saying \"dev session\" starts one for the rest of the session", () => {
  const home = mkdtempSync(path.join(tmpdir(), 'coord-dev-session-'));
  try {
    const input = (session: string, extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: session, ...extra });
    // Another session: nothing runs, nothing is said, nothing is marked.
    assert.deepEqual(devGate('SessionStart', input('s1'), home), { run: false, output: null });
    assert.deepEqual(devGate('PageChoices', input('s1', { prompt: 'fix the build' }), home), { run: false, output: null });
    assert.deepEqual(devGate('PostToolUse', input('s1'), home), { run: false, output: null });
    assert.equal(existsSync(path.join(home, 'agent', 'dev-sessions', 's1')), false);

    // The prompt that says so: the synchronous hook tells the agent, the state hook records it.
    const started = devGate('PageChoices', input('s1', { prompt: 'Dev session: try the new grill' }), home);
    assert.equal(started.run, false);
    const note = JSON.parse(started.output!).hookSpecificOutput;
    assert.equal(note.hookEventName, 'UserPromptSubmit');
    assert.match(note.additionalContext, /dev- skills/);
    assert.match(note.additionalContext, /coord-dev tools/);
    assert.deepEqual(devGate('UserPromptSubmit', input('s1', { prompt: 'Dev session: try the new grill' }), home), { run: true, output: null });

    // The two prompt hooks run at once: the note comes however they finish.
    assert.deepEqual(devGate('UserPromptSubmit', input('s3', { prompt: 'dev session' }), home), { run: true, output: null });
    assert.match(devGate('PageChoices', input('s3', { prompt: 'dev session' }), home).output!, /Coord Dev session/);

    // From then on its hooks run, without saying it again; other sessions stay as they were.
    assert.deepEqual(devGate('PostToolUse', input('s1'), home), { run: true, output: null });
    assert.deepEqual(devGate('SessionStart', input('s1'), home), { run: true, output: null });
    assert.deepEqual(devGate('PostToolUse', input('s2'), home), { run: false, output: null });
    // An unnamed or oddly named session never starts one.
    assert.deepEqual(devGate('PageChoices', JSON.stringify({ prompt: 'dev session' }), home), { run: false, output: null });
    assert.deepEqual(devGate('PageChoices', input('../x', { prompt: 'dev session' }), home), { run: false, output: null });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("each command links a session only through its own Coord tools: the release's coord, Coord Dev's coord-dev", () => {
  // Claude Code names a plugin's tools mcp__plugin_<plugin>_<server>__<tool>, Codex mcp__<server>__<tool>.
  assert.equal(changesWork('mcp__plugin_coord_coord__work_update', false), true);
  assert.equal(changesWork('mcp__coord__step', false), true);
  assert.equal(changesWork('mcp__plugin_coord-dev_coord-dev__work_update', false), false);
  assert.equal(changesWork('mcp__plugin_coord-dev_coord-dev__work_update', true), true);
  assert.equal(changesWork('mcp__coord-dev__state', true), true);
  assert.equal(changesWork('mcp__plugin_coord_coord__step', true), false);
  // Reading changes nothing.
  assert.equal(changesWork('mcp__plugin_coord_coord__work_status', false), false);
});
