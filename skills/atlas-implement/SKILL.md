---
name: atlas-implement
description: Implement a selected plan persistently with revision provenance, a concise work-item ledger, proportional review, and PR readiness through atlas-babysit-pr. Use only when explicitly invoked by name (for example $atlas-implement or /atlas-implement); requires a usable associated planning repository.
disable-model-invocation: true
---

# Atlas Implement

Implement the user's selected plan in full. The plan and invoking prompt define scope, outcomes, implementation choices, and any specified sequence. This skill supports that work with progress visibility and review; it must not replace, reinterpret, or reorganize the plan into its own workflow. Explicit user instructions take precedence.

This is an explicit-only workflow. Ordinary authorized coding does not require this skill or a planning repository. Do not infer invocation from the existence of a plan or a direct coding request.

Keep most effort on completing the planned work. Apply supporting steps when relevant, keep bookkeeping proportional, and avoid restating the plan or introducing additional deliverables. PR readiness supports the planned outcome; it is a delivery milestone, not evidence that unfinished scope is complete.

## Scope and authorization

Invocation requests implementation of the selected plan, creation and updates of its PRs, review requests to the repository's configured reviewers, and replies to findings on those PRs, within the user's current scope and higher-priority permission rules. It does not authorize merging, enabling auto-merge, deploying, changing protections, or unrelated external messages. Honor narrower instructions, including local-only work, and do not ask again for actions already authorized.

Use accepted amendments across all involved repositories. Never silently drop requirements or expand scope. Historical permission records and earlier plans do not authorize new actions.

## Locate planning and pin the selected plan

Find a folder named `planning` in the relevant repository/workspace context, or use the user's supplied location. Inspect candidate scope before asking about genuine ambiguity. A usable associated planning repo has local Git history, readable governance, and enough repository/work-item registration to identify the selected work; remote versioning and complete normalization of legacy material are not prerequisites. Read its own `AGENTS.md`, `PLANS.md`, and `planning.json` explicitly, even from a sibling product checkout. The bundled [governance](../atlas-bootstrap/assets/planning/AGENTS.md) and [plan contract](../atlas-bootstrap/assets/planning/PLANS.md) define the shared default behavior; respect the actual repo's governance.

If the associated repo is missing or unusable, explain the missing prerequisite and offer [atlas-bootstrap](../atlas-bootstrap/SKILL.md) in the same conversation. Do not claim to have started this workflow without that prerequisite. This does not block independent `atlas-babysit-pr` or ordinary authorized coding.

Select the user's intended plan, or the registry work item's explicit `current_plan` pointer. Registry `path` and `current_plan` are planning-root-relative paths; a null pointer for retained legacy material requires identifying the plan before implementation. Reconcile a conflicting pointer with the explicit selection and record an intentional switch rather than silently retargeting work. Never select by newest filename, highest work number, or directory order. Read the selected current plan fully, its relevant supporting decisions/glossary, applicable current product instructions and code, and only scoped knowledge/history needed for this work. Verify historical applicability; archived or superseded intent cannot override current requirements or code.

A formal body is not required. Adopt an explicitly selected informal or legacy plan into the associated work item by registering its retained location or preserving it in a work folder, adding the repo's metadata contract, and keeping its body, detail, attachments, and useful links. If the registry currently indexes a single legacy plan file, preserve/adopt it into a work folder before adding the implementation ledger, retaining its ID and repairing pointers/links. Do not manufacture creation dates, prior acceptance, or implementation status. An explicit request to implement the selected proposal can establish present acceptance; it is not evidence of past acceptance. Surface contradictory scope or supersession rather than silently implementing a replaced design. Use [atlas-organize](../atlas-organize/SKILL.md) for consequential adoption work when needed; preserve a recoverable baseline before moves.

Before implementation, record the work-item ID, selected plan path, full planning Git revision, and relevant starting product revisions in the work item's ledger. If the selected plan/supporting decisions differ from that revision, preserve their exact selected state in a planning commit where authorized, or record the base revision plus retained diff/content evidence. A bare HEAD does not identify uncommitted plan contents. On resumption, compare the selected state with the ledger; later edits must not silently redefine the ongoing task. Record accepted amendments with their revision or evidence.

## Execute persistently and maintain the ledger

For each involved repository, identify required validation, PR conventions, and its review gate as [atlas-babysit-pr](../atlas-babysit-pr/SKILL.md) defines it: the configured automated reviewer with its discovered trigger and completion signal, or independent adversarial review when none is configured or available. Verify GitHub access early when PR delivery is in scope. Reuse known context and gather evidence in focused batches; compare changed state before repeating reads or checks.

Use the work folder's root `ledger.md` or create it outside product source. Preserve/adopt an existing differently named main ledger rather than creating a competing progress record. Follow `PLANS.md` for its small status header: current focus, agreed next steps, and actual blocker. Update before a substantial execution stretch and at meaningful changes or handoff; keep its body freeform. Select the explicit plan as before and normalize its main filename to `plan.md` through reversible organization when needed. Share its location. Set evidence-backed implementation metadata to `in_progress` when work starts and maintain it under `PLANS.md`; acceptance is a separate fact. Update the ledger at meaningful milestones, keeping the minimum needed to resume and verify:

- Selected plan path/revision and amendments, affected repositories, and relevant product revisions.
- Actual progress against requested outcomes, dependencies, consequential assumptions or departures, grounded concerns, and real blockers.
- Relevant PR URLs/head commits, validation evidence, the review gate applied and the commits it covered, finding dispositions and fixing commits.
- Delivery milestones still outstanding, current activity, and next actions.

Do not duplicate the plan, transcript, every command, or the PR's full review history. Use `atlas-record` for durable decisions and grounded lessons when useful; routine activity is not automatically reusable knowledge.

Follow the agreed design through ordinary uncertainty, potential future issues, and preferences for another architecture. Investigate, use judgment within the plan, record concerns/follow-ups, and continue useful authorized work. Make recoverable local checkpoints appropriate to risk and repository conventions. Manage product and planning Git histories independently; neither requires a fixed commit cadence.

A material departure from the agreed design is a major exception. First investigate ways to preserve the agreed outcome. If a fundamental conflict, impossible dependency, or necessary consequential change remains, record the evidence and proposed departure and obtain agreement before changing that scope, while continuing independent planned work. Do not turn minor implementation choices into approval gates or stop a substantial task for speculative concerns.

## Review and prepare PRs

Review proportionately. Use an independent adversarial reviewer for substantial, risky, cross-repository work or when separate scrutiny adds meaningful coverage. Small, clear changes use focused self-review. Give reviewers only relevant requirements, decisions, exclusions, and changed code; avoid duplicate or overlapping reviews. Validate findings against the plan, distinguish defects from proposed plan changes, and fix valid defects before handoff. Model and effort choices follow the user's and harness's configuration.

Apply gates to each PR and the combined result. Link related PRs and document dependencies and required merge order. Apply metadata clearly supported by task/repository context: known issues, relevant existing projects or milestones, and appropriate labels. Use closing references only for issues fully resolved. Do not perform broad searches or invent tracking items just to fill metadata fields.

Inspect final diffs for accidental files and unrelated changes, push and create/update PRs when authorized, and use drafts while gates remain incomplete. Write a self-contained title and description for a reviewer who has not seen the conversation: problem, resulting behavior, implemented scope, relevant choices, actual validation and material migration/compatibility/operational considerations. Follow repository templates and remove stale claims as work changes.

## Bring PRs to readiness and reconcile the outcome

For PR delivery, read and follow [atlas-babysit-pr](../atlas-babysit-pr/SKILL.md) for each PR. This explicit workflow dependency applies although both skills are explicit-only; read its file directly when the harness will not load it. Supply PR URLs and task scope. The PR remains babysitting's progress record; this workflow records only relevant milestones in its existing work-item ledger. Do not ask babysitting to create a second ledger. Report a missing dependency rather than claiming its gates passed.

After fixes, recheck affected dependencies and cross-repository interactions. Before handoff, confirm the intended planned outcome against the plan itself, required validation, proportional review of the combined change, every applicable current-head atlas-babysit-pr gate, and related PR links/dependencies. For authorized local-only delivery, report its actual validation and unperformed PR gates without inventing a PR requirement contrary to the user.

Conclude with links to the work item and applicable PRs, what changed, validation/review evidence, and material limitations. Say PRs are ready for human review and remain unmerged only when every readiness gate passes. Otherwise report incomplete gates and next actions. Code written, a PR opened, review requested, or CI started is insufficient.

Reconcile durable decisions, concerns, actual outcomes, and current canonical documentation through [atlas-record](../atlas-record/SKILL.md). Keep acceptance, implementation completion, PR readiness, merge, and release distinct. Archive the whole work item only when agreed completion criteria are verified and the outcome is recorded; for PR delivery the default requires the required PRs to have merged, unless task-specific criteria differ. Pending external delivery remains explicit. Unfinished scope stays active or is explicitly transferred, superseded, or deliberately dropped. Closure never grants merge or deployment authority.

## Passive usage reporting

After consulting planning records, follow [passive usage reporting](../atlas-bootstrap/references/USAGE.md) to record the actual consulted files in useful batches, with known task identity when available. Collection works while the Atlas app is closed. A missing `atlas` command or logging failure must not interrupt the authorized task.
