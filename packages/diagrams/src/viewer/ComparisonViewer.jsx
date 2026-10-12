import { useMemo, useState } from "react";
import {
  Button,
  Counter,
  DisclosureNote,
  GroupedRows,
  Popover,
  Row,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@envsemble/envui";
import {
  AddedIcon,
  ConflictIcon,
  ExpandIcon,
  ModifiedIcon,
  RemovedIcon,
} from "../ui/Icons";
import { reconcileComparisonFocus } from "./comparisonSelection";
import { formatCaptureDate } from "./provenance";

const modes = [
  { value: "baseline", label: "Baseline" },
  { value: "changes", label: "Changes" },
];
const groups = [
  { kind: "added", label: "Added", Icon: AddedIcon },
  { kind: "removed", label: "Removed", Icon: RemovedIcon },
  { kind: "modified", label: "Modified", Icon: ModifiedIcon },
];
const ONTOUML_KINDS = {
  Class: "class",
  Relation: "relation",
  Generalization: "inheritance",
  GeneralizationSet: "generalization set",
  Package: "package",
  Literal: "literal",
};
const MAX_VALUE = 160;

function nameIndex(...models) {
  const names = new Map();
  for (const model of models) {
    if (!model) continue;
    for (const c of model.classes || []) {
      names.set(c.id, c.name);
      for (const m of [...(c.attributes || []), ...(c.methods || [])])
        names.set(m.id, `${c.name}.${m.name}`);
    }
    for (const e of [...(model.relations || []), ...(model.partitions || [])])
      if (e.name) names.set(e.id, e.name);
  }
  return names;
}

// Nested model elements are compared by reference; show their names instead.
function readable(value, names) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.$element === "string")
    return names.get(value.$element) || value.$element;
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => readable(item, names)).join(", ")
      : "none";
  const text = JSON.stringify(value, (key, v) =>
    v && typeof v === "object" && typeof v.$element === "string"
      ? names.get(v.$element) || v.$element
      : v,
  );
  return text === undefined ? String(value) : text;
}

function shorten(text) {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

function elementKind(change, model, profile) {
  const data = change.after || change.before || {};
  if (typeof data.type === "string" && ONTOUML_KINDS[data.type])
    return ONTOUML_KINDS[data.type];
  if (!change.elementId) return "model";
  if (model.classes.some((c) => c.id === change.elementId))
    return profile === "database"
      ? "table"
      : profile === "code"
        ? "type"
        : "class";
  if (model.relations.some((r) => r.id === change.elementId)) return "relation";
  if (model.generalizations.some((g) => g.id === change.elementId))
    return "inheritance";
  if (change.ownerId && model.classes.some((c) => c.id === change.ownerId))
    return profile === "database"
      ? "column"
      : profile === "code"
        ? "member"
        : "attribute";
  return "element";
}

// Retained comparisons may predate record de-duplication.
const uniqueRecords = (records = []) =>
  records.filter(
    (r, i) => r && records.findIndex((other) => other?.id === r.id) === i,
  );

function ValueCell({ cell, names, side }) {
  if (!cell.present)
    return <span className={`change-value ${side} absent`}>absent</span>;
  const text = readable(cell.value, names);
  return (
    <code className={`change-value ${side}`} title={text}>
      {shorten(text)}
    </code>
  );
}

function ChangeItem({ change, kind, names, onInspect }) {
  const ownerName = change.ownerId && names.get(change.ownerId);
  const name =
    typeof change.name === "string"
      ? change.name
      : readable(change.name, names);
  return (
    <Row
      className="change-item"
      data-change={change.kind}
      title={
        <span className="change-name">
          {ownerName && kind !== "class" && !name.startsWith(ownerName) ? (
            <>
              <span className="change-owner">{ownerName}.</span>
              {name}
            </>
          ) : (
            name
          )}
        </span>
      }
      detail={kind}
      action={
        onInspect ? (
          <Button
            variant="secondary"
            onClick={onInspect}
            aria-label={`Inspect ${name}`}
          >
            Inspect
          </Button>
        ) : undefined
      }
    >
      {change.properties?.length > 0 && (
        <dl className="change-properties">
          {change.properties.map((p) => (
            <div key={p.key} className="change-property">
              <dt>{p.key}</dt>
              <dd>
                <ValueCell cell={p.before} names={names} side="before" />
                <span className="change-arrow" aria-label="changed to">
                  →
                </span>
                <ValueCell cell={p.after} names={names} side="after" />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {uniqueRecords(change.rationale).map((r) => (
        <p key={r.id} className="change-rationale">
          {r.title && <strong>{r.title}: </strong>}
          {r.text}
        </p>
      ))}
    </Row>
  );
}

function Conflict({ conflict }) {
  return (
    <Row
      className="change-item conflict"
      title={
        <span className="change-name">
          {conflict.path.join(" / ") || "References"}
        </span>
      }
      detail={conflict.reason}
    >
      <DisclosureNote title="Base, left and right values">
        {["base", "left", "right"].map((side) => (
          <Stack gap={1} key={side} className="conflict-side">
            <Text variant="caption">{side}</Text>
            <pre className="source-code">
              {conflict[side].present
                ? JSON.stringify(conflict[side].value, null, 2)
                : "Deleted"}
            </pre>
          </Stack>
        ))}
      </DisclosureNote>
    </Row>
  );
}

function ChangeGroup({ kind, label, icon, count, children }) {
  return (
    <Stack as="section" gap={2} className="change-group" data-kind={kind}>
      <Text as="h3" variant="section-heading" className="change-group-heading">
        <span className="change-group-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
        <Counter value={count} />
      </Text>
      <GroupedRows contrast>{children}</GroupedRows>
    </Stack>
  );
}

const changeCountLabel = (total, conflicts) =>
  `${total} ${total === 1 ? "change" : "changes"}${
    conflicts
      ? `, ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`
      : ""
  }`;

/** The semantic change list: conflicts, then added, removed and modified elements. */
export function ChangeList({
  comparison,
  model,
  baselineDate,
  targetOf,
  onInspect,
}) {
  const { changes } = comparison.changes;
  const names = useMemo(
    () =>
      nameIndex(
        comparison.baseline?.model,
        comparison.changeView?.model,
        model,
      ),
    [comparison, model],
  );
  const conflicts = comparison.conflicts || [];
  const label = changeCountLabel(changes.length, conflicts.length);
  return (
    <Stack gap={4} className="atlas-portal change-summary">
      <Text variant="supporting">
        {label.charAt(0).toUpperCase() + label.slice(1)}
        {baselineDate && ` · compared with source captured ${baselineDate}`}
      </Text>
      {conflicts.length > 0 && (
        <ChangeGroup
          kind="conflict"
          label="Conflicts"
          icon={<ConflictIcon />}
          count={conflicts.length}
        >
          {conflicts.map((c) => (
            <Conflict key={c.id} conflict={c} />
          ))}
        </ChangeGroup>
      )}
      {groups.map(({ kind, label, Icon }) => {
        const items = changes.filter((c) => c.kind === kind);
        if (!items.length) return null;
        return (
          <ChangeGroup
            key={kind}
            kind={kind}
            label={label}
            icon={<Icon />}
            count={items.length}
          >
            {items.map((c) => {
              const target = targetOf(c);
              return (
                <ChangeItem
                  key={c.id}
                  change={c}
                  kind={elementKind(c, model, model.document?.profile)}
                  names={names}
                  onInspect={target ? () => onInspect(target) : null}
                />
              );
            })}
          </ChangeGroup>
        );
      })}
      {!changes.length && <Text tone="muted">No semantic changes.</Text>}
    </Stack>
  );
}

// Popover triggers need a component that passes its props to the button.
function CountsButton({ counts, conflicts, ...props }) {
  return (
    <Tooltip content="Semantic changes" side="bottom">
      <Button
        {...props}
        variant="secondary"
        className="change-counts"
        endIcon={<ExpandIcon />}
      >
        <span className="count-added">+{counts.added}</span>
        <span className="count-removed">−{counts.removed}</span>
        <span className="count-modified">~{counts.modified}</span>
        {conflicts > 0 && (
          <span className="count-conflicts">
            <ConflictIcon />
            {conflicts}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}

export function ChangeSummary(props) {
  const [open, setOpen] = useState(false);
  const { counts, changes } = props.comparison.changes;
  const conflicts = props.comparison.conflicts?.length || 0;
  return (
    <Popover
      title="Semantic changes"
      width="wide"
      align="start"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <CountsButton
          counts={counts}
          conflicts={conflicts}
          aria-label={`Show ${changeCountLabel(changes.length, conflicts)}`}
        />
      }
    >
      <ChangeList
        {...props}
        onInspect={(target) => {
          setOpen(false);
          props.onInspect(target);
        }}
      />
    </Popover>
  );
}

export function ComparisonViewer({
  payload,
  focus: incomingFocus = payload.focus,
  render,
}) {
  const [selection, setSelection] = useState({
    mode: "changes",
    focus: null,
    externalFocus: undefined,
  });
  const current = reconcileComparisonFocus(selection, payload, incomingFocus);
  if (current !== selection) setSelection(current);
  const { mode, focus } = current;
  const setMode = (mode) => setSelection((old) => ({ ...old, mode }));
  const comparison = payload.comparison;
  const changeView = comparison.changeView || payload;
  const active = mode === "baseline" ? comparison.baseline : changeView;
  const selected = { ...payload, ...active, comparison: undefined };
  const inspectModel = changeView.model || payload.model;
  const inspectTarget = (change) => {
    const model = inspectModel;
    const node = model.classes.find(
      (n) => n.id === change.elementId || n.id === change.ownerId,
    );
    if (node) return { kind: "node", id: node.id };
    if (
      [...model.relations, ...model.generalizations].some(
        (e) => e.id === change.elementId,
      )
    )
      return { kind: "edge", id: change.elementId };
    return null;
  };
  const inspect = (target) =>
    setSelection((old) => ({ ...old, mode: "changes", focus: { ...target } }));
  const document = payload.model.document;
  const baseline = document?.snapshots?.find(
    (s) => s.id === document.baselineId,
  );
  const comparisonControls = (
    <div className="comparison-controls" role="group" aria-label="Comparison">
      <SegmentedControl
        aria-label="Comparison view"
        size="compact"
        options={modes}
        value={mode}
        onValueChange={setMode}
      />
      <ChangeSummary
        comparison={comparison}
        model={inspectModel}
        baselineDate={formatCaptureDate(baseline?.capture?.capturedAt)}
        targetOf={inspectTarget}
        onInspect={inspect}
      />
    </div>
  );
  return render(selected, focus, {
    comparisonControls,
    provenanceDocument: document,
  });
}
