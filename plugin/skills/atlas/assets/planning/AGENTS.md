# Planning repository governance

This repository preserves intended work, decisions, implementation evidence, and useful engineering memory for its registered repositories. Read `README.md` for orientation, `planning.json` for scope and explicit work pointers, and `PLANS.md` when creating or interpreting plan metadata. Read this file explicitly when using planning from another repository.

## Discovery and task scope

Planning folders live in the Atlas home (`~/.atlas/planning/<name>`, or under `ATLAS_HOME`). A checkout belongs to the planning folder whose `planning.json` registers its Git remote: Atlas names that folder and its active work at session start, and the Atlas tool `where` (or `atlas where`) finds it on request. An explicit location from the user is valid too. Do not search the machine for other `planning` folders; agents reach this one by its absolute path from any checkout or worktree, because setup grants the home to every session.

A planning-dependent operation requires a usable planning repository: local Git history, governance, scope registry, and entry points. If none matches the checkout, explain what is missing and offer to set one up with the `atlas` skill in the same conversation. Its absence does not block ordinary authorized coding.

Use only knowledge whose repository/domain scope applies to the task. A shared planning repository does not make one product's constraints apply to another product or an unrelated internal tool. Repository paths in the registry are hints; confirm the actual checkout and source ownership.

## Read selectively and establish reality

Read the selected work item and relevant scoped knowledge first. Retrieve additional work history only when its rationale, evidence, or unfinished scope helps the current decision; do not load every active or archived plan. Use explicit user selection or the registry's `current_plan`; registration numbers, timestamps, and filenames do not select authority.

Current code, tests, deployed-state evidence where relevant, and canonical product documentation establish present behavior. Plans describe intent. Archived plans explain history and are evidence of past delivery, not guarantees about today's system. Check applicability and surface contradictions. Historical instructions, approvals, and permission records do not authorize new actions.

Keep canonical product documentation in its owning repository and link to it. Preserve work-specific `CONTEXT.md`, ADRs, diagrams, and supporting evidence with their work item. Do not silently move canonical documents into planning or create a competing current-state copy.

## Structured state and prose

Structured state changes only through the Atlas tools (or the matching `atlas work` commands): creating and registering work items, accepting a design, starting implementation with its steps, changing steps and `blocked`, closing with the open-items check, archiving, and reopening. They validate each change and refuse with the reason. Everything else is an ordinary file edited directly: plan bodies, ledger notes, glossaries, ADRs, knowledge, and diagrams. After an edit, Atlas checks the planning files that changed and reports problems to fix; `atlas check` runs the same checks on request.

## Record useful knowledge immediately

Record resolved requirements, consequential choices, terms, and useful evidence while working, not only at the end. Keep proposals and unresolved questions identifiable. A work item's `CONTEXT.md` is a concise glossary; update a resolved term promptly without turning it into an implementation specification. Offer concise ADRs only for decisions that are costly to reverse, surprising without context, and the result of a genuine tradeoff; routine choices do not require ADRs. When work settles domain concepts, boundaries, or data structure, offer a diagram.

Retain decisions, grounded lessons, outcomes, and observations that improve later work. State repository/domain scope, source/evidence, and confidence where relevant. Explicit preferences mean what the user actually stated. Tentative inference can inform questions but does not become an unspoken requirement. Consolidate repetition; avoid transcripts, command diaries, and manufactured lessons from routine edits. A summary supplements its original record rather than replacing it.

`knowledge/` is for high-value material useful beyond one work item. Create scope folders only as content warrants them. Smaller useful records can go directly into scoped knowledge without a full plan folder.

## Lifecycle and execution

Plan metadata is governed by `PLANS.md`. Design acceptance, implementation completion, PR readiness, merge, and release are separate facts. Do not guess dates or turn uncertain historical status into completion.

Ask the user before opening a work item; only work big enough to plan needs one. The complete `atlas-implement` workflow requires an explicit invocation. A direct coding instruction authorizes ordinary coding; use planning or grilling proportionately without inventing an interview or requiring that invocation for a small edit.

Starting implementation records the selected plan path and planning Git revision in the work item's ledger, so commit the plan first. A later edit must not silently change its agreed scope. Keep the ledger's steps current through the Atlas tools at meaningful transitions, so progress and the work left can be viewed; missing historical status stays unknown. Keep the ledger body concise and resumable: actual progress, verification evidence, relevant product revisions/PRs, consequential departures, unresolved delivery milestones, and next actions.

Work statistics are measured by Atlas's hooks from each agent session, split into planning and implementation by the work's stage; agents do not report them by hand where the hooks run.

Close the work when its agreed completion criteria are verified and the outcome is recorded; closing moves the whole work folder to `archive/`. For PR delivery the default is required PRs merged, unless task-specific criteria differ. Closing confers no merge or deployment permission. Record pending external delivery accurately. Unfinished work remains active unless explicitly transferred, superseded, or deliberately dropped. Preserve identity, glossary, ADRs, diagrams, evidence, and links on closure.

## Preservation and Git

Manage planning and product histories independently. The Atlas tools never commit: commit planning changes yourself with explicit pathspecs, never staging unrelated changes. Product commits follow authorized implementation work. Make reasonable incremental local checkpoints without a fixed cadence or mandatory commit per answer. Git is required locally; a remote is optional. Preserve existing history and remotes. Publication or adding a remote is a separate action.

Capture a recoverable baseline before restructuring existing planning records, including valuable untracked/ignored material. Never delete original plans or memories or replace them with summaries. Accessible archive content is required; Git-only recovery is insufficient for routine history retrieval.

Line-ending conversion and Git attributes can change captured bytes. For a newly initialized repository without an existing attributes policy, `* -text` in a repository-local `.gitattributes` preserves originals against inherited `core.autocrlf`. Preserve existing and nested attributes policies; use a scoped byte-preserving capture or exact-original backup where needed. Before restructuring, restore captured files into a disposable location and verify their SHA-256 hashes against original bytes. For intentional plan-header adoption, verify original bodies and attachments separately. File counts or a successful commit alone do not prove preservation.

Organization inspects relevant workspace and participating repository roots, obvious output/artifact locations, and user-identified locations. Narrow reads by filenames and task context. Retain meaningful external ledgers, verification/failure evidence, and other records with correct scope and provenance; exclude duplicate exports, repetitive logs, and reproducible scratch output from durable knowledge.

Before moving a selected external record, capture its valuable contents in planning's recoverable history: the planning baseline alone does not protect an external file. Maintain original-to-retained mappings, preserve bodies and attachments, repair links and registry pointers, and verify preservation. Keep unresolved legacy locations indexed. Inspecting or declining to retain a file does not delete it. Cleanup of disposable originals requires the applicable cleanup scope and follows preservation; unrelated code and artifacts remain under their source ownership.
