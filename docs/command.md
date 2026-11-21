# The coord command

One `coord` command serves agents, their harnesses and scripts: the planning-state operations (also served over MCP), checks, diagram captures, the harness hooks and setup, work reports, and the Coord host. It needs only Node 24.

## Install

The app installs the command: it carries it, copies it to `agent/` in the [Coord home](#the-coord-home) and, on its first start, puts `agent/bin` on your PATH (the user `Path` on Windows, a link in `~/.local/bin` on Linux). There `coord` runs on a Node.js the app ships with it, so it needs no Node.js of yours. Uninstalling the app on Windows takes it off the PATH again and disconnects the agents it connected. See [the app](../app/README.md#install).

From a checkout, for working on Coord:

```sh
npm ci
npm link --workspace @envsemble/coord
coord --version
coord setup
```

`npm link` puts `coord` on the PATH (Windows and Linux) as a link to this checkout, so keep the checkout in place; it always runs the checkout's current code. `npm rm --global @envsemble/coord` removes it. Inside the checkout, `npx coord …` works without linking. `coord setup` then makes Coord part of every agent session on this computer; see [below](#setup).

On Windows the link is a `.cmd`/`.ps1` shim that only shells can run. An MCP client you configure by hand should start `node <checkout>/packages/coord/bin/coord.js mcp` instead.

## Commands

```text
coord where [--cwd <dir>]
coord project create --name <name> [--folder <folder>...] [--json]
coord work status <work-id> [--planning-dir <dir>]
coord work create --title <title> [--summary <text>] [--slug <slug>] [--continues <work>...] [--tag <tag>...] [--part-of <work-id>] [--project <name>...] [--planning-dir <dir>]
coord work state <work-id> <planning|working|waiting|your_turn|blocked|none> [<note>] [--planning-dir <dir>]
coord work search [<word>...] [--tag <tag>...] [--status open|closed|all] [--planning-dir <dir>]
coord work update <work-id> [--add-tag <tag>...] [--remove-tag <tag>...] [--continues <work>... | --no-continues] [--part-of <work-id>] [--project <name>... | --no-projects] [--planning-dir <dir>]
coord work accept <work-id> [--planning-dir <dir>]
coord work start <work-id> [--step <title>...] [--planning-dir <dir>]
coord work step add <work-id> <title>... [--planning-dir <dir>]
coord work step propose <work-id> [<title>...] [--planning-dir <dir>]
coord work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
coord work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
coord work step remove <work-id> <title> [--planning-dir <dir>]
coord work close <work-id> [--superseded-by <work-id> | --abandoned] [--reason <why>] [--planning-dir <dir>]
coord work reopen <work-id> --step <title>... [--planning-dir <dir>]
coord check [<path>...]
coord home [list]
coord capture <source.json> (--work <work-id> | --out <file>) [--name <name>] [--compares <capture.puml>] [--force] [--planning-dir <dir>]
coord mcp
coord hook <SessionStart|UserPromptSubmit|PageChoices|PostToolUse|ToolUse|Stop|StopFailure|Interrupt|SubagentStop|SessionEnd>
coord setup [--dry-run]
coord work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
coord serve [--address <ip>] [--port <n>] [--home <dir>]
coord --version
coord help
```

### Planning state

These are the operations the [MCP server](agent-interface.md#mcp-tools) offers as tools, called in-process, with `coord check`, `coord home` and `coord capture`, which have no tool. Each work command prints the work item's status as JSON (the `where` command prints the projects it found), never commits, and exits 0 on success, 1 when the operation is refused (with the reason, and any open items, on stderr) and 2 on usage errors. They use the planning folder given by `--planning-dir`, else the one the current folder [belongs to](agent-interface.md#how-a-checkout-finds-its-planning-folder).

| Command                | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coord where`          | The projects in the Coord home that this folder belongs to (by being in one of their folders, the deepest winning, or inside the planning folder), each with its name, planning folder, active work, steps and anything blocked (`matches`), and every active project in the home in brief (`projects`: its name, planning folder, folders and whether it matches, with the active work, as titles, summaries and states, of those that don't match). It works outside a Git checkout too. `--cwd` asks for another folder.                                                                                          |
| `coord work status`    | A work item's plan statuses and dates, ledger steps, `blocked`, and a summary of its statistics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `coord project create` | Creates a project in the home, as the app does: a planning folder from the bundled templates, as its own Git repository with a first commit, covering the `--folder` folders (relative ones are resolved from the current folder; none is fine). Prints its name, planning folder and folders, as JSON with `--json`. A missing folder is refused.                                                                                                                                                                                                                                                                   |
| `coord work create`    | Registers new work under the next free number: `active/NNNN-<slug>/plan.md` with a draft plan header (with `--summary`, two or three sentences on what the work is, why and where it stands), its ledger with the planning steps, and its `planning.json` entry. `--tag` gives its first tags; `--part-of` names the work item of this project it is a part of, by any of its parts: it becomes that work item's next part (`work-0034-3`).                                                                                                                                                                          |
| `coord work state`     | Says whose turn the work is: the plan's `state` with its note and when it was set (`none` declares none). `waiting`, `your_turn` and `blocked` need a note; `blocked` becomes the ledger's `blocked`, and any other state clears it. See [Whose turn it is](agent-interface.md#whose-turn-it-is).                                                                                                                                                                                                                                                                                                                    |
| `coord work search`    | Lists the project's work items, archived ones included, with every `--tag` and every word given in their number, title, summary or tags; `--status open` or `closed` keeps the active or the archived ones.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `coord work update`    | Adds (`--add-tag`) and removes (`--remove-tag`) a work item's tags, printing its tags and the project's with their counts; sets the work it continues (`--continues`, [handoffs](agent-interface.md#handoffs), or `--no-continues`) and the work item it becomes a part of (`--part-of`, [parts](agent-interface.md#parts)): it takes that work item's number, and its old ID still names it.                                                                                                                                                                                                                        |
| `coord work accept`    | Records that the design was accepted: `design_status: accepted` and `accepted_at` today, and every planning step done. Only a draft can be accepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `coord work start`     | Starts implementing an accepted plan: `implementation_status: in_progress`, the given steps (at least one, all `todo`) after the ledger's planning steps, in place of the proposed ones; without `--step`, the proposed steps become them.                                                                                                                                                                                                                                                                                                                                                                           |
| `coord work step …`    | Adds steps (planning steps before implementation starts, implementation steps after), proposes the plan's implementation steps while it is designed (replacing the proposed ones; none removes them), sets one to `todo`, `doing` or `done`, renames one, or removes one.                                                                                                                                                                                                                                                                                                                                            |
| `coord work close`     | Closes the work and moves its folder to `archive/`: as complete (refused with the open items unless every step is done and nothing is blocked), as `--abandoned` with `--reason`, which goes into the plan's Outcome, or as superseded by `--superseded-by` (with an optional `--reason`). Closed work declares no state.                                                                                                                                                                                                                                                                                            |
| `coord work reopen`    | Moves archived work back to `active/`, in progress, with the new steps as `todo`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `coord check`          | Checks plans, ledgers, diagrams and the registry of the files or planning folders given (default: this folder's), including that every work item has its ledger, that plan headers have no unknown fields and that archived work is complete, superseded or abandoned rather than left open, and warns about active plans without a `summary`, diagrams no document links, tables in active plans that read cramped in the app or whose rows a blank line cut off, and [handoffs](agent-interface.md#handoffs) that name no work item or form a loop. Read-only. Exits 0 when valid, 1 on errors, 2 on usage errors. |
| `coord home`           | Prints where the Coord home is and its projects: each one's name and planning folder.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `coord capture`        | Captures code or a database as a source configuration file describes and writes the diagram into the work item's `diagrams/` (or to `--out`); see [diagrams](diagrams.md#captures). Prints the capture's summary as JSON.                                                                                                                                                                                                                                                                                                                                                                                            |

### Agents and harnesses

| Command             | What it does                                                                                                                                                                                                                                                                                                  | Exit codes                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `coord mcp`         | Serves the planning-state operations to an agent harness over stdio. See the [agent interface](agent-interface.md).                                                                                                                                                                                           | Runs until the client closes it; 2 usage |
| `coord hook`        | Runs one harness hook on the JSON the harness writes to its stdin; the [plugin](agent-interface.md#hooks) calls it, from `hooks/hooks.json` in Claude Code and `hooks/codex.json` in Codex. It never breaks a session: on any failure it prints nothing and notes the failure in the home's `logs/hooks.log`. | Always 0                                 |
| `coord setup`       | Creates the Coord home, grants it to Claude Code and Codex, and installs the Coord plugin into each harness on the PATH. `--dry-run` prints what it would do.                                                                                                                                                 | 0, 1 when a step failed                  |
| `coord work report` | Records a statistics report for a work item by hand, for agents whose harness runs without the plugin's hooks. Inside Claude Code or Codex it measures the session from its log. See [progress and statistics](progress-and-statistics.md#reporting-without-the-hooks).                                       | 0, or 2 for usage errors                 |

### Serving

| Command       | What it does                                                                                                                                                                                  | Exit codes                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coord serve` | Runs the Coord host without the desktop app, so paired devices can work on this computer's projects. It prints a one-time pairing link with a QR code. See [remote access](remote-access.md). | Runs until stopped; 1 when it cannot start (no Tailscale address without `--address`, the app already manages remote access, or it cannot listen), 2 usage errors |

## Setup

`coord setup` makes Coord part of every agent session on this computer, and changes nothing when run again:

1. It creates the [Coord home](#the-coord-home) and its database.
2. It grants the home to **Claude Code** (`permissions.additionalDirectories` in its `settings.json`) and **Codex** (`[sandbox_workspace_write] writable_roots` in its `config.toml`, or `sandbox_workspace_write.writable_roots` where that table is written as dotted keys), so agents in any checkout or worktree can edit planning files there. It edits only that list, or adds the key, and leaves the rest of each file's text as it was.
3. For each harness on the PATH, it adds this checkout as the `coord` plugin marketplace and installs the `coord@coord` plugin through the harness's own commands. Claude Code reads the plugin from the checkout in place. Codex installs a copy, so run `coord setup` again after updating the checkout to refresh it; a Codex marketplace named `coord` added from another checkout is replaced by this one.

A harness that is neither on the PATH nor configured is skipped. `HOME` (`USERPROFILE` on Windows), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `PATH` choose what it touches. Start a new agent session afterwards to load the plugin.

## The Coord home

The **Coord home** is `~/.coord`, or `COORD_HOME` when set (`--home` for `serve`). It holds:

- `planning/<name>/`: the planning folders, each its own Git repository and each a project;
- `coord.db`: the home database (SQLite), with everything else Coord keeps: the projects (their names, order and whether they are archived, and the projects of paired computers), the host's identity and paired devices, the computers the app paired with, its windows and the places they show, which work items each agent session has touched and when it last did, whether its agent is in a turn or waits for you (the work's Working and Needs you), its waits and the commits and PRs it made, and work statistics reports;
- `logs/`: the app's, the host's and the hooks' logs;
- `session-state/`: a small stamp file per agent session, which lets most [hooks](agent-interface.md#hooks) finish without opening the database;
- `cache/session-logs/`: how far each session log has been measured, so the next report reads only what was added.

The hooks remove stamps and log cursors not used for a week.

Every process opens the database as it needs it, so the app, the host, the CLI and the hooks share it. It holds secrets (the host's, paired devices' token hashes, the app's tokens for the computers it paired with), so on macOS and Linux the home is created readable by you only and the database file is created at 0600. Its schema has a version (11): Coord gives a new database the schema and refuses a database of any other version, without changing it; move such a file aside to start afresh.
