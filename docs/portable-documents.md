# Portable documents

The importer uses parse5's HTML parser with inert JSON extraction. This requires Node 22.12 or newer; Node 24 is the development runtime. It rejects duplicate attributes rather than guessing which payload was intended.

`buildViewer({ document })` produces self-contained HTML with an inert `<script id="atlas-document" type="application/json">` payload. Its version is the `atlas/document` envelope version (currently 1). The original semantic model, counts, generalization sets, evidence, raw source excerpts, selected context, views, and all retained snapshots are embedded. Required comparison baselines are never fetched from the original workspace. Parent revision identities are retained; unrelated repository history is not embedded.

Use `importDocument(htmlOrJson)` to reopen, `reviseDocument` to change the semantic model, and `buildViewer` to export again. Import reads JSON without evaluating the viewer's scripts. It creates an imported revision and preserves source capture claims without treating them as newly verified. Missing external repositories/plans do not prevent reopening: embedded evidence and selected passages remain available, while their links may require the original workspace.

Atlas 0.4 exports are supported through their embedded archive and static snippet data. Import recovers original OntoUML JSON, evidence, views, and available excerpts, rather than reconstructing semantics from SVG. Older unsupported exports, repeated payloads, invalid data, and unsupported versions fail explicitly. Inputs are limited to 64 MiB and decoded model/archive data to 32 MiB. Archive entries are read in memory with bounded streaming decompression; no archive paths are written to disk.

The `*-atlas-document.json` download is the same lossless document. Snapshot integrity detects changes to retained content; it does not authenticate the original source. Share only the context and excerpts you intend to include by selecting them in the document before export.
