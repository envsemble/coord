// Workspace folders: the Git checkouts a scan finds, and the projects made from them. Each test makes
// checkouts and asks Git about every one.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlanning } from '../check/check.ts';
import { HomeDatabase } from '../home/database.ts';
import { createProject, readTemplates, setProjectWorkspaces } from './project.ts';
import { scanWorkspace } from './workspaces.ts';
import { resolveReferences } from './references.ts';

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../plugin/skills/atlas/assets/planning');

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-workspaces-')));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Atlas Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true });
// Made once for the file: a checkout with one commit, which the others copy, and the workspace folder.
const shared = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-workspaces-')));
test.after(() => rmSync(shared, { recursive: true, force: true, maxRetries: 5 }));
const template = path.join(shared, 'template');
/** A Git checkout at `folder` with these remotes (name, URL) and one commit. */
function checkout(folder: string, remotes: [string, string][] = []) {
  if (!existsSync(template)) {
    mkdirSync(template);
    git(template, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(template, 'README.md'), '# Readme\n');
    git(template, 'add', '-A');
    git(template, 'commit', '-q', '-m', 'Start');
  }
  cpSync(template, folder, { recursive: true });
  appendFileSync(path.join(folder, '.git/config'), remotes.map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`).join(''));
  return folder;
}

/**
 * A workspace folder with two checkouts (one with two remotes, one with a credential in its remote), a
 * worktree of the first, a second clone of the second, one without a remote, a plain folder, and a
 * checkout one level too deep.
 */
function workspace() {
  const folder = path.join(shared, 'workspace');
  if (existsSync(folder)) return folder;
  checkout(path.join(folder, 'web'), [['upstream', 'https://github.com/upstream/forked.git'], ['origin', 'git@github.com:example/Shop-Web.git']]);
  checkout(path.join(folder, 'api'), [['origin', 'https://someone:token@gitlab.com/example/api']]);
  git(path.join(folder, 'web'), 'worktree', 'add', '-q', path.join(folder, 'aa-web-feature'), '-b', 'feature');
  checkout(path.join(folder, 'api-copy'), [['origin', 'https://GitLab.com/example/api.git']]);
  checkout(path.join(folder, 'scratch'));
  mkdirSync(path.join(folder, 'notes'));
  checkout(path.join(folder, 'notes', 'deep'), [['origin', 'https://github.com/example/deep.git']]);
  return folder;
}

test('a workspace folder\'s checkouts are the folder and the folders directly inside it, each repository once', async t => {
  const directory = temporary(t);
  const folder = workspace();
  assert.deepEqual(await scanWorkspace(folder), {
    folder,
    repositories: [
      { id: 'api', name: 'api', remote: 'https://gitlab.com/example/api' },
      { id: 'scratch', name: 'scratch', remote: null, path: path.join(folder, 'scratch') },
      { id: 'shop-web', name: 'web', remote: 'git@github.com:example/Shop-Web.git' },
    ],
    skipped: [],
  }, 'the remote origin names a repository, without credentials; a worktree and a second clone count as their repository; a checkout without a remote keeps its path; nothing deeper is found');
  // A checkout given itself is the one repository; a folder of plain folders has none.
  assert.deepEqual((await scanWorkspace(path.join(folder, 'api'))).repositories.map(item => item.id), ['api']);
  assert.deepEqual((await scanWorkspace(path.join(folder, 'notes'))).repositories.map(item => item.id), ['deep']);
  mkdirSync(path.join(directory, 'plain', 'folder'), { recursive: true });
  assert.deepEqual(await scanWorkspace(path.join(directory, 'plain')), { folder: path.join(directory, 'plain'), repositories: [], skipped: [] });
  // A folder Git does not answer for is skipped, and said so.
  mkdirSync(path.join(directory, 'plain', 'broken'));
  writeFileSync(path.join(directory, 'plain', 'broken', '.git'), 'gitdir: ' + path.join(directory, 'nowhere') + '\n');
  const broken = await scanWorkspace(path.join(directory, 'plain'));
  assert.deepEqual([broken.repositories, broken.skipped.map(item => item.folder)], [[], [path.join(directory, 'plain', 'broken')]]);
  assert.match(broken.skipped[0].reason, /not a git repository/i);
  // Repositories of one name from different places get IDs of their own.
  const twins = path.join(directory, 'twins');
  checkout(path.join(twins, 'a'), [['origin', 'https://github.com/one/site.git']]);
  checkout(path.join(twins, 'b'), [['origin', 'https://github.com/two/site.git']]);
  assert.deepEqual((await scanWorkspace(twins)).repositories.map(item => item.id), ['site', 'site-2']);
  // What cannot be scanned is refused, plainly.
  await assert.rejects(scanWorkspace(path.join(directory, 'missing')), /The folder .*missing does not exist\./);
  writeFileSync(path.join(directory, 'file.txt'), '');
  await assert.rejects(scanWorkspace(path.join(directory, 'file.txt')), /file\.txt is not a folder\./);
  await assert.rejects(scanWorkspace('relative/folder'), /absolute path/);
});

test('a project made from workspace folders registers their checkouts; changing its folders registers what new ones hold', async t => {
  const directory = temporary(t);
  const folder = workspace();
  const home = path.join(directory, 'home');
  const database = HomeDatabase.open(home);
  try {
    const row = await createProject(database, { name: 'Shop', workspaces: [folder + path.sep] }, await readTemplates(templates));
    const text = readFileSync(path.join(row.folder, 'planning.json'), 'utf8');
    assert.deepEqual(JSON.parse(text), {
      schema_version: 1, name: 'Shop', workspaces: [folder],
      repositories: [
        { id: 'api', name: 'api', remote: 'https://gitlab.com/example/api' },
        { id: 'scratch', name: 'scratch', path: path.join(folder, 'scratch') },
        { id: 'shop-web', name: 'web', remote: 'git@github.com:example/Shop-Web.git' },
      ],
      work_items: [],
    });
    assert.deepEqual(validatePlanning(row.folder).errors, []);
    await assert.rejects(createProject(database, { name: 'Gone', workspaces: [path.join(directory, 'missing')] }, await readTemplates(templates)), /does not exist/);

    // Another folder: its checkouts are added (the API again is not), the file keeps its format.
    const more = path.join(directory, 'more');
    checkout(path.join(more, 'mobile'), [['origin', 'https://github.com/example/mobile.git']]);
    checkout(path.join(more, 'api'), [['origin', 'git@gitlab.com:example/api.git']]);
    assert.deepEqual(await setProjectWorkspaces(row.folder, [folder, more]), { workspaces: [folder, more], added: [{ id: 'mobile', name: 'mobile', remote: 'https://github.com/example/mobile.git' }], skipped: [] });
    const changed = readFileSync(path.join(row.folder, 'planning.json'), 'utf8');
    assert.deepEqual(JSON.parse(changed).repositories.map((item: { id: string }) => item.id), ['api', 'scratch', 'shop-web', 'mobile']);
    assert.equal(changed, text.replace(JSON.stringify(folder) + '\n', JSON.stringify(folder) + ',\n    ' + JSON.stringify(more) + '\n')
      .replace('"git@github.com:example/Shop-Web.git"\n    }', '"git@github.com:example/Shop-Web.git"\n    },\n    {\n      "id": "mobile",\n      "name": "mobile",\n      "remote": "https://github.com/example/mobile.git"\n    }'));
    // Dropping a folder removes no repository; a folder covered before is not scanned again.
    rmSync(path.join(more, 'mobile'), { recursive: true, force: true });
    assert.deepEqual(await setProjectWorkspaces(row.folder, [more]), { workspaces: [more], added: [], skipped: [] });
    assert.deepEqual(JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8')).repositories.length, 4);
    await assert.rejects(setProjectWorkspaces(row.folder, ['relative']), /absolute path/);
  } finally { database.close(); }
});

test('repositories sent back from previews keep their paths and get IDs of their own', async t => {
  const directory = temporary(t);
  const one = path.join(directory, 'one'), two = path.join(directory, 'two');
  checkout(path.join(one, 'notes'));
  checkout(path.join(one, 'site'), [['origin', 'https://github.com/one/site.git']]);
  checkout(path.join(two, 'site'), [['origin', 'https://github.com/two/site.git']]);
  const database = HomeDatabase.open(path.join(directory, 'home'));
  try {
    // As the app sends them: each folder's preview, without the paths the contract leaves out.
    const previews = [...(await scanWorkspace(one)).repositories, ...(await scanWorkspace(two)).repositories].map(({ id, name, remote }) => ({ id, name, remote }));
    assert.deepEqual(previews.map(item => item.id), ['notes', 'site', 'site']);
    const row = await createProject(database, { name: 'Sites', workspaces: [one, two], repositories: previews }, await readTemplates(templates));
    assert.deepEqual(JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8')).repositories, [
      { id: 'notes', name: 'notes', path: path.join(one, 'notes') },
      { id: 'site', name: 'site', remote: 'https://github.com/one/site.git' },
      { id: 'site-2', name: 'site', remote: 'https://github.com/two/site.git' },
    ]);
    assert.deepEqual(row.skipped, []);
    // Repositories that are not what they claim are refused plainly, before anything reads them.
    for (const [repository, message] of [[{ id: 'a', name: 'A', remote: 5 }, /^Repository 1: its remote is not a Git remote\.$/], [{ id: 'a', name: 'A', remote: null, path: 7 }, /^Repository 1: its path is not an absolute path\.$/], [null, /^Repository 1: its ID must be/]] as const) {
      await assert.rejects(createProject(database, { name: 'Bad', workspaces: [one], repositories: [repository as never] }, await readTemplates(templates)), (error: Error) => error.name === 'WorkError' && message.test(error.message));
    }
  } finally { database.close(); }
});

test('setting workspace folders keeps work registered while the folders were scanned', async t => {
  const directory = temporary(t);
  const folder = workspace();
  const database = HomeDatabase.open(path.join(directory, 'home'));
  try {
    const row = await createProject(database, { name: 'Shop', workspaces: [], repositories: [{ id: 'shop', name: 'Shop', remote: 'https://github.com/example/shop.git' }] }, await readTemplates(templates));
    const { createWork } = await import('../work/work.ts');
    // Work registered while the folder is scanned (the scan runs Git for every checkout in it).
    const [set, created] = await Promise.allSettled([setProjectWorkspaces(row.folder, [folder]), createWork(row.folder, { title: 'Meanwhile', repositories: ['shop'] })]);
    const registry = JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8'));
    // Neither undid the other; one that would have was refused instead.
    if (set.status === 'fulfilled') assert.deepEqual(registry.workspaces, [folder]);
    else assert.match(String(set.reason), /changed meanwhile/);
    if (created.status === 'fulfilled') assert.deepEqual(registry.work_items.map((item: { id: string }) => item.id), ['work-0001']);
    else assert.match(String(created.reason), /changed meanwhile/);
    assert.ok(set.status === 'fulfilled' || created.status === 'fulfilled');
  } finally { database.close(); }
});

test('references lead to PRs, commits and files in the project\'s checkouts, the work item\'s repositories first', async t => {
  const directory = temporary(t);
  const workspace = path.join(directory, 'workspace');
  mkdirSync(workspace);
  const shop = checkout(path.join(workspace, 'shop'), [['origin', 'git@github.com:example/shop.git']]);
  const other = checkout(path.join(workspace, 'other'));
  mkdirSync(path.join(shop, 'src'));
  writeFileSync(path.join(shop, 'src', 'cart.ts'), 'export {};\n');
  git(shop, 'add', '-A');
  git(shop, 'commit', '-q', '-m', 'Add the cart');
  const hash = git(shop, 'rev-parse', 'HEAD').trim();
  writeFileSync(path.join(other, 'NOTES.md'), '# Notes\n');
  const root = path.join(directory, 'planning');
  mkdirSync(root);
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, workspaces: [workspace], repositories: [{ id: 'shop', name: 'Shop', remote: 'git@github.com:example/shop.git' }], work_items: [{ id: 'work-0001', path: 'active/0001-cart', repositories: ['shop'] }] }));
  const resolved = await resolveReferences(root, 'work-0001', [
    { kind: 'pull', repository: null, value: '22', line: null },
    { kind: 'commit', repository: null, value: hash.slice(0, 7), line: null },
    { kind: 'commit', repository: 'example/shop', value: hash, line: null },
    { kind: 'path', repository: null, value: 'src/cart.ts', line: 3 },
    { kind: 'path', repository: null, value: 'README.md', line: null },
    { kind: 'path', repository: null, value: 'NOTES.md', line: null },
    { kind: 'path', repository: null, value: '../planning/planning.json', line: null },
  ], { gh: false });
  const none = { url: null, file: null, repository: null, pull: null, title: null, choices: [] };
  assert.deepEqual(resolved, [
    { ...none, url: 'https://github.com/example/shop/pull/22', repository: 'shop' },
    // The template's first commit is in both checkouts; this one only in the shop's.
    { ...none, url: 'https://github.com/example/shop/commit/' + hash.slice(0, 7), repository: 'shop', title: 'Add the cart' },
    { ...none, url: 'https://github.com/example/shop/commit/' + hash, repository: 'shop', title: 'Add the cart' },
    { ...none, file: { path: path.join(shop, 'src', 'cart.ts'), line: 3 }, repository: 'shop' },
    { ...none, file: { path: path.join(shop, 'README.md'), line: null }, repository: 'shop' },
    { ...none, file: { path: path.join(other, 'NOTES.md'), line: null } },
    null,
  ]);
  // A commit both checkouts have: the work item's repository first, the other as a choice.
  const first = git(shop, 'rev-list', '--max-parents=0', 'HEAD').trim();
  const [shared] = await resolveReferences(root, 'work-0001', [{ kind: 'commit', repository: null, value: first, line: null }], { gh: false });
  assert.deepEqual([shared?.repository, shared?.choices], ['shop', [{ repository: 'other', url: null, title: 'Start' }]]);
  // A paired device gets nothing of this computer: no files, no repositories the project does not
  // register (so gh is never asked about them), no checkouts as choices.
  assert.deepEqual(await resolveReferences(root, 'work-0001', [
    { kind: 'pull', repository: 'someone/else', value: '1', line: null },
    { kind: 'path', repository: null, value: 'src/cart.ts', line: null },
    { kind: 'commit', repository: null, value: first, line: null },
  ], { gh: false, local: false }), [null, null, { ...none, url: 'https://github.com/example/shop/commit/' + first, repository: 'shop', title: 'Start' }]);
  // A link inside a checkout to a file outside it leads nowhere.
  const outside = path.join(directory, 'secret.txt');
  writeFileSync(outside, 'secret\n');
  try { symlinkSync(outside, path.join(other, 'secret.txt')); } catch { return t.diagnostic('Links cannot be made here; the containment is not tried.'); }
  assert.deepEqual(await resolveReferences(root, 'work-0001', [{ kind: 'path', repository: null, value: 'secret.txt', line: null }], { gh: false }), [null]);
});
