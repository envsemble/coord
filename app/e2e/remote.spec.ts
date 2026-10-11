// Remote access between two copies of Atlas: one shares a planning folder, the other pairs with a
// one-time link and reads it. Both run on this machine with their own data folders; the sharing one
// listens on 127.0.0.1, since CI runners have no Tailscale.
import { createServer } from 'node:net';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import type { AtlasBridge } from '../shared/contract.ts';
import { close, launch, planningFixture, removeDirectory, temporaryDirectory, windowTitles, type Launched } from './app';


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
    item.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, label);
}

test('another Atlas pairs with a one-time link, reads a shared folder read-only, and loses it when revoked', async () => {
  test.setTimeout(180_000);
  const folder = planningFixture();
  folders.push(path.dirname(folder));
  sharing = await launch({ folder });
  const owner = sharing.window;
  await expect(owner.locator('.work-row')).toHaveCount(3);

  // Turn remote access on for this machine's address and share the open folder.
  await fileMenu(sharing.app, 'Re&mote Access…');
  const access = owner.getByRole('dialog', { name: 'Remote access' });
  await expect(access.getByRole('status')).toHaveText('Remote access is off.');
  await expect(access.getByRole('button', { name: 'Create pairing link' })).toBeDisabled();
  await access.getByLabel('Reach this computer via').selectOption('127.0.0.1');
  const port = await freePort();
  await access.getByLabel('Port').fill(String(port));
  await access.getByLabel('Port').press('Enter');
  await expect(access.getByLabel('Allow paired devices to connect to this computer')).toBeEnabled();
  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(access.getByRole('status')).toHaveText(`Listening on 127.0.0.1:${port}.`);
  await expect(access.getByText('No folders are shared.')).toBeVisible();
  await access.getByRole('button', { name: 'Share this folder' }).click();
  await expect(access.locator('.access-path')).toHaveText(folder);

  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.getByRole('img', { name: 'QR code of the pairing link' })).toBeVisible();
  await expect(access.locator('.pairing-expiry')).toContainText(/Expires in [45]:\d\d · works once/);
  const link = (await access.locator('.pairing-link').textContent())!;
  expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/pair#token=[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$`));
  await expect(access.getByText('No paired devices.')).toBeVisible();

  // The other Atlas pairs from its welcome page and opens the shared folder in the same window.
  const readerData = temporaryDirectory('atlas-e2e-data-');
  folders.push(readerData);
  reading = await launch({ dataDirectory: readerData });
  const viewer = reading.window;
  await viewer.getByRole('button', { name: 'Connect to Another Atlas…' }).click();
  const connect = viewer.getByRole('dialog', { name: 'Connect to another Atlas' });
  await connect.getByLabel('Pairing link or address').fill(link);
  await connect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connect.getByText(/This computer is paired with/)).toBeVisible();
  await connect.getByRole('button', { name: 'planning' }).click();
  await expect(viewer.locator('.work-row')).toHaveCount(3);
  await expect(viewer.locator('.explorer-remote')).toContainText('read-only');
  await expect.poll(() => windowTitles(reading!.app)).toEqual([expect.stringMatching(/^planning — .+ — Atlas$/)]);
  // The paired device sees the folder's name, never where it lives on the sharing computer.
  expect(await viewer.evaluate(async () => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.snapshot(); return result.ok ? result.value.root : result.error.message; })).toBe('planning');
  // Documents read through the host.
  await viewer.locator('.work-row a', { hasText: 'Saved payment methods' }).click();
  await expect(viewer.locator('.work-header h1')).toHaveText('Saved payment methods');
  await expect(viewer.getByRole('article').getByRole('heading', { name: 'Saved payment methods: ledger' })).toBeVisible();

  // The link worked once.
  const again = await viewer.evaluate(async target => { const result = await (globalThis as unknown as { atlas: AtlasBridge }).atlas.pairRemote(target, null); return result.ok ? 'paired' : result.error.code; }, link);
  expect(again).not.toBe('paired');

  // The sharing Atlas lists the device as connected.
  await expect(access.locator('.device-list li')).toHaveCount(1);
  await expect(access.locator('.device-list li').getByText('Connected')).toBeVisible();

  // Next launch, the reading Atlas reopens the remote folder with its saved credential.
  await close(reading);
  reading = await launch({ dataDirectory: readerData });
  await expect(reading.window.locator('.work-row')).toHaveCount(3);
  await expect(reading.window.locator('.explorer-remote')).toContainText('read-only');

  // Revoking the device ends its access at once.
  await access.getByRole('button', { name: 'Revoke…' }).click();
  await access.getByRole('button', { name: 'Revoke access' }).click();
  await expect(access.getByText('No paired devices.')).toBeVisible();
  await expect(reading.window.getByRole('alert')).toContainText('was revoked');
  await expect(reading.window.locator('.work-row')).toHaveCount(3);
});

test('turning remote access off closes the listener and expires an open pairing link', async () => {
  const folder = planningFixture();
  folders.push(path.dirname(folder));
  sharing = await launch({ folder });
  const owner = sharing.window;
  await expect(owner.locator('.work-row')).toHaveCount(3);
  await fileMenu(sharing.app, 'Re&mote Access…');
  const access = owner.getByRole('dialog', { name: 'Remote access' });
  await access.getByLabel('Reach this computer via').selectOption('127.0.0.1');
  const port = await freePort();
  await access.getByLabel('Port').fill(String(port));
  await access.getByLabel('Port').press('Enter');
  await expect(access.getByLabel('Allow paired devices to connect to this computer')).toBeEnabled();
  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(access.getByRole('status')).toHaveText(`Listening on 127.0.0.1:${port}.`);
  await access.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(access.locator('.pairing-link')).toBeVisible();

  await access.getByLabel('Allow paired devices to connect to this computer').click();
  await expect(access.getByRole('status')).toHaveText('Remote access is off.');
  await expect(access.locator('.pairing-link')).toHaveCount(0);
  const reachable = await fetch(`http://127.0.0.1:${port}/api/host`).then(() => true, () => false);
  expect(reachable).toBe(false);
});
