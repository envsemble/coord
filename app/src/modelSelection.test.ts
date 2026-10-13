import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModelHandle } from './modelSelection.ts';

test('catalog refresh retains an existing implicit model, replaces a removed one, and preserves explicit deep links', () => {
  const models = [{ handle: 'first' }, { handle: 'second' }];
  let selected = selectModelHandle(models, '');
  assert.equal(selected, 'first');
  selected = selectModelHandle([...models].reverse(), selected);
  assert.equal(selected, 'first');
  selected = selectModelHandle([models[1]], selected);
  assert.equal(selected, 'second');
  assert.equal(selectModelHandle([models[1]], 'first', 'first'), 'first');
  assert.equal(selectModelHandle([], selected, 'deep-link'), 'deep-link');
  selected = selectModelHandle([], selected);
  assert.equal(selected, '');
  assert.equal(selectModelHandle(models, selected), 'first');
  assert.equal(selectModelHandle([models[1]], 'first', '', ['first']), 'first');
  assert.equal(selectModelHandle([], 'first', '', ['first']), 'first');
});
