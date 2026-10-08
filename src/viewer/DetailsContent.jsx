import { DownloadLink } from "../ui/DownloadLink";
import { SourceEvidence } from "./SourceEvidence";
import { ElementLearning } from "../learning/LearningContent";
import { DetailHeader } from "../ui/DetailHeader";
import { GitBranchIcon } from "../ui/Icons";
import { memo } from "react";
function ChangeDetails({ element, model }) {
  const ids = new Set([
    element.id,
    ...(element.attributes || []).map((a) => a.id),
    ...(element.methods || []).map((m) => m.id),
  ]);
  const changes =
    model.document?.comparison?.changes?.changes.filter((c) =>
      ids.has(c.elementId),
    ) || [];
  const mappings =
    model.document?.mappings?.filter((m) => ids.has(m.elementId)) || [];
  if (!changes.length && !mappings.length) return null;
  return (
    <>
      {!!changes.length && (
        <details>
          <summary>Changes · {changes.length}</summary>
          {changes.map((c) => (
            <div key={c.id}>
              <p>
                {c.kind} ·{" "}
                {typeof c.name === "string" ? c.name : JSON.stringify(c.name)}
              </p>
              {c.properties.map((p) => (
                <p key={p.key}>
                  {p.key}:{" "}
                  {p.before.present ? JSON.stringify(p.before.value) : "absent"}{" "}
                  → {p.after.present ? JSON.stringify(p.after.value) : "absent"}
                </p>
              ))}
              {c.rationale.map((r) => (
                <p key={r.id}>{r.text}</p>
              ))}
            </div>
          ))}
        </details>
      )}
      {!!mappings.length && (
        <details>
          <summary>Mappings</summary>
          {mappings.map((m) => (
            <div key={m.id}>
              <p>
                {m.targetTitle} · {m.targetElementId}
              </p>
              <p>{m.reason}</p>
              <small>Authored link · retained {m.targetProfile} snapshot</small>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

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
      {(!model.document || model.document.profile === "ontouml") && (
        <ElementLearning element={concept} model={model} />
      )}
      {model.document?.profile === "database" && (
        <CapturedSchema element={concept} />
      )}
      <CaptureDetails model={model} />
      <ChangeDetails element={concept} model={model} />
      {model.document?.profile === "code" && (
        <>
          {concept.definition && (
            <details className="concept-fields">
              <summary>Definition</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                <code>{concept.definition}</code>
              </pre>
            </details>
          )}
          {concept.methods?.length > 0 && (
            <details className="concept-fields">
              <summary>Methods</summary>
              {concept.methods.map((method) => (
                <p key={method.id}>
                  {method.modifiers?.join(" ")} {method.type}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {concept.attributes.length > 0 &&
        model.document?.profile !== "database" && (
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
          relation.type === "generalization"
            ? relation.realization
              ? "Implementation"
              : "Inheritance"
            : relation.name
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
      <ChangeDetails element={relation} model={model} />
      {(!model.document || model.document.profile === "ontouml") && (
        <ElementLearning element={relation} model={model} relation />
      )}
      {model.document?.profile === "database" && (
        <CapturedSchema element={relation} />
      )}
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
function CaptureDetails({ model }) {
  const document = model.document;
  const snapshot = document?.snapshots.find(
    (s) => s.id === document.baselineId,
  );
  if (!snapshot) return null;
  const capture = snapshot.capture;
  return (
    <details className="concept-fields">
      <summary>
        Capture · {capture.coverage.status}
        {document.imported ? " · imported claims" : ""}
      </summary>
      <p>{capture.capturedAt}</p>
      <p>
        {capture.source.kind} · {capture.source.identity}
      </p>
      <p>{capture.consistency?.kind}</p>
      {(capture.coverage.diagnostics || []).map((d, i) => (
        <p key={i}>{d.message}</p>
      ))}
      {(capture.limitations || []).map((text, i) => (
        <p className="muted" key={i}>
          {text}
        </p>
      ))}
    </details>
  );
}
function CapturedSchema({ element }) {
  return (
    <>
      {element.attributes?.length > 0 && (
        <details className="concept-fields" open>
          <summary>Columns</summary>
          {element.attributes.map((column) => (
            <div className="field-row" key={column.id}>
              <span>
                {column.name}
                <small>
                  {column.primaryKeyOrder
                    ? ` · PK ${column.primaryKeyOrder}`
                    : ""}
                  {column.generated ? " · generated" : ""}
                </small>
              </span>
              <span>
                {column.type} · {column.nullable ? "nullable" : "required"}
                {column.default !== null && column.default !== undefined
                  ? ` · default ${column.default}`
                  : ""}
              </span>
            </div>
          ))}
        </details>
      )}
      {element.keys?.length > 0 && (
        <details className="concept-fields">
          <summary>Keys</summary>
          {element.keys.map((key) => (
            <p key={key.name}>
              {key.primary ? "Primary" : "Unique"} · {key.columns.join(", ")}
            </p>
          ))}
        </details>
      )}
      {[
        element.definition,
        ...(element.constraints || []).map((c) => c.definition),
        ...(element.indexes || []).map((i) => i.definition),
        ...(element.triggers || []).map((t) => t.definition || t.sql),
      ].filter(Boolean).length > 0 && (
        <details className="concept-fields">
          <summary>Captured SQL</summary>
          {[
            element.definition,
            ...(element.constraints || []).map((c) => c.definition),
            ...(element.indexes || []).map((i) => i.definition),
            ...(element.triggers || []).map((t) => t.definition || t.sql),
          ]
            .filter(Boolean)
            .map((sql, i) => (
              <pre
                key={i}
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                <code>{sql}</code>
              </pre>
            ))}
        </details>
      )}
    </>
  );
}
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
