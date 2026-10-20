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
import { EmptyState, Theme } from "@envsemble/envui";
import { DiagramCanvas } from "../visualization/DiagramCanvas";
import { indexViewerModel } from "../model/domainModel";
import { sameTarget } from "../visualization/interaction";
import { ViewSwitcher } from "../ui/ViewSwitcher";
import { ToolButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { Island, IslandDivider } from "../ui/Island";
import { Panel } from "../ui/Panel";
import {
  ExitFullscreenIcon,
  FieldsIcon,
  FullscreenIcon,
  HideDetailsIcon,
  LearnIcon,
  ShowDetailsIcon,
} from "../ui/Icons";
import { createZoomStore } from "../ui/zoomStore";
import { useInspection, inspectedTarget } from "./useInspection";
import { InspectorContent } from "./InspectorContent";
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
export const AtlasPanel = memo(function AtlasPanel(props) {
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
    <AtlasPanelContent
      {...props}
      payload={payload}
      review={review}
      identity={props.payload.family || payload.model.id}
    />
  );
});
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
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
  const { model, views, snippets, learning: guide = null } = payload;
  const [viewKey, setViewKey] = useState(views[0].key);
  // Attributes show by default; the toolbar hides them.
  const [fields, setFields] = useState(true),
    [selected, setSelected] = useState(null);
  const [hidden, setHidden] = useState(false),
    [learning, setLearning] = useState(false);
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
    previewEnabled: !hidden && !(review && overview && !selected && !learning),
    previewVisible: !!selected || learning,
  });
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setLearning(false);
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
      setHidden(false);
      setLearning(false);
    },
  });
  const inspected = inspectedTarget(preview, selected),
    element = index.getElement(inspected);
  const showOverview = !!changes && overview && !element && !learning;
  const open = !hidden && (!!element || learning || showOverview);
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
  const showing = learning
    ? "learning"
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
    if (open && selected?.kind === "node")
      camera.current?.revealNode(selected.id);
  }, [open, settledWidth]);
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
  const guided = !!guide;
  // A member without a guide closes the one another member showed.
  useEffect(() => {
    if (!guided) setLearning(false);
  }, [guided]);
  const showTabs = views.length > 1;
  const hasStart = !!leading || showTabs || !!changes;
  return (
    <Theme theme={theme} className="atlas-panel" data-theme={theme}>
      <div
        ref={viewerRef}
        className={`viewer${open ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}${resize.resizing ? " resizing" : ""}`}
        style={resize.style}
      >
        <div className={overlayClass(sections, density)} ref={topRef}>
          {sections && <div className="atlas-overlay-sections">{sections}</div>}
          {hasStart && (
            <Island label="Diagram navigation" className="island-start">
              {leading && <div className="island-leading">{leading}</div>}
              {leading && (showTabs || changes) && <IslandDivider />}
              {showTabs && (
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
              {showTabs && changes && <IslandDivider />}
              {changes?.controls(open && showOverview)}
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
            {guided && (
              <ToolButton
                label="Understand the model"
                pressed={learning && open}
                icon={<LearnIcon />}
                onClick={() => {
                  clearHover();
                  setHidden(false);
                  setLearning((v) => !(v && open));
                }}
              />
            )}
            <ToolButton
              label={hidden ? "Show details" : "Hide details"}
              aria-controls={inspectorId}
              aria-expanded={open}
              icon={hidden ? <ShowDetailsIcon /> : <HideDetailsIcon />}
              onClick={() => setHidden((v) => !v)}
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
            learning ? "Understand the model" : showOverview ? "Changes" : null
          }
          toolbar={!learning && element && changes ? changes.navigation : null}
          label={
            learning
              ? "Model guide"
              : showOverview
                ? "Changes in this proposal"
                : "Model details"
          }
          open={open}
          closeLabel="Hide details"
          onClose={() => setHidden(true)}
          resizer={resize.separator}
          onPointerEnter={keepHover}
          onPointerLeave={() => hover(null)}
        >
          {open && (
            <InspectorContent
              learning={learning}
              element={element}
              inspected={inspected}
              member={sameTarget(inspected, selected) ? member : null}
              model={model}
              views={views}
              snippets={snippets}
              guide={guide}
              changes={changes}
              showOverview={showOverview}
              onChoose={choose}
              onReference={onReference}
            />
          )}
        </Panel>
      </div>
    </Theme>
  );
}
