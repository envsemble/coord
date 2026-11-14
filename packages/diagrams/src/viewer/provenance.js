// Shared wording for where a diagram came from. The dashboard uses the same
// labels, so keep them stable: generated captures, agent proposals and
// agent-authored models must remain distinguishable at a glance.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const SOURCE_KINDS = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  java: "Java",
  sqlite: "SQLite",
  d1: "Cloudflare D1",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  authored: "Authored model",
};

/** Formats an ISO timestamp as "Oct 8, 2026" (UTC, locale independent). */
export function formatCaptureDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function sourceKindLabel(kind) {
  if (typeof kind !== "string" || !kind) return "";
  return (
    SOURCE_KINDS[kind.toLowerCase()] ||
    kind.charAt(0).toUpperCase() + kind.slice(1)
  );
}

// A capture's own snapshot (a capture compared with an earlier one names it
// apart from its baseline), or what a proposal starts from.
function baselineSnapshot(document) {
  const snapshots = Array.isArray(document.snapshots) ? document.snapshots : [];
  const own = document.state === "snapshot" && document.captureId;
  return (
    snapshots.find((s) => s.id === (own || document.baselineId)) ||
    (document.state === "snapshot" ? snapshots[0] : undefined)
  );
}

function captureDetail(snapshot) {
  const capture = snapshot?.capture;
  if (!capture) return "";
  const date = formatCaptureDate(capture.capturedAt);
  return [
    sourceKindLabel(capture.source?.kind),
    capture.source?.identity,
    date && `captured ${date}`,
    capture.coverage?.status && `${capture.coverage.status} coverage`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Describes whether a model was generated from a source, proposed by an agent
 * or authored by an agent. Accepts an Coord document or a viewer model's
 * `document` metadata.
 */
export function describeProvenance(document) {
  if (!document || typeof document !== "object")
    return { kind: "unknown", label: "", detail: "", tone: "neutral" };
  let result;
  if (document.state === "snapshot") {
    const label =
      document.profile === "code"
        ? "Generated from code"
        : document.profile === "database"
          ? "Generated from database"
          : "Generated snapshot";
    result = {
      kind: "generated",
      label,
      detail: captureDetail(baselineSnapshot(document)),
      tone: "primary",
    };
  } else if (document.state === "proposal") {
    const date = formatCaptureDate(
      baselineSnapshot(document)?.capture?.capturedAt,
    );
    result = {
      kind: "proposal",
      label: "Agent proposal",
      detail: date ? `Changes to source captured ${date}` : "",
      tone: "accent",
    };
  } else if (document.state === "authored") {
    result = {
      kind: "authored",
      label: "Agent-authored",
      detail:
        document.profile === "object"
          ? "Object diagram"
          : document.profile === "class"
            ? "Class diagram"
            : document.profile === "database"
              ? "Entity diagram"
              : "Structural model",
      tone: "success",
    };
  } else return { kind: "unknown", label: "", detail: "", tone: "neutral" };
  return result;
}
