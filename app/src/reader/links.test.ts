import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink, siblingProject, siblingReference } from './links.ts';
import type { Document, Work } from '../types.ts';
import { documentTarget, hubPlace, pageAt, placeId, scrollKey, statisticsPlace, workTarget } from '../navigation/targets.ts';

const file = { path: 'active/0001-example/docs/decision.md' } as Document;
const work = { path: 'active/0001-example', id: 'work-0001' } as Work;

test('links to a plan open the work item, and to other documents, its ledger too, files with their heading', () => {
  const owner = { id: 'work-0001', path: 'active/0001-example', currentPlan: 'active/0001-example/plan.md', ledger: 'active/0001-example/ledger.md' } as Work;
  const plan = { path: 'active/0001-example/plan.md', workId: 'work-0001', category: 'plan' } as Document;
  const ledger = { path: 'active/0001-example/ledger.md', workId: 'work-0001', category: 'ledger' } as Document;
  const nested = { path: 'active/0001-example/docs/decision #1.md', workId: 'work-0001', category: 'document' } as Document;
  const notes = { path: 'notes/terms.md', workId: null, category: 'document' } as Document;
  assert.deepEqual(documentTarget(plan, owner, 'whats-new'), { kind: 'work', work: 'work-0001', anchor: 'whats-new' });
  assert.deepEqual(documentTarget(ledger, owner), { kind: 'file', path: ledger.path, anchor: null }, 'the ledger is a file like any other');
  assert.deepEqual(documentTarget(nested, owner, 'déjà-vu--choices'), { kind: 'file', path: nested.path, anchor: 'déjà-vu--choices' });
  assert.deepEqual(documentTarget(notes, undefined, 'api_contract'), { kind: 'file', path: 'notes/terms.md', anchor: 'api_contract' });
  const project = 'f-' + 'a'.repeat(32);
  const id = (target: ReturnType<typeof documentTarget>, of = project) => placeId({ projectId: of, target });
  assert.equal(id(documentTarget(plan, owner, 'a')), id(documentTarget(plan, owner)), 'a plan is one thing, wherever it was opened');
  assert.notEqual(id(documentTarget(nested, owner)), id(documentTarget(plan, owner)));
  assert.notEqual(id(documentTarget(plan, owner)), id(documentTarget(plan, owner), 'f-' + 'b'.repeat(32)), 'another project, another thing');
});

test('a link to a folder of a work item\'s pages/ is a page; a file in pages/ stays a file', () => {
  const owner = { id: 'work-0001', path: 'active/0001-example' } as Work;
  const documents = [{ path: 'active/0001-example/pages/layout/page.tsx' }, { path: 'active/0001-example/pages/notes.md' }] as Document[];
  assert.equal(resolveLink('pages/layout', 'active/0001-example/plan.md', documents, [owner]).page, 'active/0001-example/pages/layout');
  assert.equal(resolveLink('pages/layout/', 'active/0001-example/plan.md', documents, [owner]).page, 'active/0001-example/pages/layout');
  assert.equal(resolveLink('pages/notes.md', 'active/0001-example/plan.md', documents, [owner]).page, undefined);
  assert.deepEqual(pageAt('active/0001-example/pages/layout', { work: [owner], documents })?.name, 'layout');
  assert.equal(pageAt('active/0001-example/pages/notes.md', { work: [owner], documents }), null);
  assert.equal(pageAt('references/app/pages/home', { work: [owner], documents }), null);
});

test('a work item and the hub keep their own scroll positions', () => {
  const project = 'f-' + 'a'.repeat(32);
  assert.equal(scrollKey({ projectId: project, target: workTarget('work-0001') }), project + ':work:work-0001');
  assert.equal(scrollKey({ projectId: project, target: workTarget('work-0001', 'why') }), scrollKey({ projectId: project, target: workTarget('work-0001') }), 'a heading is a place in the same document');
  // The hub is one page whatever it is filtered to, which keeps its own position.
  assert.equal(placeId(hubPlace(project)), placeId(hubPlace()));
  assert.notEqual(scrollKey(hubPlace(project)), scrollKey(hubPlace()));
  assert.notEqual(scrollKey(statisticsPlace(project)), scrollKey(hubPlace(project)));
});

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
test('malformed references never crash the reader', () => {
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

test('a link into a sibling project in the home names that folder and the path in it', () => {
  const plan = 'active/0020-agent-interface/plan.md';
  assert.deepEqual(siblingReference('../../../atlas/active/0013-x/plan.md#why', plan), { folder: 'atlas', path: 'active/0013-x/plan.md', anchor: 'why' });
  assert.deepEqual(siblingReference('../../../envui/README.md', plan), { folder: 'envui', path: 'README.md', anchor: null });
  // Inside the project itself, above the home's planning folder, absolute or external: none.
  for (const href of ['../0019-x/plan.md', '../../../../elsewhere/plan.md', '/etc/passwd', 'https://example.com/a', '../../../atlas', '../../../.git/config']) assert.equal(siblingReference(href, plan), null, href);
  const projects = [{ id: 'f-1', path: 'C:\\Users\\me\\.atlas\\planning\\harbor' }, { id: 'f-2', path: 'C:\\Users\\me\\.atlas\\planning\\Atlas' }, { id: 'f-3', path: 'D:\\old\\atlas' }];
  assert.equal(siblingProject(projects, 'f-1', 'atlas'), 'f-2', 'Windows paths compare without case');
  assert.equal(siblingProject(projects, 'f-1', 'envui'), null);
  assert.equal(siblingProject([{ id: 'a', path: '/home/me/.atlas/planning/harbor' }, { id: 'b', path: '/home/me/.atlas/planning/Atlas' }], 'a', 'atlas'), null, 'POSIX paths keep their case');
});
