import test from 'node:test';
import assert from 'node:assert/strict';
import { argumentsOf, command, diagramPath, folderPath, isProjectListing, place, relativePath, target, uiState, ValidationError, workId } from './validate.ts';
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
  for (const gone of ['closeFolder', 'locate', 'openFolder', 'exit', 'closeWindow', 'undo', 'paste', 'selectAll']) assert.throws(() => command(gone), /must be one of/, gone);
});

test('argument lists reject extra arguments', () => {
  assert.deepEqual(argumentsOf([workId], ['work-0001']), ['work-0001']);
  assert.throws(() => argumentsOf([workId], ['work-0001', 'more']), /at most 1/);
  assert.throws(() => argumentsOf([workId], []), /argument 1/);
});

test("a place is a plan, a diagram or a file of a project, or one of the window's pages, and nothing else", () => {
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', section: 'ledger' }), { kind: 'work', work: 'work-0001' }, 'sections are gone');
  assert.deepEqual(target({ kind: 'diagram', work: 'work-0001', path: null }), { kind: 'diagram', work: 'work-0001', path: null });
  assert.equal((target({ kind: 'diagram', work: 'work-0001', path: 'diagrams/order.puml', element: 'Order' }) as { element?: string }).element, 'Order');
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', anchor: 'provenance', view: 'ledger' }), { kind: 'work', work: 'work-0001', anchor: 'provenance' }, 'the ledger view is gone: a work item shows its plan');
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', view: 'statistics' }), { kind: 'work', work: 'work-0001', view: 'statistics' }, 'the statistics of a plan');
  assert.deepEqual(target({ kind: 'work', work: 'work-0001', anchor: null, step: 'Build the hub' }), { kind: 'work', work: 'work-0001', anchor: null, step: 'Build the hub' }, 'a plan with a ledger step the search found');
  assert.throws(() => target({ kind: 'work', work: 'work-0001', step: 'x'.repeat(513) }));
  for (const bad of [{ kind: 'project' }, { kind: 'view', view: 'work' }, { kind: 'diagram', work: 'work-0001', path: '../../planning.json' }, { kind: 'file', path: '../secret' }]) assert.throws(() => target(bad), JSON.stringify(bad));
  assert.deepEqual(place({ project, target: { kind: 'file', path: 'README.md' }, extra: 1 }), { project, target: { kind: 'file', path: 'README.md' } });
  assert.deepEqual(place({ page: 'hub', project: null }), { page: 'hub', project: null });
  assert.deepEqual(place({ page: 'hub', project }), { page: 'hub', project });
  assert.deepEqual(place({ page: 'statistics', project }), { page: 'statistics', project });
  assert.deepEqual(place({ page: 'projects', project }), { page: 'projects' });
  for (const bad of [{ page: 'project', project }, { page: 'hub', project: '../x' }, { page: 'hub' }, { project: '../x', target: { kind: 'file', path: 'a.md' } }, { project }, null]) assert.throws(() => place(bad), JSON.stringify(bad));
});

test('window state is checked deeply', () => {
  assert.deepEqual(uiState(defaultUiState), defaultUiState);
  const state = uiState({ place: { project, target: { kind: 'work', work: 'work-0001' } }, sidebar: { visible: false, width: 300 }, tabs: { items: [], active: null } });
  assert.deepEqual(state, { place: { project, target: { kind: 'work', work: 'work-0001' } } }, 'the sidebar and the tabs are gone');
  assert.throws(() => uiState({ tabs: { items: [], active: null } }), /place/);
  // The width of a diagram's details is kept when the reader chose one.
  assert.equal(uiState({ ...defaultUiState, inspectorWidth: 480 }).inspectorWidth, 480);
  assert.equal('inspectorWidth' in uiState(defaultUiState), false);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 20 }), /inspectorWidth/);
  assert.throws(() => uiState({ ...defaultUiState, inspectorWidth: 480.5 }), /inspectorWidth/);
});

test("a project's folder is a full path of the computer", () => {
  for (const good of ['C:\\Dev\\atlas-workspace', 'c:/dev/coord', '\\\\server\\share\\work', '/home/me/work']) assert.equal(folderPath(good), good);
  for (const bad of ['', 'relative/folder', 'C:relative', '..\\up', 'x'.repeat(5000), 'C:\\a\0b', 42, null]) assert.throws(() => folderPath(bad), ValidationError, String(bad));
});

test("a host's listing of its projects is taken only when it reads as one", () => {
  const listed = { folderId: project, name: 'Northwind', path: '/home/me/.atlas/planning/northwind', position: 0, state: 'active', folders: ['/home/me/work'], summary: null };
  assert.equal(isProjectListing([]), true);
  assert.equal(isProjectListing([listed, { ...listed, summary: undefined }]), true);
  for (const bad of [undefined, null, 'projects', { length: 1 }, [null], [{ ...listed, folderId: '../x' }], [{ ...listed, state: 'gone' }], [{ ...listed, folders: '/home/me/work' }], [{ ...listed, folders: [1] }], [{ ...listed, position: '0' }], [{ ...listed, summary: 'x' }]]) {
    assert.equal(isProjectListing(bad), false, JSON.stringify(bad));
  }
});
