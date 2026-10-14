import test from 'node:test';
import assert from 'node:assert/strict';
import { closeTab, openTab, pinTab, retarget } from './tabs.ts';
import { documentTarget, fileTarget, viewTarget, workTarget } from './targets.ts';
import { buildIndex, folderId, revealIds, visibleRows } from './explorerModel.ts';
import { fuzzyScore, rankItems } from './quickMatch.ts';
import type { Document, Work } from './types.ts';

test('a preview tab is replaced by the next preview; pinning keeps it', () => {
  let tabs = openTab({ items: [], active: null }, viewTarget('work'), true);
  tabs = openTab(tabs, fileTarget('a.md'), false);
  tabs = openTab(tabs, fileTarget('b.md'), false);
  assert.deepEqual(tabs.items.map(tab => [tab.id, tab.preview]), [['view:work', false], ['file:b.md', true]]);
  tabs = pinTab(tabs, 'file:b.md');
  tabs = openTab(tabs, fileTarget('c.md'), false);
  assert.deepEqual(tabs.items.map(tab => tab.id), ['view:work', 'file:b.md', 'file:c.md']);
  // Opening what a tab already shows focuses it and updates its position.
  tabs = openTab(tabs, fileTarget('b.md', 'heading'), false);
  assert.equal(tabs.active, 'file:b.md');
  assert.deepEqual(tabs.items[1].target, fileTarget('b.md', 'heading'));
  assert.equal(tabs.items[1].preview, false);
  // Working in a preview tab pins it.
  tabs = retarget(tabs, 'file:c.md', fileTarget('c.md', 'x'));
  assert.equal(tabs.items[2].preview, false);
  tabs = closeTab(tabs, 'file:c.md');
  assert.equal(tabs.active, 'file:b.md');
  tabs = closeTab(closeTab(tabs, 'file:b.md'), 'view:work');
  assert.deepEqual(tabs, { items: [], active: null });
});

test('a work item has one tab for its overview, sections and diagrams', () => {
  let tabs = openTab({ items: [], active: null }, workTarget('work-0001'), false);
  tabs = openTab(tabs, workTarget('work-0001', 'diagrams', { diagram: 'diagrams/checkout.puml' }), false);
  assert.equal(tabs.items.length, 1);
  assert.equal(tabs.items[0].target.kind === 'work' && tabs.items[0].target.diagram, 'diagrams/checkout.puml');
});

const document = (path: string, workId: string | null = null) => ({ path, name: path.split('/').at(-1)!, title: path, workId }) as Document;
const work = { id: 'work-0001', path: 'active/0001-x', diagrams: 2, title: 'X' } as Work;

test('the explorer shows folders before files and real names, and a diagram file opens as a diagram of its work item', () => {
  const index = buildIndex({ folders: ['active', 'active/0001-x', 'active/0001-x/docs', 'empty'], documents: [document('README.md'), document('active/0001-x/plan.md', 'work-0001'), document('active/0001-x/docs/adr.md', 'work-0001'), document('active/0001-x/order.puml', 'work-0001')], work: [work] });
  assert.deepEqual(visibleRows(index, new Set()).map(row => row.id), ['d:active', 'd:empty', 'f:README.md']);
  const rows = visibleRows(index, new Set([folderId('active'), folderId('active/0001-x')]));
  assert.deepEqual(rows.map(row => [row.id, row.depth]), [['d:active', 0], ['d:active/0001-x', 1], ['d:active/0001-x/docs', 2], ['f:active/0001-x/order.puml', 2], ['f:active/0001-x/plan.md', 2], ['d:empty', 0], ['f:README.md', 0]]);
  assert.equal(rows[1].kind, 'work');
  assert.deepEqual(revealIds('active/0001-x/docs/adr.md'), ['d:active/0001-x/docs', 'd:active/0001-x', 'd:active']);
  assert.deepEqual(documentTarget(document('active/0001-x/order.puml', 'work-0001'), work, 'Order'), workTarget('work-0001', 'diagrams', { diagram: 'order.puml', element: 'Order' }));
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
