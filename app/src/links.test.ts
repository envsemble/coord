import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink, siblingProject, siblingReference } from './links.ts';
import type { Document, Work } from './types.ts';
import { documentTarget, ledgerTarget, scrollKey, tabId, workTarget } from './targets.ts';

const file = { path: 'active/0001-example/docs/decision.md' } as Document;
const work = { path: 'active/0001-example', id: 'work-0001' } as Work;

test('links to a plan open the work item, to its ledger the work item showing the ledger, and to other documents files with their heading', () => {
  const owner = { id: 'work-0001', path: 'active/0001-example', currentPlan: 'active/0001-example/plan.md', ledger: 'active/0001-example/ledger.md' } as Work;
  const plan = { path: 'active/0001-example/plan.md', workId: 'work-0001', category: 'plan' } as Document;
  const ledger = { path: 'active/0001-example/ledger.md', workId: 'work-0001', category: 'ledger' } as Document;
  const nested = { path: 'active/0001-example/docs/decision #1.md', workId: 'work-0001', category: 'decision' } as Document;
  const knowledge = { path: 'knowledge/terms.md', workId: null, category: 'knowledge' } as Document;
  assert.deepEqual(documentTarget(plan, owner, 'whats-new'), { kind: 'work', work: 'work-0001', anchor: 'whats-new' });
  assert.deepEqual(documentTarget(ledger, owner, 'provenance'), { kind: 'work', work: 'work-0001', anchor: 'provenance', view: 'ledger' });
  assert.deepEqual(documentTarget(ledger, owner), ledgerTarget('work-0001'));
  assert.deepEqual(documentTarget(ledger, undefined), { kind: 'file', path: ledger.path, anchor: null }, 'the file panel, which names no work item, opens it as a file');
  assert.deepEqual(documentTarget(nested, owner, 'déjà-vu--choices'), { kind: 'file', path: nested.path, anchor: 'déjà-vu--choices' });
  assert.deepEqual(documentTarget(knowledge, undefined, 'api_contract'), { kind: 'file', path: 'knowledge/terms.md', anchor: 'api_contract' });
  const project = 'f-' + 'a'.repeat(32);
  assert.equal(tabId(project, documentTarget(plan, owner, 'a')), tabId(project, documentTarget(plan, owner)), 'a plan has one tab, wherever it was opened');
  assert.equal(tabId(project, documentTarget(ledger, owner)), tabId(project, documentTarget(plan, owner)), "the ledger shows in the plan's tab");
  assert.notEqual(tabId(project, documentTarget(nested, owner)), tabId(project, documentTarget(plan, owner)));
  assert.notEqual(tabId(project, documentTarget(plan, owner)), tabId('f-' + 'b'.repeat(32), documentTarget(plan, owner)), 'another project, another tab');
});

test('the plan and the ledger of a work item keep their own scroll positions', () => {
  const project = 'f-' + 'a'.repeat(32);
  assert.equal(scrollKey({ project, target: ledgerTarget('work-0001') }), project + ':work:work-0001:ledger');
  assert.equal(scrollKey({ project, target: workTarget('work-0001') }), project + ':work:work-0001');
  assert.equal(scrollKey({ project, target: ledgerTarget('work-0001', 'provenance') }), scrollKey({ project, target: ledgerTarget('work-0001') }), 'a heading is a place in the same document');
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
  const projects = [{ folderId: 'f-1', path: 'C:\\Users\\me\\.atlas\\planning\\coord' }, { folderId: 'f-2', path: 'C:\\Users\\me\\.atlas\\planning\\Atlas' }, { folderId: 'f-3', path: 'D:\\old\\atlas' }];
  assert.equal(siblingProject(projects, 'f-1', 'atlas'), 'f-2', 'Windows paths compare without case');
  assert.equal(siblingProject(projects, 'f-1', 'envui'), null);
  assert.equal(siblingProject([{ folderId: 'a', path: '/home/me/.atlas/planning/coord' }, { folderId: 'b', path: '/home/me/.atlas/planning/Atlas' }], 'a', 'atlas'), null, 'POSIX paths keep their case');
});
