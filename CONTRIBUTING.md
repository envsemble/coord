# Working on Atlas

## Principles

Keep plans, lifecycle decisions and reported outcomes in the associated planning repository, never in this one; the skills assist that workflow, and the desktop app writes to a planning folder only through an explicit user action (importing a plan). Keep semantic documents separate from capture adapters, validation, layout and React rendering. The viewer inspects models; agents/library calls author them. Stable semantic IDs survive renames. Evidence-backed snapshots remain immutable and visibly scoped. Unsupported facts use uncertainty/coverage findings rather than guessed relations or counts.

## Set up and run

Use Node 24, npm and Java 21. Run `npm ci`, then:

- `npm run dev` starts the desktop app with hot reload (`npm run dev -- /path/to/planning` opens a folder);
- `npm run dev:diagrams` starts the diagram viewer alone at `http://127.0.0.1:5173/` with React/Vite live updates;
- `npm run build` produces `packages/diagrams/index.html`, `packages/diagrams/downloads/` and the reusable React module. The HTML opens directly from disk (or with `npm run preview` at port 4173) and needs no internet or model service.

The enrollment example includes valid instances and counterexamples; the R5 example in [index.html](packages/diagrams/index.html) uses pinned public Season 3 sources and preserves three ontology findings for investigation. Build the enrollment example with its report:

```sh
node packages/diagrams/scripts/build-enrollment.cjs artifacts/enrollment --report
```

## Layout

| Path                | What it is                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`              | The Electron desktop app: its main process in `app/main`, the window in `app/src` ([app guide](app/README.md)). electron-vite builds its main process, preload script and window, and electron-builder packages it (`npm run package`). |
| `packages/host`     | The Atlas host: reads and watches planning folders for the app and serves them to paired computers ([remote access](docs/remote-access.md)).                                                                                            |
| `packages/planning` | The planning-folder reader shared by the app, the host and the `atlas` command, plan export and import, and the plan export viewer (`packages/planning/viewer`).                                                                        |
| `packages/cli`      | The `atlas` command ([command reference](docs/command.md)).                                                                                                                                                                             |
| `packages/diagrams` | The diagram package: source and UI in `lib/`, `src/` and `development/`, and the R5 model under `examples/r5`.                                                                                                                          |
| `skills/`           | The agent skills ([skills](skills/README.md)).                                                                                                                                                                                          |

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

PR/MR descriptions should identify the behavior change, supported scope, evidence and validation. Use [revision review artifacts](docs/review-ci.md) for architecture changes, retain merge conflicts explicitly and link consequential decisions to their planning context. Human acceptance and merge stay separate from generated findings. Versioned artifacts can be checked with [release assembly](docs/releases.md); no publishing/deployment is implied. Required GitHub checks are `CI` and `Betterleaks`; the scanner is version- and hash-pinned and scans the retained Git history.

## Branding and licensing

Branding sources are editable SVG in `assets/`. Screenshots, including `app/assets`, must show the actual application and have useful alternative text. Keep private source excerpts scoped and attributed. Source/asset licensing remains `UNLICENSED`; do not introduce a public license without the owner's decision.
