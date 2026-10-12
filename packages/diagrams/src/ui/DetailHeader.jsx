import { Badge, DisclosureNote, Text } from "@envsemble/envui";
import { stereotypeFamily } from "../visualization/UMLNode";
import { ConceptIcon } from "./Icons";

const STATUS_TONES = {
  observed: "success",
  inferred: "neutral",
  unresolved: "warning",
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
  tag,
  status,
  description,
  stereotype,
  icon: Icon = ConceptIcon,
}) {
  return (
    <header className="detail-header">
      <div className="detail-title">
        <span className="detail-icon" aria-hidden="true">
          <Icon />
        </span>
        <Text as="h1" variant="page-heading">
          {title}
        </Text>
      </div>
      <div className="detail-tags">
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
        {status && (
          <Badge tone={STATUS_TONES[status] || "neutral"}>{status}</Badge>
        )}
      </div>
      {description && (
        <DisclosureNote title="Description">
          <Text tone="muted">{description}</Text>
        </DisclosureNote>
      )}
    </header>
  );
}
