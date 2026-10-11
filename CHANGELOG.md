# Changelog

## Unreleased

- Ledger status version 2: the ledger header lists the agreed steps of the work, each `todo`, `doing` or `done`, and replaces `current` and `next`. The app and plan exports show a progress bar, the steps done and left, and each step; the work list shows progress per work item. `atlas planning check` validates the steps. Version-1 headers stay valid and readable. The planning contract (`PLANS.md`), the governance template and the `atlas-implement` and `atlas-record` skills describe the new header.
- Fixed: long documents did not scroll in the desktop app and showed no scrollbar. The workbench grew with its content instead of filling the window; its panes now scroll.
- New Atlas logo: the connected A mark and a Jost wordmark. It replaces the app icon, the mark in the app, the diagram viewer and plan exports, and the README banner and logo files. The wordmark is outlined, so it renders without the font. `AtlasMark` (`@envsemble/atlas-diagrams/react`) now always draws the mark on its dark tile instead of following the text colour; its props are unchanged.

## 0.6.0 — Desktop app — 2026-10-10

- Atlas is now a desktop app for Windows (unsigned NSIS installer) and Linux (AppImage), built with Electron. The local web server, its HTTP endpoints and browser mode are gone; `npm run dev` starts the desktop app with hot reload.
- One window per planning folder: File › Open Folder…, Open Recent and New Window, a single running instance that also takes folders from the command line, and windows restored with their size, sidebar and tabs. The in-app folder switcher is gone.
- A VS Code-style layout: an activity bar (Explorer, Work, Activity, Statistics), a resizable explorer that mirrors the planning folder (work status and titles, and a Diagrams entry per work item), preview and pinned tabs, and Ctrl+P quick open. The explorer replaces the Files and Knowledge pages and the per-work Files tab.
- The app watches the folder instead of polling. A broken `planning.json` keeps the last good view with an error, a moved or deleted folder offers Locate… and Close, and a crashed window reloads with its tabs.
- Security: context isolation, the Chromium sandbox, a checked message list between the window and the app, a strict content security policy, file access confined to each window's folder, and no remote content. A rotating local log (Help › Open Logs) and an About dialog; nothing leaves the machine.
- File › Import Plan… and Export Plan… (also on a work folder's context menu in the explorer) export and import whole plans; the app previews an import before it writes anything.
- End-to-end tests drive the packaged app on Windows and Linux in CI.
- Added plan export and import: `atlas plan export <work-id|work-folder>` writes a whole work item, including evidence and diagrams with their history, to one self-contained `.atlas-plan.html` file that opens offline in any browser with the app's look. `atlas plan import <file>` adds it to a planning folder as new work under the next free number, rewriting its identity (through a recorded model revision for diagrams), clearing references to work in the source planning folder and recording its origin; an import that would fail `atlas planning check` is rolled back. The shared code lives in `@envsemble/atlas-planning` for the desktop app. See [plan export](docs/plan-export.md).
- Plan exports replace single-model HTML as the way to share a plan; `atlas model export` remains for one model.
- Added `relocateDocument` to the diagram package: a recorded revision that changes only a model's `workId` and context record paths, keeping a captured snapshot a snapshot. Import uses it; `reviseDocument` is unchanged.

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
