import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrangeScene, positionsOf } from "../canvas/arrange.mjs";

// The least distance a dragged element keeps from the diagram's top and
// left edges, the layout's padding, so the scene never shifts under the
// reader's hand; an element of a package keeps its package's region inside
// it too (its margin, and its name above).
const EDGE = 28;
const PACKAGE_MARGIN = 16;
const PACKAGE_HEADER = 22;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Positions as a host keeps them, to a tenth, so what it reads back is what
// was saved.
const tenth = (n) => Math.round(n * 10) / 10;
const rounded = (positions) =>
  Object.fromEntries(
    Object.entries(positions).map(([id, [x, y]]) => [id, [tenth(x), tenth(y)]]),
  );

/**
 * A view as the reader arranged it. `arrangement` is the saved one (each
 * element's top-left corner by id, or null for the automatic layout); an
 * element without a saved place, such as one added since, goes beside the
 * elements it relates to. With `onArrange`, elements can be dragged: the
 * relations follow while one moves, and when it is let go the whole
 * arrangement as shown is saved (with the places of elements other layers or
 * views show), so what the reader saw stays as they saw it. `reset` returns
 * to the automatic layout.
 */
export function useArrangement(base, arrangement, onArrange) {
  const [positions, setPositions] = useState(arrangement ?? null);
  // A saved arrangement read again that differs from the one saved last
  // (another window or a person changed the file) replaces what is shown.
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
  // The drag in progress, kept in a ref too: a release can come before the
  // last move has been drawn.
  const dragging = useRef(null);
  const [drag, setDrag] = useState(null);
  const shown = useMemo(
    () => (drag?.at ? arrangeScene(scene, { [drag.id]: drag.at }) : scene),
    [scene, drag],
  );
  const latest = useRef({ scene, positions });
  latest.current = { scene, positions };
  const save = useCallback(
    (next) => {
      const value = next && rounded(next);
      lastSaved.current = value;
      setPositions(value);
      onArrange?.(value);
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
              const packaged = (latest.current.scene.packages || []).some((p) =>
                p.members?.includes(id),
              );
              dragging.current = {
                id,
                grab: [point.x - node.x, point.y - node.y],
                least: packaged
                  ? [
                      EDGE + PACKAGE_MARGIN,
                      EDGE + PACKAGE_MARGIN + PACKAGE_HEADER,
                    ]
                  : [EDGE, EDGE],
                at: null,
              };
              setDrag(dragging.current);
              return true;
            },
            move(point) {
              const current = dragging.current;
              if (!current) return;
              dragging.current = {
                ...current,
                at: [
                  Math.max(current.least[0], point.x - current.grab[0]),
                  Math.max(current.least[1], point.y - current.grab[1]),
                ],
              };
              setDrag(dragging.current);
            },
            end(moved) {
              const current = dragging.current;
              dragging.current = null;
              setDrag(null);
              if (!moved || !current?.at) return;
              const { scene, positions } = latest.current;
              const placed = arrangeScene(scene, { [current.id]: current.at });
              save({ ...(positions || {}), ...positionsOf(placed) });
            },
          }
        : null,
    [onArrange, save],
  );
  const reset = useCallback(() => save(null), [save]);
  return { diagram: shown, elementDrag, arranged: !!positions, reset };
}
