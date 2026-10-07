---
name: planning-record
description: Record settled decisions, scoped observations, useful lessons, progress, and outcomes in an associated planning repo. Reconcile durable knowledge and automatically archive verified closure; useful smaller tasks need no full work-item scaffold.
---

# Planning Record

Retain information that will improve future work, with less being better than a pile of summaries. Record understanding when it settles and reconcile it with actual outcomes. Support the other planning skills or a useful small task directly; do not require a full interview or invent a plan and ledger for a minor record.

## Locate and retrieve

Locate the associated `planning` repository in the relevant repository/workspace or use the user's explicit location. Read its own `AGENTS.md`, `PLANS.md`, and `planning.json` explicitly, even when working from a sibling product repo. Confirm local Git history, governance, and repository scope. If missing or uninitialized, explain the prerequisite and offer [planning-bootstrap](../planning-bootstrap/SKILL.md) in this conversation before planning operations. This gate does not block ordinary authorized coding or independent PR babysitting.

Follow the actual repo's contract; [bootstrap governance](../planning-bootstrap/assets/planning/AGENTS.md) and [lifecycle metadata](../planning-bootstrap/assets/planning/PLANS.md) describe shared defaults. Select the user's work item or explicit registry `current_plan`, never the newest filename. Read the relevant existing record and scoped knowledge before adding another file; follow original evidence when it materially affects the conclusion. Current code, tests, deployment evidence when relevant, canonical product documentation, and current user intent establish applicability. Archived intent and old permissions cannot silently govern or authorize today's task.

## Choose the smallest useful record

- For an existing work item, update its plan for settled intended work and its ledger for actual progress, verification, departures, delivery milestones, and next actions. Keep the implementation's plan-revision provenance; an edited plan must not silently change what an ongoing implementation was asked to deliver. Maintain the root `ledger.md` status header defined in `PLANS.md` at meaningful transitions: actual current focus, agreed next steps, and genuine blocker. At completion/handoff clear finished steps and describe remaining delivery accurately; do not invent present activity for historical work. Keep intended work in the root `plan.md` and avoid parallel progress/outcome files. Add evidence only when useful to resume, verify, or understand the outcome.
- For a small task with enduring information and no work item, update or create one concise scoped record under `knowledge/`. Do not scaffold `plan.md`, glossary, ADRs, ledger, or evidence directories without useful content. If the task becomes resumable planned work, use the repo's work-item sequence and metadata rather than inventing a parallel index.
- Keep work-specific glossaries and ADRs with their original work folder. For domain records, read [domain modeling](../planning-grill/references/DOMAIN-MODELING.md) and its linked formats: the glossary contains domain terms only, and an ADR qualifies only when all three conditions hold. Link canonical docs in their owning repo; expose conflicting accounts instead of duplicating current truth.

Capture settled choices, consequential rationale, reproducible problems, actual outcomes, and grounded lessons. Skip routine command logs, duplicate summaries, general programming advice, and lessons manufactured from an ordinary edit. Preserve valuable original records; a summary or reusable lesson does not replace them. Valuable external artifacts need retention and source context before any move; use [planning-organize](../planning-organize/SKILL.md) for a broader import or reorganization pass.

Every reusable assertion should make its **scope**, **source**, and **confidence** clear, in compact prose or metadata as the repo prefers. Scope identifies relevant repository IDs, domain, and conditions; source points to the user statement, original work record, code revision, or verification evidence; confidence distinguishes an explicit decision/preference, a supported observation, and a tentative inference. Record only the preference the user actually expressed. A single observation is not a universal rule; tentative inference should improve questions, not become an unstated requirement.

Consolidate overlapping knowledge in the existing appropriate record and retain useful origin links. When later evidence changes its applicability, amend or supersede the assertion with the reason and source; keep the original work record accessible. Do not spread the same rule among several competing files. A useful compact example is: “For repository `<repo-id>`'s import flow, the fixture at `<work-item>/evidence/<file>` reproduces `<failure>` on revision `<sha>`. Confirmed for that revision; broader applicability unverified.”

## Reconcile outcome and lifecycle

Compare intended scope with what code, checks, and delivery evidence actually establish. Record meaningful differences, unresolved scope, and next actions in the existing ledger or concise outcome record. Keep `design_status` separate from `implementation_status`; acceptance is not implementation. Distinguish completion, PR readiness, merge, and release in the evidence. Unknown dates or legacy states remain unknown, not guessed. Update the plan's `updated` date when its record changes and `completed_at` only when implementation completion is verified.

Archive automatically once the agreed completion criteria are verified and the final outcome is recorded. For delivery through PRs, required PRs must have merged by default unless the task's agreed criteria differ. A ready PR, opened PR, or running CI alone is not default closure. Verify actual required checks and delivery state; record awaiting external action accurately. Archiving does not authorize merge, deployment, or release. If scope remains unfinished, keep it active unless it is explicitly transferred, superseded, or deliberately dropped; preserve links to the disposition and successor work.

Deliberately abandoned or superseded work may also close when that disposition is established. Preserve its actual implementation status (`unknown`, `not_started`, `in_progress`, `partial`, or `complete`) and design status (`draft`, `accepted`, `superseded`, or `abandoned`) rather than calling all closed work complete. Do not set `completed_at` merely because a folder is archived.

Move the **entire** work folder to `archive/` with the same work ID, number, and contents. Check the source/destination and existing changes first, preserve a recoverable baseline where needed, repair affected links, and update registry `path` and `current_plan` together. Check moved files/attachments and references against the source; a successful move or document count alone does not establish preservation. The registry keeps identity, repository scope, and pointers; narrative status remains in the plan. Accessible archived originals remain the source of history, not only a Git snapshot.

Manage planning Git independently of product Git. Make reasonable incremental local planning commits for coherent retained knowledge or closure, preserving unrelated user changes. A remote is optional; neither a remote nor a product commit is a prerequisite for local recording. Do not change product history just to save a planning record.

Report the retained record or archived folder with a link and a short accurate outcome, including unresolved delivery steps where relevant. The value is usable memory and honest closure, not a larger document set.

## Passive usage reporting

After consulting planning records, follow [passive usage reporting](../planning-bootstrap/references/USAGE.md) to record the actual consulted files in useful batches, with known task identity when available. Collection works while the dashboard is closed. A missing helper or logging failure must not interrupt the authorized task.
