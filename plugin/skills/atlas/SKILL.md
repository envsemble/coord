---
name: atlas
description: "Use whenever the user mentions Atlas, a project, a work item, a plan or a ledger; when they design something or ask for work big enough to plan; when they want something recorded, reviewed or brought up to date. Small, direct coding tasks need none of it."
---

# Atlas

Atlas keeps plans in projects: each a planning folder, a Git repository in the Atlas home (`~/.atlas/planning/<name>`), named by the `name` in its `planning.json`, and the folders on this computer where its work happens. Atlas keeps no repositories: the same repository may be checked out in several folders, and a session's folder decides which project it is in. This skill plans, records and organizes work there, in one project or across all of them. Two workflows build on it, each run when the user asks for it by name: [atlas-grill](../atlas-grill/SKILL.md), the questioning in rounds until a design is settled, and [atlas-implement](../atlas-implement/SKILL.md), implementing an accepted plan; accepting a plan does not start it.

## Find the planning folder

At session start Atlas names the project the session belongs to, with its planning folder (an absolute path) and active work. A session in one of a project's **folders** (`folders` in its `planning.json`), or inside one, belongs to that project (the deepest folder wins when they nest), and so does a session in its planning folder; any other session belongs to no project. Stay in that project: plan, read and record there, and work across projects only when the user asks for it. When none does, it says so and lists the projects in the home (name, planning folder, how much active work) for the user to choose from or for [work across projects](#work-across-projects). Without that context, call the Atlas tool `where`, which works in any folder, Git checkout or not: its `projects` are every active project in the home, each with its planning folder, name, folders, active work (summaries, statuses, progress, `blocked`) and `match`, true when the session belongs to it; `matches` are those projects with their active work and its steps (`work_status` gives any work item's steps). A location the user gives wins. When several projects match and the work does not already name one, **ask the user which project to plan in**, and pass its planning folder to the Atlas tools (`planningFolder`). Read that folder's own `AGENTS.md`, `PLANS.md` and `planning.json` before changing anything; they govern, and the bundled [governance](assets/planning/AGENTS.md) and [plan contract](assets/planning/PLANS.md) are the defaults they start from.

No match: ask the user which project the work belongs to; when it is a listed project, offer to add this folder to it (in the app, or in its `planning.json`); otherwise offer to [set up a project](#set-up-a-project). A request about Atlas itself or about several projects is [work across projects](#work-across-projects). Ordinary coding never waits for planning.

## When to plan

Plan when the user is designing something, or asks for work whose requirements, boundaries or tradeoffs need settling or that must survive across sessions. Small, clear tasks stay plain coding: no work item, no interview. When work qualifies, **ask the user before opening a work item**; then `work_create` allocates the next number, writes `active/NNNN-slug/plan.md` with a draft header and its ledger with the planning steps, and registers it. Always give it a `summary`: two or three plain sentences on what the work is, why, and where it stands. Continue existing work only as the user selects it or the registry's `current_plan` points; never by the newest file or the highest number.

## Interview and record

Find facts yourself; put only genuine decisions to the user, with your recommendation, and wait. Settled answers stay settled. [Domain modeling](../atlas-grill/references/DOMAIN-MODELING.md) keeps the language sharp and links the [glossary](../atlas-grill/references/CONTEXT-FORMAT.md) and [ADR](../atlas-grill/references/ADR-FORMAT.md) formats. When the user asks to be grilled, the questioning runs as [atlas-grill](../atlas-grill/SKILL.md): rounds over a design tree until nothing is left open.

Record as understanding settles, not only at the end:

- **The plan's `summary`** (its header): what the work is, why, and where it stands, in two or three plain sentences. Keep it current: when the design settles, at acceptance, and as the work moves. The plan body does not repeat the header (no status line).
- **The ledger's planning steps,** there from the work's creation ("Understand the request", "Settle the design", "Write the plan", "Accepted"): keep them true while designing with the step tools, renaming, adding or removing them to fit the work; `work_accept` marks them done.
- **`plan.md`:** the intended outcome, scope, decisions, dependencies, edge cases and completion checks, in whatever shape the work needs. Label proposals and open questions; never present a recommendation as the user's decision.
- **`CONTEXT.md`:** the work's glossary, updated the moment a term resolves; terms only.
- **`docs/adr/`:** only for a decision that is hard to reverse, surprising without context and the result of a real tradeoff.
- **`knowledge/`:** decisions, lessons and observations useful beyond one work item, each with its scope, source and confidence, in folders by topic as content warrants them. A small task with something worth keeping gets one concise record here, without a work item.
- **The ledger** is only its header, the steps and `blocked` the tools write. During implementation it also holds the final-review list ([atlas-implement](../atlas-implement/SKILL.md)). It has no other prose: progress shows in the steps and the plan's `summary`, and the evidence is in the commits and PRs.

Write references to PRs, issues and commits in full, naming the repository yourself from the checkout you work in: `owner/repo#12`, `owner/repo@4ab195a`, or their URLs. Atlas links these; `repo#12`, `#12` and a bare hash stay plain text.

Keep one record per thing and consolidate rather than add summaries; skip transcripts, command logs and lessons manufactured from routine edits. Current code, tests and canonical product documentation establish what is true now; plans and archived work are intent and history, and old permissions authorize nothing new. Link canonical documentation in its own repository instead of copying it.

When the user agrees to the plan, record it with `work_accept` and bring the summary up to date. Before handing off, reconcile the files with the final agreement and link the work folder.

## State through the Atlas tools, prose as files

The Atlas tools are the reliable way to change planning state; each validates, refuses with the reason, and never commits.

| Tool                                                 | Use it to                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `where`, `work_status`                               | find the projects and active work; read a work item's state and statistics           |
| `project_create`                                     | create a project from a name and folders, once the user agreed                       |
| `work_create`                                        | open a work item with its summary and planning steps, once the user agreed           |
| `work_accept`                                        | record that the user accepted the design; its planning steps are done                |
| `work_start`                                         | start implementation, adding the agreed steps after the planning steps               |
| `step_add`, `step_set`, `step_rename`, `step_remove` | keep the ledger's steps current; tell the user why a step is removed                 |
| `work_block`                                         | set or clear what blocks the work                                                    |
| `work_close`                                         | close verified work; refused while items are open                                    |
| `work_archive`, `work_reopen`                        | archive superseded (by which work) or abandoned (why) work; bring archived work back |
| `work_continue`                                      | record that a work item continues other work, in any project                         |

Do not hand-edit what the tools own: work-item registrations, the statuses and dates they set, the `superseded`/`abandoned` disposition `work_archive` sets, the ledger header and moves between `active/` and `archive/`.

Everything else is an ordinary file: plan bodies, the ledger's final-review list, glossaries, ADRs, knowledge and diagrams. Edit them directly at their absolute paths in the planning folder, from any checkout. After each edit there, Atlas checks the file and hands back any problems to fix.

Commit planning changes yourself, in the planning folder's own Git and with explicit pathspecs (`git -C <planning-folder> add -- <paths>`, then commit), at coherent milestones. Never stage unrelated changes, and keep planning and product histories separate.

## Checks and statistics

Hooks run them: after each edit in the home, Atlas checks the planning files you changed; when a session or subagent stops, it measures the session's time, tokens, models and subagents for the work items the session touched, as planning or implementation by the work's stage. Nothing needs reporting by hand. Only when the hooks are not installed (no Atlas context at session start) run `atlas check <files>` after editing, and `atlas work report <planning-folder> --work <work-id> --step <title>` when work starts and at each step transition.

## Set up a project

A project is a name and its folders: the folders on this computer where its work happens, such as `~/work/shop`. Check with `where` that no project covers the work already, then, with the user's agreement, call `project_create` with the name and the folders. It makes the planning folder from the bundled templates, as its own Git repository with a first commit; a session in those folders then belongs to the project. The user can also create one in the Atlas app. A folder can be added later in the app, or in `planning.json` by hand.

Only without the Atlas tools and command, make one by hand: create `<home>/planning/<name>`, run `git init` there and copy in the bundled templates (Atlas checks edits there once `planning.json` is in place): [AGENTS.md](assets/planning/AGENTS.md), [PLANS.md](assets/planning/PLANS.md), [README.md](assets/planning/README.md), [planning.json](assets/planning/planning.json), [plan-frontmatter.md](assets/planning/plan-frontmatter.md) and, when no attributes policy exists, [.gitattributes](assets/planning/.gitattributes). Set the project's `name` and `folders` in `planning.json`, run `atlas check <folder>` and commit the baseline. Agents find only planning folders in the home; hidden and archived projects are not found either.

## Work across projects

When no project covers the folder the session is in, or the user asks to review, organize or bring Atlas up to date:

1. **List the projects** with `where`. The user's request says which to go through; otherwise go through every active one.
2. **Go through each project's active work:** its `planning.json`, and for every active work item its plan and `work_status`.
3. **Reconcile them with what actually happened.** The evidence is the Git history of the repositories in the project's folders (branches, merges, tags), their PRs where the hosting service is reachable, the planning folder's own history and, when the harness offers one, its thread or session history (the conversations that planned or implemented the work). Look for steps done but still open, merged PRs and outcomes the plan's summary lacks, decisions settled in a conversation but missing from the plan, work finished or replaced but still active, and a stale `blocked`. Rely on Git and the PRs when no conversation history is available, and say so.
4. **Update what the evidence settles:** steps the evidence shows done, the plan's summary and links, citing the evidence (commit, PR, date) to the user. **Ask before consequential changes** (closing, archiving, reopening, removing steps, rewriting a plan's decisions, opening work), each with its evidence and your recommendation, one project at a time.
5. **Commit** each planning folder's changes in its own Git, and end with a short account per project: what changed, and what awaits the user.

## Organize existing material

To bring an existing planning repository, older plans or records scattered around the project's folders into a project, follow [the organization workflow](references/organization.md): a recoverable baseline before any move, originals preserved, classification by evidence, links repaired and preservation verified.

## Diagrams

When the work settles domain concepts, boundaries or data structure, offer a diagram, and make it if the user agrees; plain UI or tooling work gets none. A diagram is a file in the work folder, edited like any other and linked from the plan under the heading it explains. [Diagrams](references/diagrams.md) says how to write one.

## Close

Close with `work_close` once the agreed completion criteria are verified and the outcome is recorded; for PR delivery that means the required PRs merged, unless the work agreed otherwise. Acceptance, implementation, PR readiness, merge and release are separate facts: record pending ones accurately. Unfinished scope stays active, or is explicitly transferred or dropped (`step_remove`, telling the user why). Closing never grants merge or deployment.

The domain-modeling method and the glossary and ADR formats are [atlas-grill](../atlas-grill/SKILL.md)'s, adapted from Matt Pocock's MIT-licensed skills.
