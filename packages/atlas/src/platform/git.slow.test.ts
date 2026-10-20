// A repository's HEAD read from its files gives what Git gives: through loose and packed branches,
// detached, and in a linked worktree, whose `.git` is a file. Runs Git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { headCommit, topLevel } from './git.ts';

test('HEAD comes from the repository\'s files as Git gives it, and the top level from Git', async t => {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-git-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repository'), linked = path.join(directory, 'linked');
  const git = (folder: string, ...args: string[]) => execFileSync('git', ['-C', folder, '-c', 'user.name=Atlas test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  assert.equal(await headCommit(root), null, 'no commit yet');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'First');
  const first = git(root, 'rev-parse', 'HEAD');
  assert.equal(await headCommit(root), first);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'Second');
  git(root, 'pack-refs', '--all');
  assert.equal(await headCommit(root), git(root, 'rev-parse', 'HEAD'), 'a packed branch');
  git(root, 'checkout', '-q', '--detach', first);
  assert.equal(await headCommit(root), first, 'detached');
  git(root, 'worktree', 'add', '-q', '-b', 'other', linked, 'main');
  git(linked, 'commit', '-q', '--allow-empty', '-m', 'Third');
  assert.equal(await headCommit(linked), git(linked, 'rev-parse', 'HEAD'), 'a linked worktree');
  assert.equal(path.resolve((await topLevel(root))!), root);
  assert.equal(await topLevel(directory), null, 'outside a repository');
});
