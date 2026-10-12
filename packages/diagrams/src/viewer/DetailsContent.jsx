import { memo } from "react";
import {
  Badge,
  Button,
  DisclosureNote,
  Kbd,
  Stack,
  Text,
} from "@envsemble/envui";
import { printable } from "../model/printable";
import { DownloadLink } from "../ui/DownloadLink";
import { SourceEvidence } from "./SourceEvidence";
import { ElementLearning } from "../learning/LearningContent";
import { DetailHeader } from "../ui/DetailHeader";
import { GeneralizationIcon, RelationIcon } from "../ui/Icons";
import { formatCaptureDate, sourceKindLabel } from "./provenance";

const changeValue = (cell) =>
  cell.present ? JSON.stringify(cell.value) : "absent";

function ChangeDetails({ element, model }) {
  const ids = new Set([
    element.originalId || element.id,
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
        <DisclosureNote title={`Changes · ${changes.length}`}>
          {changes.map((c) => (
            <Stack gap={1} key={c.id}>
              <Text>
                {c.kind} ·{" "}
                {typeof c.name === "string" ? c.name : JSON.stringify(c.name)}
              </Text>
              {c.properties.map((p) => (
                <Text variant="supporting" key={p.key}>
                  {p.key}: {changeValue(p.before)} → {changeValue(p.after)}
                </Text>
              ))}
              {c.rationale.map((r) => (
                <Text tone="muted" key={r.id}>
                  {r.text}
                </Text>
              ))}
            </Stack>
          ))}
        </DisclosureNote>
      )}
      {!!mappings.length && (
        <DisclosureNote title="Mappings">
          {mappings.map((m) => (
            <Stack gap={1} key={m.id}>
              <Text>
                {m.targetTitle} · {m.targetElementId}
              </Text>
              <Text>{m.reason}</Text>
              <Text variant="caption">
                Authored link · retained {m.targetProfile} snapshot
              </Text>
            </Stack>
          ))}
        </DisclosureNote>
      )}
    </>
  );
}

/** Names on the left, types on the right: attributes, columns and methods. */
function FieldList({ children }) {
  return <ul className="field-list">{children}</ul>;
}
function FieldRow({ name, detail, children }) {
  return (
    <li className="field-row">
      <span className="field-name">
        {name}
        {children}
      </span>
      <span className="field-detail">{detail}</span>
    </li>
  );
}
function SourceCode({ children }) {
  return (
    <pre className="source-code" tabIndex={0}>
      <code>{children}</code>
    </pre>
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
            <DisclosureNote title="Definition">
              <SourceCode>{concept.definition}</SourceCode>
            </DisclosureNote>
          )}
          {concept.methods?.length > 0 && (
            <DisclosureNote title={`Methods · ${concept.methods.length}`}>
              <ul className="field-list">
                {concept.methods.map((method) => (
                  <li className="method-row" key={method.id}>
                    {method.modifiers?.length > 0 && (
                      <span className="field-detail">
                        {method.modifiers.join(" ")}{" "}
                      </span>
                    )}
                    {method.type}
                  </li>
                ))}
              </ul>
            </DisclosureNote>
          )}
        </>
      )}
      {concept.attributes.length > 0 &&
        model.document?.profile !== "database" && (
          <DisclosureNote title={`Fields · ${concept.attributes.length}`}>
            <FieldList>
              {concept.attributes.map(
                ({ name, type, multiplicity: cardinality }, i) => (
                  <FieldRow
                    key={i}
                    name={name}
                    detail={`${type}${cardinality ? ` [${cardinality}]` : ""}`}
                  />
                ),
              )}
            </FieldList>
          </DisclosureNote>
        )}
    </>
  );
});

/** The two ends of a relation: each opens its element in the inspector. */
function RelationEnds({ heading, ends, onChoose }) {
  return (
    <Stack gap={1} className="relation-ends">
      {heading && (
        <Text as="h2" variant="section-heading">
          {heading}
        </Text>
      )}
      <ul className="relation-end-list">
        {ends.map(([node, count], i) => (
          <li className="relation-end" key={`${node.id}-${i}`}>
            <Button variant="text" onClick={() => onChoose(node.id)}>
              {node.name}
            </Button>
            {count && (
              <Badge variant="outline" className="count-badge">
                {count}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Stack>
  );
}

const setConstraints = (set) =>
  `{${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}`;

export const RelationDetails = memo(function RelationDetails({
  relation,
  onChoose,
  model,
  snippets,
}) {
  const generalization = relation.type === "generalization";
  return (
    <>
      <DetailHeader
        title={
          generalization
            ? relation.realization
              ? "Implementation"
              : "Inheritance"
            : relation.name
        }
        icon={generalization ? GeneralizationIcon : RelationIcon}
        tag={
          generalization
            ? "Generalization"
            : relation.stereotype
              ? `«${relation.stereotype}»`
              : "Association"
        }
        stereotype={relation.stereotype}
      />
      <RelationEnds
        ends={[
          [relation.source, relation.sourceMultiplicity],
          [relation.target, relation.targetMultiplicity],
        ]}
        onChoose={onChoose}
      />
      <ChangeDetails element={relation} model={model} />
      {(!model.document || model.document.profile === "ontouml") && (
        <ElementLearning element={relation} model={model} relation />
      )}
      {model.document?.profile === "database" && (
        <CapturedSchema element={relation} />
      )}
      {generalization &&
        (model.partitions || [])
          .filter((set) =>
            set.generalizations.includes(relation.originalId || relation.id),
          )
          .map((set) => (
            <Stack gap={1} className="generalization-set-summary" key={set.id}>
              <Text as="h2" variant="section-heading">
                {set.name}
              </Text>
              <Text tone="muted">{setConstraints(set)}</Text>
            </Stack>
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
        icon={GeneralizationIcon}
        description={group.description}
      />
      <RelationEnds
        heading="Supertype"
        ends={[[group.target]]}
        onChoose={onChoose}
      />
      <RelationEnds
        heading="Subtypes"
        ends={group.sources.map((node) => [node])}
        onChoose={onChoose}
      />
      {declared ? (
        <>
          <Text className="set-constraints">{setConstraints(group)}</Text>
          <DisclosureNote title="Read these constraints">
            <Text>
              {group.complete
                ? "Every instance of the supertype belongs to at least one subtype in this set."
                : "Instances of the supertype may belong to none of the subtypes in this set."}
            </Text>
            <Text>
              {group.disjoint
                ? "An instance cannot belong to two subtypes in this set at the same time."
                : "An instance may belong to more than one subtype in this set at the same time."}
            </Text>
          </DisclosureNote>
          {group.memberIds.length < group.totalMembers && (
            <Text tone="muted">
              {group.memberIds.length} of {group.totalMembers} members are
              shown. These constraints apply to the full set.
            </Text>
          )}
          <ElementLearning element={group} model={model} relation />
        </>
      ) : (
        <DisclosureNote title="Read joined inheritance">
          <Text tone="muted">
            These inheritance branches share a supertype. Joining their lines
            does not assert completeness or disjointness. Declare a
            generalization set in the model to express those constraints.
          </Text>
        </DisclosureNote>
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
    <DisclosureNote
      title={`Capture · ${capture.coverage.status}${document.imported ? " · imported claims" : ""}`}
    >
      <Text>Captured {formatCaptureDate(capture.capturedAt)}</Text>
      <Text>
        {sourceKindLabel(capture.source.kind)} · {capture.source.identity}
      </Text>
      <Text>{printable(capture.consistency?.kind)}</Text>
      {(capture.coverage.diagnostics || []).map((d, i) => (
        <Text key={i}>{printable(d.message ?? d)}</Text>
      ))}
      {[].concat(capture.limitations || []).map((text, i) => (
        <Text tone="muted" key={i}>
          {printable(text)}
        </Text>
      ))}
    </DisclosureNote>
  );
}
function CapturedSchema({ element }) {
  const sql = [
    element.definition,
    ...(element.constraints || []).map((c) => c.definition),
    ...(element.indexes || []).map((i) => i.definition),
    ...(element.triggers || []).map((t) => t.definition || t.sql),
  ].filter(Boolean);
  return (
    <>
      {element.attributes?.length > 0 && (
        <DisclosureNote title={`Columns · ${element.attributes.length}`} open>
          <FieldList>
            {element.attributes.map((column) => (
              <FieldRow
                key={column.id}
                name={column.name}
                detail={`${column.type} · ${column.nullable ? "nullable" : "required"}${
                  column.default !== null && column.default !== undefined
                    ? ` · default ${column.default}`
                    : ""
                }`}
              >
                {(column.primaryKeyOrder || column.generated) && (
                  <small className="field-note">
                    {column.primaryKeyOrder
                      ? ` · PK ${column.primaryKeyOrder}`
                      : ""}
                    {column.generated ? " · generated" : ""}
                  </small>
                )}
              </FieldRow>
            ))}
          </FieldList>
        </DisclosureNote>
      )}
      {element.keys?.length > 0 && (
        <DisclosureNote title="Keys">
          {element.keys.map((key) => (
            <Text key={key.name}>
              {key.primary ? "Primary" : "Unique"} · {key.columns.join(", ")}
            </Text>
          ))}
        </DisclosureNote>
      )}
      {sql.length > 0 && (
        <DisclosureNote title="Captured SQL">
          {sql.map((text, i) => (
            <SourceCode key={i}>{text}</SourceCode>
          ))}
        </DisclosureNote>
      )}
    </>
  );
}

/** Help for the standalone viewer: how to move around, and source downloads. */
export function About({ model, exports }) {
  return (
    <Stack gap={4} className="atlas-portal about-content">
      <Text tone="muted">{model.status}</Text>
      <dl className="shortcut-list">
        {[
          ["Scroll or pinch", "Zoom"],
          ["Drag", "Pan"],
          [
            <>
              <Kbd>+</Kbd> <Kbd>−</Kbd>
            </>,
            "Zoom in or out",
          ],
          [<Kbd>0</Kbd>, "Fit the diagram"],
          [<Kbd>/</Kbd>, "Find a concept"],
          [<Kbd>Esc</Kbd>, "Clear the selection"],
        ].map(([keys, action], i) => (
          <div className="shortcut" key={i}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <Stack gap={1} align="start">
        <DownloadLink
          data={exports.readText(`${exports.slug}-model-notes.txt`)}
          filename={`${exports.slug}-model-notes.txt`}
        >
          Source notes
        </DownloadLink>
        <DownloadLink
          data={exports.readText(`${exports.slug}-validation.json`)}
          filename={`${exports.slug}-validation.json`}
          type="application/json"
        >
          Validation report
        </DownloadLink>
      </Stack>
    </Stack>
  );
}
