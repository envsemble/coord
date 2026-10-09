import { describeProvenance } from "./provenance";
import {
  CodeIcon,
  DatabaseIcon,
  GitPullRequestIcon,
  PencilAiIcon,
  FileCodeIcon,
} from "../ui/Icons";

function ProvenanceIcon({ provenance, profile }) {
  if (provenance.kind === "proposal") return <GitPullRequestIcon size={14} />;
  if (provenance.kind === "authored") return <PencilAiIcon size={14} />;
  if (profile === "database") return <DatabaseIcon size={14} />;
  if (profile === "code") return <CodeIcon size={14} />;
  return <FileCodeIcon size={14} />;
}

/** A Primer-style label naming where a model came from. */
export function ProvenanceLabel({ document }) {
  const provenance = describeProvenance(document);
  if (provenance.kind === "unknown") return null;
  return (
    <span
      className="provenance-label"
      data-tone={provenance.tone}
      data-kind={provenance.kind}
    >
      <ProvenanceIcon provenance={provenance} profile={document?.profile} />
      {provenance.label}
    </span>
  );
}

/** Provenance label followed by its human-readable detail line. */
export function ProvenanceBadge({ document, className = "" }) {
  const provenance = describeProvenance(document);
  if (provenance.kind === "unknown") return null;
  return (
    <div
      className={`atlas-provenance${className ? ` ${className}` : ""}`}
      title={
        provenance.detail
          ? `${provenance.label} · ${provenance.detail}`
          : provenance.label
      }
    >
      <ProvenanceLabel document={document} />
      {provenance.detail && (
        <span className="provenance-detail">{provenance.detail}</span>
      )}
    </div>
  );
}
