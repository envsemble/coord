import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSummary } from './provenance.ts';

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
  // Alternatives over one capture read apart by how much each changes.
  const counted = (changes: number) => modelSummary({ profile: 'code', state: 'proposal', imported: false, provenance: { kind: 'proposal', detail: 'Changes to source captured Sep 14, 2026' } }, changes);
  assert.equal(counted(15), '15 changes to the code captured Sep 14, 2026');
  assert.equal(counted(1), '1 change to the code captured Sep 14, 2026');
  assert.equal(counted(0), 'No changes to the code captured Sep 14, 2026');
  assert.equal(summary('authored', 'Conceptual model', 'ontouml'), 'Conceptual model');
  assert.equal(summary('authored', 'Structural model · Imported', 'code', true), 'Structural model · imported');
  assert.equal(summary('unknown', '', 'code'), '');
});
