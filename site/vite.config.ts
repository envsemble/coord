// Builds Coord's website into dist/: static files any host serves (Cloudflare Pages, for
// coord.envsemble.com). The page asks GitHub for the newest builds in the visitor's browser, so a new
// release needs no new build of the site.
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createThemeBootstrapScript } from '@envsemble/envui/theme-bootstrap';
import { themeStorageKey } from './src/theme.ts';

/** A saved dark theme applies before the first paint, so the page does not flash light. */
function themeBootstrap(): Plugin {
  return {
    name: 'coord-site-theme-bootstrap',
    transformIndexHtml: () => [{ tag: 'script', children: createThemeBootstrapScript({ storageKey: themeStorageKey }), injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  plugins: [react(), themeBootstrap()],
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 4180, host: '127.0.0.1' },
});
