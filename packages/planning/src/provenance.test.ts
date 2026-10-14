import test from 'node:test';
import assert from 'node:assert/strict';
import { describeProvenance, modelSummary, type ProvenanceSource } from './provenance.ts';

test('the picker describes each diagram in one short line', () => {
  const summary = (kind: string, detail: string, profile = 'code') => modelSummary({ profile, provenance: { kind, detail } });
  assert.equal(summary('generated', 'TypeScript · northwind-shop · captured Sep 14, 2026 · partial coverage'), 'TypeScript · captured Sep 14, 2026');
  assert.equal(summary('generated', 'captured Sep 9, 2026'), 'Captured Sep 9, 2026');
  assert.equal(summary('generated', 'Java · shop'), 'Java · shop');
  assert.equal(summary('proposal', 'Changes to source captured Sep 14, 2026'), 'Changes to the code captured Sep 14, 2026');
  assert.equal(summary('proposal', 'Changes to source captured Sep 9, 2026', 'database'), 'Changes to the database captured Sep 9, 2026');
  assert.equal(summary('proposal', '', 'class'), 'Changes to the diagram');
  // Alternatives over one capture read apart by how much each changes.
  const counted = (changes: number) => modelSummary({ profile: 'code', provenance: { kind: 'proposal', detail: 'Changes to source captured Sep 14, 2026' } }, changes);
  assert.equal(counted(15), '15 changes to the code captured Sep 14, 2026');
  assert.equal(counted(1), '1 change to the code captured Sep 14, 2026');
  assert.equal(counted(0), 'No changes to the code captured Sep 14, 2026');
  assert.equal(summary('authored', 'Class diagram', 'class'), 'Class diagram');
  assert.equal(summary('unknown', '', 'code'), '');
});

test('provenance reads as the viewer words it', async () => {
  const viewer = await import('@envsemble/atlas-diagrams/react');
  const capture = (kind: string, identity: string, status: string) => ({ capturedAt: '2026-09-14T08:42:00.000Z', source: { kind, identity }, coverage: { status } });
  // Each diagram as the catalog describes it, and as the viewer's payload carries it.
  const cases: [ProvenanceSource, unknown][] = [
    [{ role: 'capture', profile: 'code', capture: capture('typescript', 'shop', 'partial') }, { state: 'snapshot', profile: 'code', captureId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'shop', 'partial') }] }],
    [{ role: 'capture', profile: 'database', capture: capture('sqlite', 'inventory', 'complete') }, { state: 'snapshot', profile: 'database', captureId: 'c', snapshots: [{ id: 'c', capture: capture('sqlite', 'inventory', 'complete') }] }],
    [{ role: 'proposal', profile: 'code', capture: capture('typescript', 'shop', 'complete') }, { state: 'proposal', profile: 'code', baselineId: 'c', snapshots: [{ id: 'c', capture: capture('typescript', 'shop', 'complete') }] }],
    [{ role: 'proposal', profile: 'class', capture: null }, { state: 'proposal', profile: 'class', baselineId: 'b', snapshots: [] }],
    [{ role: 'diagram', profile: 'class' }, { state: 'authored', profile: 'class' }],
    [{ role: 'scenario', profile: 'object' }, { state: 'authored', profile: 'object' }],
    [{ role: 'diagram', profile: 'database' }, { state: 'authored', profile: 'database' }],
  ];
  for (const [diagram, document] of cases) assert.deepEqual(describeProvenance(diagram), viewer.describeProvenance(document as never), JSON.stringify(diagram));
  assert.equal(describeProvenance(undefined).kind, 'unknown');
});
