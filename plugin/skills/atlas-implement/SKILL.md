---
name: atlas-implement
description: Use when the user says "atlas implement".
---

# Atlas Implement

Implement an accepted Atlas plan: its steps, review, delivery and outcome. The plan and the user's prompt define the scope; this workflow keeps progress visible and the result sound, and does not reinterpret the plan. The user's instructions and the repository's own `AGENTS.md` and contributing guides come first. It runs only when the user asks for it by name. Finding the project and recording follow the [atlas](../atlas/SKILL.md) skill.

## Start

1. Select the work the user names, else the registry's `current_plan`. Read the plan, its glossary, the relevant code and documentation. Surface contradictions instead of implementing a replaced design.
2. **Delivery is part of the plan:** commits on the current branch, a branch of their own, or a PR. When the plan doesn't say, ask now, and record the answer in the plan. Push only when the delivery says so; never merge, deploy or change repository settings.
3. A request to implement a draft is acceptance now: record it with `work_accept`. Commit the plan, then call `work_start` with the agreed steps, one per meaningful deliverable (without steps, it adopts the proposed ones when they are still right), and update the plan's `summary`.
4. When the work has diagrams captured from code or databases, capture `before` now and `after --compares before.puml` at the end ([diagrams](../atlas/references/diagrams.md)).

When resuming, read the plan as it is now: a later edit must not silently redefine the task.

## Work

- **Keep the steps true** with the `step` tool as they move; add a step when agreed scope grows (record the amendment in the plan), remove one only with the user told why. Use `work_block` while genuinely blocked, and keep the `summary` and tags current at milestones.
- **Follow the agreed design.** Tell the user your concerns and keep going; a material departure needs their agreement first, with the evidence and a proposal.
- **Test** what changed with the quickest checks likely to catch a mistake; run slow suites at milestones and once before handing off, unless the repository says otherwise.
- **Commit** in recoverable steps as the repository does, and planning changes separately with pathspecs.
- **Clean up after yourself.** Use a worktree only when the repository allows it and the work needs a separate checkout. Every worktree and temporary branch you or your subagents create is merged into the delivery branch, or deliberately dropped, and then removed (`git worktree remove`, `git branch -d`); before finishing, check `git worktree list` in each repository you touched.

## Review

Review each step in proportion to its risk, with what you have: an independent review by a subagent when the harness has them, otherwise a careful self-review of the changes against the plan. Never wait for a reviewer that isn't there; findings from bots or people on a PR are handled like any others.

Check each finding against the plan, tell defects from proposed plan changes, and grade it a **blocker**, **major** or **minor**:

- Fix blockers and majors now. Another round reviews only those fixes, at most three rounds a step; a blocker still open after that goes to the user.
- Put minors on the ledger's `## Final review` list, and work through it once, before handing off.

## Deliver

Check the final diff for unrelated or accidental files, then deliver as the plan says. For a PR, open it against the branch the repository integrates into, with a description a reviewer can follow without the conversation: the problem, the result, the choices that matter and how it was tested. A PR is delivered only when it can be merged: CI passes on its current head (where the repository has CI; never weaken a check), and it has no conflicts. Fix what fails and push again.

## Finish

Write the outcome into the plan's `summary`, naming commits and PRs in full (`owner/repo#12`, `owner/repo@4ab195a`). When every step is done and the plan's completion checks pass, check the tags fit what was done, then ask the user whether the work is finished, and close it with `work_close` only on their yes; a PR still awaiting merge means the work stays open, its summary saying so. Follow-ups go to a new work item that continues this one, with the user's agreement.

End with links to the work item and its PRs or commits, what changed, how it was tested and reviewed, any limitation, and exactly where the work is: the repository, its folder and the branch to check out, with nothing left in other worktrees.
