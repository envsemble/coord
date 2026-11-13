import { forwardRef, useMemo } from "react";
import { Text, ThemeToggle } from "@envsemble/envui";
import { ToolButton } from "../ui/ToolButton";
import { CameraControls } from "./CameraControls";
import { ConceptSearch } from "./ConceptSearch";
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
  ScenariosIcon,
  ShowDetailsIcon,
} from "../ui/icons";

/** The standalone viewer's downloads, for its export menu. */
export function exportChoices({ exports, viewKey, fields, theme, diagramURL }) {
  const sourceFile = `${exports.slug}.puml`;
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
    {
      key: "source-download",
      label: "PlantUML",
      description: "The diagram's source",
      icon: <CodeIcon />,
      onSelect: () => downloadData(exports.readText(sourceFile), sourceFile),
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
// no diagram picker, its navigation island names the model and where it came
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
    detailsHidden,
    detailsOpen,
    scenariosOpen,
    aboutOpen,
    reviewControls,
    provenance,
    hasScenarios = false,
    density = 0,
    themeToggle = false,
    onDetails,
    onView,
    onFields,
    onChoose,
    onAbout,
    onScenarios,
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
          render={<span />}
          variant="title"
          className="atlas-section-heading island-title"
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
        {hasScenarios && (
          <ToolButton
            id="scenarios-toggle"
            label="Understand the model"
            pressed={scenariosOpen && detailsOpen}
            icon={<ScenariosIcon />}
            onClick={onScenarios}
          />
        )}
        <ToolButton
          id="details-toggle"
          label={detailsHidden ? "Show details" : "Hide details"}
          aria-controls="inspector"
          aria-expanded={detailsOpen}
          icon={detailsHidden ? <ShowDetailsIcon /> : <HideDetailsIcon />}
          onClick={onDetails}
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
