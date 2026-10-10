# Portable documents

This page covers single-model exports, which agents use to move one model between workspaces. To share a plan, use a [plan export](plan-export.md): it carries the whole work item, including its models and their history.

The importer uses parse5's HTML parser with inert JSON extraction. This requires Node 22.12 or newer; Node 24 is the development runtime. It rejects duplicate attributes rather than guessing which payload was intended.

`buildViewer({ document })` produces self-contained HTML with an inert `<script id="atlas-document" type="application/json">` payload. Its version is the `atlas/document` envelope version (currently 1). The original semantic model, counts, generalization sets, evidence, raw source excerpts, selected context, views, and all retained snapshots are embedded. Required comparison baselines are never fetched from the original workspace. Parent revision identities are retained; unrelated repository history is not embedded.

Use `importDocument(htmlOrJson)` to reopen, `reviseDocument` to change the semantic model, and `buildViewer` to export again. Import reads JSON without evaluating the viewer's scripts. It creates an imported revision and preserves source capture claims without treating them as newly verified. Missing external repositories/plans do not prevent reopening: embedded evidence and selected passages remain available, while their links may require the original workspace.

Import reads only that inert payload and never reconstructs semantics from SVG. HTML without the payload, repeated payloads, invalid data, and unsupported versions fail explicitly; an agent converts an export in an older format with the Atlas revision that produced it. Inputs are limited to 64 MiB and model data to 32 MiB.

The `*-atlas-document.json` download is the same lossless document. Snapshot integrity detects changes to retained content; it does not authenticate the original source. Share only the context and excerpts you intend to include by selecting them in the document before export.
