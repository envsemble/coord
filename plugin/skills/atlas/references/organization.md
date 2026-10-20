# Organizing existing material

Bring notes, plans, reports and other records into a project so later work can find them. A useful project does not need all its history organized in one pass: stop when it serves the current scope.

## Where material comes from

- **An exported plan** (`*.atlas-plan.html`): `atlas plan import <file> --planning-dir <planning-folder>` adds it as new work and records its origin.
- **Records in the project's folders:** loose plans, ledgers, PR drafts, reports, screenshots, failure traces. Read them selectively, following links only as far as needed to understand their scope or outcome; do not scan the whole machine or every build and dependency folder.

## Decide what each record is

Ask what later work can learn from it: a decision, a constraint, a reproducible issue, a verification result, or unfinished work.

- **Work with a plan:** open a work item with `work_create` (ask first), and put the plan's content in its `plan.md`, keeping the original's detail. Steps go in the ledger only when present status is established; do not invent progress from old prose.
- **Supporting material for a work item:** under its `supporting/` or `evidence/`.
- **Useful beyond one work item:** a record in `knowledge/`, with its scope and source.
- **Duplicates, routine logs, reproducible scratch output:** leave them out.
- **Synthetic material** (trial inputs and outputs, invented repositories, sample plans): never registered as work; keep it, when a record cites it, in a labelled `evidence/<trial>-fixtures/` folder whose README says it is synthetic.

Tell intent from delivery by the evidence: the repository's commits and PRs, not a directory name, a status heading or a file date. Prefer an unknown status to an invented one, and keep contradictory evidence visible rather than picking the newest document.

Documents that are canonical in a product repository stay there; link to them.

## Move safely

Commit what the planning folder retains before moving or deleting an original outside it: the planning folder's Git cannot recover files that were never in it. Reading a record, or deciding not to keep it, deletes nothing; removing originals needs the user's agreement.

Afterwards, repair links, run `atlas check <planning-folder>`, commit, and tell the user what was brought in, what was left out and what awaits their decision.
