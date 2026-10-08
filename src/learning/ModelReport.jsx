import { printable } from "../model/printable";
import { SourceEvidence } from "../viewer/SourceEvidence";
const inspectKind = (model, id) =>
  model.classes.some((n) => n.id === id)
    ? "node"
    : model.partitions.some((s) => s.id === id)
      ? "group"
      : "edge";
export function ModelReport({
  report,
  model,
  snippets,
  onInspect,
  onReference,
}) {
  const names = new Map(
    [
      ...model.classes,
      ...model.relations,
      ...model.generalizations,
      ...model.partitions,
    ].map((e) => [e.id, e.name || "Inheritance"]),
  );
  const show = (id) => (
    <button
      className="report-reference"
      onClick={() => onInspect({ kind: inspectKind(model, id), id })}
    >
      {names.get(id) || id}
    </button>
  );
  const context = (ids = []) =>
    report.context.records
      .filter((r) => ids.includes(r.id))
      .map((r) => (
        <blockquote key={r.id}>
          <strong>{r.title || r.kind}</strong>
          <p>{r.text}</p>
          {onReference && r.path && (
            <button onClick={() => onReference(r)}>
              Open planning passage
            </button>
          )}
        </blockquote>
      ));
  return (
    <article className="model-report" aria-label="Model report">
      <header>
        <p className="muted">
          Atlas · {report.profile} · {report.state}
        </p>
        <h1>{report.title}</h1>
        <p>{report.scope}</p>
        {report.author && <p>{report.author}</p>}
        {report.revision && (
          <p className="report-revision">
            Revision {report.revision.id}
            <br />
            {report.revision.createdAt}
          </p>
        )}
        <button className="report-print" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </header>
      <section>
        <h2>Source and scope</h2>
        {report.imported && (
          <p>
            Imported capture claims are preserved; the source has not been
            reverified.
          </p>
        )}
        {report.snapshots.length ? (
          report.snapshots.map((s) => (
            <details key={s.id} open>
              <summary>
                {s.id === report.baselineId ? "Baseline" : "Retained capture"} ·{" "}
                {s.capture.source.identity}
              </summary>
              <p>
                {s.capture.capturedAt} · {s.capture.adapter.id}{" "}
                {s.capture.adapter.version} · {s.capture.coverage.status}
              </p>
              <p>{s.capture.source.scope.join(", ")}</p>
              <pre>{printable(s.capture.source.revision || s.integrity)}</pre>
              <p>{printable(s.capture.consistency?.kind)}</p>
              {s.capture.coverage.diagnostics.map((d, i) => (
                <p key={i}>{printable(d.message ?? d)}</p>
              ))}
              {[].concat(s.capture.limitations || []).map((t, i) => (
                <p key={i}>{printable(t)}</p>
              ))}
            </details>
          ))
        ) : (
          <p>
            Authored model. Evidence supports interpretations within its stated
            limits.
          </p>
        )}
      </section>
      {report.walkthroughs.length > 0 && (
        <section>
          <h2>Walkthroughs</h2>
          {report.walkthroughs.map((w) => (
            <div key={w.id}>
              <h3>{w.title}</h3>
              {context(w.contextIds)}
              <ol>
                {w.steps.map((step, i) => (
                  <li key={i}>
                    <p>{step.text}</p>
                    {step.viewKey && (
                      <button
                        onClick={() =>
                          onInspect({ kind: "view", id: step.viewKey })
                        }
                      >
                        Open view
                      </button>
                    )}
                    <div>
                      {step.elementIds.map((id) => (
                        <span key={id}>{show(id)} </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Guided views</h2>
        {report.diagrams.map((d) => (
          <figure key={d.key}>
            <figcaption>{d.title}</figcaption>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`}
              alt={`${d.title}: UML diagram with members and relation counts`}
            />
            <a
              href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`}
              download={`${d.key}.svg`}
            >
              SVG
            </a>
          </figure>
        ))}
      </section>
      <section>
        <h2>Reading the model</h2>
        {report.explanations.map((e, i) => (
          <p key={i}>
            {show(e.elementId)} · {e.text}
            {!e.assessed && " Unestablished participation."}
          </p>
        ))}
      </section>
      {report.scenarios.length > 0 && (
        <section>
          <h2>Instances and counterexamples</h2>
          {report.scenarios.map((s) => (
            <div className="report-scenario" key={s.id}>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
              <p>
                Expected {s.expected} · assessed {s.result.outcome}
                {s.result.expectationMet === null
                  ? " · incomplete coverage"
                  : s.result.expectationMet
                    ? " · expectation met"
                    : " · expectation differs"}
              </p>
              {context(s.contextIds)}
              <table>
                <thead>
                  <tr>
                    <th>Instance</th>
                    <th>Memberships</th>
                  </tr>
                </thead>
                <tbody>
                  {s.instances.map((i) => (
                    <tr key={i.id}>
                      <td>{i.label || i.id}</td>
                      <td>
                        {i.classIds.map((id) => (
                          <span key={id}>{show(id)} </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.links.map((l, i) => (
                <p key={i}>
                  {l.sourceId} → {show(l.relationId)} → {l.targetId}
                </p>
              ))}
              {s.result.issues.map((finding, i) => (
                <p key={i}>
                  {show(finding.elementId)} · {finding.message}
                </p>
              ))}
              {s.result.unassessed.map((u, i) => (
                <p className="muted" key={i}>
                  {u.message}
                </p>
              ))}
            </div>
          ))}
        </section>
      )}
      <section>
        <h2>Glossary and selected planning context</h2>
        {report.context.records.map((r) => (
          <div key={r.id}>
            <h3>
              {r.title || r.id} · {r.kind}
            </h3>
            <p>{r.text}</p>
            {onReference && r.path && (
              <button onClick={() => onReference(r)}>
                Open planning passage
              </button>
            )}
          </div>
        ))}
      </section>
      <section>
        <h2>Classification and open questions</h2>
        {[...model.classes, ...model.relations]
          .filter((e) => e.rationale || e.questions?.length)
          .map((e) => (
            <div key={e.id}>
              <h3>{show(e.id)}</h3>
              <p>{printable(e.rationale)}</p>
              {[].concat(e.questions || []).map((q, i) => (
                <div key={i}>
                  <strong>{printable(q?.question ?? q)}</strong>
                  <p>{printable(q?.why)}</p>
                  <p>{printable(q?.resolve)}</p>
                </div>
              ))}
            </div>
          ))}
      </section>
      <section>
        <h2>Validation and coverage</h2>
        <p>
          {model.validation.counts.error} errors ·{" "}
          {model.validation.counts.warning} warnings ·{" "}
          {model.validation.counts.info} coverage notes
        </p>
        {model.validation.issues.map((issue, i) => (
          <p key={i}>
            {issue.severity} · {issue.code} · {issue.message}
          </p>
        ))}
        {report.limitations.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </section>
      <section>
        <h2>Evidence and references</h2>
        <SourceEvidence
          evidence={model.sources.map((s) => s.id)}
          sources={model.sources}
          snippets={snippets}
        />
        <p>
          <a
            href="https://ontouml.readthedocs.io/en/latest/"
            target="_blank"
            rel="noopener noreferrer"
          >
            OntoUML specification
          </a>
        </p>
      </section>
    </article>
  );
}
