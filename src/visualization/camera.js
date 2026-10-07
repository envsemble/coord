const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const PINCH_GESTURE_SENSITIVITY = 0.15;
const PAN_EASING_MS = 50;
const DRAG_EASING_MS = 28;
const ZOOM_EASING_MS = 90;
const clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));

// The SVG camera updates outside React's render cycle. Only its rounded zoom
// readout becomes React state; every animation frame can stay inexpensive.
export function createCamera({ canvasRef, worldRef, onZoom, onTap, onMotion }) {
  let camera = { x: 0, y: 0, scale: 1, fitted: true };
  let destination = { ...camera };
  let activeKey = null;
  let motionFrame = null;
  let motionTime = 0;
  let easing = PAN_EASING_MS;
  let reducedMotion = false;
  let grid = null;
  let zoomReadout = null;
  let drag = null;
  let moved = false;
  let initialFocus = [];
  const cameras = new Map();
  const pointers = new Map();

  function cancelMotion() {
    if (motionFrame !== null) cancelAnimationFrame(motionFrame);
    motionFrame = null;
    destination = { ...camera };
  }

  function paint() {
    worldRef.current.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    if (grid)
      grid.style.transform = `translate3d(${camera.x % 20}px,${camera.y % 20}px,0)`;
    const value = Math.round(camera.scale * 100);
    if (value !== zoomReadout) {
      zoomReadout = value;
      onZoom(value);
    }
  }

  function snapTo(next) {
    cancelMotion();
    camera = { ...next };
    destination = { ...next };
    paint();
  }

  function animateMotion(time) {
    const elapsed = Math.max(0, Math.min(time - motionTime, 64));
    motionTime = time;
    const scaleGap = Math.log(destination.scale / camera.scale);
    const dx = destination.x - camera.x;
    const dy = destination.y - camera.y;
    if (
      Math.max(Math.abs(dx), Math.abs(dy)) < 0.05 &&
      Math.abs(scaleGap) < 0.0001
    ) {
      motionFrame = null;
      camera = { ...destination };
      paint();
      return;
    }
    const amount = 1 - Math.exp(-elapsed / easing);
    const scale = camera.scale * Math.exp(scaleGap * amount);
    // Interpolate translation by the same scale ratio. A pure zoom then keeps
    // the point under its cursor fixed throughout the entire animation.
    const progress =
      Math.abs(destination.scale - camera.scale) > 1e-10
        ? (scale - camera.scale) / (destination.scale - camera.scale)
        : amount;
    camera = {
      x: camera.x + dx * progress,
      y: camera.y + dy * progress,
      scale,
      fitted: false,
    };
    paint();
    motionFrame = requestAnimationFrame(animateMotion);
  }

  function moveTo(next, duration) {
    if (reducedMotion) {
      snapTo(next);
      return;
    }
    destination = { ...next };
    easing = duration;
    camera.fitted = false;
    if (motionFrame === null) {
      motionTime = performance.now();
      motionFrame = requestAnimationFrame(animateMotion);
    }
  }

  function fit(animate = true) {
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const scale = Math.min(
      Math.max(1, w - 48) / b.width,
      Math.max(1, h - 48) / b.height,
      1.2,
    );
    const next = {
      x: (w - b.width * scale) / 2,
      y: (h - b.height * scale) / 2,
      scale,
      fitted: true,
    };
    if (animate) moveTo(next, ZOOM_EASING_MS);
    else snapTo(next);
  }

  function initialCamera() {
    fit(false);
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
    snapTo({
      scale: 0.7,
      x: canvasRef.current.clientWidth / 2 - x * 0.7,
      y: canvasRef.current.clientHeight / 2 - y * 0.7,
      fitted: false,
    });
  }

  function zoomTo(
    scale,
    x = canvasRef.current.clientWidth / 2,
    y = canvasRef.current.clientHeight / 2,
    duration = ZOOM_EASING_MS,
  ) {
    scale = clampScale(scale);
    const ratio = scale / destination.scale;
    moveTo(
      {
        x: x - (x - destination.x) * ratio,
        y: y - (y - destination.y) * ratio,
        scale,
        fitted: false,
      },
      duration,
    );
  }

  function pinchZoomBy(delta, x, y) {
    // Accumulate against the target so frequent touchpad events are retained.
    zoomTo(destination.scale * Math.exp(delta), x, y);
  }

  function pan(dx, dy, duration = PAN_EASING_MS) {
    const next = {
      ...destination,
      x: destination.x + dx,
      y: destination.y + dy,
      fitted: false,
    };
    if (duration) moveTo(next, duration);
    else snapTo(next);
  }

  function clearPointers(canvas = canvasRef.current) {
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging");
  }

  function restoreView(key, fields, focusIds = []) {
    cancelMotion();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = `${key}:${fields}`;
    if (cameras.has(activeKey)) {
      snapTo(cameras.get(activeKey));
    } else initialCamera();
  }

  function focusNode(id, rightInset = 0) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    cancelMotion();
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const canvas = canvasRef.current;
    const freeWidth = Math.max(1, canvas.clientWidth - rightInset);
    const scale = Math.max(camera.scale, 0.85);
    moveTo(
      {
        scale,
        x: freeWidth / 2 - (m.e + Number(r.getAttribute("width")) / 2) * scale,
        y:
          canvas.clientHeight / 2 -
          (m.f + Number(r.getAttribute("height")) / 2) * scale,
        fitted: false,
      },
      ZOOM_EASING_MS,
    );
  }

  function revealNode(id) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const canvas = canvasRef.current;
    const left = destination.x + m.e * destination.scale;
    const top = destination.y + m.f * destination.scale;
    const width = Number(r.getAttribute("width")) * destination.scale;
    const height = Number(r.getAttribute("height")) * destination.scale;
    const shift = (start, size, available) =>
      size > available - 48
        ? (available - size) / 2 - start
        : start < 24
          ? 24 - start
          : start + size > available - 24
            ? available - 24 - start - size
            : 0;
    const dx = shift(left, width, canvas.clientWidth);
    const dy = shift(top, height, canvas.clientHeight);
    if (dx || dy) {
      // Keep an in-progress focus/zoom transition; reveal checks its final pose
      // so selecting a search result cannot cancel the animation that finds it.
      pan(dx, dy, motionFrame === null ? 0 : easing);
    }
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
    grid = canvas.querySelector(".canvas-grid");
    const cleanup = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const position = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const motionPreference =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    reducedMotion = motionPreference?.matches || false;
    if (motionPreference)
      listen(motionPreference, "change", (e) => {
        reducedMotion = e.matches;
        if (reducedMotion) snapTo(destination);
      });
    paint();
    listen(
      canvas,
      "wheel",
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        onMotion?.();
        const unit =
          e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
        const p = position(e);
        pinchZoomBy(-e.deltaY * unit * WHEEL_ZOOM_SENSITIVITY, p.x, p.y);
      },
      { passive: false },
    );
    listen(canvas, "pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelMotion();
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
        pan(g.x - old.x, g.y - old.y, DRAG_EASING_MS);
        if (old.d > 0)
          zoomTo((destination.scale * g.d) / old.d, g.x, g.y, DRAG_EASING_MS);
        drag.moved = true;
        if (!moved) onMotion?.();
        moved = true;
        drag.gesture = g;
      } else if (g) drag.gesture = g;
      else {
        const wasMoved = drag.moved;
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) moved = true;
        if (drag.moved)
          pan(
            p.x - (wasMoved ? drag.lastX : drag.startX),
            p.y - (wasMoved ? drag.lastY : drag.startY),
            DRAG_EASING_MS,
          );
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
        zoomTo(destination.scale * 1.25);
        e.preventDefault();
      }
      if (e.key === "-") {
        zoomTo(destination.scale / 1.25);
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
        cancelMotion();
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
      // A sidebar changes the width without moving the canvas origin. Keep
      // entities under the cursor instead of shifting them during inspection.
      if (w !== width && h === height) {
        camera.fitted = false;
        destination.fitted = false;
        paint();
      } else if (destination.fitted) fit(false);
      else {
        cancelMotion();
        pan((w - width) / 2, (h - height) / 2, 0);
      }
      width = w;
      height = h;
    });
    observer.observe(canvas);
    return () => {
      cleanup.forEach((remove) => remove());
      observer.disconnect();
      cancelMotion();
      clearPointers(canvas);
      grid = null;
    };
  }

  return {
    attach,
    restoreView,
    focusNode,
    revealNode,
    hasDragged: () => moved,
    fit,
    reset: () => zoomTo(1),
    zoomBy: (factor) => zoomTo(destination.scale * factor),
  };
}
