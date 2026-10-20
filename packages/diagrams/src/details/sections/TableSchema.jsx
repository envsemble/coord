import { DisclosureNote } from "@envsemble/envui";
import { ChangeMark } from "../../review/ChangeMark";
import {
  CHANGE_LABELS,
  cellText,
  itemChanges,
  meaningfulProperties,
  partChange,
  partKey,
  referencedColumns,
  rowFor,
} from "../../review/changes";
import { ChangedValue } from "./ChangedValue";
import { Described, FocusableRow } from "./Members";
import { Section } from "./Section";

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
  // Its unique keys as the proposal changes them: new, changed or removed.
  const record = rollup
    ? rowFor(rollup, { kind: "node", id: element.id })?.changes.find(
        (c) => c.elementId === element.id,
      )
    : null;
  const keyNote = record?.properties?.find((p) => p.key === "keys");
  const keyChanges = new Map(
    (keyNote ? itemChanges(keyNote) || [] : [])
      .filter((c) => !(c.after ?? c.before)?.primary)
      .map((c) => [(c.after ?? c.before).name, c]),
  );
  const tables = new Map(model.classes.map((c) => [c.id, c.name]));
  const keyText = (relation) =>
    `${relation.columns.join(", ")} → ${tables.get(relation.targetId) || relation.target}${referencedColumns(relation.targetColumns)}`;
  const unique = [
    ...(element.keys || []).filter((key) => !key.primary),
    ...[...keyChanges.values()]
      .filter((c) => c.status === "removed")
      .map((c) => c.before),
  ];
  // Foreign keys to tables outside the capture have no relation to show
  // them: the table lists them itself, with their changes. A key is shown by
  // a current relation from this table over the same columns to the same
  // table.
  const shownByRelation = (key) =>
    outgoing.some(
      ({ relation }) =>
        relation.changeStatus !== "removed" &&
        JSON.stringify(relation.columns) === JSON.stringify(key.columns) &&
        (relation.target === key.target ||
          tables.get(relation.targetId) === key.target),
    );
  const foreignNote = record?.properties?.find((p) => p.key === "foreignKeys");
  const foreignChanges = new Map(
    (foreignNote ? itemChanges(foreignNote) || [] : []).map((c) => [
      partKey(c.after ?? c.before),
      c,
    ]),
  );
  const external = [
    ...(element.foreignKeys || []).filter(
      (key) =>
        Array.isArray(key.columns) &&
        typeof key.target === "string" &&
        !shownByRelation(key),
    ),
    ...[...foreignChanges.values()]
      .filter((c) => c.status === "removed")
      .map((c) => c.before),
  ];
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
                  <Described description={column.description}>
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
                  </Described>
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
      {(outgoing.length > 0 || unique.length > 0 || external.length > 0) && (
        <Section title="Keys">
          <ul
            className={`member-list${outgoing.some((key) => key.status) || keyChanges.size || foreignChanges.size ? " marked" : ""}`}
          >
            {unique.map((key) => {
              const change = keyChanges.get(key.name);
              return (
                <li
                  key={key.name}
                  className="member"
                  data-change={change?.status}
                >
                  {change && <ChangeMark status={change.status} />}
                  {change && (
                    <span className="visually-hidden">
                      {CHANGE_LABELS[change.status]}:{" "}
                    </span>
                  )}
                  <code className="signature">
                    <span className="member-name">unique</span>{" "}
                    <span className="member-type">
                      {change?.status === "modified" ? (
                        <ChangedValue
                          before={partChange(change.before, change.after)[0]}
                          after={partChange(change.before, change.after)[1]}
                        />
                      ) : (
                        `(${key.columns.join(", ")})`
                      )}
                    </span>
                  </code>
                </li>
              );
            })}
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
                          → {tables.get(relation.targetId) || relation.target}
                          {referencedColumns(relation.targetColumns)}
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
            {external.map((key) => {
              const change = foreignChanges.get(partKey(key));
              return (
                <li
                  key={partKey(key)}
                  className="member"
                  data-change={change?.status}
                >
                  {change && <ChangeMark status={change.status} />}
                  {change && (
                    <span className="visually-hidden">
                      {CHANGE_LABELS[change.status]}:{" "}
                    </span>
                  )}
                  <code className="signature">
                    {change?.status === "modified" ? (
                      <ChangedValue
                        before={partChange(change.before, change.after)[0]}
                        after={partChange(change.before, change.after)[1]}
                      />
                    ) : (
                      <>
                        <span className="member-name">
                          {key.columns.join(", ")}
                        </span>{" "}
                        <span className="member-type">
                          → {key.target}
                          {referencedColumns(key.targetColumns)}
                        </span>
                      </>
                    )}
                  </code>
                </li>
              );
            })}
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
