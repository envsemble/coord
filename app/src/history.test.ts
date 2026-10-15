import test from 'node:test';
import assert from 'node:assert/strict';
import { canGoBack, canGoForward, currentEntry, historyLimit, keyStep, record, samePlace, shownPlace, showPlace, startHistory, step, type History } from './history.ts';
import { diagramTarget, fileTarget, projectTarget, workTarget, type Place } from './targets.ts';
import type { UiState } from './types.ts';

const shop = 'f-' + 'a'.repeat(32), coord = 'f-' + 'b'.repeat(32);
const at = (target: Place['target'], project = shop): Place => ({ project, target });
const page = at(projectTarget());
const plan = at(workTarget('work-0001'));
const other = at(workTarget('work-0001'), coord);
const notes = at(fileTarget('knowledge/notes.md'));

test('each new thing shown follows the current entry; the same thing again adds nothing', () => {
  let history = startHistory(page);
  assert.equal(canGoBack(history), false);
  history = record(history, plan);
  history = record(history, at(workTarget('work-0001', null)));
  history = record(history, other);
  assert.deepEqual(history, { entries: [page, plan, other], ids: [0, 1, 2], index: 2, next: 3 });
  assert.equal(currentEntry(history), 2);
  assert.equal(canGoBack(history), true);
  assert.equal(canGoForward(history), false);
  // A heading, a diagram's element or another project is a place of its own.
  assert.equal(samePlace(at(fileTarget('a.md')), at(fileTarget('a.md', 'intro'))), false);
  assert.equal(samePlace(at(diagramTarget('work-0001', 'd.puml')), at(diagramTarget('work-0001', 'd.puml', 'Order'))), false);
  assert.equal(samePlace(plan, other), false);
  assert.equal(samePlace(page, at(projectTarget())), true);
  assert.equal(samePlace(null, null), true);
});

test('going back and forward moves through the entries; showing something new drops what was ahead', () => {
  let history: History = { entries: [page, plan, other], ids: [0, 1, 2], index: 2, next: 3 };
  const back = step(history, -1)!;
  assert.deepEqual(back.place, plan);
  history = step(back.history, -1)!.history;
  assert.equal(history.index, 0);
  assert.equal(step(history, -1), null);
  history = step(history, 1)!.history;
  assert.deepEqual(history.entries[history.index], plan);
  assert.equal(canGoForward(history), true);
  // Recording what an entry already shows (the step itself) changes nothing.
  assert.equal(record(history, plan), history);
  history = record(history, notes);
  // The new entry has an id of its own, never the dropped entry's.
  assert.deepEqual(history, { entries: [page, plan, notes], ids: [0, 1, 3], index: 2, next: 4 });
  assert.equal(step(history, 1), null);
});

test('the history keeps its latest entries', () => {
  let history = startHistory(page);
  for (let index = 0; index < historyLimit + 10; index++) history = record(history, at(fileTarget(`file-${index}.md`)));
  assert.equal(history.entries.length, historyLimit);
  assert.equal(history.index, historyLimit - 1);
  assert.deepEqual(history.entries.at(-1), at(fileTarget(`file-${historyLimit + 9}.md`)));
  assert.deepEqual(history.entries[0], at(fileTarget('file-10.md')));
  assert.equal(history.ids.length, historyLimit);
  assert.equal(currentEntry(history), historyLimit + 10);
});

const ui = (tabs: UiState['tabs']): UiState => ({ sidebar: { visible: true, width: 280 }, tabs });

test('an entry shows again as its open tab, or as a preview tab when its tab was closed', () => {
  const opened = ui({ items: [{ id: shop + ':work:work-0001', project: shop, target: plan.target, preview: false }, { id: shop + ':file:knowledge/notes.md', project: shop, target: notes.target, preview: true }], active: shop + ':file:knowledge/notes.md' });
  assert.deepEqual(shownPlace(opened), notes);
  // Nothing shown leaves the tabs, none active.
  const none = showPlace(opened, null);
  assert.deepEqual(none.tabs.items, opened.tabs.items);
  assert.equal(shownPlace(none), null);
  // An open tab becomes active at the entry's place, and a kept tab stays kept.
  const tab = showPlace(none, plan);
  assert.equal(tab.tabs.active, shop + ':work:work-0001');
  assert.deepEqual(tab.tabs.items.map(item => [item.id, item.preview]), [[shop + ':work:work-0001', false], [shop + ':file:knowledge/notes.md', true]]);
  // A closed tab opens again as a preview, which replaces the current preview.
  const reopened = showPlace(tab, at(fileTarget('README.md'), coord));
  assert.deepEqual(reopened.tabs.items.map(item => [item.id, item.preview]), [[shop + ':work:work-0001', false], [coord + ':file:README.md', true]]);
  assert.equal(reopened.tabs.active, coord + ':file:README.md');
});

const key = (key: string, modifiers: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) =>
  ({ key, altKey: Boolean(modifiers.alt), ctrlKey: Boolean(modifiers.ctrl), metaKey: Boolean(modifiers.meta), shiftKey: Boolean(modifiers.shift) });

test('Alt+← and Alt+→ go back and forward, ⌘[ and ⌘] on macOS, and so do a keyboard\'s own keys', () => {
  assert.equal(keyStep(key('ArrowLeft', { alt: true }), 'win32'), -1);
  assert.equal(keyStep(key('ArrowRight', { alt: true }), 'linux'), 1);
  assert.equal(keyStep(key('ArrowLeft'), 'win32'), null);
  assert.equal(keyStep(key('ArrowLeft', { alt: true, shift: true }), 'win32'), null);
  assert.equal(keyStep(key('ArrowLeft', { alt: true, ctrl: true }), 'win32'), null);
  assert.equal(keyStep(key('[', { ctrl: true }), 'win32'), null);
  assert.equal(keyStep(key('[', { meta: true }), 'darwin'), -1);
  assert.equal(keyStep(key(']', { meta: true }), 'darwin'), 1);
  // On macOS, Option+← moves by word in text and is not a navigation key.
  assert.equal(keyStep(key('ArrowLeft', { alt: true }), 'darwin'), null);
  assert.equal(keyStep(key('BrowserBack'), 'win32'), -1);
  assert.equal(keyStep(key('BrowserForward'), 'darwin'), 1);
});
