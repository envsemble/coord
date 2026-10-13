import { memo } from "react";
import {
  Badge,
  Button,
  DisclosureNote,
  Kbd,
  Stack,
  Text,
} from "@envsemble/envui";
import { DownloadLink } from "../ui/DownloadLink";
import { SourceEvidence } from "./SourceEvidence";
import { ElementLearning } from "../learning/LearningContent";
import { DetailHeader } from "../ui/DetailHeader";
import { GeneralizationIcon, RelationIcon } from "../ui/Icons";
import { ChangeMark } from "../review/ChangeMark";
import { knownMultiplicity } from "../model/multiplicity";
import {
  cellText,
  dependencyMembers,
  describeClassChange,
  informativeName,
  rowFor,
} from "../review/changes";
import {
  ChangedProperty,
  CodeWhere,
  Members,
  Section,
  TableSchema,
  WhatChanges,
  Why,
  linkedRecords,
  memberSignature,
} from "./DetailSections";

const profileOf = (model) => model.document?.profile || "ontouml";
const changeOf = (review, element) =>
  review && element.changeStatus && element.changeStatus !== "unchanged"
    ? element.changeStatus
    : null;

/**
 * A class, interface, table or concept: what a proposal changes about it, where
 * it is in code, why it exists, and what it holds. `review` is the rolled-up
 * comparison while a proposal is shown.
 */
export const ConceptDetails = memo(function ConceptDetails({
  concept,
  model,
  snippets,
  review = null,
  member = null,
  onReference,
}) {
  const profile = profileOf(model);
  const conceptual = profile === "ontouml";
  const change = changeOf(review, concept);
  const described = change
    ? describeClassChange(review.rollup, concept, profile)
    : null;
  const records = linkedRecords(model, [
    concept.id,
    ...(concept.attributes || []).map((a) => a.id),
    ...(concept.methods || []).map((m) => m.id),
  ]);
  return (
    <>
      <DetailHeader
        title={concept.name}
        tag={`«${concept.stereotype || "unspecified"}»`}
        stereotype={concept.stereotype}
        status={concept.status}
        change={change}
        description={concept.description}
      />
      {conceptual && (
        <ElementLearning element={concept} model={model} parts="issues" />
      )}
      <WhatChanges
        change={described}
        element={concept}
        model={model}
        profile={profile}
      />
      {profile === "code" && (
        <CodeWhere
          element={concept}
          model={model}
          snippets={snippets}
          change={change}
        />
      )}
      <Why
        rationale={concept.rationale}
        questions={concept.questions}
        records={records}
        onReference={onReference}
      />
      {profile === "database" ? (
        <TableSchema
          element={concept}
          model={model}
          review={!!review}
          focus={member}
        />
      ) : (
        <Members
          element={concept}
          profile={profile}
          review={!!review}
          focus={member}
        />
      )}
      {profile !== "code" && profile !== "database" && (
        <SourceEvidence
          evidence={concept.evidence}
          primary={concept.primarySource}
          sources={model.sources}
          snippets={snippets}
          label="Sources"
        />
      )}
      {conceptual && (
        <ElementLearning element={concept} model={model} parts="lesson" />
      )}
    </>
  );
});

/** The two ends of a relation: each opens its element in the inspector. */
function RelationEnds({ heading, ends, onChoose }) {
  return (
    <Stack gap={1} className="relation-ends">
      {heading && (
        <Text as="h2" variant="caption" className="detail-section-title">
          {heading}
        </Text>
      )}
      <ul className="relation-end-list">
        {ends.map(([node, count, role], i) => (
          <li className="relation-end" key={`${node.id}-${i}`}>
            {role && <span className="relation-role">{role}</span>}
            <Button variant="text" onClick={() => onChoose(node.id)}>
              {node.name}
            </Button>
            {knownMultiplicity(count) && (
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

function relationTitle(relation) {
  if (relation.type === "generalization")
    return relation.realization ? "Implementation" : "Inheritance";
  return (
    informativeName(relation) ||
    `${relation.source.name} → ${relation.target.name}`
  );
}

function relationTag(relation) {
  if (relation.type === "generalization") return "Generalization";
  return relation.stereotype ? `«${relation.stereotype}»` : "Association";
}

/** Where a code dependency comes from: the source's members typed with the target. */
function DeclaredBy({ relation, profile }) {
  const members = dependencyMembers(relation.source, relation.target);
  if (!members.length) return null;
  return (
    <Section title="Declared by">
      <ul className="member-list">
        {members.map(({ member, method }) => (
          <li
            key={member.id}
            className="member"
            data-change={
              member.changeStatus && member.changeStatus !== "unchanged"
                ? member.changeStatus
                : undefined
            }
          >
            <ChangeMark status={member.changeStatus} />
            <code className="signature">
              {memberSignature(member, method, profile)}
            </code>
            {member.location && (
              <span className="member-line">{member.location.startLine}</span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ForeignKey({ relation }) {
  if (!Array.isArray(relation.columns)) return null;
  return (
    <Section title="Columns">
      <Text>
        <code>
          {relation.source.name}({relation.columns.join(", ")})
        </code>{" "}
        →{" "}
        <code>
          {relation.target.name}({(relation.targetColumns || []).join(", ")})
        </code>
      </Text>
      {(relation.onDelete || relation.onUpdate) && (
        <Text tone="muted">
          {[
            relation.onDelete && `On delete ${relation.onDelete.toLowerCase()}`,
            relation.onUpdate && `on update ${relation.onUpdate.toLowerCase()}`,
          ]
            .filter(Boolean)
            .join(", ")}
        </Text>
      )}
    </Section>
  );
}

export const RelationDetails = memo(function RelationDetails({
  relation,
  onChoose,
  model,
  snippets,
  review = null,
  onReference,
}) {
  const profile = profileOf(model);
  const conceptual = profile === "ontouml";
  const generalization = relation.type === "generalization";
  const change = changeOf(review, relation);
  const entry = change
    ? rowFor(review.rollup, { kind: "edge", id: relation.id }, model)
    : null;
  const semanticId = relation.originalId || relation.id;
  return (
    <>
      <DetailHeader
        title={relationTitle(relation)}
        icon={generalization ? GeneralizationIcon : RelationIcon}
        tag={relationTag(relation)}
        stereotype={relation.stereotype}
        change={change}
        description={relation.description}
      />
      <RelationEnds
        ends={
          generalization
            ? [
                [relation.source, null, "Subtype"],
                [
                  relation.target,
                  null,
                  relation.realization ? "Implements" : "Supertype",
                ],
              ]
            : [
                [relation.source, relation.sourceMultiplicity, "From"],
                [relation.target, relation.targetMultiplicity, "To"],
              ]
        }
        onChoose={onChoose}
      />
      {entry && entry.notes.length > 0 && (
        <Section title="What changes">
          <ul className="change-list">
            {entry.notes.map((note) => (
              <li key={note.key} className="change-line" data-change="modified">
                <ChangeMark status="modified" />
                <span className="change-line-text">
                  <ChangedProperty
                    name={note.key}
                    before={cellText(
                      note.before,
                      review.rollup.names,
                      note.property,
                    )}
                    after={cellText(
                      note.after,
                      review.rollup.names,
                      note.property,
                    )}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {profile === "code" && !generalization && (
        <DeclaredBy relation={relation} profile={profile} />
      )}
      {profile === "database" && <ForeignKey relation={relation} />}
      <Why
        rationale={relation.rationale}
        questions={relation.questions}
        records={linkedRecords(model, [semanticId])}
        onReference={onReference}
      />
      {conceptual && (
        <ElementLearning
          element={relation}
          model={model}
          relation
          parts="all-but-why"
        />
      )}
      {generalization &&
        (model.partitions || [])
          .filter((set) => set.generalizations.includes(semanticId))
          .map((set) => (
            <Stack gap={1} className="generalization-set-summary" key={set.id}>
              <Text as="h2" variant="section-heading">
                {set.name}
              </Text>
              <Text tone="muted">{setConstraints(set)}</Text>
            </Stack>
          ))}
      {conceptual && (
        <SourceEvidence
          evidence={
            relation.evidence?.length
              ? relation.evidence
              : [...relation.source.evidence, ...relation.target.evidence]
          }
          sources={model.sources}
          snippets={snippets}
          label={relation.evidence?.length ? "Sources" : "Endpoint evidence"}
        />
      )}
    </>
  );
});

export const GeneralizationSetDetails = memo(function GeneralizationSetDetails({
  group,
  onChoose,
  model,
  snippets,
  onReference,
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
          <Why
            records={linkedRecords(model, [group.id])}
            onReference={onReference}
          />
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
        label="Sources"
      />
    </>
  );
});

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
