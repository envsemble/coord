// Consultation logging (ported from test_log_consultation.py).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { documentIdentity, recordAgentCollectionGap, reportConsultation } from './consultation.ts';
import { cacheOutsidePlanning, statisticsDirectory } from './storage.ts';
import { filesystemCaseSensitive, filesystemNormalizesUnicode } from './filesystem.ts';

function temporary(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'planning-consultation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function rows(root: string, destination: string, query: string) {
  const database = new DatabaseSync(path.join(await statisticsDirectory(root, destination), 'usage.sqlite'));
  try { return database.prepare(query).all().map(row => Object.values(row)); } finally { database.close(); }
}
const registryFile = (root: string, items: unknown[]) => writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: items }));

test('POSIX backslash roots and document names remain distinct', { skip: process.platform === 'win32' && 'Backslash is a path separator on Windows' }, async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'foo\\bar');
  const nested = path.join(directory, 'foo', 'bar');
  const destination = path.join(directory, 'metrics');
  for (const folder of [root, nested]) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'planning.json'), '{"schema_version": 1, "work_items": []}');
  }
  assert.notEqual(await statisticsDirectory(root, destination), await statisticsDirectory(nested, destination));
  writeFileSync(path.join(root, 'foo\\bar.md'), 'Original record\n');
  assert.deepEqual(await reportConsultation(root, ['foo\\bar.md'], { dataDir: destination }), { recorded: 1, failed: 0 });
  assert.deepEqual(await rows(root, destination, 'SELECT document_key, path FROM events'), [['root:foo\\bar.md', 'foo\\bar.md']]);
});

test('distinct Unicode hardlink names do not establish normalization aliases', async t => {
  const root = temporary(t);
  const retained = 'cafe\u0301.md', composed = 'caf\u00e9.md';
  writeFileSync(path.join(root, retained), 'Original retained record\n');
  if (await filesystemNormalizesUnicode(root, [retained])) { t.skip('Filesystem resolves these names as one entry'); return; }
  linkSync(path.join(root, retained), path.join(root, composed));
  assert.equal(await filesystemNormalizesUnicode(root, [retained]), false);
});

test('Unicode work keys and nested ownership use retained path segments', () => {
  const parent = 'active/' + 'e\u0301'.repeat(12);
  const composed = 'active/' + '\u00e9'.repeat(12);
  const items = [{ id: 'work-0001', path: parent }, { id: 'work-0002', path: composed + '/child' }];
  assert.equal(documentIdentity(composed + '/plan.md', items, true, true), 'work-0001:plan.md');
  assert.equal(documentIdentity(parent + '/child/note.md', items, true, true), 'work-0002:note.md');
});

test('Unicode registry aliases keep work scope without merging distinct folders', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  const retained = 'active/cafe\u0301', composed = 'active/caf\u00e9';
  mkdirSync(path.join(root, retained), { recursive: true });
  writeFileSync(path.join(root, retained, 'plan.md'), 'Original plan\n');
  const equivalent = await filesystemNormalizesUnicode(root, [retained + '/plan.md']);
  const selected = equivalent ? composed : retained;
  const entries = [{ id: 'work-0001', path: selected, current_plan: selected + '/plan.md' }];
  const files = [retained + '/plan.md'];
  if (!equivalent) {
    mkdirSync(path.join(root, composed));
    writeFileSync(path.join(root, composed, 'plan.md'), 'Another distinct plan\n');
    entries.push({ id: 'work-0002', path: composed, current_plan: composed + '/plan.md' });
    files.push(composed + '/plan.md');
  }
  registryFile(root, entries);
  const destination = path.join(directory, 'metrics');
  assert.deepEqual(await reportConsultation(root, files, { dataDir: destination }), { recorded: entries.length, failed: 0 });
  assert.deepEqual(await rows(root, destination, 'SELECT document_key FROM events ORDER BY document_key'), entries.map(entry => [entry.id + ':plan.md']));
});

test('a native normalization alias retains the original document identity', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  const original = path.join(work, 'cafe\u0301.md');
  writeFileSync(original, 'Original Unicode filename\n');
  const supplied = path.join(work, 'caf\u00e9.md');
  const same = existsSync(supplied) && statSync(supplied, { bigint: true }).ino === statSync(original, { bigint: true }).ino;
  if (!same) { t.skip('Connected filesystem does not resolve Unicode normalization aliases'); return; }
  const retained = readdirSync(work)[0];
  registryFile(root, [{ id: 'work-0001', path: 'active/0001-example' }]);
  const destination = path.join(directory, 'metrics');
  assert.deepEqual(await reportConsultation(root, ['active/0001-example/caf\u00e9.md'], { dataDir: destination }), { recorded: 1, failed: 0 });
  assert.deepEqual((await rows(root, destination, 'SELECT document_key, path FROM events'))[0], ['work-0001:' + retained, 'active/0001-example/' + retained]);
  assert.equal(readFileSync(original, 'utf8'), 'Original Unicode filename\n');
});

test('ambiguous registry locations never write usage', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  mkdirSync(root);
  writeFileSync(path.join(root, 'note.md'), 'Original note\n');
  const original = readFileSync(path.join(root, 'note.md'));
  const destination = path.join(directory, 'metrics');
  const item = { id: 'work-0001', path: 'note.md', current_plan: 'note.md' };
  const reject = async (items: unknown[], message: RegExp) => {
    registryFile(root, items);
    await assert.rejects(reportConsultation(root, ['note.md'], { dataDir: destination }), message);
    assert.equal(existsSync(destination), false);
  };
  for (const location of ['old/../note.md', 'legacy\\note.md', '/note.md', 'C:/note.md', './C:note.md', './C:/note.md']) await reject([{ ...item, path: location }], /POSIX-relative/);
  await reject([{ ...item, current_plan: 'old/../note.md' }], /POSIX-relative/);
  await reject([item, { ...item, id: 'work-0002' }], /Duplicate/);
  await reject([item, { ...item, id: 'work-0002', path: './/note.md/' }], /Duplicate/);
  await reject([item, { ...item, path: 'other.md', current_plan: 'other.md' }], /Duplicate/);
  await reject([item, { ...item, id: 'work-0002', path: 'other.md' }], /Conflicting selected plan/);
  for (const identity of ['root', 'work-1', 'Work-0001', '', 'work-0001:shadow']) await reject([{ ...item, id: identity }], /Invalid planning work identities/);
  if (!(await filesystemCaseSensitive(root))) await reject([item, { ...item, id: 'work-0002', path: 'Note.md', current_plan: 'Note.md' }], /Duplicate/);
  for (const location of ['./note.md', './/note.md', 'note.md/']) {
    writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [{ ...item, path: location, current_plan: './note.md' }] }));
    const registryBytes = readFileSync(path.join(root, 'planning.json'));
    assert.deepEqual(await reportConsultation(root, ['note.md'], { dataDir: destination }), { recorded: 1, failed: 0 });
    assert.deepEqual(readFileSync(path.join(root, 'planning.json')), registryBytes);
  }
  assert.deepEqual(await rows(root, destination, 'SELECT DISTINCT document_key FROM events'), [['work-0001:note.md']]);
  assert.deepEqual(readFileSync(path.join(root, 'note.md')), original);
});

test('selected plans precede nested locations with directory fallback', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  const parent = path.join(root, 'active/0001-parent'), child = path.join(parent, 'nested');
  mkdirSync(child, { recursive: true });
  writeFileSync(path.join(child, 'parent-plan.md'), 'Parent plan\n');
  writeFileSync(path.join(child, 'child-plan.md'), 'Child plan\n');
  writeFileSync(path.join(parent, 'note.md'), 'Parent note\n');
  writeFileSync(path.join(child, 'note.md'), 'Child note\n');
  const items = [{ id: 'work-0001', path: 'active/0001-parent', current_plan: 'active/0001-parent/nested/parent-plan.md' }, { id: 'work-0002', path: 'active/0001-parent/nested', current_plan: 'active/0001-parent/nested/child-plan.md' }];
  const destination = path.join(directory, 'metrics');
  for (const ordering of [items, [...items].reverse()]) {
    registryFile(root, ordering);
    assert.deepEqual(await reportConsultation(root, ['active/0001-parent/nested/parent-plan.md', 'active/0001-parent/nested/child-plan.md', 'active/0001-parent/note.md', 'active/0001-parent/nested/note.md'], { dataDir: destination }), { recorded: 4, failed: 0 });
  }
  assert.deepEqual(await rows(root, destination, 'SELECT DISTINCT document_key FROM events ORDER BY document_key'), [['work-0001:nested/parent-plan.md'], ['work-0001:note.md'], ['work-0002:child-plan.md'], ['work-0002:note.md']]);
});

test('case-insensitive registry casing preserves work document identity', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  const document = path.join(work, 'Plan.md');
  writeFileSync(document, 'Original selected plan\n');
  const original = readFileSync(document);
  writeFileSync(path.join(root, 'legacy.md'), 'Legacy plan\n');
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 1, work_items: [{ id: 'work-0001', path: 'ACTIVE/0001-EXAMPLE', current_plan: 'Active/0001-Example/pLAN.md' }, { id: 'work-0002', path: 'LEGACY.MD', current_plan: 'Legacy.md' }] }));
  if (await filesystemCaseSensitive(root)) { t.skip('Connected filesystem is case-sensitive'); return; }
  const registryBytes = readFileSync(path.join(root, 'planning.json'));
  const destination = path.join(directory, 'metrics');
  assert.deepEqual(await reportConsultation(root, ['active/0001-example/Plan.md', 'ACTIVE/0001-EXAMPLE/plan.md', document.toUpperCase(), 'LEGACY.MD'], { dataDir: destination }), { recorded: 2, failed: 0 });
  assert.equal(await statisticsDirectory(root, destination), await statisticsDirectory(path.join(path.dirname(root), 'PLANNING'), destination));
  await assert.rejects(cacheOutsidePlanning(root, path.join(path.dirname(root), 'PLANNING', 'cache')), /outside the planning folder/);
  assert.deepEqual(await rows(root, destination, 'SELECT document_key FROM events ORDER BY document_key'), [['work-0001:Plan.md'], ['work-0002:legacy.md']]);
  assert.deepEqual(readFileSync(path.join(root, 'planning.json')), registryBytes);
  assert.deepEqual(readFileSync(document), original);
});

test('closed-app collection records unknown identities and refuses a store inside planning', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  mkdirSync(root);
  registryFile(root, []);
  writeFileSync(path.join(root, 'note.md'), '# Original note\n');
  const original = readFileSync(path.join(root, 'note.md'));
  const destination = path.join(directory, 'metrics');
  assert.deepEqual(await reportConsultation(root, ['note.md', 'note.md'], { dataDir: destination }), { recorded: 1, failed: 0 });
  const [row] = await rows(root, destination, 'SELECT source, document_key, task_id, session_id, content_hash FROM events');
  assert.deepEqual(row.slice(0, 4), ['agent_report', 'root:note.md', null, null]);
  assert.equal((row[4] as string).length, 64);
  assert.deepEqual(readFileSync(path.join(root, 'note.md')), original);
  assert.deepEqual(readdirSync(root).sort(), ['note.md', 'planning.json']);
  await assert.rejects(reportConsultation(root, ['note.md'], { dataDir: path.join(root, 'cache') }), /outside the planning folder/);
  await recordAgentCollectionGap(root, path.join(root, 'cache'));
  assert.equal(existsSync(path.join(root, 'cache')), false);
});

test('archived work keeps its document identity and escapes are rejected', async t => {
  const directory = temporary(t);
  const root = path.join(directory, 'planning');
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'plan.md'), 'Planned work\n');
  const registry = { schema_version: 1, work_items: [{ id: 'work-0001', path: 'active/0001-example' }] };
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify(registry));
  writeFileSync(path.join(directory, 'outside.md'), 'Outside scope\n');
  const destination = path.join(directory, 'metrics');
  assert.deepEqual(await reportConsultation(root, ['active/0001-example/plan.md', '../outside.md'], { task: 'work-0001', dataDir: destination }), { recorded: 1, failed: 1 });
  mkdirSync(path.join(root, 'archive'));
  renameSync(work, path.join(root, 'archive/0001-example'));
  registry.work_items[0].path = 'archive/0001-example';
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify(registry));
  assert.deepEqual(await reportConsultation(root, ['archive/0001-example/plan.md'], { task: 'work-0001', dataDir: destination }), { recorded: 1, failed: 0 });
  assert.deepEqual(await rows(root, destination, 'SELECT DISTINCT document_key FROM events'), [['work-0001:plan.md']]);
  assert.deepEqual(await rows(root, destination, 'SELECT count(*) FROM failures'), [[1]]);
});
