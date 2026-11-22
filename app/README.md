# Coord desktop app

![The Coord hub, dark, on the computer Workstation: the open plans of the projects Coord and envUI, each with its project's avatar, grouped as Your turn (five plans, each saying what the agent waits on you for, such as merging envsemble/envUI#70 and releasing 1.1.0), Working, Waiting (on CI and review bots for a PR) and Later; each row with its steps done, its agents with their time, tokens and subagents, and when it changed; the title bar holds the Coord mark, Plans, Settings and Help, the computer menu and the search, and the heading line the project menu, Statistics and the Open, Closed and All filter](../assets/hub.png)

Coord is a desktop app for your Coord projects and their plans. Every window opens on the hub, one list of every plan of the computer's projects, and shows one place at a time: the hub, a plan, its statistics, a diagram, a file, statistics or Settings. Discuss changes with your agent in chat; the agent edits the records, and Coord shows them as they change.

## Install

Coord is built for Windows and Linux. Builds are unsigned for now; a newer version installs over an older one, and the installed app updates itself (see [Updates](#updates)). Each [GitHub Release](../docs/releases.md#github-releases) carries both; `npm run package` in a checkout builds the one for its system into `app/release/`.

- **Windows:** run `Coord-Setup-<version>.exe`. SmartScreen warns about an unsigned app the first time: choose **More info › Run anyway**. It installs for the current user only, without administrator rights (you can pick the folder), and adds Coord to the Start menu. Uninstall it from **Settings › Apps**; your Coord home is kept.
- **Linux:** make `Coord-<version>-x86_64.AppImage` executable (`chmod +x`) and run it.

The app carries the [`coord` command](../docs/command.md) and the Coord plugin for agents. Each start of a new version copies them to `agent/` in the Coord home, and the first start puts the command on your PATH without asking, as VS Code does with `code`: the user `Path` on Windows, a link at `~/.local/bin/coord` on Linux (an existing file there is left alone). The command runs on a Node.js the app ships with it, copied there too, so nothing else needs installing. The copy of the plugin calls the command by its full path, so an agent started before the PATH changed runs it too. Then the onboarding connects your agents (see [Settings](#settings)); after an update, Coord refreshes the plugin in the agents it connected. Uninstalling on Windows (not updating) disconnects Claude Code and Codex where Coord connected them, since their plugin calls the command, and takes the command off the PATH.

### Updates

The installed app updates itself from the [GitHub Releases](../docs/releases.md#github-releases) of envsemble/coord, on one of two channels: **stable**, the releases, or **nightly**, a build of `dev` every six hours. A build follows its own channel until **Settings › Updates** chooses the other. Coord checks the channel when it starts and every four hours. A newer build shows as **Update** in the title bar and in Settings › Updates: a click downloads it, and **Restart to update** installs it and starts it again (on Windows the installer runs without its pages, into the same folder; on Linux the AppImage replaces itself). Nothing downloads or installs on its own.

Coord never moves to an older build, whose code may not read the home this one wrote: a nightly switched to stable stays until a stable release newer than it is out. Updates are off in a development build (`npm run dev`), in the end-to-end build, on Linux when Coord does not run as its AppImage, and with `COORD_NO_UPDATES=1`; Settings › Updates then says why. The builds are not code-signed, so an update's integrity rests on HTTPS and the SHA-512 in the channel's update file (`latest.yml` or `nightly.yml`).

### Linux sandbox

Coord keeps Chromium's sandbox on and never disables it. An AppImage cannot use Chromium's setuid sandbox helper, so it needs unprivileged user namespaces. Ubuntu 23.10 and later restrict those through AppArmor; there the AppImage launcher would start Coord with `--no-sandbox`, and Coord refuses to run that way: it shows "Coord does not run without its sandbox" and quits (the log records it too). Allow the namespaces instead, either:

- allow them until the next reboot: `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (add `kernel.apparmor_restrict_unprivileged_userns=0` to a file in `/etc/sysctl.d/` to keep it), or
- give the AppImage its own AppArmor profile, `/etc/apparmor.d/coord-desktop`, then run `sudo apparmor_parser -r /etc/apparmor.d/coord-desktop`:

      abi <abi/4.0>,
      include <tunables/global>
      profile coord-desktop /home/*/Applications/Coord-*.AppImage flags=(unconfined) {
        userns,
        include if exists <local/coord-desktop>
      }

  Adjust the path to where you keep the AppImage.

Coord also refuses `--no-sandbox` and `ELECTRON_DISABLE_SANDBOX` given any other way, and its desktop entry never adds them.

## The window

A window has one row at the top, its title bar, from the left:

- the Coord mark, then the **back** and **forward** arrows;
- **Plans**, a button that opens the hub with every plan (the hub leads on to each project's plans and the statistics);
- **Settings**, a button that opens [Settings](#settings) (Ctrl+,);
- **Help**: **Open Logs** and **About Coord**;
- the **computer menu**, the name of the computer the window works on: this computer and the paired ones (choosing one shows its plans in this window), and **Computer settings…**, which opens **Settings › Computers** (see [Remote computers](#remote-computers));
- **Update**, beside the computer, while a newer Coord is on offer, downloading or ready (see [Updates](#updates));
- at the right: **Search** (Ctrl+K, or Ctrl+P), on every page, record-health notes when the shown project has any, and the system's window buttons.

The window's other commands (New Window, zoom, full screen) keep their shortcuts, Ctrl+Shift+N, Ctrl++, Ctrl+-, Ctrl+0 and F11. Empty space in the title bar moves the window, and a double click maximizes it.

**The breadcrumbs** of each page lead back the way you came: **Plans** (every plan), the project (its plans), then the plan, as in Plans › Northwind › #0001; a part has its group before it (Plans › Northwind › #0005 › #0006).

**Back and forward** step through what the window showed: the hub with its project filter, plans at their headings, their statistics, diagrams and files, statistics and the sections of Settings. Use the arrows, Alt+← and Alt+→, or the mouse's back and forward buttons. A place shown again is where it was left. With a menu or dialog open, the mouse's buttons only close it, and fields keep Alt+← and Alt+→.

**New Window** opens another window on the same computer; Ctrl+Shift+W closes one. Windows open at quit come back at the next start, each with its size, position and place; so does the last window closed. A window whose paired computer does not answer at the start shows the hub at once and its place when the computer answers.

**The search** (Ctrl+K or Ctrl+P, or **Search** in the title bar) searches every active project of the computer: plans, ledger steps, documents with their headings and text, diagrams and their elements, glossary terms and projects. A plan's tags match as words, and `tag:0.8.0` keeps only the plans tagged `0.8.0` (with words, those that also match them); plans show their tags. Results come grouped by kind, each with its project and plan, and open where they are: a plan, a document at its heading, a diagram at its element, a project's plans in the hub.

| Shortcut                 | Action                                 |
| ------------------------ | -------------------------------------- |
| Alt+← / Alt+→            | Back / forward                         |
| Ctrl+K, Ctrl+P           | Search                                 |
| Ctrl+Shift+E             | Bring the keyboard to the plan's Files |
| Ctrl+,                   | Settings                               |
| Ctrl+Shift+N             | New window                             |
| Ctrl+Shift+W             | Close the window                       |
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in / out / actual size            |
| F11                      | Full screen                            |

## The hub

The hub lists every plan of the computer's active projects, grouped by whose turn its agents say it is, in this order: **Your turn** (what you are to do: merge a PR, try something, answer questions), **Working** (agents planning or implementing it), **Waiting** (on a PR's checks or reviews or something else, or blocked), **Later** (ready to start, drafts nobody is on, and work under way that says nothing, marked **No state**) and, when asked for, **Closed**. Every group lists the latest change first; only groups with plans show. Coord never guesses a status from what sessions do: agents declare it, and the session start points them at what no longer adds up.

Its heading line holds the title (**Plans**, or the project's name when filtered), **Statistics** (all plans', or the project's), **Search every project**, the title bar's search in the same style, which opens the search and never filters the list, the project menu (**All projects**, or one active project; see [Projects](#projects)) and the state filter (**Open**, **Closed** or **All**, each with its count). The project chosen is part of the place, so back and forward and a plan's breadcrumb set it.

Every plan is a row; a click anywhere on it but on a link opens the plan. A row shows:

- **Plan:** its status icon, title and number (**#0032-1**: its work item's number, then its part's). A work item made of several parts has a chevron before its icon, is a row for the whole (**#0032**) that folds at a click, with its parts under it (see [Work in parts](#work-in-parts-and-in-several-projects)). Work under way (Your turn, Working, Planning, Waiting, Blocked) has a taller row with what its state is for (what you are to do, in amber; what it waits on), else the step being worked on (**Now:**) or next (**Next:**) in its phase's colour, or, for blocked work, why it is blocked. A PR, issue or commit that line names (`owner/repo#12`, `owner/repo@4ab195a`, a GitHub URL) links to its page in the browser, a PR with its live state after it as a small mark, as on the plan's page (open, draft, merged or closed, and its checks), named when pointed at; the hub asks about them again when its window comes forward, at most once a minute. Nothing else follows from a PR's state: the row stays where it is.
- **Project:** the projects the plan is in: one by its name, several as their avatars. The column shows when the plans listed are in more than one project.
- **Steps:** a bar with the steps done, the planning steps in their own colour, and "N of M"; a draft shows its planning steps. Closed work shows how it ended (**Complete**, **Partially done**, **Superseded** or **Abandoned**), when, and where it was continued.
- **Agents:** the main model and its reasoning effort (and how many others), agent time as reported, tokens and, on taller rows, subagents.
- **Changed:** when it last changed. In **Your turn** and **Waiting** the column is **Waiting**: how long the state has stood (**5 hours**, **3 days**), or a dash when the plan does not say since when.

**Pointing at a row says more**, in the app's own hints, at two paces. What is pointed at on purpose answers almost at once: the status icon (its name), a part's number, a group's chevron (**Hide its 2 parts**) and its number (**Open its plan**), the steps (done of all, planning and implementation apart, and the step worked on or next), the model (its identifier and provider), the agents' time (by stage), a date (the moment), several projects' avatars (their names), a PR and its mark, and a folded group's parts (each with its state). Text the pointer merely crosses answers once the pointer has rested on it for half a second: a plan's title opens a card with its summary above the row (and its whole title, where the row cuts it short), from the title's own letters and not from the rest of the row, and a line cut short (what the state is for, why it is blocked, a project's name) says itself whole under the row; a line that fits says nothing more. A press opens no card: it opens the plan. Keyboard focus resting on a row opens its card too. A click on any of these still opens the plan, or folds the group.

**The list moves only to say what changed**, briefly (envUI's 160 ms for a panel that opens) and never before a click is taken. A group's parts fold away and come back as a panel does: the table's frame closes over them and the rows after rise with it, the chevron turning. When plans change while the hub shows (an agent reports, a state changes, a PR merges), the rows that stay slide to their new places, a table grows or shrinks with its rows, a row that arrives is uncovered where it lands, one that leaves fades where it stood as the rows after it close over it, and a group that appears opens from nothing; a row that would travel further than the window is tall is simply there, and a change wholly above the window leaves the rows in sight where they are. Other plans (another project, a filter) are shown at once, as a click's answer should be. A part's tile changes colour under the pointer as the rows do. Where the system asks for reduced motion nothing moves: changes take effect at once, and a group's parts fade in.

## A plan

![A plan in Coord, dark: Run a development Coord beside the installed one, #0043 of Coord, under the breadcrumb Plans › Coord › #0043, with its summary and marked Your turn with what to do: say whether to close it; its tags, its folded request and the decisions it settled. At the left the plan's files; at the right Progress (all 10 steps done) with its steps, the sessions that worked on it and its statistics](../assets/plan.png)

A plan's page shows:

- **The breadcrumb**: Plans, the project (leading to its plans in the hub), the group it is a part of, and the plan's number.
- **The title and one status line**, with the plan's tags under it: its status (Your turn, Working, Planning, Waiting, Blocked, Draft, Ready, No state, Complete, Partially done, Superseded or Abandoned) with what its state is for (what you are to do, in amber, its references linked: a PR shows its live state) and since when, or else one fact, such as the steps done, the planning step of a draft, or when closed work ended; "archived" when it is.
- **The summary**, a few sentences on what the work is and where it stands.
- **Pages that need you**: each of the work item's pages whose agent asked for you (a decision, a review), by its name with what it waits on; a click opens it.
- **The plan** itself. A section headed **Request** (or **Request (…)**), where the plan keeps the user's words, shows folded; its heading opens it. A link to a diagram shows as the diagram's, with a purple diagram icon (see [Diagrams](#diagrams)); tables keep columns wide enough to read, and scroll sideways when they have more than fit. What the plan references opens from it: other plans and documents in the window, PRs with their state (open, draft, merged or closed, and failing or running checks), commits and files.
- **The side column**, which scrolls on its own: **Progress** (a bar with the steps done and left, then the steps themselves, planning steps in their own colour before the implementation steps, the one in progress pulsing while agents work), any blocker, **handoffs** (the work it continues above the steps, the work that continues it below them), **Sessions** (the agent sessions that worked on it by their titles, the latest first, marked while one works) and **Statistics** (the main model and effort with the others, agent time counting up while agents work, tokens, and **All statistics and the timeline**).
- **Files**, at the left of a plan and its pages, with the plan's own work folder as a tree, the file shown marked. It stays in view as the page scrolls and scrolls on its own. A click opens a file in the window, a diagram file as its diagram; its context menu offers **Open** (**Open Diagram**), **Open as Text**, **Show in Folder** and **Collapse All Folders**. Arrow keys, Home and End, type-ahead and Enter work in the tree; Ctrl+Shift+E brings the keyboard to it. Drag its right edge (or use the arrow keys on it) to make it wider or narrower; a double click returns it to its width, and the width is kept. A narrow window leaves it out.
- **Parts**, a rail at the right of each part of a work item of several parts: its parts in their numbers' order, each with its status and its steps done, the one shown marked. A click opens one. The breadcrumb of a later part names its work item before it: Plans › Coord › #0046 › #0046-2.

### Work in parts, and in several projects

A work item has a number and is made of **parts**, each with its own plan, steps and statistics, numbered in the order they were made: **#0032-1**, **#0032-2**. Most work has one part. Some work is better thought of as several pieces, each planned and done on its own: the first part then says what they add up to, and the others follow under the same number. Agents set them up with the plugin's tools ([agent interface](../docs/agent-interface.md)). This is not a handoff: continuing work says where work went next, parts say what one piece of work is made of.

A part's number never changes. Work that existed before it became a part of another work item keeps its old number as a former ID: `work-0047` in an old plan, PR or commit still leads to it. In files and tools the first part is written with the number alone (`work-0032`), as it always was, so everything written before still means what it meant.

A work item can be in several projects, and each of its parts in projects of its own: its plan lists them (`projects`), and without them it is in the project that keeps it. A release of a library and the applications that take it up is one work item of the library's project, with a part in each application's project.

On the hub a work item of several parts is one entry: a row for the whole, with its first part's title and its number (**#0032**), whose turn it is as its most pressing part says, and its parts' steps, agents, time and projects added up; work of one part is a row like any other. Its row comes where its most pressing part is (Your turn before Working, before Waiting, before Later) and is open while any of them is. Under it, its parts are rows of the same table, in their numbers' order, the first included, so their steps, agents and times stand in the table's columns: numbered, with no line between them, each a row like any other, with its state, what it is for, its steps and its agents, and its projects where they are not the group's. Each is a tile of its own, a rounded surface a step quieter than the rows', set in from the table's edges, with a little room between one and the next, so a group's parts read as a list of their own, closed off from the next group's row however many groups follow each other. The group's own row is the colour of every other row of the hub, folded or not, as is the room around its tiles; its title is a weight heavier. A click anywhere on the group's row folds its parts away or shows them again (the chevron before its icon says which way it is; the row is the button, and under the pointer the whole group lights up as a row does, around its tiles too); its number opens its first part, and a click on a part opens the part. Folded, the group says how many parts it has and how many are your turn. A group shows its parts until it is folded and stays as it was left, on this computer. In a hub with such work every row leaves the chevron's room before its icon, so the titles start on one edge. The hub filtered to a project lists the entries with a plan in that project, a group whole. The counts count entries.

**Links to work.** Agents name work in a chat as a link, such as **coord#0046-2 Hub rows say more**: a click opens that plan in Coord. The link is a page of Coord's site (`coord.envsemble.com/open#coord/0046-2`), which hands the address to the installed app; if Coord is closed, it starts on that plan. The first time, the browser asks whether it may open Coord. The link works on the computer that has the project; elsewhere Coord says it has no project of that name. Coord registers itself for these links each time it starts; uninstalling it leaves that registration, and a click then ends in the system's own message.

**A plan's statistics**, from **All statistics and the timeline**, show its figures (agent time, the time at least one agent worked, tokens and sessions), its **Timeline** (a lane per session and subagent with its working stretches and its waits for you; **All**, **Last week** or **Last day**, zoom with Shift and the wheel or the arrow keys, drag to move along; also as a table, folded) and its agent time and tokens **By model and effort**.

## Projects

A **project** is a planning folder in the [Coord home](../docs/command.md#the-coord-home), named by the `name` in its `planning.json`, with the **folders** it covers on its computer, such as your repositories. An agent working in one of them, or in a folder inside one, plans in that project.

Projects are made and managed in the hub's **project menu**, beside the search. It lists **All projects** and every active project, each with its avatar (its initials in a colour of its own), what agents do on it (how many need you or are working), its open plans and when it changed; choosing one shows its plans. For the project chosen it offers:

- **Folders…** shows its planning folder and the folders it covers, and adds (chosen in the file manager) or removes them;
- **Show in Folder** and **Copy Path**, for its planning folder;
- **Rename…** writes the new name into its `planning.json`, where agents read it too;
- **Archive** takes it and its plans out of the hub and the search.

**Archived projects** lists the archived ones; choosing one restores it. Coord never deletes a project; to drop one, remove its folder from the home.

**New Project…** (in the hub's project menu) asks for a name and the project's folders, each chosen in the file manager (the first one names the project until you type a name); a project may have none yet. Coord creates the planning folder in the home from the bundled templates, as a Git repository with a first commit. Agents can create projects too.

## Statistics

Statistics open from the hub (all plans', or the project's when the hub shows one project) and from **Plans › Statistics**. The period is the **Last 4 weeks** (by day), the **Last 3 months** or **All time** (by week). [Progress and statistics](../docs/progress-and-statistics.md) explains what agents report and how Coord counts it.

- **The figures** of the period, each with its change against the period before: agent time (every agent's added up), plans completed, the median time to complete (from acceptance to completion) and the time work waited on you.
- **Work over time:** agent time per day or week, stacked by model and effort (each in a colour of its own, the same wherever Coord shows it), with the time at least one agent worked as a line and the plans completed marked; a bar says on hover what it holds, and the same figures are in a table, folded.
- **Models and effort:** agent time and tokens by model and reasoning effort, with each one's share.

The Coord plugin's hooks record what agent sessions do on a work item: the model and its effort, agent time (subagents included), tokens, and whether the work was being planned or implemented. The reports go into the home database under the project, so they follow the work item when it is archived.

## Diagrams

Diagrams belong to their plan: PlantUML (`.puml`) files in its work folder, usually under `diagrams/`, which the agent writes like any file and Coord only reads. [Diagrams](../docs/diagrams.md) describes the subset Coord reads.

A plan links a diagram with an ordinary Markdown link in its text (`[Order model](diagrams/orders.puml)`); a fragment (`diagrams/orders.puml#Order`) names an element. The link shows inline as the diagram's, in purple with a diagram icon; its tooltip gives the diagram's title and provenance (**Generated from code**, **Generated from database**, **Agent proposal** or **Agent-authored**), and it opens the diagram, at the element it names. Diagrams also open from links, from Files and from the search.

A diagram fills the window below the title bar, with its controls over the canvas: its name, the tools, the views and a proposal's changes. Another diagram opens from the Files tree, the plan's links or Search. A capture, the proposals over it and the later captures compared with it are one diagram with layers, laid out together so switching layers moves nothing: the Files tree lists its layers under its first file, the one shown marked, and `[` and `]` step between them. The plan's breadcrumb stays above the diagram. A proposal, or a capture compared with an earlier one, opens in its change view, with its list of changes beside it. **Understand the model** opens a class diagram's scenarios beside it. Drag an element to arrange the diagram; the arrangement is kept beside it, for all its layers, and **Reset layout** lays it out again. When a file changes, the view updates and keeps its camera and selection; a diagram with problems lists them by line and column instead.

## Pages

A plan's agent can make pages: views in its work folder's `pages/`, such as a choice between layouts or a dashboard of measurements, written in React on envUI. A page opens in place, like a diagram, from the plan's link (shown with the page icon, in teal), from Files (its folder, whose chevron lists its files) or from the search, and fills the window beside Files under the plan's breadcrumb. It updates as the agent changes it. What you choose on a page is saved beside it, and the agent hears of it with your next message. A page that needs you (its agent says so in the page's `page.json`) has an amber dot in Files, on its link and on the folders above it while they are folded, and is listed under the plan's title until the agent clears it. A page that fails shows why in its place. [Pages](../docs/pages.md) says how pages run.

## Settings

**Settings** in the title bar (Ctrl+,) opens Settings in the window at **General**; back and forward step through its sections like other places.

- **General**: the theme, **Match the system**, **Light** or **Dark**, for every window.
- **Agents**, this computer's: **Claude Code** and **Codex**, each with its status (**Connected** with the version of the Coord plugin it has, **Not connected**, or **Not found on this computer** with a link to install it) and **Connect** or **Disconnect**. Coord finds an agent as a program, on the PATH as your terminals have it (read again at start); for one it does not find, **Choose program…** picks its program (`claude`, `codex`; `.exe` or Codex's `.cmd` on Windows), which Coord uses until you **Clear** it. Connecting installs the Coord plugin into the agent with the agent's own commands, which can take a minute; the row shows it, and says why if it fails, with **Try again**. A connected agent's row then says whether it runs Coord: **Ready** with its last session, **Waiting for a first session**, or a warning: **Hooks not trusted** (type `/hooks` in Codex and trust them) or **Coord's hooks aren't running** (a session used Coord's tools, but no hook ran; in Codex, `/hooks` trusts them again). A session that ran the hooks makes it Ready, whatever Codex's configuration says. The hub shows this computer's warnings too, until they are resolved. **Connect by hand**, under each agent, lists the commands that install the plugin, to copy (Connect also grants the agent Coord's home). In a window on another computer, Agents is still this computer's: connecting installs the plugin here.
- **Computers**, both ways of pairing: **Other computers**, the computers this one is paired with, and **Devices that can reach** the window's computer (see [Remote computers](#remote-computers)).

Until it is finished, Coord starts with a short onboarding instead of the window: what Coord is, the agents on this computer (those found are ticked; untick the ones to leave alone, or all of them), connecting them, and how to start: a new session in one of your repositories, asking "What is Coord and how do I use it?", with the warnings above for an agent connected. **Finish** ends it; Settings › Agents connects agents any time.

## Remote computers

**Devices that can reach** this computer, in **Settings › Computers**, lets your other devices work on this computer: choose the address (Tailscale, a local network or only this machine) and the port, then create a five-minute, one-time pairing link with a QR code. A link may grant **Manage access** (pairing and revoking devices). Revoke devices there too. In a window on another computer, the section manages that computer's pairings, when this device has Manage access there.

**Connect to Another Coord…**, under **Other computers** in **Settings › Computers**, pairs with another computer from its link. Then choose it in the computer menu to work on its projects in this window, or open it in a new window from **Other computers**, which also forgets a paired computer. On another computer you can create projects (a name only: their folders are chosen in Coord on that computer), rename them, and archive and restore them (the archive state is this device's). Show in Folder works only on this computer's files. See [remote access](../docs/remote-access.md).

## Staying current

Coord watches the planning folders it shows instead of polling. Changes are collected for a moment and applied together, so an editor's save, a Git checkout or a commit each cause one refresh.

- A **`planning.json` that breaks** keeps the last good view, with the error above it, until the file is readable again.
- A **project whose folder is moved or deleted**, or that cannot be read, says so in place of its page, and shows again when it can.
- A folder that **cannot be watched** (Linux's inotify watch limit, say) is checked every 10 seconds instead, and Coord says so above the page.
- A **window that crashes** reloads, showing what it showed. If it crashes three times within a minute, Coord asks whether to reload it again or close it.

## Security and privacy

The app follows Electron's security checklist:

- The window runs with context isolation and Chromium's sandbox, without Node.js integration, `remote` or `<webview>`, under a strict content security policy: no inline or remote scripts, no `eval`, no network connections. A work item's page runs in a frame on an origin of its own (`coord://page`), which may query the network and reaches Coord only through its window (see [Pages](../docs/pages.md)).
- It talks to the main process only through `window.coord`, a fixed list of messages whose every argument is checked (`shared/validate.ts`). Each window has its own session, whose `coord:` protocol serves the app and only the planning folders of that window's projects.
- Navigation away from the app and new windows are blocked; web links open in the system browser.
- The installed app registers itself with the system for links that name work (`coord://open/<project>/<part>`). It shows the plan such a link names, in a project this computer has, and does nothing for any other address. The site's page that forwards such a link reads it after the `#` of its own address, which browsers never send to a server.
- Commands a page could misuse wait for you. Right after your click, key press or tap in the window, which a page cannot fake, Coord runs one: exiting, opening a window or the logs, turning remote access on or moving it, pairing with another computer, opening a web address in the browser, a link in its application, or a file in your editor. Otherwise it first asks in a system dialog the page cannot answer. Creating a pairing link always asks first.
- Electron fuses turn off running as Node.js and `NODE_OPTIONS`; the `coord` command runs on its own Node.js, which the app ships and copies to the Coord home. The installer and AppImage also turn off `--inspect`, and refuse to start with `--remote-debugging-port`, `--remote-debugging-pipe` or `--inspect`, which would let other programs control the window.
- Planning folders are read by the Coord host in a separate process, which the main process reaches over loopback with a token made at each start; windows never reach it directly.
- No data leaves the computer unless you turn on remote access; then the devices you paired can work on its projects. The one request Coord makes on its own is the update check, which reads the release list and update file of envsemble/coord on GitHub and sends nothing of yours. There is no telemetry or crash upload.

## Diagnostics

**Help › Open Logs** opens `logs/` in the Coord home: `coord.log` (the app: start-up, windows and connections) and `host.log` (the Coord host: folders, the watcher, remote access and pairings), each up to 1 MB with up to three older files. **Help › About Coord** shows the version, the Electron, Chromium and Node.js versions, the system and the Coord home; **Copy Details** copies what a bug report needs, without the home's path.

Coord keeps its own data in the Coord home, `~/.coord` (or `COORD_HOME`), shared with the `coord` command: the planning folders in `planning/`, and the projects' order and state, the windows and their places, the theme, remote access and pairings, and statistics in the home database, `coord.db`. Electron's own files stay in its per-user folder (`%APPDATA%\Coord` on Windows, `~/.config/Coord` on Linux). Coord writes into a planning folder only when you create or rename a project, or change its folders.

## Develop

From the repository root, `npm ci`, then `npm run dev` starts Coord Dev: the app with hot reload, beside your installed Coord, on a copy of your Coord data, with a `dev-` plugin of its own in your agents ([Coord Dev](../CONTRIBUTING.md#coord-dev)); `npm run dev:home` starts it on a demo home instead. `npm run package` builds the installer or AppImage, and `npm run test:e2e` drives it. [Contributing](../CONTRIBUTING.md) covers set-up, the repository layout, the tests and the checks.
