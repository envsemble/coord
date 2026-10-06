import { DownloadLink } from "../ui/DownloadLink";
function SourceLink({ href, children }) {
  return (
    <a className="source" href={href} target="_blank" rel="noopener">
      {children} ↗
    </a>
  );
}

export function ConceptDetails({ concept, sources }) {
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

export function About({ model, exports }) {
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
      <DownloadLink
        id="notes-download"
        data={exports.notes}
        filename="r5-model-notes.txt"
      >
        Source notes ↓
      </DownloadLink>
      <DownloadLink
        id="validation-download"
        data={exports.validation}
        filename="r5-validation.json"
        type="application/json"
      >
        Validation report ↓
      </DownloadLink>
      <p className="muted">
        JSON schema and structural checks pass. Full OntoUML semantics and
        editor import remain untested.
      </p>
    </>
  );
}

export function RelationDetails({ relation, onChoose }) {
  return (
    <>
      <span className="tag">
        {relation.type === "generalization"
          ? "Generalization"
          : relation.stereo
            ? `«${relation.stereo}»`
            : "Association"}
      </span>
      <h1>
        {relation.type === "generalization" ? "Inheritance" : relation.name}
      </h1>
      <div className="relation-ends">
        {[
          [relation.source, relation.ac],
          [relation.target, relation.bc],
        ].map(([node, count]) => (
          <div className="relation-end" key={node.id}>
            <button onClick={() => onChoose(node.name)}>{node.name}</button>
            {count && <span className="count-badge">{count}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
