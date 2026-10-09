import { useId, useMemo, useRef, useState } from "react";
import { SegmentedControl } from "../ui/Island";
import { usePopupDismiss } from "../ui/usePopupDismiss";
import {
  AlertIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  TriangleDownIcon,
} from "../ui/Icons";
import { reconcileComparisonFocus } from "./comparisonSelection";
import { formatCaptureDate } from "./provenance";

const modes = [
  {
    key: "baseline",
    label: "Baseline",
    title: "The captured source before the proposal",
  },
  {
    key: "changes",
    label: "Changes",
    title: "The proposal with added, removed and modified elements highlighted",
  },
];
const groups = [
  { kind: "added", label: "Added", Icon: DiffAddedIcon },
  { kind: "removed", label: "Removed", Icon: DiffRemovedIcon },
  { kind: "modified", label: "Modified", Icon: DiffModifiedIcon },
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
    <li className="change-item" data-change={change.kind}>
      <div className="change-row">
        <span className="change-name">
          {ownerName && kind !== "class" && !name.startsWith(ownerName) ? (
            <>
              <span className="muted">{ownerName}.</span>
              {name}
            </>
          ) : (
            name
          )}
        </span>
        <span className="change-kind">{kind}</span>
        {onInspect && (
          <button
            type="button"
            className="btn-sm"
            onClick={onInspect}
            aria-label={`Inspect ${name}`}
          >
            Inspect
          </button>
        )}
      </div>
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
      {change.rationale?.map((r) => (
        <p key={r.id} className="change-rationale">
          {r.title && <strong>{r.title}: </strong>}
          {r.text}
        </p>
      ))}
    </li>
  );
}

function Conflict({ conflict }) {
  return (
    <li className="change-item conflict">
      <details>
        <summary>
          <span className="change-name">
            {conflict.path.join(" / ") || "References"}
          </span>
        </summary>
        <p className="change-rationale">{conflict.reason}</p>
        {["base", "left", "right"].map((side) => (
          <div key={side} className="conflict-side">
            <span className="change-kind">{side}</span>
            <pre>
              {conflict[side].present
                ? JSON.stringify(conflict[side].value, null, 2)
                : "Deleted"}
            </pre>
          </div>
        ))}
      </details>
    </li>
  );
}

export function ChangeSummary({
  comparison,
  model,
  baselineDate,
  targetOf,
  onInspect,
}) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const popoverId = useId();
  usePopupDismiss(() => setOpen(false), root);
  const { counts, changes } = comparison.changes;
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
  const total = changes.length;
  const label = `${total} ${total === 1 ? "change" : "changes"}${
    conflicts.length
      ? `, ${conflicts.length} ${conflicts.length === 1 ? "conflict" : "conflicts"}`
      : ""
  }`;
  return (
    <div className="changes-menu" ref={root}>
      <button
        type="button"
        className="change-counts"
        aria-label={`Show ${label}`}
        aria-expanded={open}
        aria-controls={popoverId}
        title="Show semantic changes"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="count-added">+{counts.added}</span>
        <span className="count-removed">−{counts.removed}</span>
        <span className="count-modified">~{counts.modified}</span>
        {conflicts.length > 0 && (
          <span className="count-conflicts">
            <AlertIcon size={12} />
            {conflicts.length}
          </span>
        )}
        <TriangleDownIcon size={16} />
      </button>
      <div
        id={popoverId}
        className={`atlas-popover changes-popover${open ? " open" : ""}`}
        role="dialog"
        aria-label="Semantic changes"
        hidden={!open}
      >
        <header className="popover-header">
          <strong>{label.charAt(0).toUpperCase() + label.slice(1)}</strong>
          {baselineDate && (
            <span className="muted">
              Compared with source captured {baselineDate}
            </span>
          )}
        </header>
        <div className="popover-body">
          {conflicts.length > 0 && (
            <section className="change-group" data-kind="conflict">
              <h3>
                <AlertIcon size={16} />
                Conflicts
                <span className="counter">{conflicts.length}</span>
              </h3>
              <ul>
                {conflicts.map((c) => (
                  <Conflict key={c.id} conflict={c} />
                ))}
              </ul>
            </section>
          )}
          {groups.map(({ kind, label, Icon }) => {
            const items = changes.filter((c) => c.kind === kind);
            if (!items.length) return null;
            return (
              <section key={kind} className="change-group" data-kind={kind}>
                <h3>
                  <Icon size={16} />
                  {label}
                  <span className="counter">{items.length}</span>
                </h3>
                <ul>
                  {items.map((c) => {
                    const target = targetOf(c);
                    return (
                      <ChangeItem
                        key={c.id}
                        change={c}
                        kind={elementKind(c, model, model.document?.profile)}
                        names={names}
                        onInspect={
                          target
                            ? () => {
                                setOpen(false);
                                onInspect(target);
                              }
                            : null
                        }
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {!changes.length && (
            <p className="popover-empty">No semantic changes.</p>
          )}
        </div>
      </div>
    </div>
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
    <>
      <SegmentedControl
        label="Comparison"
        items={modes}
        value={mode}
        onChange={setMode}
      />
      <ChangeSummary
        comparison={comparison}
        model={inspectModel}
        baselineDate={formatCaptureDate(baseline?.capture?.capturedAt)}
        targetOf={inspectTarget}
        onInspect={inspect}
      />
    </>
  );
  return render(selected, focus, {
    comparisonControls,
    provenanceDocument: document,
  });
}
