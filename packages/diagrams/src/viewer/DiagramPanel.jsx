import { reviewedPayload } from "./reviewedPayload";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import { memo, useMemo, useRef, useState } from "react";
import { Theme } from "@envsemble/envui";
import { EmptyState } from "../ui/EmptyState";
import { DiagramCanvas } from "../canvas/DiagramCanvas";
import { ViewSwitcher } from "../ui/ViewSwitcher";
import { ToolButton } from "../ui/ToolButton";
import { CameraControls } from "./CameraControls";
import { Island, IslandDivider } from "../ui/Island";
import { ResetLayoutIcon, ScenariosIcon } from "../ui/icons";
import { useArrangement } from "./useArrangement";
import { createZoomStore } from "./zoomStore";
import { useViewerState } from "./useViewerState";
import { SidePanel } from "./SidePanel";
import { ChangesSwitch } from "../review/ChangesSwitch";

// The overlay's first row starts with the host's own navigation (`sections`),
// when there is any; the diagram's navigation island then takes a row below.
function overlayClass(sections, density = 0) {
  return `coord-overlay-top${sections ? " stacked" : ""}${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`;
}

// A proposal shows its change view, its review data travelling as an extra
// prop. The payloads of one family (a capture and the proposals over it, laid
// out together) render in the same mounted panel, so switching among them
// keeps the camera, the view and the selection. The panel's root is an envUI
// Theme, so the host's `theme` drives envUI's tokens inside it (and in the
// popups envUI portals out of it). Memoized, so a host re-rendering with the
// same props leaves the viewer alone. A reader can turn a proposal's changes
// off and see it plainly; the choice holds while the panel stays mounted.
export const DiagramPanel = memo(function DiagramPanel(props) {
  const { payload, review, plain } = reviewedPayload(props.payload);
  if (!payload.views.length) {
    const theme = props.theme || "dark";
    return (
      <Theme
        theme={theme}
        className="coord-panel coord-empty"
        data-theme={theme}
      >
        <div className="viewer">
          {(props.leading || props.sections) && (
            <div className={overlayClass(props.sections)}>
              {props.sections && (
                <div className="coord-overlay-sections">{props.sections}</div>
              )}
              {props.leading && (
                <Island label="Diagram navigation" className="island-start">
                  <div className="island-leading">{props.leading}</div>
                </Island>
              )}
            </div>
          )}
          <EmptyState
            className="coord-empty-message"
            title={payload.model.title}
            description="No entities in this model."
          />
        </div>
      </Theme>
    );
  }
  return (
    <DiagramPanelContent
      {...props}
      payload={payload}
      review={review}
      plain={plain}
      identity={props.payload.family || payload.model.id}
    />
  );
});
function DiagramPanelContent({
  payload: changeView,
  theme = "dark",
  focus = null,
  leading,
  sections,
  review: changeReview = null,
  plain = null,
  identity,
  arrangement = null,
  onArrange,
}) {
  const [changesShown, setChangesShown] = useState(true);
  const plainly = plain && !changesShown;
  const payload = plainly ? plain : changeView;
  const review = plainly ? null : changeReview;
  const { model, views, scenarios = null } = payload;
  const camera = useRef(null),
    zoomStore = useMemo(createZoomStore, []);
  const viewerRef = useRef(null),
    topRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  const state = useViewerState({
    model,
    views,
    scenarios,
    review,
    focus,
    identity,
    cameraRef: camera,
  });
  const { view, changes, panel } = state;
  const arranged = useArrangement(view.diagram, arrangement, onArrange);
  // Within a family the toolbar keeps its density; another member's controls
  // are measured as they appear.
  const density = useToolbarDensity(
    topRef,
    identity,
    `${views.map((v) => v.key).join()}:${!!plain}:${changesShown}`,
  );
  const showViews = views.length > 1;
  const hasStart = !!leading || showViews || !!plain;
  return (
    <Theme theme={theme} className="coord-panel" data-theme={theme}>
      <div
        ref={viewerRef}
        className={`viewer${panel ? " with-panel" : ""}${changes?.fade ? " fade-unchanged" : ""}`}
      >
        <div className={overlayClass(sections, density)} ref={topRef}>
          {sections && <div className="coord-overlay-sections">{sections}</div>}
          {hasStart && (
            <Island label="Diagram navigation" className="island-start">
              {leading && <div className="island-leading">{leading}</div>}
              {leading && (showViews || plain) && <IslandDivider />}
              {showViews && (
                <ViewSwitcher
                  items={views}
                  compact={density > 0}
                  value={view.key}
                  onChange={state.changeView}
                />
              )}
              {showViews && plain && <IslandDivider />}
              {plain && (
                <ChangesSwitch
                  shown={changesShown}
                  onChange={setChangesShown}
                />
              )}
              {changes?.controls(panel === "changes", () =>
                state.togglePanel("changes"),
              )}
            </Island>
          )}
          <Island label="Diagram tools" className="island-end">
            <CameraControls
              zoomStore={zoomStore}
              compact={density > 2}
              onZoom={(factor) => camera.current?.zoomBy(factor)}
              onReset={() => camera.current?.reset()}
              onFit={() => camera.current?.fit()}
            />
            {onArrange && arranged.arranged && (
              <ToolButton
                label="Reset layout"
                tooltip="Lay the diagram out again, as Coord arranges it"
                icon={<ResetLayoutIcon />}
                onClick={arranged.reset}
              />
            )}
            {scenarios && (
              <>
                <IslandDivider />
                <ToolButton
                  label="Understand the model"
                  pressed={panel === "scenarios"}
                  aria-controls="side-panel"
                  icon={<ScenariosIcon />}
                  onClick={() => state.togglePanel("scenarios")}
                />
              </>
            )}
          </Island>
        </div>
        <DiagramCanvas
          ref={camera}
          diagram={arranged.diagram}
          elementDrag={arranged.elementDrag}
          selected={state.selected}
          hovered={state.hovered}
          focusRequest={state.focusRequest}
          fitInsets={fitInsets}
          onSelect={state.select}
          onZoom={zoomStore.set}
          onHover={state.hover}
          onClearHover={state.clearHover}
        />
        <SidePanel state={state} model={model} scenarios={scenarios} />
      </div>
    </Theme>
  );
}
