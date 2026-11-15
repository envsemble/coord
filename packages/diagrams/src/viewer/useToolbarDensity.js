import { useLayoutEffect, useRef, useState } from "react";

const MAX_LEVEL = 3;
const HYSTERESIS = 24;

// Keeps the floating toolbar islands on one row (in a stacked overlay, each on
// its own row). Level 1 turns the view switcher into a select; level 2 also
// collapses search and text labels; level 3 drops the zoom step buttons (wheel,
// pinch, keys and the readout remain). A level is left again only once the
// toolbar is wider than where it last overflowed. `resetKey` starts over at
// level 0, as for another model; a new `contentKey` (other controls, as when a
// family switches between its capture and a proposal) is measured at once,
// keeping the level.
export function useToolbarDensity(topRef, resetKey, contentKey) {
  const [level, setLevel] = useState(0);
  const limits = useRef([]);
  useLayoutEffect(() => {
    limits.current = [];
    setLevel(0);
  }, [resetKey]);
  useLayoutEffect(() => {
    const top = topRef.current;
    if (!top || typeof ResizeObserver !== "function") return;
    const check = () => {
      const width = top.clientWidth;
      const islands = [...top.children].filter((child) =>
        child.classList.contains("coord-island"),
      );
      if (!width || !islands.length) return;
      // A stacked overlay places each island in its own grid cell, so only
      // wrapping within an island shows it is crowded.
      const stacked = top.classList.contains("stacked");
      const row = Math.min(...islands.map((island) => island.offsetTop));
      // An island taller than one row of its controls (whose height follows
      // envUI's control size, larger for touch) has wrapped them.
      const wrapped = (island) => {
        const controls = Math.max(
          0,
          ...[...island.children].map((child) => child.offsetHeight),
        );
        return island.offsetHeight > controls * 1.5 + 12;
      };
      const crowded = islands.some(
        (island) => (!stacked && island.offsetTop > row + 4) || wrapped(island),
      );
      setLevel((current) => {
        if (current > 0 && width > limits.current[current - 1] + HYSTERESIS)
          return current - 1;
        if (crowded && current < MAX_LEVEL) {
          limits.current[current] = width;
          return current + 1;
        }
        return current;
      });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(top);
    for (const child of top.children) observer.observe(child);
    return () => observer.disconnect();
  }, [topRef, level, resetKey, contentKey]);
  return level;
}
