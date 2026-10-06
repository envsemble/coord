import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDiagramCamera } from "./useDiagramCamera";
import { useBlobURL, useDiagramURL } from "./downloads";

const THEME_KEY = "r5-ontouml-theme";

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function ConceptSearch({ classes, onChoose }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const q = query.trim().toLowerCase();
  const hits = q
    ? classes.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12)
    : [];
  const close = () => {
    setShowHits(false);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  useEffect(() => {
    const outside = (e) => {
      if (!e.target.closest(".search") && e.target.id !== "search-toggle")
        close();
    };
    const escape = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  function choose(name) {
    onChoose(name);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  return (
    <>
      <button
        id="search-toggle"
        className="icon"
        aria-label="Open concept search"
        title="Find concept"
        onClick={() => setOpen(!open)}
      >
        ⌕
      </button>
      <div className={`search${open ? " open" : ""}`}>
        <input
          ref={inputRef}
          id="search"
          type="search"
          placeholder="Find concept…"
          aria-label="Find concept"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowHits(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length) {
              choose(hits[0].name);
              e.preventDefault();
            }
            if (e.key === "ArrowDown") {
              suggestionsRef.current.querySelector("button")?.focus();
              e.preventDefault();
            }
            if (e.key === "Escape") {
              close();
              inputRef.current.blur();
            }
          }}
        />
        <div
          ref={suggestionsRef}
          id="suggestions"
          className={`suggestions${showHits && hits.length ? " open" : ""}`}
          role="listbox"
          aria-label="Concepts"
        >
          {hits.map((c) => (
            <button key={c.id} role="option" onClick={() => choose(c.name)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function BlobDownload({
  data,
  filename,
  type,
  children,
  id,
  className = "source",
}) {
  const href = useBlobURL(data, type);
  return (
    <a id={id} className={className} href={href} download={filename}>
      {children}
    </a>
  );
}

function ExportMenu({ exports, viewKey, fields, theme, diagramURL }) {
  const [open, setOpen] = useState(false);
  const bundle = useMemo(
    () => Uint8Array.from(atob(exports.bundle), (c) => c.charCodeAt(0)),
    [exports.bundle],
  );
  useEffect(() => {
    const outside = (e) => {
      if (!e.target.closest(".menu-wrap")) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div className="menu-wrap">
      <button
        id="export"
        className="icon"
        aria-label="Export"
        aria-expanded={open}
        title="Export"
        onClick={() => setOpen(!open)}
      >
        ↓
      </button>
      <div id="export-menu" className={`menu${open ? " open" : ""}`}>
        <a
          id="svg-download"
          href={diagramURL}
          download={`r5-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`}
        >
          Diagram · SVG
        </a>
        <BlobDownload
          id="puml-download"
          className=""
          data={exports.plantUML[viewKey]}
          filename={`r5-${viewKey}.puml`}
        >
          Diagram · PlantUML
        </BlobDownload>
        <BlobDownload
          id="model-download"
          className=""
          data={exports.schema}
          filename="r5-ontouml.json"
          type="application/json"
        >
          Model · OntoUML JSON
        </BlobDownload>
        <BlobDownload
          id="bundle-download"
          className=""
          data={bundle}
          filename="r5-models.zip"
          type="application/zip"
        >
          Models · ZIP
        </BlobDownload>
      </div>
    </div>
  );
}

function SourceLink({ href, children }) {
  return (
    <a className="source" href={href} target="_blank" rel="noopener">
      {children} ↗
    </a>
  );
}

function ConceptDetails({ concept, sources }) {
  return (
    <>
      <span className="tag">«{concept.stereo}»</span>
      <h1>{concept.name}</h1>
      <p>{concept.description}</p>
      {concept.attrs.length > 0 && (
        <>
          <h2>Fields</h2>
          {concept.attrs.map(([name, type, cardinality]) => (
            <div className="field-row" key={name}>
              <span>{name}</span>
              <span>
                {type}
                {cardinality ? ` [${cardinality}]` : ""}
              </span>
            </div>
          ))}
        </>
      )}
      <h2>Source</h2>
      {concept.evidence.map((id) => {
        const source = sources.find((s) => s.id === id);
        return (
          <SourceLink key={id} href={source.url}>
            {source.title}
          </SourceLink>
        );
      })}
      <p className="muted">
        OntoUML classification and multiplicities are interpretations.
      </p>
    </>
  );
}

function About({ model, exports }) {
  return (
    <>
      <span className="tag">R5Reloaded · Apex Season 3</span>
      <h1>OntoUML</h1>
      <p>
        Scroll with two fingers to pan. Pinch to zoom. Drag to pan. Select a
        concept for fields and source.
      </p>
      <p>
        <kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>0</kbd> fit · <kbd>Esc</kbd>{" "}
        close
      </p>
      <h2>Types</h2>
      {["kind", "role", "relator", "phase", "event", "mode"].map((type) => (
        <div className="legend-row" key={type}>
          <span
            className="swatch"
            style={{ background: `var(--node-${type})` }}
          />
          «{type}»
        </div>
      ))}
      <h2>Evidence</h2>
      <p>
        Public SDK and scripts were inspected at pinned commits. Native engine
        bodies remain partly opaque.
      </p>
      <SourceLink
        href={`https://github.com/Mauler125/r5sdk/tree/${model.repositories[0].commit}`}
      >
        R5 SDK
      </SourceLink>
      <SourceLink
        href={`https://github.com/Mauler125/r5_flowstate/tree/${model.repositories[1].commit}`}
      >
        Flowstate scripts
      </SourceLink>
      <BlobDownload
        id="notes-download"
        data={exports.notes}
        filename="r5-model-notes.txt"
      >
        Source notes ↓
      </BlobDownload>
      <BlobDownload
        id="validation-download"
        data={exports.validation}
        filename="r5-validation.json"
        type="application/json"
      >
        Validation report ↓
      </BlobDownload>
      <p className="muted">
        JSON schema and structural checks pass. Full OntoUML semantics and
        editor import remain untested.
      </p>
    </>
  );
}

export function App({ model, views, exports }) {
  const [viewKey, setViewKey] = useState("runtime");
  const [fields, setFields] = useState(false);
  const [theme, setTheme] = useState(loadTheme);
  const [panel, setPanel] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const view = views.find((v) => v.key === viewKey);
  const svgSource = fields ? view.svgFields : view.svg;
  const concept =
    panel?.type === "concept"
      ? model.classes.find((c) => c.name === panel.name)
      : null;
  const camera = useDiagramCamera({
    canvasRef,
    worldRef,
    viewKey,
    fields,
    focusRequest,
    onInspect: (name) => setPanel({ type: "concept", name }),
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);
  useLayoutEffect(() => {
    worldRef.current.querySelectorAll(".node").forEach((node) => {
      node.classList.toggle("selected", node.dataset.name === concept?.name);
    });
  }, [concept, svgSource]);
  useEffect(() => {
    const escape = (e) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  const diagramURL = useDiagramURL(worldRef, svgSource, theme);
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  function chooseConcept(name) {
    if (!view.names.includes(name)) {
      const c = model.classes.find((c) => c.name === name);
      setViewKey(c.pkg === "backend" ? "backend" : "runtime");
    }
    setFocusRequest({ name });
    setPanel({ type: "concept", name });
  }
  return (
    <>
      <header>
        <span className="brand" title="R5Reloaded · Apex Season 3">
          R5 · S3
        </span>
        <nav className="tabs" aria-label="Diagram">
          {[
            ["runtime", "Game server"],
            ["backend", "Server browser"],
          ].map(([key, label]) => (
            <button
              key={key}
              data-view={key}
              aria-selected={viewKey === key}
              onClick={() => {
                setViewKey(key);
                setPanel(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <ConceptSearch classes={model.classes} onChoose={chooseConcept} />
        <button
          id="fields"
          className="fields"
          aria-pressed={fields}
          title="Show attributes in the diagram"
          onClick={() => {
            setFields(!fields);
            setPanel(null);
          }}
        >
          Fields
        </button>
        <div className="camera-controls">
          <button
            id="zoom-out"
            className="icon"
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => camera.zoomBy(1 / 1.25)}
          >
            −
          </button>
          <button
            id="zoom-value"
            className="zoom-readout"
            title="Reset to 100%"
            onClick={camera.reset}
          >
            {camera.zoom}%
          </button>
          <button
            id="zoom-in"
            className="icon"
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => camera.zoomBy(1.25)}
          >
            +
          </button>
          <button id="fit" title="Fit diagram (0)" onClick={camera.fit}>
            Fit
          </button>
        </div>
        <span className="divider" />
        <button
          id="theme-toggle"
          className="icon"
          aria-label={themeLabel}
          title={themeLabel}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <ExportMenu
          exports={exports}
          viewKey={viewKey}
          fields={fields}
          theme={theme}
          diagramURL={diagramURL}
        />
        <button
          id="info"
          className="icon"
          aria-label="About and controls"
          title="About and controls"
          onClick={() => setPanel({ type: "about" })}
        >
          ⓘ
        </button>
      </header>
      <main
        ref={canvasRef}
        id="canvas"
        aria-label="Interactive OntoUML diagram"
      >
        <div
          ref={worldRef}
          id="world"
          dangerouslySetInnerHTML={{ __html: svgSource }}
        />
      </main>
      <aside
        id="panel"
        className={`panel${panel ? " open" : ""}`}
        aria-label="Diagram details"
      >
        <button
          className="panel-close"
          aria-label="Close details"
          onClick={() => setPanel(null)}
        >
          ×
        </button>
        <div id="panel-content">
          {concept && (
            <ConceptDetails concept={concept} sources={model.sources} />
          )}
          {panel?.type === "about" && <About model={model} exports={exports} />}
        </div>
      </aside>
    </>
  );
}
