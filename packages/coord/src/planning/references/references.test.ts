// Where references lead: owner/repo PRs and commits to GitHub, without knowing the repository, and
// paths to files in the project's folders. `gh` is not asked.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveReferences } from './references.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'coord-references-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('references lead to GitHub by the owner/repo they name, and paths to files in the project\'s folders', async t => {
  const directory = temporary(t);
  const workspace = path.join(directory, 'workspace'), shop = path.join(workspace, 'shop'), other = path.join(workspace, 'other');
  mkdirSync(path.join(shop, 'src'), { recursive: true });
  mkdirSync(other);
  writeFileSync(path.join(shop, 'src', 'cart.ts'), 'export {};\n');
  writeFileSync(path.join(other, 'NOTES.md'), '# Notes\n');
  writeFileSync(path.join(workspace, 'README.md'), '# Workspace\n');
  const root = path.join(directory, 'planning');
  mkdirSync(root);
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 3, name: 'Shop', folders: [workspace], work_items: [] }));
  const hash = '4ab195a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
  const none = { url: null, file: null, repository: null, pull: null, title: null };
  assert.deepEqual(await resolveReferences(root, [
    { kind: 'pull', repository: 'example/shop', value: '22', line: null },
    { kind: 'commit', repository: 'example/shop', value: hash.slice(0, 7), line: null },
    // Short forms name no repository Coord could know.
    { kind: 'pull', repository: 'shop', value: '22', line: null },
    { kind: 'pull', repository: null, value: '22', line: null },
    { kind: 'commit', repository: null, value: hash, line: null },
    { kind: 'path', repository: null, value: 'README.md', line: null },
    { kind: 'path', repository: null, value: 'src/cart.ts', line: 3 },
    { kind: 'path', repository: null, value: 'NOTES.md', line: null },
    { kind: 'path', repository: null, value: '../planning/planning.json', line: null },
  ], { gh: false }), [
    { ...none, url: 'https://github.com/example/shop/pull/22', repository: 'example/shop' },
    { ...none, url: 'https://github.com/example/shop/commit/' + hash.slice(0, 7), repository: 'example/shop' },
    null, null, null,
    { ...none, file: { path: path.join(workspace, 'README.md'), line: null } },
    { ...none, file: { path: path.join(shop, 'src', 'cart.ts'), line: 3 } },
    { ...none, file: { path: path.join(other, 'NOTES.md'), line: null } },
    null,
  ]);
  // A paired device gets nothing of this computer: no files.
  assert.deepEqual(await resolveReferences(root, [
    { kind: 'pull', repository: 'someone/else', value: '1', line: null },
    { kind: 'path', repository: null, value: 'src/cart.ts', line: null },
  ], { gh: false, local: false }), [{ ...none, url: 'https://github.com/someone/else/pull/1', repository: 'someone/else' }, null]);
  // A link inside a folder to a file outside it leads nowhere.
  const outside = path.join(directory, 'secret.txt');
  writeFileSync(outside, 'secret\n');
  try { symlinkSync(outside, path.join(other, 'secret.txt')); } catch { return t.diagnostic('Links cannot be made here; the containment is not tried.'); }
  assert.deepEqual(await resolveReferences(root, [{ kind: 'path', repository: null, value: 'secret.txt', line: null }], { gh: false }), [null]);
});
