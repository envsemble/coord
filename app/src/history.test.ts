import test from 'node:test';
import assert from 'node:assert/strict';
import { canGoBack, canGoForward, historyLimit, keyStep, record, sameTarget, shownTarget, showTarget, startHistory, step, type History } from './history.ts';
import { fileTarget, viewTarget, workTarget } from './targets.ts';
import type { UiState } from './types.ts';

const work = viewTarget('work');
const plan = workTarget('work-0001', 'plan');
const ledger = workTarget('work-0001', 'ledger');
const notes = fileTarget('knowledge/notes.md');

test('each new thing shown follows the current entry; the same thing again adds nothing', () => {
  let history = startHistory(work);
  assert.equal(canGoBack(history), false);
  history = record(history, plan);
  history = record(history, workTarget('work-0001', 'plan', { diagram: null, anchor: null }));
  history = record(history, ledger);
  assert.deepEqual(history, { entries: [work, plan, ledger], index: 2 });
  assert.equal(canGoBack(history), true);
  assert.equal(canGoForward(history), false);
  // A heading or a diagram is a place of its own.
  assert.equal(sameTarget(fileTarget('a.md'), fileTarget('a.md', 'intro')), false);
  assert.equal(sameTarget(workTarget('work-0001', 'diagrams'), workTarget('work-0001', 'diagrams', { diagram: 'm-1' })), false);
  assert.equal(sameTarget(viewTarget('activity'), viewTarget('activity')), true);
});

test('going back and forward moves through the entries; showing something new drops what was ahead', () => {
  let history: History = { entries: [work, plan, ledger], index: 2 };
  const back = step(history, -1)!;
  assert.deepEqual(back.target, plan);
  history = step(back.history, -1)!.history;
  assert.equal(history.index, 0);
  assert.equal(step(history, -1), null);
  history = step(history, 1)!.history;
  assert.deepEqual(history.entries[history.index], plan);
  assert.equal(canGoForward(history), true);
  // Recording what an entry already shows (the step itself) changes nothing.
  assert.equal(record(history, plan), history);
  history = record(history, notes);
  assert.deepEqual(history, { entries: [work, plan, notes], index: 2 });
  assert.equal(step(history, 1), null);
});

test('the history keeps its latest entries', () => {
  let history = startHistory(work);
  for (let index = 0; index < historyLimit + 10; index++) history = record(history, fileTarget(`file-${index}.md`));
  assert.equal(history.entries.length, historyLimit);
  assert.equal(history.index, historyLimit - 1);
  assert.deepEqual(history.entries.at(-1), fileTarget(`file-${historyLimit + 9}.md`));
  assert.deepEqual(history.entries[0], fileTarget('file-10.md'));
});

const ui = (tabs: UiState['tabs'], page: UiState['page'] = 'work'): UiState => ({ sidebar: { visible: true, width: 280, expanded: [] }, tabs, page });

test('an entry shows again as a page, as its open tab, or as a preview tab when its tab was closed', () => {
  const opened = ui({ items: [{ id: 'work:work-0001', target: ledger, preview: false }, { id: 'file:knowledge/notes.md', target: notes, preview: true }], active: 'file:knowledge/notes.md' });
  assert.deepEqual(shownTarget(opened), notes);
  // A page shows over the tabs, which stay as they are.
  const page = showTarget(opened, viewTarget('statistics'));
  assert.deepEqual(page.tabs.items, opened.tabs.items);
  assert.equal(page.tabs.active, null);
  assert.deepEqual(shownTarget(page), viewTarget('statistics'));
  // An open tab becomes active at the entry's place, and a kept tab stays kept.
  const tab = showTarget(page, plan);
  assert.equal(tab.tabs.active, 'work:work-0001');
  assert.deepEqual(tab.tabs.items.map(item => [item.id, item.preview]), [['work:work-0001', false], ['file:knowledge/notes.md', true]]);
  assert.deepEqual(shownTarget(tab), plan);
  // A closed tab opens again as a preview, which replaces the current preview.
  const reopened = showTarget(tab, fileTarget('README.md'));
  assert.deepEqual(reopened.tabs.items.map(item => [item.id, item.preview]), [['work:work-0001', false], ['file:README.md', true]]);
  assert.equal(reopened.tabs.active, 'file:README.md');
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
