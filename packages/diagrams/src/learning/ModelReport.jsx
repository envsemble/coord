import {
  ActionGroup,
  Badge,
  Button,
  DisclosureNote,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
} from "@envsemble/envui";
import { printable } from "../model/printable";
import { SourceEvidence } from "../viewer/SourceEvidence";
import { ProvenanceBadge } from "../viewer/ProvenanceBadge";
import { formatCaptureDate } from "../viewer/provenance";
import { DownloadIcon, ExternalIcon, PrintIcon } from "../ui/Icons";
const inspectKind = (model, id) =>
  model.classes.some((n) => n.id === id)
    ? "node"
    : model.partitions.some((s) => s.id === id)
      ? "group"
      : "edge";
const SEVERITY_TONES = { error: "danger", warning: "warning", info: "neutral" };

function ReportSection({ title, children }) {
  return (
    <Stack as="section" gap={3} className="report-section">
      <Text as="h2" variant="page-heading">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

export function ModelReport({
  report,
  model,
  snippets,
  onInspect,
  onReference,
  onPrint = () => window.print(),
}) {
  const names = new Map(
    [
      ...model.classes,
      ...model.relations,
      ...model.generalizations,
      ...model.partitions,
    ].map((e) => [e.id, e.name || "Inheritance"]),
  );
  // Element names link to the element in the diagram.
  const show = (id) => (
    <Link
      href={`#${encodeURIComponent(id)}`}
      underline={false}
      className="report-reference"
      onClick={(event) => {
        event.preventDefault();
        onInspect({ kind: inspectKind(model, id), id });
      }}
    >
      {names.get(id) || id}
    </Link>
  );
  const references = (ids) => (
    <span className="report-references">
      {ids.map((id) => (
        <span key={id}>{show(id)}</span>
      ))}
    </span>
  );
  const openPassage = (record) =>
    onReference && record.path ? (
      <div>
        <Button variant="secondary" onClick={() => onReference(record)}>
          Open planning passage
        </Button>
      </div>
    ) : null;
  const context = (ids = []) =>
    report.context.records
      .filter((r) => ids.includes(r.id))
      .map((r) => (
        <blockquote className="report-quote" key={r.id}>
          <Text as="strong">{r.title || r.kind}</Text>
          <Text>{r.text}</Text>
          {openPassage(r)}
        </blockquote>
      ));
  return (
    <article className="model-report" aria-label="Model report">
      <Stack as="header" gap={3} align="start" className="report-header">
        <ProvenanceBadge document={report} className="inline" />
        <Text as="h1" variant="display">
          {report.title}
        </Text>
        <Text>{report.scope}</Text>
        {report.author && <Text tone="muted">{report.author}</Text>}
        {report.revision && (
          <Text variant="supporting" className="report-revision">
            Revision {report.revision.id} ·{" "}
            {formatCaptureDate(report.revision.createdAt)}
          </Text>
        )}
        <Button
          variant="outlined"
          className="report-print"
          startIcon={<PrintIcon />}
          onClick={onPrint}
        >
          Print or save as PDF
        </Button>
      </Stack>
      <ReportSection title="Source and scope">
        {report.imported && (
          <Text>
            Imported capture claims are preserved; the source has not been
            reverified.
          </Text>
        )}
        {report.snapshots.length ? (
          report.snapshots.map((s) => (
            <DisclosureNote
              key={s.id}
              open
              title={`${s.id === report.baselineId ? "Baseline" : "Retained capture"} · ${s.capture.source.identity}`}
            >
              <Text>
                Captured {formatCaptureDate(s.capture.capturedAt)} ·{" "}
                {s.capture.adapter.id} {s.capture.adapter.version} ·{" "}
                {s.capture.coverage.status}
              </Text>
              <Text>{s.capture.source.scope.join(", ")}</Text>
              <pre className="source-code">
                {printable(s.capture.source.revision || s.integrity)}
              </pre>
              <Text>{printable(s.capture.consistency?.kind)}</Text>
              {s.capture.coverage.diagnostics.map((d, i) => (
                <Text key={i}>{printable(d.message ?? d)}</Text>
              ))}
              {[].concat(s.capture.limitations || []).map((t, i) => (
                <Text key={i}>{printable(t)}</Text>
              ))}
            </DisclosureNote>
          ))
        ) : (
          <Text>
            Authored model. Evidence supports interpretations within its stated
            limits.
          </Text>
        )}
      </ReportSection>
      {report.walkthroughs.length > 0 && (
        <ReportSection title="Walkthroughs">
          {report.walkthroughs.map((w) => (
            <Stack gap={2} key={w.id}>
              <Text as="h3" variant="section-heading">
                {w.title}
              </Text>
              {context(w.contextIds)}
              <ol className="report-steps">
                {w.steps.map((step, i) => (
                  <li key={i}>
                    <Text>{step.text}</Text>
                    <ActionGroup className="report-step-actions">
                      {step.viewKey && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            onInspect({ kind: "view", id: step.viewKey })
                          }
                        >
                          Open view
                        </Button>
                      )}
                      {references(step.elementIds)}
                    </ActionGroup>
                  </li>
                ))}
              </ol>
            </Stack>
          ))}
        </ReportSection>
      )}
      <ReportSection title="Guided views">
        {report.diagrams.map((d) => {
          const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`;
          return (
            <figure className="report-figure" key={d.key}>
              <figcaption>
                <Text as="span" variant="section-heading">
                  {d.title}
                </Text>
                <Button
                  variant="text"
                  className="report-download"
                  href={url}
                  download={`${d.key}.svg`}
                  startIcon={<DownloadIcon />}
                  aria-label={`Download ${d.title} as SVG`}
                >
                  SVG
                </Button>
              </figcaption>
              <img
                src={url}
                alt={`${d.title}: UML diagram with members and relation counts`}
              />
            </figure>
          );
        })}
      </ReportSection>
      <ReportSection title="Reading the model">
        {report.explanations.map((e, i) => (
          <Text key={i}>
            {show(e.elementId)} · {e.text}
            {!e.assessed && " Unestablished participation."}
          </Text>
        ))}
      </ReportSection>
      {report.scenarios.length > 0 && (
        <ReportSection title="Instances and counterexamples">
          {report.scenarios.map((s) => (
            <Stack gap={2} className="report-scenario" key={s.id}>
              <Text as="h3" variant="section-heading">
                {s.title}
              </Text>
              <Text>{s.description}</Text>
              <Text variant="supporting">
                Expected {s.expected} · assessed {s.result.outcome}
                {s.result.expectationMet === null
                  ? " · incomplete coverage"
                  : s.result.expectationMet
                    ? " · expectation met"
                    : " · expectation differs"}
              </Text>
              {context(s.contextIds)}
              <Table aria-label={`Instances in ${s.title}`} density="compact">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Instance</TableHeaderCell>
                    <TableHeaderCell>Memberships</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {s.instances.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.label || i.id}</TableCell>
                      <TableCell>{references(i.classIds)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {s.links.map((l, i) => (
                <Text key={i}>
                  {l.sourceId} → {show(l.relationId)} → {l.targetId}
                </Text>
              ))}
              {s.result.issues.map((finding, i) => (
                <Text key={i}>
                  {show(finding.elementId)} · {finding.message}
                </Text>
              ))}
              {s.result.unassessed.map((u, i) => (
                <Text tone="muted" key={i}>
                  {u.message}
                </Text>
              ))}
            </Stack>
          ))}
        </ReportSection>
      )}
      <ReportSection title="Glossary and selected planning context">
        {report.context.records.map((r) => (
          <Stack gap={1} key={r.id}>
            <Text as="h3" variant="section-heading">
              {r.title || r.id} · {r.kind}
            </Text>
            <Text>{r.text}</Text>
            {openPassage(r)}
          </Stack>
        ))}
      </ReportSection>
      <ReportSection title="Classification and open questions">
        {[...model.classes, ...model.relations]
          .filter((e) => e.rationale || e.questions?.length)
          .map((e) => (
            <Stack gap={1} key={e.id}>
              <Text as="h3" variant="section-heading">
                {show(e.id)}
              </Text>
              <Text>{printable(e.rationale)}</Text>
              {[].concat(e.questions || []).map((q, i) => (
                <Stack gap={1} key={i} className="report-question">
                  <Text as="strong">{printable(q?.question ?? q)}</Text>
                  <Text>{printable(q?.why)}</Text>
                  <Text>{printable(q?.resolve)}</Text>
                </Stack>
              ))}
            </Stack>
          ))}
      </ReportSection>
      <ReportSection title="Validation and coverage">
        <ActionGroup className="report-counts">
          <Badge tone="danger">{model.validation.counts.error} errors</Badge>
          <Badge tone="warning">
            {model.validation.counts.warning} warnings
          </Badge>
          <Badge>{model.validation.counts.info} coverage notes</Badge>
        </ActionGroup>
        {model.validation.issues.map((issue, i) => (
          <Text key={i}>
            <Badge tone={SEVERITY_TONES[issue.severity] || "neutral"}>
              {issue.severity}
            </Badge>{" "}
            {issue.code} · {issue.message}
          </Text>
        ))}
        {report.limitations.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </ReportSection>
      <ReportSection title="Evidence and references">
        <SourceEvidence
          evidence={model.sources.map((s) => s.id)}
          sources={model.sources}
          snippets={snippets}
        />
        <div>
          <Button
            variant="text"
            href="https://ontouml.readthedocs.io/en/latest/"
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<ExternalIcon />}
          >
            OntoUML specification
          </Button>
        </div>
      </ReportSection>
    </article>
  );
}
