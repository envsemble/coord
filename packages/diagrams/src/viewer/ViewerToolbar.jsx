import { forwardRef, useMemo } from "react";
import { Text, ThemeToggle } from "@envsemble/envui";
import { ToolButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { ExportMenu, downloadData, downloadURL } from "../ui/ExportMenu";
import { Island, IslandDivider } from "../ui/Island";
import { ViewSwitcher } from "../ui/ViewSwitcher";
import { AtlasMark } from "../ui/AtlasMark";
import { ProvenanceLabel } from "./ProvenanceBadge";
import { describeProvenance } from "./provenance";
import {
  AboutIcon,
  ArchiveIcon,
  CodeIcon,
  FieldsIcon,
  HideDetailsIcon,
  ImageIcon,
  JSONIcon,
  LearnIcon,
  ShowDetailsIcon,
} from "../ui/Icons";

/** The standalone viewer's downloads, for its export menu. */
export function exportChoices({
  exports,
  viewKey,
  fields,
  theme,
  diagramURL,
  diagram = true,
}) {
  // A diagram file's PlantUML, or a legacy document's structural JSON.
  const sourceFile = diagram
    ? `${exports.slug}.puml`
    : `${exports.slug}-structural.json`;
  return [
    {
      key: "svg-download",
      label: "SVG image",
      description: `This view${fields ? " with attributes" : ""}, ${theme} theme`,
      icon: <ImageIcon />,
      onSelect: () =>
        diagramURL &&
        downloadURL(
          diagramURL,
          `${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`,
        ),
    },
    diagram
      ? {
          key: "source-download",
          label: "PlantUML",
          description: "The diagram's source",
          icon: <CodeIcon />,
          onSelect: () =>
            downloadData(exports.readText(sourceFile), sourceFile),
        }
      : {
          key: "source-download",
          label: "Structural JSON",
          description: "The whole model",
          icon: <JSONIcon />,
          onSelect: () =>
            downloadData(
              exports.readText(sourceFile),
              sourceFile,
              "application/json",
            ),
        },
    {
      key: "bundle-download",
      label: "Models ZIP",
      description: "Every export, with evidence and validation",
      icon: <ArchiveIcon />,
      onSelect: () =>
        downloadData(
          exports.bundle,
          `${exports.slug}-models.zip`,
          "application/zip",
        ),
    },
  ];
}

// The standalone viewer uses the same floating islands as the embedded panel,
// with offline-only controls (theme, exports, about) in the tools island. With
// no model picker, its navigation island names the model and where it came
// from (the detail, such as the capture date, as the badge's tooltip).
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
    reviewControls,
    provenance,
    guided = false,
    density = 0,
    themeToggle = false,
    onSidebar,
    onView,
    onFields,
    onChoose,
    onAbout,
    onLearn,
    onZoom,
    onReset,
    onFit,
  },
  ref,
) {
  const searchClasses = useMemo(() => {
    const visibleIds = new Set(views.flatMap((view) => view.nodeIds));
    return model.classes.filter((concept) => visibleIds.has(concept.id));
  }, [model.classes, views]);
  const origin = describeProvenance(provenance);
  return (
    <header
      className={`atlas-overlay-top viewer-toolbar${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`}
      ref={ref}
    >
      <Island label="Diagram navigation" className="island-start">
        <span className="brand-mark">
          <AtlasMark label="" />
        </span>
        <Text
          as="span"
          variant="section-heading"
          className="island-title"
          title={model.title}
        >
          {model.title}
        </Text>
        {origin.kind !== "unknown" && (
          <span
            className="island-provenance"
            title={origin.detail || undefined}
          >
            <ProvenanceLabel document={provenance} />
          </span>
        )}
        {(views.length > 1 || reviewControls) && <IslandDivider />}
        {views.length > 1 && (
          <ViewSwitcher
            items={views}
            value={viewKey}
            onChange={onView}
            compact={density > 0}
          />
        )}
        {views.length > 1 && reviewControls && <IslandDivider />}
        {reviewControls}
      </Island>
      <Island label="Diagram tools" className="island-end">
        <ConceptSearch classes={searchClasses} onChoose={onChoose} />
        <ToolButton
          id="fields"
          label="Fields"
          tooltip={fields ? "Hide attributes" : "Show attributes"}
          pressed={fields}
          icon={<FieldsIcon />}
          onClick={onFields}
        />
        <CameraControls
          {...{ zoomStore, onZoom, onReset, onFit }}
          compact={density > 2}
        />
        <IslandDivider />
        {guided && (
          <ToolButton
            id="learn-toggle"
            label="Understand the model"
            pressed={learningOpen && sidebarOpen}
            icon={<LearnIcon />}
            onClick={onLearn}
          />
        )}
        <ToolButton
          id="sidebar-toggle"
          label={sidebarHidden ? "Show details" : "Hide details"}
          aria-controls="inspector"
          aria-expanded={sidebarOpen}
          icon={sidebarHidden ? <ShowDetailsIcon /> : <HideDetailsIcon />}
          onClick={onSidebar}
        />
        <IslandDivider />
        {themeToggle && <ThemeToggle id="theme-toggle" />}
        <ExportMenu
          items={exportChoices({
            exports,
            viewKey,
            fields,
            theme,
            diagramURL,
            diagram: !!model.document?.path,
          })}
        />
        <ToolButton
          id="info"
          label="About and controls"
          aria-haspopup="dialog"
          aria-expanded={aboutOpen}
          icon={<AboutIcon />}
          onClick={onAbout}
        />
      </Island>
    </header>
  );
});
