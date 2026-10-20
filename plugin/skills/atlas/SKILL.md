---
name: atlas
description: "Records projects and their work items in Atlas: plans, steps, glossaries and diagrams in planning folders in the Atlas home. Use whenever the user mentions Atlas, a project, a work item, a plan or a ledger; when they design something or ask for work big enough to plan; when they want something recorded, reviewed or brought up to date. Small, direct coding tasks need none of it."
---

# Atlas

Atlas keeps plans in projects. A project is a planning folder, its own Git repository in the Atlas home (`~/.atlas/planning/<name>`), and the folders on this computer where its work happens. Atlas records projects and their work items, nothing else. This skill finds the project, decides when to plan, records the work and keeps it current. Two workflows build on it, each run only when the user asks for it by name: [atlas-grill](../atlas-grill/SKILL.md) questions the user in rounds until a design is settled, and [atlas-implement](../atlas-implement/SKILL.md) implements an accepted plan.

Every planning folder has its own `AGENTS.md` (what is true, what to keep) and `PLANS.md` (the plan, registry and ledger formats); they govern, so read them before changing anything there. This skill says what to do and when.

## Find the project

- At session start Atlas names the session's project, its planning folder (an absolute path) and its active work. Without that context, call `where`: it lists every active project in the home with its folders and active work, and marks the ones the session belongs to.
- A session belongs to the project whose folder it is in (the deepest folder wins when they nest), or whose planning folder it is in. A location the user gives wins.
- **Several match:** ask the user which project to plan in, and pass its planning folder to the tools (`planningFolder`).
- **None matches:** ask which project the work belongs to. For a listed project, offer to add this folder to it (in the app's Projects page, or in its `planning.json`); otherwise offer to [set up a project](#set-up-a-project). A request about Atlas itself or several projects is [work across projects](#work-across-projects).
- Stay in that project. Ordinary coding never waits for planning.

## When to plan

Plan when the user is designing something, or asks for work whose requirements, boundaries or tradeoffs need settling, or that must survive across sessions. Small, clear tasks stay plain coding: no work item, no interview.

When work qualifies, **ask before opening a work item**, then call `work_create` with a `summary`: two or three plain sentences on what the work is, why, and where it stands. Continue existing work only as the user selects it or the registry's `current_plan` points, never by the newest file or the highest number.

Find facts yourself; put only genuine decisions to the user, each with your recommendation, and wait for the answer. When the design has many open decisions, or the user asks to be grilled, run [atlas-grill](../atlas-grill/SKILL.md).

## Record

Record as understanding settles, not only at the end:

- **The plan's `summary`:** keep it saying what the work is and where it stands, when the design settles, at acceptance and as the work moves. The body does not repeat the header.
- **`plan.md`:** the outcome, scope, decisions with their reasons, dependencies, edge cases and completion checks, in whatever shape the work needs. Label proposals and open questions; never present your recommendation as the user's decision.
- **The ledger's steps:** the planning steps exist from creation; keep them true with the step tools. The ledger holds nothing else but, during implementation, its final-review list.
- **`CONTEXT.md`:** the work's glossary, updated the moment a term resolves ([format](../atlas-grill/references/CONTEXT-FORMAT.md)).

Write PRs, issues and commits in full, naming the repository from the checkout you work in: `owner/repo#12`, `owner/repo@4ab195a`, or their URLs. Atlas links these; `#12` and a bare hash stay plain text.

Keep one record per thing, and update it rather than adding summaries. Skip transcripts and command logs. Lessons that outlive the work belong in the repository's own `AGENTS.md` or documentation, not in Atlas.

When the user agrees to the plan, record it with `work_accept` and update the summary. Accepting a plan does not start it.

## The Atlas tools

The tools change planning state; each validates, refuses with the reason, and never commits.

| Tool                                                 | Use it to                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `where`, `work_status`                               | find the projects and active work; read a work item's steps and statistics           |
| `project_create`                                     | create a project from a name and folders, once the user agreed                       |
| `work_create`                                        | open a work item with its summary and planning steps, once the user agreed           |
| `work_accept`                                        | record that the user accepted the design; its planning steps are done                |
| `work_start`                                         | start implementation, adding the agreed steps after the planning steps               |
| `step_add`, `step_set`, `step_rename`, `step_remove` | keep the ledger's steps current; tell the user why a step is removed                 |
| `work_block`                                         | set or clear what blocks the work                                                    |
| `work_close`                                         | close verified work; refused while steps are open                                    |
| `work_archive`, `work_reopen`                        | archive superseded (by which work) or abandoned (why) work; bring archived work back |
| `work_continue`                                      | record that a work item continues other work, in any project                         |

Everything else is an ordinary file: plan bodies, the final-review list, glossaries, diagrams and whatever else a work folder holds. Edit them directly at their absolute paths, from any folder; after each edit, Atlas checks the file and hands back what to fix. Do not hand-edit what the tools own: the registry's work items, the header statuses and dates, the ledger header, and moves between `active/` and `archive/`.

Commit planning changes yourself, in the planning folder's Git with explicit pathspecs (`git -C <planning-folder> add -- <paths>`), at coherent points. Keep planning and product commits apart.

Atlas measures time, tokens and models for the work items a session touches; nothing is reported by hand.

## Set up a project

A project is a name and its folders, such as `~/work/shop`. Check with `where` that no project covers the work already; then, with the user's agreement, call `project_create` with the name and the folders. It makes the planning folder with its first commit, and sessions in those folders belong to it from then on. The user can also create one, and add folders later, on the app's Projects page.

## Work across projects

When the user asks to review projects or bring Atlas up to date:

1. **List the projects** with `where`. Go through the ones the user names, otherwise every active one.
2. **Read each project's active work:** for every active work item, its plan and `work_status`.
3. **Reconcile it with what happened.** The evidence is the Git history of the repositories in the project's folders, their PRs where the host is reachable, the planning folder's history and, when the harness offers it, the sessions that planned or implemented the work. Look for steps done but still open, merged PRs the summary lacks, decisions settled in a conversation but missing from the plan, finished or replaced work still active, and a stale `blocked`.
4. **Update what the evidence settles** (steps, summaries, links), citing the commit, PR or date. **Ask before consequential changes** (closing, archiving, reopening, removing steps, rewriting decisions, opening work), each with its evidence and your recommendation, one project at a time.
5. **Commit** each planning folder, and end with a short account per project: what changed, and what awaits the user.

## Diagrams

When the work settles domain concepts, boundaries or data structure, offer a diagram, and make it if the user agrees; plain UI or tooling work gets none. [Diagrams](references/diagrams.md) says how to write one.

## Close

Close with `work_close` once the agreed completion criteria are verified and the outcome is in the plan; for PR delivery that means the required PRs merged, unless agreed otherwise. Acceptance, implementation, PR readiness, merge and release are separate facts: state pending ones accurately. Unfinished scope stays active, or is transferred or dropped with `step_remove`, telling the user why. Closing never grants merge or deployment.
