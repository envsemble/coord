import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coordHome, electronDataDirectory, homePlanningFolders, prepareHome } from '../../home/home.ts';

test('the Coord home is ~/.coord unless overridden, and Electron\'s folder follows the per-user convention', () => {
  const home = path.resolve('/home/someone');
  assert.equal(coordHome(undefined, {}, home), path.join(home, '.coord'));
  assert.equal(coordHome(undefined, { COORD_HOME: path.resolve('/elsewhere') }, home), path.resolve('/elsewhere'));
  assert.equal(coordHome('~/explicit', { COORD_HOME: path.resolve('/elsewhere') }, home), path.join(home, 'explicit'), 'an explicit --home wins over COORD_HOME');
  assert.equal(electronDataDirectory({ APPDATA: path.resolve('/roaming') }, 'win32', home), path.join(path.resolve('/roaming'), 'Coord'));
  assert.equal(electronDataDirectory({}, 'win32', home), path.join(home, 'AppData', 'Roaming', 'Coord'));
  assert.equal(electronDataDirectory({}, 'linux', home), path.join(home, '.config', 'Coord'));
  assert.equal(electronDataDirectory({ XDG_CONFIG_HOME: path.resolve('/xdg') }, 'linux', home), path.join(path.resolve('/xdg'), 'Coord'));
  assert.equal(electronDataDirectory({ XDG_CONFIG_HOME: 'relative/config' }, 'linux', home), path.join(home, '.config', 'Coord'), 'a relative XDG_CONFIG_HOME is ignored');
  assert.equal(electronDataDirectory({}, 'darwin', home), path.join(home, 'Library', 'Application Support', 'Coord'));
});

test('preparing the home makes it and its planning folder, whose folders with a planning.json are its projects', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'coord-home-')));
  try {
    const user = path.join(temporary, 'user'), home = path.join(user, '.coord');
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
  assert.equal(coordHome(undefined, { COORD_HOME: '~\\coord' }, home), path.join(home, 'coord'));
  assert.equal(coordHome(undefined, { COORD_HOME: '~/coord' }, home), path.join(home, 'coord'));
});
