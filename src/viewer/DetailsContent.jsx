import { DownloadLink } from "../ui/DownloadLink";
import { SourceEvidence } from "./SourceEvidence";
import { ElementLearning } from "../learning/LearningContent";

export function ConceptDetails({ concept, model, snippets }) {
  return (
    <>
      <span className="tag">«{concept.stereotype || "unspecified"}»</span>
      {concept.status && (
        <span className="tag evidence-status">{concept.status}</span>
      )}
      <h1>{concept.name}</h1>
      {concept.description && <p>{concept.description}</p>}
      <SourceEvidence
        evidence={concept.evidence}
        primary={concept.primarySource}
        sources={model.sources}
        snippets={snippets}
      />
      <ElementLearning element={concept} model={model} />
      {concept.attributes.length > 0 && (
        <details className="concept-fields">
          <summary>Fields</summary>
          {concept.attributes.map(
            ({ name, type, multiplicity: cardinality }, i) => (
              <div className="field-row" key={i}>
                <span>{name}</span>
                <span>
                  {type}
                  {cardinality ? ` [${cardinality}]` : ""}
                </span>
              </div>
            ),
          )}
        </details>
      )}
    </>
  );
}
export function RelationDetails({ relation, onChoose, model, snippets }) {
  return (
    <>
      <span className="tag">
        {relation.type === "generalization"
          ? "Generalization"
          : relation.stereotype
            ? `«${relation.stereotype}»`
            : "Association"}
      </span>
      <h1>
        {relation.type === "generalization" ? "Inheritance" : relation.name}
      </h1>
      <div className="relation-ends">
        {[
          [relation.source, relation.sourceMultiplicity],
          [relation.target, relation.targetMultiplicity],
        ].map(([node, count], i) => (
          <div className="relation-end" key={i}>
            <button onClick={() => onChoose(node.id)}>{node.name}</button>
            {count && <span className="count-badge">{count}</span>}
          </div>
        ))}
      </div>
      <ElementLearning element={relation} model={model} relation />
      <SourceEvidence
        evidence={
          relation.evidence?.length
            ? relation.evidence
            : [...relation.source.evidence, ...relation.target.evidence]
        }
        sources={model.sources}
        snippets={snippets}
        label={relation.evidence?.length ? "Source" : "Endpoint evidence"}
      />
    </>
  );
}
export function About({ model, exports }) {
  return (
    <>
      <span className="tag">OntoUML Atlas</span>
      <h1>{model.title}</h1>
      <p>
        Two fingers to pan. Pinch to zoom. Select a concept or relation for
        evidence and learning help.
      </p>
      <p>
        <kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>0</kbd> fit · <kbd>Esc</kbd>{" "}
        clear
      </p>
      <p className="muted">{model.status}</p>
      <DownloadLink
        data={exports.readText(`${exports.slug}-model-notes.txt`)}
        filename={`${exports.slug}-model-notes.txt`}
      >
        Source notes ↓
      </DownloadLink>
      <DownloadLink
        data={exports.readText(`${exports.slug}-validation.json`)}
        filename={`${exports.slug}-validation.json`}
        type="application/json"
      >
        Validation report ↓
      </DownloadLink>
    </>
  );
}
