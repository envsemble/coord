# Native embedding

Inside Atlas, the app and the command use the private `@envsemble/atlas-diagrams` workspace package directly. To use it elsewhere, create a local package with `npm pack` in `packages/diagrams` and install the tarball. Its Node API loads with CommonJS or a default ESM import:

```js
import atlas from "@envsemble/atlas-diagrams";
// A work folder's diagrams, by their paths in it.
const files = [
  { path: "diagrams/checkout.puml", text: captureText },
  { path: "diagrams/saved-methods.puml", text: proposalText },
];
const problems = atlas.checkDiagram(proposalText, {
  read: (reference) => (reference === "checkout.puml" ? captureText : null),
});
const { diagrams, prepared } = await atlas.prepareDiagrams({
  files,
  includeArtifacts: true,
});
const viewer = prepared.get("diagrams/saved-methods.puml");
const payload = viewer.payload;
const built = await atlas.buildViewer({ prepared: viewer, file: files[1] });
atlas.writeViewer(built, "./site");
```

React 19.3 is a peer dependency of the package. The React panel and its error boundary come from the `react` entry point; size the panel's container and wrap it in the boundary:

```jsx
import {
  DiagramPanel,
  ViewerErrorBoundary,
} from "@envsemble/atlas-diagrams/react";
import "@envsemble/atlas-diagrams/embedded.css";

<ViewerErrorBoundary>
  <DiagramPanel payload={payload} theme="dark" />
</ViewerErrorBoundary>;
```

[Viewer behavior](viewer.md) covers smooth local camera movement, selection highlighting, layers, arranging by hand and the grouped orthogonal layout.

## The React panel

Import `DiagramPanel` from `@envsemble/atlas-diagrams/react`, and load `@envsemble/atlas-diagrams/embedded.css`. With a bundler, envUI's components bring their own styles; a page without one loads `@envsemble/envui/styles.css` once. The panel's controls are envUI components, and `@envsemble/envui` is a peer dependency; the panel renders its own envUI theme boundary in the given `theme`, so its menus, tooltips and dialogs match it. Pass a payload from `prepareDiagrams`, a host-controlled `theme` (`dark` or `light`), and an optional semantic `focus` target. `leading` renders host content at the start of the floating top-left toolbar. `sections` renders the host's own navigation first, at the top left with the tools on the same row, and moves the diagram's navigation island to the row below. Passing `onArrange(positions)` lets the reader drag elements: it is called with the whole arrangement as shown (each element's top-left corner by id) when one is let go, and with null when the reader resets the layout; keep it and pass it back as `arrangement`, which also places elements without a place beside the ones they relate to. This component consumes the same model/scene as offline exports. It does not require HTML, an iframe, an archive, a model service, or a connection to captured sources.

```tsx
<DiagramPanel
  key={payload.family ?? diagramPath}
  payload={payload}
  theme="dark"
  leading={<DiagramName />}
  arrangement={positions}
  onArrange={savePositions}
/>
```

`describeProvenance(document)` returns `{ kind, label, detail, tone }` for a viewer model's `document`: `Generated from code` or `Generated from database` (`accent`) with `<source> · <identity> · captured Oct 8, 2026 · complete coverage`, `Agent proposal` (`done`) with `Changes to source captured <date>`, or `Agent-authored` (`success`) with `Class diagram`, `Entity diagram` or `Object diagram`. `ProvenanceBadge` renders the same label and detail. Hosts can reuse both to keep wording and colors identical; the panel does not show where a model came from, so a host shows it beside its own diagram choice. `changeCount(payload)` gives a proposal's number of changes as its **Changes** button counts them (null for other payloads), for a host's list of alternatives.

Use the diagram's path as a React key when switching diagrams, or `payload.family` for the members of a family (a capture, its proposals and later captures, laid out together by `prepareDiagrams`): giving the same panel another payload of the family switches in place, keeping the camera, the view and the selection. A new payload of the same diagram preserves the selection when its element remains visible; camera state is local and keyed to the view. External `focus` changes reveal an element; identical focus targets do not repeatedly move the camera. Empty source scopes show an explicit empty model.

The embedded stylesheet is generated from the existing UI/diagram rules, scoped under `.atlas-panel`. It never sets host root theme, body overflow, or global button styles. `.atlas-panel` fills its sized container (for example, `height:600px`); the grid canvas is full-bleed and every control floats over it. Controls adapt to the panel's own width through container queries, so narrow cards fold their controls and widen the floating side panel. Keep source capture dates and coverage visible. Hosts resolve plan/code references according to their own containment/navigation rules and own model edits separately from visualization.
