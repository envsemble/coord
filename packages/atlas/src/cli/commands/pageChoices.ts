// The PageChoices hook, run as the user sends a message: when a page of the session's project has
// saved choices since the session last heard (its `choices.json` changed), Atlas tells the agent,
// with the choices still open, so the agent can act on them and close each once it is settled.
// What a session has heard is kept in <home>/cache/page-choices/<session>.json: each choices file's
// time when it was told.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { choicesFile, listPages, pageFile, readPageFile } from '../../planning/pages/pages.ts';

export const pageChoicesFolder = (home: string) => path.join(home, 'cache', 'page-choices');
const shownLimit = 200;

interface Heard { [file: string]: number }
function readHeard(file: string): Heard | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Heard; } catch { return null; }
}
function writeHeard(file: string, heard: Heard) {
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(heard));
    renameSync(temporary, file);
  } catch { rmSync(temporary, { force: true }); }
}
/** A choice's value in a line: as JSON, cut short. */
function shown(value: unknown) {
  const text = JSON.stringify(value) ?? 'null';
  return text.length > shownLimit ? text.slice(0, shownLimit) + '…' : text;
}

/**
 * What to tell the agent about the open choices saved on the pages of the session's projects since
 * it last heard; null when there is nothing new. A session hears of open choices made before it
 * started, once.
 */
export async function pageChoicesNotice(input: { session_id?: unknown; cwd?: unknown }, home: string, sessionPattern: RegExp): Promise<string | null> {
  const session = typeof input.session_id === 'string' && sessionPattern.test(input.session_id) ? input.session_id : null;
  if (!session) return null;
  const { findPlanning } = await import('../../planning/projects/findProject.ts');
  const where = await findPlanning(typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd(), { home });
  const store = path.join(pageChoicesFolder(home), session + '.json');
  const heard = readHeard(store) ?? {};
  const next: Heard = {};
  const lines: string[] = [];
  for (const match of where.matches) {
    for (const work of match.work) {
      const location = work.path;
      for (const name of await listPages(path.join(match.planningFolder, ...location.split('/')))) {
        const file = path.join(match.planningFolder, ...location.split('/'), 'pages', name, choicesFile);
        const changed = statSync(file, { throwIfNoEntry: false })?.mtimeMs;
        if (changed === undefined) continue;
        next[file] = changed;
        if (heard[file] === changed) continue;
        let choices: Record<string, { value?: unknown; closed?: boolean }>;
        try { choices = JSON.parse(readFileSync(file, 'utf8')) as typeof choices; } catch { continue; }
        const open = Object.entries(choices ?? {}).filter(([, choice]) => choice && typeof choice === 'object' && !choice.closed);
        if (!open.length) continue;
        const asked = await readPageFile(path.dirname(file));
        lines.push(`- ${work.workId} ${work.title}, page ${name} (${file}): ${open.map(([key, choice]) => `${key} = ${shown(choice.value)}`).join('; ')}`
          + (asked.ok && asked.attention ? `. Its ${pageFile} still asks the user: ${asked.attention}` : ''));
      }
    }
  }
  writeHeard(store, { ...heard, ...next });
  if (!lines.length) return null;
  return ['The user made choices on pages Atlas shows:', ...lines,
    'Act on them as the work needs. Once a choice is settled, close it: set "closed": true on it in the page\'s choices.json (and a short "note" if the page should say why), so the page reads as decided. When nothing on a page waits on the user any more, clear "attention" in its page.json, so Atlas stops marking it.'].join('\n');
}
