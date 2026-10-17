import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, searchForWorkspaceRoot, type Plugin } from 'vite';
import { themeStorageKey } from './shared/theme';

// The production policy is also sent as a header by the atlas:// protocol (main/windows/protocol.ts).
// Development allows the Vite client (inline React refresh preamble, HMR socket) on localhost only.
const productionPolicy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' atlas: data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const developmentPolicy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' atlas: data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

function contentSecurityPolicy(): Plugin {
  let policy = productionPolicy;
  return {
    name: 'atlas-content-security-policy',
    configResolved(config) { policy = config.command === 'serve' ? developmentPolicy : productionPolicy; },
    transformIndexHtml(html) { return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`); },
  };
}

// envUI's theme startup script, as a file the policy allows ('self'), run before the first paint so
// a dark theme does not flash light.
async function themeScript() {
  // In live envUI development, envUI's watcher rebuilds its output as it starts, so wait for it briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      const { createThemeBootstrapScript } = await import('@envsemble/envui/theme-bootstrap');
      return createThemeBootstrapScript({ storageKey: themeStorageKey });
    } catch (error) {
      if (attempt >= 40) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
}
function themeStartup(): Plugin {
  return {
    name: 'atlas-theme-startup',
    configureServer(server) {
      server.middlewares.use('/theme-startup.js', (_request, response, next) => {
        themeScript().then(script => { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }, next);
      });
    },
    async generateBundle() { this.emitFile({ type: 'asset', fileName: 'theme-startup.js', source: await themeScript() }); },
    // After the policy (head-prepend would put it first) and before the stylesheets and the app.
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/theme-startup.js' }, injectTo: 'head' }],
  };
}

// `npm run dev:envui` links a local envUI checkout and sets ENVUI_SOURCE: the renderer then reads
// envUI's source through its `envui-source` export condition, so library edits reload at once.
const envUISource = process.env.ENVUI_SOURCE === '1';
const envUIRoot = envUISource ? realpathSync(resolve(import.meta.dirname, 'node_modules/@envsemble/envui')) : null;

// The atlas package's plan export reads two of its files (src/packageFiles.ts): its package.json
// (for the version it records) and dist/plan-viewer.html (the export template). Bundled into
// out/main, those paths resolve to out/package.json and out/dist/plan-viewer.html.
function planningFiles(): Plugin {
  const planning = resolve(import.meta.dirname, '../packages/atlas');
  return {
    name: 'atlas-package-files',
    writeBundle(options) {
      const out = resolve(options.dir ?? dirname(options.file!), '..');
      const { version } = JSON.parse(readFileSync(resolve(planning, 'package.json'), 'utf8')) as { version: string };
      writeFileSync(resolve(out, 'package.json'), JSON.stringify({ type: 'module', version }, null, 2) + '\n');
      mkdirSync(resolve(out, 'dist'), { recursive: true });
      writeFileSync(resolve(out, 'dist/plan-viewer.html'), readFileSync(resolve(planning, 'dist/plan-viewer.html')));
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // The diagram package (CommonJS with native and lazily loaded dependencies) stays in
      // node_modules; everything else, including the planning reader, is bundled.
      externalizeDeps: { include: ['@envsemble/atlas-diagrams'] },
      // The app's main process and the Atlas host it runs in a utility process (main/host/hostProcess.ts).
      lib: { entry: { index: resolve(import.meta.dirname, 'main/index.ts'), host: resolve(import.meta.dirname, 'main/host/hostProcess.ts') } },
      sourcemap: true,
      // ws loads these optional native speed-ups only when installed; Atlas does not ship them.
      rolldownOptions: { external: ['bufferutil', 'utf-8-validate'] },
    },
    plugins: [planningFiles()],
  },
  preload: {
    build: {
      // Sandboxed preloads must be a single CommonJS file that requires only 'electron'.
      externalizeDeps: false,
      lib: { entry: resolve(import.meta.dirname, 'preload/index.ts'), formats: ['cjs'] },
      rolldownOptions: { output: { entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: import.meta.dirname,
    publicDir: resolve(import.meta.dirname, '../packages/diagrams/assets'),
    build: { rolldownOptions: { input: resolve(import.meta.dirname, 'index.html') } },
    resolve: { dedupe: ['react', 'react-dom'], ...(envUISource && { conditions: ['envui-source', ...defaultClientConditions] }) },
    ...(envUISource && { optimizeDeps: { exclude: ['@envsemble/envui'] } }),
    ...(envUIRoot && { server: { fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), envUIRoot] } } }),
    plugins: [react(), contentSecurityPolicy(), themeStartup()],
  },
});
