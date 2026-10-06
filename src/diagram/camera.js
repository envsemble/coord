const PINCH_WHEEL_SENSITIVITY = 0.0015;
const PINCH_GESTURE_SENSITIVITY = 0.15;
const PINCH_EASING_MS = 80;
const clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));

// The SVG camera updates outside React's render cycle. Only its rounded zoom
// readout becomes React state; every animation frame can stay inexpensive.
export function createCamera({ canvasRef, worldRef, onZoom, onTap, onMotion }) {
  let camera = { x: 0, y: 0, scale: 1, fitted: true };
  let activeKey = null;
  let pinchZoom = null;
  let pinchFrame = null;
  let drag = null;
  let moved = false;
  let initialFocus = [];
  const cameras = new Map();
  const pointers = new Map();

  function cancelPinchZoom() {
    if (pinchFrame !== null) cancelAnimationFrame(pinchFrame);
    pinchFrame = null;
    pinchZoom = null;
  }

  function paint() {
    worldRef.current.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    canvasRef.current.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
    onZoom(Math.round(camera.scale * 100));
  }

  function fit() {
    cancelPinchZoom();
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const scale = Math.min((w - 48) / b.width, (h - 48) / b.height, 1.2);
    camera = {
      x: (w - b.width * scale) / 2,
      y: (h - b.height * scale) / 2,
      scale,
      fitted: true,
    };
    paint();
  }

  function initialCamera() {
    fit();
    if (camera.scale >= 0.7 || !initialFocus.length) return;
    const anchors = initialFocus.map((id) => {
      const node = worldRef.current.querySelector(
        `.node[data-node-id="${id}"]`,
      );
      const m = node.transform.baseVal.consolidate().matrix;
      const r = node.querySelector("rect");
      return {
        x: m.e,
        y: m.f,
        w: Number(r.getAttribute("width")),
        h: Number(r.getAttribute("height")),
      };
    });
    const x =
      (Math.min(...anchors.map((n) => n.x)) +
        Math.max(...anchors.map((n) => n.x + n.w))) /
      2;
    const y =
      (Math.min(...anchors.map((n) => n.y)) +
        Math.max(...anchors.map((n) => n.y + n.h))) /
      2;
    camera = {
      scale: 0.7,
      x: canvasRef.current.clientWidth / 2 - x * 0.7,
      y: canvasRef.current.clientHeight / 2 - y * 0.7,
      fitted: false,
    };
    paint();
  }

  function applyZoom(scale, x, y) {
    scale = clampScale(scale);
    const ratio = scale / camera.scale;
    camera.x = x - (x - camera.x) * ratio;
    camera.y = y - (y - camera.y) * ratio;
    camera.scale = scale;
    camera.fitted = false;
    paint();
  }

  function zoomTo(
    scale,
    x = canvasRef.current.clientWidth / 2,
    y = canvasRef.current.clientHeight / 2,
  ) {
    cancelPinchZoom();
    applyZoom(scale, x, y);
  }

  function animatePinchZoom(time) {
    const zoom = pinchZoom;
    const elapsed = Math.max(0, Math.min(time - zoom.time, 64));
    const gap = Math.log(zoom.scale / camera.scale);
    const finished = Math.abs(gap) < 0.0001;
    zoom.time = time;
    // Log-space easing treats zooming in and out symmetrically.
    applyZoom(
      finished
        ? zoom.scale
        : camera.scale *
            Math.exp(gap * (1 - Math.exp(-elapsed / PINCH_EASING_MS))),
      zoom.x,
      zoom.y,
    );
    if (finished) {
      pinchZoom = null;
      pinchFrame = null;
    } else pinchFrame = requestAnimationFrame(animatePinchZoom);
  }

  function pinchZoomBy(delta, x, y) {
    if (!pinchZoom)
      pinchZoom = { scale: camera.scale, x, y, time: performance.now() };
    // Accumulate against the target so frequent touchpad events are retained.
    pinchZoom.scale = clampScale(pinchZoom.scale * Math.exp(delta));
    pinchZoom.x = x;
    pinchZoom.y = y;
    camera.fitted = false;
    if (pinchFrame === null)
      pinchFrame = requestAnimationFrame(animatePinchZoom);
  }

  function pan(dx, dy) {
    cancelPinchZoom();
    camera.x += dx;
    camera.y += dy;
    camera.fitted = false;
    paint();
  }

  function clearPointers(canvas = canvasRef.current) {
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging");
  }

  function restoreView(key, fields, focusIds = []) {
    cancelPinchZoom();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = `${key}:${fields}`;
    if (cameras.has(activeKey)) {
      camera = { ...cameras.get(activeKey) };
      paint();
    } else initialCamera();
  }

  function focusNode(id, rightInset = 0) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    cancelPinchZoom();
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const canvas = canvasRef.current;
    const freeWidth = Math.max(1, canvas.clientWidth - rightInset);
    camera.scale = Math.max(camera.scale, 0.85);
    camera.x =
      freeWidth / 2 -
      (m.e + Number(r.getAttribute("width")) / 2) * camera.scale;
    camera.y =
      canvas.clientHeight / 2 -
      (m.f + Number(r.getAttribute("height")) / 2) * camera.scale;
    camera.fitted = false;
    paint();
  }

  function gesture() {
    const p = [...pointers.values()];
    if (p.length < 2) return null;
    return {
      x: (p[0].x + p[1].x) / 2,
      y: (p[0].y + p[1].y) / 2,
      d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y),
    };
  }

  function attach() {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    const cleanup = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const position = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    listen(
      canvas,
      "wheel",
      (e) => {
        e.preventDefault();
        onMotion?.();
        const unit =
          e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
        const p = position(e);
        if (e.ctrlKey || e.metaKey)
          pinchZoomBy(-e.deltaY * unit * PINCH_WHEEL_SENSITIVITY, p.x, p.y);
        else pan(-e.deltaX * unit, -e.deltaY * unit);
      },
      { passive: false },
    );
    listen(canvas, "pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelPinchZoom();
      moved = false;
      const p = position(e);
      pointers.set(e.pointerId, p);
      canvas.setPointerCapture(e.pointerId);
      drag = {
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        target: e.target,
        gesture: gesture(),
      };
      canvas.classList.add("dragging");
    });
    listen(canvas, "pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !drag) return;
      const p = position(e);
      pointers.set(e.pointerId, p);
      const g = gesture();
      if (g && drag.gesture) {
        const old = drag.gesture;
        pan(g.x - old.x, g.y - old.y);
        if (old.d > 0) zoomTo((camera.scale * g.d) / old.d, g.x, g.y);
        drag.moved = true;
        if (!moved) onMotion?.();
        moved = true;
        drag.gesture = g;
      } else if (g) drag.gesture = g;
      else {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) moved = true;
        if (drag.moved) pan(p.x - drag.lastX, p.y - drag.lastY);
        drag.lastX = p.x;
        drag.lastY = p.y;
      }
    });
    function pointerEnd(e) {
      if (!pointers.has(e.pointerId)) return;
      if (e.type === "pointercancel") moved = true;
      pointers.delete(e.pointerId);
      if (!pointers.size) {
        if (e.type === "pointerup" && drag && !drag.moved && drag.target)
          onTap?.(drag.target);
        drag = null;
        canvas.classList.remove("dragging");
      } else {
        const p = [...pointers.values()][0];
        drag = {
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          moved: true,
          gesture: gesture(),
        };
      }
    }
    listen(canvas, "pointerup", pointerEnd);
    listen(canvas, "pointercancel", pointerEnd);
    listen(document, "keydown", (e) => {
      if (e.target.matches("input,textarea,[contenteditable='true']")) return;
      if (e.key === "+" || e.key === "=") {
        zoomTo(camera.scale * 1.25);
        e.preventDefault();
      }
      if (e.key === "-") {
        zoomTo(camera.scale / 1.25);
        e.preventDefault();
      }
      if (e.key === "0") {
        fit();
        e.preventDefault();
      }
    });
    let safariScale = 1;
    listen(
      canvas,
      "gesturestart",
      (e) => {
        e.preventDefault();
        onMotion?.();
        cancelPinchZoom();
        safariScale = 1;
      },
      { passive: false },
    );
    listen(
      canvas,
      "gesturechange",
      (e) => {
        e.preventDefault();
        if (!(e.scale > 0)) return;
        onMotion?.();
        const p = position(e);
        pinchZoomBy(
          Math.log(e.scale / safariScale) * PINCH_GESTURE_SENSITIVITY,
          p.x,
          p.y,
        );
        safariScale = e.scale;
      },
      { passive: false },
    );
    listen(canvas, "gestureend", (e) => e.preventDefault(), { passive: false });
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === width && h === height) return;
      if (camera.fitted) fit();
      else pan((w - width) / 2, (h - height) / 2);
      width = w;
      height = h;
    });
    observer.observe(canvas);
    return () => {
      cleanup.forEach((remove) => remove());
      observer.disconnect();
      cancelPinchZoom();
      clearPointers(canvas);
    };
  }

  return {
    attach,
    restoreView,
    focusNode,
    hasDragged: () => moved,
    fit,
    reset: () => zoomTo(1),
    zoomBy: (factor) => zoomTo(camera.scale * factor),
  };
}
