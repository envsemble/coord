import { Badge, Text } from "@envsemble/envui";
import { ChangeBadge } from "../review/ChangeMark";
import { ConceptIcon } from "./Icons";

// Evidence status is worth a badge only when it qualifies what is shown:
// observed is the norm for captures, and a new element is not yet observed.
const STATUSES = {
  inferred: {
    label: "Inferred",
    tone: "neutral",
    title: "Interpreted from the evidence rather than observed in the source",
  },
  unresolved: {
    label: "Unresolved",
    tone: "warning",
    title: "The evidence leaves this open",
  },
};

export function DetailHeader({
  title,
  owner,
  tag,
  status,
  change,
  description,
  icon: Icon = ConceptIcon,
}) {
  const evidence = change !== "added" && STATUSES[status];
  return (
    <header className="detail-header">
      <div className="detail-title">
        <span className="detail-icon" aria-hidden="true">
          <Icon />
        </span>
        <Text as="h1" variant="page-heading">
          {owner && <span className="detail-owner">{owner}.</span>}
          {title}
        </Text>
      </div>
      {(tag || change || evidence) && (
        <div className="detail-tags">
          {tag && <Badge variant="outline">{tag}</Badge>}
          <ChangeBadge status={change} />
          {evidence && (
            <Badge tone={evidence.tone} title={evidence.title}>
              {evidence.label}
            </Badge>
          )}
        </div>
      )}
      {description && (
        <Text tone="muted" className="detail-description">
          {description}
        </Text>
      )}
    </header>
  );
}
