# The atlas command

One `atlas` command serves agents, their harnesses and scripts: the planning-state operations (also served over MCP), checks, diagram captures, the harness hooks and setup, plan export and import, work reports, and the Atlas host. It needs only Node 24.

## Install

From a checkout:

```sh
npm ci
npm link --workspace @envsemble/atlas
atlas --version
atlas setup
```

`npm link` puts `atlas` on the PATH (Windows and Linux) as a link to this checkout, so keep the checkout in place; it always runs the checkout's current code. `npm rm --global @envsemble/atlas` removes it. Inside the checkout, `npx atlas …` works without linking. `atlas setup` then makes Atlas part of every agent session on this computer; see [below](#setup).

On Windows the link is a `.cmd`/`.ps1` shim that only shells can run. An MCP client you configure by hand should start `node <checkout>/packages/atlas/bin/atlas.js mcp` instead.

## Commands

```text
atlas where [--cwd <dir>]
atlas project create --name <name> [--folder <folder>...] [--json]
atlas work status <work-id> [--planning-dir <dir>]
atlas work create --title <title> [--summary <text>] [--slug <slug>] [--continues <work>...] [--planning-dir <dir>]
atlas work continue <work-id> [<work>...] [--planning-dir <dir>]
atlas work accept <work-id> [--planning-dir <dir>]
atlas work start <work-id> --step <title>... [--planning-dir <dir>]
atlas work step add <work-id> <title>... [--planning-dir <dir>]
atlas work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
atlas work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
atlas work step remove <work-id> <title> [--planning-dir <dir>]
atlas work block <work-id> (<reason> | --clear) [--planning-dir <dir>]
atlas work close <work-id> [--planning-dir <dir>]
atlas work archive <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
atlas work reopen <work-id> --step <title>... [--planning-dir <dir>]
atlas check [<path>...]
atlas home [list]
atlas capture <source.json> (--work <work-id> | --out <file>) [--name <name>] [--compares <capture.puml>] [--force] [--planning-dir <dir>]
atlas mcp
atlas hook <SessionStart|UserPromptSubmit|PostToolUse|ToolUse|Notification|PermissionRequest|Stop|StopFailure|Interrupt|SubagentStart|SubagentStop|SessionEnd>
atlas setup [--dry-run]
atlas plan export <work-id|work-folder> [--planning-dir <dir>] [--out <file>] [--force]
atlas plan import <file> [--planning-dir <dir>] [--dry-run]
atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
atlas serve [--address <ip>] [--port <n>] [--home <dir>]
atlas --version
atlas help
```

### Planning state

These are the operations the [MCP server](agent-interface.md#mcp-tools) offers as tools, called in-process, with `atlas check`, `atlas home` and `atlas capture`, which have no tool. Each work command prints the work item's status as JSON (the `where` command prints the projects it found), never commits, and exits 0 on success, 1 when the operation is refused (with the reason, and any open items, on stderr) and 2 on usage errors. They use the planning folder given by `--planning-dir`, else the one the current folder [belongs to](agent-interface.md#how-a-checkout-finds-its-planning-folder).

| Command                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas where`          | The projects in the Atlas home that this folder belongs to (by being in one of their folders, the deepest winning, or inside the planning folder), each with its name, planning folder, active work, steps and anything blocked (`matches`), and every active project in the home in brief (`projects`: its name, planning folder, folders, active work as titles, summaries and states, and whether it matches). It works outside a Git checkout too. `--cwd` asks for another folder.                                      |
| `atlas work status`    | A work item's plan statuses and dates, ledger steps, `blocked`, and a summary of its statistics.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `atlas project create` | Creates a project in the home, as the app does: a planning folder from the bundled templates, as its own Git repository with a first commit, covering the `--folder` folders (relative ones are resolved from the current folder; none is fine). Prints its name, planning folder and folders, as JSON with `--json`. A missing folder is refused.                                                                                                                                                                           |
| `atlas work create`    | Registers new work under the next free number: `active/NNNN-<slug>/plan.md` with a draft plan header (with `--summary`, two or three sentences on what the work is, why and where it stands), its ledger with the planning steps, and its `planning.json` entry.                                                                                                                                                                                                                                                             |
| `atlas work continue`  | Records the work a work item continues, its plan's `continues` ([handoffs](agent-interface.md#handoffs)): `work-0023` in the same project, `project:work-0023` in another project of the home by its planning folder's name. Each must be a registered work item other than itself, and not one that continues it; each is written once, as it resolves. None clears it. `atlas work create --continues` records it for new work.                                                                                            |
| `atlas work accept`    | Records that the design was accepted: `design_status: accepted` and `accepted_at` today, and every planning step done. Only a draft can be accepted.                                                                                                                                                                                                                                                                                                                                                                         |
| `atlas work start`     | Starts implementing an accepted plan: `implementation_status: in_progress`, the given steps (at least one, all `todo`) after the ledger's planning steps.                                                                                                                                                                                                                                                                                                                                                                    |
| `atlas work step …`    | Adds steps (planning steps before implementation starts, implementation steps after), sets one to `todo`, `doing` or `done`, renames one, or removes one.                                                                                                                                                                                                                                                                                                                                                                    |
| `atlas work block`     | Sets the ledger's `blocked` to the reason, or clears it with `--clear`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `atlas work close`     | Closes finished work: refused, with the open items, unless its ledger has implementation steps, every step done, and nothing is blocked; then the implementation is complete, `completed_at` is today, and the folder moves to `archive/` with its links repaired.                                                                                                                                                                                                                                                           |
| `atlas work archive`   | Moves a work folder from `active/` to `archive/` without closing it. Work that is not complete needs a disposition: `--superseded-by` the work that replaces it, or `--abandoned` with `--reason`; `--reason` goes only with one of them. It becomes the plan's `design_status` (and `superseded_by`), and the reason goes into the plan's Outcome.                                                                                                                                                                          |
| `atlas work reopen`    | Moves archived work back to `active/`, in progress, with the new steps as `todo`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `atlas check`          | Checks plans, ledgers, diagrams and the registry of the files or planning folders given (default: this folder's), including that every work item has its ledger, that plan headers have no unknown fields and that archived work is complete, superseded or abandoned rather than left open, and warns about active plans without a `summary`, diagrams no document links, and [handoffs](agent-interface.md#handoffs) that name no work item or form a loop. Read-only. Exits 0 when valid, 1 on errors, 2 on usage errors. |
| `atlas home`           | Prints where the Atlas home is and its projects: each one's name and planning folder.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `atlas capture`        | Captures code or a database as a source configuration file describes and writes the diagram into the work item's `diagrams/` (or to `--out`); see [diagrams](diagrams.md#captures). Prints the capture's summary as JSON.                                                                                                                                                                                                                                                                                                    |

### Agents and harnesses

| Command             | What it does                                                                                                                                                                                                                                                                                                  | Exit codes                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `atlas mcp`         | Serves the planning-state operations to an agent harness over stdio. See the [agent interface](agent-interface.md).                                                                                                                                                                                           | Runs until the client closes it; 2 usage |
| `atlas hook`        | Runs one harness hook on the JSON the harness writes to its stdin; the [plugin](agent-interface.md#hooks) calls it, from `hooks/hooks.json` in Claude Code and `hooks/codex.json` in Codex. It never breaks a session: on any failure it prints nothing and notes the failure in the home's `logs/hooks.log`. | Always 0                                 |
| `atlas setup`       | Creates the Atlas home, grants it to Claude Code and Codex, and installs the Atlas plugin into each harness on the PATH. `--dry-run` prints what it would do.                                                                                                                                                 | 0, 1 when a step failed                  |
| `atlas work report` | Records a statistics report for a work item by hand, for agents whose harness runs without the plugin's hooks. Inside Claude Code or Codex it measures the session from its log. See [progress and statistics](progress-and-statistics.md#reporting-without-the-hooks).                                       | 0, or 2 for usage errors                 |

### Sharing and serving

| Command             | What it does                                                                                                                                                                                                       | Exit codes                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas plan export` | Writes a whole work item to one self-contained `.atlas-plan.html` file (by default `<slug>-<work-id>.atlas-plan.html` in the current folder; an existing file needs `--force`). See [plan export](plan-export.md). | 0, 1 when the export fails (an unknown work item, an existing file without `--force`, a refused folder), 2 usage errors                                           |
| `atlas plan import` | Previews an export, then adds it as new work under the next free number and registers it, without committing; `--dry-run` only previews.                                                                           | 0, 1 invalid export or refused folder, 2 usage errors                                                                                                             |
| `atlas serve`       | Runs the Atlas host without the desktop app, so paired devices can work on this computer's projects. It prints a one-time pairing link with a QR code. See [remote access](remote-access.md).                      | Runs until stopped; 1 when it cannot start (no Tailscale address without `--address`, the app already manages remote access, or it cannot listen), 2 usage errors |

`plan export` and `plan import` use the planning folder given by `--planning-dir`, else the current folder.

## Setup

`atlas setup` makes Atlas part of every agent session on this computer, and changes nothing when run again:

1. It creates the [Atlas home](#the-atlas-home) and its database.
2. It grants the home to **Claude Code** (`permissions.additionalDirectories` in its `settings.json`) and **Codex** (`[sandbox_workspace_write] writable_roots` in its `config.toml`, or `sandbox_workspace_write.writable_roots` where that table is written as dotted keys), so agents in any checkout or worktree can edit planning files there. It edits only that list, or adds the key, and leaves the rest of each file's text as it was.
3. For each harness on the PATH, it adds this checkout as the `atlas` plugin marketplace and installs the `atlas@atlas` plugin through the harness's own commands. Claude Code reads the plugin from the checkout in place. Codex installs a copy, so run `atlas setup` again after updating the checkout to refresh it; a Codex marketplace named `atlas` added from another checkout is replaced by this one.

A harness that is neither on the PATH nor configured is skipped. `HOME` (`USERPROFILE` on Windows), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `PATH` choose what it touches. Start a new agent session afterwards to load the plugin.

## The Atlas home

The **Atlas home** is `~/.atlas`, or `ATLAS_HOME` when set (`--home` for `serve`). It holds:

- `planning/<name>/`: the planning folders, each its own Git repository and each a project;
- `atlas.db`: the home database (SQLite), with everything else Atlas keeps: the projects (their names, order and whether they are archived, and the projects of paired computers), the host's identity and paired devices, the computers the app paired with, its windows and the places they show, which work items each agent session has touched and when it last did, whether its agent is in a turn or waits for you (the work's Working and Needs you), its waits and the commits and PRs it made, and work statistics reports;
- `logs/`: the app's, the host's and the hooks' logs;
- `session-state/`: a small stamp file per agent session, which lets most [hooks](agent-interface.md#hooks) finish without opening the database;
- `cache/session-logs/`: how far each session log has been measured, so the next report reads only what was added.

The hooks remove stamps and log cursors not used for a week.

Every process opens the database as it needs it, so the app, the host, the CLI and the hooks share it. It holds secrets (the host's, paired devices' token hashes, the app's tokens for the computers it paired with), so on macOS and Linux the home is created readable by you only and the database file is created at 0600. Its schema has a version (11): Atlas gives a new database the schema and refuses a database of any other version, without changing it; move such a file aside to start afresh.
