---
name: atlas-grill
description: Use when the user says "atlas grill", "grill" or "grill me".
---

# Atlas Grill

Interview the user in rounds until a design is settled and both of you understand it the same way; record the plan and glossary as answers settle, and end with the plan ready to accept. Finding the project, opening a work item and recording follow the [atlas](../atlas/SKILL.md) skill.

## Start

Say that the grilling starts, and what it is about in one sentence as you understand it. Continue the work item the user names or the registry's `current_plan`; for new work, ask before opening one. When the user wants to be grilled without recording anything, keep the record in the conversation and offer a work item at the end.

Before the first round, read what exists: the plan, its glossary and diagrams, the relevant code and documentation. Anything you can find out is not a question.

## Rounds

Map the design as a tree: every decision branches into the decisions that depend on it. The **frontier** is every open decision whose prerequisites are settled. Each round, ask the whole frontier, then wait for the answers:

```
❓ **Q1 — <question title>**: <the question, with the options when there are several>

➡️ <your recommendation, and why>
```

- **One decision per question.** A question whose answer depends on another still open waits for a later round; never invent questions to fill a round.
- **Facts are yours, decisions are the user's.** Look up what the code, documentation, history and tools can tell you, before and between rounds; an exploration still running holds back only the questions that depend on it. Do not go on with an assumption. When the user leaves a choice to you, record your recommendation as delegated to you, not as their decision.
- **Recompute the frontier** after each round: settled answers open the branches below them.

## Sharpen the model

- **Challenge terms** against the glossary as soon as one is used differently: "Your glossary says a cancellation is X, but you seem to mean Y. Which is it?" Propose a precise term for a vague or overloaded one ("account": the customer or the user?).
- **Test relationships with concrete scenarios** that probe the edge cases and force the boundaries between concepts to be precise.
- **Check claims against the code.** When the user says how something works and the code disagrees, say so and ask which is right.
- **Keep the glossary current.** Put each resolved term in the work item's `CONTEXT.md` at once, in [the glossary format](references/CONTEXT-FORMAT.md): terms only, no implementation. Create it with the first term; with several domain contexts, a `CONTEXT-MAP.md` points to one glossary per context.

## Diagrams in the rounds

When the design is about domain concepts, data or boundaries, and a picture would help the two of you understand it the same way, draw it early and keep it current as rounds settle; skip it when it would not. Choose the kind that fits ([diagrams](../atlas/references/diagrams.md) says how to write each):

- **Build on what exists.** When the design changes existing code or a database, capture it first (`atlas capture`) and draw the design as a proposal against the capture: it starts from the real structure instead of a remembered one, and Atlas shows what changes.
- **One proposal per option** when a question weighs alternatives, all from the same capture.
- **A scenario** (an object diagram checked against the model) to settle an edge case concretely.

Refer to the diagram naturally in the questions, so it is clear which diagram and element a question is about: the user opens it in Atlas. Link each diagram from the plan under the heading it explains.

## Record and end

After each round, write what settled into the work item: decisions with their reasons in `plan.md`, the questions still open labelled as open, and the plan's `summary` saying where the design stands. Keep the planning steps true: "Understand the request" done once the request is clear, "Settle the design" doing while rounds run and done when the frontier is empty, "Write the plan" as the plan is reconciled. Commit at coherent points, not after every answer.

The grilling ends when the frontier is empty: every relevant branch visited, nothing silently assumed. Reconcile `plan.md` with the final agreement (outcome, scope, decisions, edge cases and completion checks), give a short summary with a link to the plan, and ask whether the user accepts it; on yes, record it with `work_accept`. Acceptance does not start implementation: that is [atlas-implement](../atlas-implement/SKILL.md), when the user asks for it. When the user stops early, record where the design stands and what is still open.

The interview and domain-modeling methods are adapted from Matt Pocock's [skills](https://github.com/mattpocock/skills), under [the MIT license](references/LICENSE).
