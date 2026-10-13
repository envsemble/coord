import path from 'node:path';
import { expect, test } from '@playwright/test';
import { close, launch, planningFixture, removeDirectory, type Launched } from './app';

let launched: Launched | undefined;
let folder: string;
test.beforeEach(async () => {
  folder = planningFixture();
  launched = await launch({ folder });
  await expect(launched.window.locator('.work-row')).toHaveCount(3);
});
test.afterEach(async () => { await close(launched); launched = undefined; removeDirectory(path.dirname(folder)); });

test('the window is isolated and sandboxed, with a strict content security policy', async () => {
  const { window: atlasWindow, app } = launched!;
  const page = await atlasWindow.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridge: Object.keys((window as unknown as { atlas: object }).atlas).sort(),
    ipc: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
  }));
  expect(page.require).toBe('undefined');
  expect(page.process).toBe('undefined');
  expect(page.ipc).toBe('undefined');
  expect(page.bridge).toContain('snapshot');
  expect(page.policy).toContain("default-src 'none'");
  expect(page.policy).toContain("script-src 'self'");
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const values = (contents as unknown as { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences();
    return { contextIsolation: values.contextIsolation, sandbox: values.sandbox, nodeIntegration: values.nodeIntegration, webviewTag: values.webviewTag, url: contents.getURL() };
  });
  expect(preferences).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, url: 'atlas://app/index.html' });
  // Inline script is refused by the policy.
  const inline = await atlasWindow.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.__inline = 1'; document.head.append(script); return (window as unknown as { __inline?: number }).__inline ?? null; });
  expect(inline).toBeNull();
});

test('messages are checked: wrong arguments and paths outside the folder are refused with structured errors', async () => {
  const { window: atlasWindow, app } = launched!;
  // Commands a page could misuse ask first without a person's press; the person declines here.
  await app.evaluate(({ dialog }) => {
    const asked: string[] = [];
    (globalThis as unknown as { asked: string[] }).asked = asked;
    dialog.showMessageBox = (async (_window: unknown, options: { message: string }) => { asked.push(options.message); return { response: 1, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  });
  const results = await atlasWindow.evaluate(async () => {
    const bridge = (window as unknown as { atlas: unknown }).atlas as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return {
      traversal: await bridge.document('../outside.md'),
      absolute: await bridge.document('C:/Windows/win.ini'),
      hidden: await bridge.document('active/0001-saved-payment-methods/.atlas/models/m-024410515ef6611f71e02bdc.json'),
      wrongType: await bridge.models(42),
      badHandle: await bridge.model('work-0001', '../../planning.json'),
      command: await bridge.command('openFolder'),
      // Pasting (which reads the clipboard) needs a person's click or key press; quitting, closing
      // the last window and opening windows or the logs ask first.
      paste: await bridge.command('paste'),
      quit: await bridge.command('quit'),
      closeWindow: await bridge.command('closeWindow'),
      newWindow: await bridge.command('newWindow'),
      openLogs: await bridge.command('openLogs'),
      external: await bridge.openExternal('file:///C:/Windows/System32/calc.exe'),
      ok: await bridge.document('README.md').then(value => (value as { ok: boolean }).ok),
    };
  });
  for (const key of ['traversal', 'absolute', 'wrongType', 'badHandle', 'command'] as const) expect(results[key], key).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  expect(results.hidden).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(results.paste).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  for (const key of ['quit', 'closeWindow', 'newWindow', 'openLogs'] as const) expect(results[key], key).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(await app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked)).toEqual(['Exit Atlas?', 'Close the last window and exit Atlas?', 'Open a new Atlas window?', 'Open the folder with Atlas’s logs?']);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(results.external).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(results.ok).toBe(true);
});

test('the file protocol serves only this window’s folder, and the window cannot navigate away or open windows', async () => {
  const { window: atlasWindow, app } = launched!;
  // Requests through the window's own session, as its pages make them.
  const status = await app.evaluate(async ({ BrowserWindow }) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    const get = (url: string) => session.fetch(url).then(response => response.status, () => 'blocked');
    return {
      readme: await get('atlas://planning/README.md'),
      escape: await get('atlas://planning/..%2F..%2Fsecret.txt'),
      hidden: await get('atlas://planning/active/0001-saved-payment-methods/.atlas/models/m-024410515ef6611f71e02bdc.json'),
      app: await get('atlas://app/index.html'),
      appEscape: await get('atlas://app/..%2Fmain%2Findex.js'),
      other: await get('atlas://elsewhere/README.md'),
    };
  });
  expect(status).toEqual({ readme: 200, escape: 403, hidden: 403, app: 200, appEscape: 404, other: 404 });
  // The page itself cannot reach the network or read planning files with fetch.
  const page = await atlasWindow.evaluate(async () => ({
    remote: await fetch('https://example.com/').then(() => 'loaded', () => 'blocked'),
    planning: await fetch('atlas://planning/README.md').then(() => 'loaded', () => 'blocked'),
  }));
  expect(page).toEqual({ remote: 'blocked', planning: 'blocked' });
  // Web links go to the system browser; record them instead of starting one.
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { openedExternally?: string[] }).openedExternally = opened;
    shell.openExternal = (async (url: string) => { opened.push(url); }) as typeof shell.openExternal;
  });
  await atlasWindow.evaluate(() => { window.open('https://example.com/new', '_blank'); location.href = 'https://example.com/away'; });
  await atlasWindow.waitForTimeout(800);
  const state = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.webContents.getURL()));
  expect(state).toEqual(['atlas://app/index.html']);
  expect(await app.evaluate(() => (globalThis as { openedExternally?: string[] }).openedExternally)).toEqual(['https://example.com/new', 'https://example.com/away']);
});
