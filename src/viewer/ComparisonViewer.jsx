import { useState } from "react";
import { Tabs } from "../ui/Tabs";
const modes = [
  { key: "baseline", label: "Baseline" },
  { key: "proposed", label: "Proposed" },
  { key: "changes", label: "Changes" },
];
const readable = (value) =>
  typeof value === "string" ? value : JSON.stringify(value);
export function ComparisonViewer({ payload, theme = "dark", render }) {
  const [mode, setMode] = useState("proposed"),
    [focus, setFocus] = useState(null);
  const comparison = payload.comparison;
  const active =
    mode === "baseline"
      ? comparison.baseline
      : mode === "changes"
        ? comparison.changeView
        : payload;
  const selected = { ...payload, ...active, comparison: undefined };
  const inspectTarget = (change) => {
    const model = comparison.changeView?.model || payload.model;
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
  return (
    <div className="atlas-panel atlas-comparison" data-theme={theme}>
      <header className="comparison-bar">
        <Tabs items={modes} value={mode} onChange={setMode} />
        <span className="spacer" />
        <details className="comparison-summary">
          <summary aria-label="Inspect changes">
            +{comparison.changes.counts.added} −
            {comparison.changes.counts.removed} Δ
            {comparison.changes.counts.modified}
            {comparison.conflicts.length
              ? ` · ${comparison.conflicts.length} conflicts`
              : ""}
          </summary>
          <div className="comparison-list" aria-label="Semantic changes">
            {comparison.conflicts.map((c) => (
              <details key={c.id}>
                <summary>
                  Conflict · {c.path.join(" / ") || "references"}
                </summary>
                <p>{c.reason}</p>
                {["base", "left", "right"].map((side) => (
                  <details key={side}>
                    <summary>{side}</summary>
                    <pre>
                      {c[side].present
                        ? JSON.stringify(c[side].value, null, 2)
                        : "Deleted"}
                    </pre>
                  </details>
                ))}
              </details>
            ))}
            {comparison.changes.changes.map((c) => (
              <details key={c.id}>
                <summary>
                  {c.kind} · {readable(c.name)}
                </summary>
                {inspectTarget(c) && (
                  <button
                    onClick={() => {
                      setMode("changes");
                      setFocus(inspectTarget(c));
                    }}
                  >
                    Inspect
                  </button>
                )}
                {c.properties.map((p) => (
                  <div key={p.key}>
                    <strong>{p.key}</strong>
                    <pre>
                      {p.before.present ? readable(p.before.value) : "Absent"} →{" "}
                      {p.after.present ? readable(p.after.value) : "Absent"}
                    </pre>
                  </div>
                ))}
                {c.rationale.length ? (
                  c.rationale.map((r) => <p key={r.id}>{r.text}</p>)
                ) : (
                  <p className="muted">No linked planning rationale.</p>
                )}
              </details>
            ))}
            {!comparison.changes.changes.length && <p>No semantic changes.</p>}
          </div>
        </details>
      </header>
      <div className="comparison-content">{render(selected, focus)}</div>
    </div>
  );
}
