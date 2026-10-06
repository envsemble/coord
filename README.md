# Apex Legends / R5 OntoUML

Open **[index.html](index.html)** directly in a browser. It is a self-contained offline static website: styles, scripts, both diagrams, and all export data are embedded. No server, CDN, or build is needed to use it. Source links open GitHub when selected.

The interface is built with React 19. React and React DOM are bundled into the HTML during generation; no runtime installation or network connection is required.

The viewer fills the window with a diagram. Two-finger scrolling pans, pinching zooms around the cursor, and dragging pans. **Fit** shows the whole model; **Fields** reveals attributes. Select a concept for its definition and pinned source links. The export menu downloads SVG, PlantUML, OntoUML JSON, or a ZIP of model artifacts, including when the HTML file is opened from disk.

Hover or select a node to see its immediate connections. The active entity has a thicker amber outline; its connected entities have blue outlines. Hover or select a relation to isolate that edge and its two endpoint entities; unrelated elements dim. Hover temporarily overrides a selection, then restores it when the pointer leaves. Selection persists through panning, zooming, empty-canvas clicks, theme and field changes, and closing details. Press Escape to clear. Relations can also be selected with Enter or Space. Each association has a readable multiplicity badge at both ends.

Dark is the default theme. The sun/moon button switches to light or dark and remembers the choice when browser storage is available. The individual SVG download uses the selected theme.

## Model

Two connected views cover game-server runtime and server discovery/publication, sharing server and client-application identities. The model has 36 domain classes, five value types, 40 relations, and nine generalizations.

The evidence comes from public R5 SDK and Flowstate repositories targeting this Apex Season 3 build:

`R5pc_r5launch_N1094_CL456479_2019_10_30_05_20_PM`

- [R5 SDK](https://github.com/Mauler125/r5sdk/tree/c49e0d2123bc3ddb53419005ddd7c6ef73925faf)
- [Flowstate scripts](https://github.com/Mauler125/r5_flowstate/tree/a2cb35fc6d249ea678578ba2df41b9b55f742578)

Stereotypes, cardinalities, and conceptual identity boundaries are interpretations. Native engine bodies and the directory-service implementation were not recovered. Pylon discovery is distinct from EA skill matchmaking. Full OntoUML semantic validation and graphical editor import remain untested. See [source notes](downloads/r5-model-notes.txt) and the [validation report](downloads/r5-validation.json).

## Editing

```sh
npm ci
npm run build
npm run check
npm test
```

Node and npm are needed only to rebuild. The build uses the committed source-evidence manifest and makes no network requests. Installing build dependencies initially requires access to the npm registry.

- `model/model.cjs`: classes, fields, relations, generalizations, constraints, and model version.
- `model/source-evidence.json`: inspected files, commit hashes, source anchors, exact lines, and claims.
- `model/views.cjs`: R5 view membership and placement preferences, separate from semantic definitions.
- `src/model/`: indexes semantic entities and relationships without UI or geometry.
- `src/app/`: connects the R5 model, reusable UI, and diagram canvas; contains source details and application-specific controls.
- `src/ui/`: reusable buttons, tabs, camera controls, search, panels, menus, download links, theme and popup hooks, and interface styles.
- `src/diagram/`: domain-independent React UML node, relation, and multiplicity components; hover/selection logic; camera controls; diagram styles; and SVG exports.
- `src/main.jsx`: React entry point.
- `src/viewer.html`: standalone HTML shell with build markers for inline styles, data, and scripts.
- `scripts/diagram/`: orthogonal layout, geometry and endpoint validation, and static SVG generation using the same React components as the live diagram.
- `scripts/build.cjs`: model validation, stable identifiers, embedded exports, and static output generation.
- `schemas/`: vendored OntoUML JSON schema and its upstream license.

Commit the generated `index.html` and `downloads/` files after rebuilding. `npm run check` verifies that those outputs match their sources, the embedded viewer script parses, the static page has no external runtime dependencies, and counts and routed ends match their semantic identities. `npm test` checks camera behavior and cleanup, tap/drag separation, graph focus, generic UML rendering, and detection of swapped endpoints. `npm run format` formats editable files.

The semantic model contains class identities, stereotypes, attributes, associations, and multiplicities. A layout produces ordinary geometry data (nodes, orthogonal paths, and labels), which the renderer consumes without knowing the R5 domain. There is no diagram scripting language. Both the browser and SVG exports use `UMLDiagram`, `UMLNode`, and `UMLRelation`, so notation stays consistent. Association multiplicities appear at their respective ends; inheritance uses a hollow triangle and no multiplicity badges, following [UML notation](https://www.omg.org/spec/UML/2.5.1/PDF).

## Static hosting

Serve the repository root on any static host, with `index.html` as the entry point. There are no environment variables, backend endpoints, or packages to install on the host. The same HTML file also works independently from disk.
