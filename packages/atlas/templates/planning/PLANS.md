# Work items and metadata

A work item is a folder, `active/0001-example-change/` or under `archive/`, with `plan.md` and `ledger.md` at its root. The folder name identifies the work; the files keep these names. `plan.md` is where a reviewer starts: its body has no required sections or style, and says the outcome, scope, edge cases, consequential choices, dependencies and completion checks at the detail the work needs.

## Registry version 2

`planning.json` is a JSON object with exactly `schema_version: 2`, `name`, `folders` and `work_items`:

- `name` names the project (nonempty, at most 100 characters).
- `folders` lists the absolute paths of the folders the project covers on this computer, possibly none. A session in one of them, or inside one, belongs to this project (the deepest wins when projects' folders nest), and so does a session in this planning folder.
- `work_items` lists every work item, active and archived:

| Field          | Contract                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------ |
| `id`           | Unique stable `work-` ID with at least four zero-padded digits, such as `work-0001`.       |
| `path`         | POSIX-style path of the work folder, relative to this folder, inside it, with no `..`.     |
| `current_plan` | The work folder's `plan.md`: `<path>/plan.md`.                                             |

Every registered folder and plan exists. The registry holds locations only: status lives in the plan's header.

```json
{
  "schema_version": 2,
  "name": "Example",
  "folders": ["/home/example/work/example"],
  "work_items": [
    {"id": "work-0001", "path": "active/0001-example-change", "current_plan": "active/0001-example-change/plan.md"}
  ]
}
```

## Plan frontmatter version 2

A plan starts with a YAML block delimited by `---`; [plan-frontmatter.md](plan-frontmatter.md) is an example. The Atlas tools write it for new work and change its statuses and dates as the work is accepted, started, closed, archived or reopened, updating `updated` each time. Set by hand only what no tool sets, such as the replacing plan's `supersedes`.

| Field                   | Type and meaning                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema_version`        | Integer `2`.                                                                                                                                                                                                                                     |
| `kind`                  | String `plan`.                                                                                                                                                                                                                                   |
| `id`                    | The registered work ID; it never changes.                                                                                                                                                                                                        |
| `title`                 | Nonempty readable title.                                                                                                                                                                                                                         |
| `summary`               | Optional string on one line: two or three plain sentences on what the work is, why, and where it stands. Agents keep it current; `atlas check` warns when an active plan has none.                                                               |
| `created`               | ISO `YYYY-MM-DD` date string, or null when unknown.                                                                                                                                                                                              |
| `updated`               | ISO date string of the latest substantive update, or null when unknown.                                                                                                                                                                          |
| `design_status`         | `draft`, `accepted`, `superseded` or `abandoned`.                                                                                                                                                                                                |
| `implementation_status` | `unknown`, `not_started`, `in_progress`, `partial` or `complete`.                                                                                                                                                                                |
| `accepted_at`           | ISO date string of the design's acceptance, otherwise null. Acceptance is not implementation.                                                                                                                                                    |
| `completed_at`          | ISO date string of the implementation's completion, otherwise null; it requires `implementation_status: complete`. Completion is not merge or release.                                                                                           |
| `supersedes`            | Array of the work IDs this work replaces, possibly empty.                                                                                                                                                                                        |
| `superseded_by`         | The work ID that replaces this work, or null.                                                                                                                                                                                                    |
| `continues`             | Optional: the work this work continues (follow-ups of work that closed, a next phase), one reference or a list: `work-0023` here, or `folder:work-0023` in another project of the home, by its planning folder's name. Set it with `work_create` or `work_continue`. |

Every field but `summary` and `continues` is present. Write dates as quoted strings and unknown values as null, and quote strings that look like YAML booleans, nulls, numbers or timestamps: the checker rejects ambiguous ones.

`superseded` and `abandoned` are design dispositions; they do not erase what was implemented. `partial` means some scope is implemented without claiming completion; say in the plan what is left or transferred. Replacement links work IDs, not paths: update both plans. A plan's revisions keep its ID and are tracked by Git.

## Identity and lifecycle

`work_create` assigns the next number across active and archived work, with a descriptive slug, writes the plan header and the ledger, and registers the work. Numbers show registration order, nothing more, and are never reused.

A work folder holds `plan.md`, `ledger.md`, `CONTEXT.md` (the glossary) when useful, diagrams under `diagrams/`, and whatever else the work needs; Atlas gives other files no meaning. Update existing records instead of adding parallel specifications, progress summaries or handoffs.

`active/` holds work expected to continue; `archive/` holds completed, superseded and abandoned work. `work_close` refuses while steps are open or the work is blocked, then marks the implementation complete and archives the folder. `work_archive` archives unfinished work as `superseded` (naming its replacement) or `abandoned` (with the reason, written into the plan). `work_reopen` brings archived work back with new steps. Each move keeps the ID, the body and the supporting files, and updates the registry and links.

## Ledger status version 2

`ledger.md` is the work's steps: a YAML header, the planning steps from the work's creation, the steps the plan proposes while it is designed, and then the implementation steps. It has no body except, during implementation, a short `## Final review` list of the minor findings deferred to the final review.

```yaml
---
schema_version: 2
kind: ledger
work_id: work-0001
updated: "2026-10-11"
blocked: null
steps:
  - title: "Understand the request"
    status: done
    phase: planning
  - title: "Settle the design"
    status: done
    phase: planning
  - title: "Implement the agreed query behavior"
    status: done
  - title: "Verify tenant boundaries"
    status: doing
  - title: "Complete review and handoff"
    status: todo
---
```

`work_id` is the registered work; `updated` is an ISO date or null; `blocked` is a nonempty string or null. Each step has a `title`, unique within the ledger, a `status` of `todo`, `doing` or `done` (several may be `doing`), and optionally a `phase`: `planning`, or `proposed` for an implementation step the plan proposes before the work starts (always `todo`); a step without one is an implementation step. Write each entry exactly as shown: entries in one column, `status` and `phase` under `title`, spaces only, the title in double quotes. Progress is done steps over all steps but the proposed ones; the work left is an estimate by count, not by time.

The tools write this header; do not edit it by hand. `work_create` writes the planning steps "Understand the request" (doing), "Settle the design", "Write the plan" and "Accepted", which agents keep true while designing. `work_accept` marks every planning step done. While designing, `step` (action `propose`) replaces the proposed steps, which Atlas shows dimmed and outside the progress. `work_start` adds the implementation steps, one per meaningful deliverable or milestone, in place of the proposed ones; without steps, it adopts them. The `step` tool moves a step when it starts or finishes (action `set`), adds agreed scope (`add`; record the amendment in the plan), renames a step (`rename`), and drops or transfers one (`remove`), telling the user why. `work_block` sets or clears `blocked`.

## Work statistics

Atlas's hooks measure the time, tokens, models and subagents of each session that works on a work item, as planning while its plan is a draft (or a session amends an accepted plan) and implementation after. The reports live in the Atlas home's database, not in this folder; agents report nothing.

## Diagrams

A diagram is a PlantUML (`.puml`) file in the work folder, in the subset Atlas renders, linked from the plan under the heading it explains. Edit it like any other file; `atlas check` rejects what the subset does not allow. The `atlas` skill's diagram reference describes the syntax.
