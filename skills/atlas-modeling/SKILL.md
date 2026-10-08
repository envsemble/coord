---
name: atlas-modeling
description: Use Atlas to inspect, validate, revise and visualize conceptual models while planning, reopen portable HTML, and work from explicitly captured source baselines. Model editing happens through its tools, not a diagram editor.
---

# Atlas modeling

Use Atlas as a modeling tool within the user's planning work. Keep plans, decisions, glossary ownership and lifecycle in the associated planning repository. Link diagram identities to selected passages; embedded context is supporting evidence, not a second authoritative plan.

Prefer the configured Atlas MCP tools. If unavailable, use the installed `atlas` CLI (`atlas tools` exposes its JSON contracts) or the package's `createWorkspace(root).execute` API. A checkout also runs with `node /path/to/bin/atlas.cjs`. Configure an explicit workspace root; models persist under its `.atlas/models` independently of the dashboard. Do not install or reconfigure the user's MCP client unless requested.

Load/reopen an existing document before recreating it. `atlas_load` preserves Atlas JSON revisions; `atlas_import` recovers an exported HTML's model without executing the page. Import preserves capture claims and marks them imported; it does not verify an unavailable source. `atlas_inspect` returns handles, revisions and focused elements. Inspect by identity, use small pages, and read a returned file reference only when needed.

Choose `ontouml` for authored conceptual interpretation. Its model is standard OntoUML exchange JSON; use the library's `Project` builders or preserve existing exchange elements. `database` and `code` describe declared source structure with distinct validation. A source-derived snapshot is an explicitly dated baseline within its adapter's supported scope. Do not invent extracted facts, conceptual stereotypes, composition or counts. `?` marks a count that the source cannot establish. Check actual tool availability and adapter coverage before promising source extraction.

Use `atlas_create` for a new document and retain its handle and revision. Set the existing `workId` when modeling a plan. Stable element IDs link to code evidence and context records (`plan`, `glossary`, `decision`, `scenario`); names may change while identities remain. Include only useful passages/excerpts selected for the exported document.

Apply related edits in one `atlas_revise` batch against `expectedRevision`; upsert/delete semantic elements and their references together. OntoUML batches use `elements`; structural batches use their named graph collections. Snapshots remain frozen. On conflict, inspect the current revision and reconcile the intended change rather than retrying with a guessed revision. Model/profile errors require correction; ontology findings remain visible questions rather than a proof of domain accuracy.

Use `atlas_validate` to inspect findings, `atlas_prepare` for a local scene reference consumed by the dashboard, and `atlas_export` for a self-contained HTML. The dashboard is a read-only native viewer, not the source of model edits. Explain architectural alternatives and uncertainty in the planning discussion; keep tool mechanics out of the user's decision flow. Saving a document or exporting HTML does not authorize publication, schema changes, implementation, or deployment.
