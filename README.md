# Apex Legends / R5 OntoUML

Open **[index.html](index.html)** directly in a browser. It is a self-contained offline static website: styles, scripts, both diagrams, and all export data are embedded. No server, CDN, or build is needed to use it. Source links open GitHub when selected.

The viewer fills the window with a diagram. Two-finger scrolling pans, pinching zooms around the cursor, and dragging pans. **Fit** shows the whole model; **Fields** reveals attributes. Select a concept for its definition and pinned source links. The export menu downloads SVG, PlantUML, OntoUML JSON, or a ZIP of model artifacts, including when the HTML file is opened from disk.

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
```

Node and npm are needed only to rebuild. The build uses the committed source-evidence manifest and makes no network requests. Installing build dependencies initially requires access to the npm registry.

- `model/model.cjs`: classes, fields, relations, generalizations, constraints, and model version.
- `model/source-evidence.json`: inspected files, commit hashes, source anchors, exact lines, and claims.
- `src/viewer.html`: UI template and camera controls.
- `scripts/orthogonal.cjs`: layout and SVG rendering, with overlap and right-angle route checks.
- `scripts/build.cjs`: model validation, stable identifiers, embedded exports, and static output generation.
- `schemas/`: vendored OntoUML JSON schema and its upstream license.

Commit the generated `index.html` and `downloads/` files after rebuilding. `npm run check` verifies that those outputs match their sources, the embedded viewer script parses, and the static page has no external runtime dependencies or missing local links. `npm run format` formats editable files.

## Static hosting

Serve the repository root on any static host, with `index.html` as the entry point. There are no environment variables, backend endpoints, or runtime package dependencies. The same HTML file also works independently from disk.
