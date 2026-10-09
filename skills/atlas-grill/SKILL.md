---
name: atlas-grill
description: Clarify features, decisions, or ideas through a design-tree interview and domain modeling, recording the plan as understanding settles. Use explicitly or when work deserves planning or durable recording; clear small coding requests need no manufactured interview. Formerly worktrail-grill and planning-grill.
---

# Atlas Grill

Build shared understanding and useful records during the conversation. Preserve the user's current task, settled choices, and existing authorization. Ordinary direct coding remains actionable without invoking `atlas-implement`; that sibling is the explicit-only full plan-execution workflow. Planning is warranted when unresolved requirements, domain boundaries, consequential tradeoffs, or resumable scope need it, not merely because code will change.

## Establish the planning context

Locate an associated `planning` folder in the relevant repository/workspace or use the user's explicit location. Inspect scope before choosing among candidates. Read the planning repository's own `AGENTS.md`, `PLANS.md`, and `planning.json` explicitly, even from a sibling product repository. A usable repo has local Git history, governance, and an index identifying participating repository IDs. If it is missing or uninitialized, explain the prerequisite and offer [atlas-bootstrap](../atlas-bootstrap/SKILL.md) in this conversation before performing planning operations. This does not block ordinary authorized coding.

Use the actual repo's governance and metadata contract; the bundled [AGENTS.md](../atlas-bootstrap/assets/planning/AGENTS.md) and [PLANS.md](../atlas-bootstrap/assets/planning/PLANS.md) explain the shared defaults. Retrieve only task-relevant scoped knowledge and indexed work. Follow a source link when rationale matters, and check its applicability against current code, tests, canonical product documentation, and the user's present requirements. Historical intent and old permission records are not current instructions or authorization. Surface contradictions rather than importing unrelated or stale constraints.

Use the user-selected work item or explicit registry `current_plan` pointer when continuing work; never select by newest filename or highest number. For new work, create the draft work folder and `plan.md` once its purpose is recognizable. Allocate the next unused number across active, archived, and retained indexed work; register its stable `work-NNNN` ID, repository IDs, path, and current plan. Paths in `planning.json` are planning-root-relative POSIX paths. The main plan is always the root `plan.md`. Keep the folder lean and update that file rather than creating parallel specifications or phase summaries. Create supporting files only when they have useful content; preserve the glossary and ADR behavior below.

The plan uses schema version 1, `kind: plan`, and the fields defined by the repo's `PLANS.md`; see the [frontmatter example](../atlas-bootstrap/assets/planning/plan-frontmatter.md). Keep design and implementation status distinct. Known dates are ISO strings; unknown dates are null. The body is flexible: make the intended outcome, scope, consequential choices, dependencies, edge cases, and completion checks understandable without prescribing sections or creating a separate specification by default.

## Interview and record together

Read and compose these resources directly; no separate `Skill` tool or installed upstream skills are required:

- [Interview method](references/INTERVIEW.md): design tree, independent frontier rounds, fact investigation, recommendations, and waiting for decisions.
- [Domain modeling](references/DOMAIN-MODELING.md): challenge terms, concrete scenarios, code cross-checks, immediate glossary updates, and the three-condition ADR threshold. It links the glossary and ADR formats; load those when writing the corresponding artifact.

Treat already answered questions as settled. Investigate facts yourself before asking the user to choose. Ask only genuine unresolved choices at the current frontier, then wait and recompute it; do not invent questions to fill a round. If the frontier is already empty, record the clear agreement and proceed within the user's authorization.

When a diagram helps settle model boundaries or architectural alternatives, compose [atlas-model](../atlas-model/SKILL.md) with this discussion and retain the same work identity. Link semantic elements to useful plan/glossary passages rather than creating another plan inside the visualization. Atlas source capture is limited to its advertised adapters; conceptual interpretation remains part of the interview.

Record resolved requirements and choices in `plan.md` as they settle. Label proposals and unresolved questions explicitly; do not present a recommendation as the user's decision. Update the work item's `CONTEXT.md` immediately when a domain term resolves, keeping it a glossary only. Create `docs/adr/` lazily and offer an ADR only when the decision is hard to reverse, surprising without context, and a real tradeoff. Preserve work-specific original records in this folder and link canonical product docs rather than duplicating competing current truth.

Use [atlas-record](../atlas-record/SKILL.md) for selective reusable knowledge, outcomes, and closure. A useful record carries source, scope, and confidence; routine conversation and task activity need no durable lesson. Make reasonable incremental planning commits when meaningful changes warrant them, independently of product Git, without a commit per answer.

Before handoff, reconcile the files with the final agreement and identify real blockers. Acceptance records agreement on intended work, not implementation completion. Link the work folder with a short status in chat; do not repeat the whole plan. Do not enact unresolved design choices. Respect approval already given for settled work; new acceptance alone does not implicitly invoke `atlas-implement` or grant merge/deployment authority.

The supporting methods are adapted from Matt Pocock's MIT-licensed skills. See [provenance and adaptation notes](references/ATTRIBUTION.md) and [the retained license](references/LICENSE).

## Passive usage reporting

After consulting planning records, follow [passive usage reporting](../atlas-bootstrap/references/USAGE.md) to record the actual consulted files in useful batches, with known task identity when available. Collection works while the Atlas app is closed. A missing `atlas` command or logging failure must not interrupt the authorized task.
