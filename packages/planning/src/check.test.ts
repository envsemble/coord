// Disposable semantic fixtures for the read-only planning checker (ported from test_check_planning.py).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validatePlanning } from './check.ts';

const valid = { errors: [], warnings: [] };
type Header = Record<string, unknown>;
type Registry = { schema_version: number; repositories: Record<string, unknown>[]; work_items: Record<string, unknown>[] };

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'planning-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  const plan = path.join(work, 'plan.md');
  writeFileSync(path.join(work, 'evidence.txt'), 'actual verification evidence\n');
  const state = {
    root, work, plan,
    body: '# Useful plan\n\nPreserve this rationale and [evidence](evidence.txt).\n',
    header: {
      schema_version: 1, kind: 'plan', id: 'work-0001', title: 'An example: preserves commas, quotes and detail',
      repositories: ['example-app'], created: null, updated: '2026-10-06', design_status: 'accepted', implementation_status: 'unknown',
      accepted_at: null, completed_at: null, supersedes: [], superseded_by: null,
    } as Header,
    registry: {
      schema_version: 1,
      repositories: [{ id: 'example-app', name: 'Example app', path: '../app' }],
      work_items: [{ id: 'work-0001', path: 'active/0001-example', repositories: ['example-app'], current_plan: 'active/0001-example/plan.md' }],
    } as Registry,
    write() {
      writeFileSync(plan, '---\n' + Object.entries(state.header).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n\n' + state.body);
      writeFileSync(path.join(root, 'planning.json'), JSON.stringify(state.registry));
    },
    validate: () => validatePlanning(root),
    planText: () => readFileSync(plan, 'utf8'),
    titleLine: () => 'title: ' + JSON.stringify(state.header.title),
  };
  state.write();
  return state;
}
const clone = <T>(value: T): T => structuredClone(value);
function manifest(root: string) {
  const result: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else result[path.relative(root, filename)] = createHash('sha256').update(readFileSync(filename)).digest('hex');
    }
  };
  walk(root);
  return result;
}

test('normalized fixture validates and stays read-only', t => {
  const setup = fixture(t);
  const before = manifest(setup.root);
  assert.deepEqual(setup.validate(), valid);
  assert.deepEqual(manifest(setup.root), before);
});

test('ledger status validation keeps history read-only', t => {
  const setup = fixture(t);
  const ledger = path.join(setup.work, 'ledger.md');
  writeFileSync(ledger, '# Old ledger\nOld current work.');
  assert.deepEqual(setup.validate(), valid);
  const metadata: Header = { schema_version: 1, kind: 'ledger', work_id: 'work-0001', updated: '2026-10-07', current: null, next: ['Verify boundaries'], blocked: 'Awaiting a required decision' };
  const write = (values: Header) => {
    writeFileSync(ledger, '---\n' + Object.entries(values).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n\n# Original ledger\nEvidence retained.');
    return readFileSync(ledger);
  };
  const original = write(metadata);
  assert.deepEqual(setup.validate(), valid);
  assert.deepEqual(readFileSync(ledger), original);
  const { blocked: _blocked, ...withoutBlocked } = metadata;
  for (const invalid of [{ ...metadata, work_id: 'work-9999' }, { ...metadata, next: 'Guess work' }, { ...metadata, current: '' }, { ...metadata, updated: '2026-02-30' }, withoutBlocked]) {
    const before = write(invalid);
    assert.ok(setup.validate().errors.some(error => error.includes('ledger.md')), JSON.stringify(invalid));
    assert.deepEqual(readFileSync(ledger), before);
  }
});

test('legacy location with a null pointer is a valid contract state', t => {
  const setup = fixture(t);
  const legacy = path.join(setup.root, 'legacy/old-notes');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(path.join(legacy, 'notes.md'), 'Original unclassified record');
  setup.registry.work_items.push({ id: 'work-0002', path: 'legacy/old-notes', repositories: [], current_plan: null });
  setup.write();
  const { errors, warnings } = setup.validate();
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(item => item.includes('scope is unknown')));
  assert.ok(warnings.some(item => item.includes('unidentified')));
});

test('a single plan without frontmatter is reported, not validated', t => {
  const setup = fixture(t);
  writeFileSync(path.join(setup.root, 'old-plan.md'), '# Original legacy plan\nDo useful work.\n');
  setup.registry.work_items.push({ id: 'work-0002', path: 'old-plan.md', repositories: ['example-app'], current_plan: 'old-plan.md' });
  setup.write();
  const { errors, warnings } = setup.validate();
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(item => item.includes('no frontmatter')));
});

test('duplicate repository and work IDs are errors', t => {
  const setup = fixture(t);
  setup.registry.repositories.push(clone(setup.registry.repositories[0]));
  setup.registry.work_items.push(clone(setup.registry.work_items[0]));
  setup.write();
  const { errors } = setup.validate();
  assert.ok(errors.some(item => item.includes('duplicate repository id')));
  assert.ok(errors.some(item => item.includes('duplicate work id')));
});

test('plan and registry repository scopes must agree', t => {
  const setup = fixture(t);
  setup.registry.repositories.push({ id: 'another-app', name: 'Another' });
  setup.header.repositories = ['another-app'];
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('scope disagrees')));
});

test('pointers and paths stay contained', t => {
  const setup = fixture(t);
  for (const value of ['../outside.md', '/absolute', 'C:/outside.md', 'active\\plan.md']) {
    setup.registry.work_items[0].path = value;
    setup.write();
    assert.ok(setup.validate().errors.length, value);
  }
});

test('work locations and selected plans reject dashboard-hidden components', t => {
  const setup = fixture(t);
  const original = clone(setup.registry);
  for (const component of ['.private', 'node_modules', '__pycache__', 'dist', 'build']) {
    for (const field of ['path', 'current_plan']) {
      setup.registry = clone(original);
      const entry = setup.registry.work_items[0];
      if (field === 'path') {
        const location = 'active/' + component + '/0001-example';
        entry.path = location;
        entry.current_plan = location + '/plan.md';
      } else entry.current_plan = entry.path + '/' + component + '/plan.md';
      const target = path.join(setup.root, entry.current_plan as string);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(setup.plan));
      setup.write();
      const before = [readFileSync(target), readFileSync(path.join(setup.root, 'planning.json'))];
      const { errors } = setup.validate();
      assert.ok(errors.some(error => error.includes('hidden from the dashboard')), component + ' ' + field + ': ' + errors.join('; '));
      assert.deepEqual([readFileSync(target), readFileSync(path.join(setup.root, 'planning.json'))], before);
    }
  }
});

test('a pointer outside its own work item is an error', t => {
  const setup = fixture(t);
  mkdirSync(path.join(setup.root, 'archive'));
  writeFileSync(path.join(setup.root, 'archive/other.md'), 'Legacy plan');
  setup.registry.work_items[0].current_plan = 'archive/other.md';
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('outside its work item')));
});

test('dates and completion are not optimistic', t => {
  const setup = fixture(t);
  setup.header.created = '2026-02-30';
  setup.header.completed_at = '2026-10-06';
  setup.write();
  const { errors } = setup.validate();
  assert.ok(errors.some(item => item.includes('created must be an ISO')));
  assert.ok(errors.some(item => item.includes('requires complete')));
});

test('explicit IDs and unknown scopes are validated', t => {
  const setup = fixture(t);
  setup.header.id = 'work-0099';
  setup.header.repositories = ['unregistered'];
  setup.write();
  const { errors } = setup.validate();
  assert.ok(errors.some(item => item.includes('id disagrees')));
  assert.ok(errors.some(item => item.includes('unknown repository')));
});

test('lifecycle chronology matches the dashboard and preserves unknown dates', t => {
  const setup = fixture(t);
  const valid_ = { ...setup.header, created: '2026-10-01', accepted_at: '2026-10-03', completed_at: '2026-10-05', updated: '2026-10-05', implementation_status: 'complete' };
  for (const changes of [{ updated: '2026-09-30' }, { updated: '2026-10-02' }, { updated: '2026-10-04' }, { accepted_at: '2026-09-30' }, { completed_at: '2026-09-30' }, { completed_at: '2026-10-02' }]) {
    setup.header = { ...valid_, ...changes };
    setup.write();
    const original = readFileSync(setup.plan);
    assert.ok(setup.validate().errors.some(error => error.includes('out of order')), JSON.stringify(changes));
    assert.deepEqual(readFileSync(setup.plan), original);
  }
  for (const values of [valid_, { ...valid_, created: null, accepted_at: null, completed_at: null, updated: null }]) {
    setup.header = values;
    setup.write();
    assert.deepEqual(setup.validate(), valid);
  }
});

test('metadata supports plain dates, block lists and comments', () => {
  const parsed = parseFrontmatter("---\nschema_version: 1\ntitle: 'A title, with ''quotes''' # note\nupdated: 2026-10-06\nrepositories:\n  - example-app\nsupersedes: [] # none\n---\nFlexible body")!;
  assert.equal(parsed.title, "A title, with 'quotes'");
  assert.equal(parsed.updated, '2026-10-06');
  assert.deepEqual(parsed.repositories, ['example-app']);
  assert.deepEqual(parsed.supersedes, []);
  assert.equal(parsed.schema_version, 1);
});

test('duplicate metadata is not silently replaced', () => {
  assert.throws(() => parseFrontmatter('---\nid: work-0001\nid: work-0002\n---\n'), /duplicate metadata/);
});

test('supported flow lists ignore comment brackets and a trailing comma', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['[example-app] # compare [legacy]', '[example-app,]', "['example-app', ] # [legacy]"]) {
    writeFileSync(setup.plan, original.replace('repositories: ["example-app"]', 'repositories: ' + value));
    assert.deepEqual(setup.validate(), valid, value);
  }
});

test('flow lists keep quoted brackets and require an uncommented closing bracket', () => {
  const parsed = parseFrontmatter('---\nrepositories: ["literal]bracket", \'other]value\',] # [comment]\n---\n')!;
  assert.deepEqual(parsed.repositories, ['literal]bracket', 'other]value']);
  assert.throws(() => parseFrontmatter('---\nrepositories: [example-app # comment ]\n---\n'), /closing delimiter/);
});

test('invalid plain title mapping delimiters are rejected', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['Release: phase 2', 'Release:\tphase 2', 'Release:', 'Release: # note']) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.ok(setup.validate().errors.some(item => item.includes('invalid plain scalar mapping delimiter')), value);
  }
});

test('equivalent quoted titles with delimiters are accepted', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['"Release: phase 2"', "'Release:'", "'it''s ready'", '"@release"', "'- release'", "'? release'", '"`release"']) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.deepEqual(setup.validate(), valid, value);
  }
});

test('valid plain title colons and comments remain supported', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const [value, expected] of [['Release:phase-2 # note', 'Release:phase-2'], ['https://example.invalid/release # note', 'https://example.invalid/release'], ['-release', '-release'], ['?release', '?release'], [':release', ':release']]) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.deepEqual(setup.validate(), valid, value);
    assert.equal(parseFrontmatter(setup.planText())!.title, expected);
  }
});

test('invalid plain leading indicators and trailing quoted content are rejected', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ["'a' 'b'", '@release', '`release', '- release', '? release', ']release', '}release', ',release', '%release']) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.ok(setup.validate().errors.length, value);
  }
});

test('implicit non-string titles are rejected and quoted equivalents accepted', t => {
  const setup = fixture(t);
  const original = setup.planText();
  const variants = [
    'True', 'FALSE', 'TrUe', 'yes', 'NO', 'On', 'off', 'y', 'N',
    'Null', 'NULL', '~', '1.5', '+12', '-2', '0b10', '0o10',
    '0123', '0xA', '1_000', '1e3', '1.0e+3', '.5', '1.',
    '.inf', '+.INF', '-.Inf', '.NaN', '1:20', '1:20.5',
    '2026-10-06', '2026-10-06T12:00:00Z', '2026-10-06 12:00:00+02:00',
  ];
  for (const value of variants) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.ok(setup.validate().errors.length, 'implicit non-string title was certified: ' + value);
    for (const quoted of [JSON.stringify(value), "'" + value + "'"]) {
      writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + quoted));
      assert.deepEqual(setup.validate(), valid, quoted);
    }
  }
});

test('ordinary plain titles are not mistaken for implicit types', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['1st release', 'v1.5', '1.5 release', 'Release on Tuesday', 'nothing null', 'True story', 'nullish', '2026-10-06 release']) {
    writeFileSync(setup.plan, original.replace(setup.titleLine(), 'title: ' + value));
    assert.deepEqual(setup.validate(), valid, value);
    assert.equal(parseFrontmatter(setup.planText())!.title, value);
  }
});

test('implicit typing applies to flow and block string lists', t => {
  const setup = fixture(t);
  setup.registry.repositories = [{ id: 'yes', name: 'Yes repository' }];
  setup.registry.work_items[0].repositories = ['yes'];
  setup.header.repositories = ['yes'];
  setup.write();
  const original = setup.planText();
  for (const [raw, quoted] of [['[yes]', "['yes']"], ['\n  - yes', "\n  - 'yes'"]]) {
    writeFileSync(setup.plan, original.replace('repositories: ["yes"]', 'repositories: ' + raw));
    assert.ok(setup.validate().errors.length, raw);
    writeFileSync(setup.plan, original.replace('repositories: ["yes"]', 'repositories: ' + quoted));
    assert.deepEqual(setup.validate(), valid, quoted);
  }
});

test('null-like trailing flow content is not a comment', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['null', 'Null', '~']) {
    writeFileSync(setup.plan, original.replace('repositories: ["example-app"]', 'repositories: ["example-app"] ' + value));
    assert.ok(setup.validate().errors.some(item => item.includes('unexpected content after flow list')), value);
  }
});

test('plain ISO date compatibility is scoped to date fields', t => {
  const setup = fixture(t);
  Object.assign(setup.header, { created: '2026-10-06', accepted_at: '2026-10-06', completed_at: '2026-10-06', implementation_status: 'complete' });
  setup.write();
  let content = setup.planText();
  for (const field of ['created', 'updated', 'accepted_at', 'completed_at']) content = content.replace(field + ': "2026-10-06"', field + ': 2026-10-06');
  writeFileSync(setup.plan, content);
  assert.deepEqual(setup.validate(), valid);
  for (const field of ['created', 'updated', 'accepted_at', 'completed_at']) assert.equal(parseFrontmatter(content)![field], '2026-10-06');
  for (const value of ['Null', 'NULL', '~']) {
    writeFileSync(setup.plan, content.replace('created: 2026-10-06', 'created: ' + value));
    assert.deepEqual(setup.validate(), valid, value);
    assert.equal(parseFrontmatter(setup.planText())!.created, null);
  }
});

test('Windows line endings, a byte-order mark and undecodable bytes are handled explicitly', t => {
  const setup = fixture(t);
  const original = setup.planText();
  writeFileSync(setup.plan, '\uFEFF' + original.replaceAll('\n', '\r\n'));
  assert.deepEqual(setup.validate(), valid);
  writeFileSync(setup.plan, Buffer.concat([Buffer.from(original.replace(setup.titleLine(), 'title: "')), Buffer.from([0xff]), Buffer.from('"')]));
  assert.ok(setup.validate().errors.some(item => item.startsWith('active/0001-example/plan.md: ')), 'invalid UTF-8 is reported, not replaced');
});

const git = spawnSync('git', ['--version']).status === 0;
test('an actual Git baseline recovers records after a move', { skip: !git && 'Git unavailable for recovery fixture' }, t => {
  const setup = fixture(t);
  const run = (...args: string[]) => execFileSync('git', ['-C', setup.root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  run('init');
  // Exercise the supplied raw capture policy against inherited conversion.
  run('config', 'core.autocrlf', 'true');
  const skills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skills');
  const bootstrap = readdirSync(skills).find(name => name.endsWith('-bootstrap') && statSync(path.join(skills, name, 'assets/planning/.gitattributes'), { throwIfNoEntry: false }));
  assert.ok(bootstrap, 'the bootstrap skill ships the planning .gitattributes');
  writeFileSync(path.join(setup.root, '.gitattributes'), readFileSync(path.join(skills, bootstrap, 'assets/planning/.gitattributes')));
  run('add', '.');
  run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Retain baseline');
  const originals: Record<string, Buffer> = { 'plan.md': readFileSync(setup.plan), 'evidence.txt': readFileSync(path.join(setup.work, 'evidence.txt')) };
  const archived = path.join(setup.root, 'archive/0001-example');
  mkdirSync(path.dirname(archived));
  renameSync(setup.work, archived);
  Object.assign(setup.registry.work_items[0], { path: 'archive/0001-example', current_plan: 'archive/0001-example/plan.md' });
  writeFileSync(path.join(setup.root, 'planning.json'), JSON.stringify(setup.registry));
  assert.deepEqual(setup.validate().errors, []);
  for (const [name, content] of Object.entries(originals)) {
    assert.deepEqual(readFileSync(path.join(archived, name)), content);
    // Restore into a distinct fixture path from the actual Git object.
    const recovered = path.join(setup.root, 'recovered-' + name);
    writeFileSync(recovered, run('show', 'HEAD:active/0001-example/' + name));
    assert.deepEqual(readFileSync(recovered), content);
  }
  const copy = path.join(setup.root, 'restore-check');
  execFileSync('git', ['-c', 'core.autocrlf=true', 'clone', '--no-hardlinks', setup.root, copy], { stdio: 'pipe' });
  for (const [name, content] of Object.entries(originals)) assert.deepEqual(readFileSync(path.join(copy, 'active/0001-example', name)), content);
});
