import test from 'node:test';
import assert from 'node:assert/strict';
import { hubGroups, hubItems, hubRowFacts, hubStatus, inState, lastChange } from './hubPlans.ts';
import { compactNumber, duration } from './format.ts';
import type { Project, ProjectSummary, ProjectWork } from './types.ts';

const work = (id: string, state: ProjectWork['state'], change: Partial<ProjectWork> = {}): ProjectWork =>
  ({ id, title: 'Work ' + id, state, blocked: null, summary: null, steps: null, updated: null, outcome: null, step: null, completed: null, statistics: null, ...change });
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
  const groups = (state: Parameters<typeof hubGroups>[1]) => hubGroups(items, state).map(group => [group.label, group.items.map(item => item.work.id)]);
  assert.deepEqual(groups('open'), [
    // Blocked before being implemented, then the latest change first.
    ['In progress', ['work-0023', 'work-0001', 'work-0024', 'work-0021']],
    ['Drafts', ['work-0022']],
    ['Other open work', ['work-0025']],
  ]);
  assert.deepEqual(groups('closed'), [['Closed', ['work-0019', 'work-0018']]]);
  assert.deepEqual(groups('all').map(([label]) => label), ['In progress', 'Drafts', 'Other open work', 'Closed']);
  assert.equal(inState(items[0], 'all'), true);
  assert.deepEqual(hubGroups([], 'open'), []);
});

test('each plan shows its state, and closed work how it ended', () => {
  assert.deepEqual(['blocked', 'implementing', 'draft', 'other'].map(state => hubStatus(work('work-0001', state as ProjectWork['state'])).key), ['blocked', 'in_progress', 'draft', 'not_started']);
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'complete' })).label, 'Complete');
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'superseded' })).label, 'Superseded');
  assert.equal(hubStatus(work('work-0001', 'closed', { outcome: 'abandoned' })).label, 'Abandoned');
  assert.equal(hubStatus(work('work-0001', 'closed')).key, 'complete');
});

const statistics = (change: Partial<NonNullable<ProjectWork['statistics']>> = {}): NonNullable<ProjectWork['statistics']> => ({
  agentMs: 12_000_000, tokens: 1_234_567, primaryModel: 'claude-opus-5-5', otherModels: 2,
  planning: { agentMs: 3_600_000, tokens: 200_000 }, implementation: { agentMs: 8_400_000, tokens: 1_034_567 },
  subagents: 4, lastReport: '2026-10-15T09:30:00Z', ...change,
});
const steps = { done: 3, total: 8, planning: { done: 3, total: 3 } };

test('work in progress shows its progress, the step being worked on, and what agents spent on it', () => {
  const facts = hubRowFacts(work('work-0023', 'implementing', { steps, updated: '2026-10-14', step: { title: 'Build the hub', status: 'doing', phase: 'implementation' }, statistics: statistics() }));
  assert.equal(facts.size, 'large');
  assert.deepEqual(facts.progress, { done: 3, total: 8, planning: 3, text: '3 of 8' });
  assert.deepEqual(facts.step, { label: 'Now', title: 'Build the hub', phase: 'implementation' });
  assert.equal(facts.blocked, null);
  assert.deepEqual(facts.model, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', provider: 'anthropic', others: 2 });
  assert.deepEqual(facts.time, { total: duration(12_000_000), planning: duration(3_600_000), implementation: duration(8_400_000) });
  assert.equal(facts.time!.total, '3 h 20 min');
  assert.equal(facts.tokens, compactNumber(1_234_567) + ' tokens');
  assert.equal(facts.subagents, '4 subagents');
  assert.equal(facts.ended, null);
  // The last report is later than the plan's date, so it says when it changed.
  assert.equal(facts.changed, '2026-10-15T09:30:00Z');
  // The step to do next, in its phase; one subagent; no stage recorded.
  const next = hubRowFacts(work('work-0023', 'implementing', { steps, step: { title: 'Settle the design', status: 'todo', phase: 'planning' }, statistics: statistics({ subagents: 1, planning: { agentMs: 0, tokens: null }, implementation: { agentMs: 0, tokens: null } }) }));
  assert.deepEqual(next.step, { label: 'Next', title: 'Settle the design', phase: 'planning' });
  assert.equal(next.subagents, '1 subagent');
  assert.deepEqual(next.time, { total: '3 h 20 min', planning: null, implementation: null });
});

test('blocked work shows why in place of its step', () => {
  const facts = hubRowFacts(work('work-0023', 'blocked', { steps, blocked: 'Waiting for the host', step: { title: 'Build the hub', status: 'doing', phase: 'implementation' } }));
  assert.equal(facts.size, 'large');
  assert.equal(facts.blocked, 'Waiting for the host');
  assert.equal(facts.step, null);
  assert.equal(hubRowFacts(work('work-0023', 'blocked', { blocked: '  ' })).blocked, 'No reason given');
});

test('work without steps or statistics (as the host gives it before it has them) shows what it has', () => {
  const facts = hubRowFacts(work('work-0023', 'implementing', { updated: '2026-10-14' }));
  assert.deepEqual([facts.progress, facts.step, facts.model, facts.time, facts.tokens, facts.subagents, facts.changed], [null, null, null, null, null, null, '2026-10-14']);
  // An empty ledger draws no progress.
  assert.equal(hubRowFacts(work('work-0023', 'implementing', { steps: { done: 0, total: 0, planning: { done: 0, total: 0 } } })).progress, null);
});

test('drafts and other open work show their planning progress, and model, time and tokens when recorded', () => {
  const draft = hubRowFacts(work('work-0024', 'draft', { steps: { done: 1, total: 4, planning: { done: 1, total: 4 } }, step: { title: 'Settle the design', status: 'doing', phase: 'planning' }, statistics: statistics({ otherModels: 0, tokens: null }) }));
  assert.equal(draft.size, 'standard');
  assert.deepEqual(draft.progress, { done: 1, total: 4, planning: 1, text: '1 of 4 planning' });
  // A smaller row: no step, no split of the time, no subagents.
  assert.deepEqual([draft.step, draft.subagents, draft.tokens], [null, null, null]);
  assert.deepEqual(draft.time, { total: '3 h 20 min', planning: null, implementation: null });
  assert.equal(draft.model!.others, 0);
  // Without planning steps, all its steps.
  assert.equal(hubRowFacts(work('work-0025', 'other', { steps: { done: 0, total: 2, planning: { done: 0, total: 0 } } })).progress!.text, '0 of 2');
});

test('closed work shows how it ended, when, and its totals', () => {
  const facts = hubRowFacts(work('work-0019', 'closed', { outcome: 'superseded', completed: '2026-09-30', updated: '2026-09-30', steps, statistics: statistics({ lastReport: null }) }));
  assert.equal(facts.size, 'closed');
  assert.deepEqual(facts.ended, { label: 'Superseded', date: '2026-09-30' });
  assert.deepEqual([facts.time!.total, facts.tokens], ['3 h 20 min', compactNumber(1_234_567) + ' tokens']);
  assert.deepEqual([facts.progress, facts.model, facts.subagents], [null, null, null]);
  assert.deepEqual(hubRowFacts(work('work-0018', 'closed', { outcome: 'complete' })).ended, { label: 'Complete', date: null });
});

test('a plan last changed on its date, or at its last report when that is the same day or later', () => {
  assert.equal(lastChange(work('work-0001', 'draft', { updated: '2026-10-14' })), '2026-10-14');
  assert.equal(lastChange(work('work-0001', 'draft', { updated: '2026-10-14', statistics: statistics({ lastReport: '2026-10-14T08:00:00Z' }) })), '2026-10-14T08:00:00Z');
  assert.equal(lastChange(work('work-0001', 'draft', { updated: '2026-10-14', statistics: statistics({ lastReport: '2026-10-01T08:00:00Z' }) })), '2026-10-14');
  assert.equal(lastChange(work('work-0001', 'draft', { statistics: statistics({ lastReport: '2026-10-01T08:00:00Z' }) })), '2026-10-01T08:00:00Z');
  assert.equal(lastChange(work('work-0001', 'draft')), null);
});
