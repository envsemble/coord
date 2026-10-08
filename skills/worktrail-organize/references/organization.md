# Organization workflow

Use this workflow adaptively for bootstrap and subsequent maintenance. A usable organized repo does not require rewriting all history in one pass.

## Establish scope and recovery

Read the planning repo's governance and repository associations, then inspect its current Git state. Preserve existing history, remotes, and user changes. Git must contain a recoverable baseline of original knowledge before restructuring; initialization alone is insufficient. If setup is incomplete, bootstrap it first. Review what a planning commit will include rather than blindly staging unrelated changes.

For selected external records, copy or otherwise capture their retained contents in planning history before removing or moving their originals. A planning baseline cannot recover files that were outside planning. Keep a source/destination mapping sufficient to verify meaningful moves; an exhaustive permanent catalogue of disposable logs is unnecessary.

## Inspect inside and outside planning

Inventory existing plans, glossaries, ADRs, ledgers, evidence, diagrams, and tools. Also inspect relevant workspace/repository roots and obvious output/artifact locations. Read candidate documents selectively; follow related links when necessary to understand their scope or outcome. Do not scan the whole machine or recursively read every dependency/build/source directory.

Consider loose ledgers, PR drafts, reports, screenshots, failure traces, and one-off reproduction scripts. Ask what future work can learn from each: an important choice, a known constraint, a reproducible issue, an actual verification result, or an unfinished delivery step. Retain that information with source context and repository scope.

Preserve valuable original documents when their detail matters. For large noisy output, retain the useful evidence or lesson with its original source and relevant conditions. Avoid importing duplicates, full routine logs, or reproducible scratch builds merely because they exist. Files already canonical in a product repo stay owned there and can be linked. Inspecting or declining to retain a source does not delete it; cleanup follows the applicable user-authorized scope after preservation.

## Classify with evidence

Use plan and ledger contents, actual product revisions, and relevant PR state to distinguish intent from delivery. A directory name, initial status heading, or file timestamp does not settle historical completion. Prefer unknown status to a fabricated certainty.

Keep original plan bodies and their related glossaries, ADRs, ledgers, and evidence together. A plan can be accepted yet unimplemented; a ledger can describe completed code with a PR still open. Retain contradictory evidence and identify what must be resolved rather than selecting whichever document is newest.

Register legacy work in its existing planning-relative location when a move or current-plan choice is unclear. `current_plan` may remain null when no main plan has been established. Plans lacking metadata may be wrapped with an evidence-backed header while preserving their original body; do not force them into a new section template.

## Organize and verify

For new work, allocate the next `work-NNNN` identity across registry entries and active/archive folders; retain it thereafter. Numbers describe registration order. Existing numbered folders must not be renumbered to produce an invented chronology. Keep uncertain legacy locations indexed until their disposition is clear.

Move entire work folders between `active/` and `archive/` when closure is justified, preserving identity and supporting records. Archived work may be completed, superseded, or abandoned. For supersession, record the relationship and point the registry at the applicable plan. A summary is an entry point, not a replacement for original documents.

Normalize each established main plan to root `plan.md` and its main progress record to root `ledger.md`, preserving bodies and identity. Do not select a competing historical plan or combine contradictory ledgers to satisfy a filename convention. Keep useful supporting detail accessible in grouped folders; reduce root clutter without replacing originals with summaries. Do not create fresh current/next claims from historical prose. Follow `PLANS.md` for the ledger status header only when actual present status is established.

Repair relative links and registry paths after changes. When document paths change, preserve any existing local usage counts through an explicit reversible cache migration or retained alias, keeping event sources, timestamps, revision/hash provenance, and deduplication intact. Do not fabricate consultation events or discard old measurements merely to tidy filenames. For each retained original, verify its destination exists and content remains intact; after adding metadata, compare the original body and attachments rather than expecting the entire file hash to remain unchanged. Use hashes where files should be byte-identical. Verify representative recovery from the baseline in an isolated location and validate the registry through [the read-only checker](../../worktrail-bootstrap/scripts/check_planning.py) when available.

Update the README with useful navigation, including retained legacy locations. Use [worktrail-record](../../worktrail-record/SKILL.md) to consolidate genuinely reusable knowledge, with scope and evidence. Avoid turning unresolved guesses into project-wide requirements.

Commit coherent planning changes at useful milestones independently of product implementation commits. Report significant retained material, repaired structure, verification, and unresolved choices. Stop organization when the repo is useful for the current scope; later bounded passes can continue historical adoption.
