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
      {relation.type === "generalization" &&
        (model.partitions || [])
          .filter((set) => set.generalizations.includes(relation.id))
          .map((set) => (
            <div className="generalization-set-summary" key={set.id}>
              <h2>{set.name}</h2>
              <p>{`{${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}`}</p>
            </div>
          ))}
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
export function GeneralizationSetDetails({ group, onChoose, model, snippets }) {
  const declared = group.type === "generalizationSet";
  return (
    <>
      <span className="tag">
        {declared ? "Generalization set" : "Joined inheritance"}
      </span>
      <h1>{group.name}</h1>
      {group.description && <p>{group.description}</p>}
      <div className="relation-ends">
        <h2>Supertype</h2>
        <div className="relation-end">
          <button onClick={() => onChoose(group.target.id)}>
            {group.target.name}
          </button>
        </div>
        <h2>Subtypes</h2>
        {group.sources.map((node) => (
          <div className="relation-end" key={node.id}>
            <button onClick={() => onChoose(node.id)}>{node.name}</button>
          </div>
        ))}
      </div>
      {declared ? (
        <>
          <p className="set-constraints">{`{${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}}`}</p>
          <p>
            {group.complete
              ? "Every instance of the supertype belongs to at least one subtype in this set."
              : "Instances of the supertype may belong to none of the subtypes in this set."}
          </p>
          <p>
            {group.disjoint
              ? "An instance cannot belong to two subtypes in this set at the same time."
              : "An instance may belong to more than one subtype in this set at the same time."}
          </p>
          {group.memberIds.length < group.totalMembers && (
            <p className="muted">
              {group.memberIds.length} of {group.totalMembers} members are
              shown. These constraints apply to the full set.
            </p>
          )}
          <ElementLearning element={group} model={model} relation />
        </>
      ) : (
        <p className="muted">
          These inheritance branches share a supertype. Joining their lines does
          not assert completeness or disjointness. Declare a generalization set
          in the model to express those constraints.
        </p>
      )}
      <SourceEvidence
        evidence={group.evidence}
        primary={group.primarySource}
        sources={model.sources}
        snippets={snippets}
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
