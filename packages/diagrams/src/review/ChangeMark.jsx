import { CHANGE_LABELS, changeGlyph } from "./changes";

/** The change's status as a small coloured mark: +, ~ or −. */
export function ChangeMark({ status }) {
  if (!CHANGE_LABELS[status]) return null;
  return (
    <span className="change-mark" data-change={status} aria-hidden="true">
      {changeGlyph(status)}
    </span>
  );
}

/** A New, Changed or Removed label in its change colour. */
export function ChangeBadge({ status }) {
  if (!CHANGE_LABELS[status]) return null;
  return (
    <span className="change-badge" data-change={status}>
      {CHANGE_LABELS[status]}
    </span>
  );
}
