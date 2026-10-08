# Native embedding

Import `AtlasPanel` from `ontouml-atlas/react` and `ontouml-atlas/embedded.css`. Pass a `prepareViewer({document, includeArtifacts:false}).payload`, a host-controlled `theme` (`dark` or `light`), an optional semantic `focus` target, and `onReference(record)` to navigate retained planning references. This component consumes the same model/scene as offline exports. It does not require HTML, an iframe, an archive, a model service, or a connection to captured sources.

```tsx
<AtlasPanel
  key={modelHandle}
  payload={payload}
  theme="dark"
  onReference={(record) => navigateToPlan(record.path, record.section)}
/>
```

Use the handle as a React key when switching documents. Authored payload revisions preserve selection when its semantic element remains visible; camera state is local and keyed to the view. Hiding the inspector keeps selection and camera. External `focus` changes reveal an element; identical focus targets do not repeatedly move the camera. Empty source scopes show an explicit empty model.

The embedded stylesheet is generated from the existing UI/diagram rules, scoped under `.atlas-panel`. It never sets host root theme, body overflow, or global button styles. The panel needs a sized container (for example, `height:600px`); controls adapt to narrow layouts, where the inspector overlays the canvas. Keep source capture dates/coverage visible; imported capture claims remain marked as imported. Hosts resolve plan/code references according to their own containment/navigation rules and own model edits separately from visualization.
