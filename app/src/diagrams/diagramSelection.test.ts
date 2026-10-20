import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDiagram } from './diagramSelection.ts';

test('a refreshed list keeps the diagram shown, replaces a removed one, and keeps explicit deep links', () => {
  const diagrams = [{ path: 'a.puml' }, { path: 'b.puml' }];
  let selected = selectDiagram(diagrams, '');
  assert.equal(selected, 'a.puml');
  selected = selectDiagram([...diagrams].reverse(), selected);
  assert.equal(selected, 'a.puml');
  selected = selectDiagram([diagrams[1]], selected);
  assert.equal(selected, 'b.puml');
  assert.equal(selectDiagram([diagrams[1]], 'a.puml', 'a.puml'), 'a.puml');
  assert.equal(selectDiagram([], selected, 'deep.puml'), 'deep.puml');
  assert.equal(selectDiagram([], selected), '');
  // The first that can be drawn is shown first.
  assert.equal(selectDiagram([{ path: 'broken.puml', valid: false }, ...diagrams], ''), 'a.puml');
  assert.equal(selectDiagram([{ path: 'broken.puml', valid: false }], ''), 'broken.puml');
});
