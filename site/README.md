# Coord's website

The page at coord.envsemble.com: one dark page with what Coord is, a download button for Windows and one for Linux (the newest stable build), a link to the newest nightly, and a screenshot of a plan. It is a static page built with Vite and React, without envUI: the download buttons are the familiar store-style ones. It asks GitHub for the newest releases of `envsemble/coord` in the visitor's browser (`src/releases.ts`), so a new release needs no new build of the site.

Beside it, `/open` (`open.html`, `src/open.ts`) forwards a link to work to the app: `coord.envsemble.com/open#coord/0032-2` becomes `coord://open/coord/0032-2`, which the installed app is registered for. It is a file like the rest: nothing runs on a server, and what follows the `#` never leaves the browser. It shares the link's rules with the app (`packages/coord/src/planning/work/links.ts`).

## Run it locally

From the repository's root, after `npm ci`:

- `npm run dev:site` serves it at `http://127.0.0.1:5180/` and reloads as you edit.
- `npm run build --workspace @envsemble/coord-site` builds it into `site/dist/`; `npm run preview --workspace @envsemble/coord-site` serves that build at `http://127.0.0.1:4180/`.

## Deploy it

The site is a Cloudflare Worker that serves only the static files in `site/dist/` (`site/wrangler.jsonc`), at its custom domain `coord.envsemble.com`. In Cloudflare, **Workers & Pages › Create › Import a repository**, choose `envsemble/coord` and set:

| Setting              | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| Production branch    | `main`                                                      |
| Root directory       | `/` (the repository's root, for the workspace)              |
| Build command        | `npm ci && npm run build --workspace @envsemble/coord-site` |
| Deploy command       | `npx wrangler deploy --config site/wrangler.jsonc`          |
| Environment variable | `NODE_VERSION=24`                                           |

The first deploy adds the custom domain itself (envsemble.com's DNS is on Cloudflare). A new release needs no new deploy: the page reads the releases in the visitor's browser.
