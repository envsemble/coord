---
name: atlas-implement
description: Use when the user says "atlas implement".
---

# Atlas Implement

Implement an accepted Atlas plan end to end: its steps, ledger, reviews, PRs and closing. The plan and the invoking prompt define the scope, the outcomes and any sequence; this workflow adds progress visibility, review and delivery, and must not reinterpret or reorganize the plan. Explicit user instructions take precedence. Keep most effort on the planned work and bookkeeping proportionate.

This workflow runs only when the user asks for it by name ("atlas implement", or its command); never for ordinary coding, which needs neither it nor a planning folder. Planning, recording and organizing follow the [atlas](../atlas/SKILL.md) skill, which this workflow uses throughout.

## Scope and authorization

Invocation authorizes implementing the selected plan, creating and updating its PRs, requesting review from the repository's configured reviewers and replying to findings on those PRs, within the user's current scope and higher-priority permissions. It does not authorize merging, enabling auto-merge, deploying, changing protections or unrelated messages. Honor narrower instructions such as local-only work, and do not ask again for what is already authorized. Never drop requirements silently or expand scope; earlier plans and old permission records authorize nothing new.

## Select and start

Find the planning folder as the atlas skill says (the session-start context, else the Atlas tool `where`), and read its `AGENTS.md` and `PLANS.md`. Select the work the user names, else the registry's `current_plan`; never the newest file or the highest number. Read the plan fully, its glossary and ADRs, the relevant code and current product documentation, and only the history this work needs. Surface contradictions and supersession instead of implementing a replaced design. A legacy plan without a header is adopted first through the atlas skill's organization workflow.

An explicit request to implement a draft establishes present acceptance: record it with `work_accept`, never as a past date. Commit the plan, then call `work_start` with the agreed steps, one per meaningful deliverable or milestone. It sets the implementation in progress and writes the ledger with its steps and a Selection naming the plan and the planning Git revision; add the starting product revisions to the ledger. When resuming, compare the selection with the plan as it is now: later edits must not silently redefine the task, and accepted amendments are recorded with their revision.

When the work has diagrams captured from code or databases, capture again before implementation starts (`atlas capture <source.json> --work <work-id> --name before`) and once more at the end (`… --name after --compares before.puml`), so the app shows the system before and after; [diagrams](../atlas/references/diagrams.md) describes the source configuration.

## Execute and keep the ledger current

Keep the steps true as work moves: `step_set` to `doing` and `done`, `step_add` when agreed scope gains a step (record the amendment), `step_rename`, and `step_remove` with the reason when a step is transferred or dropped. Set `work_block` when genuinely blocked and clear it when work can go on. Statistics are recorded by the hooks; report by hand only when they are not installed, as the atlas skill says.

The ledger body stays short and resumable: product revisions, actual progress against the outcomes, consequential assumptions or departures, PR links with their heads, validation evidence, the review gate applied and the commits it covered, finding dispositions, outstanding delivery milestones and next actions. No transcripts, command diaries or copies of the plan.

Follow the agreed design through ordinary uncertainty and preferences for another architecture; record concerns and keep going. A material departure needs the user's agreement first, with the evidence and the proposal, while independent planned work continues. Make recoverable local commits as the repository's conventions suggest, and commit planning changes separately with pathspecs.

## Review and prepare PRs

Review proportionately: an independent adversarial review for substantial, risky or cross-repository work, focused self-review for small clear changes. Give reviewers only the relevant requirements, decisions and changed code. Validate findings against the plan, tell defects from proposed plan changes, and fix valid defects before handoff. Fix them in rounds: after each fix round, review its commits independently again, until a round leaves nothing that should be fixed; record each round's findings and their dispositions in the ledger. Model and effort choices follow the user's and the harness's configuration.

Inspect final diffs for accidental and unrelated files. Push and open PRs when authorized, as drafts while gates are incomplete, against the branch the repository integrates into (its `dev` where it has one), not its default branch. Write a self-contained title and description for a reviewer who has not seen the conversation: the problem, the resulting behavior, relevant choices and actual validation. Link related PRs with their dependencies and merge order, and link issues they resolve.

## Bring PRs to readiness

Each PR needs a **review gate** covering its current head:

- **Configured review:** the repository's configured automated reviewer, found from its documentation, settings and recent PRs together with its actual trigger and completion signal, completed a review of the current head.
- **Independent review:** when no automated reviewer is configured or available, an independent adversarial review of the PR's full changes at the current head, with every later commit reviewed before it is pushed.

Every PR also needs passing CI on its current head: missing, pending, cancelled or unexpectedly skipped checks are not success, and checks and tests are never weakened. A review request, queued job or review of an earlier head is not a completed gate. When CI does not run for the PR (some repositories run it only for their default branch) or cannot run, verify locally instead: run the repository's full checks on the current head, record the results in the ledger and the PR description, and say plainly that CI did not run.

Validate every finding, from bots and people alike. Batch valid fixes, verify, push, and reply in each thread with the correction and the fixing commit's link; answer inapplicable findings with evidence. After every new commit, refresh CI and request follow-up review through the discovered mechanism. Wait with bounded backoff, and report an external blocker after repeated attempts that make no progress.

Before declaring readiness, inspect the current head, checks, reviews, threads and mergeability afresh. Mark qualifying drafts ready and say a PR is **ready for human review** only when its CI and review gate pass on the current head with no valid unresolved finding, the description is current and there are no conflicts. Otherwise report the incomplete gate and the next action. Human approval and merge stay with the user: merge, and promote the integration branch into the default branch (`dev` into `main`), only with their approval and as they direct.

## Close and record

Confirm the planned outcome against the plan itself, the validation and the combined review, and record it in the ledger. Once every step is done and the agreed completion criteria are verified (for PR delivery, the required PRs merged unless agreed otherwise), close with `work_close`, which also archives the folder; it refuses while items are open, so finish them or record why one is dropped. Follow-ups that arise (deferred findings, ideas, later fixes) neither keep the work open nor stay as loose notes: with the user's agreement, move them to a new work item (`work_create`), link it from the ledger, and remove any step it takes over with `step_remove`, naming the new work. Until then the work stays active, with its pending milestones stated accurately. Retain durable decisions and lessons through the atlas skill.

Conclude with links to the work item and its PRs, what changed, the validation and review evidence, and any limitation. Code written, a PR opened or CI started is not readiness, and readiness is not completion.
