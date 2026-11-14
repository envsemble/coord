import test from 'node:test';
import assert from 'node:assert/strict';
import { continuation, handoffs } from './handoffs.ts';
import type { HandoffLink } from '@envsemble/coord/planning/types';

const own = 'f-' + '1'.repeat(32), other = 'f-' + '2'.repeat(32);
const link = (change: Partial<HandoffLink>): HandoffLink => ({ projectId: own, project: 'coord', projectName: 'Coord', workId: 'work-0023', title: 'Plans hub', state: 'closed', outcome: 'complete', ...change });

test('a plan\'s handoffs: by number and title, another project\'s by its name too, opening the plan unless it cannot be found', () => {
  const { continues, continuedIn } = handoffs({ continues: [link({})], continuedIn: [link({ projectId: other, project: 'shop', projectName: 'Shop', workId: 'work-0002', title: 'Checkout' }), link({ projectId: null, project: 'gone', projectName: '', workId: 'work-0009', title: null })] }, own);
  assert.deepEqual(continues.map(item => [item.number, item.title, item.project, item.open]), [['#0023', 'Plans hub', null, { projectId: own, work: 'work-0023' }]]);
  assert.deepEqual(continuedIn.map(item => [item.title, item.project, item.open]), [['Checkout', 'Shop', { projectId: other, work: 'work-0002' }], [null, 'gone', null]]);
  assert.deepEqual(handoffs({}, own), { continues: [], continuedIn: [] });
  assert.equal(continuation(true, { continuedIn: [link({})] }, own).length, 1, 'closed work says where it continues');
  assert.deepEqual(continuation(false, { continuedIn: [link({})] }, own), [], 'work under way does not');
});
