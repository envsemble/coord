// A page's frame: the document Atlas runs one page in, on an origin of its own (atlas://page), so a
// page that fails or hangs takes only its frame with it. It supplies Atlas's stack to the page's
// build (React, envUI with its entry points and icons, the diagram viewer, @envsemble/atlas-page),
// loading what the build imports, and talks to the window through the port it is handed.
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDOM from 'react-dom';
import * as reactDOMClient from 'react-dom/client';
import { createRoot, type Root } from 'react-dom/client';
import * as envui from '@envsemble/envui';
import { Alert, Theme } from '@envsemble/envui';
import * as atlasPage from './atlasPage';
import type { ColorScheme, FrameInit, FromFrame, PageInfo, ToFrame } from './pageMessages';
import './frame.css';

type Module = Record<string, unknown>;
/** What every page has at hand. */
const ready: Record<string, Module> = {
  react: React as unknown as Module, 'react/jsx-runtime': jsxRuntime as unknown as Module, 'react/jsx-dev-runtime': jsxRuntime as unknown as Module,
  'react-dom': reactDOM as unknown as Module, 'react-dom/client': reactDOMClient as unknown as Module,
  '@envsemble/envui': envui as unknown as Module, '@envsemble/atlas-page': atlasPage as unknown as Module,
};
/** What loads when a page imports it. */
const later: Record<string, () => Promise<unknown>> = {
  '@envsemble/envui/code': () => import('@envsemble/envui/code'),
  '@envsemble/envui/markdown': () => import('@envsemble/envui/markdown'),
  '@envsemble/envui/diff': () => import('@envsemble/envui/diff'),
  '@envsemble/envui/messages': () => import('@envsemble/envui/messages'),
  '@envsemble/atlas-diagrams/react': () => Promise.all([import('@envsemble/atlas-diagrams/react'), import('@envsemble/atlas-diagrams/embedded.css')]).then(([module]) => module),
};
// envUI's icons, one module each, loaded as a page imports them.
const icons = import.meta.glob('../../../node_modules/@envsemble/envui/dist/icons/*.js');
const iconModules = new Map(Object.entries(icons).map(([file, load]) => [file.slice(file.lastIndexOf('/') + 1, -3), load]));

async function load(specifier: string): Promise<void> {
  if (ready[specifier]) return;
  const icon = /^@envsemble\/envui\/icons\/([^/]+)$/.exec(specifier);
  const loader = icon ? iconModules.get(icon[1]) : later[specifier];
  if (!loader) throw new Error(`${specifier} is not part of Atlas's stack.`);
  ready[specifier] = await loader() as Module;
}
function require(specifier: string): Module {
  const module = ready[specifier];
  if (!module) throw new Error(`${specifier} is not part of Atlas's stack.`);
  return module;
}

let port: MessagePort | null = null;
let info: PageInfo | null = null;
let theme: ColorScheme = 'light';
let root: Root | null = null;
let shown: { Component: React.ComponentType; build: number } | null = null;
let failure: string | null = null;
const listeners = new Set<(paths: string[]) => void>();
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let requests = 0;

function post(message: FromFrame) { port?.postMessage(message); }

/** The page, or why it failed, inside envUI's theme. */
class Boundary extends React.Component<{ build: number; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { post({ type: 'failed', message: error.message }); }
  componentDidUpdate(previous: { build: number }) { if (previous.build !== this.props.build && this.state.error) this.setState({ error: null }); }
  render() { return this.state.error ? <Failed message={this.state.error.message} /> : this.props.children; }
}
function Failed({ message }: { message: string }) {
  return <div className="page-failed"><Alert tone="danger" title="This page failed">{message}</Alert></div>;
}

function render() {
  root ??= createRoot(document.getElementById('root')!);
  document.documentElement.dataset.theme = theme;
  root.render(<Theme theme={theme} className="page-theme">
    {failure ? <Failed message={failure} /> : shown ? <Boundary build={shown.build}><shown.Component key={shown.build} /></Boundary> : null}
  </Theme>);
}

async function run(message: Extract<ToFrame, { type: 'build' }>) {
  try {
    await Promise.all(message.imports.map(load));
    const module = { exports: {} as Module };
    // The build is one CommonJS module: its imports of the stack are require calls.
    new Function('require', 'module', 'exports', message.code + '\n//# sourceURL=atlas-page/' + encodeURIComponent(info?.name ?? 'page') + '.js')(require, module, module.exports);
    const Component = (module.exports.default ?? module.exports.Page) as React.ComponentType | undefined;
    if (typeof Component !== 'function') throw new Error('A page exports its component as the default: export default function Page() { … }.');
    let style = document.getElementById('page-style');
    if (!style) { style = document.createElement('style'); style.id = 'page-style'; document.head.append(style); }
    style.textContent = message.css;
    failure = null;
    shown = { Component, build: message.build };
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    post({ type: 'failed', message: failure });
  }
  render();
}

function receive(event: MessageEvent<ToFrame>) {
  const message = event.data;
  if (message.type === 'build') void run(message);
  else if (message.type === 'theme') { theme = message.theme; render(); }
  else if (message.type === 'changed') for (const listener of listeners) listener(message.paths);
  else if (message.type === 'answer') {
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (!waiting) return;
    if (message.ok) waiting.resolve(message.value); else waiting.reject(new Error(message.error));
  }
}

// Failures outside React (a promise nobody awaited, an event handler) show in place of the page.
window.addEventListener('error', event => { failure = event.message; post({ type: 'failed', message: event.message }); render(); });
window.addEventListener('unhandledrejection', event => { const message = event.reason instanceof Error ? event.reason.message : String(event.reason); post({ type: 'failed', message }); });

// The window starts the page: once, from the window that holds this frame.
window.addEventListener('message', (event: MessageEvent<FrameInit>) => {
  if (port || event.source !== window.parent || event.data?.type !== 'atlas-page:init' || !event.ports[0]) return;
  port = event.ports[0];
  info = event.data.page;
  theme = event.data.theme;
  document.title = info.name;
  atlasPage.connect({
    page: info,
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++requests;
      pending.set(id, { resolve, reject });
      post({ type: 'request', id, method, params } as FromFrame);
    }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  port.onmessage = receive;
  render();
});
