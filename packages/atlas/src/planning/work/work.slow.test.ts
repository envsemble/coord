// Finding a checkout's planning folders in the home: by remote, by path hint, from inside, and by
// workspace folder. Each test makes several Git checkouts and asks Git about them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { withDatabase } from '../home/database.ts';
import { findPlanning, resolvePlanningFolder } from '../projects/resolve.ts';
import { acceptWork, startWork } from './work.ts';
import { git, plan, planningFolder, temporary, today } from '../testing/testing.ts';

test('a checkout finds its planning folders in the home by remote, by path hint, and from inside', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home');
  const root = planningFolder(path.join(home, 'planning'), 'main');
  planningFolder(path.join(home, 'planning'), 'unrelated').toString();
  writeFileSync(path.join(home, 'planning', 'unrelated', 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'x', name: 'X', remote: 'https://github.com/example/other' }], work_items: [] }));
  const shop = path.join(directory, 'shop');
  mkdirSync(shop);
  git(shop, 'init', '-q');
  git(shop, 'remote', 'add', 'origin', 'https://someone:secret-token@github.com/example/shop.git');
  mkdirSync(path.join(shop, 'src'));
  await acceptWork(root, 'work-0001', today);
  await startWork(root, 'work-0001', { steps: ['Build'] }, today);
  const where = await findPlanning(path.join(shop, 'src'), { home });
  assert.equal(where.checkout, realpathSync(shop));
  assert.deepEqual(where.remotes, ['https://github.com/example/shop.git'], 'credentials in a remote are never shown');
  assert.deepEqual(where.matches.map(match => [match.planningFolder, match.via, match.repositories]), [[root, ['remote'], ['shop']]]);
  assert.deepEqual(where.matches[0].work.map(item => [item.workId, item.title, item.designStatus, item.progress]), [['work-0001', 'Existing work', 'accepted', '0 of 1 step done · 1 left']]);
  // A repository without a remote matches by its absolute path hint.
  const tools = path.join(home, 'planning', 'tools'); // the fixture's absolute hint
  mkdirSync(tools);
  git(tools, 'init', '-q');
  const byPath = await findPlanning(tools, { home });
  assert.deepEqual(byPath.matches.map(match => [match.via, match.repositories, match.work.map(item => item.workId)]), [[['path'], ['tools'], ['work-0002']]]);
  // Inside the planning folder: its own repository and all of its active work.
  const inside = await findPlanning(path.join(root, 'active'), { home });
  assert.deepEqual(inside.matches.map(match => [match.via, match.repositories, match.work.map(item => item.workId)]), [[['inside'], ['planning'], []]]);
  const outside = await findPlanning(directory, { home });
  assert.deepEqual(outside.matches, []);
  // Every active project is listed in brief, wherever where is asked: outside a Git checkout too.
  assert.equal(outside.checkout, null);
  const unrelated = path.join(home, 'planning', 'unrelated');
  assert.deepEqual(outside.projects.map(project => [project.project, project.planningFolder, project.repositories, project.match, project.work.map(item => [item.workId, item.title, item.designStatus, item.implementationStatus, item.progress])]), [
    ['main', root, ['planning', 'shop', 'tools'], false, [['work-0001', 'Existing work', 'accepted', 'in_progress', '0 of 1 step done · 1 left'], ['work-0002', 'Existing work', 'draft', 'not_started', null]]],
    ['unrelated', unrelated, ['x'], false, []],
  ]);
  assert.ok(!('steps' in outside.projects[0].work[0]), 'the list stays compact: no steps');
  // A checkout whose remote no project registers gets the same list; a matching one is marked.
  const stranger = path.join(directory, 'stranger');
  mkdirSync(stranger);
  git(stranger, 'init', '-q');
  git(stranger, 'remote', 'add', 'origin', 'https://github.com/example/nobody.git');
  const unmatched = await findPlanning(stranger, { home });
  assert.deepEqual([unmatched.checkout, unmatched.matches, unmatched.projects.map(project => [project.project, project.match])], [stranger, [], [['main', false], ['unrelated', false]]]);
  assert.deepEqual(where.projects.map(project => [project.project, project.match]), [['main', true], ['unrelated', false]]);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), root);
  assert.equal(await resolvePlanningFolder({ planningFolder: root, home }), root);
  await assert.rejects(resolvePlanningFolder({ cwd: directory, home }), /No planning folder in the Atlas home/);
  // A second project registers the shop too: both are listed by name, and the tools need the one to plan in.
  writeFileSync(path.join(home, 'planning', 'unrelated', 'planning.json'), JSON.stringify({ schema_version: 1, name: 'Coord', repositories: [{ id: 'shop', name: 'Shop', remote: 'https://github.com/example/shop' }], work_items: [] }));
  const several = await findPlanning(shop, { home });
  assert.deepEqual(several.matches.map(match => match.project), ['main', 'Coord']);
  await assert.rejects(resolvePlanningFolder({ cwd: shop, home }), /Several projects register this checkout's repository: main \(.*\), Coord \(.*\)\. Ask the user which project to plan in/);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home, work: 'work-0001' }), root, 'a work item only one of them registers names its project');
  // Hidden and archived projects do not match; a folder without a project row is active.
  const coord = realpathSync(path.join(home, 'planning', 'unrelated'));
  withDatabase(home, database => database.addProject(coord, 'Coord', null, 'archived'));
  assert.deepEqual((await findPlanning(shop, { home })).matches.map(match => match.project), ['main']);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), root);
  withDatabase(home, database => database.updateProject(database.projectByFolder(coord)!.id, { state: 'hidden' }));
  assert.deepEqual((await findPlanning(shop, { home })).matches.map(match => match.project), ['main']);
  assert.deepEqual((await findPlanning(directory, { home })).projects.map(project => project.project), ['main'], 'hidden and archived projects are not listed');
  withDatabase(home, database => database.addProject(root, 'main', null, 'hidden'));
  assert.deepEqual((await findPlanning(shop, { home })).matches, []);
  assert.deepEqual((await findPlanning(directory, { home })).projects, []);
  // A database this Atlas cannot read is an error, not a home where every project matches.
  const raw = new DatabaseSync(path.join(home, 'atlas.db'));
  raw.exec('PRAGMA user_version = 999');
  raw.close();
  await assert.rejects(findPlanning(shop, { home }), /schema version 999, newer than this Atlas knows/);
});

test('a folder in a project\'s workspace folder belongs to that project alone, the deepest one winning', async t => {
  const directory = temporary(t);
  const home = path.join(directory, 'home'), base = path.join(home, 'planning');
  const workspace = path.join(directory, 'workspace'), inner = path.join(workspace, 'inner');
  mkdirSync(path.join(inner, 'notes'), { recursive: true });
  // main registers the shop by its remote; Atlas covers the workspace, Inner a folder in it; each registers the shop too.
  const root = planningFolder(base, 'main');
  writeFileSync(path.join(root, 'active/0001-existing/plan.md'), plan('work-0001', { summary: '"Carts that last. Planned, not started."' }));
  const project = (name: string, workspaces: string[]) => {
    const folder = path.join(base, name.toLowerCase());
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, name, workspaces, repositories: [{ id: 'shop', name: 'Shop', remote: 'https://github.com/example/shop.git' }], work_items: [] }));
    return realpathSync(folder);
  };
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  project('Atlas', [caseless ? workspace.toUpperCase() : workspace]);
  project('Inner', [inner]);
  const shop = path.join(workspace, 'shop');
  mkdirSync(path.join(shop, 'src'), { recursive: true });
  git(shop, 'init', '-q');
  git(shop, 'remote', 'add', 'origin', 'git@github.com:example/shop.git');
  const matched = (where: Awaited<ReturnType<typeof findPlanning>>) => where.matches.map(match => [match.project, match.via, match.repositories]);
  // In the workspace: Atlas alone, though main and Inner register the checkout's remote too.
  const inWorkspace = await findPlanning(path.join(shop, 'src'), { home });
  assert.deepEqual(matched(inWorkspace), [['Atlas', ['workspace', 'remote'], ['shop']]]);
  assert.deepEqual(inWorkspace.projects.map(item => [item.project, item.workspaces.length, item.match]), [['Atlas', 1, true], ['Inner', 1, false], ['main', 0, false]]);
  assert.equal(await resolvePlanningFolder({ cwd: shop, home }), realpathSync(path.join(base, 'atlas')));
  // The deepest workspace folder wins; outside any Git checkout too.
  const deeper = await findPlanning(path.join(inner, 'notes'), { home });
  assert.deepEqual([deeper.checkout, matched(deeper)], [null, [['Inner', ['workspace'], []]]]);
  // Two projects covering the same folder both match, as remotes several projects register do.
  project('Other', [workspace]);
  assert.deepEqual(matched(await findPlanning(shop, { home })).map(([name]) => name), ['Atlas', 'Other']);
  await assert.rejects(resolvePlanningFolder({ cwd: shop, home }), /Several projects/);
  // Outside every workspace folder, matching is as before: by remote.
  const elsewhere = path.join(directory, 'shop');
  mkdirSync(elsewhere);
  git(elsewhere, 'init', '-q');
  git(elsewhere, 'remote', 'add', 'origin', 'https://github.com/example/shop');
  const outside = await findPlanning(elsewhere, { home });
  assert.deepEqual(matched(outside), [['Atlas', ['remote'], ['shop']], ['Inner', ['remote'], ['shop']], ['main', ['remote'], ['shop']], ['Other', ['remote'], ['shop']]]);
  // where's briefs carry each plan's summary.
  assert.deepEqual(outside.projects.find(item => item.project === 'main')!.work.map(item => [item.workId, item.summary]), [['work-0001', 'Carts that last. Planned, not started.'], ['work-0002', null]]);
  assert.equal(outside.matches.find(item => item.project === 'main')!.work[0].summary, 'Carts that last. Planned, not started.');
  // A broad workspace folder around the home does not take a session inside another project's planning folder.
  project('Broad', [directory]);
  assert.deepEqual(matched(await findPlanning(path.join(root, 'active'), { home })), [['main', ['inside'], ['planning']]]);
  assert.deepEqual(matched(await findPlanning(path.join(directory, 'elsewhere-notes'), { home })).map(([name]) => name), ['Broad']);
});