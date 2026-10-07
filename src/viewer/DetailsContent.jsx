import { DownloadLink } from "../ui/DownloadLink";
import { SourceEvidence } from "./SourceEvidence";
import { ElementLearning } from "../learning/LearningContent";
import { DetailHeader } from "../ui/DetailHeader";
import { GitBranchIcon } from "../ui/Icons";
import { memo } from "react";

export const ConceptDetails = memo(function ConceptDetails({
  concept,
  model,
  snippets,
}) {
  return (
    <>
      <DetailHeader
        title={concept.name}
        tag={`«${concept.stereotype || "unspecified"}»`}
        stereotype={concept.stereotype}
        status={concept.status}
        description={concept.description}
      />
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
});
export const RelationDetails = memo(function RelationDetails({
  relation,
  onChoose,
  model,
  snippets,
}) {
  return (
    <>
      <DetailHeader
        title={
          relation.type === "generalization" ? "Inheritance" : relation.name
        }
        icon={GitBranchIcon}
        tag={
          relation.type === "generalization"
            ? "Generalization"
            : relation.stereotype
              ? `«${relation.stereotype}»`
              : "Association"
        }
        stereotype={relation.stereotype}
      />
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
});
export const GeneralizationSetDetails = memo(function GeneralizationSetDetails({
  group,
  onChoose,
  model,
  snippets,
}) {
  const declared = group.type === "generalizationSet";
  return (
    <>
      <DetailHeader
        title={group.name}
        tag={declared ? "Generalization set" : "Joined inheritance"}
        icon={GitBranchIcon}
        description={group.description}
      />
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
          <details className="learn-concept">
            <summary>Read these constraints</summary>
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
          </details>
          {group.memberIds.length < group.totalMembers && (
            <p className="muted">
              {group.memberIds.length} of {group.totalMembers} members are
              shown. These constraints apply to the full set.
            </p>
          )}
          <ElementLearning element={group} model={model} relation />
        </>
      ) : (
        <details className="learn-concept">
          <summary>Read joined inheritance</summary>
          <p className="muted">
            These inheritance branches share a supertype. Joining their lines
            does not assert completeness or disjointness. Declare a
            generalization set in the model to express those constraints.
          </p>
        </details>
      )}
      <SourceEvidence
        evidence={group.evidence}
        primary={group.primarySource}
        sources={model.sources}
        snippets={snippets}
      />
    </>
  );
});
export function About({ model, exports }) {
  return (
    <>
      <h1>{model.title}</h1>
      <p>Scroll or pinch to zoom · Drag to pan</p>
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
