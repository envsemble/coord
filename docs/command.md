# The atlas command

One `atlas` command serves agents, their harnesses and scripts: the planning-state operations (also served over MCP), checks, the harness hooks and setup, plan export and import, work and consultation reports, and the Atlas host. It needs only Node 24.

## Install

From a checkout:

```sh
npm ci
npm link --workspace @envsemble/atlas-cli
atlas --version
atlas setup
```

`npm link` puts `atlas` on the PATH (Windows and Linux) as a link to this checkout, so keep the checkout in place; it always runs the checkout's current code. `npm rm --global @envsemble/atlas-cli` removes it. Inside the checkout, `npx atlas …` works without linking. `atlas setup` then makes Atlas part of every agent session on this computer; see [below](#setup).

On Windows the link is a `.cmd`/`.ps1` shim that only shells can run. An MCP client you configure by hand should start `node <checkout>/packages/cli/bin/atlas.js mcp` instead.

## Commands

```text
atlas where [--cwd <dir>]
atlas work status <work-id> [--planning-dir <dir>]
atlas work create --title <title> [--repo <id>...] [--slug <slug>] [--planning-dir <dir>]
atlas work accept <work-id> [--planning-dir <dir>]
atlas work start <work-id> [--step <title>...] [--planning-dir <dir>]
atlas work step add <work-id> <title>... [--planning-dir <dir>]
atlas work step set <work-id> <title> <todo|doing|done> [--planning-dir <dir>]
atlas work step rename <work-id> <title> <new-title> [--planning-dir <dir>]
atlas work step remove <work-id> <title> --reason <why> [--planning-dir <dir>]
atlas work block <work-id> (<reason> | --clear) [--planning-dir <dir>]
atlas work close <work-id> [--planning-dir <dir>]
atlas work archive <work-id> [--planning-dir <dir>]
atlas work reopen <work-id> --step <title>... [--planning-dir <dir>]
atlas check [<path>...]
atlas home [list]
atlas home adopt <folder> [--name <name>]
atlas mcp
atlas hook <SessionStart|PostToolUse|Stop|SubagentStop>
atlas setup [--dry-run]
atlas planning check <planning-root>
atlas plan export <work-id|work-folder> [--planning-dir <dir>] [--out <file>] [--force]
atlas plan import <file> [--planning-dir <dir>] [--dry-run]
atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--home <dir>]
atlas work report <planning-root> --work <work-id> [--step <title>] [--model <model>] [--session <id>] [--tokens <n>]
atlas serve [--folder <planning-root>]... [--address <ip>] [--port <n>] [--home <dir>]
atlas --version
atlas help
```

### Planning state

These are the operations the [MCP server](agent-interface.md#mcp-tools) offers as tools, called in-process. Each prints the work item's status as JSON (the `where` command prints the planning folders it found), never commits, and exits 0 on success, 1 when the operation is refused (with the reason, and any open items, on stderr) and 2 on usage errors. They use the planning folder given by `--planning-dir`, else the one the current checkout [belongs to](agent-interface.md#how-a-checkout-finds-its-planning-folder).

| Command                | What it does                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas where`          | The planning folders in the Atlas home that this checkout belongs to (by its Git remotes, by an absolute path hint, or by being inside one), with their active work, its steps and anything blocked. `--cwd` asks for another folder.             |
| `atlas work status`    | A work item's plan statuses and dates, ledger steps, `blocked`, and a summary of its statistics.                                                                                                                                                  |
| `atlas work create`    | Registers new work under the next free number: `active/NNNN-<slug>/plan.md` with a draft plan header, and its `planning.json` entry. `--repo` names its repositories; by default, the ones this checkout is.                                      |
| `atlas work accept`    | Records that the design was accepted: `design_status: accepted` and `accepted_at` today. Only a draft can be accepted.                                                                                                                            |
| `atlas work start`     | Starts implementing an accepted plan: `implementation_status: in_progress`, and a new ledger with the given steps (all `todo`) and a Selection naming the plan and the planning folder's Git revision. Warns when the plan has uncommitted edits. |
| `atlas work step …`    | Adds steps, sets one to `todo`, `doing` or `done`, renames one, or removes one with the reason, which goes into the ledger.                                                                                                                       |
| `atlas work block`     | Sets the ledger's `blocked` to the reason, or clears it with `--clear`.                                                                                                                                                                           |
| `atlas work close`     | Closes finished work: refused, with the open items, unless every step is done and nothing is blocked; then the implementation is complete, `completed_at` is today, and the folder moves to `archive/` with its links repaired.                   |
| `atlas work archive`   | Moves a work folder from `active/` to `archive/` without completing it, for abandoned or superseded work.                                                                                                                                         |
| `atlas work reopen`    | Moves archived work back to `active/`, in progress, with the new steps as `todo`.                                                                                                                                                                 |
| `atlas check`          | Checks plans, ledgers, the registry and statistics lines of the files or planning folders given (default: this checkout's). Read-only. Exits 0 when valid, 1 on errors, 2 on usage errors.                                                        |
| `atlas home`           | Prints where the Atlas home is and the planning folders in it.                                                                                                                                                                                    |
| `atlas home adopt`     | Moves an existing planning folder (the top of a Git repository with a `planning.json`) into the home, as `--name` or under its own name. Relative repository paths pointing outside it become absolute.                                           |
| `atlas planning check` | The older check of one planning folder: its registry, plan and ledger headers and work statistics. Read-only; 0 valid, 1 errors, 2 usage errors.                                                                                                  |

### Agents and harnesses

| Command             | What it does                                                                                                                                                                                                                                                            | Exit codes                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `atlas mcp`         | Serves the planning-state operations to an agent harness over stdio. See the [agent interface](agent-interface.md).                                                                                                                                                     | Runs until the client closes it; 2 usage |
| `atlas hook`        | Runs one harness hook on the JSON the harness writes to its stdin; the [plugin](agent-interface.md#hooks) calls it. It never breaks a session: on any failure it prints nothing and notes the failure in the home's `logs/hooks.log`.                                   | Always 0                                 |
| `atlas setup`       | Creates the Atlas home, grants it to Claude Code and Codex, and installs the Atlas plugin into each harness on the PATH. `--dry-run` prints what it would do.                                                                                                           | 0, 1 when a step failed                  |
| `atlas work report` | Records a statistics report for a work item by hand, for agents whose harness runs without the plugin's hooks. Inside Claude Code or Codex it measures the session from its log. See [progress and statistics](progress-and-statistics.md#reporting-without-the-hooks). | 0, or 2 for usage errors                 |
| `atlas usage log`   | Records which planning documents an agent consulted, for the app's Document use statistics. Never fails the task: gaps are reported on stderr.                                                                                                                          | 0, or 2 for usage errors                 |

### Sharing and serving

| Command             | What it does                                                                                                                                                                                                                                      | Exit codes                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas plan export` | Writes a whole work item to one self-contained `.atlas-plan.html` file (by default `<slug>-<work-id>.atlas-plan.html` in the current folder; an existing file needs `--force`). See [plan export](plan-export.md).                                | 0, 1 when the export fails (an unknown work item, an existing file without `--force`, a refused folder), 2 usage errors                                           |
| `atlas plan import` | Previews an export, then adds it as new work under the next free number and registers it, without committing; `--dry-run` only previews.                                                                                                          | 0, 1 invalid export or refused folder, 2 usage errors                                                                                                             |
| `atlas serve`       | Runs the Atlas host without the desktop app, so paired devices can work on this computer's planning folders; `--folder` adds folders to its folder list. It prints a one-time pairing link with a QR code. See [remote access](remote-access.md). | Runs until stopped; 1 when it cannot start (no Tailscale address without `--address`, the app already manages remote access, or it cannot listen), 2 usage errors |

`plan export` and `plan import` use the planning folder given by `--planning-dir`, else the current folder.

## Setup

`atlas setup` makes Atlas part of every agent session on this computer, and changes nothing when run again:

1. It creates the [Atlas home](#the-atlas-home), moving Atlas's files from the old data folder into it.
2. It grants the home to **Claude Code** (`permissions.additionalDirectories` in its `settings.json`) and **Codex** (`[sandbox_workspace_write] writable_roots` in its `config.toml`), so agents in any checkout or worktree can edit planning files there. It changes only that entry and keeps the rest of each file as it is.
3. For each harness on the PATH, it adds this checkout as the `atlas` plugin marketplace and installs the `atlas@atlas` plugin through the harness's own commands.

A harness that is neither on the PATH nor configured is skipped. `HOME` (`USERPROFILE` on Windows), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `PATH` choose what it touches. Start a new agent session afterwards to load the plugin.

## The Atlas home

The **Atlas home** is `~/.atlas`, or `ATLAS_HOME` when set (`--home` for `usage log` and `serve`). It holds:

- `planning/<name>/`: the planning folders, each its own Git repository;
- `sessions/`: which work items each agent session has touched, for the hooks;
- `usage/`: document-use statistics, per planning folder under a hash of its canonical path;
- `host/`, `connections.json`, `planning-roots.json` and `desktop-state.json`: the host's identity, folder list and pairings, the app's connections, recent folders and window layout;
- `logs/`: the app's, the host's and the hooks' logs.

Atlas used to keep these files in a per-user data folder (`%APPDATA%\Atlas` on Windows, `${XDG_CONFIG_HOME:-~/.config}/Atlas` on Linux). The first time Atlas runs with the default home, it moves them into the home, never overwriting anything; Electron's own caches stay in that folder.

Work statistics are not in the home: they belong to the work, as `<work>/.atlas/statistics.jsonl` in its planning folder.
