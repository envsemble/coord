import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrangeScene, positionsOf } from "../canvas/arrange.mjs";

// The least distance a dragged element keeps from the diagram's top and
// left edges, the layout's padding, so the scene never shifts under the
// reader's hand.
const EDGE = 28;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A view as the reader arranged it. `arrangement` is the saved one (each
 * element's top-left corner by id, or null for the automatic layout); an
 * element without a saved place, such as one added since, goes beside the
 * elements it relates to. With `onArrange`, elements can be dragged: the
 * relations follow while one moves, and when it is let go the whole
 * arrangement as shown is saved, so what the reader saw stays as they saw it.
 * `reset` returns to the automatic layout.
 */
export function useArrangement(base, arrangement, onArrange) {
  const [positions, setPositions] = useState(arrangement ?? null);
  // A saved arrangement read again (after this one saved it, or another
  // window or a person changed the file) replaces what is shown.
  const lastSaved = useRef(arrangement ?? null);
  useEffect(() => {
    if (same(lastSaved.current, arrangement ?? null)) return;
    lastSaved.current = arrangement ?? null;
    setPositions(arrangement ?? null);
  }, [arrangement]);
  const scene = useMemo(
    () => (positions ? arrangeScene(base, positions, { place: true }) : base),
    [base, positions],
  );
  const [drag, setDrag] = useState(null);
  const shown = useMemo(
    () => (drag?.at ? arrangeScene(scene, { [drag.id]: drag.at }) : scene),
    [scene, drag],
  );
  const latest = useRef({ scene, shown, drag, positions });
  latest.current = { scene, shown, drag, positions };
  const save = useCallback(
    (next) => {
      lastSaved.current = next;
      setPositions(next);
      onArrange?.(next);
    },
    [onArrange],
  );
  const elementDrag = useMemo(
    () =>
      onArrange
        ? {
            start(target, point) {
              const id = target?.closest?.("[data-node-id]")?.dataset.nodeId;
              const node = latest.current.scene.nodes.find((n) => n.id === id);
              if (!node) return false;
              setDrag({
                id,
                grab: [point.x - node.x, point.y - node.y],
                at: null,
              });
              return true;
            },
            move(point) {
              setDrag(
                (current) =>
                  current && {
                    ...current,
                    at: [
                      Math.max(EDGE, point.x - current.grab[0]),
                      Math.max(EDGE, point.y - current.grab[1]),
                    ],
                  },
              );
            },
            end(moved) {
              const { shown, drag, positions } = latest.current;
              setDrag(null);
              // The places of elements other layers or views show are kept.
              if (moved && drag?.at)
                save({ ...(positions || {}), ...positionsOf(shown) });
            },
          }
        : null,
    [onArrange, save],
  );
  const reset = useCallback(() => save(null), [save]);
  return {
    diagram: shown,
    elementDrag,
    arranged: !!positions,
    moving: drag?.id ?? null,
    reset,
  };
}
