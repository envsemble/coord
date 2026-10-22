import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codexHookKeys, codexHookTrust } from './trust.ts';

const hooks = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../plugin/hooks/codex.json'), 'utf8')) as unknown;
const keys = codexHookKeys('atlas@atlas', 'hooks/codex.json', hooks);
const trusted = (key: string) => `[hooks.state."${key}"]\ntrusted_hash = "sha256:${'0'.repeat(64)}"\n`;

test('Codex\'s trust keys are one per command hook of the events Codex runs, by group and place', () => {
  assert.ok(keys.includes('atlas@atlas:hooks/codex.json:session_start:0:0'));
  // PostToolUse has two groups: the planning check, and the state hook after every tool.
  assert.ok(keys.includes('atlas@atlas:hooks/codex.json:post_tool_use:1:0'));
  assert.ok(!keys.some(key => /:(?:notification|stop_failure|post_tool_use_failure):/.test(key)), 'events Codex does not run have no entry');
});

test('the Atlas hooks are trusted with an entry each; a file of another shape says nothing', () => {
  // As a person's config.toml has it, trusted for an earlier plugin whose hooks were in hooks/hooks.json.
  const earlier = '[plugins."browser@openai-bundled"]\nenabled = true\n\n' + ['post_tool_use', 'session_start', 'subagent_stop', 'stop']
    .map(event => trusted(`atlas@atlas:hooks/hooks.json:${event}:0:0`)).join('\n');
  assert.equal(codexHookTrust(earlier, keys), 'untrusted');
  const all = earlier + keys.map(trusted).join('\n');
  assert.equal(codexHookTrust(all, keys), 'trusted');
  assert.equal(codexHookTrust(all.replace(/(codex.json:session_start:0:0"]\ntrusted_hash = ".*")/, '$1\nenabled = false'), keys), 'untrusted', 'a hook turned off');
  assert.equal(codexHookTrust(all.replace(trusted(keys[0]), ''), keys), 'untrusted');
  // No hooks.state, keys of another shape, or a hooks.state written in a way this does not read.
  assert.equal(codexHookTrust('model = "o3"\n', keys), 'unknown');
  assert.equal(codexHookTrust(null, keys), 'unknown');
  assert.equal(codexHookTrust(all + '[hooks.state."atlas@atlas/session_start"]\ntrusted = true\n', keys), 'unknown');
  assert.equal(codexHookTrust(`[hooks.state]\n"${keys[0]}" = { trusted_hash = "sha256:0" }\n`, keys), 'unknown');
});
