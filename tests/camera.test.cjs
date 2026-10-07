const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { transformSync } = require("esbuild");

const code = transformSync(
  fs.readFileSync(
    path.join(__dirname, "../src/visualization/camera.js"),
    "utf8",
  ),
  { format: "cjs" },
).code;

function target() {
  const listeners = new Map();
  const captures = new Set();
  return {
    style: {},
    clientWidth: 1000,
    clientHeight: 700,
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type).delete(fn);
    },
    emit(type, values = {}) {
      const e = { type, preventDefault() {}, ...values };
      for (const fn of listeners.get(type) || []) fn(e);
    },
    get listenerCount() {
      return [...listeners.values()].reduce((n, set) => n + set.size, 0);
    },
    setPointerCapture(id) {
      captures.add(id);
    },
    hasPointerCapture(id) {
      return captures.has(id);
    },
    releasePointerCapture(id) {
      captures.delete(id);
    },
    getBoundingClientRect: () => ({ left: 0, top: 50 }),
    querySelector: () => ({
      viewBox: { baseVal: { width: 300, height: 200 } },
    }),
  };
}

function harness({ reducedMotion = false } = {}) {
  const canvas = target();
  const world = target();
  const document = target();
  const grid = { style: {} };
  canvas.querySelector = (selector) =>
    selector === ".canvas-grid" ? grid : null;
  const motionPreference = target();
  motionPreference.matches = reducedMotion;
  const canvasRef = { current: canvas };
  const worldRef = { current: world };
  const frames = new Map();
  const observers = [];
  const taps = [];
  let time = 0;
  let nextFrame = 0;
  const context = vm.createContext({
    module: { exports: {} },
    document,
    performance: { now: () => time },
    matchMedia: () => motionPreference,
    requestAnimationFrame(fn) {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  new vm.Script(code).runInContext(context);
  const controls = context.module.exports.createCamera({
    canvasRef,
    worldRef,
    onZoom() {},
    onTap(element) {
      taps.push(element);
    },
  });
  controls.restoreView("runtime", false);
  const detach = controls.attach();
  function read() {
    const m = world.style.transform.match(
      /translate\(([-\d.e]+)px,([-\d.e]+)px\) scale\(([-\d.e]+)\)/,
    );
    return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) };
  }
  function frame(elapsed = 16) {
    time += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(time));
  }
  function settle() {
    let count = 0;
    while (frames.size && count++ < 300) frame();
    assert.equal(
      frames.size,
      0,
      "Animation should settle and release its frame",
    );
  }
  function wheel(deltaY, options = {}) {
    canvas.emit("wheel", {
      clientX: 300,
      clientY: 350,
      deltaX: 0,
      deltaY,
      deltaMode: 0,
      ctrlKey: true,
      metaKey: false,
      ...options,
    });
  }
  return {
    canvas,
    world,
    document,
    canvasRef,
    worldRef,
    observers,
    motionPreference,
    taps,
    frames,
    controls,
    detach,
    read,
    frame,
    settle,
    wheel,
  };
}

const close = (actual, expected) =>
  assert(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("pinch eases to its slower target around the cursor; scroll still pans", () => {
  const h = harness();
  const before = h.read();
  const worldX = (300 - before.x) / before.scale;
  const worldY = (300 - before.y) / before.scale;
  h.wheel(-40);
  close(h.read().scale, before.scale);
  h.frame();
  assert(h.read().scale > before.scale);
  assert(h.read().scale < before.scale * Math.exp(0.06));
  h.settle();
  const after = h.read();
  close(after.scale, before.scale * Math.exp(0.06));
  close(after.x + worldX * after.scale, 300);
  close(after.y + worldY * after.scale, 300);
  h.wheel(80, { ctrlKey: false, deltaX: 120 });
  assert.deepEqual(h.read(), after);
  h.frame();
  assert(h.read().x < after.x && h.read().x > after.x - 120);
  h.settle();
  close(h.read().x, after.x - 120);
  close(h.read().y, after.y - 80);
  close(h.read().scale, after.scale);
  h.detach();
});

test("rapid input accumulates and reverses immediately at zoom limits", () => {
  const h = harness();
  const before = h.read().scale;
  for (let i = 0; i < 4; i++) h.wheel(-40);
  h.settle();
  close(h.read().scale, before * Math.exp(0.24));
  h.wheel(-10000);
  h.wheel(40);
  h.settle();
  close(h.read().scale, 3.5 * Math.exp(-0.06));
  h.wheel(10000);
  h.settle();
  close(h.read().scale, 0.08);
  h.wheel(-40);
  h.settle();
  close(h.read().scale, 0.08 * Math.exp(0.06));
  h.detach();
});

test("opening or closing a sidebar keeps graph coordinates stable until Fit is requested", () => {
  const h = harness();
  const before = h.read();
  h.canvas.clientWidth = 400;
  h.observers[0].callback();
  assert.deepEqual(h.read(), before);
  h.canvas.clientWidth = 1000;
  h.observers[0].callback();
  assert.deepEqual(h.read(), before);
  h.canvas.clientWidth = 200;
  h.observers[0].callback();
  h.controls.fit();
  h.settle();
  assert(h.read().scale < before.scale);
  h.detach();
});

test("navigation cancels animation, restores cameras, and unmount cleans up", () => {
  const h = harness();
  h.wheel(-200);
  h.frame();
  h.controls.fit();
  h.settle();
  close(h.read().scale, 1.2);
  h.wheel(80, { ctrlKey: false, deltaX: 120 });
  h.settle();
  const panned = h.world.style.transform;
  h.wheel(-40);
  h.controls.restoreView("backend", false);
  assert.equal(h.frames.size, 0);
  h.controls.restoreView("runtime", false);
  assert.equal(h.world.style.transform, panned);
  h.canvas.emit("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 300,
    clientY: 350,
    target: { closest: () => null },
  });
  assert(h.canvas.hasPointerCapture(1));
  h.wheel(-40);
  // React clears DOM refs on unmount; cleanup must use its captured elements.
  h.canvasRef.current = null;
  h.worldRef.current = null;
  h.detach();
  assert.equal(h.frames.size, 0);
  assert.equal(h.canvas.hasPointerCapture(1), false);
  assert.equal(h.canvas.listenerCount, 0);
  assert.equal(h.world.listenerCount, 0);
  assert.equal(h.document.listenerCount, 0);
  assert(h.observers.every((o) => o.disconnected));
  assert.equal(h.motionPreference.listenerCount, 0);
});

test("a tap activates its original target, while a drag or cancel does not", () => {
  const h = harness(),
    element = { closest: () => null };
  const down = () =>
    h.canvas.emit("pointerdown", {
      button: 0,
      pointerId: 1,
      clientX: 300,
      clientY: 350,
      target: element,
    });
  down();
  h.canvas.emit("pointerup", { pointerId: 1 });
  assert.deepEqual(h.taps, [element]);
  down();
  h.canvas.emit("pointermove", { pointerId: 1, clientX: 340, clientY: 360 });
  h.canvas.emit("pointerup", { pointerId: 1 });
  assert.equal(h.taps.length, 1);
  assert(h.controls.hasDragged());
  down();
  h.canvas.emit("pointercancel", { pointerId: 1 });
  assert.equal(h.taps.length, 1);
  assert(h.controls.hasDragged());
  h.detach();
});

test("scroll and drag input share one frame and settle to their full distance", () => {
  const h = harness();
  const before = h.read();
  for (let i = 0; i < 10; i++) h.wheel(8, { ctrlKey: false, deltaX: 12 });
  assert.equal(h.frames.size, 1);
  assert.deepEqual(h.read(), before);
  h.frame();
  assert(h.read().x < before.x && h.read().x > before.x - 120);
  h.settle();
  close(h.read().x, before.x - 120);
  close(h.read().y, before.y - 80);
  const scrolled = h.read();
  h.canvas.emit("pointerdown", {
    button: 0,
    pointerId: 1,
    clientX: 100,
    clientY: 100,
    target: {},
  });
  h.canvas.emit("pointermove", { pointerId: 1, clientX: 103, clientY: 100 });
  h.canvas.emit("pointermove", { pointerId: 1, clientX: 120, clientY: 110 });
  h.canvas.emit("pointermove", { pointerId: 1, clientX: 140, clientY: 120 });
  h.canvas.emit("pointerup", { pointerId: 1 });
  assert.equal(h.frames.size, 1);
  assert.deepEqual(h.read(), scrolled);
  h.settle();
  close(h.read().x, scrolled.x + 40);
  close(h.read().y, scrolled.y + 20);
  assert.equal(h.taps.length, 0);
  h.detach();
});

test("zoom controls accumulate and keep their anchor fixed on every frame", () => {
  const h = harness();
  const before = h.read();
  const anchor = { x: 500, y: 350 };
  const worldX = (anchor.x - before.x) / before.scale;
  const worldY = (anchor.y - before.y) / before.scale;
  h.controls.zoomBy(1.25);
  h.controls.zoomBy(1.25);
  h.controls.zoomBy(1.25);
  assert.deepEqual(h.read(), before);
  for (let i = 0; i < 15; i++) {
    h.frame();
    const current = h.read();
    close(current.x + worldX * current.scale, anchor.x);
    close(current.y + worldY * current.scale, anchor.y);
  }
  h.settle();
  close(h.read().scale, before.scale * 1.25 ** 3);
  const zoomed = h.read();
  h.controls.reset();
  assert.deepEqual(h.read(), zoomed);
  h.settle();
  close(h.read().scale, 1);
  h.detach();
});

test("revealing a selected search result preserves its animated focus destination", () => {
  const h = harness();
  h.controls.zoomBy(0.5);
  h.settle();
  h.world.querySelector = () => ({
    transform: {
      baseVal: { consolidate: () => ({ matrix: { e: 1000, f: 500 } }) },
    },
    querySelector: () => ({
      getAttribute: (name) => (name === "width" ? "100" : "80"),
    }),
  });
  h.controls.focusNode("search-result");
  h.controls.revealNode("search-result");
  assert.equal(h.frames.size, 1);
  h.settle();
  close(h.read().scale, 0.85);
  close(h.read().x + 1050 * h.read().scale, 500);
  close(h.read().y + 540 * h.read().scale, 350);
  h.detach();
});

test("a two-finger gesture combines pan and zoom without lost updates or a tap", () => {
  const h = harness();
  const before = h.read();
  const worldX = (400 - before.x) / before.scale;
  const worldY = (300 - before.y) / before.scale;
  for (const [pointerId, clientX] of [
    [1, 300],
    [2, 500],
  ])
    h.canvas.emit("pointerdown", {
      button: 0,
      pointerId,
      clientX,
      clientY: 350,
      target: {},
    });
  h.canvas.emit("pointermove", { pointerId: 1, clientX: 280, clientY: 350 });
  h.canvas.emit("pointermove", { pointerId: 2, clientX: 520, clientY: 350 });
  h.canvas.emit("pointerup", { pointerId: 1 });
  h.canvas.emit("pointerup", { pointerId: 2 });
  assert.equal(h.frames.size, 1);
  h.settle();
  close(h.read().scale, before.scale * 1.2);
  close(h.read().x + worldX * h.read().scale, 400);
  close(h.read().y + worldY * h.read().scale, 300);
  assert.equal(h.taps.length, 0);
  h.detach();
});

test("motion follows elapsed time across different display refresh rates", () => {
  const standard = harness();
  const fast = harness();
  for (const h of [standard, fast])
    h.wheel(120, { ctrlKey: false, deltaX: 160 });
  for (let i = 0; i < 10; i++) standard.frame(16);
  for (let i = 0; i < 20; i++) fast.frame(8);
  close(standard.read().x, fast.read().x);
  close(standard.read().y, fast.read().y);
  standard.detach();
  fast.detach();
});

test("reduced motion applies movement immediately and cancels pending animation", () => {
  const h = harness({ reducedMotion: true });
  const before = h.read();
  h.wheel(80, { ctrlKey: false, deltaX: 120 });
  close(h.read().x, before.x - 120);
  close(h.read().y, before.y - 80);
  assert.equal(h.frames.size, 0);
  h.motionPreference.emit("change", { matches: false });
  h.controls.zoomBy(1.25);
  assert.equal(h.frames.size, 1);
  h.frame();
  h.motionPreference.emit("change", { matches: true });
  close(h.read().scale, before.scale * 1.25);
  assert.equal(h.frames.size, 0);
  h.detach();
});
