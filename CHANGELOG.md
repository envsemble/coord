# Changelog

## Unreleased

- The whole interface is built on [envUI](https://github.com/envsemble/envUI), Envsemble's component library, in its light and dark themes:
  - **The window** is envUI's application shell and draws its own title bar: the Atlas mark, the **File**, **Edit**, **View** and **Help** menus (compact, with their shortcuts and an **Open Recent** submenu; Alt opens them from the keyboard), the computer menu, **Search**, record health, the theme menu and the system's window buttons. On macOS the menus stay in the system's menu bar. **Work**, **Activity** and **Statistics** are pages of their own beside the explorer in one sidebar, which collapses to its icons (Ctrl+B) and resizes from its edge; the open documents are tabs that stay under the title bar, and closing the last one shows the page again. Welcome pages and folder problems have the same title bar.
  - **File › Close Folder** takes a window back to its computer's welcome page.
  - **A work item** has its sections (Plan, Ledger, Diagrams) in one compact switcher at the top left of its page, in the same spot for every section: it floats over a plan or ledger as they scroll and starts the diagram's toolbar, so the diagrams take the whole area below the tabs. The work number moved beside the item's status. The diagrams' full view keeps the title bar.
  - **The theme** matches the system, or is light or dark, for every window; Atlas's own menus and dialogs follow it.
  - **Views and dialogs** use envUI's rows, tables, tabs, segmented controls, menus, notices, dialogs and toasts, Material Symbols icons and the Inter font. Quick open is envUI's command palette; the explorer is its tree, with a compact context menu.
  - **Lists of folders and computers:** **File › Open Recent › Manage Folders…** (on macOS **File › Manage Folders…**) and the computer menu's **Manage Computers…** open a folder or a computer in a new window, remove a folder from the list, or forget a computer. The menus themselves open in this window.
  - **Scrolling:** the area below the title bar scrolls, not the window, so the window buttons never cover a scrollbar and nothing shifts when a page starts or stops scrolling. Zooming keeps the window buttons as tall as the title bar.
  - **A folder that is missing or unreadable** also offers **Close Folder**, back to the start page.
  - **Commands a page could misuse** wait for the person: Paste, which reads the clipboard, follows a click, key press or tap in the window. These follow one too, or else Atlas asks first in a system dialog:
    - exiting, and closing the last window;
    - opening windows or the logs;
    - turning remote access on or moving it to another address, and pairing;
    - opening web addresses.

    Creating a pairing link always asks first. A page's dialogs come one at a time.

  - **The diagram viewer and plan exports** use the same components; the diagram viewer follows the app's theme, and a standalone model file follows the system's.
  - `npm run dev:envui` runs the app against a local envUI checkout with live reload.

- Reviewing a proposal: a proposal opens in one change view, and the model picker is the only chooser (the Baseline/Changes control is gone).
  - **A capture and its proposals are laid out together**, also several proposals over one capture, such as alternatives an agent offers. Switching among them in the picker is instant: nothing moves, and the zoom, the view and an element's details stay. The picker lists the alternatives by title, each with how many changes it makes. Plan exports behave the same. The library's `prepareFamily` lays out such a family, and the `atlas-model` skill says when to offer alternatives.
  - **The details beside the diagram resize** from their inner edge, by pointer or keyboard; the app keeps the width with each folder's layout, the offline viewer in the browser.
  - **The provenance chip at the bottom of the diagram is gone**: the picker names where a model came from, and the offline viewer shows it beside the model's title.
  - **On the canvas** new, changed and removed classes, members and relations are marked green, amber and red, relations also with a +, ~ or −, and unchanged elements fade until **Fade unchanged elements** is turned off. Unknown counts (`?`) and names that only repeat a relation's kind, such as `declared type use`, are no longer drawn.
  - **The Changes list** beside the diagram has a row per changed element with its members summarized, relations by their ends, changes to the model itself under **Model**, and unresolved merge conflicts first. Values read by name, before → after, and a member or class that moves is listed where it left and where it went. Choosing a row opens its element, whose details step to the previous or next change; a change no view draws is listed and counted but not opened.
  - **An element's details** say what changes, where it is in code (or where a new class is proposed to live), why it exists and what it holds, without capture noise.
  - **Database captures** keep the columns a foreign key refers to when its table is outside the capture. A document captured earlier shows each such key as replaced once, when it adopts a newer capture.
  - **The model report is gone.** **Understand the model** holds the walkthroughs and checked examples; each element's details hold its rationale and linked planning passages.
  - Diagram cards in plans and plan exports name relations as the diagram labels them: by their ends when their own name says nothing more.
- Ledger status version 2: the ledger header lists the agreed steps of the work, each `todo`, `doing` or `done`, and replaces `current` and `next`. The app and plan exports show a progress bar, the steps done and left, and each step; the work list shows progress per work item. `atlas planning check` validates the steps. Version-1 headers stay valid and readable. The planning contract (`PLANS.md`), the governance template and the `atlas-implement` and `atlas-record` skills describe the new header.
- Work statistics: `atlas work report` records an agent's model, the tokens used so far in its session, and the ledger step at each ledger transition, in `<work>/.atlas/statistics.jsonl`. The Statistics view gains a **Work** tab (model, tokens, active time, plan revisions and steps per work item) and a **Models over time** tab (a chart and medians of completed work by implementing model); the About sidebar shows a work item's statistics. Plan revisions come from Git and follow archive moves. `atlas planning check` warns about invalid report lines. Plan exports leave statistics out.
- Remote access: work on another computer's planning folders as if they were local.
  - **File › Remote Access…** turns it on for a chosen address (Tailscale, a local network or this machine) and port. It creates pairing links (five minutes, one use, with a QR code, **Copy link** and **Copy code only**) and lists and revokes paired devices.
  - **Pairing:** the pairing step names the device and may grant **Manage access**, so it can pair and revoke devices itself.
  - **What a paired device can do:** the whole computer, as the app there can:
    - browse its folders;
    - open any planning folder;
    - read it with real paths;
    - import and export plans;
    - count its views in document use.

    Only Reveal in File Explorer stays local.

  - **The computer menu and Open Recent:** the title bar holds a computer menu (this computer and the paired ones), and **File › Open Recent** lists the computer's folders. Each opens in this window; their **Manage** lists also open in a new one. Another computer's folders open through an in-app folder browser.
  - **The folder list:** each computer keeps one, which every device sees live.
  - **Collapse All Folders** moves to the explorer's right-click menu.
  - **`atlas serve`** runs the host without the app; devices open folders there themselves.
  - **The Atlas host:** planning folders are now read by the Atlas host (`packages/host`, TypeScript with Hono), which the app runs in a utility process. Devices hold revocable tokens.

  See [remote access](docs/remote-access.md).

- Documentation: a shorter README that walks through getting started and how work moves through Atlas, a [documentation index](docs/README.md), a [command reference](docs/command.md) with every command, its exit codes and the data folder, and a [progress and statistics](docs/progress-and-statistics.md) guide to the ledger's steps and work statistics. The contributor guide now lists every check and the repository layout, including the host; the library example moved to [embedding](docs/embedding.md).
- Fixed: long documents did not scroll in the desktop app and showed no scrollbar. The workbench grew with its content instead of filling the window; its panes now scroll.
- Fixed: on Windows, a planning folder could stop updating for a minute or more after a plan export. A helper the export started at the same moment held Git's output open, so reading the folder waited for it. Atlas now runs Git through temporary files and gives every Git call a time limit.
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
