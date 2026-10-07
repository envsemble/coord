import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { sameTarget } from "../visualization/interaction";
import { createInspectionController } from "./inspection";

export const inspectedTarget = (hovered, selected) => hovered || selected;

export function useInspection({
  previewEnabled = true,
  previewVisible = false,
} = {}) {
  const [hovered, setHovered] = useState(null);
  const [preview, setPreview] = useState(null);
  const controller = useMemo(
    () =>
      createInspectionController({
        onHover: (target) =>
          setHovered((old) => (sameTarget(old, target) ? old : target)),
        // An open inspector follows the same input commit as its highlight.
        // Memoized details/code avoid rebuilding unchanged source content.
        onPreview: (target) =>
          setPreview((old) => (sameTarget(old, target) ? old : target)),
      }),
    [createInspectionController],
  );
  useLayoutEffect(() => {
    controller.configure({ previewEnabled, previewVisible });
  }, [controller, previewEnabled, previewVisible]);
  useEffect(() => () => controller.dispose(), [controller]);
  const hover = useCallback(
    (target) => {
      // A sparse overlay is cheap to commit. Do not leave pointer feedback in
      // React's background update queue.
      flushSync(() => controller.hover(target));
    },
    [controller],
  );
  return {
    hovered,
    preview,
    hover,
    keepHover: controller.keepHover,
    clearHover: controller.clearHover,
  };
}
