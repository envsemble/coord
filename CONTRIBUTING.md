# Working on Atlas

Keep semantic documents separate from capture adapters, validation, layout and React rendering. The viewer inspects models; agents/library calls author them. Stable semantic IDs survive renames. Evidence-backed snapshots remain immutable and visibly scoped. Unsupported facts use uncertainty/coverage findings rather than guessed relations or counts.

Use Node 24, npm and Java 21. Run `npm ci`, then `npm run dev` for React/Vite live updates at `127.0.0.1:5173`. Source and UI live in `lib/`, `src/` and `development/`; the R5 model is under `examples/r5`. The [architecture](docs/architecture.md), [agent](docs/agent-interface.md) and adapter guides own their contracts.

Run relevant capability tests while changing behavior, then `npm run format`, `npm run check:types`, `npm test`, `npm run build`, `npm run check` and `npm run check:package`. Commit generated `index.html`, `downloads/` and `dist/` together with source. Full database verification requires `ATLAS_TEST_POSTGRES` targeting a disposable PostgreSQL 17 fixture; credentials belong in the environment, never models. Windows-specific and POSIX-specific tests disclose skips.

PR/MR descriptions should identify the behavior change, supported scope, evidence and validation. Use [revision review artifacts](docs/review-ci.md) for architecture changes, retain merge conflicts explicitly and link consequential decisions to their planning context. Human acceptance and merge stay separate from generated findings. Versioned artifacts can be checked with [release assembly](docs/releases.md); no publishing/deployment is implied.

Branding sources are editable SVG in `assets/`. Screenshots must show the actual application and have useful alternative text. Keep private source excerpts scoped and attributed. Source/asset licensing remains `UNLICENSED`; do not introduce a public license without the owner's decision.
