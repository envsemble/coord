import test from 'node:test';
import assert from 'node:assert/strict';
import { familyLayers, stepLayer } from './layers.ts';

test('a family is one diagram: its first capture, later captures by date, then proposals by title; [ and ] wrap round', () => {
  const entry = (path: string, role: string, family: string | null, capturedAt: string | null = null, valid = true) => ({ path, title: path.replace('.puml', ''), role, family, capturedAt, valid });
  const diagrams = [
    entry('split.puml', 'proposal', 'now.puml'),
    entry('later.puml', 'capture', 'now.puml', '2026-11-12T10:00:00Z'),
    entry('now.puml', 'capture', 'now.puml', '2026-11-01T10:00:00Z'),
    entry('broken.puml', 'proposal', 'now.puml', null, false),
    entry('alone.puml', 'diagram', null),
    entry('merge.puml', 'proposal', 'now.puml'),
  ];
  const layers = familyLayers(diagrams, 'split.puml');
  assert.deepEqual(layers.map(layer => layer.path), ['now.puml', 'later.puml', 'merge.puml', 'split.puml']);
  assert.deepEqual(layers.map(layer => layer.kind), ['capture', 'capture', 'proposal', 'proposal']);
  assert.equal(layers[0].label, 'Captured');
  assert.deepEqual(layers.slice(2).map(layer => layer.label), ['Proposal 1', 'Proposal 2']);
  assert.deepEqual(familyLayers(diagrams, 'alone.puml'), []);
  assert.equal(stepLayer(layers, 'split.puml', 1), 'now.puml');
  assert.equal(stepLayer(layers, 'now.puml', -1), 'split.puml');
  assert.equal(stepLayer(layers, 'later.puml', 1), 'merge.puml');
});
