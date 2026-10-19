import test from 'node:test';
import assert from 'node:assert/strict';
import { documentReferences, findReferences, fromUrl } from './references.ts';

const found = (text: string, code = false) => findReferences(text, code).map(match => text.slice(match.start, match.end));

test('the reader finds PRs, commits, files, work items and applications\' links in a plan\'s text', () => {
  const text = 'Merged atlas#22 (atlas@4ab195a) after 4ab195a; see app/src/hub/Hub.tsx:68, work-0023 and t3-thread://thread/abc. Done.';
  assert.deepEqual(found(text), ['atlas#22', 'atlas@4ab195a', '4ab195a', 'app/src/hub/Hub.tsx:68', 'work-0023', 't3-thread://thread/abc']);
  const [pull, , , path] = findReferences(text).map(match => match.found);
  assert.deepEqual(pull, { kind: 'host', input: { kind: 'pull', repository: 'atlas', value: '22', line: null } });
  assert.deepEqual(path, { kind: 'host', input: { kind: 'path', repository: null, value: 'app/src/hub/Hub.tsx', line: 68 } });
  assert.deepEqual(fromUrl('https://github.com/envsemble/atlas/pull/22/files'), { kind: 'pull', repository: 'envsemble/atlas', value: '22', line: null });
  assert.deepEqual(found('https://github.com/envsemble/atlas/commit/4ab195a9.'), ['https://github.com/envsemble/atlas/commit/4ab195a9']);
});

test('what only looks like a reference stays text', () => {
  // Numbers, words, colours, UUIDs, e-mail addresses, versions, other web addresses and bare file names in prose.
  assert.deepEqual(found('1234567 defaced #a1b2c3d4 550e8400-e29b-41d4-a716-446655440000 me@deadbee1.com v0.8.0 README.md e.g. https://example.com/a/b.html &#39;'), []);
  // In a code span a bare file name and a hash in a command count; a call does not.
  assert.deepEqual(found('git show 4ab195a -- package.json', true), ['4ab195a', 'package.json']);
  assert.deepEqual(found('render.call()', true), []);
  // Code blocks are not looked into; code spans are.
  assert.deepEqual(documentReferences('See `a1b2c3d`.\n\n```\ndeadbee1\n```\n').map(input => input.value), ['a1b2c3d']);
});
