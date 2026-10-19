// Which repositories a paired device may have `gh` asked about: those checked out in the project's
// folders, by their GitHub remotes. Runs Git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkedOutRepositories } from './references.ts';

test('a paired device has gh asked only about the GitHub repositories checked out in the project\'s folders', async t => {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-checkouts-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  const checkout = (name: string, remotes: Record<string, string>) => {
    const folder = path.join(workspace, name);
    mkdirSync(folder, { recursive: true });
    execFileSync('git', ['init', '-q', folder]);
    for (const [remote, url] of Object.entries(remotes)) execFileSync('git', ['-C', folder, 'remote', 'add', remote, url]);
  };
  checkout('shop', { origin: 'git@github.com:Example/Shop.git', fork: 'https://github.com/someone/shop' });
  checkout('tools', { origin: 'https://gitlab.com/acme/tools.git' });
  mkdirSync(path.join(workspace, 'notes'));
  const root = path.join(directory, 'planning');
  mkdirSync(root);
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Shop', folders: [workspace], work_items: [] }));
  assert.deepEqual([...await checkedOutRepositories(root)].sort(), ['example/shop', 'someone/shop']);
});
