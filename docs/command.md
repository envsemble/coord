# The atlas command

One `atlas` command serves agents, their harnesses and scripts: the planning-state operations (also served over MCP), checks, diagram captures, the harness hooks and setup, work reports, and the Atlas host. It needs only Node 24.

## Install

The app installs the command: it carries it, copies it to `agent/` in the [Atlas home](#the-atlas-home) and, on its first start, puts `agent/bin` on your PATH (the user `Path` on Windows, a link in `~/.local/bin` on Linux). There `atlas` runs on a Node.js the app ships with it, so it needs no Node.js of yours. Uninstalling the app on Windows takes it off the PATH again and disconnects the agents it connected. See [the app](../app/README.md#install).

From a checkout, for working on Atlas:

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
atlas work create --title <title> [--summary <text>] [--slug <slug>] [--continues <work>...] [--tag <tag>...] [--part-of <work-id>] [--planning-dir <dir>]
atlas work state <work-id> <planning|working|waiting|your_turn|blocked|none> [<note>] [--planning-dir <dir>]
atlas work search [<word>...] [--tag <tag>...] [--status open|closed|all] [--planning-dir <dir>]
atlas work update <work-id> [--add-tag <tag>...] [--remove-tag <tag>...] [--continues <work>... | --no-continues] [--parts <work-id>... | --no-parts] [--planning-dir <dir>]
atlas work accept <work-id> [--planning-dir <dir>]
atlas work start <work-id> [--step <title>...] [--planning-dir <dir>]
atlas work step add <work-id> <title>... [--planning-dir <dir>]
atlas work step propose <work-id> [<title>...] [--planning-dir <dir>]
atlas work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
atlas work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
atlas work step remove <work-id> <title> [--planning-dir <dir>]
atlas work close <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
atlas work reopen <work-id> --step <title>... [--planning-dir <dir>]
atlas check [<path>...]
atlas home [list]
atlas capture <source.json> (--work <work-id> | --out <file>) [--name <name>] [--compares <capture.puml>] [--force] [--planning-dir <dir>]
atlas mcp
atlas hook <SessionStart|UserPromptSubmit|PageChoices|PostToolUse|ToolUse|Stop|StopFailure|Interrupt|SubagentStop|SessionEnd>
atlas setup [--dry-run]
atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
atlas serve [--address <ip>] [--port <n>] [--home <dir>]
atlas --version
atlas help
```

### Planning state

These are the operations the [MCP server](agent-interface.md#mcp-tools) offers as tools, called in-process, with `atlas check`, `atlas home` and `atlas capture`, which have no tool. Each work command prints the work item's status as JSON (the `where` command prints the projects it found), never commits, and exits 0 on success, 1 when the operation is refused (with the reason, and any open items, on stderr) and 2 on usage errors. They use the planning folder given by `--planning-dir`, else the one the current folder [belongs to](agent-interface.md#how-a-checkout-finds-its-planning-folder).

| Command                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas where`          | The projects in the Atlas home that this folder belongs to (by being in one of their folders, the deepest winning, or inside the planning folder), each with its name, planning folder, active work, steps and anything blocked (`matches`), and every active project in the home in brief (`projects`: its name, planning folder, folders and whether it matches, with the active work, as titles, summaries and states, of those that don't match). It works outside a Git checkout too. `--cwd` asks for another folder.                                                                                          |
| `atlas work status`    | A work item's plan statuses and dates, ledger steps, `blocked`, and a summary of its statistics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `atlas project create` | Creates a project in the home, as the app does: a planning folder from the bundled templates, as its own Git repository with a first commit, covering the `--folder` folders (relative ones are resolved from the current folder; none is fine). Prints its name, planning folder and folders, as JSON with `--json`. A missing folder is refused.                                                                                                                                                                                                                                                                   |
| `atlas work create`    | Registers new work under the next free number: `active/NNNN-<slug>/plan.md` with a draft plan header (with `--summary`, two or three sentences on what the work is, why and where it stands), its ledger with the planning steps, and its `planning.json` entry. `--tag` gives its first tags; `--part-of` names the work item of this project it is a part of, and it becomes the last of that group's parts.                                                                                                                                                                                                       |
| `atlas work state`     | Says whose turn the work is: the plan's `state` with its note and when it was set (`none` declares none). `waiting`, `your_turn` and `blocked` need a note; `blocked` becomes the ledger's `blocked`, and any other state clears it. See [Whose turn it is](agent-interface.md#whose-turn-it-is).                                                                                                                                                                                                                                                                                                                    |
| `atlas work search`    | Lists the project's work items, archived ones included, with every `--tag` and every word given in their number, title, summary or tags; `--status open` or `closed` keeps the active or the archived ones.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `atlas work update`    | Adds (`--add-tag`) and removes (`--remove-tag`) a work item's tags, printing its tags and the project's with their counts; sets the work it continues (`--continues`, [handoffs](agent-interface.md#handoffs), or `--no-continues`) and its parts in order (`--parts`, [parts](agent-interface.md#parts), or `--no-parts`).                                                                                                                                                                                                                                                                                          |
| `atlas work accept`    | Records that the design was accepted: `design_status: accepted` and `accepted_at` today, and every planning step done. Only a draft can be accepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `atlas work start`     | Starts implementing an accepted plan: `implementation_status: in_progress`, the given steps (at least one, all `todo`) after the ledger's planning steps, in place of the proposed ones; without `--step`, the proposed steps become them.                                                                                                                                                                                                                                                                                                                                                                           |
| `atlas work step …`    | Adds steps (planning steps before implementation starts, implementation steps after), proposes the plan's implementation steps while it is designed (replacing the proposed ones; none removes them), sets one to `todo`, `doing` or `done`, renames one, or removes one.                                                                                                                                                                                                                                                                                                                                            |
| `atlas work close`     | Closes the work and moves its folder to `archive/`: as complete (refused with the open items unless every step is done and nothing is blocked), as `--abandoned` with `--reason`, which goes into the plan's Outcome, or as superseded by `--superseded-by` (with an optional `--reason`). Closed work declares no state.                                                                                                                                                                                                                                                                                            |
| `atlas work reopen`    | Moves archived work back to `active/`, in progress, with the new steps as `todo`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `atlas check`          | Checks plans, ledgers, diagrams and the registry of the files or planning folders given (default: this folder's), including that every work item has its ledger, that plan headers have no unknown fields and that archived work is complete, superseded or abandoned rather than left open, and warns about active plans without a `summary`, diagrams no document links, tables in active plans that read cramped in the app or whose rows a blank line cut off, and [handoffs](agent-interface.md#handoffs) that name no work item or form a loop. Read-only. Exits 0 when valid, 1 on errors, 2 on usage errors. |
| `atlas home`           | Prints where the Atlas home is and its projects: each one's name and planning folder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `atlas capture`        | Captures code or a database as a source configuration file describes and writes the diagram into the work item's `diagrams/` (or to `--out`); see [diagrams](diagrams.md#captures). Prints the capture's summary as JSON.                                                                                                                                                                                                                                                                                                                                                                                            |

### Agents and harnesses

| Command             | What it does                                                                                                                                                                                                                                                                                                  | Exit codes                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `atlas mcp`         | Serves the planning-state operations to an agent harness over stdio. See the [agent interface](agent-interface.md).                                                                                                                                                                                           | Runs until the client closes it; 2 usage |
| `atlas hook`        | Runs one harness hook on the JSON the harness writes to its stdin; the [plugin](agent-interface.md#hooks) calls it, from `hooks/hooks.json` in Claude Code and `hooks/codex.json` in Codex. It never breaks a session: on any failure it prints nothing and notes the failure in the home's `logs/hooks.log`. | Always 0                                 |
| `atlas setup`       | Creates the Atlas home, grants it to Claude Code and Codex, and installs the Atlas plugin into each harness on the PATH. `--dry-run` prints what it would do.                                                                                                                                                 | 0, 1 when a step failed                  |
| `atlas work report` | Records a statistics report for a work item by hand, for agents whose harness runs without the plugin's hooks. Inside Claude Code or Codex it measures the session from its log. See [progress and statistics](progress-and-statistics.md#reporting-without-the-hooks).                                       | 0, or 2 for usage errors                 |

### Serving

| Command       | What it does                                                                                                                                                                                  | Exit codes                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas serve` | Runs the Atlas host without the desktop app, so paired devices can work on this computer's projects. It prints a one-time pairing link with a QR code. See [remote access](remote-access.md). | Runs until stopped; 1 when it cannot start (no Tailscale address without `--address`, the app already manages remote access, or it cannot listen), 2 usage errors |

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
