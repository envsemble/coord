import test from 'node:test';
import assert from 'node:assert/strict';
import { hubGroups, hubItems, hubMatches, hubStatus, inState } from './hubPlans.ts';
import type { Project, ProjectSummary, ProjectWork } from './types.ts';

const work = (id: string, state: ProjectWork['state'], change: Partial<ProjectWork> = {}): ProjectWork =>
  ({ id, title: 'Work ' + id, state, blocked: null, summary: null, steps: null, updated: null, outcome: null, ...change });
const project = (name: string, position: number, summary: Partial<ProjectSummary> | null, state: Project['state'] = 'active'): Project => ({
  folderId: 'f-' + String(position).repeat(32), name, path: '/home/me/.atlas/planning/' + name.toLowerCase(), position, state, outsideHome: false, workspaces: [],
  summary: summary && { repositories: [], active: [], closed: [], updated: null, live: [], ...summary },
});

const atlas = project('Atlas', 1, {
  active: [
    work('work-0021', 'implementing', { updated: '2026-10-10', steps: { done: 2, total: 5, planning: { done: 2, total: 2 } } }),
    work('work-0022', 'draft', { summary: 'A hub for every plan, so a plan is one click away.' }),
    work('work-0023', 'blocked', { updated: '2026-10-01', blocked: 'Waiting for the host' }),
    work('work-0024', 'implementing', { updated: '2026-10-14' }),
    work('work-0025', 'other'),
  ],
  closed: [work('work-0019', 'closed', { outcome: 'complete', updated: '2026-09-30' }), work('work-0018', 'closed', { outcome: 'superseded' })],
  live: [{ workId: 'work-0024', since: '2026-10-15T10:00:00Z' }],
});
const coord = project('Coord', 2, { active: [work('work-0001', 'implementing', { updated: '2026-10-15' })] });
const hidden = project('envUI', 3, { active: [work('work-0007', 'draft')] }, 'hidden');
const unread = project('Broken', 4, null);
const projects = [atlas, coord, hidden, unread];

test('the hub lists the plans of every active project, or of the project it is filtered to', () => {
  const all = hubItems(projects, null);
  assert.deepEqual(all.map(item => item.project.name + ' ' + item.work.id), [
    ...['work-0021', 'work-0022', 'work-0023', 'work-0024', 'work-0025', 'work-0019', 'work-0018'].map(id => 'Atlas ' + id), 'Coord work-0001',
  ], 'hidden projects and projects whose folder could not be read list none');
  assert.deepEqual(all.filter(item => item.live).map(item => item.work.id), ['work-0024']);
  assert.deepEqual(hubItems(projects, coord.folderId).map(item => item.work.id), ['work-0001']);
  assert.deepEqual(hubItems(projects, hidden.folderId).map(item => item.work.id), ['work-0007'], 'filtered to a hidden project, it lists that project\'s plans');
  assert.deepEqual(hubItems([], null), []);
});

test('open plans are grouped: blocked and being implemented first, then drafts, then other open work; closed work on request', () => {
  const items = hubItems(projects, null);
  const groups = (state: Parameters<typeof hubGroups>[1], query = '') => hubGroups(items, state, query).map(group => [group.label, group.items.map(item => item.work.id)]);
  assert.deepEqual(groups('open'), [
    // Blocked before being implemented, then the latest change first.
    ['In progress', ['work-0023', 'work-0001', 'work-0024', 'work-0021']],
    ['Drafts', ['work-0022']],
    ['Other open work', ['work-0025']],
  ]);
  assert.deepEqual(groups('closed'), [['Closed', ['work-0019', 'work-0018']]]);
  assert.deepEqual(groups('all').map(([label]) => label), ['In progress', 'Drafts', 'Other open work', 'Closed']);
  assert.equal(inState(items[0], 'all'), true);
  assert.deepEqual(hubGroups([], 'open', ''), []);
});

test('the search matches every word in a plan\'s title, number, summary or project, ignoring case', () => {
  const draft = hubItems(projects, null).find(item => item.work.id === 'work-0022')!;
  for (const query of ['', 'work 0022', '#0022', '0022', 'ATLAS', 'one click', 'hub atlas', 'work-0022']) assert.equal(hubMatches(draft, query), true, query);
  for (const query of ['coord', 'hub coord', '0023']) assert.equal(hubMatches(draft, query), false, query);
  const items = hubItems(projects, null);
  assert.deepEqual(hubGroups(items, 'all', 'coord').flatMap(group => group.items.map(item => item.work.id)), ['work-0001']);
});

test('each plan shows its state, and closed work how it ended', () => {
  assert.deepEqual(['blocked', 'implementing', 'draft', 'other'].map(state => hubStatus(work('work-0001', state as ProjectWork['state'])).key), ['blocked', 'in_progress', 'draft', 'not_started']);
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'complete' })).label, 'Complete');
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'superseded' })).label, 'Superseded');
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'abandoned' })).label, 'Abandoned');
  assert.equal(hubStatus(work('work-0001', 'closed')).key, 'complete');
});
