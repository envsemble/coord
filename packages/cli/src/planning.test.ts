import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { atlas, git, homeWithPlanning, planText, temporary, write } from './testing.ts';

test('a checkout finds its planning folder in the home and drives a work item through its life', t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const run = (...args: string[]) => atlas(args, { env, cwd: checkout });
  const json = (...args: string[]) => { const result = run(...args); assert.equal(result.status, 0, args.join(' ') + ': ' + result.stderr); return JSON.parse(result.stdout); };

  const where = json('where');
  assert.deepEqual(where.matches.map((match: { planningFolder: string; via: string[]; repositories: string[] }) => [match.planningFolder, match.via, match.repositories]), [[root, ['remote'], ['shop']]]);
  assert.equal(where.matches[0].work[0].workId, 'work-0001');
  assert.equal(json('where', '--cwd', root).matches[0].via[0], 'inside');

  // Created for the repositories this checkout is.
  const created = json('work', 'create', '--title', 'Checkout flow');
  assert.deepEqual([created.workId, created.path, created.repositories, created.designStatus], ['work-0002', 'active/0002-checkout-flow', ['shop'], 'draft']);
  assert.equal(run('work', 'create', '--title', 'X', '--repo', 'nope').status, 1);
  assert.equal(json('work', 'accept', 'work-0002').designStatus, 'accepted');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Plan');
  const started = json('work', 'start', 'work-0002', '--step', 'Build', '--step', 'Review');
  assert.deepEqual(started.steps.map((step: { title: string }) => step.title), ['Build', 'Review']);
  assert.deepEqual(started.warnings, [], 'the plan was committed');
  assert.equal(json('work', 'step', 'add', 'work-0002', 'Ship', 'Announce').steps.length, 4);
  assert.equal(json('work', 'step', 'set', 'work-0002', 'Build', 'doing').steps[0].status, 'doing');
  assert.equal(json('work', 'step', 'rename', 'work-0002', 'Announce', 'Tell people').steps[3].title, 'Tell people');
  assert.equal(json('work', 'step', 'remove', 'work-0002', 'Tell people', '--reason', 'Not needed').steps.length, 3);
  assert.equal(json('work', 'block', 'work-0002', 'Waiting for review').blocked, 'Waiting for review');

  const refused = run('work', 'close', 'work-0002');
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^atlas: work-0002 cannot close while items are open\..*\n  - Step "Build" is doing\.\n  - Step "Review" is todo\.\n  - Step "Ship" is todo\.\n  - Blocked: Waiting for review\n$/s);
  assert.equal(json('work', 'block', 'work-0002', '--clear').blocked, null);
  for (const step of ['Build', 'Review', 'Ship']) json('work', 'step', 'set', 'work-0002', step, 'done');
  const closed = json('work', 'close', 'work-0002');
  assert.deepEqual([closed.path, closed.implementationStatus], ['archive/0002-checkout-flow', 'complete']);
  assert.equal(json('work', 'status', 'work-0002', '--planning-dir', root).location, 'archive');
  assert.equal(json('work', 'reopen', 'work-0002', '--step', 'Fix a bug').path, 'active/0002-checkout-flow');
  assert.match(run('work', 'archive', 'work-0001').stderr, /^atlas: work-0001 is not complete: archive it as superseded/);
  const archived = json('work', 'archive', 'work-0001', '--superseded-by', 'work-0002', '--reason', 'The checkout flow covers it');
  assert.deepEqual([archived.path, archived.designStatus], ['archive/0001-cart', 'superseded']);
  assert.ok(readFileSync(path.join(root, 'README.md'), 'utf8').includes('[Cart](archive/0001-cart/plan.md)'), 'links follow the move');
  assert.equal(atlas(['planning', 'check', root], { env }).status, 0);

  // Refusals exit 1 with the reason; usage errors exit 2.
  assert.match(run('work', 'start', 'work-0001', '--step', 'X').stderr, /^atlas: The design is superseded; accept it/);
  assert.equal(run('work', 'status', 'work-0042').status, 1);
  for (const args of [['work'], ['work', 'status'], ['work', 'status', 'a', 'b'], ['work', 'create'], ['work', 'step'], ['work', 'step', 'set', 'work-0002', 'Build', 'finished'], ['work', 'step', 'remove', 'work-0002', 'Build'], ['work', 'block', 'work-0002'], ['work', 'reopen', 'work-0002'], ['work', 'start', 'work-0002'], ['work', 'archive', 'work-0002', '--abandoned'], ['work', 'archive', 'work-0002', '--abandoned', '--superseded-by', 'work-0001', '--reason', 'x'], ['work', 'archive', 'work-0002', '--reason', 'x'], ['work', 'fly', 'work-0002']]) {
    assert.equal(run(...args).status, 2, args.join(' '));
  }
  // Outside any registered checkout, a planning folder must be given.
  const elsewhere = atlas(['work', 'status', 'work-0001'], { env, cwd: path.dirname(root) });
  assert.equal(elsewhere.status, 1);
  assert.match(elsewhere.stderr, /No planning folder in the Atlas home/);
});

test('atlas check checks a checkout\'s planning folder, files and folders with 0/1 exit codes', t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const valid = atlas(['check'], { env, cwd: checkout });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /no problems/);
  const plan = path.join(root, 'active/0001-cart/plan.md');
  writeFileSync(plan, planText('work-0001', 'Cart').replace('title: "Cart"', 'title: no'));
  const invalid = atlas(['check', plan], { env });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^ERROR: active\/0001-cart\/plan\.md: title must be a nonempty string$/m);
  assert.equal(atlas(['check', path.join(root, 'README.md')], { env }).status, 0, 'findings about other files are not reported');
  assert.equal(atlas(['check'], { env, cwd: root }).status, 1, 'inside a planning folder, that folder is checked');
  assert.equal(atlas(['check', path.join(root, 'missing.md')], { env }).status, 2);
  const nowhere = temporary(t);
  assert.equal(atlas(['check'], { env, cwd: nowhere }).status, 1);
});

test('atlas home lists the home\'s planning folders and adopts one, refusing a taken name', t => {
  const { home, root, directory, env } = homeWithPlanning(t);
  const listed = atlas(['home'], { env });
  assert.deepEqual(JSON.parse(listed.stdout), { home, planningFolders: [root] });
  const other = path.join(directory, 'old-planning');
  write(path.join(other, 'planning.json'), JSON.stringify({ schema_version: 1, repositories: [{ id: 'app', name: 'App', path: '../app' }], work_items: [] }, null, 2) + '\n');
  git(other, 'init', '-q');
  const refused = atlas(['home', 'adopt', other, '--name', 'shop-planning'], { env });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /already exists/);
  const adopted = atlas(['home', 'adopt', other], { env });
  assert.equal(adopted.status, 0, adopted.stderr);
  const moved = path.join(home, 'planning', 'old-planning');
  assert.deepEqual(JSON.parse(adopted.stdout).rewritten, [{ id: 'app', from: '../app', to: path.join(directory, 'app') }]);
  assert.ok(!existsSync(other) && existsSync(path.join(moved, '.git')));
  assert.equal(JSON.parse(readFileSync(path.join(moved, 'planning.json'), 'utf8')).repositories[0].path, path.join(directory, 'app'));
  assert.deepEqual(JSON.parse(atlas(['home', 'list'], { env }).stdout).planningFolders, [moved, root]);
  assert.equal(atlas(['home', 'adopt'], { env }).status, 2);
  assert.equal(atlas(['home', 'move', other], { env }).status, 2);
});
