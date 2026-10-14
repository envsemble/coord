import test from 'node:test';
import assert from 'node:assert/strict';
import { argumentsOf, command, diagramPath, relativePath, uiState, ValidationError, viewEvent, workId } from './validate.ts';
import { defaultUiState } from './contract.ts';

test('planning paths must be relative and stay inside the folder', () => {
  for (const good of ['README.md', 'active/0001-x/plan.md', 'knowledge/a b/c.md', 'archive/..hidden-ish.md']) assert.equal(relativePath(good), good);
  for (const bad of ['', '/etc/passwd', '\\\\server\\share', 'C:/Windows/win.ini', 'c:file', '../x.md', 'a/../../x.md', 'a/..', 'a\0b', 42, null, 'x'.repeat(5000)]) {
    assert.throws(() => relativePath(bad), ValidationError, String(bad));
  }
});

test('identifiers, commands and view events have exact shapes', () => {
  assert.equal(workId('work-0011'), 'work-0011');
  assert.throws(() => workId('work-11'));
  assert.throws(() => workId('../work-0011'));
  assert.equal(diagramPath('diagrams/checkout-capture.puml'), 'diagrams/checkout-capture.puml');
  for (const bad of ['../../planning.json.puml', 'diagrams/../../x.puml', '/x.puml', 'C:/x.puml', 'plan.md']) assert.throws(() => diagramPath(bad), bad);
  assert.equal(command('newWindow'), 'newWindow');
  assert.equal(command('closeFolder'), 'closeFolder');
  assert.throws(() => command('openFolder'), /must be one of/, 'folders open through their own channels');
  assert.throws(() => command('exit'));
  assert.deepEqual(viewEvent({ id: 'abcdefgh-1', path: 'README.md', session: 'abcdefgh-2', contentHash: 'ab12', extra: 'dropped' }), { id: 'abcdefgh-1', path: 'README.md', session: 'abcdefgh-2', contentHash: 'ab12' });
  assert.throws(() => viewEvent({ id: 'x', path: 'README.md', session: 'abcdefgh-2', contentHash: null }));
});

test('argument lists reject extra arguments', () => {
  assert.deepEqual(argumentsOf([workId], ['work-0001']), ['work-0001']);
  assert.throws(() => argumentsOf([workId], ['work-0001', 'more']), /at most 1/);
  assert.throws(() => argumentsOf([workId], []), /argument 1/);
});

test('window state is checked deeply and repaired where it is safe', () => {
  assert.deepEqual(uiState(defaultUiState), defaultUiState);
  const state = uiState({
    sidebar: { visible: false, width: 300, expanded: ['d:active'] },
    tabs: { items: [{ id: 'work:work-0001', target: { kind: 'work', work: 'work-0001', section: 'diagrams', diagram: null }, preview: true }], active: 'gone' },
  });
  assert.equal(state.tabs.active, 'work:work-0001', 'a dangling active tab falls back to the first');
  // A tab keeps its diagram file; one saved by name of a retired model shows the work item's first diagram.
  const diagramTab = (diagram: string) => uiState({ ...defaultUiState, tabs: { items: [{ id: 'work:work-0001', target: { kind: 'work', work: 'work-0001', section: 'diagrams', diagram }, preview: false }], active: null } }).tabs.items[0].target;
  assert.equal((diagramTab('diagrams/order.puml') as { diagram?: string | null }).diagram, 'diagrams/order.puml');
  assert.equal((diagramTab('m-024410515ef6611f71e02bdc') as { diagram?: string | null }).diagram, null);
  assert.equal((diagramTab('../../planning.json') as { diagram?: string | null }).diagram, null);
  assert.throws(() => uiState({ ...defaultUiState, sidebar: { visible: true, width: 5, expanded: [] } }), /sidebar.width/);
  assert.throws(() => uiState({ ...defaultUiState, tabs: { items: [{ id: 'x', target: { kind: 'file', path: '../secret' }, preview: false }], active: null } }), /path/);
  assert.throws(() => uiState({ ...defaultUiState, tabs: { items: Array.from({ length: 41 }, () => ({ id: 'x', target: { kind: 'view', view: 'work' }, preview: false })), active: null } }), /at most 40/);
  assert.throws(() => uiState({ ...defaultUiState, page: 'settings' }), /page/);
  // The width of a diagram's details is kept when the reader chose one.
  assert.equal(uiState({ ...defaultUiState, inspectorWidth: 480 }).inspectorWidth, 480);
  assert.equal('inspectorWidth' in uiState(defaultUiState), false);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 20 }), /inspectorWidth/);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 480.5 }), /inspectorWidth/);
});

test('views saved as tabs become pages', () => {
  const work = { id: 'work:work-0001', target: { kind: 'work', work: 'work-0001' }, preview: false };
  const activity = { id: 'view:activity', target: { kind: 'view', view: 'activity' }, preview: false };
  const sidebar = defaultUiState.sidebar;
  // An active view tab becomes the page; the documents stay as tabs, none active.
  assert.deepEqual(uiState({ sidebar, tabs: { items: [activity, work], active: 'view:activity' } }), { sidebar, tabs: { items: [work], active: null }, page: 'activity' });
  // An active document stays active, over the Work page.
  assert.deepEqual(uiState({ sidebar, tabs: { items: [activity, work], active: 'work:work-0001' } }), { sidebar, tabs: { items: [work], active: 'work:work-0001' }, page: 'work' });
  // The saved page is kept, with documents open behind it.
  assert.deepEqual(uiState({ sidebar, tabs: { items: [], active: null }, page: 'statistics' }), { sidebar, tabs: { items: [], active: null }, page: 'statistics' });
  assert.deepEqual(uiState({ sidebar, tabs: { items: [work], active: null }, page: 'activity' }), { sidebar, tabs: { items: [work], active: null }, page: 'activity' });
});
