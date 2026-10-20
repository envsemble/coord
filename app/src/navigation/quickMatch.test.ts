import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore, rankItems } from './quickMatch.ts';

test('quick open matches characters in order and ranks names first', () => {
  assert.ok(fuzzyScore('fulfil', 'Order fulfilment model') > 0);
  assert.equal(fuzzyScore('xyz', 'Order fulfilment model'), -1);
  assert.ok(fuzzyScore('plan', 'plan.md') > fuzzyScore('plan', 'a/p/l/a/n.md'));
  const items = [
    { id: '1', kind: 'file' as const, label: 'notes.md', detail: 'active/0002-fulfilment/notes.md' },
    { id: '2', kind: 'work' as const, label: 'Order fulfilment model', detail: '#0002' },
  ];
  assert.equal(rankItems(items, 'fulfil')[0].id, '2');
  assert.deepEqual(rankItems(items, 'zzz'), []);
});
