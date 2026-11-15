// Builds Coord's website into dist/: static files any host serves (Cloudflare Pages, for
// coord.envsemble.com). The page asks GitHub for the newest builds in the visitor's browser, so a new
// release needs no new build of the site.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 4180, host: '127.0.0.1' },
});
