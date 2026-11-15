const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const PINCH_GESTURE_SENSITIVITY = 0.15;
const PAN_EASING_MS = 50;
const DRAG_EASING_MS = 28;
const ZOOM_EASING_MS = 90;
const clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));
// Small diagrams may be enlarged to fill the canvas, but not beyond this zoom.
const MAX_FIT_SCALE = 1.5;
const FIT_PADDING = 24;
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
// How far the grid layer extends past the canvas on each side (its stylesheet
// inset), and how many raster sizes it has per doubling of the zoom.
const GRID_OVERHANG = 64;
const GRID_LEVELS = 8;

// The SVG camera updates outside React's render cycle. Only its rounded zoom
// readout becomes React state; every animation frame can stay inexpensive.
// `insets` reports canvas edges covered by floating UI (toolbars, inspector).
// Fit and reveal keep the diagram inside the remaining visible area.
export function createCamera({
  canvasRef,
  worldRef,
  onZoom,
  onTap,
  onMotion,
  insets = () => NO_INSETS,
  // A press on an element drags it, when this says it may: `start(target,
  // point)` returns whether it takes the press; `move(point)` follows the
  // pointer and `end(moved)` lets go. Points are in diagram coordinates.
  elementDrag = null,
}) {
  let camera = { x: 0, y: 0, scale: 1, fitted: true };
  let destination = { ...camera };
  let activeKey = null;
  let motionFrame = null;
  let motionTime = 0;
  let easing = PAN_EASING_MS;
  let reducedMotion = false;
  let grid = null;
  let gridLevel = null;
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
    if (grid) {
      // The dot pattern is rasterized at a zoom rounded down to one of eight
      // levels per doubling, and the grid layer is scaled the rest of the way
      // (by under 9%). Zooming within a level then only transforms the layer
      // instead of repainting its background every frame.
      const level =
        2 ** (Math.floor(Math.log2(camera.scale) * GRID_LEVELS) / GRID_LEVELS);
      // Thin out world-grid points at distant zoom levels. The retained points
      // stay anchored to world coordinates rather than sliding during a zoom.
      const step = 20 * 2 ** Math.ceil(Math.log2(16 / (20 * level)));
      const raster = step * level;
      const spacing = step * camera.scale;
      const phase = (n) => ((n % spacing) + spacing) % spacing;
      // Blend neighboring densities so crossing a zoom threshold does not
      // suddenly replace the dot pattern. Both layers share the same origin,
      // which is also the layer's transform origin.
      if (gridLevel !== level) {
        gridLevel = level;
        const fine = Math.max(0, Math.min(1, raster / 16 - 1));
        grid.style.backgroundImage = [fine, 1 - fine]
          .map(
            (opacity) =>
              `radial-gradient(color-mix(in srgb,var(--grid) ${opacity * 100}%,transparent) 0.7px,transparent 0.7px)`,
          )
          .join(",");
        grid.style.backgroundSize = `${raster / 2}px ${raster / 2}px,${raster}px ${raster}px`;
        grid.style.backgroundPosition = `${GRID_OVERHANG - raster / 4}px ${GRID_OVERHANG - raster / 4}px,${GRID_OVERHANG - raster / 2}px ${GRID_OVERHANG - raster / 2}px`;
      }
      grid.style.transform = `translate3d(${phase(camera.x)}px,${phase(camera.y)}px,0) scale(${camera.scale / level})`;
    }
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

  function readInsets() {
    return { ...NO_INSETS, ...(insets(canvasRef.current) || {}) };
  }

  // `fullWidth` ignores the right inset; reveal handles floating panels as
  // obstacles so a node is moved only when a panel actually covers it.
  function visibleArea(i = readInsets(), { fullWidth = false } = {}) {
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const rightInset = fullWidth ? 0 : i.right;
    // Ignore insets that would leave too little room to show anything.
    const left = i.left + rightInset < w * 0.6 ? i.left : 0;
    const right = i.left + rightInset < w * 0.6 ? rightInset : 0;
    const top = i.top + i.bottom < h * 0.6 ? i.top : 0;
    const bottom = i.top + i.bottom < h * 0.6 ? i.bottom : 0;
    return {
      x: left,
      y: top,
      width: Math.max(1, w - left - right),
      height: Math.max(1, h - top - bottom),
    };
  }

  function fit(animate = true) {
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const area = visibleArea();
    const scale = Math.min(
      Math.max(1, area.width - 2 * FIT_PADDING) / b.width,
      Math.max(1, area.height - 2 * FIT_PADDING) / b.height,
      MAX_FIT_SCALE,
    );
    const next = {
      x: area.x + (area.width - b.width * scale) / 2,
      y: area.y + (area.height - b.height * scale) / 2,
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
    const area = visibleArea();
    // Zoom out from 0.7 only as far as the focused nodes need to fit together,
    // and not below 0.5, where names stay readable: a larger focus is centred.
    const width =
      Math.max(...anchors.map((n) => n.x + n.w)) -
      Math.min(...anchors.map((n) => n.x));
    const height =
      Math.max(...anchors.map((n) => n.y + n.h)) -
      Math.min(...anchors.map((n) => n.y));
    const scale = Math.max(
      camera.scale,
      0.5,
      Math.min(
        0.7,
        (area.width - 2 * FIT_PADDING) / Math.max(1, width),
        (area.height - 2 * FIT_PADDING) / Math.max(1, height),
      ),
    );
    snapTo({
      scale,
      x: area.x + area.width / 2 - x * scale,
      y: area.y + area.height / 2 - y * scale,
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
    if (drag?.element) {
      drag.element = false;
      elementDrag?.end(false);
    }
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging", "moving");
  }

  function restoreView(key, focusIds = []) {
    cancelMotion();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = key;
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
    const area = visibleArea();
    const freeWidth = Math.max(1, area.width - rightInset);
    const scale = Math.max(camera.scale, 0.85);
    moveTo(
      {
        scale,
        x:
          area.x +
          freeWidth / 2 -
          (m.e + Number(r.getAttribute("width")) / 2) * scale,
        y:
          area.y +
          area.height / 2 -
          (m.f + Number(r.getAttribute("height")) / 2) * scale,
        fitted: false,
      },
      ZOOM_EASING_MS,
    );
  }

  // Centres several nodes together, such as the two ends of a relation,
  // zooming out only as far as they need to fit beside each other.
  function focusNodes(ids, rightInset = 0) {
    const boxes = ids
      .map((id) =>
        worldRef.current.querySelector(`.node[data-node-id="${id}"]`),
      )
      .filter(Boolean)
      .map((node) => {
        const m = node.transform.baseVal.consolidate().matrix;
        const r = node.querySelector("rect");
        return {
          x: m.e,
          y: m.f,
          right: m.e + Number(r.getAttribute("width")),
          bottom: m.f + Number(r.getAttribute("height")),
        };
      });
    if (!boxes.length) return;
    cancelMotion();
    const left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y)),
      right = Math.max(...boxes.map((b) => b.right)),
      bottom = Math.max(...boxes.map((b) => b.bottom));
    const area = visibleArea();
    const freeWidth = Math.max(1, area.width - rightInset);
    const fits = Math.min(
      (freeWidth - 2 * FIT_PADDING) / Math.max(1, right - left),
      (area.height - 2 * FIT_PADDING) / Math.max(1, bottom - top),
    );
    const scale = clampScale(
      Math.min(Math.max(camera.scale, 0.85), Math.max(0.3, fits)),
    );
    moveTo(
      {
        scale,
        x: area.x + freeWidth / 2 - ((left + right) / 2) * scale,
        y: area.y + area.height / 2 - ((top + bottom) / 2) * scale,
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
    const left = destination.x + m.e * destination.scale;
    const top = destination.y + m.f * destination.scale;
    const width = Number(r.getAttribute("width")) * destination.scale;
    const height = Number(r.getAttribute("height")) * destination.scale;
    const i = readInsets();
    const area = visibleArea(i, { fullWidth: true });
    const shift = (start, size, origin, available) =>
      size > available - 48
        ? origin + (available - size) / 2 - start
        : start < origin + 24
          ? origin + 24 - start
          : start + size > origin + available - 24
            ? origin + available - 24 - start - size
            : 0;
    let dx = shift(left, width, area.x, area.width);
    const dy = shift(top, height, area.y, area.height);
    for (const o of i.obstacles || []) {
      const x = left + dx,
        y = top + dy;
      if (
        x >= o.right ||
        x + width <= o.left ||
        y >= o.bottom ||
        y + height <= o.top
      )
        continue;
      const room = o.left - area.x;
      if (room >= width + 48) dx = o.left - 24 - width - left;
      else if (room > 0) dx = area.x + (room - width) / 2 - left;
    }
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
    gridLevel = null;
    // The layer scales about the canvas's origin, where its dots are anchored.
    if (grid)
      grid.style.transformOrigin = `${GRID_OVERHANG}px ${GRID_OVERHANG}px`;
    const cleanup = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const position = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    // A canvas point in the diagram's own coordinates, as the camera shows it.
    const inDiagram = (p) => ({
      x: (p.x - camera.x) / camera.scale,
      y: (p.y - camera.y) / camera.scale,
    });
    const letGo = (moved) => {
      if (!drag?.element) return;
      drag.element = false;
      elementDrag?.end(moved);
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
      // A second finger turns an element's drag into a pinch.
      if (pointers.size > 1) letGo(false);
      drag = {
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        target: e.target,
        gesture: gesture(),
        element:
          pointers.size === 1 && !!elementDrag?.start(e.target, inDiagram(p)),
      };
      canvas.classList.add(drag.element ? "moving" : "dragging");
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
      else if (drag.element) {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) {
          moved = true;
          elementDrag.move(inDiagram(p));
        }
      } else {
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
        letGo(e.type === "pointerup" && !!drag?.moved);
        if (e.type === "pointerup" && drag && !drag.moved && drag.target)
          onTap?.(drag.target);
        drag = null;
        canvas.classList.remove("dragging", "moving");
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
      // The details change the width without moving the canvas origin. Keep
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
      gridLevel = null;
    };
  }

  return {
    attach,
    restoreView,
    focusNode,
    focusNodes,
    revealNode,
    hasDragged: () => moved,
    fit,
    reset: () => zoomTo(1),
    zoomBy: (factor) => zoomTo(destination.scale * factor),
  };
}
