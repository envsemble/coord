// Test support: drive an installed Chromium-based browser over the DevTools protocol,
// without a browser-automation dependency. Returns null when no browser is installed.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function candidates() {
  const fromEnvironment = process.env.ATLAS_TEST_CHROMIUM ? [process.env.ATLAS_TEST_CHROMIUM] : [];
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((value): value is string => Boolean(value));
    return [...fromEnvironment, ...roots.flatMap(root => [path.join(root, 'Google/Chrome/Application/chrome.exe'), path.join(root, 'Chromium/Application/chrome.exe'), path.join(root, 'Microsoft/Edge/Application/msedge.exe')])];
  }
  if (process.platform === 'darwin') return [...fromEnvironment, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  return [...fromEnvironment, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}
export function findChromium() { return candidates().find(file => existsSync(file)) ?? null; }

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string };
export interface Page {
  /** Every request the page made, by URL. */
  requests: string[];
  /** Console errors, uncaught exceptions and browser log errors (such as content security policy reports). */
  errors: string[];
  evaluate<T>(expression: string): Promise<T>;
  waitFor(expression: string, timeout?: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  navigate(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
}
export interface Browser { open(): Promise<Page>; close(): Promise<void> }

export async function launchChromium(): Promise<Browser | null> {
  const binary = findChromium();
  if (!binary) return null;
  const profile = mkdtempSync(path.join(tmpdir(), 'atlas-chromium-'));
  const child: ChildProcess = spawn(binary, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-gpu',
    '--window-size=1400,1000', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start: ' + output)), 30000);
    child.stderr!.on('data', chunk => {
      output += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('Chromium exited: ' + output)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
  const listeners = new Map<string, (message: Message) => void>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as Message;
    if (message.id !== undefined) {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message)); else waiting?.resolve(message.result ?? {});
    } else if (message.sessionId) listeners.get(message.sessionId)?.(message);
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    async open() {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
      const requests: string[] = [], errors: string[] = [];
      let loaded: (() => void) | null = null;
      listeners.set(sessionId, message => {
        const params = message.params ?? {};
        if (message.method === 'Network.requestWillBeSent') requests.push(String((params.request as { url: string }).url));
        if (message.method === 'Runtime.exceptionThrown') errors.push('exception: ' + JSON.stringify((params.exceptionDetails as { exception?: { description?: string }; text?: string }).exception?.description ?? params.exceptionDetails));
        if (message.method === 'Runtime.consoleAPICalled' && params.type === 'error') errors.push('console: ' + JSON.stringify(params.args));
        if (message.method === 'Log.entryAdded') { const entry = params.entry as { level: string; text: string; source: string }; if (entry.level === 'error') errors.push(entry.source + ': ' + entry.text); }
        if (message.method === 'Page.loadEventFired') loaded?.();
      });
      for (const domain of ['Network', 'Page', 'Runtime', 'Log']) await send(domain + '.enable', {}, sessionId);
      const page: Page = {
        requests, errors,
        async evaluate<T>(expression: string) {
          const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId) as { result: { value: T }; exceptionDetails?: unknown };
          if (result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails));
          return result.result.value;
        },
        async waitFor(expression: string, timeout = 20000) {
          const deadline = Date.now() + timeout;
          while (!(await page.evaluate<boolean>(`Boolean(${expression})`))) {
            if (Date.now() > deadline) throw new Error('Timed out waiting for ' + expression + '\n' + errors.join('\n'));
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        },
        async click(x: number, y: number) {
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 }, sessionId);
        },
        async navigate(url: string) {
          const done = new Promise<void>(resolve => { loaded = resolve; });
          await send('Page.navigate', { url }, sessionId);
          await done;
        },
        async screenshot() {
          const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId) as { data: string };
          return Buffer.from(data, 'base64');
        },
      };
      return page;
    },
    async close() {
      try { await send('Browser.close'); } catch { /* Already closing. */ }
      socket.close();
      await new Promise(resolve => { if (child.exitCode !== null) resolve(null); else { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(null); }, 5000); } });
      for (let attempt = 0; attempt < 10; attempt++) {
        try { rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
      }
    },
  };
}
