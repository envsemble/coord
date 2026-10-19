# Changelog

## 0.8.0 — The plans hub — 2026-10-16

- **The hub:** the app opens on one list of every plan of every project, blocked and in progress first, then drafts, each with its project, a one-line summary, its progress and its status: Working while an agent is in a turn on it, Needs you once it waits for you; filter by project and state, or search. A plan opens in one click. The projects sidebar, the project page and the tab rail are gone: a window shows one place, with back and forward, Ctrl+P and New Window for a second.
- **What agents do now:** the hooks record when a session's turn starts and ends, when it asks for permission and when it ends (`UserPromptSubmit`, `Notification`, `PermissionRequest`, `SessionEnd`, and any tool use in the background); a session counts for the plan it touched last. **Agent time adds every agent up**, subagents in full; reports keep each agent's working intervals, so the time at least one worked is shown too, and older reports are measured again from their logs where they still exist. The home database's schema 3 only adds to it, so older versions keep using it.
- **References, sessions and effort:** the host resolves what a plan references (`repo#22` and PR URLs with their state from `gh`, `repo@hash` and bare hashes from the project's checkouts, paths to files in a checkout) and lists a plan's sessions (model, effort, state, how to resume, the last message while one waits), the commits and PRs they made (from the hooks) and its timeline. Reports keep time and tokens by model and reasoning effort, and Codex's compressed rollouts are read.
- **One menu** in the title bar replaces File, Edit, View and Help; every shortcut still works. Projects and Statistics are pages opened from it; Export Plan… sits on the plan's page.
- **Plan pages:** the plan's summary leads the page, and a "Request" section shows folded.
- **Planning steps:** a work item's ledger exists from its creation, with planning steps (understand the request, settle the design, write the plan, accepted) that agents keep true; accepting marks them done and starting appends the implementation steps. Atlas shows them in one list, planning steps in their own color.
- **Plan summaries:** plans carry a `summary` header, a few plain sentences on what the work is and where it stands; `atlas check` warns when an active plan has none, and `where` and the hub show it.
- **Workspace folders:** a project covers workspace folders (`workspaces` in planning.json); an agent session in one of them belongs to that project, before any match by Git remote. A project is created from a name and a folder, in the app, by an agent with the new `project_create` tool, or with `atlas project create`; Atlas registers the Git checkouts it finds there. Only the app on the computer itself may choose a project's folders.
- **No hidden projects:** a project is active or archived; hidden projects become archived.
- **New projects appear at once:** a project created outside the app shows up without a restart.
- **Ledgers are their steps:** the tools write only the ledger's header (its steps and `blocked`) and no prose: `work_start` adds no Selection section, and `step_remove` (`atlas work step remove`) takes no reason. `work_archive` writes its reason into the plan's Outcome. The app's Ledger view is gone: the steps show in the About column, and the ledger opens as a file. During implementation the ledger also keeps a short final-review list.
- **atlas-implement reviews in at most three rounds:** each step gets one review, and another round follows only blockers or majors, at most three per step. Minors, a bot's included, go on the final-review list, worked through once before readiness. Quick checks of what changed run while working, and the slow suites only at milestones and before handoff. Worktrees are removed once unused, and the agent says which branch, in which folder, holds the latest work.
- **Skills name only the commands no tool covers:** `atlas check`, `atlas capture`, `atlas home adopt`, `atlas plan import` and `atlas work report`; the tools replace `atlas where`, `atlas work` and `atlas project create` there.

## 0.7.1 — Skills by name and work across projects — 2026-10-15

- **Three skills, triggered by name:** `atlas` triggers on its own (the word Atlas, designing, work big enough to plan, recording or bringing projects up to date) and now covers work across projects; `atlas-grill` is back, the questioning workflow in rounds, used when the user says "atlas grill", "grill" or "grill me"; `atlas-implement` is used when the user says "atlas implement" and no longer needs its command. In Claude Code they are `/atlas:atlas`, `/atlas:atlas-grill` and `/atlas:atlas-implement`; in Codex `$atlas`, `$atlas-grill` and `$atlas-implement`.
- **`where` works outside a project:** it lists every active project in the home (`projects`), with the ones registering the checkout marked, also outside any Git checkout; a session in a folder no project registers is told the home's projects and to ask which one the work belongs to.
- **`atlas setup` leaves folders outside the home alone:** it imports statistics files only from planning folders in the home; a folder outside it gets them imported when it moves in.

## 0.7.0 — Agent interface and projects — 2026-10-15

- The agent interface: Atlas reaches agents through a plugin for Claude Code and Codex, and harnesses that run them, instead of skills they happen to load.
  - **The Atlas home** (`~/.atlas`, or `ATLAS_HOME`) holds every planning folder under `planning/<name>`, each its own Git repository, and Atlas's own state beside them. The desktop app, or `atlas setup` (refused while an Atlas app runs), moves its files there from the old data folder once, merging usage statistics and setting aside anything the home already has; `ATLAS_DATA_DIR` and `--data-dir` are gone (`--home` replaces them). `atlas home` lists the planning folders, and `atlas home adopt` moves an existing one in.
  - **A checkout finds its planning folder by its Git remote**, registered in the folder's `planning.json`, so every worktree finds it wherever it is. `atlas where` shows the result.
  - **Planning state through tools:** `atlas mcp` serves 13 tools (`where`, `work_status`, `work_create`, `work_accept`, `work_start`, `step_add`, `step_set`, `step_rename`, `step_remove`, `work_block`, `work_close`, `work_archive` and `work_reopen`), the same operations as the new `atlas work` commands. They allocate work numbers, write plan and ledger headers, move work between `active/` and `archive/` with its links, and refuse with the reason, such as the open items of work that cannot close; work that is not complete is archived only as superseded or abandoned, which `atlas check` also enforces. They never commit. Plan bodies, glossaries, decisions and diagrams stay files the agent edits directly.
  - **Hooks:** at session start the agent learns its planning folder and active work; after each edit in the home, `atlas check` checks the planning files it changed and hands the problems back; when a session or subagent stops, its statistics are recorded for the work it touched.
  - **`atlas setup`** creates the home, grants it to Claude Code (`permissions.additionalDirectories`) and Codex (`writable_roots`) so agents can edit planning files from any checkout, and installs the `atlas@atlas` plugin from this repository's marketplace manifests.
  - **Two skills** replace seven: `atlas` (planning, recording, setup, organization and diagrams) and the explicit `atlas-implement`. `babysit-pr` leaves the plugin for `extras/`. The `atlas model` commands and the model tools are gone.
- Projects and the home database: every planning folder in the home is a **project**, and Atlas keeps everything else in one SQLite database, `<home>/atlas.db`.
  - **Projects** are named by a new optional `name` in `planning.json` (else by the folder's name). A repository may belong to several projects; `atlas where`, `atlas home` and the session context list them by name, and when several match, the tools need the project's planning folder and the `atlas` skill tells the agent to ask the user which one.
  - **The app shows projects, not folders:** a projects sidebar on each computer, the projects as cards below a quiet strip with a search (envUI's new quiet field) and New Project; each card shows its repositories and last change, its active work with how much is blocked, being implemented or a draft plan, a live dot while an agent works on it, its details on hover and Hide in its corner (rename, reorder, hide and archive from its context menu; hidden and archived ones collapse into a group of their own; nothing is deleted), **File › New Project…** (a planning folder from the bundled templates, its repositories registered, `git init` and a first commit), and a project page with its work list, statistics and activity. One window holds tabs of every project, kept in the database per computer; **File › Close All Tabs** and the tabs' menu close them all. Quick open searches every project.
  - **A work item** shows its plan; **Ledger**, under the progress in the About column, shows the ledger in the plan's place, and the column scrolls on its own. The Plan, Ledger and Diagrams switcher is gone. Diagrams open from their cards, links, Files and quick open, in a tab per work item.
  - Back and forward come right after the Atlas mark in the title bar, before the menus.
  - Scrolling over a table, such as the project's work statistics, scrolls the page again (envUI).
  - **Files** (Ctrl+Shift+E, or the folder button in the title bar) shows the active project's planning folder in a panel that docks, floats or fills the window, in place of the explorer in the sidebar.
  - **Removed:** File › Open Folder…, Open Recent, Manage Folders…, Close Folder, Locate…, the welcome page, a computer's folder list and folder browser, folders on the command line, and `atlas serve --folder`. Planning folders outside the home move in with `atlas home adopt`.
  - **The database** replaces `desktop-state.json`, `connections.json`, `planning-roots.json`, `host/access.json`, `host/folders.json`, the hooks' `sessions/`, `usage/` and `<work>/.atlas/statistics.jsonl`. `atlas setup` and the installed app move the home's files in and set them aside in `legacy/`; `atlas setup` and `atlas home adopt` import statistics files and delete them, leaving the removal to commit. `atlas check` no longer reads statistics files, and warns about diagrams no document links. The host protocol is version 5.
- Statistics by stage, with subagents: each report records the work's stage, planning until its plan is accepted and while a session amends an accepted plan, implementation after, and the subagents that worked. The Statistics view and a work item's About sidebar show agent time and tokens per stage, and how many subagents worked and for how long. Reports come from the hooks; `atlas work report` remains for agents without them.
- Diagrams are PlantUML files in a work item, which agents write and edit like any file, instead of model documents changed through model tools. See [diagrams](docs/diagrams.md).
  - **Atlas's subset of PlantUML:** class, entity and object diagrams, read by Atlas's own strict grammar. Anything outside the subset is an error at its line and column that says what to write instead: layout hints, colours and styles, notes and legends, stereotypes other than `<<PK>>` and `<<FK>>`, formatting, the preprocessor and every other diagram type. Atlas lays out and styles every diagram itself, and every diagram it accepts also renders in PlantUML.
  - **`' atlas` comments** carry what PlantUML cannot: a capture's header and fingerprint, the diagram a proposal starts from, the earlier capture a later one compares with, the class diagram a scenario exemplifies, and the evidence and source excerpt of an element.
  - **Descriptions:** an `' atlas description` line above a class, interface, enum, entity, object or member gives one short sentence of its purpose, which its details and its tooltip show, and a proposal that changes it changes the element. TypeScript and Java captures describe declarations and members with the first sentence of their documentation comments.
  - **Captures write diagrams:** TypeScript and Java code become class diagrams and SQLite, PostgreSQL and local D1 schemas entity diagrams, with their source, date, adapter, coverage and fingerprints in the header and where each element and member is declared. A capture is frozen; captured again from the same source it differs only in its date.
  - **`atlas capture <source.json> --work <work-id>`** writes a capture into the work item's `diagrams/`; `--compares` records the earlier capture, so a work item shows the system before and after its implementation.
  - **Proposals** are copies of a capture with an `' atlas proposal` line, compared with it by name; alternatives are several proposals of one capture. **Scenarios** are object diagrams assessed against their class diagram.
  - **Java capture** runs on any JDK from 21 on.
  - **Removed, with no conversion of existing models:** OntoUML and its exchange JSON, the model document format with its revisions, `.atlas/models` and `.atlas/history`, the model tools of `atlas model` and its MCP server, modeling jobs, the review of model changes in pull requests (`atlas model review`, `npm run review:example`, `check:review`), and importing single-model HTML files. The examples are diagram files: a code capture with a proposal, and a class diagram with scenarios.

- The whole interface is built on [envUI](https://github.com/envsemble/envUI), Envsemble's component library, in its light and dark themes:
  - **The window** is envUI's application shell and draws its own title bar: the Atlas mark, the **File**, **Edit**, **View** and **Help** menus (compact, with their shortcuts and an **Open Recent** submenu; Alt opens them from the keyboard), back and forward arrows, the computer menu, **Search**, record health, the theme menu and the system's window buttons. The title bar's line runs under the window buttons too, and its icons are as quiet as they are. On macOS the menus stay in the system's menu bar. **Work**, **Activity** and **Statistics** are pages of their own beside the explorer in one sidebar, which collapses to its icons (Ctrl+B) and resizes from its edge; the open documents are tabs that stay under the title bar, and closing the last one shows the page again. Welcome pages and folder problems have the same title bar.
  - **File › Close Folder** takes a window back to its computer's welcome page.
  - **A work item** has its sections (Plan, Ledger, Diagrams) in one compact switcher at the top left of its page, in the same spot for every section: it floats over a plan or ledger as they scroll and starts the diagram's toolbar, so the diagrams take the whole area below the tabs. The work number moved beside the item's status. The diagrams' full view keeps the title bar.
  - **The theme** matches the system, or is light or dark, for every window; Atlas's own menus and dialogs follow it.
  - **Views and dialogs** use envUI's rows, tables, tabs, segmented controls, menus, notices, dialogs and toasts, Material Symbols icons and the Inter font. Quick open is envUI's command palette; the explorer is its tree, with a compact context menu.
  - **Lists of folders and computers:** **File › Open Recent › Manage Folders…** (on macOS **File › Manage Folders…**) and the computer menu's **Manage Computers…** open a folder or a computer in a new window, remove a folder from the list, or forget a computer. The menus themselves open in this window.
  - **Scrolling:** the area below the title bar scrolls, not the window, so the window buttons never cover a scrollbar and nothing shifts when a page starts or stops scrolling. Zooming keeps the window buttons as tall as the title bar above its line.
  - **A folder that is missing or unreadable** also offers **Close Folder**, back to the start page.
  - **Commands a page could misuse** wait for the person: Paste, which reads the clipboard, follows a click, key press or tap in the window. These follow one too, or else Atlas asks first in a system dialog:
    - exiting, and closing the last window;
    - opening windows or the logs;
    - turning remote access on or moving it to another address, and pairing;
    - opening web addresses.

    Creating a pairing link always asks first. A page's dialogs come one at a time.

  - **The diagram viewer and plan exports** use the same components; the diagram viewer follows the app's theme, and a standalone model file follows the system's.
  - `npm run dev:envui` runs the app against a local envUI checkout with live reload.

- Back and forward, as in a browser: each window keeps what it showed (its pages, each work item at its section, diagram or heading, and each file) while it shows its folder. The title bar's arrows, Alt+← and Alt+→ (⌘[ and ⌘] on macOS), a keyboard's or mouse's back and forward buttons and **View › Back** and **Forward** step through it. A closed tab opens again as a preview, where it was, and a document left for one of its headings is where it was before the jump. With a menu or dialog open, the mouse's buttons only close it; fields keep Alt+← and Alt+→.
- **Help › About Atlas** is a dialog in the window, also on the welcome page, instead of a system message box: the version, what stays on this computer, the Electron, Chromium and Node.js versions, the system and the data folder, with **Open Logs** and **Copy Details** for bug reports.
- A work item's row in the Work list opens it from anywhere on the row, highlighting as you point at it or tab to it; its diagram count still opens its diagrams. Folder rows on the welcome page and in the folder lists open the same way.
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
- Work statistics: `atlas work report` records each ledger transition in `<work>/.atlas/statistics.jsonl`.
  - **Measured from the agent's own session.** Inside Claude Code or Codex, the command finds the session the harness names and reads its log on that computer: the model, and since the session's previous report the agent's working time and tokens. Agent time runs from each prompt to the end of that turn's work, without the time the agent waited for a person, with helpers' work at the same time counted once; tokens come per model, by kind. The log is only read, and a report holds only numbers and model identifiers. Elsewhere the agent gives `--model`, `--session` and `--tokens`, and agent time is estimated from the time between reports.
  - **The Statistics view** has a **Work** tab (model, agent time, tokens, plan revisions and steps per work item) and a **Models over time** tab (a chart and medians of completed work by implementing model, the one that did most of the work). Models read by name with their provider's mark, such as Claude Opus 5.5 or GPT-6.1 Sol.
  - **A work item's About sidebar** sums up its statistics: the model and any others, the agent time (how much was measured, and since when, on hover or focus), the tokens (by kind on hover or focus) and the plan revisions. It no longer shows the work folder's path.

  Plan revisions come from Git and follow archive moves. `atlas planning check` warns about invalid report lines. Plan exports leave statistics out.

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
  - **Protocol version 3:** work statistics changed shape, so a computer on an earlier build is asked to update Atlas on both computers rather than showing broken statistics.

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
