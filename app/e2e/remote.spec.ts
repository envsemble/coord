// Remote access between two copies of Atlas: one turns remote access on, the other pairs with a
// one-time link and then works on the first computer as if it were local: its folder list, its
// folders through the in-app browser, plan export and import, and switching between computers.
// Both run on this machine with their own data folders; the first listens on 127.0.0.1, since CI
// runners have no Tailscale.
import { cpSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { AtlasBridge } from '../shared/contract.ts';
import { close, launch, planningFixture, removeDirectory, temporaryDirectory, windowTitles, type Launched } from './app';

// The dialog's access line: the device list's confirm buttons announce through live regions of their own.
const accessStatus = (dialog: Locator) => dialog.getByRole('status').and(dialog.locator('.access-status'));

let sharing: Launched | undefined;
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

test('another Atlas pairs with a one-time link and works on that computer: its folders, the folder browser, import, switching computers', async () => {
  test.setTimeout(300_000);
  const folder = planningFixture();
  folders.push(path.dirname(folder));
  // A second planning folder beside it, which nobody opened yet: the folder browser finds it.
  const third = path.join(path.dirname(folder), 'third');
  cpSync(folder, third, { recursive: true });
  sharing = await launch({ folder });
  const owner = sharing.window;
  await expect(owner.locator('.work-row')).toHaveCount(3);
  const name = await owner.evaluate(async () => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.info(); return result.ok ? result.value.computer.name : ''; });

  // Remote access: no folders to share any more; the pairing step names the device and grants Manage access only when asked.
  await fileMenu(sharing.app, 'Re&mote Access…');
  const { access, port } = await listen(owner);
  await expect(access.getByRole('region', { name: 'Shared folders' })).toHaveCount(0);
  await expect(access.getByLabel('Manage access')).not.toBeChecked();
  await access.getByLabel('Device label (optional)').fill('Reading laptop');
  await access.getByLabel('Manage access').check();
  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.getByRole('img', { name: 'QR code of the pairing link' })).toBeVisible();
  await expect(access.locator('.pairing-expiry')).toContainText(/Expires in [45]:\d\d · works once/);
  await expect(access.locator('.pairing-grant')).toHaveText('Reading laptop: the whole computer, and Manage access.');
  const link = (await access.locator('.pairing-link').textContent())!;
  expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/pair#token=[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$`));
  await expect(access.getByText('No paired devices.')).toBeVisible();

  // The other Atlas pairs from its welcome page and sees that computer's folder list.
  const readerData = temporaryDirectory('atlas-e2e-data-');
  folders.push(readerData);
  reading = await launch({ dataDirectory: readerData });
  const viewer = reading.window;
  await viewer.getByRole('button', { name: 'Connect to Another Atlas…' }).click();
  const connect = viewer.getByRole('dialog', { name: 'Connect to another Atlas' });
  await connect.getByLabel('Pairing link or address').fill(link);
  await connect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connect.getByText(/This computer is paired with/)).toBeVisible();
  await connect.getByRole('button', { name: /^planning/ }).click();
  await expect(viewer.locator('.work-row')).toHaveCount(3);
  await expect.poll(() => windowTitles(reading!.app)).toEqual([`planning — ${name} — Atlas`]);
  // A paired device sees real paths: it is the same person's computer.
  expect(await viewer.evaluate(async () => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.snapshot(); return result.ok ? result.value.root : result.error.message; })).toBe(folder);
  await expect(viewer.getByRole('button', { name: /^Computer:/ })).toContainText(name);
  // Only revealing a file in a file explorer stays on that computer.
  expect(await viewer.evaluate(async () => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.reveal('README.md'); return result.ok ? 'revealed' : result.error.code; })).toBe('forbidden');
  // The link worked once. Pairing through the bridge, without a click, asks first; the person agrees.
  await reading.app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox; });
  expect(await viewer.evaluate(async target => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.pairRemote(target, null); return result.ok ? 'paired' : result.error.code; }, link)).not.toBe('paired');
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
  expect(await viewer.evaluate(async () => (await (globalThis as unknown as { atlas: AtlasBridge }).atlas.exportPlan('work-0003')).ok)).toBe(true);
  expect(existsSync(exported)).toBe(true);
  const preview = await viewer.evaluate(async () => (globalThis as unknown as { atlas: AtlasBridge }).atlas.chooseImport());
  expect(preview).toMatchObject({ ok: true, value: { newId: 'work-0005', file: 'exported.atlas-plan.html' } });
  const imported = await viewer.evaluate(async token => (globalThis as unknown as { atlas: AtlasBridge }).atlas.confirmImport(token), (preview as { value: { token: string } }).value.token);
  expect(imported).toMatchObject({ ok: true, value: { workId: 'work-0005' } });
  expect(readFileSync(path.join(folder, 'planning.json'), 'utf8')).toContain('work-0005');
  await expect(viewer.locator('.work-row')).toHaveCount(4);

  // The folder list is the computer's: a folder opened over there appears here at once.
  // File › Open Recent lists that computer's folders, this window's checked.
  const fileMenuButton = viewer.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File' });
  await fileMenuButton.click();
  await viewer.getByRole('menuitem', { name: 'Open Recent' }).hover();
  const recent = viewer.getByRole('menu', { name: 'Open Recent' });
  await expect(recent.getByRole('menuitemradio').filter({ hasText: /^planning/ })).toHaveAttribute('aria-checked', 'true');
  await recent.getByRole('menuitem', { name: 'Manage Folders…' }).click();
  const list = viewer.getByRole('dialog', { name: `Planning folders on ${name}` });
  const demo = path.join(path.dirname(planningFixture()), 'demo');
  folders.push(path.dirname(demo));
  renameSync(path.join(path.dirname(demo), 'planning'), demo);
  await sharing.app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as unknown as typeof dialog.showOpenDialog; }, demo);
  await fileMenu(sharing.app, '&Open Folder…');
  await expect(list.getByRole('button', { name: /^demo/ })).toBeVisible();
  // Its new-window button opens it beside this window.
  await list.getByRole('button', { name: 'Open demo in a new window' }).click();
  await expect.poll(() => windowTitles(reading!.app).then(titles => titles.sort())).toEqual([`demo — ${name} — Atlas`, `planning — ${name} — Atlas`].sort());

  // Open Folder… on that computer browses it in Atlas, beside the folder this window shows.
  await viewer.bringToFront();
  await fileMenuButton.click();
  await viewer.getByRole('menuitem', { name: 'Open Folder…' }).click();
  const browser = viewer.getByRole('dialog', { name: `Open a folder on ${name}` });
  await expect(browser.locator('.folder-browser-path')).toHaveText(path.dirname(folder));
  await expect(browser.getByRole('button', { name: /^third/ })).toContainText('Planning folder');
  await browser.getByRole('button', { name: 'Open third', exact: true }).click();
  await expect(browser).toHaveCount(0);
  await expect.poll(() => windowTitles(reading!.app).then(titles => titles.sort())).toEqual([`demo — ${name} — Atlas`, `third — ${name} — Atlas`].sort());
  // Browsing starts over at the home folder and the drives (or the root).
  await fileMenuButton.click();
  await viewer.getByRole('menuitem', { name: 'Open Folder…' }).click();
  await browser.getByRole('button', { name: 'Home folder and drives' }).click();
  await expect(browser.getByRole('list', { name: 'Places' })).toContainText('Home');
  await browser.getByRole('button', { name: 'Cancel' }).click();

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

  // Switching to this computer, which has no folders yet, shows its welcome page; switching back from there shows the other computer's folders.
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: 'This computer' }).click();
  await expect(viewer.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect(viewer.getByText('No recent folders.')).toBeVisible();
  await viewer.getByRole('button', { name: /^Computer:/ }).click();
  await viewer.getByRole('menu', { name: /^Computer/ }).getByRole('menuitemradio').filter({ hasText: /127\.0\.0\.1/ }).click();
  await expect(viewer.getByRole('heading', { name: `Planning folders on ${name}` })).toBeVisible();
  await expect(viewer.getByRole('list', { name: `Planning folders on ${name}` }).getByRole('listitem')).toHaveCount(3);

  // Next launch, this Atlas reopens the remote windows with its saved credential (they restore their tabs, so check the explorer).
  await close(reading);
  reading = await launch({ dataDirectory: readerData });
  const remoteFolder = reading.window.getByRole('treeitem', { name: 'active', exact: true });
  await expect(remoteFolder).toBeVisible();

  // Revoking the device ends its access at once; the window keeps the last view and says why.
  await access.getByRole('button', { name: 'Revoke…' }).click();
  // envUI's confirm button ignores a second press that comes as fast as a double click.
  await sharing.window.waitForTimeout(600);
  await access.getByRole('button', { name: 'Revoke access' }).click();
  await expect(access.getByText('No paired devices.')).toBeVisible();
  await expect(reading.window.getByRole('alert')).toContainText('was revoked');
  await expect(remoteFolder).toBeVisible();

  // Forgetting the computer from a window on it closes its other windows; this one shows this computer
  // instead (so Atlas stays open), and nothing about the other computer is kept.
  const last = reading.window;
  await last.getByRole('button', { name: /^Computer:/ }).click();
  await last.getByRole('menu', { name: /^Computer/ }).getByRole('menuitem', { name: 'Manage Computers…' }).click();
  const computers = last.getByRole('dialog', { name: 'Computers' });
  // Only paired computers can be forgotten; this one was revoked and says so instead of its address.
  await computers.getByRole('button', { name: 'Forget', exact: true }).click();
  await last.waitForTimeout(600);
  await computers.getByRole('button', { name: `Forget ${name}` }).click();
  await expect(last.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect.poll(() => windowTitles(reading!.app)).toEqual(['Atlas']);
  const saved = (file: string) => { try { return readFileSync(path.join(readerData, file), 'utf8'); } catch { return ''; } };
  await expect.poll(() => JSON.parse(saved('connections.json') || '[]')).toEqual([]);
  await expect.poll(() => saved('desktop-state.json')).not.toContain('atlas-remote:');
});

test('turning remote access off closes the listener and expires an open pairing link', async () => {
  const folder = planningFixture();
  folders.push(path.dirname(folder));
  sharing = await launch({ folder });
  const owner = sharing.window;
  await expect(owner.locator('.work-row')).toHaveCount(3);
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
