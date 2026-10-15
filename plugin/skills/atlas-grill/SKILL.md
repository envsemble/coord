---
name: atlas-grill
description: Use when the user says "atlas grill", "grill" or "grill me".
---

# Atlas Grill

Atlas's questioning workflow: interview the user in rounds until a design is settled, record the plan, glossary and decisions as answers settle, and end with the plan ready to accept. It works within the [atlas](../atlas/SKILL.md) skill, which says how to find the project, open a work item and record; this workflow adds the questioning.

## Start

Say that the grilling starts, and what it is about in one sentence as you understand it. Find the project as the atlas skill says (the session-start context, else `where`; ask which project when several match). Continue the work item the user names or the registry's `current_plan`; for new work, ask before opening one with `work_create`. When the user wants to be grilled without recording anything, keep the record in the conversation and offer a work item at the end.

Before the first round, read what exists: the plan, its glossary and ADRs, the relevant code and documentation. Anything you can find out is not a question.

## Walk the design tree in rounds

Follow [the interview method](../atlas/references/INTERVIEW.md) and [domain modeling](../atlas/references/DOMAIN-MODELING.md):

- **Map the design as a tree:** every decision branches into the decisions that depend on it.
- **Ask the frontier each round:** every open decision whose prerequisites are settled, numbered, one decision per question, each with your recommendation and why. A question that depends on another still open waits for a later round. Never invent questions to fill a round.
- **Wait for the answers.** Do not go on with an assumption. When the user leaves a choice to you, record your recommendation as delegated to you, not as their decision.
- **Find facts yourself** in the code, documentation, history and tools, before and between rounds; an exploration still running holds back only the questions that depend on it.
- **Sharpen the model:** challenge terms against the glossary, test relationships with concrete scenarios, and check what the user says against the code.
- **Recompute the frontier** after each round: settled answers open the branches below them.

## Record as answers settle

After each round, write what settled into the work item as the atlas skill's [Interview and record](../atlas/SKILL.md#interview-and-record) says: decisions in `plan.md`, resolved terms in `CONTEXT.md` at once, an ADR only at its threshold, and the questions still open labelled as open. Offer a diagram when the answers settle domain concepts or boundaries. Commit the planning folder at coherent points, not after every answer.

## End

The grilling ends when the frontier is empty: every relevant branch visited, nothing silently assumed. Reconcile `plan.md` with the final agreement (outcome, scope, decisions, edge cases and completion checks), give a short summary with a link to the plan, and ask the user whether they accept it; on yes, record it with `work_accept`. Acceptance does not start implementation: that is [atlas-implement](../atlas-implement/SKILL.md), when the user asks for it. When the user stops early, record where the design stands and what is still open.

The interview and domain-modeling methods are adapted from Matt Pocock's MIT-licensed skills: see [provenance](../atlas/references/ATTRIBUTION.md) and [the license](../atlas/references/LICENSE).
