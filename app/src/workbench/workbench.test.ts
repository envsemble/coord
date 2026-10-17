import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramTarget, documentTarget, fileTarget } from '../navigation/targets.ts';
import { buildIndex, folderId, revealIds, visibleRows } from './explorerModel.ts';
import { fuzzyScore, rankItems } from '../navigation/quickMatch.ts';
import type { Document, Work } from '../types.ts';

const document = (path: string, workId: string | null = null) => ({ path, name: path.split('/').at(-1)!, title: path, workId }) as Document;
const work = { id: 'work-0001', path: 'active/0001-x', diagrams: 2, title: 'X' } as Work;

test('the file panel shows folders before files and real names, and a diagram file opens as a diagram of its work item', () => {
  const index = buildIndex({ folders: ['active', 'active/0001-x', 'active/0001-x/docs', 'empty'], documents: [document('README.md'), document('active/0001-x/plan.md', 'work-0001'), document('active/0001-x/docs/adr.md', 'work-0001'), document('active/0001-x/order.puml', 'work-0001')], work: [work] });
  assert.deepEqual(visibleRows(index, new Set()).map(row => row.id), ['d:active', 'd:empty', 'f:README.md']);
  const rows = visibleRows(index, new Set([folderId('active'), folderId('active/0001-x')]));
  assert.deepEqual(rows.map(row => [row.id, row.depth]), [['d:active', 0], ['d:active/0001-x', 1], ['d:active/0001-x/docs', 2], ['f:active/0001-x/order.puml', 2], ['f:active/0001-x/plan.md', 2], ['d:empty', 0], ['f:README.md', 0]]);
  assert.equal(rows[1].kind, 'work');
  assert.deepEqual(revealIds('active/0001-x/docs/adr.md'), ['d:active/0001-x/docs', 'd:active/0001-x', 'd:active']);
  assert.deepEqual(documentTarget(document('active/0001-x/order.puml', 'work-0001'), work, 'Order'), diagramTarget('work-0001', 'order.puml', 'Order'));
  assert.deepEqual(documentTarget(document('active/0001-x/order.puml', 'work-0001'), undefined), fileTarget('active/0001-x/order.puml'));
});

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
