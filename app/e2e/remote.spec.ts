// Remote access between two copies of Atlas: one turns remote access on, the other pairs with a
// one-time link and then works on the first computer's projects as if they were local: their plans in
// its hub, listed on its Projects page (archived its own way), read, renamed and created there, and
// switching between computers. Both run on this machine with their own homes; the
// first listens on 127.0.0.1, since CI runners have no Tailscale.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { AtlasBridge } from '../shared/contract.ts';
import { close, expectProjects, goHome, hubRows, launch, launchProject, openPlan, openProjectMenu, expectArchived, projectAction, projectDetails, removeDirectory, temporaryDirectory, windowTitles, type Launched } from './app';

// Remote access's status line: the device list's confirm buttons announce through live regions of their own.
const accessStatus = (section: Locator) => section.getByRole('status').and(section.locator('.access-status'));

let sharing: (Launched & { folder?: string }) | undefined;
let reading: Launched | undefined;
const folders: string[] = [];
test.afterEach(async () => {
  await close(reading); reading = undefined;
  await close(sharing); sharing = undefined;
  for (const folder of folders.splice(0)) removeDirectory(folder);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise(resolve => server.close(resolve));
  return port;
}
/** Choose an item of the title bar's computer menu. */
async function computerMenu(page: Page, item: string) {
  await page.getByRole('button', { name: /^Computer:/ }).click();
  await page.getByRole('menu', { name: /^Computer/ }).getByRole('menuitem', { name: item, exact: true }).click();
}
/** Settings › Computers, from the computer menu's Computer settings…: the other computers, and the devices that can reach the window's computer. */
async function computerSettings(page: Page) {
  await computerMenu(page, 'Computer settings…');
  await expect(page.getByRole('heading', { name: 'Other computers' })).toBeVisible();
  return { others: page.getByRole('region', { name: 'Other computers' }), access: page.getByRole('region', { name: /^Devices that can reach / }) };
}
const bridge = (page: Page) => ({
  call: <T>(run: (atlas: AtlasBridge, ...args: string[]) => Promise<T>, ...args: string[]) => page.evaluate(([source, values]) => {
    const atlas = (globalThis as unknown as { atlas: AtlasBridge }).atlas;
    return (new Function('atlas', 'args', `return (${source})(atlas, ...args)`) as (atlas: AtlasBridge, args: string[]) => Promise<T>)(atlas, values);
  }, [run.toString(), args] as const),
});
/** The projects of the window's computer, by name, with their state when it is not active. */
const projectNames = (page: Page) => bridge(page).call(async atlas => { const result = await atlas.projects(); return result.ok ? result.value.map(item => item.name + (item.state === 'active' ? '' : ' (' + item.state + ')')) : []; });
const noProjects = (page: Page) => expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
/** A project's ID on the window's computer, by its name. */
const projectIdOf = (page: Page, name: string) => bridge(page).call(async (atlas, wanted) => { const result = await atlas.projects(); return result.ok ? result.value.find(item => item.name === wanted)?.id ?? '' : ''; }, name);

/** Turn remote access on for 127.0.0.1 in Settings › Computers, shown; returns the port. */
async function listen(owner: Page) {
  const access = owner.getByRole('region', { name: /^Devices that can reach / });
  await expect(accessStatus(access)).toHaveText('Remote access is off.');
  await access.getByLabel('Reach this computer via').click();
  await owner.getByRole('option', { name: /127\.0\.0\.1/ }).click();
  const port = await freePort();
  await access.getByLabel('Port').fill(String(port));
  await access.getByLabel('Port').press('Enter');
  await expect(access.getByLabel('Allow paired devices to connect to this computer')).toBeEnabled();
  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(accessStatus(access)).toHaveText(`Listening on 127.0.0.1:${port}.`);
  return { access, port };
}

/** The person answers yes to Atlas's questions, such as the one before a pairing link is created. */
const agree = (app: ElectronApplication) => app.evaluate(({ dialog }) => {
  dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox;
});

test('another Atlas pairs with a one-time link and works on that computer\'s projects, ordering and hiding them its own way', async () => {
  test.setTimeout(300_000);
  sharing = await launchProject();
  const folder = sharing.folder!;
  const owner = sharing.window;
  await agree(sharing.app);
  const name = await bridge(owner).call(async atlas => { const result = await atlas.info(); return result.ok ? result.value.computer.name : ''; });

  // Remote access, in Settings: the pairing step names the device and grants Manage access only when asked.
  await computerSettings(sharing.window);
  const { access, port } = await listen(owner);
  await expect(access.getByLabel('Manage access')).not.toBeChecked();
  await access.getByLabel('Device label (optional)').fill('Reading laptop');
  await access.getByLabel('Manage access').check();
  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.getByRole('img', { name: 'QR code of the pairing link' })).toBeVisible();
  await expect(access.locator('.pairing-grant')).toHaveText('Reading laptop: the whole computer, and Manage access.');
  const link = (await access.locator('.pairing-link').textContent())!;
  expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/pair#token=[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$`));
  await expect(access.getByText('No paired devices.')).toBeVisible();

  // The other Atlas pairs and shows that computer: its projects' plans in the hub.
  const readerData = temporaryDirectory('atlas-e2e-data-');
  folders.push(readerData);
  reading = await launch({ dataDirectory: readerData });
  const viewer = reading.window;
  await noProjects(viewer);
  await (await computerSettings(viewer)).others.getByRole('button', { name: 'Connect to Another Atlas…' }).click();
  const connect = viewer.getByRole('dialog', { name: 'Connect to another Atlas' });
  await connect.getByLabel('Pairing link or address').fill(link);
  await connect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connect.getByText(/This computer is paired with/)).toBeVisible();
  await connect.getByRole('button', { name: 'Show ' + name }).click();
  await expect(viewer.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  await expect.poll(() => windowTitles(reading!.app)).toEqual([`${name} — Atlas`]);
  await openPlan(viewer, 'Customer order notifications');
  // A paired device sees real paths: it is the same person's computer.
  const northwind = await projectIdOf(viewer, 'Northwind');
  expect(await bridge(viewer).call(async (atlas, id) => { const result = await atlas.snapshot(id); return result.ok ? result.value.root : result.error.message; }, northwind)).toBe(folder);
  // Only revealing a file in a file explorer stays on that computer.
  expect(await bridge(viewer).call(async (atlas, id) => { const result = await atlas.reveal(id, 'README.md'); return result.ok ? 'revealed' : result.error.code; }, northwind)).toBe('forbidden');
  // The link worked once (pairing through the bridge without a press asks first; the person agrees).
  await agree(reading.app);
  expect(await bridge(viewer).call(async (atlas, target) => { const result = await atlas.pairComputer(target, null); return result.ok ? 'paired' : result.error.code; }, link)).not.toBe('paired');
  await expect(access.locator('.device-list li')).toHaveCount(1);
  await expect(access.locator('.device-list li')).toContainText('Reading laptop');
  await expect(access.locator('.device-list li').getByText('Connected')).toBeVisible();

  // Its plans are in the hub here.
  await goHome(viewer);
  await expect(hubRows(viewer)).toHaveCount(3);

  // A project created from here is made on that computer, and both see it. Its workspace folders
  // are paths there, chosen in Atlas there: here it gets a name only, and its folders are not changed.
  await (await openProjectMenu(viewer)).getByRole('menuitem', { name: 'New Project…', exact: true }).click();
  const create = viewer.getByRole('dialog', { name: 'Create project' });
  await create.getByLabel('Project name').fill('Coord');
  await expect(create.getByLabel('Folder')).toHaveCount(0);
  await expect(create.getByRole('button', { name: 'Browse…' })).toHaveCount(0);
  await expect(create).toContainText(`Its folders are chosen in Atlas on ${name}`);
  await create.getByRole('button', { name: 'Create project' }).click();
  await expectProjects(viewer, ['Northwind', 'Coord']);
  expect(existsSync(path.join(path.dirname(folder), 'coord', 'planning.json'))).toBe(true);
  expect(JSON.parse(readFileSync(path.join(path.dirname(folder), 'coord', 'planning.json'), 'utf8')).folders).toEqual([]);
  const details = await projectDetails(viewer, 'Coord');
  await expect(details.getByRole('button', { name: 'Add folder…' })).toHaveCount(0);
  await expect(details).toContainText(`Folders are chosen in Atlas on ${name}.`);
  await viewer.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  // (The owner's window stays on Settings › Computers, so its projects are read through its bridge.)
  await expect.poll(() => projectNames(owner)).toEqual(['Northwind', 'Coord']);
  // Renaming goes to that computer (the name is in the project's planning.json)...
  await projectAction(viewer, 'Coord', 'Rename…');
  await viewer.getByRole('dialog', { name: 'Rename project' }).getByLabel('Name').fill('Coord platform');
  await viewer.getByRole('dialog', { name: 'Rename project' }).getByRole('button', { name: 'Rename' }).click();
  await expect.poll(() => projectNames(owner)).toEqual(['Northwind', 'Coord platform']);
  // ...while archiving is this app's own: the project leaves the menu's projects for its archived ones,
  // and its plans leave the hub, while that computer still lists it as before. A plan of it, shown
  // before, is still shown when back steps to it.
  await goHome(viewer);
  await openPlan(viewer, 'Customer order notifications');
  await goHome(viewer);
  await projectAction(viewer, 'Northwind', 'Archive');
  await expectProjects(viewer, ['Coord platform']);
  await expectArchived(viewer, ['Northwind']);
  await expect(hubRows(viewer, 'Customer order notifications')).toHaveCount(0);
  await expect.poll(() => projectNames(owner)).toEqual(['Northwind', 'Coord platform']);
  for (let step = 0; step < 3; step++) await viewer.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(viewer.locator('.work-page h1')).toHaveText('Customer order notifications');

  // With Manage access, this Atlas pairs and revokes devices of that computer, but cannot change how it is reached.
  await viewer.bringToFront();
  await computerSettings(viewer);
  const remoteAccess = viewer.getByRole('region', { name: `Devices that can reach ${name}` });
  await expect(accessStatus(remoteAccess)).toHaveText(`${name} listens on 127.0.0.1:${port}.`);
  await expect(remoteAccess.getByLabel('Allow paired devices to connect to this computer')).toHaveCount(0);
  await expect(remoteAccess.locator('.device-list li')).toContainText('Manage access');
  await remoteAccess.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(remoteAccess.locator('.pairing-link')).toBeVisible();
  await remoteAccess.getByRole('button', { name: 'Revoke', exact: true }).click();
  await viewer.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(viewer.locator('.work-page h1')).toHaveText('Customer order notifications');

  // Switching to this computer, which has no projects, and back.
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: 'This computer' }).click();
  await noProjects(viewer);
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: /127\.0\.0\.1/ }).click();
  // What it showed of that computer comes back with it.
  await expect(viewer.locator('.work-page h1')).toHaveText('Customer order notifications');
  // Its files and applications' links do not open here: they are that computer's.
  const refused = await viewer.evaluate(async () => {
    const bridge = (window as unknown as { atlas: Record<string, (...args: unknown[]) => Promise<{ ok: boolean; value?: { id: string }[]; error?: { code: string } }>> }).atlas;
    const folder = (await bridge.projects()).value![0].id;
    return [await bridge.openReference(folder, { kind: 'path', repository: null, value: 'README.md', line: null }), await bridge.openExternal('t3-thread://thread/abc')].map(result => result.error?.code);
  });
  expect(refused).toEqual(['forbidden', 'forbidden']);

  // Next launch, this Atlas shows that computer again with its saved credential, place and archived project.
  await viewer.waitForTimeout(600);
  await close(reading);
  reading = await launch({ dataDirectory: readerData });
  await expect(reading.window.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  await expect(reading.window.locator('.work-page h1')).toHaveText('Customer order notifications');
  await expect.poll(() => projectNames(reading!.window).then(names => names.sort())).toEqual(['Coord platform', 'Northwind (archived)']);

  // Started while that computer cannot be reached, the window shows at once, on the hub, and keeps its
  // place (also through a save meanwhile); it comes back when the computer answers again.
  await reading.window.waitForTimeout(600);
  await close(reading);
  const allow = access.getByLabel('Allow paired devices to connect to this computer');
  await allow.click();
  await expect(accessStatus(access)).toHaveText('Remote access is off.');
  const restarted = Date.now();
  reading = await launch({ dataDirectory: readerData });
  await expect(reading.window.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  expect(Date.now() - restarted).toBeLessThan(12_000);
  // The hub, still listing that computer's projects (a request waits for it up to 20 s) or saying they can't be listed.
  await expect(reading.window.locator('.hub').or(reading.window.getByRole('progressbar', { name: 'Loading the plans' }))).toBeVisible();
  await expect(reading.window.locator('.work-page')).toHaveCount(0);
  await reading.window.waitForTimeout(600);
  await allow.click();
  await expect(accessStatus(access)).toHaveText(`Listening on 127.0.0.1:${port}.`);
  await expect(reading.window.locator('.work-page h1')).toHaveText('Customer order notifications', { timeout: 60_000 });

  // Revoking the device ends its access at once; the window keeps the last view and says why.
  await expect(reading.window.locator('.reader .prose')).toContainText('Outcome');
  await access.getByRole('button', { name: 'Revoke…' }).click();
  // envUI's confirm button ignores a second press that comes as fast as a double click.
  await sharing.window.waitForTimeout(600);
  await access.getByRole('button', { name: 'Revoke access' }).click();
  await expect(access.getByText('No paired devices.')).toBeVisible();
  await expect(reading.window.getByRole('alert')).toContainText('was revoked');
  await expect(reading.window.locator('.work-page h1')).toHaveText('Customer order notifications');

  // Forgetting the computer shows this computer in its windows, and nothing about the other computer is kept.
  const last = reading.window;
  const computers = (await computerSettings(last)).others;
  await computers.getByRole('button', { name: 'Forget', exact: true }).click();
  await last.waitForTimeout(600);
  await computers.getByRole('button', { name: `Forget ${name}` }).click();
  await noProjects(last);
  await expect.poll(() => windowTitles(reading!.app)).toEqual(['Atlas']);
  const kept = () => {
    const database = new DatabaseSync(path.join(readerData, 'atlas.db'), { readOnly: true });
    try { return [database.prepare('SELECT count(*) AS n FROM paired_computer').get(), database.prepare('SELECT count(*) AS n FROM project').get()].map(row => Number((row as { n: number }).n)); }
    finally { database.close(); }
  };
  await expect.poll(kept).toEqual([0, 0]);
});

test('turning remote access off closes the listener and expires an open pairing link', async () => {
  sharing = await launchProject();
  const owner = sharing.window;
  await agree(sharing.app);
  await computerSettings(sharing.window);
  const { access, port } = await listen(owner);
  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.locator('.pairing-link')).toBeVisible();

  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(accessStatus(access)).toHaveText('Remote access is off.');
  await expect(access.locator('.pairing-link')).toHaveCount(0);
  const reachable = await fetch(`http://127.0.0.1:${port}/api/host`).then(() => true, () => false);
  expect(reachable).toBe(false);
});
