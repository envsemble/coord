import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Counter, Tooltip } from "@envsemble/envui";
import { ToolButton } from "../ui/Button";
import { FadeIcon, ProposalIcon } from "../ui/Icons";
import { ChangeNavigation, ChangesOverview } from "./ChangesOverview";
import { cachedRollup, rowFor } from "./changes";

// The overview opens with a proposal when the window leaves the diagram room
// beside it; in smaller windows the Changes button opens it.
const ROOMY_WIDTH = 1280;
/** Whether a proposal opens with its changes overview showing. */
export const overviewByDefault = () =>
  typeof window !== "undefined" && window.innerWidth >= ROOMY_WIDTH;

/**
 * Reviewing a proposal: the rolled-up changes, fading unchanged elements, and
 * stepping through changes. `review` is `{ comparison, baselineDate }`, or
 * null outside a proposal; `model` and `views` are the change view's;
 * `overview` says whether the inspector lists the changes when no element is
 * inspected.
 */
export function useChangeReview({
  review,
  model,
  views,
  selected,
  overview,
  setOverview,
  choose,
  select,
  hover,
  onShowPanel,
}) {
  // The rollup is shared with the Changes button's count, computed once per
  // comparison.
  const rollup = useMemo(
    () => (review ? cachedRollup(review.comparison, model, views) : null),
    [review, model, views],
  );
  // Details read the rollup; one object per rollup keeps them memoized.
  const details = useMemo(() => (rollup ? { rollup } : null), [rollup]);
  const [fade, setFade] = useState(true);
  // Keyboard focus follows the reader between the overview and the details,
  // whose controls replace each other in the inspector.
  const handoff = useRef(null);
  const current = rollup && selected ? rowFor(rollup, selected, model) : null;
  const position = current ? rollup.navigable.indexOf(current) : -1;
  const total = rollup?.navigable.length || 0;
  const open = useCallback(
    (row) => {
      if (row?.target) choose(row.target.id);
    },
    [choose],
  );
  const step = useCallback(
    (delta) => {
      if (!rollup) return;
      const next =
        position < 0 ? (delta > 0 ? 0 : total - 1) : position + delta;
      // At either end there is nothing further; the button stays focused.
      if (next < 0 || next >= total) return;
      open(rollup.navigable[next]);
    },
    [rollup, position, total, open],
  );
  const back = useCallback(() => {
    setOverview(true);
    onShowPanel?.();
    select(null);
  }, [select, onShowPanel, setOverview]);
  const openRow = useCallback(
    (row) => {
      handoff.current = { to: "details" };
      open(row);
    },
    [open],
  );
  // Focus returns to the change that was open, still listed in the overview.
  const backToOverview = useCallback(() => {
    handoff.current = { to: "overview", key: current?.key };
    back();
  }, [back, current]);
  // The overview keeps one element while its inputs stay the same, so a hover
  // elsewhere in the viewer does not rebuild the list.
  const baselineDate = review?.baselineDate;
  const profile = model.document?.profile;
  const activeKey = current?.key;
  const content = useMemo(
    () =>
      rollup ? (
        <ChangesOverview
          rollup={rollup}
          baselineDate={baselineDate}
          profile={profile}
          active={activeKey}
          handoff={handoff}
          onSelect={openRow}
          onHover={hover}
        />
      ) : null,
    [rollup, baselineDate, profile, activeKey, openRow, hover],
  );
  if (!rollup) return null;
  return {
    rollup,
    details,
    /** Leaving a change's details by keyboard returns focus to it in the overview. */
    returnFocus: () => {
      if (overview) handoff.current = { to: "overview", key: current?.key };
    },
    fade,
    position,
    total,
    /** Toolbar controls: the changes overview toggle and fading. */
    controls: (showing) => (
      <>
        <Tooltip
          content={showing ? "Hide the changes" : "Show every change"}
          side="bottom"
        >
          <Button
            variant={showing ? "primary" : "secondary"}
            className="changes-toggle"
            aria-pressed={showing}
            aria-label={`Changes, ${rollup.count}`}
            startIcon={<ProposalIcon />}
            onClick={() => {
              if (showing) setOverview(false);
              else back();
            }}
          >
            <span className="collapsible-label">Changes</span>
            <Counter
              value={rollup.count}
              tone={showing ? "accent" : "neutral"}
            />
          </Button>
        </Tooltip>
        <ToolButton
          label="Fade unchanged elements"
          pressed={fade}
          icon={<FadeIcon />}
          onClick={() => setFade((value) => !value)}
        />
      </>
    ),
    /** Above a selected element's details: back to every change, previous and next. */
    navigation: (
      <ChangeNavigation
        position={position}
        total={total}
        // Two keys between the same tables differ by their names.
        name={
          current?.label && current.label !== current.name
            ? `${current.name}, ${current.label}`
            : current?.name
        }
        handoff={handoff}
        onBack={backToOverview}
        onStep={step}
      />
    ),
    /** The overview list for the inspector. */
    content,
  };
}
