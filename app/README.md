# Planning dashboard

A local React viewer for a planning repository. Browse active and archived work, selected plans, ledgers, glossary, ADRs, evidence, scoped knowledge, and recorded Git activity. Discuss changes with your agent in chat.

## Run locally

Requires Node.js 24 or newer, npm, and Git for planning history. From this directory, install dependencies once:

    npm ci

Start the dashboard with one command:

    npm run dev

Open [the local dashboard](http://127.0.0.1:4317). By default it reads the sibling planning folder two levels above this directory: a layout of workspace/skills/planning-dashboard and workspace/planning. To read another repository:

    npm run dev -- --planning-dir "C:/path/to/planning"

Optional arguments: --port 4318 and --data-dir "C:/path/to/local-cache". For a built version, run npm run build once, then npm start with the same options. The server listens only on 127.0.0.1; nothing is hosted remotely. Stop it with Ctrl+C.

## Records and progress

The reader uses planning.json schema version 1 and the planning workflow's [metadata contract](../planning-workflow/planning-bootstrap/assets/planning/PLANS.md). It follows each registered current_plan pointer. Work without a selected plan retains its original files and an explicit notice; filename order never selects a plan.

Design acceptance, implementation status, archive location, and known dates are displayed separately. Ledger prose supplies actual progress. Unknown dates stay unknown; invalid dates and chronology generate health errors. Recorded calendar durations are not engineering time. Git activity shows recent checkpoints, associating work through retained registry identities so archiving or renaming its folder preserves earlier activity. Filesystem and Git reads do not update plans or lifecycle state. Refresh manually or let the visible dashboard refresh every 20 seconds.

Contained Markdown links open their original records. External web references open separately; references outside the planning root are marked. Raw HTML is not executed. Text and common images render in the reader; other attachments can be downloaded. The text reader has a 4 MiB limit, with original downloads retained.

## Usage statistics

Two sources remain distinct: document opens in the browser and agent-reported consultation. Statistics show most/least recorded use, known task identities, recent consultation, and collection coverage. They do not measure whether the workflow improved an outcome. Zero recorded use does not mean a record was never read or should be removed.

The five planning skills use bootstrap's [consultation helper](../planning-workflow/planning-bootstrap/references/USAGE.md), which requires Python 3 with SQLite support and only the standard library. It writes while the dashboard is closed. No model calls, API keys, or paid API account are needed. Install the updated skills together using the repository's [installation instructions](../README.md#install).

Usage is local, outside the planning and product repositories: ~/.cache/planning-dashboard/&lt;canonical-folder-hash&gt;/usage.sqlite. Both runtimes share this SQLite store. PLANNING_DASHBOARD_DATA_DIR or --data-dir overrides the cache base; both always add the folder hash so one override can safely serve several planning roots. Give the helper that same base directory. Moving the entire planning root changes the cache identity. Stable work IDs preserve per-document use through active/archive moves within the same root.

Events retain document identity, source, timestamp, known task/session IDs, available Git revision, and content hash. Bodies and transcripts are not stored. Browser views within 30 seconds of the same document/session are deduplicated. Agent reports deduplicate paths within each batch; they remain self-reported. Missing identities and incomplete collection are shown honestly. Failed database writes retain generic coverage markers alongside the database when that directory is writable; a wholly unavailable cache is disclosed in the task. Logging failure does not block reading or authorized implementation work.

## Verify

    npm test
    npm run build

Portable tests cover legacy records, explicit plan selection, path containment, statistics, and Python/Node interoperability while the dashboard is closed. A local-only test also reads the sibling workspace's actual planning registry when present; CI does not need private planning records. The repository's CI validates the dashboard and planning helper tests.
