import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDate } from '../../planning/index.ts';
import diagrams from '@envsemble/atlas-diagrams';
import { homeWithPlanning, run, temporary, write } from '../testing.ts';

// A SQLite database and the source configuration that captures it.
function database(t: TestContext, tables = 'CREATE TABLE customer (id INTEGER PRIMARY KEY, email TEXT NOT NULL);') {
  const directory = temporary(t, 'atlas-capture-');
  const db = new DatabaseSync(path.join(directory, 'shop.sqlite'));
  db.exec(tables);
  db.close();
  const config = path.join(directory, 'capture.json');
  write(config, JSON.stringify({ formatVersion: 1, adapter: 'sqlite', identity: 'shop-db', file: 'shop.sqlite' }));
  return { directory, config, file: path.join(directory, 'shop.sqlite') };
}

test('capture writes a dated capture into the work item, refuses to overwrite it, and replaces it when asked', async t => {
  const { root, env, checkout } = homeWithPlanning(t);
  const { config } = database(t);
  const result = await run(['capture', config, '--work', 'work-0001'], { env, cwd: checkout });
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(root, 'active/0001-cart/diagrams', `shop-db-${localDate()}.puml`);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual({ ...summary, capturedAt: null }, { file, work: 'work-0001', title: 'shop-db schema', kind: 'entity', compares: null, capturedAt: null, adapter: 'atlas-sqlite', coverage: 'complete', diagnostics: 0, elements: 1, relations: 0 });
  const text = readFileSync(file, 'utf8');
  assert.deepEqual(diagrams.checkDiagram(text), []);
  assert.match(text, /^entity customer \{$/m);
  const again = await run(['capture', config, '--work', 'work-0001', '--planning-dir', root], { env });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists\. Choose another --name, or pass --force to replace it\./);
  assert.equal(readFileSync(file, 'utf8'), text);
  assert.equal((await run(['capture', config, '--work', 'work-0001', '--planning-dir', root, '--force'], { env })).status, 0);
  assert.notEqual(readFileSync(file, 'utf8'), text);
});

test('a later capture compares with an earlier one, which must be a capture of its kind', async t => {
  const { root, env } = homeWithPlanning(t);
  const { config, file } = database(t);
  const diagramsFolder = path.join(root, 'active/0001-cart/diagrams');
  const capture = (...args: string[]) => run(['capture', config, '--work', 'work-0001', '--planning-dir', root, ...args], { env });
  assert.equal((await capture('--name', 'before')).status, 0);
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customer(id));');
  db.close();
  const after = await capture('--name', 'after', '--compares', 'before.puml');
  assert.equal(after.status, 0, after.stderr);
  assert.equal(JSON.parse(after.stdout).compares, 'before.puml');
  const text = readFileSync(path.join(diagramsFolder, 'after.puml'), 'utf8');
  assert.match(text, /^' atlas compares before\.puml$/m);
  const before = readFileSync(path.join(diagramsFolder, 'before.puml'), 'utf8');
  assert.deepEqual(diagrams.checkDiagram(text, { read: name => (name === 'before.puml' ? before : null) }), []);
  // A path from the current folder works as well, written relative to the capture.
  const fromHere = await run(['capture', config, '--work', 'work-0001', '--planning-dir', root, '--name', 'later', '--compares', path.join(diagramsFolder, 'before.puml')], { env });
  assert.equal(JSON.parse(fromHere.stdout).compares, 'before.puml');
  // Only a capture of the same kind compares.
  write(path.join(diagramsFolder, 'sketch.puml'), '@startuml\nclass Sketch\n@enduml\n');
  const refused = await capture('--name', 'wrong', '--compares', 'sketch.puml');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /sketch\.puml is not a capture/);
  assert(!existsSync(path.join(diagramsFolder, 'wrong.puml')));
  const missing = await capture('--name', 'wrong', '--compares', 'nowhere.puml');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /nowhere\.puml does not exist/);
  // Never with itself, nor with a capture that compares with it.
  const itself = await capture('--name', 'before', '--compares', 'before.puml', '--force');
  assert.equal(itself.status, 1);
  assert.match(itself.stderr, /before\.puml is the file this capture writes/);
  const round = await capture('--name', 'before', '--compares', 'after.puml', '--force');
  assert.equal(round.status, 1);
  assert.match(round.stderr, /The baselines run in a cycle \(before\.puml → after\.puml → before\.puml\)/);
  assert.equal(readFileSync(path.join(diagramsFolder, 'before.puml'), 'utf8'), before);
});

test('capture writes to a file of its own, reports a failed capture, and checks its arguments', async t => {
  const directory = temporary(t, 'atlas-capture-out-');
  const { config } = database(t);
  const out = path.join(directory, 'nested', 'schema.puml');
  assert.equal((await run(['capture', config, '--out', out])).status, 0);
  assert.deepEqual(diagrams.checkDiagram(readFileSync(out, 'utf8')), []);
  const broken = path.join(directory, 'broken.json');
  writeFileSync(broken, JSON.stringify({ formatVersion: 1, adapter: 'sqlite', identity: 'x', file: 'missing.sqlite' }));
  const failed = await run(['capture', broken, '--out', path.join(directory, 'x.puml')]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^atlas: CAPTURE_DATABASE: SQLite metadata capture failed/);
  const unreadable = await run(['capture', path.join(directory, 'none.json'), '--out', path.join(directory, 'y.puml')]);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /cannot be read as a JSON source configuration/);
  for (const [args, message] of [
    [[config], /required: --work or --out/],
    [[config, '--work', 'work-0001', '--out', out], /either --work or --out, not both/],
    [[config, '--out', out, '--name', 'x'], /--out already names the file/],
    [[config, '--work', 'work-0001', '--name', '../x'], /argument --name/],
    [[], /required: source\.json/],
  ] as [string[], RegExp][]) {
    const result = await run(['capture', ...args]);
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, message);
  }
});
