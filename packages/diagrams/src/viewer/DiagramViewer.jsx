import { useMemo, useRef, useState } from "react";
import { DiagramCanvas } from "../canvas/DiagramCanvas";
import { useSVGExport } from "../canvas/useSVGExport";
import { Dialog, useTheme, useThemePreference } from "@envsemble/envui";
import { EmptyState } from "../ui/EmptyState";
import { ViewerToolbar } from "./ViewerToolbar";
import { About } from "./About";
import { useArtifactArchive } from "./useArtifactArchive";
import { createZoomStore } from "./zoomStore";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { reviewedPayload } from "./reviewedPayload";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import { useViewerState } from "./useViewerState";
import { SidePanel } from "./SidePanel";

// A proposal shows its change view, its review data travelling as an extra
// prop, and the provenance of the proposal itself.
export function DiagramViewer(props) {
  const { payload, review, provenanceDocument } = reviewedPayload(props);
  if (!payload.views.length)
    return (
      <main className="viewer-error">
        <ProvenanceBadge document={provenanceDocument} className="inline" />
        <EmptyState
          headingLevel={1}
          title={payload.model.title}
          description="No entities in this model."
        />
      </main>
    );
  return (
    <ViewerContent
      {...payload}
      focus={props.focus}
      review={review}
      provenanceDocument={provenanceDocument}
    />
  );
}
// The offline file supplies envUI's ThemePreferenceProvider; without one the
// viewer follows the surrounding Theme and offers no theme toggle.
function useOptionalThemePreference() {
  try {
    return useThemePreference();
  } catch {
    return null;
  }
}
function ViewerContent({
  model,
  views,
  exports: exportData,
  scenarios = null,
  focus = null,
  review = null,
  provenanceDocument,
}) {
  const exports = useArtifactArchive(exportData);
  const preference = useOptionalThemePreference();
  const ambientTheme = useTheme();
  const theme = preference?.theme || ambientTheme;
  const [aboutOpen, setAboutOpen] = useState(false);
  const zoomStore = useMemo(createZoomStore, []);
  const cameraRef = useRef(null);
  const viewerRef = useRef(null),
    toolbarRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`,
  );
  const state = useViewerState({
    model,
    views,
    scenarios,
    review,
    focus,
    identity: model.id,
    cameraRef,
  });
  const { view, diagram, changes, panel } = state;
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(`${exports.slug}-${view.key}.svg`),
    theme,
    viewerRef,
    !!changes?.fade,
  );
  return (
    <div
      ref={viewerRef}
      className={`viewer${panel ? " with-panel" : ""}${changes?.fade ? " fade-unchanged" : ""}`}
    >
      <ViewerToolbar
        ref={toolbarRef}
        density={density}
        reviewControls={changes?.controls(panel === "changes", () =>
          state.togglePanel("changes"),
        )}
        provenance={provenanceDocument}
        hasScenarios={!!scenarios}
        scenariosOpen={panel === "scenarios"}
        {...{
          model,
          views,
          exports,
          theme,
          zoomStore,
          diagramURL,
        }}
        viewKey={view.key}
        aboutOpen={aboutOpen}
        onView={state.changeView}
        themeToggle={!!preference}
        onScenarios={() => state.togglePanel("scenarios")}
        onAbout={() => setAboutOpen(true)}
        onZoom={(factor) => cameraRef.current.zoomBy(factor)}
        onReset={() => cameraRef.current.reset()}
        onFit={() => cameraRef.current.fit()}
      />
      <DiagramCanvas
        ref={cameraRef}
        diagram={diagram}
        selected={state.selected}
        hovered={state.hovered}
        focusRequest={state.focusRequest}
        backgroundURL={backgroundURL}
        fitInsets={fitInsets}
        onSelect={state.select}
        onZoom={zoomStore.set}
        onHover={state.hover}
        onClearHover={state.clearHover}
      />
      <SidePanel state={state} model={model} scenarios={scenarios} />
      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        title={model.title}
        description="About this diagram and its controls"
      >
        <About
          model={model}
          exports={exports}
          provenance={provenanceDocument}
        />
      </Dialog>
    </div>
  );
}
