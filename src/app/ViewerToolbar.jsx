import { useMemo } from "react";
import { Tabs } from "../ui/Tabs";
import { IconButton, ToggleButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { ExportMenu } from "../ui/ExportMenu";
import { DownloadLink } from "../ui/DownloadLink";

export function ViewerToolbar({
  model,
  views,
  exports,
  viewKey,
  fields,
  theme,
  zoom,
  diagramURL,
  onView,
  onFields,
  onTheme,
  onChoose,
  onAbout,
  onZoom,
  onReset,
  onFit,
}) {
  const bundle = useMemo(
    () => Uint8Array.from(atob(exports.bundle), (c) => c.charCodeAt(0)),
    [exports.bundle],
  );
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <header>
      <span className="brand" title="R5Reloaded · Apex Season 3">
        R5 · S3
      </span>
      <Tabs
        items={["runtime", "backend"].map((key) =>
          views.find((view) => view.key === key),
        )}
        value={viewKey}
        onChange={onView}
      />
      <span className="spacer" />
      <ConceptSearch classes={model.classes} onChoose={onChoose} />
      <ToggleButton
        id="fields"
        className="fields"
        pressed={fields}
        title="Show attributes in the diagram"
        onClick={onFields}
      >
        Fields
      </ToggleButton>
      <CameraControls {...{ zoom, onZoom, onReset, onFit }} />
      <span className="divider" />
      <IconButton id="theme-toggle" label={themeLabel} onClick={onTheme}>
        {theme === "dark" ? "☀" : "☾"}
      </IconButton>
      <ExportMenu>
        <a
          id="svg-download"
          href={diagramURL}
          download={`r5-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`}
        >
          Diagram · SVG
        </a>
        <DownloadLink
          id="puml-download"
          className=""
          data={exports.plantUML[viewKey]}
          filename={`r5-${viewKey}.puml`}
        >
          Diagram · PlantUML
        </DownloadLink>
        <DownloadLink
          id="model-download"
          className=""
          data={exports.schema}
          filename="r5-ontouml.json"
          type="application/json"
        >
          Model · OntoUML JSON
        </DownloadLink>
        <DownloadLink
          id="bundle-download"
          className=""
          data={bundle}
          filename="r5-models.zip"
          type="application/zip"
        >
          Models · ZIP
        </DownloadLink>
      </ExportMenu>
      <IconButton id="info" label="About and controls" onClick={onAbout}>
        ⓘ
      </IconButton>
    </header>
  );
}
