# Atlas contracts

Atlas separates semantic documents, source extraction, validation, layout, React visualization, and offline delivery. Its existing OntoUML exchange API remains compatible. The versioned `atlas/document` envelope adds database/code profiles, immutable source snapshots, authored revisions, views, snippets, and selected planning context. The diagram is a projection of a document; it never becomes the semantic source.

`ontouml` retains standard OntoUML exchange JSON and the existing documented validator rules. `database` and `code` use `StructuralModel`: identified nodes with attributes, binary relations with counts at both ends, inheritance, and optional generalization sets. These profiles establish declared structure, not conceptual stereotypes. `?` means the source does not establish a count. Other profiles/versions produce explicit errors.

Revising a document preserves identity and immutable snapshots, records the previous revision, and rejects stale expected revisions. Snapshot integrity covers model and capture metadata; it detects changed content, not source authenticity. Capture provenance and coverage limit every completeness claim. Imported observations are preserved claims until independently recaptured.

Planning context contains identified records and explicit element links. It is selected supporting context, not another authoritative plan or progress ledger. Unknown fields remain serialized, preserving adapter details and exchange content.

Prepare diagrams without archives using `prepareViewer({ document, includeArtifacts: false })`. Standalone builds retain artifacts/downloads. Camera, hover and selection remain local to React, with no tool round trip. Views select semantic identities; they do not alter model contents.

Start development with `npm ci` and `npm run dev`. Verify with `npm test`, `npm run check:types`, `npm run build`, `npm run check`, and `npm run check:package`. CI runs these checks; each subsequent phase adds its capability tests. Existing 1,000-node interaction fixtures establish a rendering benchmark, not arbitrary source-extraction capacity. Adapter-specific limits are recorded with their fixtures.
