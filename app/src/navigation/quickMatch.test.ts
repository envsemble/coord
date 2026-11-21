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

test('words typed as they are outrank letters scattered in order, which drop out; a closed plan goes below an open one', () => {
  const items = [
    { id: 'scattered', kind: 'work' as const, label: 'References that open, sessions and links', detail: '#0025' },
    { id: 'closed', kind: 'work' as const, label: 'Release 0.8.0', detail: '#0028', penalty: 6 },
    { id: 'open', kind: 'work' as const, label: 'Releases with nightly and stable channels', detail: '#0042' },
  ];
  assert.deepEqual(rankItems(items, 'release').map(item => item.id), ['open', 'closed']);
  // With no item having the words, the letters in order still find something.
  assert.deepEqual(rankItems(items, 'rfs').map(item => item.id), ['scattered']);
});
