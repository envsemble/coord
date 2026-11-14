# Planning repository governance

This repository is an Coord project's planning folder: its work items, each a plan with its steps. `README.md` orients, `planning.json` lists the project's folders and work, and `PLANS.md` defines the plan, registry and ledger formats.

## Scope

A session in one of the folders `planning.json` lists, or inside one, belongs to this project (the deepest folder wins when projects' folders nest), and so does a session in this planning folder. Coord names the project at session start, and the Coord tool `where` finds it on request. Reach this folder by its absolute path from any checkout; do not search the machine for others.

Coord keeps no repositories: the same repository may be checked out in several folders. Confirm which repository a change is about from the checkout itself, and name it in every reference: `owner/repo#12`, `owner/repo@4ab195a`, or their URLs. A shared planning folder does not make one product's constraints apply to another.

## What is true

Current code, tests and canonical product documentation establish present behavior. Plans describe intent; archived plans are history, not guarantees about today's system. Surface contradictions instead of picking whichever document is newest. Old instructions, approvals and permissions authorize nothing new.

Select work by the user's choice or the registry's `current_plan`; numbers, dates and filenames confer no authority. Read the selected work, and other work only when it helps the current decision.

Keep canonical product documentation in its own repository and link to it; do not copy it here.

## What to record

- Ask the user before opening a work item; only work big enough to plan needs one. Keep its plan's `summary` and its ledger's steps current as the design settles and the work moves.
- Record resolved requirements and decisions, with their reasons, in the plan while working, not only at the end. Keep proposals and open questions labelled, and record as the user's decision only what they actually decided.
- A work item's `CONTEXT.md` is a concise glossary of its terms. Offer a diagram when work settles domain concepts, boundaries or data structure.
- One thing gets one record: update it rather than adding summaries. Skip transcripts and command logs. Lessons that outlive the work belong in the repository's own `AGENTS.md` or documentation.

## State and files

The Coord tools change structured state: creating work items, accepting a design, starting implementation, steps, `blocked`, closing, archiving and reopening. Everything else is an ordinary file edited directly; Coord checks each edit and reports what to fix, and `coord check` runs the same checks on request.

Design acceptance, implementation completion, PR readiness, merge and release are separate facts; do not guess dates or turn an uncertain status into completion. Commit the plan before implementation starts, so its history shows what was agreed, and record later amendments in it. Close work once its agreed completion criteria are verified and the outcome is recorded (for PR delivery, the required PRs merged unless agreed otherwise). Closing grants no merge or deployment. Unfinished scope stays active unless it is explicitly transferred, superseded or dropped.

## Git

The tools never commit. Commit planning changes yourself with explicit pathspecs, never staging unrelated changes, and keep planning and product histories apart. A remote is optional; adding or pushing to one is a separate decision.
