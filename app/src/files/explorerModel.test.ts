import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramTarget, documentTarget, fileTarget } from '../navigation/targets.ts';
import { buildIndex, folderNodeId, revealIds, visibleRows } from './explorerModel.ts';
import type { Document, Work } from '../types.ts';

const document = (path: string, workId: string | null = null) => ({ path, name: path.split('/').at(-1)!, title: path, workId }) as Document;
const work = { id: 'work-0001', path: 'active/0001-x', diagrams: 2, title: 'X' } as Work;

test('the files show folders before files and real names, and a diagram file opens as a diagram of its work item', () => {
  const index = buildIndex({ folders: ['active', 'active/0001-x', 'active/0001-x/docs', 'empty'], documents: [document('README.md'), document('active/0001-x/plan.md', 'work-0001'), document('active/0001-x/docs/adr.md', 'work-0001'), document('active/0001-x/order.puml', 'work-0001'), document('active/0001-x/order.layout.json', 'work-0001')], work: [work] });
  assert.deepEqual(visibleRows(index, new Set()).map(row => row.id), ['d:active', 'd:empty', 'f:README.md']);
  const rows = visibleRows(index, new Set([folderNodeId('active'), folderNodeId('active/0001-x')]));
  assert.deepEqual(rows.map(row => [row.id, row.depth]), [['d:active', 0], ['d:active/0001-x', 1], ['d:active/0001-x/docs', 2], ['f:active/0001-x/order.puml', 2], ['f:active/0001-x/plan.md', 2], ['d:empty', 0], ['f:README.md', 0]]);
  assert.equal(rows[1].kind, 'work');
  // A diagram's arrangement beside it is not listed. The Files card lists a plan's own folder.
  assert.deepEqual(visibleRows(index, new Set(), 'active/0001-x').map(row => [row.id, row.depth]), [['d:active/0001-x/docs', 0], ['f:active/0001-x/order.puml', 0], ['f:active/0001-x/plan.md', 0]]);
  assert.deepEqual(revealIds('active/0001-x/docs/adr.md'), ['d:active/0001-x/docs', 'd:active/0001-x', 'd:active']);
  assert.deepEqual(documentTarget(document('active/0001-x/order.puml', 'work-0001'), work, 'Order'), diagramTarget('work-0001', 'order.puml', 'Order'));
  assert.deepEqual(documentTarget(document('active/0001-x/order.puml', 'work-0001'), undefined), fileTarget('active/0001-x/order.puml'));
});

test("a diagram's layers are listed under its first file, which opens like a folder onto them", () => {
  const files = ['active/0001-x/diagrams/now.puml', 'active/0001-x/diagrams/later.puml', 'active/0001-x/proposals/draft.puml', 'active/0001-x/diagrams/alone.puml'];
  const index = buildIndex({ folders: ['active', 'active/0001-x', 'active/0001-x/diagrams', 'active/0001-x/proposals'], documents: files.map(path => document(path, 'work-0001')), work: [work] });
  const layers = new Map([['active/0001-x/diagrams/now.puml', ['active/0001-x/diagrams/later.puml', 'active/0001-x/proposals/draft.puml']]]);
  const open = new Set([folderNodeId('active/0001-x/diagrams'), folderNodeId('active/0001-x/proposals')]);
  const rows = (expanded: Set<string>) => visibleRows(index, expanded, 'active/0001-x', layers).map(row => [row.id, row.depth, row.expandable]);
  // Folded, the first file stands for the diagram; its layers leave their folders.
  assert.deepEqual(rows(open), [['d:active/0001-x/diagrams', 0, true], ['f:active/0001-x/diagrams/alone.puml', 1, false], ['f:active/0001-x/diagrams/now.puml', 1, true], ['d:active/0001-x/proposals', 0, true]]);
  // Opened, its layers follow it, in their order.
  assert.deepEqual(rows(new Set([...open, 'f:active/0001-x/diagrams/now.puml'])).slice(2, 5), [['f:active/0001-x/diagrams/now.puml', 1, true], ['f:active/0001-x/diagrams/later.puml', 2, false], ['f:active/0001-x/proposals/draft.puml', 2, false]]);
});
