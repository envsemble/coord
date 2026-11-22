// Builds Coord's website into dist/: static files any host serves (Cloudflare Pages, for
// coord.envsemble.com). The page asks GitHub for the newest builds in the visitor's browser, so a new
// release needs no new build of the site. Beside it, /open is the page that forwards a link to work
// to the app (open.html); it shares the link's rules with the app (packages/coord), read from the
// repository beside this folder.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: path.resolve(import.meta.dirname, 'index.html'), open: path.resolve(import.meta.dirname, 'open.html') } } },
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 4180, host: '127.0.0.1' },
});
