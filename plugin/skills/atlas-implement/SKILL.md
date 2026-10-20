---
name: atlas-implement
description: Use when the user says "atlas implement".
---

# Atlas Implement

Implement an accepted Atlas plan end to end: its steps, reviews, PRs and closing. The plan and the user's prompt define the scope, the outcomes and any order; this workflow adds visible progress, review and delivery, and does not reinterpret the plan. Explicit user instructions, and the repository's own `AGENTS.md` and contributing guides, take precedence. Keep most effort on the planned work and bookkeeping proportionate.

It runs only when the user asks for it by name, never for ordinary coding. Finding the project, recording and closing follow the [atlas](../atlas/SKILL.md) skill.

## Scope

Invocation authorizes implementing the selected plan, opening and updating its PRs, requesting review from the repository's configured reviewers and answering findings on those PRs. It does not authorize merging, auto-merge, deploying, changing protections or unrelated messages. Honor narrower instructions such as local-only work, and do not ask again for what is authorized. Never drop requirements silently or widen the scope.

## Start

1. Select the work the user names, else the registry's `current_plan`. Read the plan, its glossary, the relevant code and current documentation, and only the history this work needs. Surface contradictions instead of implementing a replaced design.
2. A request to implement a draft is acceptance now: record it with `work_accept`.
3. Commit the plan, then call `work_start` with the agreed steps, one per meaningful deliverable or milestone, and update the plan's `summary` to say implementation started.
4. When the work has diagrams captured from code or databases, capture again before starting (`atlas capture <source.json> --work <work-id> --name before`) and at the end (`… --name after --compares before.puml`), so the app shows the system before and after; [diagrams](../atlas/references/diagrams.md) describes the source.

When resuming, read the plan as it is now and its history since implementation started: a later edit must not silently redefine the task.

## Execute

- **Keep the steps true:** `step_set` to `doing` and `done` as they move; `step_add` when agreed scope gains a step, recording the amendment in the plan; `step_remove` when a step is transferred or dropped, telling the user why; `work_block` while genuinely blocked.
- **Keep the `summary` current** at milestones: a group of steps done, a PR opened or merged, a blocker.
- **Follow the agreed design** through ordinary uncertainty; tell the user your concerns and keep going. A material departure needs the user's agreement first, with the evidence and the proposal, while independent work continues.
- **Commit** recoverable steps as the repository's conventions say, and planning changes separately with pathspecs.
- **Test** what changed with the quickest checks likely to catch a mistake while working; run the slow suites (end-to-end, browser, visual) only at milestones and once before handoff, unless the repository says otherwise.
- **Worktrees:** follow the repository's rules. Where it has none, use one only for parallel work that needs its own checkout, and remove it once its branch is merged, abandoned or handed back. At milestones and at the end, say which branch, in which folder, holds the latest work.

## Review

Review proportionately: an independent adversarial review for substantial, risky or cross-repository work, a focused self-review for small clear changes. Give reviewers only the relevant requirements, decisions and changed code.

Validate each finding against the plan, tell defects from proposed plan changes, and grade each defect a **blocker**, **major** or **minor** (nits are minors):

- Fix blockers and majors before handoff.
- Put minors on the ledger's `## Final review` list instead of fixing them during the step.
- Each step gets one review. Another round follows only blockers or majors, and reviews the fix commits rather than the whole step. Stop after three rounds per step: what is still open goes on the list, and a remaining blocker goes to the user.

## PRs

Check the final diff for accidental and unrelated files. Push and open PRs when authorized, as drafts while gates are incomplete, against the branch the repository integrates into (its `dev` where it has one), following its PR template and guides. Write the title and description for a reviewer who has not seen the conversation: the problem, the resulting behavior, the choices that matter and the actual validation. Link related PRs with their merge order, and the issues they resolve.

Each PR is ready only when, on its current head:

- **Review:** the repository's configured automated reviewer completed a review (find it, its trigger and its completion signal from the documentation, settings and recent PRs). Without one, an independent adversarial review of the PR's full changes, within the same three rounds.
- **CI passes.** Missing, pending, cancelled or unexpectedly skipped checks are not success, and checks are never weakened. When CI does not run for the PR, the slow suites stand in: put their results in the description and say plainly that CI did not run.

Treat bot and human findings alike: validate, grade, batch the fixes, push, and reply in each thread with the fixing commit's link, or with evidence when a finding does not apply. A bot's minors go on the final-review list, and its follow-up reviews count toward the three rounds. Wait for reviews with bounded backoff, and report an external blocker after repeated attempts that make no progress.

**Final review**, once, before readiness: work through the final-review list in one batch, fix what is still worth fixing, tell the user what is left or moves to a follow-up work item, and have one focused review check the batch. Then check the current head, checks, reviews, threads and mergeability afresh, mark the drafts ready, and call a PR **ready for human review** only when everything above holds and it has no conflicts. Otherwise report the incomplete gate and the next action. Merging, and promoting the integration branch into the default branch, stay with the user.

## Close

Confirm the outcome against the plan, the validation and the reviews, and write it into the plan's `summary`, naming PRs and commits in full; then close as the atlas skill says. Follow-ups (deferred findings, ideas, later fixes) do not keep the work open: with the user's agreement, open a work item for them with `work_create` and `continues`, and remove any step it takes over. Until then the work stays active, with its pending milestones stated accurately.

End with links to the work item and its PRs, what changed, the validation and review evidence, any limitation, and which branch, in which folder, holds the latest work. Code written, a PR opened or CI started is not readiness, and readiness is not completion.
