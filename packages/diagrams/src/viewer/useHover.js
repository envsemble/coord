import { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { sameTarget } from "../canvas/interaction";

/**
 * The element under the pointer, highlighted with its relations at once: a
 * sparse overlay is cheap to commit, so pointer feedback does not wait in
 * React's background update queue.
 */
export function useHover() {
  const [hovered, setHovered] = useState(null);
  const hover = useCallback((target) => {
    flushSync(() =>
      setHovered((old) => (sameTarget(old, target) ? old : target)),
    );
  }, []);
  const clearHover = useCallback(() => setHovered(null), []);
  return { hovered, hover, clearHover };
}
