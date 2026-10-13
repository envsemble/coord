import { Badge, Text } from "@envsemble/envui";
import { stereotypeFamily } from "../visualization/UMLNode";
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

// Stereotype families with their own node colours in the diagram.
const COLOURED = new Set(["kind", "role", "relator", "phase", "event", "mode"]);

const colouredFamily = (stereotype) => {
  const family = stereotype && stereotypeFamily(stereotype);
  return COLOURED.has(family) ? family : null;
};

/** The stereotype's diagram colours, as a small swatch beside its name. */
export function StereotypeSwatch({ stereotype }) {
  const family = colouredFamily(stereotype);
  if (!family) return null;
  return (
    <span
      className="stereotype-swatch"
      aria-hidden="true"
      style={{
        background: `var(--node-${family}, var(--color-fill))`,
        borderColor: `var(--type-${family}, var(--color-border-strong))`,
      }}
    />
  );
}

export function DetailHeader({
  title,
  owner,
  tag,
  status,
  change,
  description,
  stereotype,
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
          {tag && (
            <Badge
              variant="outline"
              icon={
                colouredFamily(stereotype) ? (
                  <StereotypeSwatch stereotype={stereotype} />
                ) : undefined
              }
            >
              {tag}
            </Badge>
          )}
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
