import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atlasHome, electronDataDirectory, homePlanningFolders, prepareHome } from '../../home/home.ts';

test('the Atlas home is ~/.atlas unless overridden, and Electron\'s folder follows the per-user convention', () => {
  const home = path.resolve('/home/someone');
  assert.equal(atlasHome(undefined, {}, home), path.join(home, '.atlas'));
  assert.equal(atlasHome(undefined, { ATLAS_HOME: path.resolve('/elsewhere') }, home), path.resolve('/elsewhere'));
  assert.equal(atlasHome('~/explicit', { ATLAS_HOME: path.resolve('/elsewhere') }, home), path.join(home, 'explicit'), 'an explicit --home wins over ATLAS_HOME');
  assert.equal(electronDataDirectory({ APPDATA: path.resolve('/roaming') }, 'win32', home), path.join(path.resolve('/roaming'), 'Atlas'));
  assert.equal(electronDataDirectory({}, 'win32', home), path.join(home, 'AppData', 'Roaming', 'Atlas'));
  assert.equal(electronDataDirectory({}, 'linux', home), path.join(home, '.config', 'Atlas'));
  assert.equal(electronDataDirectory({ XDG_CONFIG_HOME: path.resolve('/xdg') }, 'linux', home), path.join(path.resolve('/xdg'), 'Atlas'));
  assert.equal(electronDataDirectory({ XDG_CONFIG_HOME: 'relative/config' }, 'linux', home), path.join(home, '.config', 'Atlas'), 'a relative XDG_CONFIG_HOME is ignored');
  assert.equal(electronDataDirectory({}, 'darwin', home), path.join(home, 'Library', 'Application Support', 'Atlas'));
});

test('preparing the home makes it and its planning folder, whose folders with a planning.json are its projects', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas-home-')));
  try {
    const user = path.join(temporary, 'user'), home = path.join(user, '.atlas');
    assert.equal((await prepareHome({ environment: {}, home: user })).home, home);
    assert.ok(existsSync(path.join(home, 'planning')), 'the home and its planning folder are created');
    await mkdir(path.join(home, 'planning', 'one'), { recursive: true });
    await writeFile(path.join(home, 'planning', 'one', 'planning.json'), '{}');
    await mkdir(path.join(home, 'planning', 'not-planning'), { recursive: true });
    assert.deepEqual(await homePlanningFolders(home), [path.join(home, 'planning', 'one')]);
  } finally { await rm(temporary, { recursive: true }); }
});

test('~\\ starts a home path on Windows, as ~/ does everywhere', { skip: process.platform !== 'win32' }, () => {
  const home = path.resolve('/home/someone');
  assert.equal(atlasHome(undefined, { ATLAS_HOME: '~\\atlas' }, home), path.join(home, 'atlas'));
  assert.equal(atlasHome(undefined, { ATLAS_HOME: '~/atlas' }, home), path.join(home, 'atlas'));
});
