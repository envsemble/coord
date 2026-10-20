import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, homeWithPlanning, planText, run, temporary, write } from '../testing.ts';

test('a folder finds its planning folder in the home and drives a work item through its life', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const inCheckout = (...args: string[]) => run(args, { env, cwd: checkout });
  const inRoot = (...args: string[]) => run([...args, '--planning-dir', root], { env });
  const json = async (...args: string[]) => { const result = await inRoot(...args); assert.equal(result.status, 0, args.join(' ') + ': ' + result.stderr); return JSON.parse(result.stdout); };

  const where = JSON.parse((await inCheckout('where')).stdout);
  assert.deepEqual(where.matches.map((match: { planningFolder: string; via: string[] }) => [match.planningFolder, match.via]), [[root, ['folder']]]);
  assert.equal(where.matches[0].work[0].workId, 'work-0001');
  assert.equal(JSON.parse((await inCheckout('where', '--cwd', root)).stdout).matches[0].via[0], 'inside');

  // Created in the project the folder belongs to.
  const created = JSON.parse((await inCheckout('work', 'create', '--title', 'Checkout flow')).stdout);
  assert.deepEqual([created.workId, created.path, created.planningFolder, created.designStatus], ['work-0002', 'active/0002-checkout-flow', root, 'draft']);
  assert.equal((await json('work', 'accept', 'work-0002')).designStatus, 'accepted');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'Plan');
  const started = await json('work', 'start', 'work-0002', '--step', 'Build', '--step', 'Review');
  assert.deepEqual(started.steps.map((step: { title: string; status: string }) => [step.title, step.status]), [['Understand the request', 'done'], ['Settle the design', 'done'], ['Write the plan', 'done'], ['Accepted', 'done'], ['Build', 'todo'], ['Review', 'todo']], 'after the planning steps, done on acceptance');
  assert.deepEqual(started.warnings, [], 'the plan was committed');
  assert.equal((await json('work', 'step', 'add', 'work-0002', 'Ship', 'Announce')).steps.length, 8);
  assert.equal((await json('work', 'step', 'set', 'work-0002', 'Build', 'doing')).steps[4].status, 'doing');
  assert.equal((await json('work', 'step', 'rename', 'work-0002', 'Announce', 'Tell people')).steps[7].title, 'Tell people');
  assert.equal((await json('work', 'step', 'remove', 'work-0002', 'Tell people')).steps.length, 7);
  assert.equal((await json('work', 'block', 'work-0002', 'Waiting for review')).blocked, 'Waiting for review');

  const refused = await inRoot('work', 'close', 'work-0002');
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /^atlas: work-0002 cannot close while items are open\..*\n  - Step "Build" is doing\.\n  - Step "Review" is todo\.\n  - Step "Ship" is todo\.\n  - Blocked: Waiting for review\n$/s);
  assert.equal((await json('work', 'block', 'work-0002', '--clear')).blocked, null);
  for (const step of ['Build', 'Review', 'Ship']) await json('work', 'step', 'set', 'work-0002', step, 'done');
  const closed = await json('work', 'close', 'work-0002');
  assert.deepEqual([closed.path, closed.implementationStatus], ['archive/0002-checkout-flow', 'complete']);
  assert.equal((await json('work', 'status', 'work-0002')).location, 'archive');
  assert.equal((await json('work', 'reopen', 'work-0002', '--step', 'Fix a bug')).path, 'active/0002-checkout-flow');
  assert.match((await inRoot('work', 'archive', 'work-0001')).stderr, /^atlas: work-0001 is not complete: archive it as superseded/);
  const archived = await json('work', 'archive', 'work-0001', '--superseded-by', 'work-0002', '--reason', 'The checkout flow covers it');
  assert.deepEqual([archived.path, archived.designStatus], ['archive/0001-cart', 'superseded']);
  assert.ok(readFileSync(path.join(root, 'README.md'), 'utf8').includes('[Cart](archive/0001-cart/plan.md)'), 'links follow the move');
  assert.equal((await run(['check', root], { env })).status, 0);

  // Refusals exit 1 with the reason; usage errors exit 2.
  assert.match((await inRoot('work', 'start', 'work-0001', '--step', 'X')).stderr, /^atlas: The design is superseded; accept it/);
  assert.equal((await inRoot('work', 'status', 'work-0042')).status, 1);
  for (const args of [['work'], ['work', 'status'], ['work', 'step', 'set', 'work-0002', 'Build', 'finished'], ['work', 'block', 'work-0002'], ['work', 'start', 'work-0002'], ['work', 'archive', 'work-0002', '--abandoned', '--superseded-by', 'work-0001', '--reason', 'x'], ['work', 'fly', 'work-0002']]) {
    assert.equal((await inRoot(...args)).status, 2, args.join(' '));
  }
  // Outside every project's folders, a planning folder must be given.
  const elsewhere = await run(['work', 'status', 'work-0001'], { env, cwd: path.dirname(root) });
  assert.equal(elsewhere.status, 1);
  assert.match(elsewhere.stderr, /No project in the Atlas home .* covers/);
});

test('atlas check checks a folder\'s planning folder, files and folders with 0/1 exit codes', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
  const valid = await run(['check'], { env, cwd: checkout });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /no problems/);
  assert.match(valid.stdout, /^WARNING: active\/0001-cart\/plan\.md: no summary: add one to the header/m, 'an active plan without a summary is a warning');
  const plan = path.join(root, 'active/0001-cart/plan.md');
  writeFileSync(plan, planText('work-0001', 'Cart').replace('title: "Cart"', 'title: no'));
  const invalid = await run(['check', plan], { env });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /^ERROR: active\/0001-cart\/plan\.md: title must be a nonempty string$/m);
  assert.equal((await run(['check', path.join(root, 'README.md')], { env })).status, 0, 'findings about other files are not reported');
  assert.equal((await run(['check'], { env, cwd: root })).status, 1, 'inside a planning folder, that folder is checked');
  assert.equal((await run(['check', path.join(root, 'missing.md')], { env })).status, 2);
  const nowhere = temporary(t);
  assert.equal((await run(['check'], { env, cwd: nowhere })).status, 1);
});

test('atlas project create makes a project covering folders, which then decide where a session belongs', async t => {
  const { home, root, directory, checkout, env } = homeWithPlanning(t);
  const inDirectory = (...args: string[]) => run(args, { env, cwd: directory });
  // The folder holds the shop's checkout, which shop-planning covers, and the home.
  const created = await inDirectory('project', 'create', '--name', 'Shop work', '--folder', '.', '--json');
  assert.equal(created.status, 0, created.stderr);
  const planningFolder = path.join(home, 'planning', 'shop-work');
  assert.deepEqual(JSON.parse(created.stdout), { name: 'Shop work', planningFolder, folders: [directory] });
  for (const file of ['AGENTS.md', 'PLANS.md', 'README.md', 'plan-frontmatter.md', '.gitattributes', '.git']) assert.ok(existsSync(path.join(planningFolder, file)), file);
  assert.match(git(planningFolder, 'log', '--format=%s'), /^Create the Shop work project/);
  assert.equal((await run(['check', planningFolder], { env })).status, 0);
  assert.deepEqual(JSON.parse((await run(['home'], { env })).stdout).projects.map((item: { name: string }) => item.name), ['shop-planning', 'Shop work']);
  // A session in the folder belongs to the new project; in the shop's checkout, to the project of that deeper folder.
  const where = async (cwd: string) => JSON.parse((await run(['where'], { env, cwd })).stdout).matches.map((match: { project: string; via: string[] }) => [match.project, match.via]);
  write(path.join(directory, 'notes', 'todo.md'), '# To do\n');
  assert.deepEqual(await where(path.join(directory, 'notes')), [['Shop work', ['folder']]]);
  assert.deepEqual(await where(checkout), [['shop-planning', ['folder']]]);
  // Work there gets its summary.
  const work = JSON.parse((await run(['work', 'create', '--title', 'Returns', '--summary', 'Returns by post. Not started.'], { env, cwd: path.join(directory, 'notes') })).stdout);
  assert.deepEqual([work.workId, work.summary, work.planningFolder], ['work-0001', 'Returns by post. Not started.', planningFolder]);
  assert.equal(JSON.parse((await run(['work', 'create', '--title', 'Cart again'], { env, cwd: checkout })).stdout).planningFolder, root);
  // Said plainly without --json, with folders or none; usage errors exit 2.
  const other = path.join(directory, 'other');
  const plain = await inDirectory('project', 'create', '--name', 'Other', '--folder', other);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^Created the project Other in .*other, covering .*other\.\n$/);
  const bare = await inDirectory('project', 'create', '--name', 'Bare');
  assert.match(bare.stdout, /^Created the project Bare in .*bare; it covers no folders yet/);
  for (const args of [['project', 'make'], ['project', 'create']]) assert.equal((await inDirectory(...args)).status, 2, args.join(' '));
});

test('atlas home lists the home\'s projects', async t => {
  const { home, root, env } = homeWithPlanning(t);
  const listed = await run(['home'], { env });
  assert.deepEqual(JSON.parse(listed.stdout), { home, projects: [{ name: 'shop-planning', planningFolder: root }] });
  assert.deepEqual(JSON.parse((await run(['home', 'list'], { env })).stdout), JSON.parse(listed.stdout));
});
