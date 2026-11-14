---
name: atlas-implement
description: Use when the user says "atlas implement".
---

# Atlas Implement

Keep an accepted plan's work item true while it is implemented: its steps, its summary and amendments, the findings left for later, and how it ends. How to implement, review, test and deliver is not this skill's: the user's request, the repository's own `AGENTS.md` and contributing guides, and the skills those name decide it. It runs only when the user asks for it by name. Finding the project and recording follow the [atlas](../atlas/SKILL.md) skill.

## Start

1. Select the work the user names, else the registry's `current_plan`. Read the plan, its glossary, the relevant code and documentation. Surface contradictions instead of implementing a replaced design.
2. **How the work is delivered and proven is part of the plan**: commits, a branch or a PR, who merges it, and what proves it. What the user's request settles (in their words) goes into the plan as it is. What neither settles, ask about when it is the user's to decide; when they handed you the work to finish without them, decide it with a sensible default instead, and record it in the plan as your decision.
3. A request to implement a draft is acceptance now: record it with `work_accept`. Commit the plan, then call `work_start` with the agreed steps, one per meaningful deliverable (without steps, it adopts the proposed ones when they are still right), and update the plan's `summary`. The last step is where the delivery ends: the merge when you are to merge it, else the PR ready, after which the work waits open for the user's merge.
4. When the work changes a database's schema or a model's structure in a major way (tables or entities added, removed, split or merged, or their relations changed), capture `before` now and `after --compares before.puml` at the end, whether or not the plan has a diagram yet ([diagrams](../atlas/references/diagrams.md)).

When resuming, read the plan as it is now: a later edit must not silently redefine the task.

## While it is implemented

- **Keep the steps true** with the `step` tool as they move. Add a step when agreed scope grows (record the amendment in the plan), also for work the user asks for after delivery while the work is still open; remove one only with the user told why. A step is a deliverable the size of the others: review findings and small fixes belong to the step they serve.
- **Keep the summary and tags current** at milestones, and whose turn it is with `state` as it changes ([whose turn it is](../atlas/SKILL.md#whose-turn-it-is)): `working` while you work, `waiting` while the work waits on checks or someone else, `blocked` with why.
- **Follow the agreed design.** Tell the user your concerns and keep going; a material departure needs their agreement first, with the evidence and a proposal.
- **Findings you don't fix now but keep**, from any review (a minor, a follow-up), go on the ledger's `## Final review` list; work through it before the work ends, or move what is left to work that continues this one. A finding dismissed as not worth doing needs no entry.
- **Commit planning changes** separately from product changes, with pathspecs, at coherent points.
- **When you stop for the user**, whatever the reason, set `your_turn` with what they are to do, such as "Merge owner/repo#12".

## End

Write the outcome into the plan's `summary`, naming commits and PRs in full (`owner/repo#12`, `owner/repo@4ab195a`), and check the tags fit what was done. Then close it as the [atlas](../atlas/SKILL.md#close) skill says: once the outcome is reached, close it, asking first unless the user handed you the work to finish without them; a PR still awaiting its merge means the work stays open, its summary saying so. Follow-ups go to a new work item that continues this one ([when to plan](../atlas/SKILL.md#when-to-plan) says when to ask first).

End with links to the work item and its PRs or commits, what changed, and exactly where the work is: the repository, its folder and the branch to check out.
