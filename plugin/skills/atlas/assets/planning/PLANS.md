# Work items and metadata

Every normalized work folder has one main `plan.md` and one `ledger.md`, its steps, at its root. The folder name identifies the feature; do not give these files feature-specific names. The registry still selects authority explicitly. Retained legacy names remain readable during adoption; organize them reversibly before renaming, repairing pointers and links. `plan.md` is the main review entry point for intended work. Its body is flexible: communicate the outcome, scope, important edge cases, boundaries, consequential choices, dependencies, and completion checks at the detail the work needs. It may include implementation steps and links to supporting documents. No mandatory sections, phases, specification file, or prose style apply.

## Registry version 1

`planning.json` is a JSON object with `schema_version: 1`, an optional `name`, optional `workspaces`, `repositories`, and `work_items`. `name` names the project this planning folder is (nonempty, at most 100 characters); without it, Atlas uses the folder's name. `workspaces` lists the project's workspace folders, absolute paths of folders on this computer: an agent session in one of them, or inside one, belongs to this project and to no other, whatever its Git remotes (when workspace folders nest, the deepest wins); elsewhere a checkout belongs to the projects that register its remote. The registry indexes scope and locations; lifecycle status remains in plan frontmatter rather than being duplicated here.

Each `repositories` entry has:

| Field | Contract |
|---|---|
| `id` | Unique stable lowercase repository ID, using letters, digits, and hyphens. |
| `name` | Readable nonempty repository name. |
| `path` | Optional nonempty local checkout path, absolute or relative to the planning root. A hint that may vary by machine; an absolute path also lets a checkout without a registered remote find this folder. |
| `remote` | Optional nonempty Git remote URL. Atlas finds a checkout's planning folder by matching the checkout's remotes against these, so register it for every repository with one. |

Each `work_items` entry has:

| Field | Contract |
|---|---|
| `id` | Unique stable `work-` ID with at least four zero-padded digits, such as `work-0001`. |
| `path` | Nonempty POSIX-style path relative to the planning root to the retained work folder or legacy record. It stays inside planning and contains no `..` segments. |
| `repositories` | Array of registered repository IDs to which this work applies. Empty only while legacy scope remains unknown. |
| `current_plan` | Explicit POSIX-style planning-root-relative path to the main/selected plan, inside the work item's folder (or equal to `path` when indexing a single legacy plan file). Null when no main plan is identified; never infer it from the newest filename. |

Repository and work IDs are unique within their respective arrays; duplicate locations are reconciled rather than registered as competing work identities. All non-null plan pointers and retained paths must exist. Optional fields may be omitted; do not add narrative status or machine-dependent absolute work-item paths. Standard JSON null denotes unknown pointers.

Example:

```json
{
  "schema_version": 1,
  "name": "Example",
  "workspaces": ["/home/example/work/example"],
  "repositories": [{"id": "example-app", "name": "Example app", "remote": "https://github.com/example/example-app.git"}],
  "work_items": [
    {"id": "work-0001", "path": "active/0001-example-change", "repositories": ["example-app"], "current_plan": "active/0001-example-change/plan.md"},
    {"id": "work-0002", "path": "legacy/unclassified-notes", "repositories": [], "current_plan": null}
  ]
}
```

Legacy records may remain in retained locations outside `active/` and `archive/` during adoption. Index them before broad migration. Records outside planning are candidates for inspection and retained provenance, not direct external work-item paths: import useful contents safely before registering their planning destination.

## Plan frontmatter version 1

A current plan uses a YAML frontmatter block delimited by `---`, with the following fields. [plan-frontmatter.md](plan-frontmatter.md) is a standalone minimal example, not a work item. The Atlas tools write the header of new work and change the statuses and dates as the work is accepted, started, closed, archived, or reopened, updating `updated` each time; set by hand only what no tool sets, such as the replacing plan's `supersedes` list.

| Field | Type and meaning |
|---|---|
| `schema_version` | Integer `1`. |
| `kind` | String `plan`; distinguishes intended work from current-state documentation. |
| `id` | Registered work-item ID. All revisions of that work's plan retain its ID. |
| `title` | Nonempty readable title. |
| `summary` | Optional string, on one line: two or three plain sentences saying what the work is, why, and where it stands, for whoever finds the plan in a list. Agents keep it current as the work moves; `atlas check` warns when an active plan has none. |
| `repositories` | Array of registered repository IDs affected by this plan, agreeing with the work item's scope. Empty only for retained legacy work whose scope is unknown. |
| `created` | ISO `YYYY-MM-DD` date string or null if original creation is unknown. Never use adoption date as guessed legacy creation. |
| `updated` | ISO date string for the latest substantive record update, or null for an untouched legacy record whose update date is unknown. |
| `design_status` | `draft`, `accepted`, `superseded`, or `abandoned`. |
| `implementation_status` | `unknown`, `not_started`, `in_progress`, `partial`, or `complete`. |
| `accepted_at` | ISO date string for known design acceptance, otherwise null. Acceptance is not implementation. |
| `completed_at` | ISO date string for known implementation completion, otherwise null. Completion does not imply merge or release. |
| `supersedes` | Array of replaced registered work-item IDs, empty when none are established. |
| `superseded_by` | Replacement registered work-item ID, or null. |

All fields but `summary` are present in normalized plans. Serialize dates as quoted strings and unknown values as null. Readers also accept existing plain ISO date scalars in date fields without inventing chronology. Quote intended string values that resemble YAML booleans, nulls, numbers, or timestamps: implicit typing varies between YAML readers, so the checker conservatively rejects ambiguous strings rather than certifying the wrong type. Preserve the full body and attachments when adding metadata. Do not classify a record as a plan merely because it is Markdown. Keep unclassified legacy records indexed while investigating their status; full metadata normalization is not a prerequisite for using the repository.

`accepted` means agreement on intended work. `superseded` and `abandoned` are explicit design dispositions; they do not erase partial implementation. Implementation may be unknown for accepted historical plans. `partial` means some intended scope is implemented without claiming completion. Record evidence and any remaining or transferred scope in the plan. A design that was accepted and later superseded may retain its known acceptance date. Leave unknown lifecycle dates null even when the corresponding status is known. A known `completed_at` requires `implementation_status: complete`; acceptance dates require evidence of acceptance, not merely a draft's existence.

Replacement relationships identify work items, not paths; update both sides when known. Same-work plan revisions retain the work ID and are tracked by Git rather than self-supersession. Record an intentional current-plan switch and its consequences; do not silently retarget an ongoing implementation.

## Identity, selection, and closure

Use one repository-wide registration sequence across active, archive, and indexed legacy work. The `work_create` tool assigns the next unused number, padded to at least four digits, with a descriptive folder slug, `active/0001-example-change/`, writes its plan header and its ledger with the planning steps, and registers it. Numbers show registration order, not age, authority, or completion order. Never reuse an assigned identity after closure.

Keep the root lean: `plan.md`, `ledger.md`, and a useful glossary. Update existing records instead of adding parallel specifications, progress summaries, handoffs, PR drafts, or per-phase command diaries. The plan's `summary` and outcome record progress and closure; a separate outcome/README is optional only when it improves navigation. Group retained historical notes under `supporting/`, verification artifacts under `evidence/`, and qualified ADRs under `docs/adr/`; do not create empty folders or discard originals. Existing detailed phase contracts may remain in grouped phase folders. Create supporting files only when useful: `CONTEXT.md` for the work's domain glossary, `docs/adr/` for qualifying decisions, and `evidence/` for meaningful verification. Keep these original documents together through archive moves. Diagrams are files in the work folder too (see [Diagrams](#diagrams)), so they move with it. Synthetic test or trial material stays in a labelled `evidence/<trial>-fixtures/` folder with a README and is never registered as work.

Use the user's selected plan or the registry's explicit `current_plan`. If they conflict or the pointer is null, resolve the actual selection before plan implementation. Commit the plan before starting implementation (`work_start`), so its history shows what was agreed. Current code and canonical documentation establish present reality; an old or superseded plan is historical context, not current authority.

`active/` holds work expected to continue. `archive/` holds completed or deliberately closed work, including abandonment and supersession. Close after verified agreed completion and outcome recording; PR-delivered work defaults to required PRs merged unless agreed criteria differ. Readiness, merge, release, and pending external actions remain explicit steps or facts in the plan's summary. `work_close` refuses while steps are open or the work is blocked, then marks the implementation complete and archives the folder; `work_archive` archives work that is not complete only as `superseded` (naming the work that replaces it) or `abandoned` (with the reason), setting that disposition and recording the reason in the plan, and `work_reopen` brings archived work back with new steps. Each move updates the registry path, current-plan pointer, and links, while preserving the ID, body, and supporting files. Scope left unfinished must remain active or be accounted for as transferred, superseded, or deliberately dropped.

## Ledger status version 2

The root `ledger.md` is the work's steps: a small YAML header lists them, the planning steps from its creation and then the implementation steps, so its progress and the work left are visible from the start. It has no body, except during implementation a short `## Final review` section listing the minor findings deferred to the final review (see the atlas-implement workflow):

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

`work_id` matches the registered work; `updated` is an ISO date or null when unknown; `blocked` is a nonempty string or null. `steps` lists the agreed steps in order, and is `[]` until steps are established. Each step has a `title`, a nonempty string unique within the ledger, a `status` of `todo`, `doing` or `done`, and optionally a `phase`: `planning` for a step of designing the work; a step without a phase is an implementation step (`phase: implementation` says the same). Several steps may be `doing` at once. Write one block entry per step exactly as shown: the `-` of every entry in the same column, `status` and `phase` aligned under `title`, spaces only, and the title in double quotes. Tools show progress as done steps over all steps; the work left is the steps not yet done, an estimate by count, not by time.

The Atlas tools write this header; do not edit it by hand. `work_create` writes the ledger with the planning steps "Understand the request" (doing), "Settle the design", "Write the plan" and "Accepted"; keep them true while designing, renaming, adding or removing them to fit the work. Steps added before implementation starts are planning steps. `work_accept` marks every planning step done. `work_start` adds the implementation steps after them (creating the ledger for older work without one), derived from the accepted plan: one step per meaningful deliverable or milestone, not per command. `step_set` updates statuses at meaningful transitions: before a substantial execution stretch, when a step starts or finishes, and at handoff; `work_block` sets or clears `blocked`. When agreed scope gains a step, `step_add` adds it; record the amendment in the plan. Never drop an agreed step silently: mark it done, or remove it with `step_remove` and tell the user why it was transferred or dropped. Once implementation is complete every step is done; report pending review and merge accurately in the plan's summary. Do not record every command, predict unagreed work, or promise continuous live telemetry.

### Version 1 (legacy)

Earlier ledgers use `schema_version: 1` with `current` (a nonempty string or null) and `next` (a list of nonempty strings) in place of `steps`. Tools still read them and show the reported focus and next steps, without progress, but do not change them. Rewrite a version-1 header as version 2 by hand when its work resumes. Historical ledgers without a header remain readable and their present focus remains unknown; do not copy old activity into a new current claim.

## Work statistics

Atlas measures the work itself. Its hooks link each agent session to the work items it edits or changes through the Atlas tools, and whenever the session or one of its subagents stops, they read the session log on that computer (only read, never copied) and record a report in the Atlas home's database (`atlas.db`), not in this folder: `version` (1), `at` (the time of the report), `model` (the model identifier), `session` (the conversation identifier or null), `tokens` (tokens used so far as an agent reported them, or null), `step` (a ledger step title, or null), `stage` (`planning` or `implementation`) and, when the log could be read, `measured`: `since` (the session's previous report on this work item), `agentMs` (the agent's working time since then, in milliseconds), `models`, each with its `model`, `agentMs` and tokens by kind (`input`, `cacheRead`, `cacheWrite`, `output`), and, when subagents worked, `subagents`: their `count`, their own working time added up (`agentMs`), their `tokens`, and the busiest few in `agents`. Older planning folders kept these reports as `<work>/.atlas/statistics.jsonl`; `atlas setup` imports such files from the planning folders in the Atlas home, and `atlas home adopt` from the folder it moves in; both delete the imported files, leaving the removal to commit. Planning folders outside the home are left untouched until they move in.

The stage is `planning` while the plan is a draft, and `implementation` once it is accepted; a session that edits an accepted plan counts as planning, because it amends the design. Reports without a stage are from before stages were recorded.

Where the hooks are not installed, report by hand when work starts and at each step transition: `atlas work report <planning-root> --work <work-id> --step <title>`, adding `--model`, and `--session` and `--tokens` when known, outside a harness whose log Atlas can read. Never estimate tokens. Tools count a measured interval as measured, and estimate the others from the time between a session's reports (a gap of more than two hours is a break) and the growth of its reported tokens; a session's first report on a work item is its starting point. Plan exports leave the file out. `atlas check` warns about lines that are not valid reports and never fails on them.

## Diagrams

A diagram is a PlantUML (`.puml`) file in the work folder, written in the subset Atlas renders, and linked from the plan with an ordinary Markdown link under the heading it explains. Agents edit diagrams like any other file; `atlas check` rejects what the subset does not allow. Diagram syntax is described in the `atlas` skill's diagram reference, not here. Their history is the planning folder's Git history.
