import { memo } from "react";
import { Badge, Button, DisclosureNote, Stack, Text } from "@envsemble/envui";
import { SourceEvidence } from "./SourceEvidence";
import { DetailHeader } from "./DetailHeader";
import { GeneralizationIcon, RelationIcon } from "../ui/icons";
import { ChangeMark } from "../review/ChangeMark";
import { knownMultiplicity } from "../model/multiplicity";
import {
  cellText,
  dependencyMembers,
  describeClassChange,
  informativeName,
  memberSignature,
  referencedColumns,
  rowFor,
} from "../review/changes";
import { ChangedProperty } from "./sections/ChangedValue";
import { CodeWhere } from "./sections/CodeWhere";
import { Members } from "./sections/Members";
import { Section } from "./sections/Section";
import { TableSchema } from "./sections/TableSchema";
import { WhatChanges } from "./sections/WhatChanges";

const profileOf = (model) => model.document?.profile || "class";
const changeOf = (review, element) =>
  review && element.changeStatus && element.changeStatus !== "unchanged"
    ? element.changeStatus
    : null;

/**
 * A class, interface, table or concept: what a proposal changes about it, where
 * it is in code, and what it holds. `review` is the rolled-up
 * comparison while a proposal is shown.
 */
export const ConceptDetails = memo(function ConceptDetails({
  concept,
  model,
  snippets,
  review = null,
  member = null,
}) {
  const profile = profileOf(model);
  const change = changeOf(review, concept);
  const described = change
    ? describeClassChange(review.rollup, concept, profile)
    : null;
  return (
    <>
      <DetailHeader
        title={concept.name}
        owner={concept.namespace}
        tag={`«${concept.stereotype || "unspecified"}»`}
        status={concept.status}
        change={change}
        description={concept.description}
      />
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
      {profile === "database" ? (
        <TableSchema
          element={concept}
          model={model}
          review={!!review}
          rollup={review?.rollup}
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
          {relation.target.name}
          {referencedColumns(relation.targetColumns)}
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
}) {
  const profile = profileOf(model);
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
            {entry.notes.map((note, i) => (
              <li
                key={`${note.key}-${i}`}
                className="change-line"
                data-change="modified"
              >
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
      {profile !== "code" && relation.evidence?.length > 0 && (
        <SourceEvidence
          evidence={relation.evidence}
          sources={model.sources}
          snippets={snippets}
          label="Sources"
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
