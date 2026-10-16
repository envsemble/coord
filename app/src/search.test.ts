import test from 'node:test';
import assert from 'node:assert/strict';
import { hostEntries, mergeEntries, pathKey, resultDestination, workKey, type SearchEntry } from './search.ts';
import type { Project, SearchResult } from './types.ts';

const folder = 'f-' + '1'.repeat(32);
const result = (change: Partial<SearchResult>): SearchResult => ({ kind: 'plan', title: 'Plans hub', snippet: null, folderId: folder, project: 'Atlas', work: null, path: null, anchor: null, element: null, ...change });
const atlas: Project = {
  folderId: folder, name: 'Atlas', path: '/home/me/.atlas/planning/atlas', position: 1, state: 'active', outsideHome: false, workspaces: [],
  summary: { repositories: [], active: [{ id: 'work-0023', title: 'Plans hub', state: 'implementing', blocked: null, summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null }], closed: [], updated: null, live: [] },
};

test('each kind of result opens where it is: a plan, a plan at a step, a document at its heading, a diagram at its element, a project in the hub', () => {
  assert.deepEqual(resultDestination(result({ work: 'work-0023' })), { place: { project: folder, target: { kind: 'work', work: 'work-0023', anchor: null } } });
  assert.deepEqual(resultDestination(result({ kind: 'step', work: 'work-0023', path: 'active/0023-plans-hub/plan.md' })), { place: { project: folder, target: { kind: 'work', work: 'work-0023', anchor: null } } });
  assert.deepEqual(resultDestination(result({ kind: 'heading', work: 'work-0023', path: 'active/0023-plans-hub/plan.md', anchor: 'why' })), { project: folder, path: 'active/0023-plans-hub/plan.md', anchor: 'why' });
  assert.deepEqual(resultDestination(result({ kind: 'document', path: 'knowledge/shop.md' })), { project: folder, path: 'knowledge/shop.md', anchor: null });
  assert.deepEqual(resultDestination(result({ kind: 'term', path: 'CONTEXT.md', anchor: 'plan' })), { project: folder, path: 'CONTEXT.md', anchor: 'plan' });
  assert.deepEqual(resultDestination(result({ kind: 'element', work: 'work-0023', path: 'active/0023-plans-hub/diagrams/hub.puml', element: 'Hub' })), { project: folder, path: 'active/0023-plans-hub/diagrams/hub.puml', anchor: 'Hub' });
  assert.deepEqual(resultDestination(result({ kind: 'diagram', work: 'work-0023', element: 'Hub' })), { place: { project: folder, target: { kind: 'diagram', work: 'work-0023', path: null, element: 'Hub' } } });
  assert.deepEqual(resultDestination(result({ kind: 'project' })), { place: { page: 'hub', project: folder } });
  // Without a work item or a file, its project's plans.
  assert.deepEqual(resultDestination(result({ kind: 'document' })), { place: { page: 'hub', project: folder } });
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

test("the window's own entries follow the host's, without repeating them, grouped by kind where each kind first came", () => {
  const entry = (id: string, kind: SearchEntry['kind'], key: string | null = null): SearchEntry => ({ id, kind, label: id, detail: '', snippet: null, destination: { place: { page: 'hub', project: null } }, key });
  const host = [entry('heading', 'heading'), entry('plan', 'plan', workKey(folder, 'work-0023')), entry('doc', 'document', pathKey(folder, 'a.md'))];
  const local = [entry('diagram', 'diagram'), entry('plan again', 'plan', workKey(folder, 'work-0023')), entry('other plan', 'plan', workKey(folder, 'work-0024')), entry('doc again', 'document', pathKey(folder, 'a.md'))];
  assert.deepEqual(mergeEntries(host, local).map(item => item.id), ['heading', 'plan', 'other plan', 'doc', 'diagram']);
  // While the host finds nothing, the window's own entries, grouped.
  assert.deepEqual(mergeEntries([], [entry('p1', 'plan'), entry('d1', 'diagram'), entry('p2', 'plan')]).map(item => item.id), ['p1', 'p2', 'd1']);
});
