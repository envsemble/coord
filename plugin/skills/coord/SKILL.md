---
name: coord
description: "Records projects and their work items in Coord: plans, steps, glossaries and diagrams in planning folders in the Coord home. Use whenever the user mentions Coord, a project, a work item, a plan or a ledger; when they design something or ask for work big enough to plan; when they want something recorded, reviewed or brought up to date. Small, direct coding tasks need none of it."
---

# Coord

Coord keeps plans in projects. A project is a planning folder, its own Git repository in the Coord home (`~/.coord/planning/<name>`), and the folders on this computer where its work happens. Coord records projects and their work items, nothing else. This skill finds the project, decides when to plan, records the work and keeps it current. Two workflows build on it, each run only when the user asks for it by name: [coord-grill](../coord-grill/SKILL.md) questions the user in rounds until a design is settled, and [coord-implement](../coord-implement/SKILL.md) keeps an accepted plan's work item true while it is implemented.

Every planning folder has its own `AGENTS.md` (what is true, what to keep), which governs it: read it before changing anything there. Its `PLANS.md` defines the plan, registry and ledger formats; the tools write headers and ledgers and Coord checks every edit, so consult it only when you edit a header or ledger by hand. This skill says what to do and when.

## Find the project

- At session start Coord names the session's project, its planning folder and its active work, with the work other projects keep that is in this one (named `project:work-0048`). Without that context, call `where`: it lists every active project in the home and marks the ones the session belongs to.
- A session belongs to the project whose folder it is in (the deepest folder wins when they nest), or whose planning folder it is in. A location the user gives wins.
- **Several match:** ask the user which project to plan in, and pass its planning folder to the tools (`planningFolder`).
- **None matches:** ask which project the work belongs to. For a listed project, offer to add this folder to it (in the project menu of the app's plans, or in its `planning.json`); otherwise offer to [set up a project](#set-up-a-project). A request about Coord itself or several projects is [work across projects](#work-across-projects).
- Stay in that project. Ordinary coding never waits for planning.

## When to plan

Plan when the user is designing something, or asks for work whose requirements, boundaries or tradeoffs need settling, or that must survive across sessions. Small, clear tasks stay plain coding: no work item, no interview.

When work qualifies, **ask before opening a work item** (follow-ups of work the user handed you to finish without them you open yourself, and say so), then call `work_create` with a `summary`: two or three plain sentences on what the work is, why, and where it stands. Continue existing work only as the user selects it or the registry's `current_plan` points, never by the newest file or the highest number.

When one task is better thought of as several ordered pieces, each with its own plan and steps (a migration in stages, a feature built layer by layer), plan it **in parts**: a work item has a number and is made of parts, each with its own plan and steps. The first part (`work-0034`, shown `#0034-1`) says what the parts add up to; each further part is made with `work_create` and `partOf` naming the work item, and gets its number with its own (`work-0034-2`). Work that exists becomes a part with `work_update` (`partOf`): it takes the work item's number, and its old ID still names it. A part's number never changes. A task one plan covers stays one work item; work that goes on after other work (follow-ups moved off work that is closing, a next phase) continues it (`continues`) rather than being its part.

When work involves several projects (a library's release and the applications that take it up), say which projects it is in with `projects` (`work_create`, `work_update`), each by its planning folder's name, for the whole and for each part: a part done in another project's folders is in that project, and stays in its group's planning folder. Coord then shows the work in each of those projects, and a session in any of their folders is told of it at its start, named with the project that keeps it (`envui:work-0048`): give the tools that name, so they change that work and not this project's work of the same number.

Find facts yourself; put only genuine decisions to the user, each with your recommendation, and wait for the answer. When the design has many open decisions, or the user asks to be grilled, run [coord-grill](../coord-grill/SKILL.md).

## Record

Record as understanding settles, not only at the end:

- **The plan's `summary`:** keep it saying what the work is and where it stands, when the design settles, at acceptance and as the work moves. The body does not repeat the header.
- **`plan.md`:** the outcome, scope, decisions with their reasons, dependencies, edge cases and completion checks, in whatever shape the work needs. Label proposals and open questions; never present your recommendation as the user's decision.
- **The ledger's steps:** the planning steps exist from creation; keep them true with the `step` tool. Once the plan names its implementation steps, propose them (action `propose`), so they show before the work starts. The ledger holds nothing else but, during implementation, its final-review list.
- **Follow-ups:** more work asked for on a work item already under way or delivered (a change after the user tried it, feedback on a PR) goes in its ledger like the work before it. Add a step for it (action `add`) and keep it `doing`, then `done`, as you work. When it changes what was agreed, add a short amendment to the plan saying what and why. A step is a deliverable the size of the plan's other steps: fold review findings, small fixes and tests into the step they belong to rather than giving each a step.
- **Tags** (`work_create`, `work_update`): what the work will be searched for later. Give the areas it touches (`search`, `hub`, `performance`, not activities like `fix`), at most about five, reusing the project's tags before inventing one; keep them true as the work changes. Add the release it ships in: where the project versions its releases, the version its manifest names (`package.json`); when that version is already tagged as released (`v<version>` in Git), ask the user which release the work goes in (in work handed over to finish without them, take the next version and record it as your decision).
- **`CONTEXT.md`:** the work's glossary, updated the moment a term resolves ([format](../coord-grill/references/CONTEXT-FORMAT.md)).

Coord shows a plan in a column about 100 characters wide. Keep a table to a few short columns (a word or a phrase each) and put long text in a list or paragraphs below it; A blank line inside a table ends it, and the rows after it show as text. `coord check` warns about a table that will read cramped, and about rows cut off from their table. Link a diagram from the sentence that is about it (`[the order model](diagrams/orders.puml)`): the link shows as the diagram.

Name work to the user as a link that opens it in Coord, as you would link a PR: `[coord#0032-2 Title](https://coord.envsemble.com/open#coord/0032-2)`, the project's planning folder's name, `#`, the work item's number and its part's (`work-0032` is `0032-1`). The tools' answers carry each work item's `name` and `link`; copy them. In planning files keep writing `work-0032-2`, which Coord links itself.

Write PRs, issues and commits in full, naming the repository from the checkout you work in: `owner/repo#12`, `owner/repo@4ab195a`, or their URLs. Coord links these; `#12` and a bare hash stay plain text.

Keep one record per thing, and update it rather than adding summaries. Skip transcripts and command logs. Lessons that outlive the work belong in the repository's own `AGENTS.md` or documentation, not in Coord.

When the user agrees to the plan, record it with `work_accept` and update the summary. Accepting a plan does not start it.

## State and files

Planning state (work items, steps, whose turn it is, closing) changes only through the Coord tools; their descriptions say what each does. Everything else is an ordinary file: plan bodies, the final-review list, glossaries, diagrams and whatever else a work folder holds. Edit them directly at their absolute paths, from any folder; after each edit, Coord checks the file and hands back what to fix. Do not hand-edit what the tools own: the registry's work items, the header statuses and dates, the ledger header, and moves between `active/` and `archive/`.

Commit planning changes yourself, in the planning folder's Git with explicit pathspecs (`git -C <planning-folder> add -- <paths>`), at coherent points. Keep planning and product commits apart.

Coord measures time, tokens and models for the work items a session touches; nothing is reported by hand.

## Whose turn it is

Every open work item says whose turn it is, and Coord shows the user exactly that: it never guesses it from what sessions do, so a state nobody keeps up misleads them. Set it with `state` whenever it changes, in the same turn as the change:

- **`working`** as you start working on the work (`work_start` sets it), and **`planning`** while you design it with the user (`work_create` sets it).
- **`your_turn`** whenever you stop for the user, with what they are to do, as an action they can take: "Merge owner/repo#12", "Try the new hub and say if the groups read right", "Answer round 3 of the grilling". A PR left for them to merge is their turn.
- **`waiting`** while the work waits on something that is no one's move here: a PR's checks or reviews ("CI on owner/repo#12"), another team, a date.
- **`blocked`** with why, while the work cannot go on.

A work item accepted and not started, or closed, needs none. When a session starts, Coord names what no longer adds up in the project's work (work under way that says nobody's turn, every step done but still open, the user's turn for days, a state untouched for a day): bring it up once, briefly, and fix what the evidence settles, such as a state that is out of date or work that is finished.

## Set up a project

A project is a name and its folders, such as `~/work/shop`. Check with `where` that no project covers the work already; then, with the user's agreement, call `project_create` with the name and the folders. It makes the planning folder with its first commit, and sessions in those folders belong to it from then on. The user can also create one, and add folders later, on the project menu of the app's plans.

## Work across projects

When the user asks to review projects or bring Coord up to date:

1. **List the projects** with `where`. Go through the ones the user names, otherwise every active one.
2. **Read each project's active work:** for every active work item, its plan and `work_status`.
3. **Reconcile it with what happened.** The evidence is the Git history of the repositories in the project's folders, their PRs where the host is reachable, the planning folder's history and, when the harness offers it, the sessions that planned or implemented the work. Look for steps done but still open, merged PRs the summary lacks, decisions settled in a conversation but missing from the plan, finished or replaced work still active, and a stale `blocked`.
4. **Update what the evidence settles** (steps, summaries, links, whose turn it is), citing the commit, PR or date. **Ask before consequential changes** (closing, archiving, reopening, removing steps, rewriting decisions, opening work), each with its evidence and your recommendation, one project at a time.
5. **Commit** each planning folder, and end with a short account per project: what changed, and what awaits the user.

## Diagrams

When the work settles domain concepts, boundaries or data structure and a diagram would help you and the user understand it the same way, make one, without waiting to be asked; plain UI or tooling work gets none. Build it on a capture of the existing code or database where there is one, rather than from memory. [Diagrams](references/diagrams.md) says how to write each kind.

When work in a work item changes a database's schema or a model's structure in a major way (tables or entities added, removed, split or merged, or the relations between them changed, not a column or a field alone), capture it before the change and after it, the second comparing with the first, also when nobody asked for a diagram: the pair is how the user later sees what happened.

## Pages

When the user should see something rather than read it (a visual choice to make, data worth looking at, a before and after), make a page: a small React view in the work item's `pages/`, on Coord's stack (envUI and the diagram viewer), which Coord shows in place. Make one without asking when it clearly helps, link it from the plan as a diagram is linked, and say it is there; most work needs none. A page can save the user's choices for you: act on them, and close each once it is settled. While a page waits on the user, say so in its `page.json` (`attention`), and clear it once nothing does. [Pages](references/pages.md) says how to write one.

## Close

Close the work item once its outcome is reached: the agreed completion checks pass, the outcome is in the plan and, for a PR, it is merged. Ask the user first, unless they handed you the work to finish without them; then close it with `work_close` and say so. Don't wait for them to remember: when work looks finished, say so, and ask unless the work was handed over. Acceptance, implementation, PR readiness, merge and release are separate facts: state pending ones accurately. Unfinished scope stays active, or is transferred or dropped with `step` (action `remove`), telling the user why. Closing never grants a merge or a deployment the user has not.
