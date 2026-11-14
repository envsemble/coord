import { memo, useState } from "react";
import { Badge, Column, Disclosure, Text } from "@envsemble/envui";
import { ToolButton } from "../ui/ToolButton";
import { NextIcon, PreviousIcon } from "../ui/icons";
import { CHANGE_LABELS, changeGlyph } from "./changes";
import { ChangeMark } from "./ChangeMark";

function Summary({ row }) {
  const { summary } = row;
  const note = summary.note && (
    <span className="change-row-note">{summary.note}</span>
  );
  if (summary.tokens.length)
    return (
      <>
        <span className="change-row-summary">
          {summary.tokens.map((token, i) => (
            <span key={i} className="change-token" data-change={token.status}>
              <span className="change-token-glyph" aria-hidden="true">
                {changeGlyph(token.status)}
              </span>
              <span className="visually-hidden">
                {CHANGE_LABELS[token.status]}{" "}
              </span>
              {token.text}
            </span>
          ))}
          {summary.more > 0 && (
            <span className="change-token more">+{summary.more} more</span>
          )}
        </span>
        {note}
      </>
    );
  if (!summary.text && !summary.more) return note || null;
  return (
    <>
      <span className="change-row-summary">
        {summary.text}
        {summary.more > 0 && (
          <span className="change-token more">
            {summary.text ? " " : ""}+{summary.more} more
          </span>
        )}
      </span>
      {note}
    </>
  );
}

function ChangeRow({ row, active, onSelect, onHover }) {
  const content = (
    <>
      <ChangeMark status={row.status} />
      <span className="change-row-text">
        <span className="change-row-title">
          <span className="change-row-name">{row.name}</span>
          {row.tag && <span className="change-row-tag">{row.tag}</span>}
        </span>
        <Summary row={row} />
      </span>
    </>
  );
  if (!row.target)
    return (
      <li className="change-row static" data-change={row.status}>
        {content}
      </li>
    );
  return (
    <li>
      {/* eslint-disable-next-line envui/no-html-elements -- a change row: its name is the whole summary (mark, name, kind, changed members), and the list's arrow keys move between rows; List.Item names its target by the label alone */}
      <button
        type="button"
        className="change-row"
        data-change={row.status}
        data-key={row.key}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(row)}
        onPointerEnter={() => onHover?.(row.target)}
        onPointerLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(row.target)}
        onBlur={() => onHover?.(null)}
      >
        {content}
      </button>
    </li>
  );
}

function RowList({ rows, label, active, onSelect, onHover }) {
  return (
    <ul className="change-rows" aria-label={label}>
      {rows.map((row) => (
        <ChangeRow
          key={row.key}
          row={row}
          active={active === row.key}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </ul>
  );
}

// Relations mostly follow from the types that changed: a long list of them
// stays folded unless the change being reviewed is one of them.
function RelationRows({ group, active, onSelect, onHover }) {
  const rows = group.relations;
  const [open, setOpen] = useState(() => rows.some((r) => r.key === active));
  const list = (
    <RowList
      rows={rows}
      label={`${group.label} relations`}
      active={active}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
  if (rows.length <= 3)
    return (
      <>
        <Text render={<h4 />} variant="body-sm" className="change-subheading">
          Relations
        </Text>
        {list}
      </>
    );
  return (
    <Disclosure
      className="change-relations"
      title={`Relations · ${rows.length}`}
      open={open}
      onOpenChange={setOpen}
    >
      {list}
    </Disclosure>
  );
}

// Rows inside a folded list of relations are hidden; its summary is not.
function shown(item) {
  const own = item.closest("details");
  const fold =
    item.tagName === "SUMMARY" ? own?.parentElement?.closest("details") : own;
  return !fold || fold.open;
}

// Up and down move between the rows of the whole list, as in a menu,
// including a folded list's summary, which opens it.
function moveFocus(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll("button.change-row, summary"),
  ].filter(shown);
  const at = buttons.indexOf(document.activeElement);
  if (at < 0 && !["Home", "End"].includes(event.key)) return;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : Math.min(
            buttons.length - 1,
            Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)),
          );
  event.preventDefault();
  buttons[next]?.focus();
}

/**
 * Every change in a proposal, one row per changed element: new, changed and
 * removed types with their members summarized, then the relations. Choosing
 * a row selects the element on the canvas and frames it. Memoized, so a hover
 * elsewhere in the viewer does not re-render the list.
 */
export const ChangesOverview = memo(function ChangesOverview({
  rollup,
  baselineDate,
  profile,
  active,
  onSelect,
  onHover,
}) {
  const source =
    profile === "code"
      ? "the code"
      : profile === "database"
        ? "the database"
        : "the model";
  return (
    <Column gap={4} className="changes-overview">
      <Text variant="body-sm">
        {rollup.total
          ? `Compared with ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.`
          : `No changes to ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.`}
      </Text>
      {rollup.conflicts.length > 0 && (
        <section className="change-group" data-change="conflict">
          <Text
            render={<h3 />}
            variant="title"
            className="coord-section-heading change-group-heading"
          >
            Conflicts
            <Badge count={rollup.conflicts.length} />
          </Text>
          {rollup.conflicts.map((conflict) => (
            <Disclosure
              key={conflict.id}
              title={conflict.path.join(" / ") || "References"}
            >
              <Text emphasis="muted">{conflict.reason}</Text>
            </Disclosure>
          ))}
        </section>
      )}
      <div className="change-groups" onKeyDown={moveFocus}>
        {rollup.groups.map((group) => (
          <section
            key={group.status}
            className="change-group"
            data-change={group.status}
            aria-label={`${group.label}, ${group.elements.length + group.relations.length}`}
          >
            <Text
              render={<h3 />}
              variant="title"
              className="coord-section-heading change-group-heading"
            >
              <ChangeMark status={group.status} />
              {group.label}
              <Badge count={group.elements.length + group.relations.length} />
            </Text>
            {group.elements.length > 0 && (
              <RowList
                rows={group.elements}
                label={`${group.label} elements`}
                active={active}
                onSelect={onSelect}
                onHover={onHover}
              />
            )}
            {group.relations.length > 0 && (
              <RelationRows
                group={group}
                active={active}
                onSelect={onSelect}
                onHover={onHover}
              />
            )}
          </section>
        ))}
      </div>
    </Column>
  );
});

/**
 * In the Changes panel's header: the previous and next change in the list's
 * order, and which one is selected. At either end a step button stays
 * focusable, marked unavailable, so keyboard focus is not lost.
 */
export function ChangeNavigation({ position, total, name, onStep }) {
  if (!total) return null;
  return (
    <span className="change-stepper" role="group" aria-label="Changes">
      <ToolButton
        label="Previous change"
        icon={<PreviousIcon />}
        aria-disabled={position === 0 || undefined}
        onClick={() => onStep(-1)}
      />
      <span className="change-position" aria-live="polite" aria-atomic="true">
        {position >= 0
          ? `${position + 1} of ${total}`
          : `${total} ${total === 1 ? "change" : "changes"}`}
        {position >= 0 && name && (
          <span className="visually-hidden">: {name}</span>
        )}
      </span>
      <ToolButton
        label="Next change"
        icon={<NextIcon />}
        aria-disabled={position === total - 1 || undefined}
        onClick={() => onStep(1)}
      />
    </span>
  );
}
