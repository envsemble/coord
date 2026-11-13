import { inspectionTarget } from "../model/inspectionTarget";
import { reviewedPayload } from "./reviewedPayload";
import { useInspectorWidth } from "./useInspectorWidth";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Theme } from "@envsemble/envui";
import { EmptyState } from "../ui/EmptyState";
import { DiagramCanvas } from "../canvas/DiagramCanvas";
import { indexViewerModel } from "../model/viewerModelIndex";
import { sameTarget } from "../canvas/interaction";
import { ViewSwitcher } from "../ui/ViewSwitcher";
import { ToolButton } from "../ui/ToolButton";
import { CameraControls } from "./CameraControls";
import { ConceptSearch } from "./ConceptSearch";
import { Island, IslandDivider } from "../ui/Island";
import { Panel } from "../ui/Panel";
import {
  ExitFullscreenIcon,
  FieldsIcon,
  FullscreenIcon,
  HideDetailsIcon,
  ScenariosIcon,
  ShowDetailsIcon,
} from "../ui/icons";
import { createZoomStore } from "./zoomStore";
import { useInspection, inspectedTarget } from "./useInspection";
import { Inspector } from "../details/Inspector";
import { overviewByDefault, useChangeReview } from "../review/useChangeReview";

// The overlay's first row starts with the host's own navigation (`sections`),
// when there is any; the diagram's navigation island then takes a row below.
function overlayClass(sections, density = 0) {
  return `atlas-overlay-top${sections ? " stacked" : ""}${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`;
}

// A proposal shows its change view, its review data travelling as an extra
// prop. The payloads of one family (a capture and the proposals over it, laid
// out together) render in the same mounted panel, so switching among them
// keeps the camera, the view, the selection and the details. The panel's root
// is an envUI Theme, so the host's `theme` drives envUI's tokens inside it
// (and in the popups envUI portals out of it). Memoized, so a host
// re-rendering with the same props leaves the viewer alone.
export const DiagramPanel = memo(function DiagramPanel(props) {
  const { payload, review } = reviewedPayload(props.payload);
  if (!payload.views.length) {
    const theme = props.theme || "dark";
    return (
      <Theme
        theme={theme}
        className="atlas-panel atlas-empty"
        data-theme={theme}
      >
        <div className="viewer">
          {(props.leading || props.sections) && (
            <div className={overlayClass(props.sections)}>
              {props.sections && (
                <div className="atlas-overlay-sections">{props.sections}</div>
              )}
              {props.leading && (
                <Island label="Diagram navigation" className="island-start">
                  <div className="island-leading">{props.leading}</div>
                </Island>
              )}
            </div>
          )}
          <EmptyState
            className="atlas-empty-message"
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
      identity={props.payload.family || payload.model.id}
    />
  );
});
function DiagramPanelContent({
  payload,
  theme = "dark",
  focus = null,
  leading,
  sections,
  fullscreen = false,
  onFullscreenChange,
  inspectorWidth,
  onInspectorWidthChange,
  review = null,
  identity,
}) {
  const { model, views, snippets, scenarios = null } = payload;
  const [viewKey, setViewKey] = useState(views[0].key);
  // Attributes show by default; the toolbar hides them.
  const [fields, setFields] = useState(true),
    [selected, setSelected] = useState(null);
  const [detailsHidden, setDetailsHidden] = useState(false),
    [scenariosOpen, setScenariosOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  // A member asked for by a focus (such as a plan's link) is shown in its
  // owner's details.
  const [member, setMember] = useState(null);
  const camera = useRef(null),
    zoomStore = useMemo(createZoomStore, []);
  const viewerRef = useRef(null),
    topRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  // Within a family the toolbar keeps its density; another member's controls
  // are measured as they appear.
  const density = useToolbarDensity(
    topRef,
    identity,
    `${views.map((v) => v.key).join()}:${!!review}`,
  );
  const lastFocus = useRef(null),
    inspectorId = useId();
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  // Whether a proposal's changes overview shows while nothing is inspected,
  // kept as a family switches between its members.
  const [overview, setOverview] = useState(overviewByDefault);
  // The changes overview stays put while the pointer crosses the canvas;
  // only an inspected element's details follow hover.
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled:
      !detailsHidden && !(review && overview && !selected && !scenariosOpen),
    previewVisible: !!selected || scenariosOpen,
  });
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setScenariosOpen(false);
    },
    [clearHover],
  );
  const choose = useCallback(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      setMember(next.memberId || null);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
      else if (next.nodeIds) setFocusRequest({ ids: next.nodeIds });
    },
    [index, model, views, viewKey, select],
  );
  const changes = useChangeReview({
    review,
    model,
    views,
    selected,
    overview,
    setOverview,
    choose,
    select,
    hover,
    onShowPanel: () => {
      setDetailsHidden(false);
      setScenariosOpen(false);
    },
  });
  const inspected = inspectedTarget(preview, selected),
    element = index.getElement(inspected);
  const showOverview = !!changes && overview && !element && !scenariosOpen;
  const detailsOpen =
    !detailsHidden && (!!element || scenariosOpen || showOverview);
  // Another model starts afresh; another member of the same family keeps what
  // the reader was looking at.
  useEffect(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [identity, select]);
  useEffect(() => {
    const visible =
      selected?.kind === "node"
        ? diagram.nodes
        : selected?.kind === "edge"
          ? diagram.edges
          : diagram.generalizationGroups || [];
    if (
      selected &&
      (!index.getElement(selected) ||
        (!visible.some((item) => item.id === selected.id) &&
          !(
            selected.kind === "edge" &&
            diagram.generalizationGroups?.some((g) =>
              g.memberIds.includes(selected.id),
            )
          )))
    )
      select(null);
  }, [index, diagram, selected, select]);
  useEffect(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  // New content in the inspector starts at its top.
  const inspector = useRef(null);
  const showing = scenariosOpen
    ? "scenarios"
    : selected
      ? `${selected.kind}:${selected.id}`
      : showOverview
        ? "overview"
        : "";
  useLayoutEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [showing]);
  const resize = useInspectorWidth({
    viewerRef,
    panelRef: inspector,
    width: inspectorWidth,
    onChange: onInspectorWidthChange,
  });
  const settledWidth = resize.resizing ? null : resize.width;
  // Reopening or widening details must not leave the selected node
  // underneath them.
  useLayoutEffect(() => {
    if (detailsOpen && selected?.kind === "node")
      camera.current?.revealNode(selected.id);
  }, [detailsOpen, settledWidth]);
  const latestChanges = useRef(null);
  latestChanges.current = changes;
  useEffect(() => {
    const escape = (e) => {
      if (e.key !== "Escape" || !e.target.closest?.(".atlas-panel")) return;
      if (e.target.closest(".inspector")) latestChanges.current?.returnFocus();
      select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  const hasScenarios = !!scenarios;
  // A member without scenarios closes those another member showed.
  useEffect(() => {
    if (!hasScenarios) setScenariosOpen(false);
  }, [hasScenarios]);
  const showViews = views.length > 1;
  const hasStart = !!leading || showViews || !!changes;
  return (
    <Theme theme={theme} className="atlas-panel" data-theme={theme}>
      <div
        ref={viewerRef}
        className={`viewer${detailsOpen ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}${resize.resizing ? " resizing" : ""}`}
        style={resize.style}
      >
        <div className={overlayClass(sections, density)} ref={topRef}>
          {sections && <div className="atlas-overlay-sections">{sections}</div>}
          {hasStart && (
            <Island label="Diagram navigation" className="island-start">
              {leading && <div className="island-leading">{leading}</div>}
              {leading && (showViews || changes) && <IslandDivider />}
              {showViews && (
                <ViewSwitcher
                  items={views}
                  compact={density > 0}
                  value={view.key}
                  onChange={(key) => {
                    setViewKey(key);
                    setFocusRequest(null);
                    clearHover();
                  }}
                />
              )}
              {showViews && changes && <IslandDivider />}
              {changes?.controls(detailsOpen && showOverview)}
            </Island>
          )}
          <Island label="Diagram tools" className="island-end">
            <ConceptSearch classes={model.classes} onChoose={choose} />
            <ToolButton
              label="Fields"
              tooltip={fields ? "Hide attributes" : "Show attributes"}
              pressed={fields}
              icon={<FieldsIcon />}
              onClick={() => {
                setFocusRequest(null);
                setFields((v) => !v);
              }}
            />
            <CameraControls
              zoomStore={zoomStore}
              compact={density > 2}
              onZoom={(factor) => camera.current?.zoomBy(factor)}
              onReset={() => camera.current?.reset()}
              onFit={() => camera.current?.fit()}
            />
            <IslandDivider />
            {hasScenarios && (
              <ToolButton
                label="Understand the model"
                pressed={scenariosOpen && detailsOpen}
                icon={<ScenariosIcon />}
                onClick={() => {
                  clearHover();
                  setDetailsHidden(false);
                  setScenariosOpen((v) => !(v && detailsOpen));
                }}
              />
            )}
            <ToolButton
              label={detailsHidden ? "Show details" : "Hide details"}
              aria-controls={inspectorId}
              aria-expanded={detailsOpen}
              icon={detailsHidden ? <ShowDetailsIcon /> : <HideDetailsIcon />}
              onClick={() => setDetailsHidden((v) => !v)}
            />
            {onFullscreenChange && (
              <ToolButton
                label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                variant="secondary"
                pressed={fullscreen}
                icon={fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                onClick={() => onFullscreenChange(!fullscreen)}
              />
            )}
          </Island>
        </div>
        <DiagramCanvas
          ref={camera}
          diagram={diagram}
          selected={selected}
          hovered={hovered}
          focusRequest={focusRequest}
          fitInsets={fitInsets}
          onSelect={select}
          onZoom={zoomStore.set}
          onHover={hover}
          onClearHover={clearHover}
        />
        <Panel
          ref={inspector}
          id={inspectorId}
          className="inspector"
          title={
            scenariosOpen
              ? "Understand the model"
              : showOverview
                ? "Changes"
                : null
          }
          toolbar={
            !scenariosOpen && element && changes ? changes.navigation : null
          }
          label={
            scenariosOpen
              ? "Model guide"
              : showOverview
                ? "Changes in this proposal"
                : "Model details"
          }
          open={detailsOpen}
          closeLabel="Hide details"
          onClose={() => setDetailsHidden(true)}
          resizer={resize.separator}
          onPointerEnter={keepHover}
          onPointerLeave={() => hover(null)}
        >
          {detailsOpen && (
            <Inspector
              showScenarios={scenariosOpen}
              element={element}
              inspected={inspected}
              member={sameTarget(inspected, selected) ? member : null}
              model={model}
              snippets={snippets}
              scenarios={scenarios}
              changes={changes}
              showOverview={showOverview}
              onChoose={choose}
            />
          )}
        </Panel>
      </div>
    </Theme>
  );
}
