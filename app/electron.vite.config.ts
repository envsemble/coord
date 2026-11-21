import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, searchForWorkspaceRoot, type Plugin } from 'vite';
import { coordTheme, coordThemeStorage } from './shared/theme';
import { pagePolicy } from './shared/pagePolicy';

// The production policy is also sent as a header by the coord:// protocol (main/windows/protocol.ts).
// Development allows the Vite client (inline React refresh preamble, HMR socket) on localhost only.
// The window may frame only its pages' frames (coord://page, or the dev server in development).
const productionPolicy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' coord: data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src coord://page; worker-src 'none'; base-uri 'none'; form-action 'none'";
const developmentPolicy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' coord: data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; object-src 'none'; frame-src 'self'; worker-src 'none'; base-uri 'none'; form-action 'none'";

function contentSecurityPolicy(): Plugin {
  let serving = false;
  return {
    name: 'coord-content-security-policy',
    configResolved(config) { serving = config.command === 'serve'; },
    // A page's frame runs the page's own code, under its own policy (shared/pagePolicy.ts).
    transformIndexHtml(html, context) {
      const policy = context.filename.endsWith('page-frame.html') ? pagePolicy(serving, true) : serving ? developmentPolicy : productionPolicy;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

// envUI's theme startup script, as a file the policy allows ('self'), run before the first paint so
// a dark theme does not flash light.
async function themeScript() {
  // In live envUI development, envUI's watcher rebuilds its output as it starts, so wait for it briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      const { createStoredThemeBootstrapScript } = await import('@envsemble/envui/theme-storage');
      return createStoredThemeBootstrapScript(coordTheme, coordThemeStorage);
    } catch (error) {
      if (attempt >= 40) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
}
function themeStartup(): Plugin {
  return {
    name: 'coord-theme-startup',
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

export default defineConfig({
  main: {
    build: {
      // The diagram package (CommonJS with native and lazily loaded dependencies), esbuild (a
      // native binary, which builds pages) and electron-updater (CommonJS that reads files of its
      // own) stay in node_modules; everything else, including the planning reader, is bundled.
      externalizeDeps: { include: ['@envsemble/coord-diagrams', 'esbuild', 'electron-updater'] },
      // The app's main process and the Coord host it runs in a utility process (main/host/hostProcess.ts).
      lib: { entry: { index: resolve(import.meta.dirname, 'main/index.ts'), host: resolve(import.meta.dirname, 'main/host/hostProcess.ts') } },
      sourcemap: true,
      // ws loads these optional native speed-ups only when installed; Coord does not ship them.
      rolldownOptions: { external: ['bufferutil', 'utf-8-validate'] },
    },
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
    // Minified: the window parses less as it starts (electron-vite leaves the renderer unminified).
    // The window, and the frame each page runs in.
    build: { minify: true, rolldownOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), 'page-frame': resolve(import.meta.dirname, 'page-frame.html') } } },
    resolve: { dedupe: ['react', 'react-dom'], ...(envUISource && { conditions: ['envui-source', ...defaultClientConditions] }) },
    ...(envUISource && { optimizeDeps: { exclude: ['@envsemble/envui'] } }),
    ...(envUIRoot && { server: { fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), envUIRoot] } } }),
    plugins: [react(), contentSecurityPolicy(), themeStartup()],
  },
});
