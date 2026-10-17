import test from 'node:test';
import assert from 'node:assert/strict';
import { canGoBack, canGoForward, currentEntry, historyLimit, keyStep, moveProject, record, samePlace, startHistory, step, type History } from './history.ts';
import { diagramTarget, fileTarget, hubPlace, projectsPlace, statisticsPlace, stepTarget, workTarget, type Place, type ProjectPlace } from './targets.ts';
import type { Target } from '../types.ts';

const shop = 'f-' + 'a'.repeat(32), coord = 'f-' + 'b'.repeat(32);
const at = (target: Target, project = shop): ProjectPlace => ({ project, target });
const hub = hubPlace();
const plan = at(workTarget('work-0001'));
const other = at(workTarget('work-0001'), coord);
const notes = at(fileTarget('knowledge/notes.md'));

test('each new place shown follows the current entry; the same place again adds nothing', () => {
  let history = startHistory(hub);
  assert.equal(canGoBack(history), false);
  history = record(history, plan);
  history = record(history, at(workTarget('work-0001', null)));
  history = record(history, other);
  assert.deepEqual(history, { entries: [hub, plan, other], ids: [0, 1, 2], index: 2, next: 3 });
  assert.equal(currentEntry(history), 2);
  assert.equal(canGoBack(history), true);
  assert.equal(canGoForward(history), false);
  // A heading, a diagram's element or another project is a place of its own.
  assert.equal(samePlace(at(fileTarget('a.md')), at(fileTarget('a.md', 'intro'))), false);
  assert.equal(samePlace(at(diagramTarget('work-0001', 'd.puml')), at(diagramTarget('work-0001', 'd.puml', 'Order'))), false);
  assert.equal(samePlace(plan, other), false);
  assert.equal(samePlace(plan, at({ kind: 'work', work: 'work-0001', anchor: null, step: null })), true);
  // A plan at a ledger step the search found is a place of its own, kept with its step.
  const found = at(stepTarget('work-0001', 'Build the hub'));
  assert.equal(samePlace(plan, found), false);
  assert.equal(samePlace(found, at({ kind: 'work', work: 'work-0001', anchor: null, step: 'Build the hub' })), true);
  const stepped = record(startHistory(plan), found);
  assert.deepEqual(stepped.entries, [plan, found]);
  assert.deepEqual(step(step(stepped, -1)!.history, 1)!.place, found);
});

test("the hub's project filter, the Projects page and a project's statistics are places too", () => {
  assert.equal(samePlace(hub, hubPlace()), true);
  assert.equal(samePlace(hub, hubPlace(shop)), false, 'filtering the hub to a project is a step');
  assert.equal(samePlace(hubPlace(shop), hubPlace(shop)), true);
  assert.equal(samePlace(statisticsPlace(shop), statisticsPlace(coord)), false);
  assert.equal(samePlace(statisticsPlace(shop), hubPlace(shop)), false);
  assert.equal(samePlace(projectsPlace(), projectsPlace()), true);
  assert.equal(samePlace(hub, plan), false);
  assert.equal(samePlace(plan, hub), false);
  // From a plan, its breadcrumb's project, then back to the plan and back to the hub.
  let history = record(record(startHistory(hub), plan), hubPlace(shop));
  assert.deepEqual(history.entries, [hub, plan, hubPlace(shop)]);
  history = step(history, -1)!.history;
  assert.deepEqual(step(history, -1)!.place, hub);
});

test('going back and forward moves through the entries; showing something new drops what was ahead', () => {
  let history: History = { entries: [hub, plan, other], ids: [0, 1, 2], index: 2, next: 3 };
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
  assert.deepEqual(history, { entries: [hub, plan, notes], ids: [0, 1, 3], index: 2, next: 4 });
  assert.equal(step(history, 1), null);
});

test('the history keeps its latest entries', () => {
  let history = startHistory(hub);
  for (let index = 0; index < historyLimit + 10; index++) history = record(history, at(fileTarget(`file-${index}.md`)));
  assert.equal(history.entries.length, historyLimit);
  assert.equal(history.index, historyLimit - 1);
  assert.deepEqual(history.entries.at(-1), at(fileTarget(`file-${historyLimit + 9}.md`)));
  assert.deepEqual(history.entries[0], at(fileTarget('file-10.md')));
  assert.equal(history.ids.length, historyLimit);
  assert.equal(currentEntry(history), historyLimit + 10);
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

test('a project moved under a new folder ID takes the place shown and the history along', () => {
  const moved = 'f-' + 'c'.repeat(32);
  const places: Place[] = [other, hubPlace(shop), statisticsPlace(shop), plan];
  const { ui, history } = moveProject({ ui: { place: plan }, history: places.slice(1).reduce(record, startHistory(places[0])) }, shop, moved);
  assert.deepEqual(ui.place, at(workTarget('work-0001'), moved));
  assert.deepEqual(history.entries, [other, hubPlace(moved), statisticsPlace(moved), at(workTarget('work-0001'), moved)]);
  assert.deepEqual(moveProject({ ui: { place: hub }, history: startHistory(projectsPlace()) }, shop, moved), { ui: { place: hub }, history: startHistory(projectsPlace()) });
});
