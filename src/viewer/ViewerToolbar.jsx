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
  onLearn,
  onZoom,
  onReset,
  onFit,
}) {
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <header>
      <span className="brand" title={model.title}>
        OntoUML
      </span>
      <Tabs items={views} value={viewKey} onChange={onView} />
      <span className="spacer" />
      <ConceptSearch
        classes={model.classes.filter((c) =>
          views.some((v) => v.nodeIds.includes(c.id)),
        )}
        onChoose={onChoose}
      />
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
          download={`${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`}
        >
          Diagram · SVG
        </a>
        <DownloadLink
          id="puml-download"
          className=""
          data={exports.readText(`${exports.slug}-${viewKey}.puml`)}
          filename={`${exports.slug}-${viewKey}.puml`}
        >
          Diagram · PlantUML
        </DownloadLink>
        <DownloadLink
          id="model-download"
          className=""
          data={exports.readText(`${exports.slug}-ontouml.json`)}
          filename={`${exports.slug}-ontouml.json`}
          type="application/json"
        >
          Model · OntoUML JSON
        </DownloadLink>
        <DownloadLink
          id="bundle-download"
          className=""
          data={exports.bundle}
          filename={`${exports.slug}-models.zip`}
          type="application/zip"
        >
          Models · ZIP
        </DownloadLink>
      </ExportMenu>
      <button
        id="learn-toggle"
        className="learn-toggle"
        onClick={onLearn}
        aria-label={`Learn OntoUML; ${model.validation.counts.error} findings`}
      >
        Learn
        {model.validation.counts.error > 0 && (
          <span className="validation-count">
            {model.validation.counts.error}
          </span>
        )}
      </button>
      <IconButton id="info" label="About and controls" onClick={onAbout}>
        ⓘ
      </IconButton>
    </header>
  );
}
