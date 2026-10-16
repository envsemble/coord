// The host's projects on 127.0.0.1: the home's planning folders and those outside it, listed with
// their summaries and statistics, created, changed, searched and moved into the home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createReport, HomeDatabase, insertReport } from '@envsemble/atlas-planning';
import type { HostRequestError } from './client.ts';
import { client, fixture, pairDevice, projectNamed, start, temporary, until } from './testing.ts';

test('projects are the home\'s planning folders: created from the templates, renamed, hidden, archived and ordered', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Northwind']);
  // The list has what each project's card says: its repositories, its active work and where each item stands, its last change, and the work agents are on now.
  const summary = (await projectNamed(device.connection)).summary!;
  assert.deepEqual([summary.repositories, summary.active.length, summary.active.filter(item => item.state === 'blocked').length, summary.active.filter(item => item.state === 'implementing').length, summary.updated, summary.live],
    [['shop'], 3, 1, 1, null, []]);
  assert.ok(summary.active.every(item => item.title), 'each item has its title');
  // Each item's steps (none without a ledger that lists them) and last change, and the closed work with how it ended.
  assert.deepEqual(summary.active.map(item => [item.id, item.steps === null ? null : item.steps.total > 0, item.updated, item.outcome]),
    [['work-0001', true, '2026-09-30', null], ['work-0002', null, '2026-10-07', null], ['work-0003', null, '2026-10-02', null]]);
  assert.deepEqual(summary.closed.map(item => [item.id, item.state, item.updated, item.outcome]), [['work-0004', 'closed', '2026-09-24', 'complete']]);
  // A session in a turn, linked to a work item, makes it live.
  const database = HomeDatabase.open(data);
  try {
    const project = database.projectByFolder(path.join(data, 'planning', 'planning'))!;
    const now = new Date().toISOString();
    database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working) VALUES (?, ?, NULL, ?, ?, 1)').run('session-1', 'claude-code', now, now);
    database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at) VALUES (?, ?, ?, ?)').run('session-1', project.id, 'work-0001', now);
  } finally { database.close(); }
  assert.deepEqual((await projectNamed(owner.connection)).summary?.live.map(item => item.workId), ['work-0001']);
  // A device creates one: a Git repository in the home with the templates, its name and its repositories.
  const coord = await device.connection.request('projects.create', { name: 'Coord', workspaces: [], repositories: [{ id: 'coord-web', name: 'Coord web', remote: 'git@github.com:example/coord-web.git' }, { id: 'platform', name: 'Platform', remote: null }] });
  assert.deepEqual([coord.name, coord.path, coord.position, coord.state], ['Coord', path.join(data, 'planning', 'coord'), 1, 'active']);
  const registry = JSON.parse(readFileSync(path.join(coord.path, 'planning.json'), 'utf8'));
  assert.deepEqual([registry.name, registry.repositories], ['Coord', [{ id: 'coord-web', name: 'Coord web', remote: 'git@github.com:example/coord-web.git' }, { id: 'platform', name: 'Platform' }]]);
  for (const file of ['AGENTS.md', 'PLANS.md', 'README.md', 'plan-frontmatter.md', '.gitattributes', '.git']) assert.ok(existsSync(path.join(coord.path, file)), file);
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync('git', ['-C', coord.path, 'log', '--format=%s'], { encoding: 'utf8' }), /^Create the Coord project/);
  assert.equal((await device.connection.request('projects.create', { name: 'Coord', workspaces: [], repositories: [] })).path, path.join(data, 'planning', 'coord-2'), 'a taken name gets a number');
  await assert.rejects(device.connection.request('projects.create', { name: 'Bad', workspaces: [], repositories: [{ id: 'Not An ID', name: 'x', remote: null }] }), (error: HostRequestError) => error.code === 'invalid-argument');
  await until(() => owner.lists.some(list => list.length === 3), 5000, () => owner.lists);
  // The lists clients are sent have the summaries too (a new project's folder has its first commit); a single project answered has none.
  const sent = owner.lists.find(list => list.length === 3)!.find(project => project.folderId === coord.folderId)!;
  assert.deepEqual({ ...sent.summary, updated: typeof sent.summary?.updated }, { repositories: ['coord-web', 'platform'], active: [], closed: [], updated: 'string', live: [] });
  assert.equal('summary' in coord, false);
  // Renaming writes the name into its planning.json; hiding, archiving and moving change only the order and state.
  const renamed = await owner.connection.request('projects.update', { folderId: coord.folderId, name: 'Coord platform' });
  assert.equal(renamed.name, 'Coord platform');
  assert.equal('summary' in renamed, false);
  assert.equal(JSON.parse(readFileSync(path.join(coord.path, 'planning.json'), 'utf8')).name, 'Coord platform');
  await owner.connection.request('projects.update', { folderId: coord.folderId, position: 0 });
  const second = (await owner.connection.request('projects.list', {}))[2];
  await owner.connection.request('projects.update', { folderId: second.folderId, state: 'archived' });
  const planningProject = await projectNamed(owner.connection);
  await owner.connection.request('projects.update', { folderId: planningProject.folderId, state: 'hidden' });
  assert.deepEqual((await device.connection.request('projects.list', {})).map(project => [project.name, project.position, project.state]), [['Coord platform', 0, 'active'], ['Northwind', 1, 'hidden'], ['Coord', 2, 'archived']]);
  // A planning folder that appears in the home becomes the last project; one that leaves it is no longer listed.
  cpSync(fixture, path.join(data, 'planning', 'later'), { recursive: true });
  await until(() => owner.lists.some(list => list.some(project => project.path === path.join(data, 'planning', 'later'))), 5000, () => owner.lists);
  assert.equal((await owner.connection.request('projects.list', {})).find(project => project.path === path.join(data, 'planning', 'later'))?.position, 3);
  rmSync(path.join(data, 'planning', 'coord-2'), { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Coord platform', 'Northwind', 'Northwind']);
  await assert.rejects(owner.connection.request('projects.update', { folderId: 'f-' + 'a'.repeat(32), state: 'active' }), (error: HostRequestError) => error.code === 'not-found');
});

test('a project covers workspace folders: their checkouts are found, registered when it is made, and when it gets more', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  const { execFileSync } = await import('node:child_process');
  const checkout = (folder: string, remote: string | null) => {
    mkdirSync(folder, { recursive: true });
    execFileSync('git', ['-C', folder, 'init', '-q'], { windowsHide: true });
    if (remote) execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', remote], { windowsHide: true });
  };
  const workspace = path.join(data, 'workspace'), more = path.join(data, 'more');
  checkout(path.join(workspace, 'web'), 'https://github.com/example/web.git');
  checkout(path.join(workspace, 'scratch'), null);
  mkdirSync(path.join(workspace, 'notes'));
  checkout(path.join(more, 'api'), 'git@github.com:example/api.git');
  // The app's preview: the checkouts in a folder, as a new project would register them.
  assert.deepEqual(await owner.connection.request('projects.scan', { folder: workspace }), {
    folder: workspace, repositories: [{ id: 'scratch', name: 'scratch', remote: null }, { id: 'web', name: 'web', remote: 'https://github.com/example/web.git' }],
  });
  await assert.rejects(owner.connection.request('projects.scan', { folder: path.join(data, 'missing') }), (error: HostRequestError) => error.code === 'invalid-argument' && /does not exist/.test(error.message));
  await assert.rejects(device.connection.request('projects.scan', { folder: workspace }), (error: HostRequestError) => error.code === 'forbidden', 'a folder on this computer is the app\'s to look at');
  // Made from the folder: its checkouts are registered, one without a remote by its path.
  // A paired device may not choose folders on this computer: refused before any path is looked at.
  const forbidden = (error: HostRequestError) => error.code === 'forbidden' && !error.message.includes(data);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web', workspaces: [path.join(data, 'missing')] }), forbidden);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web', workspaces: [workspace] }), forbidden);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web' } as never), (error: HostRequestError) => error.code === 'invalid-argument', 'the folders are part of the request');
  const web = await owner.connection.request('projects.create', { name: 'Web', workspaces: [workspace] });
  assert.deepEqual(web.workspaces, [workspace]);
  const registry = () => JSON.parse(readFileSync(path.join(web.path, 'planning.json'), 'utf8'));
  assert.deepEqual([registry().workspaces, registry().repositories], [[workspace], [{ id: 'scratch', name: 'scratch', path: path.join(workspace, 'scratch') }, { id: 'web', name: 'web', remote: 'https://github.com/example/web.git' }]]);
  await assert.rejects(owner.connection.request('projects.create', { name: 'Gone', workspaces: [path.join(data, 'missing')] }), (error: HostRequestError) => error.code === 'invalid-argument');
  // Another folder registers what it holds; the list shows the folders.
  const updated = await owner.connection.request('projects.update', { folderId: web.folderId, workspaces: [workspace, more] });
  assert.deepEqual(updated.workspaces, [workspace, more]);
  assert.deepEqual(registry().repositories.map((item: { id: string }) => item.id), ['scratch', 'web', 'api']);
  assert.deepEqual((await projectNamed(owner.connection, 'Web')).workspaces, [workspace, more]);
  // A refused change changes nothing, not even the name sent with it; a device may not change the folders.
  await assert.rejects(owner.connection.request('projects.update', { folderId: web.folderId, name: 'Renamed', workspaces: [path.join(data, 'missing')] }), (error: HostRequestError) => error.code === 'invalid-argument');
  assert.equal(registry().name, 'Web');
  await assert.rejects(device.connection.request('projects.update', { folderId: web.folderId, workspaces: [] }), forbidden);
  assert.equal((await device.connection.request('projects.update', { folderId: web.folderId, name: 'Web site' })).name, 'Web site', 'the rest it may change');
  assert.deepEqual((await projectNamed(owner.connection)).workspaces, [], 'a project without workspace folders has none');
});

test('a project whose planning.json cannot be read is listed without a summary', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  mkdirSync(path.join(data, 'planning', 'broken'));
  writeFileSync(path.join(data, 'planning', 'broken', 'planning.json'), '{ "name": "Broken", ');
  const listed = await owner.connection.request('projects.list', {});
  assert.deepEqual(listed.map(project => [project.name, project.summary === null]).sort(), [['Northwind', false], ['broken', true]]);
});

test('the project list has each work item\'s step, completion and statistics from the home database\'s reports', async t => {
  const { host, origin, data } = await start(t, { liveCheck: 100 });
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const project = host.database.projectByFolder(path.join(data, 'planning', 'planning'))!;
  const measured = (since: string, agentMs: number, output: number) => ({ since, agentMs, models: [{ model: 'claude-opus', agentMs, input: 0, cacheRead: 0, cacheWrite: 0, output }] });
  insertReport(host.database, project.id, 'work-0001', createReport({ model: 'claude-opus', session: 's1', stage: 'planning', at: new Date('2026-10-01T10:00:00Z'), measured: measured('2026-10-01T09:00:00.000Z', 3_600_000, 1000) }));
  insertReport(host.database, project.id, 'work-0001', createReport({ model: 'claude-sonnet', session: 's2', stage: 'implementation', at: new Date('2026-10-02T10:00:00Z'), measured: { ...measured('2026-10-02T09:30:00.000Z', 1_800_000, 500), models: [{ model: 'claude-sonnet', agentMs: 1_800_000, input: 0, cacheRead: 0, cacheWrite: 0, output: 500 }] } }));
  const summary = (await projectNamed(owner.connection)).summary!;
  const work = (id: string) => [...summary.active, ...summary.closed].find(item => item.id === id)!;
  assert.deepEqual(work('work-0001').step, { title: 'Add authoriseWithToken to the acquirer gateway, with the challenge_required path (shop#58)', status: 'doing', phase: 'implementation' });
  assert.deepEqual(work('work-0001').statistics, {
    agentMs: 5_400_000, tokens: 1500, primaryModel: 'claude-opus', otherModels: 1, planning: { agentMs: 3_600_000, tokens: 1000 }, implementation: { agentMs: 1_800_000, tokens: 500 },
    subagents: 0, lastReport: '2026-10-02T10:00:00.000Z',
  });
  assert.deepEqual([work('work-0002').statistics, work('work-0003').step, work('work-0001').completed], [null, null, null], 'no reports, no steps (a ledger from before steps), open');
  assert.equal(work('work-0004').completed, '2026-09-24');
  // A report recorded with nothing else changing reaches clients with the next check.
  insertReport(host.database, project.id, 'work-0002', createReport({ model: 'claude-opus', session: 's3', stage: 'planning', at: new Date('2026-10-03T10:00:00Z') }));
  const sent = () => owner.lists.at(-1)?.find(item => item.name === 'Northwind')?.summary?.active.find(item => item.id === 'work-0002')?.statistics;
  await until(() => sent()?.lastReport === '2026-10-03T10:00:00.000Z', 5000, () => owner.lists.length);
});

test('the search covers every active project, in the home or outside it, best first', async t => {
  const { host, origin, data, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  // Another project in the home, hidden; one outside it, active.
  const hidden = path.join(data, 'planning', 'hidden');
  cpSync(fixture, hidden, { recursive: true });
  writeFileSync(path.join(hidden, 'knowledge', 'secret.md'), '# Hidden walrus\n');
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Coord planning');
  cpSync(fixture, outside, { recursive: true });
  writeFileSync(path.join(outside, 'planning.json'), readFileSync(path.join(outside, 'planning.json'), 'utf8').replace('"Northwind"', '"Coord"'));
  writeFileSync(path.join(outside, 'knowledge', 'walrus.md'), '# Outside walrus\n\nA walrus lives outside the home.\n');
  const database = HomeDatabase.open(data);
  try { database.addProject(realpathSync.native(outside), 'Coord', null, 'active'); } finally { database.close(); }
  const listed = await owner.connection.request('projects.list', {});
  const northwind = listed.find(project => project.path === planning)!, coord = listed.find(project => project.name === 'Coord')!;
  await owner.connection.request('projects.update', { folderId: listed.find(project => project.path === hidden)!.folderId, state: 'hidden' });
  const search = (query: string, limit?: number) => device.connection.request('search.query', limit === undefined ? { query } : { query, limit });
  // Each kind, where it opens (the two projects have the same plans: Northwind's best).
  const first = async (query: string, project = 'Northwind') => (await search(query)).find(hit => hit.project === project)!;
  assert.deepEqual(await first('Saved payment methods'), { kind: 'plan', title: 'Saved payment methods', snippet: null, folderId: northwind.folderId, project: 'Northwind', work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md', anchor: null, element: null });
  assert.deepEqual(await first('#0002').then(hit => [hit.kind, hit.work]), ['plan', 'work-0002']);
  assert.deepEqual(await first('Sandbox run forced').then(hit => [hit.kind, hit.work, hit.path]), ['step', 'work-0001', 'active/0001-saved-payment-methods/plan.md']);
  assert.deepEqual(await first('Order status').then(hit => [hit.kind, hit.path, hit.anchor]), ['heading', 'active/0002-order-fulfilment-model/plan.md', 'order-status']);
  assert.deepEqual((await search('carrier')).filter(hit => hit.kind === 'term' && hit.project === 'Northwind').map(hit => [hit.title, hit.path, hit.anchor]), [['Carrier', 'active/0002-order-fulfilment-model/CONTEXT.md', 'shipments']]);
  assert.deepEqual((await search('conceptual model')).filter(hit => hit.kind === 'diagram' && hit.project === 'Northwind').map(hit => [hit.title, hit.path, hit.work]), [['Fulfilment · conceptual model', 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml', 'work-0002']]);
  assert.deepEqual(await first('savedpaymentmethod').then(hit => [hit.kind, hit.element, hit.work]), ['element', 'SavedPaymentMethod', 'work-0001']);
  assert.deepEqual(await first('Payments constraints').then(hit => [hit.kind, hit.path, hit.work]), ['document', 'knowledge/shop/payments-constraints.md', null]);
  assert.deepEqual(await first('Coord', 'Coord').then(hit => [hit.kind, hit.folderId, hit.path]), ['project', coord.folderId, null]);
  const text = await first('lives outside', 'Coord');
  assert.deepEqual([text.kind, text.project, text.snippet], ['document', 'Coord', 'A walrus lives outside the home.'], 'text, with its snippet');
  // Every active project, never a hidden one; best first, at most the limit.
  const walrus = await search('walrus');
  assert.deepEqual(walrus.map(hit => [hit.project, hit.title]), [['Coord', 'Outside walrus']], 'a hidden project is not searched');
  const both = await search('saved payment methods');
  assert.deepEqual([...new Set(both.slice(0, 2).map(hit => hit.kind + ':' + hit.project))].sort(), ['plan:Coord', 'plan:Northwind'], 'both active projects\' plans first');
  assert.equal((await search('e')).length, 50, 'at most 50 by default');
  assert.deepEqual(await search('e', 3), (await search('e')).slice(0, 3), 'or the limit given');
  // The request is checked.
  for (const params of [{ query: '' }, { query: 'x'.repeat(201) }, { query: 'x', limit: 0 }, { query: 'x', limit: 201 }, { limit: 5 }]) {
    await assert.rejects(owner.connection.request('search.query', params as never), (error: HostRequestError) => error.code === 'invalid-argument', JSON.stringify(params));
  }
  assert.deepEqual(await search('   '), [], 'a query of spaces finds nothing');
});

test('a project outside the home is listed, marked, until it moves into the home with its statistics', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Shop planning');
  cpSync(fixture, outside, { recursive: true });
  mkdirSync(path.join(outside, 'active/0001-saved-payment-methods/.atlas'), { recursive: true });
  writeFileSync(path.join(outside, 'active/0001-saved-payment-methods/.atlas/statistics.jsonl'), JSON.stringify({ version: 1, at: '2026-10-01T10:00:00.000Z', model: 'model-a', session: null, tokens: null, step: null }) + '\n');
  // Read and written beside the host's own connection, and closed before its home is removed.
  const database = HomeDatabase.open(data);
  try {
    const row = database.addProject(realpathSync.native(outside), 'Northwind', null, 'hidden');
    // Another project, whose folder is gone, was last where the folder would go: that name stays its own.
    database.addProject(path.join(data, 'planning', 'Shop-planning'), 'Gone', null, 'archived');
    const projects = (await owner.connection.request('projects.list', {})).filter(project => project.name !== 'Gone');
    assert.deepEqual(projects.map(project => [project.path, project.outsideHome]), [[realpathSync.native(outside), true], [path.join(data, 'planning', 'planning'), false]]);
    const listed = projects[0];
    await owner.connection.follow(listed.folderId);
    // A move that is refused (not a Git repository yet) leaves the folder followed where it is.
    await assert.rejects(owner.connection.request('projects.adopt', { folderId: listed.folderId }), /not the top of a Git repository/);
    assert.equal((await owner.connection.request('folder.snapshot', { folderId: listed.folderId })).work.length, 4);
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-C', outside, 'init', '-q']);
    const moved = await owner.connection.request('projects.adopt', { folderId: listed.folderId });
    assert.deepEqual([moved.path, moved.outsideHome, moved.state], [path.join(data, 'planning', 'Shop-planning-2'), false, 'hidden']);
    assert.ok(!existsSync(outside) && !existsSync(path.join(moved.path, 'active/0001-saved-payment-methods/.atlas')));
    assert.equal(database.projectByFolder(moved.path)?.id, row.id, 'the project keeps its row, and with it its tabs');
    assert.equal((database.db.prepare("SELECT count(*) AS n FROM work_report WHERE project_id = ? AND at = '2026-10-01T10:00:00.000Z'").get(row.id) as { n: number }).n, 1);
    assert.notEqual(moved.folderId, listed.folderId);
    await assert.rejects(owner.connection.request('folder.snapshot', { folderId: listed.folderId }), (error: HostRequestError) => error.code === 'forbidden');
    await assert.rejects(owner.connection.request('projects.adopt', { folderId: moved.folderId }), /in the Atlas home already/);
  } finally { database.close(); }
});
