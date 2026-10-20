import test from 'node:test';
import assert from 'node:assert/strict';
import { nowOf, redact } from './sessionNow.ts';

const line = (value: unknown) => JSON.stringify(value);

test('Now is a session\'s latest message and its last actions, newest first, without reads', () => {
  const lines = [
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Earlier.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/a.ts' } }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/repo/src/search.ts' } }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'C:\\repo\\src\\search.ts' } }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Next is the search index.' }, { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', is_error: true, content: '1 failed' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't5', name: 'mcp__plugin_atlas_atlas__step', input: { work: 'work-0030', action: 'set', step: 'Review', status: 'doing' } }] } }),
    'not json',
  ];
  assert.deepEqual(nowOf(lines), {
    message: 'Next is the search index.',
    actions: [
      { kind: 'atlas', text: 'Atlas step: set work-0030 Review doing' },
      { kind: 'command', text: 'Run the tests', failed: true },
      { kind: 'edit', text: 'Edited search.ts' },
    ],
  }, 'the same file edited twice in a row is one edit');
  assert.equal(nowOf(lines, 2).actions.length, 2);
});

test('a Codex rollout\'s commands and patches are its actions', () => {
  const lines = [
    line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'await tools.exec_command({cmd:"gh pr checks 24"})' } }),
    line({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: C:\\repo\\README.md\n@@\n-a\n+b\n*** End Patch' } }),
    line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'CI passed.' }] } }),
  ];
  assert.deepEqual(nowOf(lines), { message: 'CI passed.', actions: [{ kind: 'edit', text: 'Edited README.md' }, { kind: 'command', text: 'gh pr checks 24', raw: true }] });
  assert.equal(redact('git clone https://bob:s3cret@github.com/a/b && export API_KEY=abc123 && gh auth login --with-token ghp_abcdefghijklmnop'), 'git clone https://bob:…@github.com/a/b && export API_KEY=… && gh auth login --with-token …', 'what looks like a secret is left out');
});
