import { expect, test } from '@playwright/test';
import { close, hubRows, launchProject, type Launched } from './app';

let launched: Launched | undefined;
/** The project's ID, as the bridge names it. */
let project: string;
test.beforeEach(async () => {
  launched = await launchProject();
  project = await launched.window.evaluate(async () => {
    const result = await (window as unknown as { atlas: { projects(): Promise<{ ok: boolean; value: { id: string }[] }> } }).atlas.projects();
    return result.value[0].id;
  });
});
test.afterEach(async () => { await close(launched); launched = undefined; });

test('the window is isolated and sandboxed, with a strict content security policy; the file protocol serves only the projects it follows, and it cannot navigate away or open windows', async () => {
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

  // A plan of the project shows, so the window follows its folder. It opens by a click from the page,
  // which is no person's press, so none is pending below.
  await hubRows(atlasWindow, 'Customer order notifications').first().getByRole('link', { name: 'Customer order notifications', exact: true }).evaluate(link => (link as HTMLElement).click());
  await expect(atlasWindow.locator('.work-header h1')).toHaveText('Customer order notifications');
  // Requests through the window's own session, as its pages make them.
  const status = await app.evaluate(async ({ BrowserWindow }, projectId) => {
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    const get = (url: string) => session.fetch(url).then(response => response.status, () => 'blocked');
    return {
      readme: await get(`atlas://planning/${projectId}/README.md`),
      escape: await get(`atlas://planning/${projectId}/..%2F..%2Fsecret.txt`),
      hidden: await get(`atlas://planning/${projectId}/active/0001-saved-payment-methods/.atlas/plan.md`),
      unfollowed: await get('atlas://planning/f-' + '0'.repeat(32) + '/README.md'),
      app: await get('atlas://app/index.html'),
      appEscape: await get('atlas://app/..%2Fmain%2Findex.js'),
      other: await get('atlas://elsewhere/README.md'),
    };
  }, project);
  expect(status).toEqual({ readme: 200, escape: 403, hidden: 403, unfollowed: 404, app: 200, appEscape: 404, other: 404 });
  // The page itself cannot reach the network or read planning files with fetch.
  const fetched = await atlasWindow.evaluate(async projectId => ({
    remote: await fetch('https://example.com/').then(() => 'loaded', () => 'blocked'),
    planning: await fetch(`atlas://planning/${projectId}/README.md`).then(() => 'loaded', () => 'blocked'),
  }), project);
  expect(fetched).toEqual({ remote: 'blocked', planning: 'blocked' });
  // Web links go to the system browser; record them instead of starting one. A page that sends the
  // window there on its own (no click) is asked about first; the person allows one and declines one.
  await app.evaluate(({ dialog, shell }) => {
    const opened: string[] = [];
    const asked: string[] = [];
    Object.assign(globalThis, { openedExternally: opened, askedExternally: asked });
    shell.openExternal = (async (url: string) => { opened.push(url); }) as typeof shell.openExternal;
    dialog.showMessageBox = (async (_window: unknown, options: { detail?: string }) => { asked.push(options.detail ?? ''); return { response: asked.length === 1 ? 0 : 1, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  });
  // A relative link (in a document or an agent's message) never takes the window off its page.
  await atlasWindow.evaluate(() => { location.href = 'app/src/work/sessions.ts:12'; });
  await atlasWindow.evaluate(() => { window.open('https://example.com/new', '_blank'); });
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { askedExternally: string[] }).askedExternally.length)).toBe(1);
  await atlasWindow.evaluate(() => { location.href = 'https://example.com/away'; });
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { askedExternally: string[] }).askedExternally.length)).toBe(2);
  const state = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(item => item.webContents.getURL()));
  expect(state).toEqual(['atlas://app/index.html']);
  expect(await app.evaluate(() => (globalThis as unknown as { askedExternally: string[] }).askedExternally)).toEqual(['https://example.com/new', 'https://example.com/away']);
  expect(await app.evaluate(() => (globalThis as { openedExternally?: string[] }).openedExternally)).toEqual(['https://example.com/new']);
});

test('messages are checked: wrong arguments, unknown projects and paths outside a project are refused with structured errors, and the folder dialog answers on this computer only, one at a time', async () => {
  const { window: atlasWindow, app } = launched!;
  // Commands a page could misuse ask first without a person's press; the person declines here.
  await app.evaluate(({ dialog }) => {
    const asked: string[] = [];
    (globalThis as unknown as { asked: string[] }).asked = asked;
    dialog.showMessageBox = (async (_window: unknown, options: { message: string }) => { asked.push(options.message); return { response: 1, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  });
  const results = await atlasWindow.evaluate(async projectId => {
    const bridge = (window as unknown as { atlas: unknown }).atlas as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return {
      traversal: await bridge.document(projectId, '../outside.md'),
      absolute: await bridge.document(projectId, 'C:/Windows/win.ini'),
      hidden: await bridge.document(projectId, 'active/0001-saved-payment-methods/.atlas/plan.md'),
      wrongType: await bridge.diagrams(projectId, 42),
      noProject: await bridge.snapshot('not a folder id'),
      otherProject: await bridge.snapshot('f-' + '0'.repeat(32)),
      badDiagram: await bridge.diagram(projectId, 'work-0001', '../../planning.json'),
      notDiagram: await bridge.diagram(projectId, 'work-0001', 'plan.md'),
      command: await bridge.command('openFolder'),
      // Edit's commands are the window's own keys and the application menu's, not the page's.
      paste: await bridge.command('paste'),
      closeWindow: await bridge.command('closeWindow'),
      // A workspace folder is a full path of this computer.
      createRelative: await bridge.createProject('Coord', ['relative/folder']),
      updateRelative: await bridge.updateProject(projectId, { folders: ['..\\up'] }),
      // Quitting and opening windows or the logs ask first.
      quit: await bridge.command('quit'),
      newWindow: await bridge.command('newWindow'),
      openLogs: await bridge.command('openLogs'),
      // So do remote access and pairing, which could hand the computer to someone else.
      access: await bridge.updateAccess({ network: { enabled: true, address: '127.0.0.1', port: 7346 } }),
      pairing: await bridge.createPairing(null, null, { label: null, manageAccess: true }),
      pair: await bridge.pairComputer('http://127.0.0.1:9/#token=abc', null),
      web: await bridge.openExternal('https://example.com/'),
      external: await bridge.openExternal('file:///C:/Windows/System32/calc.exe'),
      // An application's link opens only with a scheme on the allowlist, and asks first.
      application: await bridge.openExternal('t3-thread://thread/abc'),
      script: await bridge.openExternal('javascript:alert(1)'),
      unknownScheme: await bridge.openExternal('ms-settings:'),
      // Open in opens, without asking, only the file of the place the window shows, inside the project's folder.
      notShown: await bridge.openShown({ projectId, target: { kind: 'file', path: 'README.md' } }, 'README.md'),
      fileTraversal: await bridge.openShown({ projectId, target: { kind: 'file', path: '../outside.md' } }, '../outside.md'),
      // Files open only as the host resolves them, and the editor is one of a fixed list.
      referenceKind: await bridge.openReference(projectId, { kind: 'commit', repository: null, value: 'abcdef1', line: null }),
      editorCommand: await bridge.setEditor('notepad.exe'),
      ok: await bridge.document(projectId, 'README.md').then(value => (value as { ok: boolean }).ok),
    };
  }, project);
  for (const key of ['traversal', 'absolute', 'wrongType', 'noProject', 'badDiagram', 'notDiagram', 'command', 'paste', 'closeWindow', 'createRelative', 'updateRelative', 'referenceKind', 'editorCommand', 'fileTraversal'] as const) expect(results[key], key).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  expect(results.hidden).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(results.notShown).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(results.otherProject).toMatchObject({ ok: false });
  for (const key of ['quit', 'newWindow', 'openLogs', 'access', 'pairing', 'pair', 'web', 'application'] as const) expect(results[key], key).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(await app.evaluate(() => (globalThis as unknown as { asked: string[] }).asked)).toEqual([
    'Exit Atlas?', 'Open a new Atlas window?', 'Open the folder with Atlas’s logs?',
    'Let paired devices reach this computer at 127.0.0.1?', 'Create a pairing link for this computer?', 'Pair with the Atlas at 127.0.0.1:9?', 'Open this address in your browser?',
    'Open this link in its application?',
  ]);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  for (const key of ['external', 'script', 'unknownScheme'] as const) expect(results[key], key).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  expect(results.ok).toBe(true);

  // The folder dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async (_window: unknown, options: { properties?: string[] }) => {
      (globalThis as unknown as { openedFor: string[] }).openedFor = options.properties ?? [];
      await new Promise(resolve => setTimeout(resolve, 300));
      return { canceled: true, filePaths: [] };
    }) as unknown as typeof dialog.showOpenDialog;
  });
  const chosen = await atlasWindow.evaluate(async () => {
    const bridge = (window as unknown as { atlas: unknown }).atlas as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const first = bridge.chooseFolder();
    const second = await bridge.chooseFolder();
    return { first: await first, second };
  });
  // Cancelled, the dialog chose nothing; a second one while it is open is refused.
  expect(chosen.first).toEqual({ ok: true, value: null });
  expect(chosen.second).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(await app.evaluate(() => (globalThis as unknown as { openedFor: string[] }).openedFor)).toContain('openDirectory');
});

test('each press allows one command a page could misuse, and not its release or repeats', async () => {
  const { window: atlasWindow, app } = launched!;
  // The page opens web addresses; the person declines every question.
  await app.evaluate(({ dialog, shell }) => {
    const log: string[] = [];
    (globalThis as unknown as { pressLog: string[] }).pressLog = log;
    shell.openExternal = (async (url: string) => { log.push('opened ' + url); }) as typeof shell.openExternal;
    dialog.showMessageBox = (async (_window: unknown, options: { detail?: string }) => { log.push('asked ' + (options.detail ?? '')); return { response: 1, checkboxChecked: false }; }) as unknown as typeof dialog.showMessageBox;
  });
  const open = (name: string) => atlasWindow.evaluate(async url => { await (window as unknown as { atlas: { openExternal(url: string): Promise<unknown> } }).atlas.openExternal(url); }, `https://example.com/${name}`);
  const title = (await atlasWindow.locator('.hub h1').boundingBox())!;
  await atlasWindow.mouse.move(title.x + 4, title.y + title.height / 2);
  await atlasWindow.mouse.down();
  await open('press');
  await atlasWindow.mouse.up();
  await open('release');
  await atlasWindow.keyboard.down('Shift');
  await open('key');
  // Held down, the key repeats.
  await atlasWindow.keyboard.down('Shift');
  await open('repeat');
  await atlasWindow.keyboard.up('Shift');
  await open('key-release');
  // Creating a pairing link asks even right after a press.
  await atlasWindow.mouse.down();
  await atlasWindow.mouse.up();
  expect(await atlasWindow.evaluate(async () => {
    const bridge = (window as unknown as { atlas: { createPairing(...args: unknown[]): Promise<{ ok: boolean; error?: { code: string } }> } }).atlas;
    const result = await bridge.createPairing(null, null, { label: null, manageAccess: false });
    return result.ok ? 'created' : result.error!.code;
  })).toBe('cancelled');
  expect(await app.evaluate(() => (globalThis as unknown as { pressLog: string[] }).pressLog)).toEqual([
    'opened https://example.com/press', 'asked https://example.com/release',
    'opened https://example.com/key', 'asked https://example.com/repeat', 'asked https://example.com/key-release',
    'asked A device that uses it can work on the projects.',
  ]);
});
