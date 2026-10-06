import { useCallback, useEffect, useRef, useState } from "react";
import { sameTarget } from "../visualization/interaction";

export const inspectedTarget = (hovered, selected) => hovered || selected;

export function useInspection() {
  const [hovered, setHovered] = useState(null);
  const hoverTimer = useRef(null);
  const keepHover = useCallback(() => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  const clearHover = useCallback(() => {
    keepHover();
    setHovered(null);
  }, [keepHover]);
  const hover = useCallback(
    (target) => {
      keepHover();
      // Let a click complete before a hover-only sidebar can cover its target.
      if (target)
        hoverTimer.current = setTimeout(
          () => setHovered((old) => (sameTarget(old, target) ? old : target)),
          120,
        );
      else hoverTimer.current = setTimeout(clearHover, 200);
    },
    [keepHover, clearHover],
  );
  useEffect(() => keepHover, [keepHover]);
  return { hovered, hover, keepHover, clearHover };
}
