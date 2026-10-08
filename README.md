<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/atlas-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/atlas-banner-light.svg">
  <img alt="Atlas — Models for shared understanding" src="assets/atlas-banner-light.svg" width="1200">
</picture>

[![CI](https://github.com/envsemble/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/envsemble/atlas/actions/workflows/ci.yml)
[![Version 0.5.0](https://img.shields.io/badge/version-0.5.0-blue)](CHANGELOG.md)
[![Node 24](https://img.shields.io/badge/Node-24-43853d)](docs/releases.md)
[![Private source](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](THIRD_PARTY_NOTICES.md)

Atlas helps an agent and a human agree on a model before implementation. Capture declared database or class structure, keep it as a dated baseline, author a conceptual UML/OntoUML proposal, inspect semantic changes and export a reopenable offline HTML document. The React viewer is read-only; the agent edits through the library, CLI or MCP.

[Setup](#start) · [Agent interface](docs/agent-interface.md) · [Embedding](docs/embedding.md) · [Export/reopen](docs/portable-documents.md) · [Comparison](docs/comparison.md) · [Learning reports](docs/learning-reports.md) · [PR/MR review](docs/review-ci.md)

![Atlas viewer with colored entities, named generalization sets and a focused inspector](assets/viewer-dark.jpg)

## Start

Use **Node 24**, npm and Git. Java extraction also needs **JDK 21**. PostgreSQL capture needs access to a supported PostgreSQL 17 schema. The exact adapter limits are below.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/` for React/Vite live updates. `npm run build` produces `index.html`, `downloads/` and the reusable React module. Open the HTML directly from disk or run `npm run preview` at port 4173. Exported documents contain their model, selected context, source excerpts, JavaScript, styles and icon; no internet or model service is needed.

```sh
node scripts/build-enrollment.cjs artifacts/enrollment --report
node bin/atlas.cjs tools
node bin/atlas.cjs mcp --root /path/to/workspace
```

The enrollment example includes valid instances and counterexamples; the R5 example in [index.html](index.html) uses pinned public Season 3 sources and preserves three ontology findings for investigation. Example source stays separate from the core package.

## Supported source snapshots

| Adapter                                | Supported input                                                               | Fidelity / limits                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [PostgreSQL](docs/database-capture.md) | PostgreSQL 17; explicit schemas, read-only repeatable-read capture            | Catalog tables, columns, keys and supported declared constraints; metadata visibility must be sufficient.               |
| [SQLite](docs/database-capture.md)     | SQLite 3.45+ (<4) through Node 24; main namespace                             | Declared schema with affinity/collation/count limits; captures never read application rows.                             |
| [D1](docs/database-capture.md)         | Separately tested local Wrangler path; explicit query executor for remote use | Repeated matching metadata passes, with weaker consistency disclosed; no account discovery or deployment.               |
| [TypeScript](docs/code-capture.md)     | Packaged 6.0.3 compiler; explicit tsconfig/projects and dependencies          | Named declarations, own members, inheritance/realization/type use; dynamic/framework behavior remains outside coverage. |
| [Java](docs/code-capture.md)           | JDK 21; explicit files/classpath; processing disabled                         | Compiler declarations, records, own members and declared type use; no build scripts or annotation processors.           |

Bounds: database 200 tables / 4,000 columns / 8 MiB metadata; code eight projects / 200 selected files / 500 declarations / 4,000 members / 8 MiB selected text, with additional compiler-input limits. Missing prerequisites fail explicitly; exclusions or unresolved facts disclose partial coverage. Unknown runtime counts use `?`. Imported provenance remains a retained claim, not a new verification.

## Plan, inspect, iterate

- Standard [OntoUML exchange JSON](https://github.com/OntoUML/ontouml-schema) and versioned [Atlas documents](docs/architecture.md) keep model semantics separate from scenes and UI.
- [CLI/stdio MCP](docs/agent-interface.md) persist models under `.atlas`, enforce expected revisions and return focused bounded results. Use [worktrail-atlas](https://github.com/envsemble/worktrail/tree/main/skills/worktrail-atlas) with your existing coding agent.
- [Proposals](docs/comparison.md) retain frozen baselines. Baseline/Proposed/Changes share positions; three-way conflicts remain explicit until resolved. Cross-layer mappings are authored links.
- The [Worktrail dashboard](https://github.com/envsemble/worktrail/tree/main/dashboard) embeds Atlas directly in React. Elements link to selected plan passages, glossary, decisions and retained code evidence.
- [Learning reports](docs/learning-reports.md) include walkthroughs, finite scenario checks, glossary, source dates, coverage, SVG diagrams and printing. Exported HTML can be imported and revised later.

![Semantic comparison highlights a proposed Course while retaining baseline identities](assets/comparison-dark.jpg)

## Library and React

Create a local package with `npm pack`, then install the tarball in a consumer. Core Node APIs use CommonJS or default ESM import:

```js
import atlas from "ontouml-atlas";
const document = atlas.importDocument(exportedHtml);
const proposal = atlas.createProposal(document);
const payload = (
  await atlas.prepareViewer({ document: proposal, includeArtifacts: false })
).payload;
const built = await atlas.buildViewer({ document: proposal });
atlas.writeViewer(built, "./site");
```

```jsx
import { AtlasPanel, ViewerErrorBoundary } from "ontouml-atlas/react";
import "ontouml-atlas/embedded.css";

<ViewerErrorBoundary>
  <AtlasPanel
    payload={payload}
    theme="dark"
    onReference={openPlanningPassage}
  />
</ViewerErrorBoundary>;
```

Size the host container; React 19.3 is a peer dependency. [Embedding](docs/embedding.md) documents focus, theme, updates and containment. [Viewer behavior](docs/viewer.md) covers smooth local camera movement, amber focus, hideable details, Shiki previews and generic orthogonal layout.

## Validate and distribute

The validator integrates the official schema with reference/ownership/count checks and a documented subset of OntoUML rules. It does not establish domain accuracy or full ontology model checking. [Rule coverage](docs/architecture.md) and [finite-example limits](docs/learning-reports.md) remain visible. Guidance paraphrases the [OntoUML specification](https://ontouml.readthedocs.io/en/latest/).

```sh
npm run format:check
npm run check:types
npm test
npm run check
npm run check:package
npm run check:performance
npm run review:example -- artifacts/review
npm run check:release
```

Full database tests require `ATLAS_TEST_POSTGRES` pointing to a disposable PostgreSQL 17 fixture. CI runs checks and builds revision-labelled [review artifacts](docs/review-ci.md) and versioned [release ZIPs](docs/releases.md). No release is published or deployed. Clean-package checks exercise Node/React, actual TS/Java capture and offline output. Legacy 0.4 HTML compatibility and export/reopen have dedicated fixtures.

[Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Release instructions](docs/releases.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Source is currently private / `UNLICENSED`. This is a source-use status, not an open-source license. Editable branding lives in `assets/`; dependency licenses and attributed example excerpts remain preserved.
