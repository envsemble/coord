import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSummary, selectModelHandle } from './modelSelection.ts';

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

test('the picker describes each model in one short line', () => {
  const summary = (kind: string, detail: string, profile = 'code', imported = false) =>
    modelSummary({ profile, state: kind === 'generated' ? 'snapshot' : kind, imported, provenance: { kind, detail } });
  assert.equal(summary('generated', 'TypeScript · northwind-shop · captured Sep 14, 2026 · partial coverage'), 'TypeScript · captured Sep 14, 2026');
  assert.equal(summary('generated', 'SQLite · inventory · captured Sep 9, 2026 · complete coverage · Imported', 'database', true), 'SQLite · captured Sep 9, 2026 · imported');
  assert.equal(summary('generated', 'captured Sep 9, 2026'), 'Captured Sep 9, 2026');
  assert.equal(summary('generated', 'Java · shop'), 'Java · shop');
  assert.equal(summary('proposal', 'Changes to source captured Sep 14, 2026'), 'Changes to the code captured Sep 14, 2026');
  assert.equal(summary('proposal', 'Changes to source captured Sep 9, 2026', 'database'), 'Changes to the database captured Sep 9, 2026');
  assert.equal(summary('proposal', '', 'ontouml'), 'Changes to the model');
  assert.equal(summary('authored', 'Conceptual model', 'ontouml'), 'Conceptual model');
  assert.equal(summary('authored', 'Structural model · Imported', 'code', true), 'Structural model · imported');
  assert.equal(summary('unknown', '', 'code'), '');
});
