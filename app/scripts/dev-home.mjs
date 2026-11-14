// Coord Dev's copy of the user's Coord data (~/.coord into ~/.coord-dev, scripts/dev.mjs): the
// planning folders and the home database, so Coord Dev works on real plans without writing them.
// The database is copied by SQLite itself (VACUUM INTO), whole and consistent while the real Coord
// runs. In the copy, projects whose planning folder is in the real home point at the copied one
// (any elsewhere are read where they are), remote access is off, no paired device can reach it and
// it reaches no paired computer, and the onboarding counts as done (Coord Dev connects its agents
// itself).
// Coord Dev's own files stay: its agent folder (the dev plugin, its dev sessions), its Electron
// folder and its logs. Nothing here runs in a release.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const caseless = process.platform === 'win32' || process.platform === 'darwin';
const key = (/** @type {string} */ value) => caseless ? value.toLowerCase() : value;

/**
 * Copy the Coord home `real` into `copy`, replacing the copy's planning folders and database.
 * @param {string} real
 * @param {string} copy
 * @returns {{ projects: number; empty: boolean }}
 */
export function copyRealData(real, copy) {
  mkdirSync(copy, { recursive: true });
  // Coord Dev connects its agents itself (main/dev.ts): its onboarding has nothing to offer.
  const onboarding = path.join(copy, 'agent', 'onboarding.json');
  if (!existsSync(onboarding)) {
    mkdirSync(path.dirname(onboarding), { recursive: true });
    writeFileSync(onboarding, JSON.stringify({ done: true }) + '\n');
  }
  // What belongs to the previous copy's data: its sessions' hook stamps go with its database.
  for (const name of ['planning', 'session-state']) rmSync(path.join(copy, name), { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm', '.copy']) rmSync(path.join(copy, 'coord.db' + suffix), { force: true });
  if (!existsSync(path.join(real, 'coord.db'))) return { projects: 0, empty: true };

  if (existsSync(path.join(real, 'planning'))) cpSync(path.join(real, 'planning'), path.join(copy, 'planning'), { recursive: true });
  const temporary = path.join(copy, 'coord.db.copy');
  const source = new DatabaseSync(path.join(real, 'coord.db'), { readOnly: true });
  try { source.exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`); } finally { source.close(); }
  renameSync(temporary, path.join(copy, 'coord.db'));

  const database = new DatabaseSync(path.join(copy, 'coord.db'));
  let projects = 0;
  try {
    const from = path.join(real, 'planning'), to = path.join(copy, 'planning');
    const move = database.prepare('UPDATE project SET folder = ? WHERE id = ?');
    for (const row of database.prepare('SELECT id, folder FROM project WHERE computer_id IS NULL').all()) {
      const folder = String(row.folder);
      if (key(folder) !== key(from) && !key(folder).startsWith(key(from) + path.sep)) continue;
      move.run(to + folder.slice(from.length), row.id);
      projects++;
    }
    const network = database.prepare("SELECT value FROM setting WHERE key = 'host.network'").get();
    if (network) {
      const value = JSON.parse(String(network.value));
      value.enabled = false;
      database.prepare("UPDATE setting SET value = ? WHERE key = 'host.network'").run(JSON.stringify(value));
    }
    // Neither way between computers: no device of the user's reaches the copy, and the copy
    // reaches none of their other computers as the real Coord (their projects and places go too).
    database.exec('PRAGMA foreign_keys = ON; DELETE FROM device; DELETE FROM project WHERE computer_id IS NOT NULL; DELETE FROM paired_computer;');
  } finally { database.close(); }
  return { projects, empty: false };
}
