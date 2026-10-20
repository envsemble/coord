import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Counter, DisclosureNote, Stack, Text } from "@envsemble/envui";
import { ToolButton } from "../ui/ToolButton";
import { BackIcon, NextIcon, PreviousIcon } from "../ui/icons";
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
function RelationRows({ group, active, returning, onSelect, onHover }) {
  const rows = group.relations;
  const [open, setOpen] = useState(() =>
    rows.some((r) => r.key === active || r.key === returning),
  );
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
        <Text as="h4" variant="caption" className="change-subheading">
          Relations
        </Text>
        {list}
      </>
    );
  return (
    <DisclosureNote
      className="change-relations"
      title={`Relations · ${rows.length}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {list}
    </DisclosureNote>
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
 * a row selects the element on the canvas and opens its details. Memoized, so
 * a hover elsewhere in the viewer does not re-render the list.
 */
export const ChangesOverview = memo(function ChangesOverview({
  rollup,
  baselineDate,
  profile,
  active,
  handoff,
  onSelect,
  onHover,
}) {
  const list = useRef(null);
  // Back from a change's details, focus returns to that change in the list
  // (after the inspector has scrolled its new content to the top).
  useEffect(() => {
    const request = handoff?.current;
    if (request?.to !== "overview") return;
    handoff.current = null;
    const rows = [
      ...(list.current?.querySelectorAll("button.change-row") || []),
    ];
    (rows.find((row) => row.dataset.key === request.key) || rows[0])?.focus();
  }, [handoff]);
  const source =
    profile === "code"
      ? "the code"
      : profile === "database"
        ? "the database"
        : "the model";
  return (
    <Stack gap={4} className="changes-overview">
      <Text variant="supporting">
        {rollup.total
          ? `Compared with ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.`
          : `No changes to ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.`}
      </Text>
      {rollup.conflicts.length > 0 && (
        <section className="change-group" data-change="conflict">
          <Text
            as="h3"
            variant="section-heading"
            className="change-group-heading"
          >
            Conflicts
            <Counter value={rollup.conflicts.length} />
          </Text>
          {rollup.conflicts.map((conflict) => (
            <DisclosureNote
              key={conflict.id}
              title={conflict.path.join(" / ") || "References"}
            >
              <Text tone="muted">{conflict.reason}</Text>
            </DisclosureNote>
          ))}
        </section>
      )}
      <div ref={list} className="change-groups" onKeyDown={moveFocus}>
        {rollup.groups.map((group) => (
          <section
            key={group.status}
            className="change-group"
            data-change={group.status}
            aria-label={`${group.label}, ${group.elements.length + group.relations.length}`}
          >
            <Text
              as="h3"
              variant="section-heading"
              className="change-group-heading"
            >
              <ChangeMark status={group.status} />
              {group.label}
              <Counter value={group.elements.length + group.relations.length} />
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
                returning={handoff?.current?.key}
                onSelect={onSelect}
                onHover={onHover}
              />
            )}
          </section>
        ))}
      </div>
    </Stack>
  );
});

/**
 * Above a changed element's details: back to every change, and the previous
 * and next change in the list's order. At either end a step button stays
 * focusable, marked unavailable, so keyboard focus is not lost.
 */
export function ChangeNavigation({
  position,
  total,
  name,
  handoff,
  onBack,
  onStep,
}) {
  const back = useRef(null);
  // Opened from the overview, keyboard focus lands on the way back.
  useLayoutEffect(() => {
    if (handoff?.current?.to !== "details") return;
    handoff.current = null;
    back.current?.focus();
  }, [handoff]);
  return (
    <div className="change-navigation">
      <Button
        ref={back}
        variant="text"
        className="change-back"
        aria-label="All changes"
        startIcon={<BackIcon />}
        onClick={onBack}
      >
        <span className="change-back-label">All changes</span>
      </Button>
      {total > 0 && (
        <span className="change-stepper" role="group" aria-label="Changes">
          <ToolButton
            label="Previous change"
            icon={<PreviousIcon />}
            aria-disabled={position === 0 || undefined}
            onClick={() => onStep(-1)}
          />
          <span
            className="change-position"
            aria-live="polite"
            aria-atomic="true"
          >
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
      )}
    </div>
  );
}
