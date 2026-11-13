// Disposable semantic fixtures for the read-only planning checker.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { parseFrontmatter, validatePlanning } from './check.ts';
import { ledgerStatus } from '../work/ledger.ts';

const valid = { errors: [], warnings: [] };
type Header = Record<string, unknown>;
type Registry = Record<string, unknown> & { work_items: Record<string, unknown>[] };

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'planning-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'active/0001-example');
  mkdirSync(work, { recursive: true });
  const plan = path.join(work, 'plan.md');
  writeFileSync(path.join(work, 'evidence.txt'), 'actual verification evidence\n');
  writeFileSync(path.join(work, 'ledger.md'), '---\nschema_version: 2\nkind: ledger\nwork_id: work-0001\nupdated: null\nblocked: null\nsteps: []\n---\n');
  const state = {
    root, work, plan,
    body: '# Useful plan\n\nPreserve this rationale and [evidence](evidence.txt).\n',
    header: {
      schema_version: 2, kind: 'plan', id: 'work-0001', title: 'An example: preserves commas, quotes and detail', summary: 'An example plan. It validates.',
      created: null, updated: '2026-10-06', design_status: 'accepted', implementation_status: 'unknown',
      accepted_at: null, completed_at: null, supersedes: [], superseded_by: null,
    } as Header,
    registry: {
      schema_version: 2, name: 'Example', folders: [path.join(root, 'app')],
      work_items: [{ id: 'work-0001', path: 'active/0001-example', current_plan: 'active/0001-example/plan.md' }],
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

test('ledger status validation keeps history read-only, and a ledger without a version 2 header is refused', t => {
  const setup = fixture(t);
  const ledger = path.join(setup.work, 'ledger.md');
  writeFileSync(ledger, '# Old ledger\nOld current work.');
  assert.ok(setup.validate().errors.some(error => error.includes('ledger.md: the ledger has no status header')));
  const metadata: Header = { schema_version: 2, kind: 'ledger', work_id: 'work-0001', updated: '2026-10-07', blocked: 'Awaiting a required decision', steps: [] };
  const write = (values: Header) => {
    writeFileSync(ledger, '---\n' + Object.entries(values).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n\n# Original ledger\nEvidence retained.');
    return readFileSync(ledger);
  };
  const original = write(metadata);
  assert.deepEqual(setup.validate(), valid);
  assert.deepEqual(readFileSync(ledger), original);
  const { blocked: _blocked, ...withoutBlocked } = metadata;
  const version1: Header = { schema_version: 1, kind: 'ledger', work_id: 'work-0001', updated: '2026-10-07', current: null, next: ['Verify boundaries'], blocked: null };
  for (const invalid of [{ ...metadata, work_id: 'work-9999' }, { ...metadata, updated: '2026-02-30' }, withoutBlocked, version1]) {
    const before = write(invalid);
    assert.ok(setup.validate().errors.some(error => error.includes('ledger.md')), JSON.stringify(invalid));
    assert.deepEqual(readFileSync(ledger), before);
  }
});

test('ledger status version 2 steps validate in the restricted grammar and stay read-only', t => {
  const setup = fixture(t);
  const ledger = path.join(setup.work, 'ledger.md');
  const write = (lines: string[]) => { writeFileSync(ledger, ['---', ...lines, '---', '', '# Original ledger', 'Evidence retained.', ''].join('\n')); return readFileSync(ledger); };
  const head = ['schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: "2026-10-11"', 'blocked: null'];
  const steps = ['steps:', '  # Agreed with Jacob', '  - title: "Fix scrolling"', '    status: done', '', '  - status: doing', "    title: 'Ledger: step list'", '  - title: Statistics', '    status: todo'];
  const original = write([...head, ...steps]);
  assert.deepEqual(setup.validate(), valid);
  assert.deepEqual(readFileSync(ledger), original);
  assert.deepEqual((parseFrontmatter(original.toString('utf8'), { entryLists: ['steps'] })!.steps as object[]).map(entry => ({ ...entry })), [{ title: 'Fix scrolling', status: 'done' }, { status: 'doing', title: 'Ledger: step list' }, { title: 'Statistics', status: 'todo' }]);
  write([...head, 'steps: []']);
  assert.deepEqual(setup.validate(), valid, 'no steps established yet');
  for (const invalid of [
    [...head, ...steps.map(line => line.replace('status: todo', 'status: later'))],
    [...head, ...steps, '  - title: "Fix scrolling"', '    status: todo'],
    [...head, 'current: "Old focus"', ...steps],
    [...head, ...steps, '    note: "unknown field"'],
    [...head, 'steps: [{title: "Inline", status: done}]'],
    [...head, ...steps.map(line => line.replace('title: Statistics', 'title: Statistics: tokens'))],
    [...head, 'steps:', '  - title: "Nested"', '    status:', '      - done'],
    head.map(line => line.replace('schema_version: 2', 'schema_version: 3')).concat(steps),
  ]) {
    const before = write(invalid);
    assert.ok(setup.validate().errors.some(error => error.includes('ledger.md')), invalid.join(' | '));
    assert.deepEqual(readFileSync(ledger), before);
  }
});

test('every ledger header the checker accepts reads the same through the YAML reader', () => {
  const head = ['schema_version: 2', 'kind: ledger', 'work_id: work-0001', 'updated: null', 'blocked: null'];
  const accepted: string[][] = [
    ['steps:', '  - title: "A"', '    status: done', '  - title: "B"', '    status: todo'],
    ['steps:', '- title: "A"', '  status: done'],
    ['steps:', '  -   title: "A"', '      status: doing'],
    ['steps:', '  - status: todo', '    title: "Quoted # hash and: colon"', '', '  # a comment', '  - title: "---"', '    status: done'],
    ['steps: []'], ['steps: [ ]'], ['steps: []  # none yet'],
  ];
  const rejected: string[][] = [
    ['steps:'], ['steps: # none'], ['steps:', 'blocked_note: "x"'],
    ['steps:', '  - title: "A"', '   status: done'],
    ['steps:', '  - title: "A"', '      status: done'],
    ['steps:', '- title: "A"', ' status: done'],
    ['steps:', '  -   title: "A"', '    status: done'],
    ['steps:', '  - title: "A"', '    status: done', '    - title: "B"', '      status: done'],
    ['steps:', '  - title: "A"', '    status: done', ' - title: "B"', '   status: done'],
    ['steps:', '\t- title: "A"', '\t  status: done'],
    ['steps:', '  -\ttitle: "A"', '    status: done'],
    ['steps:', '  - title: "A"', '\u00a0   status: done'],
    ['steps:', '  - title: "A"', '    status:done'],
    ['steps:', '  - title:"A"', '    status: done'],
    ['steps: [a, b]'],
    ['steps:[]'], ['steps: []#c'],
    ['steps:', '  - title: "A"', '    status: todo\u00a0'],
    ['steps:', '  - title: a', '      \u00a0# c'],
    ['steps:', '  - title: a\u2028# c', '    status: todo'],
    ['steps:', '  - title: "A"', '    status: done', '    # c', '\t'],
  ];
  const viaChecker = (lines: string[]) => {
    const metadata = parseFrontmatter(['---', ...head, ...lines, '---', ''].join('\n'), { entryLists: ['steps'] })!;
    return ledgerStatus(metadata, 'work-0001').steps;
  };
  const viaYaml = (lines: string[]) => ledgerStatus(parseYaml([...head, ...lines].join('\n'), { schema: 'core' }), 'work-0001').steps;
  for (const lines of accepted) assert.deepEqual(viaChecker(lines), viaYaml(lines), lines.join(' | '));
  for (const lines of rejected) assert.throws(() => viaChecker(lines), Error, lines.join(' | '));
  assert.throws(() => parseFrontmatter(['---', 'blocked:null', '---', ''].join('\n')), Error, 'key:value without a space is not a mapping');
  // A plan is not a ledger: a `steps` field there keeps the ordinary scalar list grammar.
  assert.deepEqual(parseFrontmatter(['---', 'steps: [a, b]', '---', ''].join('\n'))!.steps, ['a', 'b']);
});

test('only the current formats are read: the registry, work items and plan headers of schema version 2', t => {
  const setup = fixture(t);
  const original = clone(setup.registry), header = clone(setup.header);
  const errorsWith = (change: () => void) => {
    setup.registry = clone(original); setup.header = clone(header);
    change();
    setup.write();
    return setup.validate().errors;
  };
  assert.deepEqual(errorsWith(() => { setup.registry.schema_version = 1; }), ['registry schema_version must be integer 2']);
  assert.ok(errorsWith(() => { setup.registry.repositories = []; }).some(error => error.includes('unknown fields: repositories')));
  assert.ok(errorsWith(() => { delete setup.registry.folders; }).includes('folders must be an array of absolute folder paths'));
  assert.ok(errorsWith(() => { delete setup.registry.name; }).some(error => error.startsWith('name must be')));
  assert.ok(errorsWith(() => { setup.header.schema_version = 1; }).some(error => error.includes('schema_version must be integer 2')));
  assert.ok(errorsWith(() => { setup.header.repositories = ['example-app']; }).some(error => error.includes('unknown fields: repositories')));
  // The main plan is the work folder's plan.md, with a header.
  assert.ok(errorsWith(() => { setup.registry.work_items[0].current_plan = null; }).length);
  writeFileSync(path.join(setup.work, 'other.md'), 'Another plan');
  assert.ok(errorsWith(() => { setup.registry.work_items[0].current_plan = 'active/0001-example/other.md'; }).some(error => error.includes("must be the work folder's plan.md")));
  setup.registry = clone(original); setup.header = clone(header); setup.write();
  writeFileSync(setup.plan, '# A plan without a header\n');
  assert.ok(setup.validate().errors.some(error => error.includes('the plan has no metadata header')));
});

test('duplicate work IDs are errors', t => {
  const setup = fixture(t);
  setup.registry.work_items.push(clone(setup.registry.work_items[0]));
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('duplicate work id')));
});

test('pointers and paths stay contained', t => {
  const setup = fixture(t);
  for (const value of ['../outside.md', '/absolute', 'C:/outside.md', 'active\\plan.md']) {
    setup.registry.work_items[0].path = value;
    setup.write();
    assert.ok(setup.validate().errors.length, value);
  }
});

test('work locations and selected plans reject components hidden from Atlas', t => {
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
      assert.ok(errors.some(error => error.includes('hidden from Atlas')), component + ' ' + field + ': ' + errors.join('; '));
      assert.deepEqual([readFileSync(target), readFileSync(path.join(setup.root, 'planning.json'))], before);
    }
  }
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

test('explicit IDs are validated', t => {
  const setup = fixture(t);
  setup.header.id = 'work-0099';
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('id disagrees')));
});

test('continues lists work items: malformed or itself is an error, unknown work and loops are warnings', t => {
  const setup = fixture(t);
  setup.header.continues = ['not work'];
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('continues must list work items')));
  setup.header.continues = ['work-0001'];
  setup.write();
  assert.ok(setup.validate().errors.some(item => item.includes('continues names the work item itself')));
  const next = path.join(setup.root, 'active/0002-next');
  mkdirSync(next, { recursive: true });
  writeFileSync(path.join(next, 'plan.md'), ['---', 'id: work-0002', 'continues: [work-0001]', '---', ''].join('\n'));
  setup.registry.work_items.push({ id: 'work-0002', path: 'active/0002-next', current_plan: 'active/0002-next/plan.md' });
  setup.header.continues = ['work-0002', 'no-such-project:work-0001'];
  setup.write();
  const { warnings } = setup.validate();
  assert.ok(warnings.some(item => item.includes('continues no-such-project:work-0001, which names no work item')));
  assert.ok(warnings.some(item => item.includes('the handoffs form a loop')));
});

test('parts lists work IDs of this project: malformed, itself or twice is an error; unknown work, a part of two groups and a part with parts are warnings', t => {
  const setup = fixture(t);
  for (const [parts, message] of [[['shop:work-0002'], 'parts must be a list of work IDs'], [['work-0001'], 'parts names the work item itself'], [['work-0002', 'work-0002'], 'parts lists a work item twice']] as const) {
    setup.header.parts = [...parts];
    setup.write();
    assert.ok(setup.validate().errors.some(item => item.includes(message)), message);
  }
  const next = path.join(setup.root, 'active/0002-next');
  mkdirSync(next, { recursive: true });
  writeFileSync(path.join(next, 'plan.md'), ['---', 'id: work-0002', 'parts: [work-0003]', '---', ''].join('\n'));
  setup.registry.work_items.push({ id: 'work-0002', path: 'active/0002-next', current_plan: 'active/0002-next/plan.md' });
  setup.header.parts = ['work-0002', 'work-0003'];
  setup.write();
  const { errors, warnings } = setup.validate();
  assert.ok(!errors.some(item => item.includes('parts')), errors.join('; '));
  assert.ok(warnings.some(item => item.startsWith('active/0001-example/plan.md: parts lists work-0003, which names no work item')));
  assert.ok(warnings.some(item => item.startsWith('active/0002-next/plan.md: parts lists work-0003, which work-0001 lists too')));
  assert.ok(warnings.some(item => item.startsWith('active/0001-example/plan.md: parts lists work-0002, which has parts of its own')));
});

test('lifecycle chronology matches the app and preserves unknown dates', t => {
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
  const parsed = parseFrontmatter("---\nschema_version: 2\ntitle: 'A title, with ''quotes''' # note\nupdated: 2026-10-06\ncontinues:\n  - work-0002\nsupersedes: [] # none\n---\nFlexible body")!;
  assert.equal(parsed.title, "A title, with 'quotes'");
  assert.equal(parsed.updated, '2026-10-06');
  assert.deepEqual(parsed.continues, ['work-0002']);
  assert.deepEqual(parsed.supersedes, []);
  assert.equal(parsed.schema_version, 2);
});

test('duplicate metadata is not silently replaced', () => {
  assert.throws(() => parseFrontmatter('---\nid: work-0001\nid: work-0002\n---\n'), /duplicate metadata/);
});

test('supported flow lists ignore comment brackets and a trailing comma', t => {
  const setup = fixture(t);
  writeFileSync(setup.plan, setup.planText().replace('supersedes: []', 'supersedes: [] # compare [older]'));
  assert.deepEqual(setup.validate(), valid);
  for (const value of ['[work-0002] # compare [older]', '[work-0002,]', "['work-0002', ] # [older]"]) {
    assert.deepEqual(parseFrontmatter('---\nsupersedes: ' + value + '\n---\n')!.supersedes, ['work-0002'], value);
  }
});

test('flow lists keep quoted brackets and require an uncommented closing bracket', () => {
  const parsed = parseFrontmatter('---\nsupersedes: ["literal]bracket", \'other]value\',] # [comment]\n---\n')!;
  assert.deepEqual(parsed.supersedes, ['literal]bracket', 'other]value']);
  assert.throws(() => parseFrontmatter('---\nsupersedes: [work-0002 # comment ]\n---\n'), /closing delimiter/);
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

test('implicit typing applies to flow and block string lists', () => {
  for (const [raw, quoted] of [['[yes]', "['yes']"], ['\n  - yes', "\n  - 'yes'"]]) {
    assert.deepEqual(parseFrontmatter('---\ncontinues: ' + raw + '\n---\n')!.continues, [true], raw);
    assert.deepEqual(parseFrontmatter('---\ncontinues: ' + quoted + '\n---\n')!.continues, ['yes'], quoted);
  }
});

test('null-like trailing flow content is not a comment', t => {
  const setup = fixture(t);
  const original = setup.planText();
  for (const value of ['null', 'Null', '~']) {
    writeFileSync(setup.plan, original.replace('supersedes: []', 'supersedes: [] ' + value));
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
test('the planning folder keeps files byte for byte through Git, whatever core.autocrlf says', { skip: !git && 'Git unavailable' }, t => {
  const setup = fixture(t);
  const run = (...args: string[]) => execFileSync('git', ['-C', setup.root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  run('init');
  // Exercise the supplied raw capture policy against inherited conversion.
  run('config', 'core.autocrlf', 'true');
  const attributes = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/planning/.gitattributes');
  assert.ok(statSync(attributes, { throwIfNoEntry: false }), 'the atlas skill ships the planning .gitattributes');
  writeFileSync(path.join(setup.root, '.gitattributes'), readFileSync(attributes));
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
