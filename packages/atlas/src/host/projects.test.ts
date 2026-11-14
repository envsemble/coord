// The host's projects on 127.0.0.1: the home's planning folders, listed with their summaries and
// statistics, created, changed and searched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HomeDatabase } from '../home/database.ts';
import { createReport, insertReport } from '../planning/reports/reports.ts';
import type { HostRequestError } from './client.ts';
import { client, fixture, pairDevice, projectNamed, start, temporary, until } from './testing.ts';

test('projects are the home\'s planning folders: created from the templates, renamed, archived and ordered', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Northwind']);
  // The list has what each project's card says: its active work and where each item stands, its last change, and the work agents are on now.
  const summary = (await projectNamed(device.connection)).summary!;
  assert.deepEqual([summary.active.length, summary.active.filter(item => item.state === 'blocked').length, summary.active.filter(item => item.state === 'implementing').length, summary.updated, summary.activity],
    [3, 1, 1, null, []]);
  assert.ok(summary.active.every(item => item.title), 'each item has its title');
  // Each item's steps and last change, and the closed work with how it ended.
  assert.deepEqual(summary.active.filter(item => item.id !== 'work-0003').map(item => [item.id, item.steps === null ? null : item.steps.total > 0, item.updated, item.outcome]),
    [['work-0001', true, '2026-09-30', null], ['work-0002', true, '2026-10-07', null]]);
  assert.deepEqual(summary.closed.map(item => [item.id, item.state, item.updated, item.outcome]), [['work-0004', 'closed', '2026-09-24', 'complete']]);
  // A session in a turn, linked to a work item, makes it live.
  const database = HomeDatabase.open(data);
  try {
    const project = database.projectByFolder(path.join(data, 'planning', 'planning'))!;
    const now = new Date().toISOString();
    database.db.prepare('INSERT INTO session (id, harness, transcript_path, started_at, updated_at, working, turn_at) VALUES (?, ?, NULL, ?, ?, 1, ?)').run('session-1', 'claude-code', now, now, now);
    const { lastInsertRowid } = database.db.prepare('INSERT INTO session_work (session_id, project_id, work_id, linked_at, touched_at) VALUES (?, ?, ?, ?, ?)').run('session-1', project.id, 'work-0001', now, now);
    database.db.prepare('UPDATE session SET focus = ? WHERE id = ?').run(Number(lastInsertRowid), 'session-1');
  } finally { database.close(); }
  assert.deepEqual((await projectNamed(owner.connection)).summary?.activity.map(item => [item.workId, item.state]), [['work-0001', 'working']]);
  // A device creates one: a Git repository in the home with the templates and its name.
  const harbor = await device.connection.request('projects.create', { name: 'Harbor', folders: [] });
  assert.deepEqual([harbor.name, harbor.path, harbor.position, harbor.state, harbor.folders], ['Harbor', path.join(data, 'planning', 'harbor'), 1, 'active', []]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(harbor.path, 'planning.json'), 'utf8')), { schema_version: 2, name: 'Harbor', folders: [], work_items: [] });
  for (const file of ['AGENTS.md', 'PLANS.md', 'README.md', 'plan-frontmatter.md', '.gitattributes', '.git']) assert.ok(existsSync(path.join(harbor.path, file)), file);
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync('git', ['-C', harbor.path, 'log', '--format=%s'], { encoding: 'utf8' }), /^Create the Harbor project/);
  assert.equal((await device.connection.request('projects.create', { name: 'Harbor', folders: [] })).path, path.join(data, 'planning', 'harbor-2'), 'a taken name gets a number');
  await assert.rejects(device.connection.request('projects.create', { name: ' ', folders: [] }), (error: HostRequestError) => error.code === 'invalid-argument');
  await until(() => owner.lists.some(list => list.length === 3), 5000, () => owner.lists);
  // The lists clients are sent have the summaries too (a new project's folder has its first commit); a single project answered has none.
  const sent = owner.lists.find(list => list.length === 3)!.find(project => project.id === harbor.id)!;
  assert.deepEqual({ ...sent.summary, updated: typeof sent.summary?.updated, now: typeof sent.summary?.now }, { active: [], closed: [], updated: 'string', activity: [], now: 'string' });
  assert.equal('summary' in harbor, false);
  // Renaming writes the name into its planning.json; hiding, archiving and moving change only the order and state.
  const renamed = await owner.connection.request('projects.update', { projectId: harbor.id, name: 'Harbor platform' });
  assert.equal(renamed.name, 'Harbor platform');
  assert.equal('summary' in renamed, false);
  assert.equal(JSON.parse(readFileSync(path.join(harbor.path, 'planning.json'), 'utf8')).name, 'Harbor platform');
  await owner.connection.request('projects.update', { projectId: harbor.id, position: 0 });
  const second = (await owner.connection.request('projects.list', {}))[2];
  await owner.connection.request('projects.update', { projectId: second.id, state: 'archived' });
  const planningProject = await projectNamed(owner.connection);
  // Projects are active or archived: there is no hiding them any more.
  await assert.rejects(owner.connection.request('projects.update', { projectId: planningProject.id, state: 'hidden' as never }), (error: HostRequestError) => error.code === 'invalid-argument');
  assert.deepEqual((await device.connection.request('projects.list', {})).map(project => [project.name, project.position, project.state]), [['Harbor platform', 0, 'active'], ['Northwind', 1, 'active'], ['Harbor', 2, 'archived']]);
  // A planning folder that appears in the home becomes the last project; one that leaves it is no longer listed.
  cpSync(fixture, path.join(data, 'planning', 'later'), { recursive: true });
  await until(() => owner.lists.some(list => list.some(project => project.path === path.join(data, 'planning', 'later'))), 5000, () => owner.lists);
  assert.equal((await owner.connection.request('projects.list', {})).find(project => project.path === path.join(data, 'planning', 'later'))?.position, 3);
  rmSync(path.join(data, 'planning', 'harbor-2'), { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual((await owner.connection.request('projects.list', {})).map(project => project.name), ['Harbor platform', 'Northwind', 'Northwind']);
  await assert.rejects(owner.connection.request('projects.update', { projectId: 'f-' + 'a'.repeat(32), state: 'active' }), (error: HostRequestError) => error.code === 'not-found');
});

test('a project covers folders: set when it is made and changed later, only by the app on this computer', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  const workspace = path.join(data, 'workspace'), more = path.join(data, 'more');
  // A paired device may not choose folders on this computer: refused before any path is looked at.
  const forbidden = (error: HostRequestError) => error.code === 'forbidden' && !error.message.includes(data);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web', folders: [workspace] }), forbidden);
  await assert.rejects(device.connection.request('projects.create', { name: 'Web' } as never), (error: HostRequestError) => error.code === 'invalid-argument', 'the folders are part of the request');
  const web = await owner.connection.request('projects.create', { name: 'Web', folders: [workspace] });
  assert.deepEqual(web.folders, [workspace]);
  const registry = () => JSON.parse(readFileSync(path.join(web.path, 'planning.json'), 'utf8'));
  assert.deepEqual(registry().folders, [workspace]);
  await assert.rejects(owner.connection.request('projects.create', { name: 'Relative', folders: ['relative'] }), (error: HostRequestError) => error.code === 'invalid-argument');
  // Another folder; the list shows the folders.
  const updated = await owner.connection.request('projects.update', { projectId: web.id, folders: [workspace, more] });
  assert.deepEqual(updated.folders, [workspace, more]);
  assert.deepEqual(registry().folders, [workspace, more]);
  assert.deepEqual((await projectNamed(owner.connection, 'Web')).folders, [workspace, more]);
  // A refused change changes nothing, not even the name sent with it; a device may not change the folders.
  await assert.rejects(owner.connection.request('projects.update', { projectId: web.id, name: 'Renamed', folders: ['relative'] }), (error: HostRequestError) => error.code === 'invalid-argument');
  assert.equal(registry().name, 'Web');
  await assert.rejects(device.connection.request('projects.update', { projectId: web.id, folders: [] }), forbidden);
  assert.equal((await device.connection.request('projects.update', { projectId: web.id, name: 'Web site' })).name, 'Web site', 'the rest it may change');
  assert.deepEqual((await projectNamed(owner.connection)).folders, [], 'a project without folders has none');
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
  assert.deepEqual(work('work-0001').step, { title: 'Add authoriseWithToken to the acquirer gateway, with the challenge_required path (example/shop#58)', status: 'doing', phase: 'implementation' });
  assert.deepEqual(work('work-0001').statistics, {
    agentMs: 5_400_000, activeMs: 5_400_000, unmergedMs: 5_400_000, tokens: 1500, primaryModel: 'claude-opus', primaryEffort: null, otherModels: 1, planning: { agentMs: 3_600_000, tokens: 1000 }, implementation: { agentMs: 1_800_000, tokens: 500 },
    subagents: 0, lastReport: '2026-10-02T10:00:00.000Z',
  });
  assert.deepEqual([work('work-0002').statistics, work('work-0002').step?.title, work('work-0001').completed], [null, 'Settle the design', null], 'no reports, the planning step it is on, open');
  assert.equal(work('work-0004').completed, '2026-09-24');
  // A report recorded with nothing else changing reaches clients with the next check, in the list
  // and in the plan's statistics: a session and its subagent, each in full, and the hour at least one worked.
  const projectId = (await projectNamed(owner.connection)).id;
  await owner.connection.follow(projectId);
  insertReport(host.database, project.id, 'work-0002', createReport({ model: 'claude-opus', session: 's3', stage: 'planning', at: new Date('2026-10-03T10:00:00Z'), measured: {
    ...measured('2026-10-03T09:00:00.000Z', 5_400_000, 100), subagents: { count: 1, agentMs: 1_800_000, tokens: 0, agents: [{ id: 'a1', model: null, agentMs: 1_800_000, tokens: 0 }] },
    intervals: [{ agent: null, start: '2026-10-03T09:00:00.000Z', end: '2026-10-03T10:00:00.000Z' }, { agent: 'a1', start: '2026-10-03T09:30:00.000Z', end: '2026-10-03T10:00:00.000Z' }],
  } }));
  const sent = () => owner.lists.at(-1)?.find(item => item.name === 'Northwind')?.summary?.active.find(item => item.id === 'work-0002')?.statistics;
  await until(() => sent()?.lastReport === '2026-10-03T10:00:00.000Z', 5000, () => owner.lists.length);
  assert.deepEqual([sent()?.agentMs, sent()?.activeMs, sent()?.unmergedMs], [5_400_000, 3_600_000, 0]);
  // A change of the statistics alone: the files were not read again, and the work items alone tell it.
  const shown = async () => (await owner.connection.request('project.work', { projectId })).find(item => item.id === 'work-0002')?.statistics;
  await until(() => owner.events.some(event => event.projectId === projectId && event.revision > event.files), 5000);
  assert.deepEqual([(await shown())?.activeMs, (await shown())?.agents], [3_600_000, [{ session: 's3', subagent: null, model: 'claude-opus', effort: null, agentMs: 3_600_000 }, { session: 's3', subagent: 'a1', model: null, effort: null, agentMs: 1_800_000 }]]);
});

test('the search covers every active project of the home, best first', async t => {
  const { host, origin, data, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const device = await pairDevice(t, host, owner.connection);
  // Another project in the home, archived, and another active one; a folder outside the home that a
  // row of the database names is no project.
  const archived = path.join(data, 'planning', 'archived');
  cpSync(fixture, archived, { recursive: true });
  writeFileSync(path.join(archived, 'notes', 'secret.md'), '# Archived walrus\n');
  const other = path.join(data, 'planning', 'harbor');
  cpSync(fixture, other, { recursive: true });
  writeFileSync(path.join(other, 'planning.json'), readFileSync(path.join(other, 'planning.json'), 'utf8').replace('"Northwind"', '"Harbor"'));
  writeFileSync(path.join(other, 'notes', 'walrus.md'), '# Harbor walrus\n\nA walrus lives in Harbor.\n');
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Outside planning');
  cpSync(fixture, outside, { recursive: true });
  writeFileSync(path.join(outside, 'notes', 'walrus.md'), '# Outside walrus\n');
  const database = HomeDatabase.open(data);
  try { database.addProject(realpathSync.native(outside), 'Outside', null, 'active'); } finally { database.close(); }
  const listed = await owner.connection.request('projects.list', {});
  assert.ok(!listed.some(project => project.path === realpathSync.native(outside)), 'a folder outside the home is not listed');
  const northwind = listed.find(project => project.path === planning)!, harbor = listed.find(project => project.name === 'Harbor')!;
  await owner.connection.request('projects.update', { projectId: listed.find(project => project.path === archived)!.id, state: 'archived' });
  const search = (query: string, limit?: number) => device.connection.request('search.query', limit === undefined ? { query } : { query, limit });
  // Each kind, where it opens (the two projects have the same plans: Northwind's best).
  const first = async (query: string, project = 'Northwind') => (await search(query)).find(hit => hit.projectName === project)!;
  assert.deepEqual(await first('Saved payment methods'), { kind: 'plan', title: 'Saved payment methods', snippet: null, projectId: northwind.id, projectName: 'Northwind', work: 'work-0001', path: 'active/0001-saved-payment-methods/plan.md', anchor: null, element: null });
  assert.deepEqual(await first('#0002').then(hit => [hit.kind, hit.work]), ['plan', 'work-0002']);
  assert.deepEqual(await first('Sandbox run forced').then(hit => [hit.kind, hit.work, hit.path]), ['step', 'work-0001', 'active/0001-saved-payment-methods/plan.md']);
  assert.deepEqual(await first('Order status').then(hit => [hit.kind, hit.path, hit.anchor]), ['heading', 'active/0002-order-fulfilment-model/plan.md', 'order-status']);
  assert.deepEqual((await search('carrier')).filter(hit => hit.kind === 'term' && hit.projectName === 'Northwind').map(hit => [hit.title, hit.path, hit.anchor]), [['Carrier', 'active/0002-order-fulfilment-model/CONTEXT.md', 'shipments']]);
  assert.deepEqual((await search('conceptual model')).filter(hit => hit.kind === 'diagram' && hit.projectName === 'Northwind').map(hit => [hit.title, hit.path, hit.work]), [['Fulfilment · conceptual model', 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml', 'work-0002']]);
  assert.deepEqual(await first('savedpaymentmethod').then(hit => [hit.kind, hit.element, hit.work]), ['element', 'SavedPaymentMethod', 'work-0001']);
  assert.deepEqual(await first('Payments constraints').then(hit => [hit.kind, hit.path, hit.work]), ['document', 'notes/shop/payments-constraints.md', null]);
  assert.deepEqual(await first('Harbor', 'Harbor').then(hit => [hit.kind, hit.projectId, hit.path]), ['project', harbor.id, null]);
  const text = await first('lives in', 'Harbor');
  assert.deepEqual([text.kind, text.projectName, text.snippet], ['document', 'Harbor', 'A walrus lives in Harbor.'], 'text, with its snippet');
  // Every active project of the home, never an archived one or a folder outside the home; best first, at most the limit.
  const walrus = await search('walrus');
  assert.deepEqual(walrus.map(hit => [hit.projectName, hit.title]), [['Harbor', 'Harbor walrus']], 'an archived project, and a folder outside the home, are not searched');
  const both = await search('saved payment methods');
  assert.deepEqual([...new Set(both.slice(0, 2).map(hit => hit.kind + ':' + hit.projectName))].sort(), ['plan:Harbor', 'plan:Northwind'], 'both active projects\' plans first');
  assert.equal((await search('e')).length, 50, 'at most 50 by default');
  assert.deepEqual(await search('e', 3), (await search('e')).slice(0, 3), 'or the limit given');
  // The request is checked.
  for (const params of [{ query: '' }, { query: 'x'.repeat(201) }, { query: 'x', limit: 0 }, { query: 'x', limit: 201 }, { limit: 5 }]) {
    await assert.rejects(owner.connection.request('search.query', params as never), (error: HostRequestError) => error.code === 'invalid-argument', JSON.stringify(params));
  }
  assert.deepEqual(await search('   '), [], 'a query of spaces finds nothing');
});
