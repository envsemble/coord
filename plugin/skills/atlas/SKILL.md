---
name: atlas
description: "Atlas planning: projects with their plans, ledgers, decisions, glossaries and diagrams in the Atlas home. Use whenever the user mentions Atlas, a project, a work item, a plan or a ledger; when they design something or ask for work big enough to plan; when they want something recorded, reviewed or brought up to date, in one project or across all of them. Small, direct coding tasks need none of it."
---

# Atlas

Atlas keeps plans in projects: each a planning folder, a Git repository in the Atlas home (`~/.atlas/planning/<name>`), named by the `name` in its `planning.json` and covering one repository or several. A repository may belong to several projects. This skill plans, records and organizes work there, in one project or across all of them. Two workflows build on it, each run when the user asks for it by name: [atlas-grill](../atlas-grill/SKILL.md), the questioning in rounds until a design is settled, and [atlas-implement](../atlas-implement/SKILL.md), implementing an accepted plan; accepting a plan does not start it.

## Find the planning folder

At session start Atlas names the projects that register this checkout's Git remote, with their planning folders (absolute paths) and active work. When none does, it says so and lists the projects in the home (name, planning folder, how much active work) for the user to choose from or for [work across projects](#work-across-projects). Without that context, call the Atlas tool `where` (or run `atlas where`), which works in any folder, Git checkout or not: its `projects` are every active project in the home, each with its planning folder, name, repositories, active work (statuses, progress, `blocked`) and `match`, true when its `planning.json` registers this checkout's remote; `matches` are those projects with the active work for this checkout's repositories and its steps (`work_status` gives any work item's steps). A location the user gives wins. When several projects match and the work does not already name one, **ask the user which project to plan in**, and pass its planning folder to the Atlas tools (`planningFolder`). Read that folder's own `AGENTS.md`, `PLANS.md` and `planning.json` before changing anything; they govern, and the bundled [governance](assets/planning/AGENTS.md) and [plan contract](assets/planning/PLANS.md) are the defaults they start from.

No match: when the work belongs to a listed project, offer to register this repository's remote there; otherwise offer to [set up a project](#set-up-a-project). A request about Atlas itself or about several projects is [work across projects](#work-across-projects). Ordinary coding never waits for planning.

## When to plan

Plan when the user is designing something, or asks for work whose requirements, boundaries or tradeoffs need settling or that must survive across sessions. Small, clear tasks stay plain coding: no work item, no interview. When work qualifies, **ask the user before opening a work item**; then `work_create` allocates the next number, writes `active/NNNN-slug/plan.md` with a draft header and registers it. Continue existing work only as the user selects it or the registry's `current_plan` points; never by the newest file or the highest number.

## Interview and record

Find facts yourself; put only genuine decisions to the user, with your recommendation, and wait. Settled answers stay settled. [Domain modeling](references/DOMAIN-MODELING.md) keeps the language sharp and links the [glossary](references/CONTEXT-FORMAT.md) and [ADR](references/ADR-FORMAT.md) formats. When the user asks to be grilled, the questioning runs as [atlas-grill](../atlas-grill/SKILL.md): rounds over a design tree until nothing is left open.

Record as understanding settles, not only at the end:

- **`plan.md`:** the intended outcome, scope, decisions, dependencies, edge cases and completion checks, in whatever shape the work needs. Label proposals and open questions; never present a recommendation as the user's decision.
- **`CONTEXT.md`:** the work's glossary, updated the moment a term resolves; terms only.
- **`docs/adr/`:** only for a decision that is hard to reverse, surprising without context and the result of a real tradeoff.
- **`knowledge/<repository-id>/`:** decisions, lessons and observations useful beyond one work item, each with its scope, source and confidence. A small task with something worth keeping gets one concise record here, without a work item.
- **The ledger body:** progress, evidence, PRs, departures and next actions, once implementation runs.

Keep one record per thing and consolidate rather than add summaries; skip transcripts, command logs and lessons manufactured from routine edits. Current code, tests and canonical product documentation establish what is true now; plans and archived work are intent and history, and old permissions authorize nothing new. Link canonical documentation in its own repository instead of copying it.

When the user agrees to the plan, record it with `work_accept`. Before handing off, reconcile the files with the final agreement and link the work folder with a short status.

## State through the Atlas tools, prose as files

The Atlas tools are the reliable way to change planning state; each validates, refuses with the reason, and never commits. The `atlas work …` commands are the same operations.

| Tool                                                 | Use it to                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `where`, `work_status`                               | find the projects and active work; read a work item's state and statistics           |
| `work_create`                                        | open a work item, once the user agreed                                               |
| `work_accept`                                        | record that the user accepted the design                                             |
| `work_start`                                         | start implementation with the agreed steps                                           |
| `step_add`, `step_set`, `step_rename`, `step_remove` | keep the ledger's steps current; a step is removed only with a reason                |
| `work_block`                                         | set or clear what blocks the work                                                    |
| `work_close`                                         | close verified work; refused while items are open                                    |
| `work_archive`, `work_reopen`                        | archive superseded (by which work) or abandoned (why) work; bring archived work back |

Do not hand-edit what the tools own: work-item registrations, the statuses and dates they set, the `superseded`/`abandoned` disposition `work_archive` sets, the ledger header and moves between `active/` and `archive/`.

Everything else is an ordinary file: plan bodies, ledger notes, glossaries, ADRs, knowledge and diagrams. Edit them directly at their absolute paths in the planning folder, from any checkout. After each edit there, Atlas checks the file and hands back any problems to fix.

Commit planning changes yourself, in the planning folder's own Git and with explicit pathspecs (`git -C <planning-folder> add -- <paths>`, then commit), at coherent milestones. Never stage unrelated changes, and keep planning and product histories separate.

## Checks and statistics

Hooks run them: after each edit in the home, Atlas checks the planning files you changed; when a session or subagent stops, it measures the session's time, tokens, models and subagents for the work items the session touched, as planning or implementation by the work's stage. Nothing needs reporting by hand. Only when the hooks are not installed (no Atlas context at session start) run `atlas check <files>` after editing, and `atlas work report <planning-folder> --work <work-id> --step <title>` when work starts and at each ledger transition.

## Set up a project

The user can create a project in the Atlas app (File › New Project…). Otherwise, with their agreement, create `<home>/planning/<name>` (`atlas home` prints the home and its projects), run `git init` there and copy in the bundled templates (Atlas checks edits there once `planning.json` is in place): [AGENTS.md](assets/planning/AGENTS.md), [PLANS.md](assets/planning/PLANS.md), [README.md](assets/planning/README.md), [planning.json](assets/planning/planning.json), [plan-frontmatter.md](assets/planning/plan-frontmatter.md) and, when no attributes policy exists, [.gitattributes](assets/planning/.gitattributes). Set the project's `name` in `planning.json`, and register each participating repository with a stable `id`, a `name` and its `remote`, which is how checkouts find the project. Run `atlas check <folder>` and commit the baseline. A planning folder elsewhere moves into the home with `atlas home adopt <folder>` (or **Move into the Atlas home** in the app); until it does, agents do not find it, even when the app lists it. Hidden and archived projects are not found either.

## Work across projects

When no project registers the folder the session is in, or the user asks to review, organize or bring Atlas up to date:

1. **List the projects** with `where`. The user's request says which to go through; otherwise go through every active one.
2. **Go through each project's active work:** its `planning.json`, and for every active work item its plan, `work_status` and ledger.
3. **Reconcile them with what actually happened.** The evidence is the Git history of the project's repositories (branches, merges, tags), their PRs where the hosting service is reachable, the planning folder's own history and, when the harness offers one, its thread or session history (the conversations that planned or implemented the work). Look for steps done but still open, merged PRs and outcomes the ledger lacks, decisions settled in a conversation but missing from the plan, work finished or replaced but still active, and a stale `blocked`. Rely on Git and the PRs when no conversation history is available, and say so.
4. **Update what the evidence settles:** ledger notes citing their evidence (commit, PR, date), steps the evidence shows done, links. **Ask before consequential changes** (closing, archiving, reopening, removing steps, rewriting a plan's decisions, opening work), each with its evidence and your recommendation, one project at a time.
5. **Commit** each planning folder's changes in its own Git, and end with a short account per project: what changed, and what awaits the user.

## Organize legacy material

To adopt an existing planning repository, legacy plans or records scattered around a workspace, follow [the organization workflow](references/organization.md): a recoverable baseline before any move, originals preserved, classification by evidence, links repaired and preservation verified.

## Diagrams

When the work settles domain concepts, boundaries or data structure, offer a diagram, and make it if the user agrees; plain UI or tooling work gets none. A diagram is a file in the work folder, edited like any other and linked from the plan under the heading it explains. [Diagrams](references/diagrams.md) says how to write one.

## Close

Close with `work_close` once the agreed completion criteria are verified and the outcome is recorded; for PR delivery that means the required PRs merged, unless the work agreed otherwise. Acceptance, implementation, PR readiness, merge and release are separate facts: record pending ones accurately. Unfinished scope stays active, or is explicitly transferred or dropped (`step_remove` with the reason). Closing never grants merge or deployment.

The interview and domain-modeling methods are adapted from Matt Pocock's MIT-licensed skills: see [provenance](references/ATTRIBUTION.md) and [the license](references/LICENSE).
