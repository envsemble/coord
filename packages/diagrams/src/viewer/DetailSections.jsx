import { useEffect, useRef, useState } from "react";
import { Button, DisclosureNote, Stack, Text } from "@envsemble/envui";
import { printable } from "../model/printable";
import { ToolButton } from "../ui/Button";
import { CodeSnippet } from "../ui/CodeSnippet";
import { ExternalIcon, LessIcon, MoreIcon } from "../ui/Icons";
import { ChangeMark } from "../review/ChangeMark";
import {
  CHANGE_LABELS,
  cellText,
  decodeIdentity,
  elementFile,
  fileExists,
  memberSignature,
  meaningfulProperties,
  rowFor,
} from "../review/changes";

/** One titled part of the details, such as What changes or Why. */
export function Section({ title, label = title, className = "", children }) {
  return (
    <Stack
      as="section"
      gap={2}
      className={`detail-section${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <Text as="h2" variant="caption" className="detail-section-title">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

/** Planning text with its inline code kept and Markdown emphasis dropped. */
export function InlineText({ text }) {
  const parts = (text === null || text === undefined ? "" : printable(text))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .split(/(`[^`\n]+`)/);
  return parts.map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

const RECORD_KINDS = {
  plan: "Plan",
  glossary: "Glossary",
  decision: "Decision",
  scenario: "Scenario",
};
export const recordLabel = (record) =>
  `${RECORD_KINDS[record.kind] || "Note"} › ${record.title || record.section || record.id}`;

// A passage's list markers read as bullets in a two-line excerpt.
const excerpt = (text) => text.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");

function Reference({ record, onReference }) {
  const [open, setOpen] = useState(false);
  const label = recordLabel(record);
  const text = excerpt(printable(record.text ?? "")).trim();
  const long = text.length > 110 || text.includes("\n");
  return (
    <li className="reference">
      <div className="reference-head">
        {onReference && typeof record.path === "string" ? (
          <Button
            variant="text"
            className="reference-link"
            aria-label={`Open ${label}`}
            onClick={() => onReference(record)}
          >
            {label}
          </Button>
        ) : (
          <Text as="span" className="reference-title">
            {label}
          </Text>
        )}
        {long && (
          <ToolButton
            className="reference-toggle"
            variant="text"
            label={open ? "Show less of the passage" : "Show the whole passage"}
            aria-expanded={open}
            icon={open ? <LessIcon /> : <MoreIcon />}
            onClick={() => setOpen((value) => !value)}
          />
        )}
      </div>
      {text && (
        <Text
          variant="supporting"
          className={`reference-excerpt${open ? " expanded" : ""}`}
        >
          <InlineText text={text} />
        </Text>
      )}
    </li>
  );
}

function Question({ question }) {
  return (
    <DisclosureNote
      className="detail-question"
      title={printable(question?.question ?? question)}
    >
      {question?.why && <Text>{printable(question.why)}</Text>}
      {question?.resolve && (
        <Text tone="muted">
          <strong>To resolve: </strong>
          {printable(question.resolve)}
        </Text>
      )}
    </DisclosureNote>
  );
}

/** The element's own rationale and open questions, then the planning passages linked to it. */
export function Why({ rationale, questions = [], records = [], onReference }) {
  const reasons = []
    .concat(rationale ?? [])
    .filter((r) => r !== null && r !== undefined && r !== "");
  const asked = [].concat(questions || []).filter(Boolean);
  if (!reasons.length && !asked.length && !records.length) return null;
  return (
    <Section title="Why">
      {reasons.map((reason, i) => (
        <Text key={i} className="detail-rationale">
          <InlineText text={reason} />
        </Text>
      ))}
      {asked.map((question, i) => (
        <Question key={i} question={question} />
      ))}
      {records.length > 0 && (
        <ul className="reference-list" aria-label="Planning references">
          {records.map((record) => (
            <Reference
              key={record.id}
              record={record}
              onReference={onReference}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Planning records linked to any of `ids`, each once, in the document's order. */
export function linkedRecords(model, ids) {
  const context = model.document?.context;
  if (!context) return [];
  const wanted = new Set(ids.filter(Boolean));
  const linked = new Set(
    context.links
      .filter((link) => wanted.has(link.elementId))
      .map((link) => link.recordId),
  );
  return context.records.filter((record) => linked.has(record.id));
}

const KIND_WORDS = { "type alias": "type alias", enum: "enum" };
const countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function contents(element, profile) {
  const fields = element.attributes?.length || 0,
    methods = element.methods?.length || 0;
  const field =
    profile === "database"
      ? "column"
      : element.stereotype === "enum"
        ? "member"
        : profile === "code"
          ? "field"
          : "attribute";
  return [
    fields ? countOf(fields, field) : "",
    methods ? countOf(methods, "method") : "",
  ]
    .filter(Boolean)
    .join(" and ");
}

// A member's type: its own, or the class an OntoUML attribute refers to.
const TYPE_KEYS = ["type", "propertyType"];
// What a member's signature already shows.
const SIGNATURE_KEYS = [...TYPE_KEYS, "name"];
const typeChange = (member) =>
  member.properties.some((p) => p.key === "name")
    ? null
    : member.properties.find((p) => TYPE_KEYS.includes(p.key)) || null;

/** A value before and after a change: the arrow reads as "changed to". */
export function ChangedValue({ before, after }) {
  return (
    <>
      <del className="change-before">{before}</del>
      <span className="change-arrow" aria-hidden="true">
        →
      </span>
      <span className="visually-hidden"> changed to </span>
      <ins className="change-after">{after}</ins>
    </>
  );
}

/** A changed property on one line: its name, then before → after. */
export function ChangedProperty({ name, before, after }) {
  return (
    <span>
      <span className="change-key">{name}</span>{" "}
      <ChangedValue before={before} after={after} />
    </span>
  );
}

/**
 * What the proposal does to a type: a new one and where it is meant to live,
 * a removed one and what disappears with it, or each changed member.
 */
export function WhatChanges({ change, element, model, profile }) {
  if (!change) return null;
  const kind =
    KIND_WORDS[element.stereotype] ||
    element.stereotype ||
    (profile === "database" ? "table" : "class");
  const held = contents(element, profile);
  if (change.status === "added") {
    const file = profile === "code" ? elementFile(element, model) : null;
    // Without a file to point at, the identity still names the declaration.
    const declared =
      profile === "code" && !file ? decodeIdentity(element.id)?.name : null;
    return (
      <Section title="What changes">
        <Text>
          New {kind}
          {held ? ` with ${held}` : ""}.
        </Text>
        {file ? (
          <Text className="proposed-location">
            Proposed in <code>{file}</code>
            {fileExists(model, file) ? "" : " (a new file)"}
          </Text>
        ) : (
          declared &&
          declared !== element.name && (
            <Text className="proposed-location">
              Proposed as <code>{declared}</code>
            </Text>
          )
        )}
      </Section>
    );
  }
  if (change.status === "removed")
    return (
      <Section title="What changes">
        <Text>
          The {kind} is removed{held ? `, with its ${held}` : ""}.
        </Text>
      </Section>
    );
  if (!change.properties.length && !change.members.length) return null;
  return (
    <Section title="What changes">
      <ul className="change-list">
        {change.properties.map((p, i) => (
          <li
            key={`${p.key}-${i}`}
            className="change-line"
            data-change="modified"
          >
            <ChangeMark status="modified" />
            <span className="change-line-text">
              <ChangedProperty name={p.key} before={p.before} after={p.after} />
            </span>
          </li>
        ))}
        {change.members.map((m) => (
          <li key={m.id} className="change-line" data-change={m.status}>
            <ChangeMark status={m.status} />
            <span className="change-line-text">
              <span className="visually-hidden">
                {CHANGE_LABELS[m.status]}:{" "}
              </span>
              {m.status === "modified" && !m.method && typeChange(m) ? (
                // A field whose type changed reads as its name and both types.
                <code className="signature">
                  <span className="member-name">{m.name}</span>
                  {profile === "database" ? " " : ": "}
                  <ChangedValue
                    before={typeChange(m).before}
                    after={typeChange(m).after}
                  />
                </code>
              ) : (m.status === "modified" || m.moved) &&
                m.previous &&
                m.previous !== m.signature ? (
                <code className="signature">
                  <ChangedValue before={m.previous} after={m.signature} />
                </code>
              ) : (
                <code className="signature">{m.signature}</code>
              )}
              {m.properties
                .filter((p) => !SIGNATURE_KEYS.includes(p.key))
                .map((p) => (
                  <span key={p.key} className="change-detail">
                    {p.key}: <ChangedValue before={p.before} after={p.after} />
                  </span>
                ))}
              {m.moved && (
                <span className="change-detail">
                  {m.moved.from
                    ? `Moved from ${m.moved.from}`
                    : `Moved to ${m.moved.to}`}
                </span>
              )}
            </span>
            {m.location && (
              <span
                className="member-line"
                title={`Line ${m.location.startLine}`}
              >
                {m.location.startLine}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function sourceOf(element, sources) {
  const ids = [element.primarySource, ...(element.evidence || [])].filter(
    Boolean,
  );
  return ids.map((id) => sources.find((s) => s.id === id)).find(Boolean);
}

/** Where a captured declaration is: its file and lines, and its source excerpt. */
export function CodeWhere({ element, model, snippets, change }) {
  if (change === "added") return null;
  const file = elementFile(element, model);
  const location = element.location;
  const source = sourceOf(element, model.sources || []);
  const snippet = source && snippets?.[source.id];
  if (!file && !snippet) return null;
  const url = snippet?.url || source?.url;
  return (
    <Section title={change === "removed" ? "Where it was" : "Where in code"}>
      <div className="code-where">
        <code className="code-path" title={file || undefined}>
          {file || source.file}
        </code>
        {location && (
          <span className="code-lines">
            {location.startLine === location.endLine
              ? `line ${location.startLine}`
              : `lines ${location.startLine}–${location.endLine}`}
          </span>
        )}
      </div>
      {snippet && (
        <CodeSnippet
          snippet={snippet}
          label={`${file || source.title}, lines ${snippet.startLine} to ${snippet.endLine}`}
        />
      )}
      {url && (
        <Button
          variant="text"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<ExternalIcon />}
          className="code-source-link"
        >
          {url.startsWith("https://github.com/")
            ? "View on GitHub"
            : "View source"}
        </Button>
      )}
    </Section>
  );
}

// A member the inspector was asked to show scrolls into view, highlighted,
// after the inspector has scrolled its new content to the top.
function useReveal(focused) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return ref;
}

function FocusableRow({ focused, change, children }) {
  const ref = useReveal(focused);
  return (
    <li
      ref={ref}
      className={`member${focused ? " focused" : ""}`}
      data-change={change}
      aria-current={focused ? "true" : undefined}
    >
      {children}
    </li>
  );
}

function MemberRow({ member, method, profile, review, focused }) {
  const status = review ? member.changeStatus : undefined;
  const marked = status && status !== "unchanged";
  const ref = useReveal(focused);
  return (
    <li
      ref={ref}
      className={`member${focused ? " focused" : ""}`}
      data-change={marked ? status : undefined}
      aria-current={focused ? "true" : undefined}
    >
      {review && <ChangeMark status={status} />}
      {marked && (
        <span className="visually-hidden">{CHANGE_LABELS[status]}: </span>
      )}
      <code className="signature">
        {method ? (
          member.type || `${member.name}()`
        ) : (
          <>
            <span className="member-name">
              {member.name}
              {member.optional ? "?" : ""}
            </span>
            {member.type && (
              <span className="member-type">
                {profile === "database" ? " " : ": "}
                {member.type}
                {member.multiplicity ? ` [${member.multiplicity}]` : ""}
              </span>
            )}
          </>
        )}
      </code>
      {member.location && (
        <span
          className="member-line"
          title={`Line ${member.location.startLine}`}
        >
          {member.location.startLine}
        </span>
      )}
    </li>
  );
}

/** Fields and methods, compactly, with change marks while reviewing a proposal. */
export function Members({ element, profile, review, focus = null }) {
  const fields = element.attributes || [],
    methods = element.methods || [];
  if (!fields.length && !methods.length) return null;
  const marks = review && element.changeStatus === "modified";
  const fieldTitle =
    element.stereotype === "enum"
      ? "Members"
      : profile === "code"
        ? "Fields"
        : "Attributes";
  return (
    <>
      {fields.length > 0 && (
        <Section title={`${fieldTitle} · ${fields.length}`} label={fieldTitle}>
          <ul className={`member-list${marks ? " marked" : ""}`}>
            {fields.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                profile={profile}
                review={marks}
                focused={member.id === focus}
              />
            ))}
          </ul>
        </Section>
      )}
      {methods.length > 0 && (
        <Section title={`Methods · ${methods.length}`} label="Methods">
          <ul className={`member-list${marks ? " marked" : ""}`}>
            {methods.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                method
                profile={profile}
                review={marks}
                focused={member.id === focus}
              />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// A foreign key keeps its identity when the proposal changes it: list it
// once, with the key it was (from the baseline's record of it) and what else
// changed; a key pointed at another table also leaves its earlier route in
// the change view. A removed key stays listed, marked removed.
function foreignKeys(element, model, rollup) {
  const outgoing = (model.relations || []).filter(
    (r) => r.sourceId === element.id && Array.isArray(r.columns),
  );
  const current = new Set(
    outgoing.filter((r) => r.changeStatus !== "removed").map((r) => r.id),
  );
  return outgoing
    .filter((r) => !(r.changeStatus === "removed" && current.has(r.originalId)))
    .map((relation) => {
      const status =
        rollup && relation.changeStatus && relation.changeStatus !== "unchanged"
          ? relation.changeStatus
          : undefined;
      const record =
        status === "modified"
          ? rowFor(
              rollup,
              { kind: "edge", id: relation.id },
              model,
            )?.changes.find((c) => c.elementId === relation.id)
          : null;
      const before = record?.before;
      const previous = Array.isArray(before?.columns)
        ? {
            columns: before.columns,
            targetId: before.targetId,
            target: before.target,
            targetColumns: before.targetColumns,
          }
        : null;
      // Whatever else changed, such as what a delete does.
      const details = meaningfulProperties(record).filter(
        (p) =>
          !["columns", "targetId", "target", "targetColumns", "name"].includes(
            p.key,
          ),
      );
      return { relation, previous, status, details, names: rollup?.names };
    });
}

/** A table's columns and keys, its foreign keys, and its definition. */
export function TableSchema({
  element,
  model,
  review,
  rollup = null,
  focus = null,
}) {
  const columns = element.attributes || [];
  const marks = review && element.changeStatus === "modified";
  const outgoing = foreignKeys(element, model, rollup);
  const tables = new Map(model.classes.map((c) => [c.id, c.name]));
  const keyText = (relation) =>
    `${relation.columns.join(", ")} → ${tables.get(relation.targetId) || relation.target}(${(relation.targetColumns || []).join(", ")})`;
  const unique = (element.keys || []).filter((key) => !key.primary);
  const sql = [
    element.definition,
    ...(element.constraints || []).map((c) => c.definition),
    ...(element.triggers || []).map((t) => t.definition || t.sql),
  ].filter(Boolean);
  return (
    <>
      {columns.length > 0 && (
        <Section title={`Columns · ${columns.length}`} label="Columns">
          <ul className={`member-list columns${marks ? " marked" : ""}`}>
            {columns.map((column) => {
              const status = marks ? column.changeStatus : undefined;
              const marked = status && status !== "unchanged";
              return (
                <FocusableRow
                  key={column.id}
                  focused={column.id === focus}
                  change={marked ? status : undefined}
                >
                  {marks && <ChangeMark status={status} />}
                  {marked && (
                    <span className="visually-hidden">
                      {CHANGE_LABELS[status]}:{" "}
                    </span>
                  )}
                  <code className="signature">
                    <span className="member-name">{column.name}</span>{" "}
                    <span className="member-type">
                      {column.type}
                      {column.nullable ? "" : " not null"}
                      {column.default !== null && column.default !== undefined
                        ? ` default ${column.default}`
                        : ""}
                    </span>
                  </code>
                  {(column.primaryKeyOrder || column.generated) && (
                    <span className="column-flags">
                      {column.primaryKeyOrder ? "PK" : ""}
                      {column.generated ? " generated" : ""}
                    </span>
                  )}
                </FocusableRow>
              );
            })}
          </ul>
        </Section>
      )}
      {(outgoing.length > 0 || unique.length > 0) && (
        <Section title="Keys">
          <ul
            className={`member-list${outgoing.some((key) => key.status) ? " marked" : ""}`}
          >
            {unique.map((key) => (
              <li key={key.name} className="member">
                <code className="signature">
                  <span className="member-name">unique</span>{" "}
                  <span className="member-type">
                    ({key.columns.join(", ")})
                  </span>
                </code>
              </li>
            ))}
            {outgoing.map(({ relation, previous, status, details, names }) => (
              <li
                key={relation.id}
                className="member"
                data-change={
                  status && status !== "unchanged" ? status : undefined
                }
              >
                {status && <ChangeMark status={status} />}
                {status && CHANGE_LABELS[status] && (
                  <span className="visually-hidden">
                    {CHANGE_LABELS[status]}:{" "}
                  </span>
                )}
                <span className="change-line-text">
                  <code className="signature">
                    {previous && keyText(previous) !== keyText(relation) ? (
                      <ChangedValue
                        before={keyText(previous)}
                        after={keyText(relation)}
                      />
                    ) : (
                      <>
                        <span className="member-name">
                          {relation.columns.join(", ")}
                        </span>{" "}
                        <span className="member-type">
                          → {tables.get(relation.targetId) || relation.target}(
                          {(relation.targetColumns || []).join(", ")})
                        </span>
                      </>
                    )}
                  </code>
                  {details.map((p) => (
                    <span key={p.key} className="change-detail">
                      {p.key}:{" "}
                      <ChangedValue
                        before={cellText(p.before, names, p.key)}
                        after={cellText(p.after, names, p.key)}
                      />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {sql.length > 0 && (
        <DisclosureNote title="Definition" className="detail-definition">
          {sql.map((text, i) => (
            <pre key={i} className="source-code" tabIndex={0}>
              <code>{text}</code>
            </pre>
          ))}
        </DisclosureNote>
      )}
    </>
  );
}

export { memberSignature };
