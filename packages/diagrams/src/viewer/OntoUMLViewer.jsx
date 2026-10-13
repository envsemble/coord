import { inspectionTarget } from "../model/inspectionTarget";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiagramCanvas } from "../visualization/DiagramCanvas";
import { useSVGExport } from "../visualization/useSVGExport";
import { sameTarget } from "../visualization/interaction";
import { indexViewerModel } from "../model/domainModel";
import {
  Dialog,
  EmptyState,
  useTheme,
  useThemePreference,
} from "@envsemble/envui";
import { Panel } from "../ui/Panel";
import { ViewerToolbar } from "./ViewerToolbar";
import { About } from "./DetailsContent";
import { useInspection, inspectedTarget } from "./useInspection";
import { InspectorContent } from "./InspectorContent";
import { useArtifactArchive } from "./useArtifactArchive";
import { createZoomStore } from "../ui/zoomStore";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { ComparisonViewer } from "./ComparisonViewer";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import { overviewByDefault, useChangeReview } from "../review/useChangeReview";

export function OntoUMLViewer(props) {
  if (props.comparison)
    return (
      <ComparisonViewer
        payload={props}
        focus={props.focus}
        render={(payload, focus, extras) => (
          <OntoUMLViewer
            {...payload}
            {...extras}
            focus={focus || props.focus}
          />
        )}
      />
    );
  if (!props.views.length)
    return (
      <main className="viewer-error">
        <ProvenanceBadge
          document={props.provenanceDocument || props.model.document}
          className="inline"
        />
        <EmptyState
          headingLevel={1}
          title={props.model.title}
          description="No entities in this model."
        />
      </main>
    );
  return <ViewerContent {...props} />;
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
  snippets = {},
  learning: guide = null,
  focus = null,
  review = null,
  provenanceDocument,
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState(views[0].key),
    [fields, setFields] = useState(false);
  const preference = useOptionalThemePreference();
  const ambientTheme = useTheme();
  const theme = preference?.theme || ambientTheme;
  const [selected, setSelected] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false),
    [learningTab, setLearningTab] = useState(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [overview, setOverview] = useState(() => overviewByDefault(review));
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled:
      !sidebarHidden && !(review && overview && !selected && !learningOpen),
    previewVisible: !!selected || learningOpen,
  });
  const [focusRequest, setFocusRequest] = useState(null);
  // A member asked for by a focus (such as a plan's link) is shown in its
  // owner's details.
  const [member, setMember] = useState(null);
  const zoomStore = useMemo(createZoomStore, []);
  const cameraRef = useRef(null);
  const viewerRef = useRef(null),
    toolbarRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`,
  );
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setAboutOpen(false);
      setLearningOpen(false);
    },
    [clearHover],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setAboutOpen(false);
    setLearningOpen(false);
    clearHover();
  }, [clearHover]);
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
      setSidebarHidden(false);
      setLearningOpen(false);
    },
  });
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`,
    ),
    theme,
    viewerRef,
    !!changes?.fade,
  );
  const inspected = inspectedTarget(preview, selected);
  const element = index.getElement(inspected);
  const showOverview = !!changes && overview && !element && !learningOpen;
  const sidebarOpen =
    !sidebarHidden && (!!element || learningOpen || showOverview);
  useEffect(() => {
    setSelected(null);
    setFocusRequest(null);
    setViewKey(views[0].key);
    clearHover();
  }, [model.id, clearHover]);
  const onHover = useCallback(
    (target) => {
      if (target) setLearningOpen(false);
      hover(target);
    },
    [hover],
  );
  const latestChanges = useRef(null);
  latestChanges.current = changes;
  useEffect(() => {
    const escape = (e) => {
      if (e.key !== "Escape") return;
      if (e.target.closest?.(".inspector"))
        latestChanges.current?.returnFocus();
      clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  const lastExternalFocus = useRef(null);
  useEffect(() => {
    if (focus && focus !== lastExternalFocus.current) {
      lastExternalFocus.current = focus;
      if (focus.kind === "view" && views.some((v) => v.key === focus.id))
        setViewKey(focus.id);
      else choose(focus.id);
    }
  }, [focus, choose, views]);
  useEffect(() => {
    if (selected && !index.getElement(selected)) select(null);
  }, [index, selected, select]);
  // New content in the inspector starts at its top.
  const inspector = useRef(null);
  const showing = learningOpen
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
    if (sidebarOpen && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [sidebarOpen]);
  const conceptual = !model.document || model.document.profile === "ontouml";
  // Learning findings can point at relations and sets as well as classes.
  const inspectLearning = (id) => {
    if (index.nodes.has(id)) return choose(id);
    const groupView = views.find((v) =>
      v.diagram.generalizationGroups?.some((g) => g.id === id),
    );
    if (groupView) {
      setViewKey(groupView.key);
      select({ kind: "group", id });
      return;
    }
    choose(id);
  };
  return (
    <div
      ref={viewerRef}
      className={`viewer${sidebarOpen ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}`}
    >
      <ViewerToolbar
        ref={toolbarRef}
        density={density}
        reviewControls={changes?.controls(sidebarOpen && showOverview)}
        guided={conceptual || !!guide}
        {...{
          model,
          views,
          exports,
          viewKey,
          fields,
          theme,
          zoomStore,
          diagramURL,
        }}
        sidebarHidden={sidebarHidden}
        sidebarOpen={sidebarOpen}
        learningOpen={learningOpen}
        aboutOpen={aboutOpen}
        onSidebar={() => setSidebarHidden((hidden) => !hidden)}
        onView={(key) => {
          if (key === viewKey) return;
          const next = views.find((v) => v.key === key).diagram;
          const elements =
            selected?.kind === "edge"
              ? next.edges
              : selected?.kind === "group"
                ? next.generalizationGroups || []
                : next.nodes;
          if (!elements.some((item) => item.id === selected?.id)) clear();
          setFocusRequest(null);
          setViewKey(key);
        }}
        onFields={() => {
          setFocusRequest(null);
          setFields(!fields);
        }}
        themeToggle={!!preference}
        onLearn={() => {
          clearHover();
          setSidebarHidden(false);
          setLearningOpen(sidebarHidden || !learningOpen);
        }}
        onChoose={choose}
        onAbout={() => {
          setAboutOpen(true);
        }}
        onZoom={(factor) => cameraRef.current.zoomBy(factor)}
        onReset={() => cameraRef.current.reset()}
        onFit={() => cameraRef.current.fit()}
      />
      <DiagramCanvas
        ref={cameraRef}
        {...{ diagram, selected, hovered, focusRequest, backgroundURL }}
        fitInsets={fitInsets}
        onSelect={select}
        onZoom={zoomStore.set}
        onHover={onHover}
        onClearHover={clearHover}
      />
      <ProvenanceBadge document={provenanceDocument || model.document} />
      <Panel
        ref={inspector}
        id="inspector"
        className="inspector"
        open={sidebarOpen}
        label={
          learningOpen
            ? "Model guide"
            : showOverview
              ? "Changes in this proposal"
              : "Model details"
        }
        title={
          learningOpen
            ? conceptual && !guide
              ? "Learn OntoUML"
              : "Understand the model"
            : showOverview
              ? "Changes"
              : null
        }
        toolbar={
          !learningOpen && element && changes ? changes.navigation : null
        }
        closeLabel="Hide details"
        onClose={() => setSidebarHidden(true)}
        onPointerEnter={keepHover}
        onPointerLeave={() => hover(null)}
        onFocusCapture={keepHover}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        }}
      >
        {sidebarOpen && (
          <InspectorContent
            learning={learningOpen}
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
            onInspectLearning={inspectLearning}
            onView={(key) => {
              setViewKey(key);
              setFocusRequest(null);
            }}
          />
        )}
      </Panel>
      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        title={model.title}
        description="About this diagram and its controls"
      >
        <About model={model} exports={exports} />
      </Dialog>
    </div>
  );
}
