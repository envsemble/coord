import { Text } from "@envsemble/envui";
import { ChangeMark } from "../../review/ChangeMark";
import { CHANGE_LABELS, elementFile, fileExists } from "../../review/changes";
import { ChangedProperty, ChangedValue } from "./ChangedValue";
import { Section } from "./Section";

const KIND_WORDS = { "type alias": "type alias", enum: "enum" };
const countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function contents(element, profile, except = new Set()) {
  const own = (members) => (members || []).filter((m) => !except.has(m.id));
  const fields = own(element.attributes).length,
    methods = own(element.methods).length;
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

const TYPE_KEYS = ["type"];
// What a member's signature already shows.
const SIGNATURE_KEYS = [...TYPE_KEYS, "name"];
const typeChange = (member) =>
  member.properties.some((p) => p.key === "name")
    ? null
    : member.properties.find((p) => TYPE_KEYS.includes(p.key)) || null;

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
  // A member that moved in or away is not new, or removed, with the type.
  const moved = change.moved || [];
  const held = contents(element, profile, new Set(moved.map((m) => m.id)));
  const movedText = moved.length
    ? `${moved
        .map((m) =>
          m.moved.to
            ? `${m.label} moved to ${m.moved.to}`
            : `${m.label} moved from ${m.moved.from}`,
        )
        .join("; ")}.`
    : "";
  if (change.status === "added") {
    const file = profile === "code" ? elementFile(element, model) : null;
    return (
      <Section title="What changes">
        <Text>
          New {kind}
          {held ? ` with ${held}` : ""}.
        </Text>
        {movedText && <Text>{movedText}</Text>}
        {file && (
          <Text className="proposed-location">
            Proposed in <code>{file}</code>
            {fileExists(model, file) ? "" : " (a new file)"}
          </Text>
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
        {movedText && <Text>{movedText}</Text>}
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
            data-change={p.status}
          >
            <ChangeMark status={p.status} />
            <span className="change-line-text">
              {p.status === "modified" ? (
                <ChangedProperty
                  name={p.key}
                  before={p.before}
                  after={p.after}
                />
              ) : (
                // A part of a table that is new or removed, as it reads.
                <span>
                  <span className="visually-hidden">
                    {CHANGE_LABELS[p.status]}:{" "}
                  </span>
                  <span className="change-key">{p.key}</span>{" "}
                  <code className="signature">
                    {p.status === "added" ? p.after : p.before}
                  </code>
                </span>
              )}
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
