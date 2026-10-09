import { forwardRef, useMemo } from "react";
import { Tabs } from "../ui/Tabs";
import { IconButton, ToggleButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { ExportMenu } from "../ui/ExportMenu";
import { DownloadLink } from "../ui/DownloadLink";
import { Island, IslandDivider } from "../ui/Island";
import { AtlasMark } from "../ui/AtlasMark";
import {
  BookIcon,
  SunIcon,
  MoonIcon,
  QuestionIcon,
  TableIcon,
  FileMediaIcon,
  FileCodeIcon,
  DownloadIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from "../ui/Icons";

// The standalone viewer uses the same floating islands as the embedded panel,
// with offline-only controls (theme, exports, about) in the tools island.
export const ViewerToolbar = forwardRef(function ViewerToolbar(
  {
    model,
    views,
    exports,
    viewKey,
    fields,
    theme,
    zoomStore,
    diagramURL,
    sidebarHidden,
    sidebarOpen,
    learningOpen,
    aboutOpen,
    comparisonControls,
    reportControl,
    density = 0,
    onSidebar,
    onView,
    onFields,
    onTheme,
    onChoose,
    onAbout,
    onLearn,
    onZoom,
    onReset,
    onFit,
  },
  ref,
) {
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const sidebarLabel = sidebarHidden ? "Show details" : "Hide details";
  const conceptual = !model.document || model.document.profile === "ontouml";
  const modelFile = `${exports.slug}-${conceptual ? "ontouml" : "structural"}.json`;
  const searchClasses = useMemo(() => {
    const visibleIds = new Set(views.flatMap((view) => view.nodeIds));
    return model.classes.filter((concept) => visibleIds.has(concept.id));
  }, [model.classes, views]);
  return (
    <header
      className={`atlas-overlay-top viewer-toolbar${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`}
      ref={ref}
    >
      <Island label="Diagram navigation" className="island-start">
        <span className="brand-mark" title={model.title}>
          <AtlasMark />
        </span>
        <span className="island-title" title={model.title}>
          {model.title}
        </span>
        {(views.length > 1 || comparisonControls) && <IslandDivider />}
        {views.length > 1 && (
          <Tabs
            items={views}
            value={viewKey}
            onChange={onView}
            compact={density > 0}
          />
        )}
        {views.length > 1 && comparisonControls && <IslandDivider />}
        {comparisonControls}
      </Island>
      <Island label="Diagram tools" className="island-end">
        <ConceptSearch classes={searchClasses} onChoose={onChoose} />
        <IslandDivider />
        <ToggleButton
          id="fields"
          className="icon fields"
          pressed={fields}
          aria-label="Fields"
          title="Show attributes in the diagram"
          onClick={onFields}
        >
          <TableIcon size={16} />
        </ToggleButton>
        <CameraControls {...{ zoomStore, onZoom, onReset, onFit }} />
        <IslandDivider />
        {conceptual && (
          <button
            id="learn-toggle"
            type="button"
            className="icon learn-toggle"
            aria-pressed={learningOpen && sidebarOpen}
            onClick={onLearn}
            aria-label={`Learn OntoUML; ${model.validation.counts.error} findings`}
            title="Learn OntoUML"
          >
            <BookIcon size={16} />
            {model.validation.counts.error > 0 && (
              <span className="validation-count">
                {model.validation.counts.error}
              </span>
            )}
          </button>
        )}
        {reportControl}
        <IconButton
          id="sidebar-toggle"
          label={sidebarLabel}
          aria-controls="inspector"
          aria-expanded={sidebarOpen}
          onClick={onSidebar}
        >
          {sidebarHidden ? (
            <SidebarExpandIcon size={16} />
          ) : (
            <SidebarCollapseIcon size={16} />
          )}
        </IconButton>
        <IslandDivider />
        <IconButton id="theme-toggle" label={themeLabel} onClick={onTheme}>
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </IconButton>
        <ExportMenu>
          <a
            id="svg-download"
            href={diagramURL}
            download={`${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`}
          >
            <FileMediaIcon size={16} />
            SVG
          </a>
          <DownloadLink
            id="puml-download"
            className=""
            data={exports.readText(`${exports.slug}-${viewKey}.puml`)}
            filename={`${exports.slug}-${viewKey}.puml`}
          >
            <FileCodeIcon size={16} />
            PlantUML
          </DownloadLink>
          <DownloadLink
            id="model-download"
            className=""
            data={exports.readText(modelFile)}
            filename={modelFile}
            type="application/json"
          >
            <FileCodeIcon size={16} />
            {conceptual ? "OntoUML JSON" : "Structural JSON"}
          </DownloadLink>
          <DownloadLink
            id="bundle-download"
            className=""
            data={exports.bundle}
            filename={`${exports.slug}-models.zip`}
            type="application/zip"
          >
            <DownloadIcon size={16} />
            Models ZIP
          </DownloadLink>
        </ExportMenu>
        <IconButton
          id="info"
          label="About and controls"
          onClick={onAbout}
          aria-controls="about-panel"
          aria-expanded={aboutOpen}
        >
          <QuestionIcon size={16} />
        </IconButton>
      </Island>
    </header>
  );
});
