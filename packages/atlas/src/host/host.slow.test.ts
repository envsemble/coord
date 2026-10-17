// The host as it waits on file watchers and its own timers: what changes on disk reaches clients once
// it settles, listings queue and give up, and projects made or replaced outside the app are found.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HomeDatabase } from '../planning/index.ts';
import type { Project } from './contract.ts';
import { client, fixture, start, temporary, until } from './testing.ts';

test('the search follows what changes in a project no window has open', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const found = async (query: string) => (await owner.connection.request('search.query', { query })).map(hit => hit.title);
  const eventually = async (query: string, expected: string[]) => {
    let seen: string[] = [];
    for (const deadline = Date.now() + 10000; JSON.stringify(seen = await found(query)) !== JSON.stringify(expected) && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(seen, expected, query);
  };
  // Listed, as the app lists them, the projects are searched; a file written and changed, and a diagram changed, are found.
  await owner.connection.request('projects.list', {});
  assert.deepEqual(await found('narwhal'), []);
  const notes = path.join(planning, 'knowledge', 'notes.md');
  writeFileSync(notes, '# Notes\n\nThe narwhal migrates.\n');
  await eventually('narwhal', ['Notes']);
  writeFileSync(notes, '# Notes\n\nThe beluga migrates.\n');
  await eventually('narwhal', []);
  assert.deepEqual(await found('beluga'), ['Notes']);
  const diagram = path.join(planning, 'active/0002-order-fulfilment-model/diagrams/fulfilment.puml');
  writeFileSync(diagram, readFileSync(diagram, 'utf8').replace('@enduml', 'class Lighthouse\n@enduml'));
  await eventually('lighthouse', ['Lighthouse']);
});

test('plan and ledger edits in a project no window has open reach the project list, once they settle', async t => {
  const { host, origin, planning } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const work = (list: Project[], id: string) => list.find(project => project.name === 'Northwind')?.summary?.active.find(item => item.id === id);
  const settle = () => new Promise(resolve => setTimeout(resolve, 1500));
  const plan = path.join(planning, 'active/0001-saved-payment-methods/plan.md');
  // A plan's header: its summary.
  writeFileSync(plan, readFileSync(plan, 'utf8').replace('title: Saved payment methods\n', 'title: Saved payment methods\nsummary: "Cards saved at checkout."\n'));
  await until(() => owner.lists.some(list => work(list, 'work-0001')?.summary === 'Cards saved at checkout.'), 10000, () => owner.lists.length);
  // A ledger's step.
  const ledger = path.join(planning, 'active/0001-saved-payment-methods/ledger.md');
  const before = work(owner.lists.at(-1)!, 'work-0001')!.steps!.done;
  writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/status: (?:todo|doing)/, 'status: done'));
  await until(() => work(owner.lists.at(-1)!, 'work-0001')!.steps!.done === before + 1, 10000, () => owner.lists.length);
  await settle();
  // Other files of the project change nothing the list shows.
  const told = owner.lists.length;
  writeFileSync(path.join(planning, 'active/0001-saved-payment-methods/CONTEXT.md'), '# Glossary\n\nChanged.\n');
  writeFileSync(path.join(planning, 'notes.txt'), 'notes\n');
  await settle();
  assert.equal(owner.lists.length, told, 'an unrelated edit is not told');
  // A burst of changes (a checkout rewriting many files) is one listing.
  for (let index = 0; index < 40; index++) writeFileSync(plan, readFileSync(plan, 'utf8').replace(/summary: ".*"/, `summary: "Burst ${index}."`));
  await until(() => work(owner.lists.at(-1)!, 'work-0001')?.summary === 'Burst 39.', 10000, () => owner.lists.length);
  await settle();
  assert.equal(owner.lists.length, told + 1, 'one listing for the burst');
});

test('listings for clients run one at a time, so an older and slower one never arrives last', async t => {
  const { host, origin } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  // The first listing takes long; the second, wanted meanwhile, is quick.
  const original = host.projects.bind(host);
  let calls = 0;
  host.projects = async (summaries?: boolean) => {
    const call = ++calls;
    if (summaries) await new Promise(resolve => setTimeout(resolve, call === 1 ? 900 : 0));
    return (await original(summaries)).map(project => ({ ...project, name: project.name + ' ' + call }));
  };
  const changed = () => (host as unknown as { projectsChanged(): void }).projectsChanged();
  changed();
  await new Promise(resolve => setTimeout(resolve, 450));
  changed();
  await until(() => owner.lists.length >= 2, 5000, () => owner.lists.length);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(owner.lists.map(list => list[0].name), ['Northwind 1', 'Northwind 2'], 'the newer listing last');
});

test('a listing that hangs is given up, so later changes still reach clients, and its late result is dropped', async t => {
  const { host, origin } = await start(t, { listingTimeout: 300 });
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  const original = host.projects.bind(host);
  let calls = 0, release = () => {};
  host.projects = async (summaries?: boolean) => {
    const call = ++calls;
    // The first never answers until released (a project on a share that does not answer).
    if (summaries && call === 1) await new Promise<void>(resolve => { release = resolve; });
    return (await original(summaries)).map(project => ({ ...project, name: project.name + ' ' + call }));
  };
  const changed = () => (host as unknown as { projectsChanged(): void }).projectsChanged();
  changed();
  await new Promise(resolve => setTimeout(resolve, 450));
  changed();
  await until(() => owner.lists.length >= 1, 5000, () => owner.lists.length);
  release();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.deepEqual(owner.lists.map(list => list[0].name), ['Northwind 2']);
});

test('a project outside the home is watched for its plans and ledgers, and again once its folder is replaced', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  const outside = path.join(temporary(t, 'atlas-outside-'), 'Shop planning');
  cpSync(fixture, outside, { recursive: true });
  const database = HomeDatabase.open(data);
  try { database.addProject(realpathSync.native(outside), 'Shop', null, 'active'); } finally { database.close(); }
  await owner.connection.request('projects.list', {});
  const summary = () => owner.lists.at(-1)?.find(project => project.path === realpathSync.native(outside))?.summary?.active.find(item => item.id === 'work-0001')?.summary;
  const plan = path.join(outside, 'active/0001-saved-payment-methods/plan.md');
  const say = (text: string) => writeFileSync(plan, readFileSync(plan, 'utf8').replace(/^title: Saved payment methods\n(?:summary: .*\n)?/m, `title: Saved payment methods\nsummary: "${text}"\n`));
  // The folder is watched a moment after it is listed, and again a moment after it is replaced (each
  // start of its watch has the next number); a change before that is not seen.
  const watches = () => (host as unknown as { outsideWatches: Map<string, { generation: number; watcher: unknown }> }).outsideWatches;
  const watching = (after: number) => until(() => [...watches().values()].some(watch => watch.generation > after && watch.watcher !== null), 15000);
  await watching(0);
  say('Watched outside the home.');
  await until(() => summary() === 'Watched outside the home.', 10000, () => owner.lists.length);
  // The folder replaced by a copy of itself: the new one is watched.
  const before = [...watches().values()][0].generation;
  rmSync(outside, { recursive: true, force: true, maxRetries: 10 });
  cpSync(fixture, outside, { recursive: true });
  await watching(before);
  say('Watched again.');
  await until(() => summary() === 'Watched again.', 10000, () => owner.lists.length);
  // Hidden, it is no longer watched (on Windows, a watch keeps the folders above it from being renamed).
  assert.equal(watches().size, 1);
  const shop = (await owner.connection.request('projects.list', {})).find(project => project.path === realpathSync.native(outside))!;
  await owner.connection.request('projects.update', { folderId: shop.folderId, state: 'hidden' });
  await owner.connection.request('projects.list', {});
  assert.equal(watches().size, 0);
});

test('a project made outside the app appears when its planning.json comes, a moment after its folder', async t => {
  const { host, origin, data } = await start(t);
  const owner = client(t, origin, host.ownerToken, host.descriptor.hostId);
  await owner.connection.request('projects.list', {});
  // As an agent or the command makes one: the folder first, its planning.json once the host has seen the folder without one.
  const folder = path.join(data, 'planning', 'by-hand');
  mkdirSync(folder);
  await until(() => (host as unknown as { unfinishedProjects: Map<string, number> }).unfinishedProjects.has('by-hand'));
  writeFileSync(path.join(folder, 'planning.json'), JSON.stringify({ schema_version: 1, name: 'By hand', repositories: [], work_items: [] }));
  await until(() => owner.lists.some(list => list.some(project => project.name === 'By hand')), 10000, () => owner.lists.map(list => list.map(project => project.name)));
});
