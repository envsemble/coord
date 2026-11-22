# Changelog

## Unreleased

**The hub**

- **A row's ask shows its PRs live:** the line under a plan's title (what you are to do, what it waits on, why it is blocked) links each PR, issue or commit it names, and a PR shows its state as a small mark after it, as on the plan's page (open, draft, merged or closed, and its checks). The link opens the PR in the browser; the rest of the row still opens the plan. The hub asks again when its window comes forward, so a PR merged meanwhile shows as merged.
- **Hints open quickly:** what a reference leads to and what a PR's mark stands for show in a tooltip of the app's own as soon as the pointer rests on them, on the hub and in a plan, in place of the system's slower one.
- **Every part of a row answers when pointed at:** the status icon, the steps (done of all, planning and implementation apart, and the step worked on or next), the model, the agents' time by stage, the dates, the projects behind their avatars, a group's chevron and number, and a folded group's parts answer almost at once. A plan's title opens a card with its summary once the pointer has rested on its letters for half a second, and no longer from anywhere on its row; a line cut short says itself whole the same way. Before, the summary was the only hint a row gave, over all of it, and the hints of the steps, the dates and the projects never showed.
- **Changes move instead of jumping:** a group's parts fold away and come back as a panel does, in 160 ms; when plans change while you look (an agent reports, a state changes), the rows that stay slide to their places, the tables grow or shrink with their rows, a new row is uncovered where it lands and one that leaves fades where it stood. A part's tile changes colour under the pointer as the rows do, and the heading line keeps its height when a project is chosen, so the plans no longer shift by a pixel. A change above the window leaves the rows you are reading where they are. Another project or filter still shows at once. Nothing moves when the system asks for reduced motion.
- **No line between a tile's cells:** at 125 % and 175 % zoom a one-pixel line of the surface showed between the first and second cell of a part's tile; the cells' fills now lap each other.

**Work in several projects**

- **A work item can be in several projects**, and each of its parts in projects of its own: its plan lists them (`projects`, by their planning folders' names), set with `work_create` and `work_update` (`coord work create --project`, `coord work update --project`). The hub's Project column shows every project a plan is in, a project's hub lists the plans that are in it, and the plan page names them.
- **A group and its parts are one entry on the hub:** the group's row has its parts under it, in their order, set in and numbered, each with its state, what it is for, its steps and its agents, as a list of tiles of their own, so groups that follow each other stay apart. A click on the group's row folds its parts away (its number opens its plan, a part's row the part), and a folded group says how many parts it has and how many are your turn. Work of one part is listed like any other work. The group sits where its most pressing part does.
- **A work item keeps one number, and its parts are numbered under it:** #0032-1, #0032-2, in place of a number of its own for every part. Every plan shows its work item's number and its part's, a work item of one part too. On the hub a work item of several parts is a row for the whole (#0032: its parts' steps, agents and time added up, and whose turn it is as its most pressing part says) with every part under it; a part's page names its work item in its breadcrumb and lists the parts beside it; the search finds a part by `#0032-2` and all of a work item by `#0032`. New parts are made with `work_create` and `partOf` (`coord work create --part-of`), and work that exists joins a work item with `work_update` and `partOf` (`coord work update --part-of`), which replaces the list of parts in a plan.
- **Nothing written before breaks:** in files and tools a first part is still written with the number alone (`work-0032`), and work that had a number of its own before it became a part keeps it as a former ID, which every tool, link and reference follows. Coord moves each planning folder to the new registry (version 3) by itself the first time it reads it, with the statistics recorded for the renumbered parts, and commits the move in the folder's Git when what it changes had nothing uncommitted. An older Coord says the folder is of a version it does not read: update the app, and the `coord` command with it.
- **A session sees the work that is in its project** though another project keeps it: `where` and the session start list it, named with that project (`envui:work-0048`), and the tools and `coord work` commands take that name to change it there.

**Links to work**

- **A click in any chat opens a plan in Coord:** agents name work as a link, such as `[coord#0046-2 Hub rows say more](https://coord.envsemble.com/open#coord/0046-2)`, as they link a PR. The link is a page of Coord's site that hands the address to the installed app, which shows that plan, starting first if it was closed. The tools' answers carry each work item's name and link, and the session start shows the form.
- **Nothing is sent anywhere:** the page is a file, and the project and the number follow the `#` of its address, which browsers keep to themselves. The app registers itself for `coord://open/…` links at its start and opens nothing for any other address.

## 0.10.0 — Coord on envUI 3 — 2026-11-21

**Search and the hub**

- **Search from anywhere:** the title bar's **Search** opens on Ctrl+K as well as Ctrl+P, and replaces the hub's **Search every project** button. Before you type, it shows the places you opened from it lately (kept per computer, across windows and restarts), searches to try, the plans that are your turn, and pages to go to.
- **Narrow a search** with `tag:`, `step:`, `doc:`, `diagram:`, `term:` or `project:`, with your tags and projects suggested as you type one; the words you typed are marked in the results.
- **One filter on the hub:** Open, Closed and All sit with a filter menu (Your turn, Agents working, Blocked, Changed this week), Statistics sits beside the project menu, and each group lists the most recently changed plan first.

**The window, on envUI 3.0**

- **envUI 3.0:** the app and the diagram viewer move from envUI 1.0 to 3.0.0, keeping Coord's pages and behaviour. The theme you chose still applies, and the offline diagram viewer still paints its saved theme before the first frame.
- **Settings** lists its sections in a column beside them (General, Agents, Computers, Updates), or a segmented control above them in a narrow window. Each setting is a row with its control at the end: Selects for the theme, the update channel and the network address, a switch for remote access, and a short field for the port. Agent rows show their state as a badge, with Choose program…, Check again and Connect by hand… in a More menu. In Computers, pairing a device waits until remote access is on.
- **Neutral selection:** selected items across the app take a neutral fill instead of blue.
- **A plan's status line** sits under its title, and the page it asks you to open is its primary button.
- **The parts rail** is a pane beside the plan, and a sheet that **Parts** opens in a narrow window.
- **Diagrams:** the floating controls are toolbars, and a proposal's changes are listed as rows.

**Breadcrumbs**

- **They stay in view:** the trail of a plan, a file, a page, a diagram or statistics sits in the window's top left, not in the page's centred column, and stays at the top as the page scrolls.
- **They float:** the crumbs sit on a pill of the page's own colour rather than a band across the window, so the page shows around them and a click beside them reaches the page.
- **The project shows with its avatar** before its name.

**Releases**

- **Nightly builds every six hours** (00:00, 06:00, 12:00 and 18:00 UTC) rather than once a night, so a fix reaches the nightly channel the same day.

**Fixes**

- A work item's status line no longer pushes its note below the badge and time when the note names a pull request.

**Website and README**

- The README and coord.envsemble.com show the same four current screenshots in the dark theme: the hub, a plan, a proposal's changes and a project's statistics.

## 0.9.0 — Coord — 2026-11-15

**Releases and updates**

- **Coord updates itself.** The installed app checks GitHub Releases when it starts and every four hours; a newer build shows as **Update** in the title bar, beside the computer, and in the new **Settings › Updates**, a click downloads it and **Restart to update** installs it. Nothing downloads or installs on its own, and Coord never moves to an older build.
- **Stable and nightly:** stable releases come from version tags on `main` as before; a nightly build of `dev` is published every night as a prerelease. **Settings › Updates** chooses the channel, and a nightly build says **Nightly** beside the logo in the title bar.
- **A website:** `site/` is Coord's download page, for coord.envsemble.com: what Coord is, download buttons for Windows and Linux, and a link to the newest nightly.
- **Open source:** Coord is under the MIT license, and its CI and releases run on GitHub's own runners.

**Coord Dev**

- **`npm run dev` starts Coord Dev:** the app in development, beside the installed Coord, on a copy of your Coord data in `~/.coord-dev`, with a **Dev** tag in the title bar that is also its menu (copy the real data again, remove the dev plugin).
- **A dev plugin of its own:** Coord Dev installs `coord-dev` in Claude Code and Codex beside the real plugin, every skill prefixed `dev-` (`dev-coord-implement`, `dev-full-stop`, …), on while it runs. It is the release's plugin with its names changed, so what it tests is what ships. Its skills and hooks act only when you ask for them with "dev" or in a session you start with "dev session".
- **The agents' plugin is named by its marketplace,** so connecting, listing and removing serve both plugins; and a command installed in a Coord home's agent folder uses that home.

**Atlas is now Coord**

- **Atlas is now called Coord**, everywhere: the app and its installer, the `coord` command, the agent plugin `coord@coord` with its skills `coord`, `coord-grill` and `coord-implement` ("coord grill", "coord implement"), the MCP server `coord`, the packages `@envsemble/coord`, `@envsemble/coord-diagrams` and `@envsemble/coord-app`, the `coord://` scheme, and a new mark. The name was free once the first product called Coord became envsemble.
- **What to do:** install Coord and uninstall Atlas; move `~/.atlas` to `~/.coord` with the app closed, renaming `atlas.db` (and its `-wal` and `-shm` files) to `coord.db`; set `COORD_HOME` and the other `COORD_*` variables in place of `ATLAS_*` ones; and in Claude Code and Codex remove the `atlas@atlas` plugin and connect Coord (Settings › Agents, or `coord setup`). In the planning folders, rewrite diagrams' `' atlas` header lines as `' coord`, and capture again (or stamp the fingerprint again) each capture whose header changed, as captures are frozen. Plans, steps and statistics come along unchanged.

**A simpler window, on envUI 1.0**

- **envUI 1.0:** the app and the diagram viewer move to envUI 1.0.0, now on npm, keeping Coord's look: the same pages, density and colours (the work statuses keep GitHub's colours). Installing from a checkout no longer needs a GitHub token.
- **One row at the top:** the title bar holds **Plans**, **Settings** and **Help**, then the computer and Coord's update. Plans and Settings are plain buttons that open their pages; Help holds Open Logs and About Coord. The File and View menus are gone (their shortcuts stay), and the theme moves from the title bar to **Settings › General**, where Settings now opens. The Plans and Projects sections below the title bar are gone too. Breadcrumbs start at Plans: Plans › Northwind › #0001.
- **Projects are managed from the hub:** the Projects page is gone; the hub's project menu chooses a project, shows what agents do on each, and makes, renames, archives and restores projects and changes their folders.
- **Files at the left:** a plan's files move from the card at the top right to the left of the plan and its pages; Ctrl+Shift+E brings the keyboard to them, and their edge drags to make them wider or narrower.
- **Work in parts:** a work item can be made of ordered parts, other work items of the project, each with its own plan and steps. A rail at the right of the group and of each part lists them in order with their status and steps, the hub says **Part 2 of #0005**, and agents set them up with `work_create` (`partOf`) and the new `work_parts` tool (`coord work parts`); `coord check` checks them.
- **Diagrams as links:** a plan's link to a diagram shows inline as the diagram's, in purple with a diagram icon, in place of the cards under its headings.
- **Readable tables:** a plan's table columns keep a readable width and the table scrolls sideways when it has more than fit; `coord check` warns about a table that will read cramped, and about rows a blank line cut off from their table, and an agent hears it as it writes.
- **A plainer diagram viewer:** full view, the attributes toggle (attributes always show), search, the element details with their source excerpts, and drawn stereotypes are gone; a proposal’s changes and a class diagram’s scenarios keep a side panel of their own.
- **One diagram with layers:** a capture, the proposals over it and the later captures compared with it are one diagram; the Files tree lists its layers under its first file, and `[` and `]` switch them, in place of the diagram picker. The plan's breadcrumb stays above a diagram, and the canvas takes the page's background.
- **The hub's search** is a button like the title bar's **Search**, **Search every project**, rather than a field.
- **Pages in work items:** an agent can make a page in a work item's `pages/` (a choice between layouts, a dashboard, a before and after), in React on envUI and the diagram viewer. Coord builds it and opens it in place, like a diagram, from the plan's link, Files or the search, updates it as the agent changes it, and saves the choices made on it for the agent, who hears of them with the next message. A page that needs you (its `page.json` says what for) has an amber dot in Files and on its links, and is listed under the plan's title, until the agent clears it. Pages have the widgets icon, in teal. `coord check` builds pages, and the coord skill says when one helps and how to write it, with envUI's documentation shipped beside it.
- **Before and after, without asking:** the skills have agents capture a database or model before and after work that changes its structure in a major way, comparing the two, so what the work changed can be seen later.
- **Changes on and off:** a proposal's **Show changes** button turns its change colours off and shows the diagram it proposes plainly, in place, and on again.
- **Diagrams in groups:** the layout draws related elements together, a diagram’s packages as named regions or the groups its relations form, with room and longer lines between the groups.
- **Arrange a diagram by hand:** drag an element and its relations follow; the arrangement is kept beside the diagram (`name.layout.json`), for all its layers, new elements go beside the ones they relate to, and **Reset layout** lays it out again.
- **Plans that read well:** a plan's text wraps at a comfortable line length, a touch larger with more room between its lines, its sections set apart; the plan and its side column are centred together. A plan's plan.md and ledger.md open as the plan page, and other documents show without their raw metadata header, under their plan's breadcrumb.
- **Whose turn it is, from the agents:** a work item says whose turn it is in its plan (Planning, Working, Waiting, Your turn or Blocked, each with a line of what for), set by the agents with the new `state` tool at every start and handoff; Coord no longer guesses Working, Needs you or Paused from what sessions do. The hub groups plans as **Your turn** (oldest first, each saying what you are to do), **Working**, **Waiting** and **Later**, and a plan says its state under its title, a PR it names with its live state. The session start points agents at what no longer adds up: work with no state, every step done but still open, your turn for days. Agent time no longer counts up live, and the hooks that only guessed (permission prompts, subagent starts, each tool use) are gone.
- **Fewer tools:** `work_update` takes over `work_tag`, `work_continue` and `work_parts`, `work_close` takes the outcome that `work_archive` took, and `needs_you` and `work_block` go into `state`: twelve tools, and the `coord work` commands to match (`state`, `update`, `close --abandoned`).
- **The delivery skills in the plugin:** full send, full stop, babysitting a PR, the opus-loop and council reviews, filing a PR and leaving PR comments ship in the plugin beside Coord's skills, with the reviewer agent they start; `extras/` is gone. **coord implement** now only keeps the work item true while the work is done (its steps, summary, findings left for later, and closing once the outcome is reached), leaving how to review and deliver to those skills, and **coord grill** settles how the work will be delivered and proven before the plan is accepted.
- **Now is removed:** a plan in progress no longer leads with what its sessions are doing, and its plan no longer folds under **Plan**: the page shows the plan whole, as it does for every plan. Its sessions stay in the side column.
- **Open in is removed:** the title bar's Open in, **File › Open in Editor** (Ctrl+O) and the choice of editor go. A file a plan links to still opens in VS Code.
- **Plan export and import are removed**, with `coord plan export` and `coord plan import`, File › Import Plan… and Export Plan…, and the plan export viewer.

**The installer is all you need**

- **The app carries the `coord` command and the Coord plugin.** It copies them to `agent/` in the Coord home, and on its first start puts the command on your PATH (the user `Path` on Windows, `~/.local/bin` on Linux), where it runs on a Node.js the app ships with it: no clone, Node.js or `coord setup` is needed. The Windows uninstaller takes it off the PATH and disconnects the agents.
- **Onboarding:** Coord starts with a short flow until it is finished: what Coord is, the agents on this computer (Claude Code and Codex), connecting them (or none), and how to start ("What is Coord and how do I use it?").
- **Settings** (File › Settings…, Ctrl+,): **Agents** connects and disconnects Claude Code and Codex and shows the plugin version each has; **Computers** holds both ways of pairing, the computers this one is paired with and the devices that can reach it. Updates refresh the plugin in the connected agents.
- **Agents are found as programs**, on the PATH as a terminal has it (read again at start, however Coord was started), or through **Choose program…** for one Coord does not find. **Connect by hand** lists the commands that install the plugin, to copy.
- **The app's plugin calls the command by its full path**, so it works at once, in agents started before the PATH changed too. Codex asks to trust its hooks again once.
- **Coord checks the connected agents:** **Ready** after a session ran Coord's hooks, **Waiting for a first session**, or a warning, in Settings, on the onboarding's last step and on the hub, when Codex does not trust Coord's hooks or a session used Coord's tools without its hooks running.
- **The computer menu** only switches computers, with **Computer settings…**; pairing and remote access moved to Settings.
- `coord setup` shares its code with the app's Agents; it behaves as before.

## 0.8.0 — The plans hub — 2026-10-20

**The app**

- **The hub:** Atlas opens on one list of every plan of every project, blocked and in progress first, then drafts. Each row shows its project, a one-line summary, its steps and its status: **Working** while an agent is on it, **Needs you** once it asks for you (a permission prompt, or `needs_you` when it stops for your question, decision or review; an agent that ends its turn waiting on CI stays Working). Filter by project and state, or search with Ctrl+P. A plan opens in one click. The projects sidebar, the project page and the tab rail are gone: a window shows one place, with back and forward, and New Window opens a second.
- **Now:** while a plan is implemented, its page leads with what each session on it is doing, its latest message and its last few actions, read from the sessions' logs and never stored; the plan folds below it. With nobody on it, Now shows where the work stopped.
- **Plan pages:** the plan's summary leads the page, a "Request" section shows folded, and beside it are the steps (planning steps in their own colour), the dates, live agent time, the sessions that worked on the plan, its timeline and its statistics. The steps of a plan being worked on pulse.
- **Files show all of themselves:** a file opened from the planning folder, such as a plan or a ledger, shows its metadata header as a table above its text.
- **Projects page:** one row per project with its avatar and the folders it covers as badges. **New project** asks for a name and the project's folders, chosen in the file manager; a project may have none. Archived projects appear only here.
- **The title bar** holds the File, View and Help menus, the computer menu, search and the theme switch; **Plans** and **Projects** are the two sections below it, and **Statistics** opens from the hub and from each project.
- **Faster:** the open plan is parsed only when its text changes, updates carry only what changed (a statistics-only change no longer resends the project), the window starts while the host starts, and the renderer is minified with the diagrams and statistics loaded when first opened (2.5 MB → 0.9 MB at start).

**Projects are folders**

- A project is its planning folder and the folders it covers on this computer (`folders` in `planning.json`); an agent session in one of them, or in the planning folder, belongs to it, the deepest folder winning. Atlas keeps no repositories: references name their repository in full (`owner/repo#12`, `owner/repo@4ab195a`, or a URL).
- Agents create projects with the new `project_create` tool (`atlas project create`), and a project made outside the app appears at once. A project is active or archived.

**Plans and agents**

- **Summaries:** plans carry a `summary` header, a few plain sentences on what the work is and where it stands; `atlas check` warns when an active plan has none.
- **Tags:** plans carry `tags`, the release the work ships in and the areas it touches, which agents keep (`work_create`, `work_tag`). `tag:0.8.0` in the search lists the plans tagged so, plans show their tags, and agents find past work with `work_search`.
- **Proposed steps:** while a plan is designed, its agent proposes its implementation steps (`step`, action `propose`); the plan page shows them dimmed under **Proposed**, outside the progress, and `work_start` without steps adopts them.
- **Planning steps:** a work item's ledger exists from its creation, with planning steps that agents keep true; accepting marks them done and starting adds the implementation steps. Ledgers are their steps and an optional final-review list, nothing else.
- **Handoffs:** a plan's `continues` header names the work it continues, in its project or another (`work_create --continues`, `work_continue`); the earlier work shows where it was continued.
- **Sessions:** the hooks record when a session's turn starts and ends and when it waits for you. Agent time adds every agent up, subagents in full, with the time at least one worked on hover; reports keep time and tokens by model and reasoning effort, as planning or implementation. Codex's compressed rollouts are read.
- **References:** the host resolves what a plan references: PRs with their state from `gh`, commits from the project's checkouts first, files in a checkout.
- **Hooks are cheap:** an edit outside the planning folders costs about as much as starting Node, session logs are read from where the last report stopped, and a session that moves to another work item reports the one it left at its next turn end, prompt or end.
- **Skills:** three, by name: `atlas` (planning and recording, on its own), `atlas-grill` (questioning in rounds, with diagrams built on captures of the code when they help understanding) and `atlas-implement` (implementing an accepted plan in any setup: delivery as the plan says, as commits, a branch or a PR that passes CI and can be merged; review by a subagent or a self-review, at most three rounds per step, with a final-review list; the user confirms before work closes). Atlas records projects and work items, nothing else: no knowledge folder, ADR or evidence conventions, and the skills are about half as long. Agents make diagrams when they help mutual understanding, not only when asked. One `step` tool changes a ledger's steps (its `action` is `add`, `set`, `rename` or `remove`), keeping the tool list short.

**The command and the host**

- `atlas check` replaces `atlas planning check`; a work item without a ledger, and unknown fields in a plan header, are errors.
- Plan exports carry, and imports require, the plan and its ledger; an import records its provenance in `import-provenance.json` in the work folder.
- The host reloads a planning folder by reading only what changed (envUI's planning folder: 750 ms → 80 ms, and 1.9 s → 120 ms after a commit), and no Markdown file can hold it for long. Protocol 14: projects are identified by `projectId`, and paired computers on 0.7 cannot connect.

**No backwards compatibility**

- The home database has one schema (version 11) and refuses any other; there are no migrations. Older statistics files, document use, hidden projects, workspace folders and the `.atlas/` model format are gone. Move an older home aside to start afresh.

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
