// New projects: a planning folder made from the templates, as its own Git repository, covering the
// folders given; and changing the folders it covers. Each test runs Git.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlanning } from '../check/check.ts';
import { HomeDatabase } from '../home/database.ts';
import { createProject, readTemplates, setProjectFolders } from './project.ts';

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/planning');

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-project-')));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  return directory;
}

test('a project is made with its name and folders, and its folders change in place', async t => {
  const directory = temporary(t);
  const folder = path.join(directory, 'workspace'), more = path.join(directory, 'more');
  const database = HomeDatabase.open(path.join(directory, 'home'));
  try {
    const row = await createProject(database, { name: 'Shop', folders: [folder + path.sep, folder] }, await readTemplates(templates));
    const text = readFileSync(path.join(row.folder, 'planning.json'), 'utf8');
    assert.deepEqual(JSON.parse(text), { schema_version: 2, name: 'Shop', folders: [folder], work_items: [] });
    assert.deepEqual(validatePlanning(row.folder).errors, []);
    assert.match(execFileSync('git', ['-C', row.folder, 'log', '--format=%s'], { encoding: 'utf8' }), /^Create the Shop project\n$/);
    // A project may cover no folder yet; a second one of the same name gets a folder of its own.
    const empty = await createProject(database, { name: 'Shop' }, await readTemplates(templates));
    assert.equal(path.basename(empty.folder), 'shop-2');
    assert.deepEqual(JSON.parse(readFileSync(path.join(empty.folder, 'planning.json'), 'utf8')).folders, []);
    await assert.rejects(createProject(database, { name: 'Other', folders: ['relative'] }, await readTemplates(templates)), /absolute path/);

    // Another folder: the list grows in the file's own format.
    assert.deepEqual(await setProjectFolders(row.folder, [folder, more]), [folder, more]);
    assert.equal(readFileSync(path.join(row.folder, 'planning.json'), 'utf8'), text.replace(JSON.stringify(folder) + '\n', JSON.stringify(folder) + ',\n    ' + JSON.stringify(more) + '\n'));
    assert.deepEqual(await setProjectFolders(row.folder, []), []);
    assert.deepEqual(JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8')).folders, []);
    await assert.rejects(setProjectFolders(row.folder, ['relative']), /absolute path/);
    // A folder in another system's form (the planning folder shared with another computer) stays.
    const foreign = process.platform === 'win32' ? '/Users/someone/work' : 'C:\\work';
    const registry = JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8'));
    writeFileSync(path.join(row.folder, 'planning.json'), JSON.stringify({ ...registry, folders: [foreign] }, null, 2) + '\n');
    assert.deepEqual(await setProjectFolders(row.folder, [folder]), [folder]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(row.folder, 'planning.json'), 'utf8')).folders, [folder, foreign]);
  } finally { database.close(); }
});
