import { inspectionTarget } from "../model/inspectionTarget";
import { ComparisonViewer } from "./ComparisonViewer";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import {
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

// A proposal renders the same panel again on its change view; its review data
// travels as an extra prop. The panel's root is an envUI Theme, so the host's
// `theme` drives envUI's tokens inside it (and in the popups envUI portals out
// of it).
export function AtlasPanel(props) {
  if (props.payload.comparison)
    return (
      <ComparisonViewer
        payload={props.payload}
        focus={props.focus}
        render={(payload, focus, extras) => (
          <AtlasPanel
            {...props}
            {...extras}
            payload={payload}
            focus={focus || props.focus}
          />
        )}
      />
    );
  if (!props.payload.views.length) {
    const theme = props.theme || "dark";
    return (
      <Theme
        theme={theme}
        className="atlas-panel atlas-empty"
        data-theme={theme}
      >
        <div className="viewer">
          {props.leading && (
            <div className="atlas-overlay-top">
              <Island label="Diagram navigation" className="island-start">
                <div className="island-leading">{props.leading}</div>
              </Island>
            </div>
          )}
          <EmptyState
            className="atlas-empty-message"
            title={props.payload.model.title}
            description="No entities in this model."
          />
          <ProvenanceBadge
            document={props.provenanceDocument || props.payload.model.document}
          />
        </div>
      </Theme>
    );
  }
  return <AtlasPanelContent {...props} />;
}
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
  focus = null,
  leading,
  fullscreen = false,
  onFullscreenChange,
  review = null,
  provenanceDocument,
}) {
  const { model, views, snippets, learning: guide = null } = payload;
  const [viewKey, setViewKey] = useState(views[0].key);
  const [fields, setFields] = useState(false),
    [selected, setSelected] = useState(null);
  const [hidden, setHidden] = useState(false),
    [learning, setLearning] = useState(false),
    [learningTab, setLearningTab] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  // A member asked for by a focus (such as a plan's link) is shown in its
  // owner's details.
  const [member, setMember] = useState(null);
  const camera = useRef(null),
    zoomStore = useMemo(createZoomStore, []);
  const viewerRef = useRef(null),
    topRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  const density = useToolbarDensity(
    topRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`,
  );
  const lastFocus = useRef(null),
    inspectorId = useId();
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const [overview, setOverview] = useState(() => overviewByDefault(review));
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
  useEffect(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [model.id, select]);
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
  // Reopening details must not leave the selected node underneath them.
  useLayoutEffect(() => {
    if (open && selected?.kind === "node")
      camera.current?.revealNode(selected.id);
  }, [open]);
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
  const conceptual = !model.document || model.document.profile === "ontouml";
  const guided = conceptual || !!guide;
  const showTabs = views.length > 1;
  const hasStart = !!leading || showTabs || !!changes;
  return (
    <Theme theme={theme} className="atlas-panel" data-theme={theme}>
      <div
        ref={viewerRef}
        className={`viewer${open ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}`}
      >
        <div
          className={`atlas-overlay-top${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`}
          ref={topRef}
        >
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
        <ProvenanceBadge document={provenanceDocument || model.document} />
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
              conceptual={conceptual}
              changes={changes}
              showOverview={showOverview}
              learningTab={learningTab}
              onLearningTab={setLearningTab}
              onChoose={choose}
              onView={(key) => {
                setViewKey(key);
                setFocusRequest(null);
              }}
              onReference={onReference}
            />
          )}
        </Panel>
      </div>
    </Theme>
  );
}
