# Working on Atlas

## Principles

Keep plans, lifecycle decisions and reported outcomes in the associated planning repository, never in this one; the plugin's skills and tools assist that workflow, and the desktop app writes to a planning folder only through an explicit user action (importing a plan). Keep semantic documents separate from capture adapters, validation, layout and React rendering. The viewer inspects models; agents/library calls author them. Stable semantic IDs survive renames. Evidence-backed snapshots remain immutable and visibly scoped. Unsupported facts use uncertainty/coverage findings rather than guessed relations or counts.

## Set up and run

Use Node 24, npm and Java 21. The interface comes from envUI (`@envsemble/envui`), Envsemble's private package on GitHub Packages, so `npm ci` needs a GitHub token with `read:packages` in `NODE_AUTH_TOKEN` and this line in your user `.npmrc` (never in the repository's):

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

With the GitHub CLI, `NODE_AUTH_TOKEN=$(gh auth token)` works once its token has the `read:packages` scope. CI uses the workflow's `GITHUB_TOKEN`, which needs read access to the envUI package (Envsemble's package settings). Run `npm ci`, then:

- `npm run dev` starts the desktop app with hot reload (`npm run dev -- /path/to/planning` opens a folder);
- `npm run dev:envui` does the same against a local envUI checkout beside this one (`../envUI`, or `ENVUI_PATH`), with live reload for envUI's components too; it links that checkout into the app, the plan viewer and the diagram viewer without changing `package.json` or the lockfile. `npm run envui:unlink` returns to the published version, and `node scripts/dev-envui.mjs --link` links again after an `npm install` replaced the link;
- `npm run dev:diagrams` starts the diagram viewer alone at `http://127.0.0.1:5173/`, showing the shop example, with React/Vite live updates;
- `npm run build` produces `packages/diagrams/index.html`, `packages/diagrams/downloads/` and the reusable React module. The HTML opens directly from disk (or with `npm run preview` at port 4173) and needs no internet or model service.

The examples in `packages/diagrams/examples` are work folders of diagram files: `shop` is a TypeScript capture with a proposal of saved payment methods, shown by [index.html](packages/diagrams/index.html), and `enrollment` a class diagram with four scenarios. `npm run check` checks them and the committed showcase.

## Layout

| Path                | What it is                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`              | The Electron desktop app: its main process in `app/main`, the window in `app/src` ([app guide](app/README.md)). electron-vite builds its main process, preload script and window, and electron-builder packages it (`npm run package`).                                                                                                                 |
| `packages/host`     | The Atlas host: reads and watches planning folders for the app and serves them to paired computers ([remote access](docs/remote-access.md)).                                                                                                                                                                                                            |
| `packages/planning` | The planning-folder reader shared by the app, the host and the `atlas` command, plan export and import, and the plan export viewer (`packages/planning/viewer`).                                                                                                                                                                                        |
| `packages/cli`      | The `atlas` command ([command reference](docs/command.md)).                                                                                                                                                                                                                                                                                             |
| `packages/diagrams` | The diagram package: source and UI in `lib/`, `src/` and `development/`, and the example diagrams under `examples/`.                                                                                                                                                                                                                                    |
| `plugin/`           | The Atlas plugin for Claude Code and Codex: its manifests, MCP server configuration, hooks and the `atlas` and `atlas-implement` skills, with their packaging test in `plugin/tests` ([agent interface](docs/agent-interface.md)). The marketplace manifests that name it are `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. |
| `extras/`           | Skills that are not part of the plugin, installed separately: `babysit-pr`.                                                                                                                                                                                                                                                                             |

The [architecture](docs/architecture.md), [agent](docs/agent-interface.md) and adapter guides own their contracts. The host, the planning reader and the command are TypeScript that Node 24 runs directly without a build step, so they use only erasable syntax (no enums, namespaces or parameter properties; their `erasableSyntaxOnly` setting enforces this) and `.ts` import extensions. The plan export viewer reuses the app's styles and the diagram package's React viewer; `npm run build --workspace @envsemble/atlas-planning` rebuilds its committed bundle, `packages/planning/dist/plan-viewer.html`, and CI fails when the committed bundle is stale.

## Checks

Run relevant capability tests while changing behavior, then:

```sh
npm run format:check
npm run check:types
npm test
npm run test:skills
npm run build
npm run check
npm run check:package
npm run check:performance
npm run check:review
npm run review:example -- artifacts/review
npm run check:release
```

`npm run format` fixes formatting. Commit the generated `index.html`, `downloads/` and `dist/` in `packages/diagrams` together with source. The app's end-to-end suite drives the packaged app (`npm run package`, then `npm run test:e2e`; the [app guide](app/README.md#develop) has the options). Full database verification requires `ATLAS_TEST_POSTGRES` targeting a disposable PostgreSQL 17 fixture; credentials belong in the environment, never models. Clean-package checks exercise Node/React, actual TS/Java capture and offline output; export/reopen has dedicated fixtures. Windows-specific and POSIX-specific tests disclose skips.

## Pull requests

PR/MR descriptions should identify the behavior change, supported scope, evidence and validation. Use [revision review artifacts](docs/review-ci.md) for architecture changes, retain merge conflicts explicitly and link consequential decisions to their planning context. Human acceptance and merge stay separate from generated findings. Versioned artifacts can be checked with [release assembly](docs/releases.md); no publishing/deployment is implied.

CI runs only for `main`, on pushes to it and on pull requests into it. There, `CI` and `Betterleaks` are required checks; the scanner is version- and hash-pinned and scans the retained Git history. Pull requests into `dev` get no CI for now, so before asking for review:

- run the checks above locally, including the end-to-end suite;
- run the Node and plugin suites on Linux too where you can, for example in a container;
- scan the branch's history with the same Betterleaks version (`betterleaks git . --redact`);
- say in the PR what ran.

**Run workflow** on the repository's Actions tab still runs CI on any branch.

## Branding and licensing

Branding sources are editable SVG in `assets/`. Screenshots, including `app/assets`, must show the actual application and have useful alternative text. Keep private source excerpts scoped and attributed. Source/asset licensing remains `UNLICENSED`; do not introduce a public license without the owner's decision.
