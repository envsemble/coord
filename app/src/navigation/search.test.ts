import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEntries, listEntries, ownPerKind, pathKey, resultDestination, workKey, type SearchEntry } from './search.ts';
import type { Project, SearchResult } from '../types.ts';

const folder = 'f-' + '1'.repeat(32);
const result = (change: Partial<SearchResult>): SearchResult => ({ kind: 'plan', title: 'Plans hub', snippet: null, projectId: folder, projectName: 'Atlas', work: null, path: null, anchor: null, element: null, ...change });
const atlas: Project = {
  id: folder, name: 'Atlas', path: '/home/me/.atlas/planning/atlas', position: 1, state: 'active', folders: [],
  summary: { active: [{ id: 'work-0023', title: 'Plans hub', state: 'implementing', blocked: null, summary: null, tags: [], steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null }], closed: [], updated: null, activity: [], now: '2026-10-15T10:00:00Z' },
};

test('each kind of result opens where it is: a plan, a plan at a step, a document at its heading, a diagram at its element, a project in the hub', () => {
  assert.deepEqual(resultDestination(result({ work: 'work-0023' })), { place: { projectId: folder, target: { kind: 'work', work: 'work-0023', anchor: null } } });
  // A step opens its plan with the step pointed out in its progress.
  assert.deepEqual(resultDestination(result({ kind: 'step', title: 'Build the hub', work: 'work-0023', path: 'active/0023-plans-hub/plan.md' })), { place: { projectId: folder, target: { kind: 'work', work: 'work-0023', anchor: null, step: 'Build the hub' } } });
  assert.deepEqual(resultDestination(result({ kind: 'heading', work: 'work-0023', path: 'active/0023-plans-hub/plan.md', anchor: 'why' })), { projectId: folder, path: 'active/0023-plans-hub/plan.md', anchor: 'why' });
  assert.deepEqual(resultDestination(result({ kind: 'document', path: 'notes/shop.md' })), { projectId: folder, path: 'notes/shop.md', anchor: null });
  assert.deepEqual(resultDestination(result({ kind: 'term', path: 'CONTEXT.md', anchor: 'plan' })), { projectId: folder, path: 'CONTEXT.md', anchor: 'plan' });
  assert.deepEqual(resultDestination(result({ kind: 'element', work: 'work-0023', path: 'active/0023-plans-hub/diagrams/hub.puml', element: 'Hub' })), { projectId: folder, path: 'active/0023-plans-hub/diagrams/hub.puml', anchor: 'Hub' });
  assert.deepEqual(resultDestination(result({ kind: 'diagram', work: 'work-0023', element: 'Hub' })), { place: { projectId: folder, target: { kind: 'diagram', work: 'work-0023', path: null, element: 'Hub' } } });
  assert.deepEqual(resultDestination(result({ kind: 'project' })), { place: { page: 'hub', projectId: folder } });
  // Without a work item or a file, its project's plans.
  assert.deepEqual(resultDestination(result({ kind: 'document' })), { place: { page: 'hub', projectId: folder } });
});

test("the host's results say their project and work item, and the snippet", () => {
  const [plan, heading, project] = hostEntries([
    result({ work: 'work-0023' }),
    result({ kind: 'heading', title: 'Why', snippet: '… the hub …', work: 'work-0023', path: 'active/0023-plans-hub/plan.md', anchor: 'why' }),
    result({ kind: 'project', title: 'Atlas' }),
  ], [atlas]);
  assert.deepEqual([plan.label, plan.detail, plan.key], ['Plans hub', 'Atlas · #0023', workKey(folder, 'work-0023')]);
  assert.deepEqual([heading.kind, heading.detail, heading.snippet, heading.key], ['heading', 'Atlas · #0023 Plans hub', '… the hub …', null]);
  assert.deepEqual([project.detail, project.key], ['', null]);
  assert.equal(new Set([plan.id, heading.id, project.id]).size, 3);
});

test("an archived project's results are left out", () => {
  const other = 'f-' + '2'.repeat(32);
  const shelved: Project = { ...atlas, id: other, name: 'Old', state: 'archived' };
  const listed = hostEntries([result({ work: 'work-0023' }), result({ projectId: other, projectName: 'Old', work: 'work-0001' })], [atlas, shelved]);
  assert.deepEqual(listed.map(item => item.detail), ['Atlas · #0023']);
});

const entry = (id: string, kind: SearchEntry['kind'], key: string | null = null): SearchEntry => ({ id, kind, label: id, detail: '', snippet: null, destination: { place: { page: 'hub', projectId: null } }, key });
const local = [entry('plan', 'plan', workKey(folder, 'work-0023')), entry('diagram', 'diagram'), entry('other plan', 'plan', workKey(folder, 'work-0024')), entry('doc', 'document', pathKey(folder, 'a.md'))];
const host = [entry('heading', 'heading'), entry('plan again', 'plan', workKey(folder, 'work-0023')), entry('doc again', 'document', pathKey(folder, 'a.md')), entry('summary plan', 'plan', workKey(folder, 'work-0025')), entry('heading 2', 'heading')];

test("until the host answers, or when it finds nothing, the window's own entries, grouped by kind", () => {
  assert.deepEqual(listEntries(local, []).map(item => [item.id, item.group]), [['plan', 'Plans'], ['other plan', 'Plans'], ['diagram', 'Diagrams'], ['doc', 'Documents']]);
});

test("once the host answers, its results come first, then at most a few of the window's own entries of a kind that it did not return", () => {
  assert.deepEqual(listEntries(local, host).map(item => [item.id, item.group]), [
    ['heading', 'Headings'], ['heading 2', 'Headings'], ['plan again', 'Plans'], ['summary plan', 'Plans'], ['doc again', 'Documents'],
    ['diagram', 'Diagrams'], ['other plan', 'More plans'],
  ]);
  // Dozens of loose matches of the window's own do not bury the host's results.
  const loose = Array.from({ length: 40 }, (_, index) => entry('loose ' + index, 'plan', workKey(folder, 'work-' + String(100 + index).padStart(4, '0'))));
  const listed = listEntries(loose, host);
  assert.deepEqual(listed.slice(0, host.length).map(item => item.id), ['heading', 'heading 2', 'plan again', 'summary plan', 'doc again']);
  assert.equal(listed.filter(item => item.group === 'More plans').length, ownPerKind);
});

test("when the user has moved the highlight, the host's results go below those shown, so the highlighted one stays where it is", () => {
  const listed = listEntries(local, host, true);
  const before = listEntries(local, []).map(item => item.id);
  assert.deepEqual(listed.slice(0, before.length).map(item => item.id), before);
  assert.deepEqual(listed.slice(before.length).map(item => [item.id, item.group]), [['heading', 'Headings'], ['heading 2', 'Headings'], ['summary plan', 'More plans']]);
});
