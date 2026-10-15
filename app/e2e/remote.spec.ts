// Remote access between two copies of Atlas: one turns remote access on, the other pairs with a
// one-time link and then works on the first computer's projects as if they were local: listed in
// its sidebar (ordered and hidden its own way), read, renamed and created there, plan export and
// import, and switching between computers. Both run on this machine with their own homes; the
// first listens on 127.0.0.1, since CI runners have no Tailscale.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { AtlasBridge } from '../shared/contract.ts';
import { close, launch, launchProject, openProject, removeDirectory, sidebarProject, temporaryDirectory, windowTitles, type Launched } from './app';

// The dialog's access line: the device list's confirm buttons announce through live regions of their own.
const accessStatus = (dialog: Locator) => dialog.getByRole('status').and(dialog.locator('.access-status'));

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
async function fileMenu(app: ElectronApplication, label: string) {
  await app.evaluate(({ Menu, BrowserWindow }, wanted) => {
    const item = Menu.getApplicationMenu()!.items.find(entry => entry.label === '&File')!.submenu!.items.find(entry => entry.label === wanted)!;
    item.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined as never);
  }, label);
}
const bridge = (page: Page) => ({
  call: <T>(run: (atlas: AtlasBridge, ...args: string[]) => Promise<T>, ...args: string[]) => page.evaluate(([source, values]) => {
    const atlas = (globalThis as unknown as { atlas: AtlasBridge }).atlas;
    return (new Function('atlas', 'args', `return (${source})(atlas, ...args)`) as (atlas: AtlasBridge, args: string[]) => Promise<T>)(atlas, values);
  }, [run.toString(), args] as const),
});
/** A project's folder ID on the window's computer, by its name. */
const folderIdOf = (page: Page, name: string) => bridge(page).call(async (atlas, wanted) => { const result = await atlas.projects(); return result.ok ? result.value.find(item => item.name === wanted)?.folderId ?? '' : ''; }, name);

/** Turn remote access on for 127.0.0.1 in the open Remote Access dialog; returns the port. */
async function listen(owner: Page) {
  const access = owner.getByRole('dialog', { name: 'Remote access' });
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

  // Remote access: the pairing step names the device and grants Manage access only when asked.
  await fileMenu(sharing.app, 'Re&mote Access…');
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

  // The other Atlas pairs and shows that computer: its projects in the sidebar.
  const readerData = temporaryDirectory('atlas-e2e-data-');
  folders.push(readerData);
  reading = await launch({ dataDirectory: readerData });
  const viewer = reading.window;
  await expect(viewer.getByRole('group', { name: 'Projects' })).toContainText('No projects yet.');
  await fileMenu(reading.app, 'Co&nnect to Another Atlas…');
  const connect = viewer.getByRole('dialog', { name: 'Connect to another Atlas' });
  await connect.getByLabel('Pairing link or address').fill(link);
  await connect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connect.getByText(/This computer is paired with/)).toBeVisible();
  await connect.getByRole('button', { name: 'Show ' + name }).click();
  await expect(viewer.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  await expect.poll(() => windowTitles(reading!.app)).toEqual([`${name} — Atlas`]);
  await openProject(viewer);
  // A paired device sees real paths: it is the same person's computer.
  const northwind = await folderIdOf(viewer, 'Northwind');
  expect(await bridge(viewer).call(async (atlas, id) => { const result = await atlas.snapshot(id); return result.ok ? result.value.root : result.error.message; }, northwind)).toBe(folder);
  // Only revealing a file in a file explorer stays on that computer.
  expect(await bridge(viewer).call(async (atlas, id) => { const result = await atlas.reveal(id, 'README.md'); return result.ok ? 'revealed' : result.error.code; }, northwind)).toBe('forbidden');
  // The link worked once (pairing through the bridge without a press asks first; the person agrees).
  await agree(reading.app);
  expect(await bridge(viewer).call(async (atlas, target) => { const result = await atlas.pairRemote(target, null); return result.ok ? 'paired' : result.error.code; }, link)).not.toBe('paired');
  await expect(access.locator('.device-list li')).toHaveCount(1);
  await expect(access.locator('.device-list li')).toContainText('Reading laptop');
  await expect(access.locator('.device-list li').getByText('Connected')).toBeVisible();

  // Export a plan from that computer to this one, and import it back there: the file is sent over.
  const exported = path.join(readerData, 'exported.atlas-plan.html');
  await reading.app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as unknown as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as unknown as typeof dialog.showOpenDialog;
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox;
  }, exported);
  expect(await bridge(viewer).call(async (atlas, id) => (await atlas.exportPlan(id, 'work-0003')).ok, northwind)).toBe(true);
  expect(existsSync(exported)).toBe(true);
  const preview = await bridge(viewer).call(async (atlas, id) => atlas.chooseImport(id), northwind);
  expect(preview).toMatchObject({ ok: true, value: { newId: 'work-0005', file: 'exported.atlas-plan.html' } });
  const imported = await bridge(viewer).call(async (atlas, token) => atlas.confirmImport(token), (preview as { value: { token: string } }).value.token);
  expect(imported).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(readFileSync(path.join(folder, 'planning.json'), 'utf8')).toContain('work-0005');
  await expect(viewer.locator('.work-row')).toHaveCount(4);

  // A project created from here is made on that computer, and both see it.
  await viewer.getByRole('group', { name: 'Projects' }).getByRole('button', { name: 'New Project…' }).click();
  await viewer.getByRole('dialog', { name: 'New project' }).getByLabel('Name').first().fill('Coord');
  await viewer.getByRole('dialog', { name: 'New project' }).getByRole('button', { name: 'Create' }).click();
  await expect(viewer.locator('.project-page h1')).toHaveText('Coord');
  expect(existsSync(path.join(path.dirname(folder), 'coord', 'planning.json'))).toBe(true);
  // (The owner's Remote Access dialog stays open, so its sidebar is read past the dialog.)
  const ownerProjects = owner.locator('.project-list [data-project]');
  await expect(ownerProjects).toHaveText(['Northwind', 'Coord']);
  // Renaming goes to that computer (the name is in the project's planning.json)...
  await sidebarProject(viewer, 'Coord').click({ button: 'right' });
  await viewer.getByRole('menuitem', { name: 'Rename…' }).click();
  await viewer.getByRole('dialog', { name: 'Rename project' }).getByLabel('Name').fill('Coord platform');
  await viewer.getByRole('dialog', { name: 'Rename project' }).getByRole('button', { name: 'Rename' }).click();
  await expect(ownerProjects).toHaveText(['Northwind', 'Coord platform']);
  // ...while hiding and the order are this app's own.
  await sidebarProject(viewer, 'Northwind').click({ button: 'right' });
  await viewer.getByRole('menuitem', { name: 'Hide' }).click();
  await expect(viewer.getByRole('group', { name: 'Projects' }).locator('[data-project]')).toHaveText(['Coord platform']);
  await viewer.waitForTimeout(500);
  await expect(ownerProjects).toHaveText(['Northwind', 'Coord platform']);

  // With Manage access, this Atlas pairs and revokes devices of that computer, but cannot change how it is reached.
  await viewer.bringToFront();
  await fileMenu(reading.app, 'Re&mote Access…');
  const remoteAccess = viewer.getByRole('dialog', { name: `Remote access to ${name}` });
  await expect(accessStatus(remoteAccess)).toHaveText(`${name} listens on 127.0.0.1:${port}.`);
  await expect(remoteAccess.getByLabel('Allow paired devices to connect to this computer')).toHaveCount(0);
  await expect(remoteAccess.locator('.device-list li')).toContainText('Manage access');
  await remoteAccess.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(remoteAccess.locator('.pairing-link')).toBeVisible();
  await remoteAccess.getByRole('button', { name: 'Revoke', exact: true }).click();
  await remoteAccess.getByRole('button', { name: 'Done' }).click();

  // Switching to this computer, which has no projects, and back.
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: 'This computer' }).click();
  await expect(viewer.getByRole('group', { name: 'Projects' })).toContainText('No projects yet.');
  await expect(viewer.getByRole('tablist', { name: 'Open tabs' })).toHaveCount(0);
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: /127\.0\.0\.1/ }).click();
  await expect(viewer.getByRole('group', { name: 'Projects' }).locator('[data-project]')).toHaveText(['Coord platform']);
  // Its tabs of that computer come back with it.
  await expect(viewer.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveText(['Northwind', 'Coord platform']);

  // Next launch, this Atlas shows that computer again with its saved credential, tabs and hidden project.
  await viewer.waitForTimeout(600);
  await close(reading);
  reading = await launch({ dataDirectory: readerData });
  await expect(reading.window.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  await expect(reading.window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab')).toHaveText(['Northwind', 'Coord platform']);
  await expect(reading.window.locator('.project-group summary')).toContainText('Hidden and archived');

  // Revoking the device ends its access at once; the window keeps the last view and says why.
  await reading.window.getByRole('tablist', { name: 'Open tabs' }).getByRole('tab', { name: 'Northwind' }).click();
  await expect(reading.window.locator('.work-row')).toHaveCount(4);
  await access.getByRole('button', { name: 'Revoke…' }).click();
  // envUI's confirm button ignores a second press that comes as fast as a double click.
  await sharing.window.waitForTimeout(600);
  await access.getByRole('button', { name: 'Revoke access' }).click();
  await expect(access.getByText('No paired devices.')).toBeVisible();
  await expect(reading.window.getByRole('alert')).toContainText('was revoked');
  await expect(reading.window.locator('.work-row')).toHaveCount(4);

  // Forgetting the computer shows this computer in its windows, and nothing about the other computer is kept.
  const last = reading.window;
  await last.getByRole('button', { name: /^Computer:/ }).click();
  await last.getByRole('menu', { name: /^Computer/ }).getByRole('menuitem', { name: 'Manage Computers…' }).click();
  const computers = last.getByRole('dialog', { name: 'Computers' });
  await computers.getByRole('button', { name: 'Forget', exact: true }).click();
  await last.waitForTimeout(600);
  await computers.getByRole('button', { name: `Forget ${name}` }).click();
  await expect(last.getByRole('group', { name: 'Projects' })).toContainText('No projects yet.');
  await expect.poll(() => windowTitles(reading!.app)).toEqual(['Atlas']);
  const kept = () => {
    const database = new DatabaseSync(path.join(readerData, 'atlas.db'), { readOnly: true });
    try { return [database.prepare('SELECT count(*) AS n FROM connection').get(), database.prepare('SELECT count(*) AS n FROM project').get()].map(row => Number((row as { n: number }).n)); }
    finally { database.close(); }
  };
  await expect.poll(kept).toEqual([0, 0]);
});

test('turning remote access off closes the listener and expires an open pairing link', async () => {
  sharing = await launchProject();
  const owner = sharing.window;
  await agree(sharing.app);
  await fileMenu(sharing.app, 'Re&mote Access…');
  const { access, port } = await listen(owner);
  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.locator('.pairing-link')).toBeVisible();

  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(accessStatus(access)).toHaveText('Remote access is off.');
  await expect(access.locator('.pairing-link')).toHaveCount(0);
  const reachable = await fetch(`http://127.0.0.1:${port}/api/host`).then(() => true, () => false);
  expect(reachable).toBe(false);
});
