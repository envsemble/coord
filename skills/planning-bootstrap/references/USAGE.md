# Passive planning usage

Report the planning documents you actually consulted, in small useful batches, using the sibling bootstrap helper. It works while the dashboard is closed and uses Python's standard library. Skip merely discovered/search-matched files and do not invent consultation before reading.

Run the installed bootstrap's scripts/log_consultation.py with the associated planning root and --files followed by the consulted planning-relative paths. Include --task with the known work/task identity, and --session only when the actual chat identity is available. Omit unknown identities; do not manufacture a work item or use one constant identity for unrelated tasks. A later batch may record a meaningful reread. The helper deduplicates paths within a batch.

Example (substitute the actual installed helper location, root, task, and files):

    python <planning-bootstrap>/scripts/log_consultation.py <planning-root> --task work-0007 --files AGENTS.md PLANS.md active/0007-example/plan.md

Only file identities, source, timestamps, known task/session IDs, Git revision, and content hashes are retained. No document bodies or chat transcripts are copied into statistics. These are agent-reported consultations, not independently observed reads or ratings of document quality.

Storage is a local cache keyed by the canonical planning-folder location: ~/.cache/planning-dashboard/<folder-hash>/usage.sqlite. The dashboard and helper share it. PLANNING_DASHBOARD_DATA_DIR or --data-dir overrides the cache base; both runtimes always add the folder hash, keeping multiple planning roots separate under a shared override. Nothing is added to durable knowledge or product Git. Work-document identity survives active/archive moves when the registry retains its work ID and relative document location.

An unavailable helper, Python runtime, or failed write must not interrupt the actual task. Continue work and disclose an unavailable collection step briefly when relevant; never claim it was logged. A failed database write retains a generic coverage marker beside the database when that cache directory is still writable. If storage itself is wholly unavailable, the helper can only disclose the failure in the task. Recorded failures and missing identities remain visible, but access that was never reported cannot be counted. Logging in independent babysit-pr is unnecessary unless it actually consults an associated planning record.
