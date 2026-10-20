import { Badge, Surface, Text } from "@envsemble/envui";
import { describeProvenance } from "./provenance";
import {
  AuthoredIcon,
  CodeIcon,
  DatabaseIcon,
  FileIcon,
  ProposalIcon,
} from "../ui/icons";

function ProvenanceIcon({ provenance, profile }) {
  if (provenance.kind === "proposal") return <ProposalIcon />;
  if (provenance.kind === "authored") return <AuthoredIcon />;
  if (profile === "database") return <DatabaseIcon />;
  if (profile === "code") return <CodeIcon />;
  return <FileIcon />;
}

/** An envUI badge naming where a model came from, in its provenance tone. */
export function ProvenanceLabel({ document }) {
  const provenance = describeProvenance(document);
  if (provenance.kind === "unknown") return null;
  return (
    <Badge
      tone={provenance.tone}
      icon={
        <ProvenanceIcon provenance={provenance} profile={document?.profile} />
      }
    >
      {provenance.label}
    </Badge>
  );
}

/** Provenance label followed by its human-readable detail line. */
export function ProvenanceBadge({ document, className = "" }) {
  const provenance = describeProvenance(document);
  if (provenance.kind === "unknown") return null;
  return (
    <Surface
      tone="pane"
      corners="pill"
      padding={1}
      density="compact"
      className={`atlas-provenance${className ? ` ${className}` : ""}`}
      title={
        provenance.detail
          ? `${provenance.label} · ${provenance.detail}`
          : provenance.label
      }
    >
      <ProvenanceLabel document={document} />
      {provenance.detail && (
        <Text as="span" variant="supporting" className="provenance-detail">
          {provenance.detail}
        </Text>
      )}
    </Surface>
  );
}
