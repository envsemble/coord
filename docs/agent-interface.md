# Agent interface

Atlas exposes the same operations through `createWorkspace(root).execute(name, arguments)`, the `atlas model` JSON commands, and the `atlas mcp` stdio server. Model data persists independently of the app or an agent session under `.atlas/models`. Immutable revision files live under `.atlas/history`; prepared scenes/results and exports are separate output files. Keep model/history files when moving a workspace. No hosted AI or HTTP model service is required.

[Install the atlas command](command.md#install) from a checkout (`npm link --workspace @envsemble/atlas-cli`), or use `npx atlas` inside it. Run `atlas model tools` for the authoritative JSON schemas. Command operation names omit the MCP `atlas_` prefix:

```sh
atlas model create --root /workspace --input create-request.json
atlas model inspect --root /workspace --input inspect-request.json
atlas model revise --root /workspace --input revision-request.json
atlas model export --root /workspace --input export-request.json
atlas mcp --root /workspace
```

A create request is `{ "input": { "project": <standard OntoUML exchange project>, "title": "Design", "workId": "work-0008" } }`. Structural profiles instead supply `profile` and `model` as documented in [architecture.md](architecture.md). An inspect/export/validate/prepare request is `{ "handle": "<returned handle>" }`. Load/import takes a workspace-relative `file`. Load preserves an existing JSON document's revision and is idempotent; import creates a new imported revision. Importing a different document with an already stored semantic identity reports a conflict rather than overwriting it.

A revision takes the returned `expectedRevision` and either envelope `changes`, whole-model replacement, or an `operations` batch. Each operation identifies `collection`, `action` (`upsert` or `delete`), `id`, and an upsert `value` with the same ID. OntoUML uses the exchange `elements` collection. Structural profiles use `nodes`, `relations`, `generalizations`, and `generalizationSets`. Apply all related reference/property/ownership changes in one batch: validation occurs before writing anything. A failed batch or stale revision leaves the current document intact. Model edits cannot change retained captures or profile. Store locks prevent overlapping writers; abandoned locks with demonstrably absent processes recover on restart, while ambiguous locks report `WORKSPACE_BUSY`.

Configure an MCP client with command `node` and args `[/absolute/path/to/atlas/packages/cli/bin/atlas.js, mcp, --root, /workspace]`. This form works on every platform and is required on Windows, where `npm link` installs only `atlas.cmd` and `atlas.ps1` shims that clients spawning a process directly cannot launch; JSON paths may use forward slashes. On Linux and macOS, command `atlas` with args `[mcp, --root, /workspace]` also works once the command is linked. In a shell, `atlas mcp --root /workspace` works everywhere. Server stdout contains only MCP messages; failures are structured tool errors. Capture/comparison tools appear as their adapters are delivered. The planning skill is [atlas-model](../skills/atlas-model/SKILL.md).

Inspection/validation default to 25 entries (maximum 100), with focused `elementId` inspection and `offset` pagination. Preparation writes a payload locally and returns `payloadFile`; the full scene does not enter the agent context. Responses exceeding 16 KiB become `resultFile` references. Files stay inside the configured root, including symlink resolution; exports cannot overwrite semantic storage and existing differing outputs require a new filename. Model files are limited to 32 MiB; import inputs to 64 MiB. `atlas model validate` findings exit 1, malformed operations/errors exit 2. Ontology findings remain inspectable and exportable, with their coverage limits visible.

The capability tests use an actual MCP SDK client and a separate CLI process, then restart the server and reopen the exported HTML. A 100-node warm inspect/validate fixture targets under one second; layout/compiler startup and HTML bundling have separate budgets. These measurements bound tested workloads, not arbitrary repository sizes.

For design iteration, use `atlas_proposal`, then `atlas_revise` and `atlas_compare`; branch one proposal per alternative from the same capture when offering a choice of designs. `atlas_merge` takes explicit `ancestorHandle`, `leftHandle` and `rightHandle`; inspect its conflicts before `atlas_resolve_merge` with named choices and `expectedRevision`. `atlas_adopt_snapshot` retains a newer capture without replacing proposed facts. `atlas_map` adds an authored cross-layer link with a reason and explicit target element. See [comparison.md](comparison.md) for identity, ancestry, conflict and presentation rules. These operations share the same persisted handles and response budgets.
