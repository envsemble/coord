import test from 'node:test';
import assert from 'node:assert/strict';
import { closeAllTabs, closeTab, keyTabs, openTab, pinTab, restoreTabs, retarget } from './tabs.ts';
import { diagramTarget, documentTarget, fileTarget, projectTarget, workTarget } from './targets.ts';
import { buildIndex, folderId, revealIds, visibleRows } from './explorerModel.ts';
import { fuzzyScore, rankItems } from './quickMatch.ts';
import type { Document, Work } from './types.ts';

const shop = 'f-' + 'a'.repeat(32), coord = 'f-' + 'b'.repeat(32);

test('a preview tab is replaced by the next preview; pinning keeps it', () => {
  let tabs = openTab({ items: [], active: null }, shop, projectTarget(), true);
  tabs = openTab(tabs, shop, fileTarget('a.md'), false);
  tabs = openTab(tabs, shop, fileTarget('b.md'), false);
  assert.deepEqual(tabs.items.map(tab => [tab.id, tab.preview]), [[shop + ':project', false], [shop + ':file:b.md', true]]);
  tabs = pinTab(tabs, shop + ':file:b.md');
  tabs = openTab(tabs, shop, fileTarget('c.md'), false);
  assert.deepEqual(tabs.items.map(tab => tab.id), [shop + ':project', shop + ':file:b.md', shop + ':file:c.md']);
  // Opening what a tab already shows focuses it and updates its position.
  tabs = openTab(tabs, shop, fileTarget('b.md', 'heading'), false);
  assert.equal(tabs.active, shop + ':file:b.md');
  assert.deepEqual(tabs.items[1].target, fileTarget('b.md', 'heading'));
  assert.equal(tabs.items[1].preview, false);
  // Working in a preview tab pins it.
  tabs = retarget(tabs, shop + ':file:c.md', shop, fileTarget('c.md', 'x'));
  assert.equal(tabs.items[2].preview, false);
  tabs = closeTab(tabs, shop + ':file:c.md');
  assert.equal(tabs.active, shop + ':file:b.md');
  tabs = closeTab(closeTab(tabs, shop + ':file:b.md'), shop + ':project');
  assert.deepEqual(tabs, { items: [], active: null });
});

test('tabs of different projects sit side by side, and Close All Tabs closes them all', () => {
  let tabs = openTab({ items: [], active: null }, shop, projectTarget(), true);
  tabs = openTab(tabs, coord, projectTarget(), true);
  tabs = openTab(tabs, shop, workTarget('work-0001'), true);
  tabs = openTab(tabs, coord, workTarget('work-0001'), true);
  assert.deepEqual(tabs.items.map(tab => [tab.project, tab.target.kind]), [[shop, 'project'], [coord, 'project'], [shop, 'work'], [coord, 'work']], 'the same work ID in two projects is two tabs');
  // A plan and its diagrams are tabs of their own; the diagram tab moves to another diagram or element in place.
  tabs = openTab(tabs, shop, diagramTarget('work-0001', 'diagrams/checkout.puml'), true);
  tabs = retarget(tabs, tabs.active!, shop, diagramTarget('work-0001', 'diagrams/checkout.puml', 'Order'));
  tabs = retarget(tabs, tabs.active!, shop, diagramTarget('work-0001', 'diagrams/proposal.puml'));
  assert.equal(tabs.items.length, 5);
  assert.deepEqual(tabs.items[4].target, diagramTarget('work-0001', 'diagrams/proposal.puml'));
  assert.deepEqual(closeAllTabs(), { items: [], active: null });
  // Saved tabs get their ids again, and duplicates go.
  const saved = { items: [{ id: '0', project: shop, target: projectTarget(), preview: false }, { id: '1', project: shop, target: projectTarget(), preview: false }, { id: '2', project: coord, target: fileTarget('a.md'), preview: false }], active: '2' };
  assert.deepEqual(keyTabs(saved), { items: [{ id: shop + ':project', project: shop, target: projectTarget(), preview: false }, { id: coord + ':file:a.md', project: coord, target: fileTarget('a.md'), preview: false }], active: coord + ':file:a.md' });
  // Tabs that waited for their computer join those the window has: only of projects it has none of.
  const shown = openTab({ items: [], active: null }, shop, fileTarget('b.md'), true);
  const restored = restoreTabs(shown, saved);
  assert.deepEqual(restored.items.map(tab => tab.id), [shop + ':file:b.md', coord + ':file:a.md']);
  assert.equal(restored.active, shop + ':file:b.md', 'the window keeps its active tab');
  assert.equal(restoreTabs({ items: [], active: null }, saved).active, coord + ':file:a.md');
  assert.equal(restoreTabs(restored, saved), restored, 'nothing new changes nothing');
});

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
