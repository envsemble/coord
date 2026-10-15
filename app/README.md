# Atlas desktop app

![An Atlas window from before the hub: the computer's projects as cards in a sidebar, and a project's page with its work and statistics in a tab](assets/atlas-desktop.jpg)

Atlas is a desktop app for planning repositories: active and archived work, plans, ledgers, glossaries, ADRs, evidence, shared knowledge, Git activity, work and usage statistics and each plan's diagrams. Every window opens on the hub, one list of every plan of the computer's projects, and shows one place at a time: the hub, a plan, a diagram or a document. Discuss changes with your agent in chat; the agent edits the records, and Atlas shows them as they change.

## Install

Atlas is built for Windows and Linux. Builds are unsigned, by decision for a single user; a newer version installs over an older one, and there is no auto-update.

- **Windows:** run `Atlas-Setup-<version>.exe`. SmartScreen warns about an unsigned app the first time: choose **More info › Run anyway**. It installs for the current user only, without administrator rights (you can pick the folder), and adds Atlas to the Start menu. Uninstall it from **Settings › Apps**; your Atlas home is kept.
- **Linux:** make `Atlas-<version>-x86_64.AppImage` executable (`chmod +x`) and run it.

The installer and AppImage come from the `Desktop` CI job's artifacts, or from `npm run package` in a checkout (they land in `app/release/`).

To open a folder from a terminal or a file manager's "Open with", pass it on the command line: `Atlas.exe C:\work\planning` or `./Atlas-<version>-x86_64.AppImage ~/work/planning`. If Atlas is already running, the folder opens in that instance; a folder that is already open just gets focus.

### Linux sandbox

Atlas keeps Chromium's sandbox on and never disables it. An AppImage cannot use Chromium's setuid sandbox helper, so it needs unprivileged user namespaces. Ubuntu 23.10 and later restrict those through AppArmor; there the AppImage launcher would start Atlas with `--no-sandbox`, and Atlas refuses to run that way: it shows "Atlas does not run without its sandbox" and quits (the log records it too). Allow the namespaces instead, either:

- allow them until the next reboot: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (add `kernel.apparmor_restrict_unprivileged_userns=0` to a file in `/etc/sysctl.d/` to keep it), or
- give the AppImage its own AppArmor profile, `/etc/apparmor.d/atlas-desktop`, then run `sudo apparmor_parser -r /etc/apparmor.d/atlas-desktop`:

      abi <abi/4.0>,
      include <tunables/global>
      profile atlas-desktop /home/*/Applications/Atlas-*.AppImage flags=(unconfined) {
        userns,
        include if exists <local/atlas-desktop>
      }

  Adjust the path to where you keep the AppImage.

Atlas also refuses `--no-sandbox` and `ELECTRON_DISABLE_SANDBOX` given any other way, and its desktop entry never adds them.

## Develop

Requires Node.js 24 or newer, npm, and Git for planning history. From the repository root:

    npm ci
    npm run dev                          # the desktop app, with hot reload
    npm run dev -- C:/path/to/planning   # …opening a planning folder

`npm run dev` runs electron-vite: the window reloads React changes in place, and the app restarts when main-process or preload code changes. There is no browser mode. Set `ATLAS_HOME` to a folder of its own for development runs (`ATLAS_HOME=~/.atlas-dev npm run dev`): the run then keeps all its files there, Electron's included, and runs beside your installed Atlas. Without it, a development run uses your Atlas home, shares the installed app's single-instance lock, and does not start while the old data folder's files wait to be moved into the home: run `atlas setup` first.

    npm run package    # app/release: NSIS installer on Windows, AppImage on Linux
    npm run test:e2e   # Playwright drives the packaged app (run npm run package first)

`npm run package` builds twice from the same output: the release (the installer or AppImage, and the unpacked app in `release/win-unpacked` or `release/linux-unpacked`), with the inspector fuse off, and an otherwise identical unpacked copy in `release/e2e` with it on, because Playwright drives Electron through the inspector. The suite drives `release/e2e`, and `e2e/release.spec.ts` starts the release build itself to check that it opens a project, has the inspector fuse off, and refuses debugging switches and `--no-sandbox`. Packaging also drops the diagram package's dependencies that only its command-line features use (the MCP server, PostgreSQL and TypeScript capture; `scripts/after-pack.cjs`).

`npm test --workspace @envsemble/atlas-app` runs the unit tests, and `npm run check:types` type-checks the renderer and the main process. The end-to-end suite copies `e2e/fixtures/planning` (a copy of the demo workspace's planning folder) into a temporary Git repository and uses a temporary Atlas home (`ATLAS_HOME`), so it never touches your own data. `ATLAS_E2E_UNPACKAGED=1` runs it against `out/` without packaging, and `ATLAS_E2E_INSTALLER=1` also installs and uninstalls the Windows installer (CI does this on a disposable runner).

## Code layout

| Path | What it is |
| --- | --- |
| `main/` | The main process: windows, the menu, the `atlas:` protocol, the message handlers, the log, saved state and the connections to Atlas hosts. It starts this computer's host (`packages/host`, in `main/hostProcess.ts`) in a utility process; the host reads and watches planning folders through `packages/planning` and prepares diagrams with `packages/diagrams`. |
| `preload/` | The bridge: `window.atlas`, one method per message. |
| `shared/` | The message contract and the validator every message argument goes through. |
| `src/` | The React window, built on [envUI](https://github.com/envsemble/envUI) (`@envsemble/envui`): its window frame and title bar, tree, command palette, menus, dialogs, notices, rows, tables and Material Symbols. `src/atlas.css` lays out Atlas's own regions with envUI tokens only. |
| `e2e/` | The Playwright suite and its fixture planning folder. |

## Projects and windows

Atlas shows **projects**: each is a planning folder in the [Atlas home](../docs/command.md#the-atlas-home), named by the `name` in its `planning.json` (else by the folder's name), on this computer or on a computer this one is paired with ([remote access](../docs/remote-access.md)). Projects are mostly for agents: each covers **workspace folders**, and an agent working in one of them, or in a folder inside it, plans in that project. People find plans in the hub.

- **The Projects page** (in the menu) lists every project, active, hidden and archived, with its planning folder, its workspace folders and its repositories. Choosing a project's name shows its plans in the hub. Its actions rename it (the name is written into its `planning.json`), hide or archive it (its plans leave the hub; **Show** and **Restore** bring it back), and add or remove workspace folders. Atlas never deletes a project; to drop one, remove its folder from the home. A project from before the home whose folder is still elsewhere is marked **Outside the Atlas home**: agents do not find it until **Move into the Atlas home** moves its folder into the home (as `atlas home adopt` does, importing its statistics files); it keeps its place and state.
- **New project**, on the Projects page, asks for a name and a folder (typed, or chosen with **Browse…** on this computer). Atlas shows the Git checkouts it finds in the folder and the folders directly inside it, whose remotes become the project's repositories (for a paired computer's project they are found as it is created), and creates the planning folder in the home from the bundled templates, as a Git repository with a first commit, covering the folder. Agents can create projects too, with the atlas skill.
- **The computer menu** (the computer's name in the title bar, after the menu) lists this computer and the paired ones. Choosing a computer shows its plans in this window, at the place this window last showed there. **Manage Computers…** opens a computer in a new window or forgets a paired one.
- **New Window** (Ctrl+Shift+N) opens another window on the same computer. **Close Window** (Ctrl+Shift+W) closes one; closing windows one by one keeps the last one.
- Windows open at quit come back on the next start, each with its size and position and, per computer, the place it showed (a window from before the hub shows the tab that was active). A window whose paired computer does not answer at the start shows the hub at once and its place when the computer answers; the place of a project whose folder cannot be listed for a while is kept for when it can.

Atlas keeps its own data in the **Atlas home**, `~/.atlas` (or `ATLAS_HOME`), shared with the `atlas` command: the planning folders in `planning/`, and everything else in the home database, `atlas.db`: the projects and their order and state, windows and the places they show, the theme, this computer's identity, remote access settings and paired devices, the computers this one paired with, and statistics. The [command reference](../docs/command.md#the-atlas-home) describes the whole home.

Electron's own files and Chromium's caches stay in the per-user folder Atlas used before (`%APPDATA%\Atlas` on Windows, `${XDG_CONFIG_HOME:-~/.config}/Atlas` on Linux); the first start of the installed app with the default home moves Atlas's own files from there into the home (a development run refuses to start until `atlas setup` has moved them). Earlier homes kept their settings in files (`desktop-state.json`, `connections.json`, `planning-roots.json`, `host/`, `sessions/`, `usage/`); Atlas moves them into the database as it starts (as does `atlas setup`) and sets the files aside in `legacy/`. Atlas does not start on a database it cannot open, such as one a newer Atlas wrote, and says why. Nothing is written into a planning folder except by an explicit import, renaming the project, or creating one.

## Layout

The window is envUI's window frame, and it draws its own title bar:

- **Title bar:** the Atlas mark (which leads to the hub), back and forward arrows, the **menu**, and the computer menu; then **Search** (quick open), **Files**, record-health notes when there are any, the theme menu (match the system, light or dark; it applies to every window and to Atlas's own menus and dialogs) and the system's minimize, maximize and close buttons. Empty space in the title bar moves the window, and a double click maximizes it. On macOS the system's menu bar holds the same commands and the title bar starts after the window buttons.
- **The menu** holds **New Window**, **Projects**, **Statistics**, **Import Plan…**, **Connect to Another Atlas…**, **Remote Access…**, zoom (**Zoom In**, **Zoom Out**, **Actual Size**), **Full Screen**, **Open Logs**, **About Atlas** and **Exit** (with **Reload** and **Developer Tools** in development builds). Every shortcut works without it.
- **Files** (the folder button in the title bar, or Ctrl+Shift+E) opens the planning folder of the open plan's project as it is on disk in a panel that docks beside the page, floats or fills the window; the hub and the menu's pages have none. Dot folders and build output are hidden. A work folder shows its status icon and, faintly, its plan title. Only the rows in view are drawn, so large folders stay fast. Arrow keys, Home/End, type-ahead and Enter work in the tree; a click opens a file, and a work folder's plan. A context menu offers **Open Plan**, **Open Diagrams**, **Export Plan…** and **Reveal in File Explorer**, and, anywhere in the panel, **Collapse All Folders**.
- **The hub** lists every plan of the computer's active projects (a hidden or archived project's plans only when it is chosen in the project filter), from their projects' summaries: blocked and being implemented first, then drafts, then other open work, the latest change first in each; closed work only when the state filter asks (**Open**, **Closed** or **All**). Each row has the plan's state, title, number and project, its summary on one line, its ledger's steps done, a green dot while an agent works on it, and when it last changed; a click anywhere on it opens the plan. The search matches every word in a plan's title, number, summary or project; the project filter (**All projects** by default) is part of the place, so back and forward, and a plan's breadcrumb, set it.
- **A plan** shows its title, its status, number (**#0001**) and tags, its summary as a short lead, **Export Plan…**, and the plan, with an About column, which scrolls on its own: the ledger's progress and steps (planning steps, which settle the design, in their own colour, then implementation steps), then **Ledger**, which shows the ledger in the plan's place (and **Plan** back), any blocker, dates, statistics and recent commits. A section headed **Request** (or **Request (…)**), where a plan records the user's words, shows folded; its heading opens it. The breadcrumb's project leads to the project's plans in the hub.
- **Opening things:** a plan opens from its row in the hub; a diagram from its card in the plan, from a link, from Files or from quick open, filling the window below the title bar. Links between records open their target in the window.
- **Back and forward** step through what the window showed: the hub with its project filter, the menu's pages, each plan at its heading, diagrams and files. Use the arrows in the title bar, Alt+← and Alt+→ (⌘[ and ⌘] on macOS), or a keyboard's or mouse's back and forward buttons. A place shown again is where it was left, and a document left for one of its headings is where it was before the jump. The mouse's buttons also work over the title bar; with a menu or dialog open they only close it. Fields keep Alt+← and Alt+→. The history lasts while the window shows its computer.
- **Quick open** (Ctrl+P, or **Search**) finds a plan of any active project, and a diagram or document of the open plan's project, by name.
- **Statistics** (in the menu) shows one project's statistics at a time, those of the project of the plan last open, with a project picker; see [Statistics](#statistics).

| Shortcut | Action |
| --- | --- |
| Alt+← / Alt+→ (⌘[ / ⌘] on macOS) | Back / forward |
| Ctrl+P | Quick open |
| Ctrl+Shift+E | Show or hide Files |
| Ctrl+Shift+N | New window |
| Ctrl+Shift+W | Close the window |
| Ctrl+Plus / Ctrl+- / Ctrl+0 | Zoom in / out / actual size |

## Staying current and recovering

Atlas watches each open project's planning folder, and the home's planning folder for new and removed projects, instead of polling. Changes are collected for a moment and applied together, so an editor's atomic save, a Git checkout or a commit (which updates Activity) each cause one refresh. The open document, the diagrams and their inline cards follow.

- A **`planning.json` that breaks** while open keeps the last good view, with the error above it; the view recovers as soon as the file is readable again.
- A **project whose folder is moved or deleted** shows a clear state in place of its plan. If the folder comes back, the plan shows again.
- A project that **cannot be read at all** shows why.
- If the folder **cannot be watched** (for example, Linux's inotify watch limit is reached), Atlas says so above the editor and checks for changes every 10 seconds instead. Git objects, dependencies and Atlas's own output folders are never watched. On Linux, Atlas watches each folder itself rather than through Node's recursive watcher, which ignores such failures and leaves part of the tree unwatched.
- A **window that crashes** reloads showing what it showed. If it crashes three times within a minute, Atlas asks whether to reload again or close it.

## Import and export

**Export Plan…**, on a plan's page (also on a work folder's context menu in Files), saves a work item as one self-contained HTML file that opens offline in any browser. **Import Plan…**, in the menu, imports into the project shown (a plan of it, its statistics, or the hub filtered to it; with a single project, that one), and previews such a file (title, original number and origin, the new number and folder, file count and size, diagrams) and only then adds it as new work, without committing. A file that is not a valid export is refused in an error dialog before anything is written. If an import has to be rolled back and some files could not be removed, an error dialog lists them as reported. Both run the [plan export](../docs/plan-export.md) code from `packages/planning` in a worker thread, so large files do not block the window. The export viewer (`packages/planning/viewer`) is built from the same envUI components and shares `src/atlas.css`, the layout of Atlas's own regions, with the app.

## Security and privacy

The app follows Electron's security checklist (the desktop-only decision is work-0011's ADR 0001 in the planning repository):

- The window runs with context isolation and Chromium's sandbox, without Node.js integration, `remote` or `<webview>`.
- The window talks to the main process only through `window.atlas`: a fixed list of messages, each argument checked by `shared/validate.ts`, errors returned as structured values. Messages from any other page or frame are refused.
- A strict content security policy: no inline or remote scripts, no `eval`, and no network connections.
- Each window has its own session whose `atlas:` protocol serves the app and only the planning folders of that window's projects, through the same containment as the reader (no paths outside it, no hidden or excluded folders). Every other request is blocked.
- Navigation away from the app and new windows are blocked; web and mail links open in the system browser.
- Commands a page could misuse wait for the person. The main process sees their clicks, key presses and taps in the window, which a page cannot fake:
  - Each press allows one such command.
  - These run at once after one:
    - exiting;
    - opening a window or the logs;
    - turning remote access on or moving it to another address, and pairing with another computer;
    - opening a web address in the browser.

    Otherwise Atlas first asks in a system dialog the page cannot answer, so a screen reader's click, which makes no input event, still works.
  - **Creating a pairing link**, which hands the computer to whoever uses it, always asks in a system dialog first.
  - Dialogs a page opens (choosing a file) come one at a time.
- Electron fuses turn off running as Node.js and `NODE_OPTIONS`. The installer and AppImage also turn off `--inspect` and its relatives, and refuse to start with `--remote-debugging-port`, `--remote-debugging-pipe` or `--inspect` (they would let other programs control the window); only the separate end-to-end build in `release/e2e` accepts them, for Playwright. The app is not packed into an asar archive (diagram preparation runs esbuild, a native program, over the diagram package's sources), so the archive-integrity fuses are off; they add protection only to signed builds.
- Planning folders are read by the Atlas host in a separate utility process. The main process reaches it over loopback with a token created at each start and kept in memory; windows never reach the host directly.
- No data leaves the machine unless you turn on remote access. Then devices you paired can work on this computer's planning folders as the app does here, and anyone who can reach the chosen address can learn this computer's name and Atlas version. [Remote access](../docs/remote-access.md) describes pairing, tokens, the network and what each computer keeps. There is no telemetry, update check or crash upload.

## Remote access

**Remote Access…**, in the menu, lets your other devices work on this computer.
- **On this computer:** choose the address (Tailscale, a local network or this machine) and the port. Then create a five-minute one-time pairing link with a QR code. Its pairing step names the device and may grant **Manage access** (pairing and revoking devices). Revoke devices here too.
- **In a window on another computer:** the dialog manages that computer's pairings, when this device has Manage access there.

**Connect to Another Atlas…** (in the menu and the computer menu) pairs with another computer from its link and shows its projects. Then work on it from the computer menu at the top left of the window:
- its projects, which you can rename, hide, archive and reorder (the order and state are this device's) and create;
- export, and import (the file is sent there);
- document use, counted there.

Only Reveal in File Explorer stays on that computer. See [remote access](../docs/remote-access.md).

## Diagnostics

**Open Logs**, in the menu, opens `logs/` in the Atlas home: `atlas.log` (the app: start-up, window and connection events) and `host.log` (the Atlas host: folders, the watcher, remote access, pairings and device connections), each 1 MB with up to three older files, including any failures. **About Atlas**, in any window, shows the version, what stays on this computer, the Electron, Chromium and Node.js versions, the system and the Atlas home. **Copy Details** copies what a bug report needs: the versions and the system, not the home's path.

## Records and progress

The reader uses planning.json schema version 1 and the planning workflow's [metadata contract](../plugin/skills/atlas/assets/planning/PLANS.md). It follows each registered current_plan pointer. Work without a selected plan retains its original files and an explicit notice; filename order never selects a plan.

Registry locations use POSIX-relative paths. Safe aliases such as ./ prefixes and trailing slashes normalize in memory without rewriting records. Parent segments, absolute paths, backslashes, and duplicate retained work locations produce a clear registry error.

Path comparisons follow the connected folder's case and Unicode-normalization behavior, detected from existing entries without writing probe files. Filesystem aliases retain indexed document spelling and shared collector identities; distinct names remain separate.

Work IDs follow the shared work-0001 format. Explicit selected-plan pointers establish plan ownership; other documents belong to their most-specific registered location in both the viewer and consultation logger. Git activity uses the registry before deletions and after additions, preserving ownership when nested work is archived. Previously unregistered files can use their current registration without overriding established historical owners.

Design acceptance, implementation status, archive location, and known dates are displayed separately. A ledger's steps report its progress; its prose tells what actually happened. Unknown dates stay unknown; invalid dates and chronology generate health errors. Recorded calendar durations are not engineering time. Git activity shows recent checkpoints, associating work through retained registry identities so archiving or renaming its folder preserves earlier activity. Filesystem and Git reads do not update plans or lifecycle state.

Contained Markdown links open their original records. External web references open in the system browser; references outside the planning root are marked. Raw HTML is not executed. Text and common images render in the reader; for other attachments, **Show in folder** reveals the file. The text reader has a 4 MiB limit.

## Statistics

The Statistics page has a project's statistics in three parts, chosen with a segmented control, under a project picker and, for a project with several repositories, a repository filter. [Progress and statistics](../docs/progress-and-statistics.md) explains what agents report and how Atlas counts it.

- **Work** lists every work item with:
  - its implementing model, by name with its provider's mark;
  - its agent time and tokens, in a column per stage: planning and implementation;
  - how many subagents worked on it, and their working time;
  - its plan revisions;
  - its ledger steps done.

  Totals and the median plan revisions of completed work sit above the list.
- **Models over time** compares completed work by implementing model, the model that did most of the work. A chart plots agent time, tokens, plan revisions or steps for each completed work item at its completion date, coloured for the three models whose completed work is most recent, with the rest as "Other"; a model keeps its colour while others come and go. A table gives each model's medians. Hover a dot or move through the dots with the arrow keys; click it or press Enter to open the work.
- **Document use** is described below.

A plan's About column sums up the same statistics for that work: the model, with any other models below it, the agent time and tokens of each stage, the subagents and the plan revisions. Hover over or focus the agent time to see how much of it was measured and since when, and the tokens to see them by kind.

The Atlas plugin's hooks record a report whenever an agent session that worked on a work item stops, with the model, the agent time and tokens, and the subagents read from the session's own log on that computer, and the work's stage: planning until its plan is accepted, and while a session amends an accepted plan; implementation after. Where the hooks are not installed, agents report with `atlas work report <planning-root> --work <work-id> --step <title>`. The report goes into the home database under the project, so it follows the work item through archive moves. Reports without a measurement are estimated from report times, and plan revisions need the planning folder's Git history. [Progress and statistics](../docs/progress-and-statistics.md#work-statistics) gives the counting rules: what counts as agent time, sessions, breaks, starting points and revisions.

### Document use

Two sources remain distinct: documents opened in Atlas and agent-reported consultation. Statistics show most/least recorded use, known task identities, recent consultation, and collection coverage. They do not measure whether the workflow improved an outcome. Zero recorded use does not mean a record was never read or should be removed.

Agent consultation is recorded with `atlas usage log <planning-root> --files …` (see [the atlas command](../docs/command.md)). It needs only Node. No model calls, API keys, or paid API account are needed.

Usage is local, in the home database, outside the planning and product repositories, under the project. The app and the `atlas` command share it; the shared reader lives in `packages/planning`. Stable work IDs preserve per-document use through active/archive moves within the same root.

Events retain document identity, source, timestamp, known task/session IDs, available Git revision, and content hash. Bodies and transcripts are not stored. Views of the same document within 30 seconds in one window session are deduplicated. Agent reports deduplicate paths within each batch; they remain self-reported. Missing identities and incomplete collection are shown honestly. Failed writes are recorded as gaps in collection when the database can take them. Logging failure does not block reading or authorized implementation work.

## Viewer conventions

The interface is envUI's, in its light and dark themes, with Inter and Material Symbols, and envUI's Markdown presentation; inline code in documents uses envUI's subtle style, since planning records are dense with identifiers, paths and hashes. Repository filters sit in each list's toolbar.

A plan shows one status, styled like a GitHub issue: Not started, In progress, Partially done, Complete, Blocked (with the reason), Draft plan, Superseded or Abandoned. The design status appears only when it adds information. In the hub, open work is Blocked, In progress, Draft plan or Open, and closed work Complete, Superseded or Abandoned; a row shows a small progress bar with done and total steps when the ledger has steps, and a relative date.

A work item's page has a GitHub-repository layout: the plan, with an About column, scrolling on its own, holding the ledger progress (a bar, done and remaining steps, and the agreed steps with their status) or a legacy status (current, next), the link that shows the ledger in the plan's place (a link to the ledger from any record does the same), any blocker, known dates, recent commits and any record-health notes for that work. Other files in the work folder open from Files.

The root ledger's optional status header follows the shared [contract](../plugin/skills/atlas/assets/planning/PLANS.md#ledger-status-version-2). Version 2 lists the agreed steps, each todo, doing or done, plus any blocker; the app shows the work left as the steps not yet done, an estimate by count, not by time. Version-1 headers (current, next, blocked) stay readable without progress. The viewer never infers current activity from historical narrative. Agents update the header through the Atlas tools at meaningful transitions; it is reported status, not continuous live telemetry. Missing or invalid status remains unknown and the original body stays readable.

## Atlas diagrams

Diagrams belong to their plan. A diagram is a PlantUML (`.puml`) file anywhere in a work folder, usually under `diagrams/`, so archiving or moving the folder carries its diagrams along. The agent writes and edits them like any file; the app only reads them. Their history is the planning folder's Git history. [Diagrams](../docs/diagrams.md) describes the subset Atlas reads.

A plan shows a diagram card under each heading whose text links to a diagram, with an ordinary Markdown link (`[Order model](diagrams/orders.puml)`); a fragment (`diagrams/orders.puml#Order`) names an element, shown as a chip on the card. Any document in the work folder can link diagrams this way; links before the first heading appear at the top. A card shows the diagram's title and provenance and opens the work item's diagram tab, focused on the element when one is named. Clicking a diagram link in the text opens it too, and a `.puml` file opened from Files opens as a diagram (**Open as Text** shows its source).

In a diagram, the Atlas canvas takes the full width and remaining height of the window below its title bar, with its controls floating over the grid: a link back to the plan and the tools on the first row, and the diagram picker, the views and a proposal's changes on the second. The canvas's full view covers the window below its title bar (Esc exits). The picker is a compact menu of the work item's diagrams: each family (a capture, the proposals over it and the later captures compared with it) under the first capture's title, then the other diagrams with each class diagram's scenarios right after it, then **With problems**. Each entry has one short line: the source and capture date of a capture, how many changes a proposal makes, or what kind of diagram it is. The chosen diagram's label uses the same wording and colours as Atlas (`describeProvenance`; a test keeps the app's copy in step): **Generated from code** and **Generated from database** mark captures, **Agent proposal** marks proposed changes to a capture, and **Agent-authored** marks the diagrams an agent wrote. A proposal, or a capture compared with an earlier one, opens in its change view, with its list of changes beside the diagram.

A capture and the diagrams built on it, such as alternative designs an agent offers, arrive together, laid out once over all of them. Choosing another of them in the picker shows it at once: nothing moves, and the zoom, the view and an element's details stay. Drag the inner edge of the details, or use the arrow keys on it (Home and End for the narrowest and widest), to resize them; the width is kept with the window's layout.

When a diagram file changes on disk, the view updates, preserving camera and selection where element names remain. A diagram with problems is not drawn: its problems are listed by line and column until the file is fixed. The app never recaptures sources; a capture's source, date and coverage stay visible in its details, and code evidence uses Atlas's syntax-highlighted snippets.

The app depends on the diagram package (`@envsemble/atlas-diagrams`, in `packages/diagrams`) through the repository's npm workspace, so diagram changes and app changes land in one commit with no packaged tarball or pinned hash. See the atlas skill's [diagram reference](../plugin/skills/atlas/references/diagrams.md).

**Understand the model** opens a class diagram's scenarios beside it: the object diagrams that exemplify it, each assessed against it as expected valid or invalid. Closing it returns to the diagram without discarding its camera or selection; the assessment does not establish domain accuracy.

From the repository root, `npm run release:assemble` builds one versioned Atlas ZIP from the committed Git tree, including this app's source; the installers are separate CI artifacts (see [releases](../docs/releases.md)). See the repository [contribution guide](../CONTRIBUTING.md) and [changelog](../CHANGELOG.md).
