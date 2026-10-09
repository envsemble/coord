import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { packCommittedAtlas } from './package-atlas.mjs';
test('vendor tarball pins committed content despite hidden working-tree edits and replacement refs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atlas-vendor-test-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('remote', 'add', 'origin', 'https://example.invalid/atlas.git');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ontouml-atlas', version: '0.1.0', files: ['README.md', 'dist'] }));
    mkdirSync(path.join(root, 'dist')); writeFileSync(path.join(root, 'dist/index.js'), 'export const value = 1;');
    writeFileSync(path.join(root, 'README.md'), 'COMMITTED CONTENT'); git('add', '.'); git('commit', '-m', 'Original'); const original = git('rev-parse', 'HEAD');
    writeFileSync(path.join(root, 'README.md'), 'REPLACEMENT CONTENT'); git('add', '.'); git('commit', '-m', 'Replacement'); const replacement = git('rev-parse', 'HEAD');
    git('reset', '--hard', original); git('replace', original, replacement);
    git('update-index', '--assume-unchanged', 'README.md'); writeFileSync(path.join(root, 'README.md'), 'HIDDEN WORKTREE CONTENT');
    const result = packCommittedAtlas(root);
    const tar = gunzipSync(result.content).toString();
    assert.equal(result.commit, original); assert.match(tar, /COMMITTED CONTENT/);
    assert.doesNotMatch(tar, /HIDDEN WORKTREE CONTENT|REPLACEMENT CONTENT/);
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), 'HIDDEN WORKTREE CONTENT');
  } finally { assert.equal(path.dirname(realpathSync(root)), realpathSync(os.tmpdir())); rmSync(root, { recursive: true, force: true }); }
});
