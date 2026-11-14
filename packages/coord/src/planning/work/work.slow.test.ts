// Finding a folder's planning folders in the home: by being in one of a project's folders, the
// deepest winning, or inside a planning folder. The planning folders are Git repositories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../../home/database.ts';
import { findPlanning, resolvePlanningFolder } from '../projects/findProject.ts';
import { acceptWork, startWork } from './work.ts';
import { plan, planningFolder, temporary, today } from '../testing.ts';

/** Set the folders a planning folder's project covers. */
function setFolders(root: string, folders: string[]) {
  const registry = JSON.parse(readFileSync(path.join(root, 'planning.json'), 'utf8'));
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ ...registry, folders }, null, 2) + '\n');
}

test('a folder finds its planning folders in the home: in one of their folders, or inside one', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  const root = planningFolder(path.join(home, 'planning'), 'main');
  const unrelated = planningFolder(path.join(home, 'planning'), 'unrelated');
  writeFileSync(path.join(unrelated, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'unrelated', folders: [path.join(directory, 'other')], work_items: [] }));
  const shop = path.join(directory, 'shop');
  mkdirSync(path.join(shop, 'src'), { recursive: true });
  setFolders(root, [shop]);
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  const where = await findPlanning(path.join(shop, 'src'), { home });
  assert.equal(where.cwd, realpathSync(path.join(shop, 'src')));
  assert.deepEqual(where.matches.map(match => [match.planningFolder, match.via]), [[root, ['folder']]]);
  assert.deepEqual(where.matches[0].work.map(item => [item.workId, item.title, item.designStatus, item.progress]), [['work-0001', 'Existing work', 'accepted', '0 of 1 step done · 1 left'], ['work-0002', 'Existing work', 'draft', 'No steps agreed yet']]);
  // Inside the planning folder: all of its active work.
  const inside = await findPlanning(path.join(root, 'active'), { home });
  assert.deepEqual(inside.matches.map(match => [match.via, match.work.map(item => item.workId)]), [[['inside'], ['work-0001', 'work-0002']]]);
  // Elsewhere, no project; every active project is listed in brief, wherever where is asked.
  const outside = await findPlanning(directory, { home });
  assert.deepEqual(outside.matches, []);
  assert.deepEqual(outside.projects.map(project => [project.project, project.planningFolder, project.folders, project.match, project.work!.map(item => [item.workId, item.title, item.designStatus, item.implementationStatus, item.progress])]), [
    ['Planning', root, [shop], false, [['work-0001', 'Existing work', 'accepted', 'in_progress', '0 of 1 step done · 1 left'], ['work-0002', 'Existing work', 'draft', 'not_started', 'No steps agreed yet']]],
    ['unrelated', unrelated, [path.join(directory, 'other')], false, []],
  ]);
  assert.ok(!('steps' in outside.projects[0].work![0]), 'the list stays compact: no steps');
  assert.deepEqual(where.projects.map(project => [project.project, project.match, 'work' in project]), [['Planning', true, false], ['unrelated', false, true]], "a matching project's work is listed once, in matches");
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), root);
  assert.equal(await resolvePlanningFolder({ planningFolder: root, home }), root);
  await assert.rejects(resolvePlanningFolder({ cwd: directory, home }), /No project in the Coord home .* covers/);
  // A second project covers the shop too: both are listed by name, and the tools need the one to plan in.
  writeFileSync(path.join(unrelated, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Harbor', folders: [shop], work_items: [] }));
  const several = await findPlanning(shop, { home });
  assert.deepEqual(several.matches.map(match => match.project), ['Planning', 'Harbor']);
  await assert.rejects(resolvePlanningFolder({ cwd: shop, home }), /Several projects cover this folder: Planning \(.*\), Harbor \(.*\)\. Ask the user which project to plan in/);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home, work: 'work-0001' }), root, 'a work item only one of them registers names its project');
  // Archived projects do not match; a folder without a project row is active.
  const harbor = realpathSync(unrelated);
  withDatabase(home, database => database.addProject(harbor, 'Harbor', null, 'archived'));
  assert.deepEqual((await findPlanning(shop, { home })).matches.map(match => match.project), ['Planning']);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), root);
  assert.deepEqual((await findPlanning(directory, { home })).projects.map(project => project.project), ['Planning'], 'archived projects are not listed');
  withDatabase(home, database => database.addProject(root, 'main', null, 'archived'));
  assert.deepEqual((await findPlanning(shop, { home })).matches, []);
  assert.deepEqual((await findPlanning(directory, { home })).projects, []);
  // A database this Coord cannot read is an error, not a home where every project matches.
  const raw = new DatabaseSync(path.join(home, 'coord.db'));
  raw.exec('PRAGMA user_version = 999');
  raw.close();
  await assert.rejects(findPlanning(shop, { home }), /schema version 999; this Coord uses version/);
});

test('a folder in a project\'s folder belongs to that project, the deepest folder winning', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home'), base = path.join(home, 'planning');
  const workspace = path.join(directory, 'workspace'), inner = path.join(workspace, 'inner');
  mkdirSync(path.join(inner, 'notes'), { recursive: true });
  // main covers no folder; Coord covers the workspace, Inner a folder in it.
  const root = planningFolder(base, 'main');
  setFolders(root, []);
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { summary: '"Carts that last. Planned, not started."' }));
  const project = (name: string, folders: string[]) => {
    const folder = path.join(base, name.toLowerCase());
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 2, name, folders, work_items: [] }));
    return realpathSync(folder);
  };
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  project('Coord', [caseless ? workspace.toUpperCase() : workspace]);
  project('Inner', [inner]);
  const shop = path.join(workspace, 'shop');
  mkdirSync(path.join(shop, 'src'), { recursive: true });
  const matched = (where: Awaited<ReturnType<typeof findPlanning>>) => where.matches.map(match => [match.project, match.via]);
  const inWorkspace = await findPlanning(path.join(shop, 'src'), { home });
  assert.deepEqual(matched(inWorkspace), [['Coord', ['folder']]]);
  assert.deepEqual(inWorkspace.projects.map(item => [item.project, item.folders.length, item.match]), [['Coord', 1, true], ['Inner', 1, false], ['Planning', 0, false]]);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), realpathSync(path.join(base, 'coord')));
  // The deepest folder wins.
  assert.deepEqual(matched(await findPlanning(path.join(inner, 'notes'), { home })), [['Inner', ['folder']]]);
  // Two projects covering the same folder both match.
  project('Other', [workspace]);
  assert.deepEqual(matched(await findPlanning(shop, { home })).map(([name]) => name), ['Coord', 'Other']);
  await assert.rejects(resolvePlanningFolder({ cwd: shop, home }), /Several projects/);
  // where's briefs carry each plan's summary.
  const outside = await findPlanning(directory, { home });
  assert.deepEqual(outside.matches, []);
  assert.deepEqual(outside.projects.find(item => item.project === 'Planning')!.work!.map(item => [item.workId, item.summary]), [['work-0001', 'Carts that last. Planned, not started.'], ['work-0002', null]]);
  // A broad folder around the home does not take a session inside another project's planning folder.
  project('Broad', [directory]);
  assert.deepEqual(matched(await findPlanning(path.join(root, 'active'), { home })), [['Planning', ['inside']]]);
  assert.equal((await findPlanning(path.join(root, 'active'), { home })).matches[0].work[0].summary, 'Carts that last. Planned, not started.');
  assert.deepEqual(matched(await findPlanning(path.join(directory, 'elsewhere-notes'), { home })).map(([name]) => name), ['Broad']);
});
