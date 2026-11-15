import { forwardRef } from "react";
import { Text, ThemeToggle } from "@envsemble/envui";
import { ToolButton } from "../ui/ToolButton";
import { CameraControls } from "./CameraControls";
import { ExportMenu, downloadData, downloadURL } from "../ui/ExportMenu";
import { Island, IslandDivider } from "../ui/Island";
import { ViewSwitcher } from "../ui/ViewSwitcher";
import { CoordMark } from "../ui/CoordMark";
import { ProvenanceLabel } from "./ProvenanceBadge";
import { describeProvenance } from "./provenance";
import {
  AboutIcon,
  ArchiveIcon,
  CodeIcon,
  ImageIcon,
  ScenariosIcon,
} from "../ui/icons";

/** The standalone viewer's downloads, for its export menu. */
export function exportChoices({ exports, viewKey, theme, diagramURL }) {
  const sourceFile = `${exports.slug}.puml`;
  return [
    {
      key: "svg-download",
      label: "SVG image",
      description: `This view, ${theme} theme`,
      icon: <ImageIcon />,
      onSelect: () =>
        diagramURL &&
        downloadURL(diagramURL, `${exports.slug}-${viewKey}-${theme}.svg`),
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
    theme,
    zoomStore,
    diagramURL,
    scenariosOpen,
    aboutOpen,
    reviewControls,
    provenance,
    hasScenarios = false,
    density = 0,
    themeToggle = false,
    onView,
    onAbout,
    onScenarios,
    onZoom,
    onReset,
    onFit,
  },
  ref,
) {
  const origin = describeProvenance(provenance);
  return (
    <header
      className={`coord-overlay-top viewer-toolbar${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`}
      ref={ref}
    >
      <Island label="Diagram navigation" className="island-start">
        <span className="brand-mark">
          <CoordMark label="" />
        </span>
        <Text
          render={<span />}
          variant="title"
          className="coord-section-heading island-title"
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
        <CameraControls
          {...{ zoomStore, onZoom, onReset, onFit }}
          compact={density > 2}
        />
        <IslandDivider />
        {hasScenarios && (
          <>
            <ToolButton
              id="scenarios-toggle"
              label="Understand the model"
              pressed={scenariosOpen}
              aria-controls="side-panel"
              icon={<ScenariosIcon />}
              onClick={onScenarios}
            />
            <IslandDivider />
          </>
        )}
        {themeToggle && <ThemeToggle id="theme-toggle" />}
        <ExportMenu
          items={exportChoices({
            exports,
            viewKey,
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
