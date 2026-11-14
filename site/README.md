# Coord's website

The page at coord.envsemble.com: what Coord is, a button that downloads the newest stable build for the visitor's system, and every build of the stable and nightly channels. It is a static page built with Vite, React and envUI. It asks GitHub for the newest releases of `envsemble/coord` in the visitor's browser (`src/releases.ts`), so a new release needs no new build of the site.

## Run it locally

From the repository's root, after `npm ci`:

- `npm run dev:site` serves it at `http://127.0.0.1:5180/` and reloads as you edit.
- `npm run build --workspace @envsemble/coord-site` builds it into `site/dist/`; `npm run preview --workspace @envsemble/coord-site` serves that build at `http://127.0.0.1:4180/`.

## Deploy it

Any static host serves `site/dist/`. On Cloudflare Pages, connect the repository with:

| Setting                | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Production branch      | `main`                                                      |
| Build command          | `npm ci && npm run build --workspace @envsemble/coord-site` |
| Build output directory | `site/dist`                                                 |
| Root directory         | `/` (the repository's root, for the workspace)              |
| Environment variable   | `NODE_VERSION=24`                                           |

Then add `coord.envsemble.com` as the project's custom domain; envsemble.com's DNS is on Cloudflare already.
