import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectPlanningRoot, RecentPlanningRoots } from './planningRoots.ts';

const registry = (work = 0) => JSON.stringify({ schema_version: 1, repositories: [], work_items: Array.from({ length: work }, (_, index) => ({ id: 'work-' + String(index + 1).padStart(4, '0'), path: 'active/' + index, repositories: [], current_plan: null })) });

async function workspace() {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'planning-roots-')));
  const current = path.join(temporary, 'planning'); await mkdir(current); await writeFile(path.join(current, 'planning.json'), registry(2));
  const demo = path.join(temporary, 'demo/planning'); await mkdir(demo, { recursive: true }); await writeFile(path.join(demo, 'planning.json'), registry(3));
  const tooDeep = path.join(temporary, 'a/b/planning'); await mkdir(tooDeep, { recursive: true }); await writeFile(path.join(tooDeep, 'planning.json'), registry());
  const hidden = path.join(temporary, '.hidden/planning'); await mkdir(hidden, { recursive: true }); await writeFile(path.join(hidden, 'planning.json'), registry());
  const future = path.join(temporary, 'future'); await mkdir(future); await writeFile(path.join(future, 'planning.json'), JSON.stringify({ schema_version: 2, repositories: [], work_items: [] }));
  const broken = path.join(temporary, 'broken'); await mkdir(broken); await writeFile(path.join(broken, 'planning.json'), '{');
  return { temporary, current, demo, future, broken };
}

test('planning folders are validated before opening', async () => {
  const { temporary, current, demo, future, broken } = await workspace();
  try {
    assert.deepEqual(await inspectPlanningRoot(demo), { path: demo, name: 'planning', parent: path.dirname(demo), workItems: 3 });
    assert.equal((await inspectPlanningRoot('"' + current + '"')).path, current, 'pasted quoted paths are accepted');
    await assert.rejects(inspectPlanningRoot('planning'), /absolute path/);
    await assert.rejects(inspectPlanningRoot('../planning'), /absolute path/);
    await assert.rejects(inspectPlanningRoot(''), /full path/);
    await assert.rejects(inspectPlanningRoot(42), /full path/);
    await assert.rejects(inspectPlanningRoot(current + '\0'), /full path/);
    await assert.rejects(inspectPlanningRoot(path.join(temporary, 'missing')), /does not exist/);
    await assert.rejects(inspectPlanningRoot(path.join(current, 'planning.json')), /not a file/);
    await assert.rejects(inspectPlanningRoot(temporary), /no readable planning.json/);
    await assert.rejects(inspectPlanningRoot(broken), /no readable planning.json/);
    await assert.rejects(inspectPlanningRoot(future), /schema version 1/);
  } finally { await rm(temporary, { recursive: true }); }
});

test('recent folders persist outside planning and can be forgotten', async () => {
  const { temporary, current, demo } = await workspace();
  try {
    const recents = new RecentPlanningRoots(path.join(temporary, 'cache/planning-roots.json'));
    assert.deepEqual(await recents.list(), []);
    await recents.remember(current); await recents.remember(demo); await recents.remember(current);
    assert.deepEqual(await recents.list(), [current, demo]);
    for (let index = 0; index < 12; index++) await recents.remember(path.join(temporary, 'other-' + index));
    assert.equal((await recents.list()).length, 8);
    const [first, second] = await recents.list();
    assert.deepEqual((await recents.forget(first)).slice(0, 1), [second]);
    assert.deepEqual(await recents.clear(), []);
    await writeFile(path.join(temporary, 'cache/planning-roots.json'), '{"recent": ["relative/path", 5]}');
    assert.deepEqual(await recents.list(), []);
  } finally { await rm(temporary, { recursive: true }); }
});
