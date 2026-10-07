# OntoUML Atlas

An agent-ready library for evidence-backed OntoUML models, with validation, a React viewer, and contextual learning. The viewer is read-only. An agent authors the standard model; the library validates it and produces a self-contained offline HTML site.

Open [index.html](index.html) to explore the included R5Reloaded example. It uses pinned public sources for Apex Season 3. The example is separate from the reusable library and excluded from its package.

## Development and offline builds

Use Node 20.19+ or 22.12+ for the Vite development server.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite serves the React source with Fast Refresh and CSS updates. Changes to the R5 model, evidence, snippets, view settings, validation or diagram generation rebuild the viewer payload and update the open application. Existing selection and UI state survive successful updates when their IDs remain stable. Invalid model updates display Vite's error overlay; the last valid payload is retained until the model is fixed. The development entry point and model bridge live in `development/` and `scripts/vite-model-plugin.cjs`.

```sh
npm run build
npm run preview
```

`build` writes the self-contained production `index.html`, `downloads/` and reusable React module in `dist/`. The HTML has embedded JavaScript, styles, model, snippets and exports; it needs no internet connection, development server or runtime API. Open it directly from disk, serve it with any static HTTP server, or use `preview` at `http://127.0.0.1:4173/`. The preview serves only the generated HTML and downloads. Rebuild to update production output. Vite and its live-update client are development dependencies and are excluded from the offline HTML.

## Give an agent a modeling job

```sh
npm ci
node bin/ontouml.cjs init --project /path/to/server --project /path/to/client --question "Model session participation and discovery" --out work/session-model
```

Give your coding agent the generated `work/session-model/AGENT.md`. `job.json` records the question, source paths and Git revisions. The agent inspects those projects, writes standard OntoUML JSON and evidence, then runs:

```sh
node bin/ontouml.cjs validate work/session-model/model.ontouml.json --evidence work/session-model/evidence.json --json
node bin/ontouml.cjs build work/session-model/job.json --out work/session-site
```

Open `work/session-site/index.html`, or host it on any static host. No backend, credentials, CDN, runtime requests or AI service are required. This workflow uses your existing coding agent; it does not call an LLM automatically.

Validation exits with 0 when implemented checks pass, 1 when findings include errors, and 2 for a command or input failure. The builder rejects malformed models and broken references. It can visualize ontology findings so a reader can investigate them without pretending they pass.

## Model, evidence and views

- `model.ontouml.json`: the official [OntoUML exchange format](https://github.com/OntoUML/ontouml-schema), a flat Project with identified elements. Use the existing `ontouml-js` builders or write conforming JSON. No diagram language is involved.
- `evidence.json`: sources, interpretation rationale, confidence status and unresolved questions, keyed by model element ID. See [the evidence schema](schemas/evidence-schema.json).
- `views.json`: optional node IDs, edge IDs, focus IDs and placement preferences. An empty array generates a default view. View settings never change ontology.
- `snippets.json`: optional short, unmodified source excerpts. Provenance must match the source manifest. Shiki highlights them at build time with GitHub Dark Dimmed and Light Default themes.

Two source projects can contribute to one OntoUML project using separate packages and deliberate shared identities. `mergeProjects` namespaces IDs when combining independently authored models; identical names stay distinct. Author cross-project relations against those IDs afterwards, and namespace accompanying evidence keys in the same way.

Generalization sets in the standard model produce shared inheritance branches with one hollow triangle pointing to the supertype. Their names and `{complete/incomplete, disjoint/overlapping}` constraints appear beside the shared trunk. Hover or select the trunk or label to inspect the set and highlight its visible members. Individual branches retain their own relation identity and two-endpoint focus. If a view omits members, the label states how many are shown; completeness still applies to the full set. Generalizations without a declared set can share a trunk without acquiring constraints. A view can set `mergeGeneralizations: false` to keep separate arrows, or `direction: "DOWN"` for a vertical layout (the default is `"RIGHT"`). These are presentation preferences only.

For a teaching example like the enrollment pattern, run `node scripts/build-enrollment.cjs work/enrollment-site` and open `work/enrollment-site/index.html`. Its named state and degree-level sets are authored examples, separate from the R5 model.

See [the agent workflow](agents/MODELING.md) for the contract, supported excerpt languages and modeling guidance.

## Node and React APIs

Install the package locally or from a tarball produced by `npm pack`. Node 20 or later is required.

```js
const {
  Project,
  validateModel,
  buildViewer,
  writeViewer,
} = require("ontouml-atlas");

const project = new Project();
project.name.add("Orders");
const domain = project.packageBuilder().root().name("Orders").build();
domain.classBuilder().kind().name("Order").build();

const data = JSON.parse(JSON.stringify(project));
const report = validateModel(data);
const built = await buildViewer({ project: data, slug: "orders" });
writeViewer(built, "./site");
```

`buildViewer` returns HTML, export artifacts, a validation report, scenes and `payload`. `prepareViewer` returns the same data without bundling the HTML, useful for live React applications. Use the payload in a React 19.3 application:

```jsx
import { OntoUMLViewer, ViewerErrorBoundary } from "ontouml-atlas/react";
import "ontouml-atlas/viewer.css";
import "ontouml-atlas/diagram.css";

<ViewerErrorBoundary>
  <OntoUMLViewer {...payload} />
</ViewerErrorBoundary>;
```

The complete viewer occupies the viewport and manages its theme. For a custom interface, use `UMLDiagram` with an ordinary `DiagramScene`, or `DiagramCanvas` with controlled selection and hover callbacks. The renderer knows nothing about source projects or evidence. Public APIs include TypeScript declarations; the React entry point is precompiled ESM, with React as a peer dependency.

## Validation and learning

The local validator integrates Ajv with the unmodified official OntoUML schema v1.0.2. It also checks IDs, typed references, multiplicities, ownership and cycles, plus a documented subset of ontology rules: identity providers, rigidity, mandatory role dependence, complete phase partitions, relator participants, intrinsic aspect bearers and relation directions. Findings identify affected elements and link to the relevant specification.

These checks are intentionally reported separately from domain correctness. They do not provide full OntoUML semantics, anti-pattern detection or Alloy model checking. Rule coverage notices remain available in the viewer. [OntoUML Server](https://github.com/OntoUML/ontouml-server) offers a verification service using an older exchange contract; the [archived Python validator](https://github.com/OntoUML/ontouml-validator) consumes RDF vocabulary graphs. Neither is silently called with private models or treated as compatible with the current flat JSON format.

The bundled learning material paraphrases the [OntoUML specification](https://ontouml.readthedocs.io/en/latest/) and works offline. Inspect a concept or relation to understand its stereotype, identity provider and counts. Evidence can explain why a classification was chosen, what remains uncertain, and how to resolve it. The Learn panel adds a searchable reference and a small count-reading exercise. Full specification links open externally when requested.

The R5 example currently has three phase-partition findings. Its ActiveClientSlot, ReadyPlayer and DownedPlayer alternatives are not complete. These are preserved for review; the library does not invent missing phases or mark incomplete partitions complete merely to pass validation.

## Viewer behavior

Scroll or pinch to zoom slowly and smoothly. Drag to pan. Hover takes priority over selection in the wide sidebar. Hover or selection dims unrelated elements; a relation keeps only itself and its two endpoints highlighted. The active entity has an amber outline and connected entities have blue outlines. Selection survives navigation, theme changes and field toggling. Clicking the background or pressing Escape clears it.

Scrolling, dragging, pinch gestures, zoom buttons and Fit share one frame-synchronized camera animation. Input accumulates without dropping movement, zoom stays anchored under the cursor, and drag follows more tightly than zoom. The grid shares the diagram's world origin and zoom; neighboring dot densities blend smoothly without gaps after large or negative pans. Reduced-motion preferences apply movements immediately.

Each association shows counts at both ends. Inheritance uses a hollow triangle and no counts. Routes have only horizontal and vertical segments, checked during generation. GitHub Dark Dimmed is the default; light is available and remembered when browser storage permits. Entity backgrounds distinguish kinds (blue), roles (orange), relators (purple), phases (green), events (red) and modes (cyan) in both themes and SVG exports. Source snippets include line numbers and pinned GitHub links. SVG, standard JSON, evidence, views, notes, validation and ZIP downloads work directly from disk.

The navigation and inspector use GitHub-style controls and locally bundled Octicons. Controls use icons with tooltips; descriptions and learning explanations expand on demand. Press `/` to focus concept search. On narrow screens, diagram controls move to a second navigation row while view tabs scroll horizontally. Use the sidebar toggle or its close button to hide details without clearing selection. The diagram gains the full width, and the sidebar stays hidden while hovering, selecting, panning, zooming or switching views. Reopening shows the hovered element, otherwise the selection; with neither, no details are shown. Learn explicitly opens the learning sidebar. Clicking the background or pressing Escape still clears selection.

Pointer highlights commit immediately, with no hover debounce or opacity fade. An open inspector follows the same input commit; only opening a hover-only sidebar waits 100 ms to avoid covering a click target. Diagram geometry is memoized, adjacency is indexed once per immutable scene, and highlights draw a small overlay above a cached transparent SVG image. The SVG retains accessible interaction targets and vector fallback rendering. Rounded zoom updates reach only their readout; panning reuses the grid's raster settings. Pass `backgroundURL` to `DiagramCanvas` or `UMLDiagram` when embedding a matching transparent SVG image in a custom UI; the complete viewer creates it automatically. Replace scene/model objects when changing their contents.

During development, open `/performance.html` for an independent fixture with 1,000 classes, 1,996 relations, and eight attributes per class. Its 24-sample hover benchmark reports input-to-highlight and React render timings. Use `?nodes=2000` to vary the size. It is excluded from the offline application. On the development machine, the 1,000-class highlight median fell from about 401 ms to 3.4 ms (95th percentile: 467 ms to 4.5 ms); React render median fell from 120 ms to 1.8 ms. Timings vary with browser, hardware and workload.

The generic layout engine compares three deterministic candidates: the existing layered layout and two alternatives using ELK's [edge-length compaction](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-compaction-postCompaction-strategy.html). It favors shorter total relation length, with smaller penalties for bends, crossings and occupied area. A compact candidate cannot add crossings, shared association paths or obscured labels relative to the reference. All candidates must pass node, label and orthogonality checks. Connected entities can move closer while their identities, association ends, multiplicities and generalization sets remain unchanged. No R5 names or domain-specific rules enter this algorithm. Candidate metrics and rejection reasons are included in the validation export. This is a bounded layout heuristic, not a guarantee of the global minimum for every graph.

Exports have one compressed copy in the HTML; SVG downloads use the chosen theme. The included page is about 45% smaller than the initial uncompressed library build. Source repositories, the layout engine and Shiki are build-time inputs, never runtime network dependencies.

## Structure and checks

```text
lib/model/        Standard exchange indexing, viewer projection, project merging
lib/validation/  Official schema, references, evidence and ontology rules
lib/layout/      View preparation, orthogonal geometry, SVG and endpoint checks
lib/build/       Offline HTML generation, export archive, Shiki previews
lib/agent/       Multi-project modeling jobs
development/     Vite entry point and live model updates
src/viewer/      React application composition and evidence sidebar
src/visualization/  Reusable UML components, camera and focus behavior
src/learning/    Bundled specification guidance and model-specific explanations
src/ui/          Reusable controls, panels, themes and downloads
examples/r5/     Season 3 model, pinned source evidence and view preferences
schemas/         Official exchange schema and application contracts
```

```sh
npm run format
npm run build
npm run format:check
npm run check:types
npm test
npm run check
npm run check:package
```

`check` verifies reproducible committed HTML/downloads, offline dependencies, source previews, geometry and ZIP fidelity. `check:package` packs the library, installs it in a clean temporary directory, and exercises both public entry points and a fresh viewer build. The GitLab CI pipeline runs these checks. Installing dependencies and the package smoke check require registry access; building and using the HTML do not.

Commit `index.html`, `downloads/` and `dist/` after changes. Core package files exclude the R5 example, tests and generated demo exports. Publishing remains disabled (`private`, `UNLICENSED`); the repository has not been published or deployed. Dependency licenses and source attribution are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
