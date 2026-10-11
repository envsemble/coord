# The atlas command

One `atlas` command serves agents and scripts: model tools and the MCP server, planning checks, plan export and import, consultation and work reports, and the Atlas host. It needs only Node 24.

## Install

From a checkout:

```sh
npm ci
npm link --workspace @envsemble/atlas-cli
atlas --version
```

`npm link` puts `atlas` on the PATH (Windows and Linux) as a link to this checkout, so keep the checkout in place; it always runs the checkout's current code. `npm rm --global @envsemble/atlas-cli` removes it. Inside the checkout, `npx atlas …` works without linking.

On Windows the link is a `.cmd`/`.ps1` shim that only shells can run. Configure MCP clients with `node <checkout>/packages/cli/bin/atlas.js mcp --root <workspace>` instead (see the [agent interface](agent-interface.md)).

## Commands

```text
atlas model <operation> --root <workspace> [--input <request.json|->]
atlas model review --input <request.json|->
atlas model tools
atlas model job <init|validate|build> ...
atlas mcp --root <workspace>
atlas planning check <planning-root>
atlas plan export <work-id|work-folder> [--planning-dir <dir>] [--out <file>] [--force]
atlas plan import <file> [--planning-dir <dir>] [--dry-run]
atlas usage log <planning-root> --files <path>... [--task <id>] [--session <id>] [--data-dir <dir>]
atlas work report <planning-root> --work <work-id> --model <model> [--tokens <n>] [--session <id>] [--step <title>]
atlas serve [--folder <planning-root>]... [--address <ip>] [--port <n>] [--data-dir <dir>]
atlas --version
atlas help
```

| Command                | What it does                                                                                                                                                                                                         | Exit codes                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atlas model …`        | Captures, creates, imports, inspects, revises, validates, compares, merges and exports models as JSON requests and responses. `atlas model tools` prints the schemas. See the [agent interface](agent-interface.md). | 0 success, 1 blocking findings, 2 input failures                                                                                                                  |
| `atlas model review`   | Builds an offline architecture review of model changes between two revisions. See [PR/MR review](review-ci.md).                                                                                                      | 0, 1 blocking findings (the review is still written), 2 input failures                                                                                            |
| `atlas model job`      | Sets up a modeling job for a coding agent (`init`), checks the agent's model (`validate`) and builds its offline site (`build`).                                                                                     | 0, 1 when `validate` finds errors, 2 input failures                                                                                                               |
| `atlas mcp`            | The same model operations as a stdio MCP server.                                                                                                                                                                     | Runs until the client closes it; 2 input failures                                                                                                                 |
| `atlas planning check` | Validates a planning folder: its registry, plan and ledger headers, and work statistics. Read-only.                                                                                                                  | 0 valid, 1 errors, 2 usage errors                                                                                                                                 |
| `atlas plan export`    | Writes a whole work item to one self-contained `.atlas-plan.html` file (by default `<slug>-<work-id>.atlas-plan.html` in the current folder; an existing file needs `--force`). See [plan export](plan-export.md).   | 0, 1 when the export fails (an unknown work item, an existing file without `--force`, a refused folder), 2 usage errors                                           |
| `atlas plan import`    | Previews an export, then adds it as new work under the next free number and registers it, without committing; `--dry-run` only previews.                                                                             | 0, 1 invalid export or refused folder, 2 usage errors                                                                                                             |
| `atlas usage log`      | Records which planning documents an agent consulted, for the app's Document use statistics.                                                                                                                          | 0 even when it cannot record (gaps are reported on stderr and leave a coverage marker), 2 usage errors                                                            |
| `atlas work report`    | Records an agent's model, tokens so far and current step at a ledger transition, in `<work>/.atlas/statistics.jsonl`. See [progress and statistics](progress-and-statistics.md).                                     | 0, or 2 for usage errors; a report that cannot be written says so on stderr                                                                                       |
| `atlas serve`          | Runs the Atlas host without the desktop app, so paired computers can read the given planning folders. It prints a one-time pairing link with a QR code. See [remote access](remote-access.md).                       | Runs until stopped; 1 when it cannot start (no Tailscale address without `--address`, the app already manages remote access, or it cannot listen), 2 usage errors |

`plan export` and `plan import` use the planning folder given by `--planning-dir`, else the current folder. `usage log` and `work report` never fail an agent's task: reporting is best effort by design.

## The Atlas data folder

Usage statistics, recent planning folders, the app's window layout and logs, and remote-access settings live in the per-user **Atlas data folder**:

- `%APPDATA%\Atlas` on Windows;
- `${XDG_CONFIG_HOME:-~/.config}/Atlas` on Linux;
- `ATLAS_DATA_DIR`, when set.

The app and the command share it. Usage statistics are kept per planning folder under `usage/<hash of its canonical path>/`, outside the planning folder. Work statistics are the exception: they belong to the work, so `atlas work report` writes them into its folder as `<work>/.atlas/statistics.jsonl`.
