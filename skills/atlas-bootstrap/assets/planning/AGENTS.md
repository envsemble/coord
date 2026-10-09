# Planning repository governance

This repository preserves intended work, decisions, implementation evidence, and useful engineering memory for its registered repositories. Read `README.md` for orientation, `planning.json` for scope and explicit work pointers, and `PLANS.md` when creating or interpreting plan metadata. Read this file explicitly when using planning from another repository.

## Discovery and task scope

An explicit planning location is valid. Otherwise look for a folder named `planning` in the relevant repository/workspace context, including nearby siblings. No mandatory pointer in every product's `AGENTS.md` is required. Compare candidate registries with the task before asking about genuine ambiguity. Do not search unrelated machine locations.

A planning-dependent operation requires a usable associated planning repository: local Git history, governance, scope registry, and entry points. If missing or uninitialized, explain the missing prerequisite and offer guided `worktrail-bootstrap` in the same conversation. Bootstrap creates this prerequisite. Its absence does not block ordinary authorized coding or independent `worktrail-babysit-pr`.

Use only knowledge whose repository/domain scope applies to the task. A shared planning repository does not make one product's constraints apply to another product or an unrelated internal tool. Repository paths in the registry are hints; confirm the actual checkout and source ownership.

## Read selectively and establish reality

Read the selected work item and relevant scoped knowledge first. Retrieve additional work history only when its rationale, evidence, or unfinished scope helps the current decision; do not load every active or archived plan. Use explicit user selection or the registry's `current_plan`; registration numbers, timestamps, and filenames do not select authority.

Current code, tests, deployed-state evidence where relevant, and canonical product documentation establish present behavior. Plans describe intent. Archived plans explain history and are evidence of past delivery, not guarantees about today's system. Check applicability and surface contradictions. Historical instructions, approvals, and permission records do not authorize new actions.

Keep canonical product documentation in its owning repository and link to it. Preserve work-specific `CONTEXT.md`, ADRs, and supporting evidence with their work item. Do not silently move canonical documents into planning or create a competing current-state copy.

## Record useful knowledge immediately

Record resolved requirements, consequential choices, terms, and useful evidence while working, not only at the end. Keep proposals and unresolved questions identifiable. A work item's `CONTEXT.md` is a concise glossary; update a resolved term promptly without turning it into an implementation specification. Offer concise ADRs only for decisions that are costly to reverse, surprising without context, and the result of a genuine tradeoff; routine choices do not require ADRs.

Retain decisions, grounded lessons, outcomes, and observations that improve later work. State repository/domain scope, source/evidence, and confidence where relevant. Explicit preferences mean what the user actually stated. Tentative inference can inform questions but does not become an unspoken requirement. Consolidate repetition; avoid transcripts, command diaries, and manufactured lessons from routine edits. A summary supplements its original record rather than replacing it.

`knowledge/` is for high-value material useful beyond one work item. Create scope folders only as content warrants them. Smaller useful records can go directly into scoped knowledge without a full plan folder.

## Lifecycle and execution

Plan metadata is governed by `PLANS.md`. Design acceptance, implementation completion, PR readiness, merge, and release are separate facts. Do not guess dates or turn uncertain historical status into completion.

The complete `worktrail-implement` workflow requires an explicit invocation. A direct coding instruction authorizes ordinary coding; use planning or grilling proportionately without inventing an interview or requiring that invocation for a small edit.

Before plan implementation, record the selected plan path and planning Git revision in the work item's ledger. A later edit must not silently change its agreed scope. Use the root `plan.md` and `ledger.md` conventions in `PLANS.md`. Keep the ledger status header current at meaningful transitions so current, next, and blocked work can be viewed; missing historical status stays unknown. Keep the ledger concise and resumable: actual progress, verification evidence, relevant product revisions/PRs, consequential departures, unresolved delivery milestones, and next actions. Independent PR babysitting uses the PR as its record and requires no second ledger.

Archive the entire work folder automatically when its agreed completion criteria are verified and the outcome is recorded. For PR delivery the default is required PRs merged, unless task-specific criteria differ. Archiving confers no merge or deployment permission. Record pending external delivery accurately. Unfinished work remains active unless explicitly transferred, superseded, or deliberately dropped. Preserve identity, glossary, ADRs, evidence, and links on closure.

## Preservation and Git

Manage planning and product histories independently. Planning maintenance commits planning changes; product commits follow authorized implementation work. Make reasonable incremental local checkpoints without a fixed cadence or mandatory commit per answer. Git is required locally; a remote is optional. Preserve existing history and remotes. Publication or adding a remote is a separate action.

Capture a recoverable baseline before restructuring existing planning records, including valuable untracked/ignored material. Never delete original plans or memories or replace them with summaries. Accessible archive content is required; Git-only recovery is insufficient for routine history retrieval.

Line-ending conversion and Git attributes can change captured bytes. For a newly initialized repository without an existing attributes policy, `* -text` in a repository-local `.gitattributes` preserves originals against inherited `core.autocrlf`. Preserve existing and nested attributes policies; use a scoped byte-preserving capture or exact-original backup where needed. Before restructuring, restore captured files into a disposable location and verify their SHA-256 hashes against original bytes. For intentional plan-header adoption, verify original bodies and attachments separately. File counts or a successful commit alone do not prove preservation.

Organization inspects relevant workspace and participating repository roots, obvious output/artifact locations, and user-identified locations. Narrow reads by filenames and task context. Retain meaningful external ledgers, verification/failure evidence, and other records with correct scope and provenance; exclude duplicate exports, repetitive logs, and reproducible scratch output from durable knowledge.

Before moving a selected external record, capture its valuable contents in planning's recoverable history: the planning baseline alone does not protect an external file. Maintain original-to-retained mappings, preserve bodies and attachments, repair links and registry pointers, and verify preservation. Keep unresolved legacy locations indexed. Inspecting or declining to retain a file does not delete it. Cleanup of disposable originals requires the applicable cleanup scope and follows preservation; unrelated code and artifacts remain under their source ownership.
