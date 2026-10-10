# Native embedding

Import `AtlasPanel` from `@envsemble/atlas-diagrams/react` and `@envsemble/atlas-diagrams/embedded.css`. Pass a `prepareViewer({document, includeArtifacts:false}).payload`, a host-controlled `theme` (`dark` or `light`), an optional semantic `focus` target, and `onReference(record)` to navigate retained planning references. `leading` renders host content (such as a model picker) at the start of the floating top-left toolbar. Passing `onFullscreenChange(next)` adds a fullscreen toggle to the top-right toolbar; the host owns the `fullscreen` state and layout. This component consumes the same model/scene as offline exports. It does not require HTML, an iframe, an archive, a model service, or a connection to captured sources.

```tsx
<AtlasPanel
  key={modelHandle}
  payload={payload}
  theme="dark"
  leading={<ModelPicker />}
  fullscreen={fullscreen}
  onFullscreenChange={setFullscreen}
  onReference={(record) => navigateToPlan(record.path, record.section)}
/>
```

`describeProvenance(document)` returns `{ kind, label, detail, tone }` for an Atlas document or a viewer model's `document`: `Generated from code` or `Generated from database` (`accent`) with `<source> · <identity> · captured Oct 8, 2026 · complete coverage`, `Agent proposal` (`done`) with `Changes to source captured <date>`, or `Agent-authored` (`success`) with `Conceptual model`/`Structural model`; imported documents append `· Imported`. `ProvenanceBadge` renders the same label and detail. Hosts can reuse both to keep wording and colors identical.

Use the handle as a React key when switching documents. Authored payload revisions preserve selection when its semantic element remains visible; camera state is local and keyed to the view. Hiding the inspector keeps selection and camera. External `focus` changes reveal an element; identical focus targets do not repeatedly move the camera. Empty source scopes show an explicit empty model.

The embedded stylesheet is generated from the existing UI/diagram rules, scoped under `.atlas-panel`. It never sets host root theme, body overflow, or global button styles. `.atlas-panel` fills its sized container (for example, `height:600px`); the grid canvas is full-bleed and every control floats over it. Controls adapt to the panel's own width through container queries, so narrow cards collapse search and widen the floating details panel. Keep source capture dates/coverage visible; imported capture claims remain marked as imported. Hosts resolve plan/code references according to their own containment/navigation rules and own model edits separately from visualization.
