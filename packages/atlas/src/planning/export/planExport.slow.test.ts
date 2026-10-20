// Plan imports taking turns through the planning folder's lock, with real waits.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, release, tmpdir } from 'node:os';
import path from 'node:path';
import { validatePlanning } from '../check/check.ts';
import { PlanExportError, exportPlan, importPlan } from './planExport.ts';

function temporary(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'plan-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
/** A planning folder with two work items: work-0001 active, work-0002 archived. */
function planningFolder(root: string) {
  for (const [id, folder, design] of [['work-0001', 'active/0001-checkout', 'draft'], ['work-0002', 'archive/0002-abandoned', 'abandoned']]) {
    mkdirSync(path.join(root, folder), { recursive: true });
    writeFileSync(path.join(root, folder, 'README.md'), '# Notes\n');
    writeFileSync(path.join(root, folder, 'ledger.md'), `---\nschema_version: 2\nkind: ledger\nwork_id: ${id}\nupdated: null\nblocked: null\nsteps: []\n---\n`);
    writeFileSync(path.join(root, folder, 'plan.md'), ['---', 'schema_version: 2', 'kind: plan', 'id: ' + id, 'title: "Notes"', 'summary: "Notes."', 'created: null', 'updated: null', 'design_status: ' + design, 'implementation_status: not_started', 'accepted_at: null', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# Notes', ''].join('\n'));
  }
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Shop', folders: [], work_items: [
    { id: 'work-0001', path: 'active/0001-checkout', current_plan: 'active/0001-checkout/plan.md' },
    { id: 'work-0002', path: 'archive/0002-abandoned', current_plan: 'archive/0002-abandoned/plan.md' },
  ] }, null, 2) + '\n');
}
function snapshot(root: string, relative = ''): Map<string, string> {
  return new Map(readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? relative + '/' + entry.name : entry.name;
    return entry.isDirectory() ? [...snapshot(root, child)] : [[child, readFileSync(path.join(root, child), 'utf8')] as const];
  }));
}

test('imports into one planning folder take turns through a lock', async t => {
  const source = temporary(t), target = temporary(t);
  planningFolder(source); planningFolder(target);
  const one = (await exportPlan(source, 'work-0001')).html, two = (await exportPlan(source, 'work-0002')).html;
  const results = await Promise.all([importPlan(target, one), importPlan(target, two), importPlan(target, one)]);
  assert.deepEqual(results.map(result => result.workId).sort(), ['work-0003', 'work-0004', 'work-0005']);
  const registered = JSON.parse(readFileSync(path.join(target, 'planning.json'), 'utf8')).work_items.map((item: { id: string }) => item.id);
  assert.deepEqual(registered, ['work-0001', 'work-0002', 'work-0003', 'work-0004', 'work-0005'], 'each import registered its own number, in the order they held the lock');
  assert.deepEqual(validatePlanning(target).errors, []);
  assert.ok(!existsSync(path.join(target, '.atlas-import.lock')), 'the lock is released');

  // A lock left by a process that no longer runs is removed; a live one is waited for, then reported.
  writeFileSync(path.join(target, '.atlas-import.lock'), JSON.stringify({ pid: 2 ** 30, hostname: hostname(), platform: process.platform, release: release(), token: 'gone', createdAt: '2026-10-10T00:00:00Z' }));
  assert.equal((await importPlan(target, two)).workId, 'work-0006');
  writeFileSync(path.join(target, '.atlas-import.lock'), JSON.stringify({ pid: process.pid, hostname: 'elsewhere', createdAt: '2026-10-10T00:00:00Z' }));
  const before = snapshot(target);
  await assert.rejects(importPlan(target, two, { lockWaitMs: 200 }), (error: unknown) => error instanceof PlanExportError && error.code === 'CONFLICT' && /in progress.*elsewhere/s.test(error.message));
  assert.deepEqual(snapshot(target), before);
});
