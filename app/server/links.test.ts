import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink } from '../src/links.ts';
import type { Document, Work } from '../src/types.ts';

const file = { path: 'active/0001-example/docs/decision.md' } as Document;
const work = { path: 'active/0001-example', id: 'work-0001' } as Work;

test('parent traversal cannot clamp escaped references onto retained root documents', () => {
  const retained = { path: 'README.md' } as Document;
  const source = 'active/0001-example/plan.md';
  for (const href of ['../../../README.md', '\u0000../../../README.md', '\u001f../../../README.md', '../../../../README.md', '/../../../README.md', '%2e%2e/%2e%2e/%2e%2e/README.md', '..\\..\\..\\README.md', 'http://planning.local/../README.md', 'http:////planning.local/../README.md']) {
    assert.deepEqual(resolveLink(href, source, [retained]), {}, href);
  }
  for (const href of ['../../README.md', '%2e%2e/%2e%2e/README.md', '/README.md', 'docs/../../../README.md']) {
    assert.equal(resolveLink(href, source, [retained]).file, retained, href);
  }
});
test('contained document and work-folder links resolve without granting arbitrary local access', () => {
  assert.equal(resolveLink('docs/decision.md#the-choice', 'active/0001-example/plan.md', [file]).file, file);
  assert.equal(resolveLink('docs/decision.md#the%20choice', 'active/0001-example/plan.md', [file]).anchor, 'the choice');
  assert.equal(resolveLink('active/0001-example/', 'README.md', [file], [work]).work, work);
  assert.equal(resolveLink('https://example.com/paper', 'README.md', []).external, 'https://example.com/paper');
  assert.deepEqual(resolveLink('file:///C:/private/notes.md', 'README.md', []), {});
  assert.equal(resolveLink('../outside.md', 'README.md', []).file, undefined);
});
test('malformed legacy references never crash the reader', () => {
  for (const href of ['http://', 'http://localhost:99999/', 'caf%E9.md', '#%ZZ', 'decision.md#%E9']) {
    assert.deepEqual(resolveLink(href, 'README.md', [file]), {});
  }
});

test('relative links keep reserved filename characters in the source directory', () => {
  for (const folder of ['foo#bar', 'foo?bar', 'foo%bar', 'foo bar', 'foo\\bar']) {
    const target = { path: 'active/' + folder + '/note.md' } as Document;
    assert.equal(resolveLink('note.md#The-Choice', 'active/' + folder + '/plan.md', [target]).file, target);
    assert.equal(resolveLink('./note.md', 'active/' + folder + '/plan.md', [target]).file, target);
    assert.equal(resolveLink('note.md#The-Choice', 'active/' + folder + '/plan.md', [target]).anchor, 'The-Choice');
    assert.equal(resolveLink(encodeURIComponent(folder) + '/note.md', 'active/plan.md', [target]).file, target);
  }
});

test('Windows targets use indexed spelling while case-sensitive hosts retain distinct names', () => {
  assert.equal(resolveLink('DOCS/Decision.md#The-Choice', 'ACTIVE/0001-EXAMPLE/plan.md', [file], [work], false).file, file);
  assert.equal(resolveLink('ACTIVE/0001-EXAMPLE/', 'README.md', [file], [work], false).work, work);
  assert.equal(resolveLink('DOCS/Decision.md#The-Choice', 'ACTIVE/0001-EXAMPLE/plan.md', [file], [work], false).anchor, 'The-Choice');
  assert.equal(resolveLink('DOCS/Decision.md', 'active/0001-example/plan.md', [file], [work], true).file, undefined);
  assert.equal(resolveLink('ACTIVE/0001-EXAMPLE/', 'README.md', [file], [work], true).work, undefined);
  assert.equal(resolveLink('../../private.md', 'README.md', [file], [work], false).file, undefined);
});

test('Unicode aliases navigate with connected semantics without merging distinct filenames', () => {
  const retained = { path: 'active/cafe\u0301/plan.md' } as Document;
  const composed = 'active/caf\u00e9/plan.md';
  assert.equal(resolveLink(composed, 'README.md', [retained], [], false, true).file, retained);
  assert.equal(resolveLink(composed, 'README.md', [retained], [], false, false).file, undefined);
});
