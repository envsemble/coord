import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codexHookKeys, codexHookTrust } from './trust.ts';

const hooks = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../plugin/hooks/codex.json'), 'utf8')) as unknown;
const atlas = 'atlas@atlas';
const keys = codexHookKeys(atlas, 'hooks/codex.json', hooks);
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
  assert.equal(codexHookTrust(earlier, atlas, keys), 'untrusted');
  const all = earlier + keys.map(trusted).join('\n');
  assert.equal(codexHookTrust(all, atlas, keys), 'trusted');
  assert.equal(codexHookTrust(all.replace(/(codex\.json:session_start:0:0"]\ntrusted_hash = ".*")/, '$1\nenabled = false'), atlas, keys), 'untrusted', 'a hook turned off');
  assert.equal(codexHookTrust(all.replace(trusted(keys[0]), ''), atlas, keys), 'untrusted');
  // No entry of Atlas's (another plugin's say nothing of it), one of another shape, or a hooks.state
  // written in a way this does not read.
  assert.equal(codexHookTrust('model = "o3"\n', atlas, keys), 'unknown');
  assert.equal(codexHookTrust(null, atlas, keys), 'unknown');
  assert.equal(codexHookTrust(trusted('other@market:hooks/hooks.json:stop:0:0'), atlas, keys), 'unknown');
  assert.equal(codexHookTrust(all + trusted('other@market:odd-key'), atlas, keys), 'trusted');
  assert.equal(codexHookTrust(all + trusted('atlas@atlas:session_start'), atlas, keys), 'unknown');
  assert.equal(codexHookTrust(all + trusted('atlas@atlas:hooks/codex.json:renamed_event:0:0'), atlas, keys), 'unknown');
  assert.equal(codexHookTrust(`[hooks.state]\n"${keys[0]}" = { trusted_hash = "sha256:0" }\n`, atlas, keys), 'unknown');
});
