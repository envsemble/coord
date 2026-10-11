import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// The production policy is also sent as a header by the atlas:// protocol (main/protocol.ts).
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

// The planning package's plan export reads two files next to its own module: its package.json
// (for the version it records) and dist/plan-viewer.html (the export template). Bundled into
// out/main, those paths resolve to out/package.json and out/dist/plan-viewer.html.
function planningFiles(): Plugin {
  const planning = resolve(import.meta.dirname, '../packages/planning');
  return {
    name: 'atlas-planning-files',
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
      // The app's main process and the Atlas host it runs in a utility process (main/hostProcess.ts).
      lib: { entry: { index: resolve(import.meta.dirname, 'main/index.ts'), host: resolve(import.meta.dirname, 'main/hostProcess.ts') } },
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
    plugins: [react(), contentSecurityPolicy()],
  },
});
