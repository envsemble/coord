# Atlas desktop app

![The Atlas hub on the computer Workstation: seven open plans of the projects Northwind, Platform and Field app, grouped as Working (one plan an agent is on now, with its model, agent time and tokens), Blocked with their reasons, Paused and Drafts, each with its project, steps done and when it changed](../assets/hub.png)

Atlas is a desktop app for your Atlas projects and their plans. Every window opens on the hub, one list of every plan of the computer's projects, and shows one place at a time: the hub, a plan, its statistics, a diagram, a file, the Projects page, statistics or Settings. Discuss changes with your agent in chat; the agent edits the records, and Atlas shows them as they change.

## Install

Atlas is built for Windows and Linux. Builds are unsigned, by decision for a single user; a newer version installs over an older one, and there is no auto-update. Each [GitHub Release](../docs/releases.md#github-releases) carries both; `npm run package` in a checkout builds the one for its system into `app/release/`.

- **Windows:** run `Atlas-Setup-<version>.exe`. SmartScreen warns about an unsigned app the first time: choose **More info › Run anyway**. It installs for the current user only, without administrator rights (you can pick the folder), and adds Atlas to the Start menu. Uninstall it from **Settings › Apps**; your Atlas home is kept.
- **Linux:** make `Atlas-<version>-x86_64.AppImage` executable (`chmod +x`) and run it.

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

## The window

A window has two rows at the top, GitHub style.

**The title bar**, from the left:

- the Atlas mark, then the **back** and **forward** arrows;
- **File**: **New Window** (Ctrl+Shift+N), **New Project…**, **Import Plan…**, **Export Plan…** (while a plan is open), **Open in Editor** (Ctrl+O, while the window shows a file of this computer), **Settings…** (Ctrl+,; see [Settings](#settings)) and **Exit**;
- **View**: **Zoom In** (Ctrl++), **Zoom Out** (Ctrl+-), **Actual Size** (Ctrl+0) and **Full Screen** (F11), with **Reload** and **Developer Tools** in development builds;
- **Help**: **Open Logs** and **About Atlas**;
- the **computer menu**, the name of the computer the window works on: this computer and the paired ones (choosing one shows its plans in this window), and **Computer settings…**, which opens **Settings › Computers** (see [Remote computers](#remote-computers));
- at the right: **Open in** (a split button that opens the file the window shows, such as a plan's `plan.md` or a diagram's source, in the editor you choose: VS Code, VS Code Insiders, Cursor, Windsurf, Zed, or the system's file manager), **Search** (Ctrl+P; on the hub its own search field takes its place), record-health notes when the shown project has any, the theme menu (**Match the system**, **Light** or **Dark**, for every window) and the system's window buttons.

Alt opens the menus from the keyboard (Alt+F, Alt+V, Alt+H). Empty space in the title bar moves the window, and a double click maximizes it.

**The sections**, below the title bar: **Plans**, with the number of open plans (the hub, every plan and its pages, and all plans' statistics), and **Projects**, with the number of active projects (the Projects page and each project's statistics).

**Back and forward** step through what the window showed: the hub with its project filter, plans at their headings, their statistics, diagrams and files, the Projects page, statistics and the sections of Settings. Use the arrows, Alt+← and Alt+→, or the mouse's back and forward buttons. A place shown again is where it was left. With a menu or dialog open, the mouse's buttons only close it, and fields keep Alt+← and Alt+→.

**New Window** opens another window on the same computer; Ctrl+Shift+W closes one. Windows open at quit come back at the next start, each with its size, position and place; so does the last window closed. A window whose paired computer does not answer at the start shows the hub at once and its place when the computer answers.

**The search** (Ctrl+P, **Search**, or the hub's search field) searches every active project of the computer: plans, ledger steps, documents with their headings and text, diagrams and their elements, glossary terms and projects. A plan's tags match as words, and `tag:0.8.0` keeps only the plans tagged `0.8.0` (with words, those that also match them); plans show their tags. Results come grouped by kind, each with its project and plan, and open where they are: a plan, a document at its heading, a diagram at its element, a project's plans in the hub.

| Shortcut                 | Action                                   |
| ------------------------ | ---------------------------------------- |
| Alt+← / Alt+→            | Back / forward                           |
| Ctrl+P                   | Search                                   |
| Ctrl+O                   | Open the shown file in the chosen editor |
| Ctrl+Shift+E             | Bring the keyboard to the plan's Files   |
| Ctrl+,                   | Settings                                 |
| Ctrl+Shift+N             | New window                               |
| Ctrl+Shift+W             | Close the window                         |
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in / out / actual size              |
| F11                      | Full screen                              |

## The hub

The hub lists every plan of the computer's active projects, grouped by status, in this order: **Needs you** (an agent asked for you: a question, a decision or work to review), **Working** (an agent is on it: in a turn, or waiting on something else, such as CI), **Blocked**, **Paused** (implementation started, nobody on it), **Drafts**, **Ready** (accepted, not started) and, when asked for, **Closed**. Each group lists the latest change first; only groups with plans show.

Its heading line holds the title (**Plans**, or the project's name when filtered), **Statistics** (all plans', or the project's), the search field, which opens the search with what you type and never filters the list, the project filter (**All projects**, or one active project) and the state filter (**Open**, **Closed** or **All**, each with its count). The project filter is part of the place, so back and forward and a plan's breadcrumb set it.

Every plan is a row; a click anywhere on it opens the plan. A row shows:

- **Plan:** its status icon, title and number; its summary on hover. Work under way (Needs you, Working, Blocked, Paused) has a taller row with the step being worked on (**Now:**) or next (**Next:**), in its phase's colour, how long an agent has waited for you, or, for blocked work, why it is blocked.
- **Project:** the project's name.
- **Steps:** a bar with the steps done, the planning steps in their own colour and the step in progress pulsing while agents work, and "N of M"; a draft shows its planning steps. Closed work shows how it ended (**Complete**, **Partially done**, **Superseded** or **Abandoned**), when, and where it was continued.
- **Agents:** the main model and its reasoning effort (and how many others), agent time (counting up while agents work, by stage on hover), tokens and, on taller rows, subagents.
- **Changed:** when it last changed, the date on hover.

## A plan

![A plan in Atlas: Saved payment methods, #0001 of Northwind, Working with 2 of 7 steps and Export Plan… beside its breadcrumb; its Outcome and Scope, and a diagram card, Checkout · captured TypeScript, Generated from code, with its elements, under the heading Current checkout. Beside it the side column: Progress (2 of 7 steps done, 5 left, planning steps done in their own colour, the step in progress), Continues #0004 Inventory reservations at checkout, the session working on it, and Statistics (Claude Opus 5.5 with Claude Sonnet 4.5 and Claude Haiku 5.5, 4 h 33 min 3 s of agent time, 13.8M tokens). At the right the Files card with the work folder, plan.md marked; Open in VS Code in the title bar](../assets/plan.png)

A plan's page shows:

- **The breadcrumb**, the project (leading to its plans in the hub) and the plan's number, with **Export Plan…** beside it.
- **The title and one status line**, with the plan's tags under it: its status (Working, Needs you, Blocked, Paused, Draft, Ready, Complete, Partially done, Superseded or Abandoned) and one fact, such as the steps done, why it is blocked, the planning step of a draft, or when closed work ended; "archived" when it is.
- **Why it needs you**, when an agent waits: the waiting session's last message, with its harness, model and how long it has waited.
- **The summary**, a few sentences on what the work is and where it stands.
- **Now**, while the plan is implemented: what each session on it is doing, by its latest message and its last five actions, newest first (files edited, commands run, the ones that failed marked, Atlas tools used, helpers started); with none on it, where the work stopped. It is read from the sessions' logs as they work, and nothing of it is kept.
- **The plan** itself, folded under **Plan** while the plan is implemented. A section headed **Request** (or **Request (…)**), where the plan keeps the user's words, shows folded; its heading opens it. A heading whose text links to a diagram has the diagram's card under it (see [Diagrams](#diagrams)). What the plan references opens from it: other plans and documents in the window, PRs with their state (open, draft, merged or closed, and failing or running checks), commits and files.
- **The side column**, which scrolls on its own: **Progress** (a bar with the steps done and left, then the steps themselves, planning steps in their own colour before the implementation steps, the one in progress pulsing while agents work), any blocker, **handoffs** (the work it continues above the steps, the work that continues it below them), **Sessions** (the agent sessions that worked on it by their titles, the latest first, marked while one works) and **Statistics** (the main model and effort with the others, agent time counting up while agents work, tokens, and **All statistics and the timeline**).
- **Files**, a card at the top right of a plan and its pages, with the plan's own work folder as a tree, the file shown marked. It keeps its place as the page scrolls, or goes below the page in a narrow window. A click opens a file in the window, a diagram file as its diagram; its context menu offers **Open** (**Open Diagram**), **Open as Text**, **Show in Folder** and **Collapse All Folders**. Arrow keys, Home and End, type-ahead and Enter work in the tree; Ctrl+Shift+E brings the keyboard to it.

**A plan's statistics**, from **All statistics and the timeline**, show its figures (agent time, the time at least one agent worked, tokens and sessions), its **Timeline** (a lane per session and subagent with its working stretches and its waits for you; **All**, **Last week** or **Last day**, zoom with Shift and the wheel or the arrow keys, drag to move along; also as a table, folded) and its agent time and tokens **By model and effort**.

**Export Plan…** saves the plan as one self-contained HTML file that opens offline in any browser. **Import Plan…**, in **File**, imports such a file into the project shown (a plan of it, its statistics, or the hub filtered to it; with a single project, that one): it previews the file (its title, origin, the new number and folder, files and diagrams) and only then adds it as new work, without committing. A file that is not a valid export is refused before anything is written. See [plan export](../docs/plan-export.md).

## Projects

![The Projects page on the computer Workstation: three projects, Northwind (one plan working, 3 open plans, changed just now, folders shop and shop-admin), Platform (2 open plans, folders platform-api, platform-web and billing) and Field app (2 open plans, folder field-app), each with its initials avatar, its folders as badges, a statistics button and a ⋯ menu, and New project at the top right](../assets/projects.png)

A **project** is a planning folder in the [Atlas home](../docs/command.md#the-atlas-home), named by the `name` in its `planning.json`, with the **folders** it covers on its computer, such as your repositories. An agent working in one of them, or in a folder inside one, plans in that project.

The **Projects** page lists every project of the computer, one row each: its avatar (its initials in a colour of its own), its name (which shows its plans in the hub), what agents do on it (how many need you or are working), its open plans and when it changed; at the right its folders as badges by their names (the path on hover), a **Statistics** button and the **⋯** menu:

- **Folders…** shows its planning folder and the folders it covers, and adds (chosen in the file manager) or removes them;
- **Show in Folder** and **Copy Path**, for its planning folder;
- **Rename…** writes the new name into its `planning.json`, where agents read it too;
- **Archive** takes it and its plans out of the hub and the search; **Restore** brings it back.

Archived projects are shown only here, folded under **Archived**. Atlas never deletes a project; to drop one, remove its folder from the home.

**New project** (or **File › New Project…**) asks for a name and the project's folders, each chosen in the file manager (the first one names the project until you type a name); a project may have none yet. Atlas creates the planning folder in the home from the bundled templates, as a Git repository with a first commit. Agents can create projects too.

## Statistics

Statistics open from a project's row on the Projects page and from the hub (all plans', or the project's when the hub is filtered to it). The period is the **Last 4 weeks** (by day), the **Last 3 months** or **All time** (by week). [Progress and statistics](../docs/progress-and-statistics.md) explains what agents report and how Atlas counts it.

- **The figures** of the period, each with its change against the period before: agent time (every agent's added up), plans completed, the median time to complete (from acceptance to completion) and the time work waited on you.
- **Work over time:** agent time per day or week, stacked by model and effort (each in a colour of its own, the same wherever Atlas shows it), with the time at least one agent worked as a line and the plans completed marked; a bar says on hover what it holds, and the same figures are in a table, folded.
- **Models and effort:** agent time and tokens by model and reasoning effort, with each one's share.

The Atlas plugin's hooks record what agent sessions do on a work item: the model and its effort, agent time (subagents included), tokens, and whether the work was being planned or implemented. The reports go into the home database under the project, so they follow the work item when it is archived.

## Diagrams

Diagrams belong to their plan: PlantUML (`.puml`) files in its work folder, usually under `diagrams/`, which the agent writes like any file and Atlas only reads. [Diagrams](../docs/diagrams.md) describes the subset Atlas reads.

A plan shows a diagram card under each heading whose text links to a diagram with an ordinary Markdown link (`[Order model](diagrams/orders.puml)`); a fragment (`diagrams/orders.puml#Order`) names an element. A card shows the diagram's title, its provenance (**Generated from code**, **Generated from database**, **Agent proposal** or **Agent-authored**) and its elements, and opens the diagram, at an element when you choose one. Diagrams also open from links, from Files and from the search.

A diagram fills the window below the title bar, with its controls over the canvas: a link back to the plan, the tools, the diagram picker, the views and a proposal's changes. The picker lists the plan's diagrams: each capture with the proposals over it and the later captures compared with it, then the other diagrams, then **With problems**. A proposal, or a capture compared with an earlier one, opens in its change view, with its list of changes beside it. **Understand the model** opens a class diagram's scenarios beside it. Diagrams built on one capture are laid out together, so switching between them moves nothing. When a file changes, the view updates and keeps its camera and selection; a diagram with problems lists them by line and column instead.

## Settings

**File › Settings…** (Ctrl+,) opens Settings in the window, a page with two sections; back and forward step through them like other places.

- **Agents**, this computer's: **Claude Code** and **Codex**, each with its status (**Connected** with the version of the Atlas plugin it has, **Not connected**, or **Not found on this computer** with a link to install it) and **Connect** or **Disconnect**. Connecting installs the Atlas plugin into the agent with the agent's own commands, which can take a minute; the row shows it, and says why if it fails, with **Try again**. In a window on another computer, Agents is still this computer's: connecting installs the plugin here. Codex asks once to trust Atlas's hooks: type `/hooks` in a new Codex session.
- **Computers**, both ways of pairing: **Other computers**, the computers this one is paired with, and **Devices that can reach** the window's computer (see [Remote computers](#remote-computers)).

Until it is finished or skipped, Atlas starts with a short onboarding instead of the window: what Atlas is, the agents on this computer (those found are ticked; untick the ones to leave alone), connecting them, and how to start: a new session in one of your repositories, asking "What is Atlas and how do I use it?". **Skip** ends it as finishing does; Settings › Agents connects agents any time.

## Remote computers

**Devices that can reach** this computer, in **Settings › Computers**, lets your other devices work on this computer: choose the address (Tailscale, a local network or only this machine) and the port, then create a five-minute, one-time pairing link with a QR code. A link may grant **Manage access** (pairing and revoking devices). Revoke devices there too. In a window on another computer, the section manages that computer's pairings, when this device has Manage access there.

**Connect to Another Atlas…**, under **Other computers** in **Settings › Computers**, pairs with another computer from its link. Then choose it in the computer menu to work on its projects in this window, or open it in a new window from **Other computers**, which also forgets a paired computer. On another computer you can create projects (a name only: their folders are chosen in Atlas on that computer), rename them, archive and restore them (the archive state is this device's), and export and import plans. Show in Folder and Open in Editor work only on this computer's files. See [remote access](../docs/remote-access.md).

## Staying current

Atlas watches the planning folders it shows instead of polling. Changes are collected for a moment and applied together, so an editor's save, a Git checkout or a commit each cause one refresh.

- A **`planning.json` that breaks** keeps the last good view, with the error above it, until the file is readable again.
- A **project whose folder is moved or deleted**, or that cannot be read, says so in place of its page, and shows again when it can.
- A folder that **cannot be watched** (Linux's inotify watch limit, say) is checked every 10 seconds instead, and Atlas says so above the page.
- A **window that crashes** reloads, showing what it showed. If it crashes three times within a minute, Atlas asks whether to reload it again or close it.

## Security and privacy

The app follows Electron's security checklist:

- The window runs with context isolation and Chromium's sandbox, without Node.js integration, `remote` or `<webview>`, under a strict content security policy: no inline or remote scripts, no `eval`, no network connections.
- It talks to the main process only through `window.atlas`, a fixed list of messages whose every argument is checked (`shared/validate.ts`). Each window has its own session, whose `atlas:` protocol serves the app and only the planning folders of that window's projects.
- Navigation away from the app and new windows are blocked; web links open in the system browser.
- Commands a page could misuse wait for you. Right after your click, key press or tap in the window, which a page cannot fake, Atlas runs one: exiting, opening a window or the logs, turning remote access on or moving it, pairing with another computer, opening a web address in the browser, a link in its application, or a file in your editor. Otherwise it first asks in a system dialog the page cannot answer. Creating a pairing link always asks first.
- Electron fuses turn off running as Node.js and `NODE_OPTIONS`. The installer and AppImage also turn off `--inspect`, and refuse to start with `--remote-debugging-port`, `--remote-debugging-pipe` or `--inspect`, which would let other programs control the window.
- Planning folders are read by the Atlas host in a separate process, which the main process reaches over loopback with a token made at each start; windows never reach it directly.
- No data leaves the computer unless you turn on remote access; then the devices you paired can work on its projects. There is no telemetry, update check or crash upload.

## Diagnostics

**Help › Open Logs** opens `logs/` in the Atlas home: `atlas.log` (the app: start-up, windows and connections) and `host.log` (the Atlas host: folders, the watcher, remote access and pairings), each up to 1 MB with up to three older files. **Help › About Atlas** shows the version, the Electron, Chromium and Node.js versions, the system and the Atlas home; **Copy Details** copies what a bug report needs, without the home's path.

Atlas keeps its own data in the Atlas home, `~/.atlas` (or `ATLAS_HOME`), shared with the `atlas` command: the planning folders in `planning/`, and the projects' order and state, the windows and their places, the theme, the editor, remote access and pairings, and statistics in the home database, `atlas.db`. Electron's own files stay in its per-user folder (`%APPDATA%\Atlas` on Windows, `~/.config/Atlas` on Linux). Atlas writes into a planning folder only when you import a plan, create or rename a project, or change its folders.

## Develop

From the repository root, `npm ci`, then `npm run dev` starts the app with hot reload (give it a home of its own: `ATLAS_HOME=~/.atlas-dev npm run dev`, or `npm run dev:home`). `npm run package` builds the installer or AppImage, and `npm run test:e2e` drives it. [Contributing](../CONTRIBUTING.md) covers set-up, the repository layout, the tests and the checks.
