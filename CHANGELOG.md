# Changelog

## One Atlas — 2026-10-09

- Combined the planning app, the planning skills and the diagram engine into this repository as one product, Atlas. The app's and skills' history came along with their files; [history maps](docs/history/README.md) translate their earlier commit IDs.
- Laid the repository out as an npm workspace: `app/`, `packages/diagrams` (`@envsemble/atlas-diagrams`, private and internal), `packages/planning`, `packages/cli` and `skills/`. The app uses the diagram package directly, with no vendored tarball.
- Added the `atlas` command: `atlas model …`, `atlas mcp`, `atlas planning check` and `atlas usage log`. Atlas needs only Node; the Python helpers were ported.
- Renamed the skills to `atlas-bootstrap`, `atlas-grill`, `atlas-implement`, `atlas-record`, `atlas-organize`, `atlas-babysit-pr` and `atlas-model`, and made them provider-agnostic.
- Moved usage statistics and recent folders to the per-user Atlas data folder.
- Branded the app as Atlas, with the redesigned overlay viewer and dashboard.
- Removed backward compatibility: pre-document (0.4) offline HTML is no longer importable, model context record paths resolve only relative to their work folder, and planning-root `.atlas/` folders are not read. Existing records were migrated to the current format.
- One release ZIP, `atlas-<version>-<commit>.zip` with an `atlas/release` manifest, covers the whole product.

## GitHub migration — 2026-10-08

- Moved canonical source to `envsemble/atlas` with its original Git history.
- Replaced GitLab delivery with GitHub Actions and required `CI`/`Betterleaks` checks, retaining all adapter, consumer and reproducible artifact gates.
- Linked the Worktrail planning skills/dashboard and updated package metadata.

## 0.5.0 — 2026-10-08

- Versioned documents for authored OntoUML, captured database/code structure and proposals, preserving immutable baselines and selected planning context.
- Portable offline HTML import, continued agent edits and repeatable export.
- Typed Node library, persistent CLI/stdio MCP and native React planning-dashboard integration.
- PostgreSQL 17, SQLite 3.45+ / Node 24, scoped local D1, TypeScript 6.0.3 and Java 21 capture adapters with explicit coverage.
- Stable semantic comparison, shared diagram positions, explicit three-way conflicts, baseline adoption and authored cross-layer mappings.
- Named shared inheritance trunks, cardinalities, scoped evidence snippets, GitHub Dark Dimmed/light themes and local smooth camera interaction.
- Authored walkthroughs, finite instances/counterexamples and printable offline semester reports.
- Revision-based PR/MR artifacts, source-evidence review, CI verification and nonpublishing versioned release assembly.
- Editable Atlas branding, actual workflow screenshots and documented package consumers.

## Earlier prototype

The R5 Season 3 example and offline React visualization predate the document workflow. Legacy 0.4 exports remain importable within documented size and format limits.
