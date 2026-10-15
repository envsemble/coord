import test from 'node:test';
import assert from 'node:assert/strict';
import { argumentsOf, command, diagramPath, relativePath, target, uiState, ValidationError, viewEvent, workId } from './validate.ts';
import { defaultUiState } from './contract.ts';

const project = 'f-' + 'a'.repeat(32);

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
  for (const gone of ['closeFolder', 'locate', 'openFolder', 'exit']) assert.throws(() => command(gone), /must be one of/, gone);
  assert.deepEqual(viewEvent({ id: 'abcdefgh-1', path: 'README.md', session: 'abcdefgh-2', contentHash: 'ab12', extra: 'dropped' }), { id: 'abcdefgh-1', path: 'README.md', session: 'abcdefgh-2', contentHash: 'ab12' });
  assert.throws(() => viewEvent({ id: 'x', path: 'README.md', session: 'abcdefgh-2', contentHash: null }));
});

test('argument lists reject extra arguments', () => {
  assert.deepEqual(argumentsOf([workId], ['work-0001']), ['work-0001']);
  assert.throws(() => argumentsOf([workId], ['work-0001', 'more']), /at most 1/);
  assert.throws(() => argumentsOf([workId], []), /argument 1/);
});

test('tabs show a project\'s page, a plan, a diagram or a file, and nothing else', () => {
  assert.deepEqual(target({ kind: 'project', extra: 1 }), { kind: 'project' });
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', section: 'ledger' }), { kind: 'work', work: 'work-0001' }, 'sections are gone');
  assert.deepEqual(target({ kind: 'diagram', work: 'work-0001', path: null }), { kind: 'diagram', work: 'work-0001', path: null });
  assert.equal((target({ kind: 'diagram', work: 'work-0001', path: 'diagrams/order.puml', element: 'Order' }) as { element?: string }).element, 'Order');
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', anchor: 'provenance', view: 'ledger' }), { kind: 'work', work: 'work-0001', anchor: 'provenance', view: 'ledger' }, 'a work item shows its ledger in place of the plan');
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', view: null }), { kind: 'work', work: 'work-0001', view: null });
  for (const view of ['plan', 'diagrams', 'Ledger', 1]) assert.throws(() => target({ kind: 'work', work: 'work-0001', view }), /view/, String(view));
  for (const bad of [{ kind: 'view', view: 'work' }, { kind: 'diagram', work: 'work-0001', path: '../../planning.json' }, { kind: 'file', path: '../secret' }]) assert.throws(() => target(bad), JSON.stringify(bad));
});

test('window state is checked deeply', () => {
  assert.deepEqual(uiState(defaultUiState), defaultUiState);
  const state = uiState({ sidebar: { visible: false, width: 300, expanded: ['dropped'] }, tabs: { items: [{ id: 'p:work:work-0001', project, target: { kind: 'work', work: 'work-0001' }, preview: true }], active: 'p:work:work-0001' } });
  assert.deepEqual(state.sidebar, { visible: false, width: 300 });
  assert.equal(state.tabs.items[0].project, project);
  assert.throws(() => uiState({ ...defaultUiState, sidebar: { visible: true, width: 5 } }), /sidebar.width/);
  assert.throws(() => uiState({ ...defaultUiState, tabs: { items: [{ id: 'x', project: '../x', target: { kind: 'project' }, preview: false }], active: null } }), /project/);
  assert.throws(() => uiState({ ...defaultUiState, tabs: { items: Array.from({ length: 41 }, () => ({ id: 'x', project, target: { kind: 'project' }, preview: false })), active: null } }), /at most 40/);
  // The width of a diagram's details is kept when the reader chose one.
  assert.equal(uiState({ ...defaultUiState, inspectorWidth: 480 }).inspectorWidth, 480);
  assert.equal('inspectorWidth' in uiState(defaultUiState), false);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 20 }), /inspectorWidth/);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 480.5 }), /inspectorWidth/);
});
