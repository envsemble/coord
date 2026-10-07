import { Tabs } from "../ui/Tabs";
import { IconButton, ToggleButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { ExportMenu } from "../ui/ExportMenu";
import { DownloadLink } from "../ui/DownloadLink";
import { useMemo } from "react";
import {
  BookIcon,
  SunIcon,
  MoonIcon,
  QuestionIcon,
  RepoIcon,
  TableIcon,
  FileMediaIcon,
  FileCodeIcon,
  DownloadIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from "../ui/Icons";

export function ViewerToolbar({
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
}) {
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const sidebarLabel = sidebarHidden ? "Show sidebar" : "Hide sidebar";
  const searchClasses = useMemo(() => {
    const visibleIds = new Set(views.flatMap((view) => view.nodeIds));
    return model.classes.filter((concept) => visibleIds.has(concept.id));
  }, [model.classes, views]);
  return (
    <header className="viewer-toolbar">
      <div className="toolbar-identity" title={model.title}>
        <span className="brand-mark">
          <RepoIcon size={20} />
        </span>
      </div>
      <div className="view-navigation">
        <Tabs items={views} value={viewKey} onChange={onView} />
      </div>
      <span className="spacer" />
      <div className="toolbar-actions">
        <ConceptSearch classes={searchClasses} onChoose={onChoose} />
        <div className="diagram-actions">
          <ToggleButton
            id="fields"
            className="fields"
            pressed={fields}
            aria-label="Fields"
            title="Show attributes in the diagram"
            onClick={onFields}
          >
            <TableIcon size={16} />
          </ToggleButton>
          <CameraControls {...{ zoomStore, onZoom, onReset, onFit }} />
        </div>
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
            data={exports.readText(`${exports.slug}-ontouml.json`)}
            filename={`${exports.slug}-ontouml.json`}
            type="application/json"
          >
            <FileCodeIcon size={16} />
            OntoUML JSON
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
        <button
          id="learn-toggle"
          className="learn-toggle"
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
        <IconButton
          id="sidebar-toggle"
          label={sidebarLabel}
          aria-controls="inspector"
          aria-expanded={sidebarOpen}
          aria-pressed={!sidebarHidden}
          onClick={onSidebar}
        >
          {sidebarHidden ? (
            <SidebarExpandIcon size={16} />
          ) : (
            <SidebarCollapseIcon size={16} />
          )}
        </IconButton>
        <IconButton id="info" label="About and controls" onClick={onAbout}>
          <QuestionIcon size={16} />
        </IconButton>
      </div>
    </header>
  );
}
