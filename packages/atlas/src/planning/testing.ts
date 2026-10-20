// Shared by the tests of a module and of its slow tier: an empty planning folder for the reader, and
// a planning folder in a Git repository for the work tools.
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Document } from './types.ts';
import { planningLedger } from './work/work.ts';

// ---------------------------------------------------------------------------
// The reader's tests (planningIndex.test.ts)

/** An empty planning folder in a temporary folder, removed by `cleanup`. */
export async function readerFixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'planning-reader-'));
  const root = path.join(temporary, 'planning');
  await mkdir(root);
  return { root, temporary, cleanup: async () => {
    const actual = await realpath(temporary);
    assert.equal(path.dirname(actual), await realpath(tmpdir()));
    assert.ok(path.basename(actual).startsWith('planning-reader-'));
    await rm(actual, { recursive: true });
  } };
}
export function header(id: string, design: string, implementation: string, completed: string | null = null) {
  return ['---', 'schema_version: 2', 'kind: plan', 'id: ' + id, 'title: Example work', 'created: null', 'updated: "2026-10-06"', 'design_status: ' + design, 'implementation_status: ' + implementation, 'accepted_at: null', 'completed_at: ' + (completed ? '"' + completed + '"' : 'null'), 'supersedes: []', 'superseded_by: null', '---', '# Original plan', '', 'Preserve this body.', ''].join('\n');
}
export const relativeDocumentPath = (file: Document) => file.workId ? file.key.slice(file.workId.length + 1) : file.path;

// ---------------------------------------------------------------------------
// The work tools' tests (work.test.ts)

export const today = { today: '2026-10-14' };
export const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Atlas Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', windowsHide: true });

export function temporary(t: TestContext) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'atlas-work-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
export function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }
export const read = (root: string, relative: string) => readFileSync(path.join(root, relative), 'utf8');
export function plan(id: string, fields: Record<string, string> = {}) {
  const values: Record<string, string> = { title: '"Existing work"', created: '"2026-10-01"', updated: '"2026-10-02"', design_status: 'draft', implementation_status: 'not_started', accepted_at: 'null', completed_at: 'null', ...fields };
  return ['---', 'schema_version: 2', 'kind: plan', 'id: ' + id, ...Object.entries(values).map(([key, value]) => key + ': ' + value), 'supersedes: []', 'superseded_by: null', '---', '', '# Existing work', '', 'See [the other work](../0002-other/plan.md) and [the glossary](../../notes/glossary.md).', ''].join('\n');
}
const registry = (directory: string) => JSON.stringify({ schema_version: 2, name: 'Planning', folders: [path.join(directory, 'shop')], work_items: [
  { id: 'work-0001', path: 'active/0001-existing', current_plan: 'active/0001-existing/plan.md' },
  { id: 'work-0002', path: 'active/0002-other', current_plan: 'active/0002-other/plan.md' },
] }, null, 2) + '\n';
// The planning folder and its first commit are made once; each test works on a copy.
let template: string | undefined;
/** A planning folder in a Git repository with work-0001 and work-0002 (drafts, their ledgers without steps) and an unregistered folder 0003. */
export function planningFolder(directory: string, name = 'planning') {
  if (!template) {
    const shared = realpathSync(mkdtempSync(path.join(tmpdir(), 'atlas-work-')));
    process.once('exit', () => rmSync(shared, { recursive: true, force: true }));
    template = path.join(shared, 'planning');
    write(path.join(template, 'planning.json'), registry(shared));
    write(path.join(template, 'active/0001-existing/plan.md'), plan('work-0001'));
    write(path.join(template, 'active/0002-other/plan.md'), plan('work-0002').replace('[the other work](../0002-other/plan.md)', '[the first](../0001-existing/plan.md#why)'));
    for (const [id, folder] of [['work-0001', '0001-existing'], ['work-0002', '0002-other']]) write(path.join(template, 'active', folder, 'ledger.md'), planningLedger(id, '2026-10-01', []));
    write(path.join(template, 'active/0003-unregistered/notes.md'), '# Notes\n');
    write(path.join(template, 'notes/glossary.md'), '# Glossary\n');
    write(path.join(template, 'README.md'), '# Planning\n\n- [Existing](active/0001-existing/plan.md)\n- [Ledger][ledger]\n\n[ledger]: <active/0001-existing/ledger.md>\n\n```\n[not a link](active/0001-existing/plan.md)\n```\n');
    git(template, 'init', '-q');
    git(template, 'add', '-A');
    git(template, 'commit', '-q', '-m', 'Start');
  }
  const root = path.join(directory, name);
  cpSync(template, root, { recursive: true });
  // The project's folder is absolute: the copy's is in the folder it is in.
  writeFileSync(path.join(root, 'planning.json'), registry(directory));
  return root;
}
