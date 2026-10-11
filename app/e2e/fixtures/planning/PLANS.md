# Work items and metadata

Every normalized work folder has one main `plan.md` and, once implementation begins, one main `ledger.md` at its root. The folder name identifies the feature; do not give these files feature-specific names. The registry still selects authority explicitly. Retained legacy names remain readable during adoption; organize them reversibly before renaming, repairing pointers and links. `plan.md` is the main review entry point for intended work. Its body is flexible: communicate the outcome, scope, important edge cases, boundaries, consequential choices, dependencies, and completion checks at the detail the work needs. It may include implementation steps and links to supporting documents. No mandatory sections, phases, specification file, or prose style apply.

## Registry version 1

`planning.json` is a JSON object with `schema_version: 1`, `repositories`, and `work_items`. It indexes scope and locations; lifecycle status remains in plan frontmatter rather than being duplicated here.

Each `repositories` entry has:

| Field | Contract |
|---|---|
| `id` | Unique stable lowercase repository ID, using letters, digits, and hyphens. |
| `name` | Readable nonempty repository name. |
| `path` | Optional nonempty local checkout path, absolute or relative to the planning root. A discovery hint that may vary by machine. |
| `remote` | Optional nonempty remote URL, also a hint. A remote is not required. |

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
  "repositories": [{"id": "example-app", "name": "Example app", "path": "../example-app"}],
  "work_items": [
    {"id": "work-0001", "path": "active/0001-example-change", "repositories": ["example-app"], "current_plan": "active/0001-example-change/plan.md"},
    {"id": "work-0002", "path": "legacy/unclassified-notes", "repositories": [], "current_plan": null}
  ]
}
```

Legacy records may remain in retained locations outside `active/` and `archive/` during adoption. Index them before broad migration. Records outside planning are candidates for inspection and retained provenance, not direct external work-item paths: import useful contents safely before registering their planning destination.

## Plan frontmatter version 1

A current plan uses a YAML frontmatter block delimited by `---`, with the following fields. [plan-frontmatter.md](plan-frontmatter.md) is a standalone minimal example, not a work item.

| Field | Type and meaning |
|---|---|
| `schema_version` | Integer `1`. |
| `kind` | String `plan`; distinguishes intended work from current-state documentation. |
| `id` | Registered work-item ID. All revisions of that work's plan retain its ID. |
| `title` | Nonempty readable title. |
| `repositories` | Array of registered repository IDs affected by this plan, agreeing with the work item's scope. Empty only for retained legacy work whose scope is unknown. |
| `created` | ISO `YYYY-MM-DD` date string or null if original creation is unknown. Never use adoption date as guessed legacy creation. |
| `updated` | ISO date string for the latest substantive record update, or null for an untouched legacy record whose update date is unknown. |
| `design_status` | `draft`, `accepted`, `superseded`, or `abandoned`. |
| `implementation_status` | `unknown`, `not_started`, `in_progress`, `partial`, or `complete`. |
| `accepted_at` | ISO date string for known design acceptance, otherwise null. Acceptance is not implementation. |
| `completed_at` | ISO date string for known implementation completion, otherwise null. Completion does not imply merge or release. |
| `supersedes` | Array of replaced registered work-item IDs, empty when none are established. |
| `superseded_by` | Replacement registered work-item ID, or null. |

All fields are present in normalized plans. Serialize dates as quoted strings and unknown values as null. Readers also accept existing plain ISO date scalars in date fields without inventing chronology. Quote intended string values that resemble YAML booleans, nulls, numbers, or timestamps: implicit typing varies between YAML readers, so the checker conservatively rejects ambiguous strings rather than certifying the wrong type. Preserve the full body and attachments when adding metadata. Do not classify a record as a plan merely because it is Markdown. Keep unclassified legacy records indexed while investigating their status; full metadata normalization is not a prerequisite for using the repository.

`accepted` means agreement on intended work. `superseded` and `abandoned` are explicit design dispositions; they do not erase partial implementation. Implementation may be unknown for accepted historical plans. `partial` means some intended scope is implemented without claiming completion. Record evidence and any remaining or transferred scope in the ledger. A design that was accepted and later superseded may retain its known acceptance date. Leave unknown lifecycle dates null even when the corresponding status is known. A known `completed_at` requires `implementation_status: complete`; acceptance dates require evidence of acceptance, not merely a draft's existence.

Replacement relationships identify work items, not paths; update both sides when known. Same-work plan revisions retain the work ID and are tracked by Git rather than self-supersession. Record an intentional current-plan switch and its consequences; do not silently retarget an ongoing implementation.

## Identity, selection, and closure

Use one repository-wide registration sequence across active, archive, and indexed legacy work. Assign the next unused number, padded to at least four digits, and a descriptive folder slug: `active/0001-example-change/`. Numbers show registration order, not age, authority, or completion order. Never reuse an assigned identity after closure.

Keep the root lean: `plan.md`, `ledger.md` when needed, and a useful glossary. Update existing records instead of adding parallel specifications, progress summaries, handoffs, PR drafts, or per-phase command diaries. Use the ledger for progress and closure when it exists; a separate outcome/README is optional only when it improves navigation. Group retained historical notes under `supporting/`, verification artifacts under `evidence/`, and qualified ADRs under `docs/adr/`; do not create empty folders or discard originals. Existing detailed phase contracts may remain in grouped phase folders. Create supporting files only when useful: `CONTEXT.md` for the work's domain glossary, `docs/adr/` for qualifying decisions, `ledger.md` for implementation, and `evidence/` for meaningful verification. Keep these original documents together through archive moves.

Use the user's selected plan or the registry's explicit `current_plan`. If they conflict or the pointer is null, resolve the actual selection before plan implementation. Record its path and planning Git revision in the ledger before execution. Current code and canonical documentation establish present reality; an old or superseded plan is historical context, not current authority.

`active/` holds work expected to continue. `archive/` holds completed or deliberately closed work, including abandonment and supersession. Close automatically after verified agreed completion and outcome recording; PR-delivered work defaults to required PRs merged unless agreed criteria differ. Readiness, merge, release, and pending external actions remain explicit ledger milestones. Moving a folder updates its registry path, current-plan pointer, and references, while preserving its ID, body, and supporting files. Scope left unfinished must remain active or be accounted for as transferred, superseded, or deliberately dropped.

## Ledger status version 2

The root `ledger.md` records actual progress and implementation provenance; its body stays flexible. A small YAML header lists the agreed steps of the work, so its progress and the work left are visible without parsing narrative prose:

```yaml
---
schema_version: 2
kind: ledger
work_id: work-0001
updated: "2026-10-11"
blocked: null
steps:
  - title: "Implement the agreed query behavior"
    status: done
  - title: "Verify tenant boundaries"
    status: doing
  - title: "Complete review and handoff"
    status: todo
---
```

`work_id` matches the registered work; `updated` is an ISO date or null when unknown; `blocked` is a nonempty string or null. `steps` lists the agreed steps in order, and is `[]` until steps are established. Each step has exactly two fields: a `title`, a nonempty string unique within the ledger, and a `status` of `todo`, `doing` or `done`. Several steps may be `doing` at once. Write one block entry per step exactly as shown: the `-` of every entry in the same column, `status` aligned under `title`, spaces only, and the title in double quotes. Tools show progress as done steps over all steps; the work left is the steps not yet done, an estimate by count, not by time.

Derive the steps from the accepted plan when implementation starts: one step per meaningful deliverable or milestone, not per command. Update statuses at meaningful transitions: before a substantial execution stretch, when a step starts or finishes, when genuinely blocked, and at handoff. When agreed scope gains a step, add it and record the amendment. Never drop an agreed step silently: mark it done, or record in the body why it was transferred or dropped and remove it then. Once implementation is complete every step is done; report pending review and merge accurately in the body. Do not record every command, predict unagreed work, or promise continuous live telemetry.

### Version 1 (legacy)

Earlier ledgers use `schema_version: 1` with `current` (a nonempty string or null) and `next` (a list of nonempty strings) in place of `steps`. Tools still read them and show the reported focus and next steps, without progress. Rewrite a version-1 header as version 2 when its work resumes, keeping the body. Historical ledgers without a header remain readable and their present focus remains unknown; do not copy old activity into a new current claim.
