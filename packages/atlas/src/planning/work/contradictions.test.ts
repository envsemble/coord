import test from 'node:test';
import assert from 'node:assert/strict';
import { contradictions } from './contradictions.ts';
import type { ActiveWork } from '../projects/findProject.ts';

const now = Date.parse('2026-11-14T12:00:00Z');
const item = (fields: Partial<ActiveWork>): ActiveWork => ({
  workId: 'work-0001', title: 'Cart', path: 'active/0001-cart', plan: 'active/0001-cart/plan.md', summary: null,
  designStatus: 'accepted', implementationStatus: 'in_progress', steps: [{ title: 'Build', status: 'doing' }], progress: null, blocked: null,
  state: { kind: 'working', note: null, since: '2026-11-14T10:00:00Z' }, updated: '2026-11-14', ...fields,
});

test('the session start names what no longer adds up in the work, and nothing else', () => {
  assert.deepEqual(contradictions([item({})], now), [], 'work under way, as it says');
  const found = contradictions([
    item({ workId: 'work-0002', steps: [{ title: 'Build', status: 'done' }], state: { kind: 'your_turn', note: 'Merge owner/repo#12', since: '2026-11-13T10:00:00Z' } }),
    item({ workId: 'work-0003', state: null }),
    item({ workId: 'work-0004', state: { kind: 'your_turn', note: 'Try the hub', since: '2026-11-01T10:00:00Z' } }),
    item({ workId: 'work-0005', updated: '2026-11-10', state: { kind: 'working', note: null, since: '2026-11-10T10:00:00Z' } }),
    item({ workId: 'work-0006', designStatus: 'draft', implementationStatus: 'not_started', state: { kind: 'planning', note: null, since: '2026-11-14T10:00:00Z' } }),
  ], now);
  assert.deepEqual(found.map(line => line.slice(0, 9)), ['work-0002', 'work-0003', 'work-0004', 'work-0005', 'work-0006']);
  assert.match(found[0], /every step done but is still open.*waits on the user: Merge owner\/repo#12/);
  assert.match(found[2], /waited on the user since 2026-11-01: Try the hub/);
});
