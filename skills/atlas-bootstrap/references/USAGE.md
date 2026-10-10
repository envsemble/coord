# Passive planning usage

Report the planning documents you actually consulted, in small useful batches, with the `atlas usage log` command. It works while the Atlas app is closed. Skip merely discovered/search-matched files and do not invent consultation before reading.

Run `atlas usage log` with the associated planning root and `--files` followed by the consulted planning-relative paths. Include `--task` with the known work/task identity, and `--session` only when the actual chat identity is available. Omit unknown identities; do not manufacture a work item or use one constant identity for unrelated tasks. A later batch may record a meaningful reread. The command deduplicates paths within a batch.

Example (substitute the actual root, task, and files):

    atlas usage log <planning-root> --task work-0007 --files AGENTS.md PLANS.md active/0007-example/plan.md

Only file identities, source, timestamps, known task/session IDs, Git revision, and content hashes are retained. No document bodies or chat transcripts are copied into statistics. These are agent-reported consultations, not independently observed reads or ratings of document quality.

Statistics live in the per-user Atlas data folder, keyed by a hash of the canonical planning-folder location: `%APPDATA%\Atlas` on Windows and `${XDG_CONFIG_HOME:-~/.config}/Atlas` on Linux. The Atlas app and command share it. `ATLAS_DATA_DIR`, or `--data-dir` for one call, overrides the base; the folder hash is always added, keeping multiple planning roots separate under a shared override. Nothing is added to durable knowledge or product Git. Work-document identity survives active/archive moves when the registry retains its work ID and relative document location.

An unavailable `atlas` command or failed write must not interrupt the actual task. Continue work and disclose an unavailable collection step briefly when relevant; never claim it was logged. A failed database write retains a generic coverage marker beside the database when that data directory is still writable. If storage itself is wholly unavailable, the command can only disclose the failure in the task. Recorded failures and missing identities remain visible, but access that was never reported cannot be counted. Logging in independent atlas-babysit-pr is unnecessary unless it actually consults an associated planning record. When the command is missing, the Atlas README's "Install the atlas command" section explains how to install it; do not install it without the user's agreement.
