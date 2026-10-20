import { sameTarget } from "../canvas/interaction";

// Highlight immediately. Only opening hover-only details waits briefly, so
// they cannot cover a target before a click. Details already open have no delay.
export function createInspectionController({
  onHover,
  onPreview,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let hovered = null;
  let preview = null;
  let timer = null;
  let enabled = true;
  let visible = false;
  const cancelPreview = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const setHover = (target) => {
    if (sameTarget(hovered, target)) return;
    hovered = target;
    onHover(target);
  };
  const setPreview = (target) => {
    if (sameTarget(preview, target)) return;
    preview = target;
    onPreview(target);
  };
  const controller = {
    configure({ previewEnabled, previewVisible }) {
      enabled = previewEnabled;
      visible = previewVisible;
      if (!enabled) {
        cancelPreview();
        setPreview(null);
      } else if (visible && hovered) {
        cancelPreview();
        setPreview(hovered);
      }
    },
    hover(target) {
      cancelPreview();
      setHover(target);
      if (!enabled) return;
      if (target) {
        if (visible || preview) setPreview(target);
        else
          timer = schedule(() => {
            timer = null;
            if (sameTarget(hovered, target)) setPreview(target);
          }, 100);
      } else if (preview) {
        // Bridge the small pointer gap between the SVG and the details.
        timer = schedule(() => {
          timer = null;
          setPreview(null);
        }, 160);
      }
    },
    keepHover() {
      cancelPreview();
      if (preview) setHover(preview);
    },
    clearHover() {
      cancelPreview();
      setHover(null);
      setPreview(null);
    },
    dispose: cancelPreview,
  };
  return controller;
}
