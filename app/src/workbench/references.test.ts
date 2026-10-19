import test from 'node:test';
import assert from 'node:assert/strict';
import { findReferences, fromUrl, rehypeReferences, type Collected } from './references.ts';

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
  // Only what the reader links is asked about: text, code spans and GitHub addresses of links, not headings or code blocks.
  const text = (value: string) => ({ type: 'text', value });
  const element = (tagName: string, children: object[], properties: Record<string, unknown> = {}) => ({ type: 'element', tagName, properties, children });
  const collected: Collected = { inputs: new Map() };
  rehypeReferences({ collected })(element('root', [
    element('h2', [text('Fix atlas#7')]), element('pre', [element('code', [text('deadbee1')])]),
    element('p', [text('See '), element('code', [text('a1b2c3d')]), text(' and '), element('a', [text('the PR')], { href: 'https://github.com/envsemble/atlas/pull/22' }), element('a', [text('a file')], { href: 'app/src/x.ts:3' })]),
  ]) as never);
  assert.deepEqual([...collected.inputs.values()].map(input => input.kind + ' ' + input.value), ['commit a1b2c3d', 'pull 22']);
});
