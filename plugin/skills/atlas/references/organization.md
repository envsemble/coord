# Organization workflow

Use this workflow adaptively for bootstrap and subsequent maintenance. A usable organized repo does not require rewriting all history in one pass.

## Establish scope and recovery

Read the planning repo's governance and its folders, then inspect its current Git state. Preserve existing history, remotes, and user changes. Git must contain a recoverable baseline of original knowledge before restructuring; initialization alone is insufficient. If setup is incomplete, [set it up](../SKILL.md#set-up-a-project) first. Review what a planning commit will include rather than blindly staging unrelated changes. Agents find only planning folders in the Atlas home: bring an existing planning repository's records into a project there.

For selected external records, copy or otherwise capture their retained contents in planning history before removing or moving their originals. A planning baseline cannot recover files that were outside planning. Keep a source/destination mapping sufficient to verify meaningful moves; an exhaustive permanent catalogue of disposable logs is unnecessary.

## Inspect inside and outside planning

Inventory existing plans, glossaries, ADRs, ledgers, evidence, diagrams, and tools. Also inspect the project's folders, the repositories in them, and obvious output/artifact locations. Read candidate documents selectively; follow related links when necessary to understand their scope or outcome. Do not scan the whole machine or recursively read every dependency/build/source directory.

Consider loose ledgers, PR drafts, reports, screenshots, failure traces, and one-off reproduction scripts. Ask what future work can learn from each: an important choice, a known constraint, a reproducible issue, an actual verification result, or an unfinished delivery step. Retain that information with source context and repository scope.

Preserve valuable original documents when their detail matters. For large noisy output, retain the useful evidence or lesson with its original source and relevant conditions. Avoid importing duplicates, full routine logs, or reproducible scratch builds merely because they exist. Files already canonical in a product repo stay owned there and can be linked. Inspecting or declining to retain a source does not delete it; cleanup follows the applicable user-authorized scope after preservation.

## Classify with evidence

Use plan and ledger contents, actual product revisions, and relevant PR state to distinguish intent from delivery. A directory name, initial status heading, or file timestamp does not settle historical completion. Prefer unknown status to a fabricated certainty.

Keep original plan bodies and their related glossaries, ADRs, ledgers, and evidence together. A plan can be accepted yet unimplemented; a ledger can describe completed code with a PR still open. Retain contradictory evidence and identify what must be resolved rather than selecting whichever document is newest.

Do not treat a record as a plan, task, or knowledge because it looks like one. Synthetic material, such as skill or workflow trial inputs and outputs, invented repositories, sample plans, or fictional preferences, is evidence of that trial only. Keep it in a labelled `<work>/evidence/<trial>-fixtures/` folder whose README says it is synthetic and applies to no real repository. Never register it or leave it where it reads as real work. A fixture's `work-` ID must not appear to collide with real work. Do not import such fixtures from outside planning unless they are the evidence a ledger cites.

Recheck active work whose steps await an external milestone, such as an open PR. When the agreed completion criterion is now verified, record the outcome and close it with `work_close`; otherwise update only the facts that changed.

Every registered work item is a folder with its main plan as `plan.md` and a plan header, as `PLANS.md` describes. A plan lacking metadata gets an evidence-backed header while preserving its original body; do not force it into a new section template. Records with no established main plan are not registered: keep them under `supporting/` of the work they belong to, or in `knowledge/`, until their disposition is clear.

## Organize and verify

The planning root holds only governance, the registry, the README, `active/`, `archive/`, `knowledge/`, and explained tools. One thing gets one record and one identity: reconcile duplicates instead of adding competing copies. A received plan export (`*.atlas-plan.html`) is adopted with `atlas plan import <file> --planning-dir <planning-root>`, which adds it as new work, registers it, and records its origin.

New work gets its `work-NNNN` identity from `work_create`; when registering existing work by hand, take the next number unused across registry entries and active/archive folders, and retain it thereafter. Numbers describe registration order. Existing numbered folders must not be renumbered to produce an invented chronology.

Move whole work folders between `active/` and `archive/` with `work_close`, `work_archive` and `work_reopen`, which preserve identity and supporting records and repair the registry and links. Archived work may be completed, superseded, or abandoned. For supersession, record the relationship and point the registry at the applicable plan. A summary is an entry point, not a replacement for original documents.

Normalize each established main plan to root `plan.md`, preserving its body and identity, and keep its historical progress records under `supporting/`; the root `ledger.md` holds only steps. Do not select a competing historical plan or combine contradictory progress records to satisfy a filename convention. Keep useful supporting detail accessible in grouped folders; reduce root clutter without replacing originals with summaries. Do not create fresh status claims (steps in progress, current or next work) from historical prose. Write a ledger, as `PLANS.md` describes, only when actual present status is established.

Make each work folder self-contained with a lean root: `plan.md`; `ledger.md` when its status is known; and `CONTEXT.md`. Put imported notes, PR descriptions, and other retained drafts under `supporting/` or an existing phase folder, verification artifacts under `evidence/`, and qualifying ADRs under `docs/adr/`. Imported external originals also go under these folders, not the root. The work's diagrams are files in its folder, linked from its plan. Models in Atlas's retired JSON format (`.atlas/models`, `.atlas/history`) are no longer shown; leave them where they are in Git, unconverted. Diagrams and notes spanning several work items go to a folder of `knowledge/` with a README giving scope, source, and applicability; do not leave loose folders at the planning root. Explain retained tools with a README.

Repair relative links and registry paths after changes. When document paths change, preserve any existing local usage counts through an explicit reversible cache migration or retained alias, keeping event sources, timestamps, revision/hash provenance, and deduplication intact. Do not fabricate consultation events or discard old measurements merely to tidy filenames. For each retained original, verify its destination exists and content remains intact; after adding metadata, compare the original body and attachments rather than expecting the entire file hash to remain unchanged. Use hashes where files should be byte-identical. Verify representative recovery from the baseline in an isolated location and validate the folder with the read-only `atlas check <planning-root>`.

Update the README with useful navigation. Consolidate genuinely reusable knowledge in scoped `knowledge/`, with scope and evidence, as the [atlas skill](../SKILL.md) describes. Avoid turning unresolved guesses into project-wide requirements.

Commit coherent planning changes at useful milestones independently of product implementation commits. Report significant retained material, repaired structure, verification, and unresolved choices. Stop organization when the repo is useful for the current scope; later bounded passes can continue organizing history.
