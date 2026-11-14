import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Tooltip } from "@envsemble/envui";
import { ToolButton } from "../ui/ToolButton";
import { FadeIcon, ProposalIcon } from "../ui/icons";
import { ChangeNavigation, ChangesOverview } from "./ChangesOverview";
import { cachedRollup, rowFor } from "./changes";

// The Changes panel opens with a proposal when the window leaves the diagram
// room beside it; in smaller windows the Changes button opens it.
const ROOMY_WIDTH = 1280;
/** Whether a proposal opens with its Changes panel showing. */
export const overviewByDefault = () =>
  typeof window !== "undefined" && window.innerWidth >= ROOMY_WIDTH;

/**
 * Reviewing a proposal: the rolled-up changes, fading unchanged elements, and
 * stepping through changes. `review` is `{ comparison, baselineDate }`, or
 * null outside a proposal; `model` and `views` are the change view's. A
 * change chosen in the overview, or stepped to, is selected and framed on the
 * canvas.
 */
export function useChangeReview({
  review,
  model,
  views,
  selected,
  choose,
  hover,
}) {
  // The rollup is shared with the Changes button's count, computed once per
  // comparison.
  const rollup = useMemo(
    () => (review ? cachedRollup(review.comparison, model, views) : null),
    [review, model, views],
  );
  const [fade, setFade] = useState(true);
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
          onSelect={open}
          onHover={hover}
        />
      ) : null,
    [rollup, baselineDate, profile, activeKey, open, hover],
  );
  if (!rollup) return null;
  return {
    rollup,
    fade,
    position,
    total,
    /** Toolbar controls: the Changes panel's toggle and fading. */
    controls: (showing, onToggle) => (
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
            onClick={onToggle}
          >
            <span className="collapsible-label">Changes</span>
            <Badge count={rollup.count} />
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
    /** In the Changes panel's header: the previous and next change. */
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
        onStep={step}
      />
    ),
    /** The overview list for the Changes panel. */
    content,
  };
}
