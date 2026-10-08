# Agent interface

Atlas exposes the same operations through `createWorkspace(root).execute(name, arguments)`, the `atlas` JSON CLI, and its stdio MCP server. Model data persists independently of a dashboard or agent session under `.atlas/models`. Immutable revision files live under `.atlas/history`; prepared scenes/results and exports are separate output files. Keep model/history files when moving a workspace. No hosted AI or HTTP model service is required.

Install from the verified package (`npm pack`, then `npm install /path/to/ontouml-atlas-0.5.0.tgz`), or use `node bin/atlas.cjs` from a checkout. Run `atlas tools` for the authoritative JSON schemas. CLI operation names omit the MCP `atlas_` prefix:

```sh
atlas create --root /workspace --input create-request.json
atlas inspect --root /workspace --input inspect-request.json
atlas revise --root /workspace --input revision-request.json
atlas export --root /workspace --input export-request.json
atlas mcp --root /workspace
```

A create request is `{ "input": { "project": <standard OntoUML exchange project>, "title": "Design", "workId": "work-0008" } }`. Structural profiles instead supply `profile` and `model` as documented in [architecture.md](architecture.md). An inspect/export/validate/prepare request is `{ "handle": "<returned handle>" }`. Load/import takes a workspace-relative `file`. Load preserves an existing JSON document's revision and is idempotent; import creates a new imported revision. Importing a different document with an already stored semantic identity reports a conflict rather than overwriting it.

A revision takes the returned `expectedRevision` and either envelope `changes`, whole-model replacement, or an `operations` batch. Each operation identifies `collection`, `action` (`upsert` or `delete`), `id`, and an upsert `value` with the same ID. OntoUML uses the exchange `elements` collection. Structural profiles use `nodes`, `relations`, `generalizations`, and `generalizationSets`. Apply all related reference/property/ownership changes in one batch: validation occurs before writing anything. A failed batch or stale revision leaves the current document intact. Model edits cannot change retained captures or profile. Store locks prevent overlapping writers; abandoned locks with demonstrably absent processes recover on restart, while ambiguous locks report `WORKSPACE_BUSY`.

Configure any MCP client with command `node` and args `[/absolute/path/to/bin/atlas.cjs, mcp, --root, /workspace]`. Windows accepts forward slashes in JSON paths. Server stdout contains only MCP messages; failures are structured tool errors. Capture/comparison tools appear as their adapters are delivered. The planning skill is [worktrail-atlas](https://github.com/envsemble/worktrail/tree/main/skills/worktrail-atlas).

Inspection/validation default to 25 entries (maximum 100), with focused `elementId` inspection and `offset` pagination. Preparation writes a payload locally and returns `payloadFile`; the full scene does not enter the agent context. Responses exceeding 16 KiB become `resultFile` references. Files stay inside the configured root, including symlink resolution; exports cannot overwrite semantic storage and existing differing outputs require a new filename. Model files are limited to 32 MiB; import inputs to 64 MiB. CLI validation findings exit 1, malformed operations/errors exit 2. Ontology findings remain inspectable and exportable, with their coverage limits visible.

The capability tests use an actual MCP SDK client and a separate CLI process, then restart the server and reopen the exported HTML. A 100-node warm inspect/validate fixture targets under one second; layout/compiler startup and HTML bundling have separate budgets. These measurements bound tested workloads, not arbitrary repository sizes.

For design iteration, use `atlas_proposal`, then `atlas_revise` and `atlas_compare`. `atlas_merge` takes explicit `ancestorHandle`, `leftHandle` and `rightHandle`; inspect its conflicts before `atlas_resolve_merge` with named choices and `expectedRevision`. `atlas_adopt_snapshot` retains a newer capture without replacing proposed facts. `atlas_map` adds an authored cross-layer link with a reason and explicit target element. See [comparison.md](comparison.md) for identity, ancestry, conflict and presentation rules. These operations share the same persisted handles and response budgets.
