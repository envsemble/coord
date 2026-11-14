// Nightly's sky: a starfield drawn by a WebGL shader behind the page. Three layers of stars, each a
// point in a grid cell (most cells empty), drifting at their own pace: each star a soft point with a
// faint halo, mostly dim and a few bright, from blue-white to warm, twinkling on its own clock. The
// middle of the page, where the content is, stays clear.
//
// It costs little: one quad, one pass, every pixel looking at only its own cell in each layer; drawn at
// most 30 times a second at no more than 1.5 pixels per CSS pixel, and only while Nightly is picked and
// the page is visible. Without WebGL there is no sky; for reduced motion it is drawn once and kept still.
import { useEffect, useRef } from 'react';

const vertex = `attribute vec2 point; void main() { gl_Position = vec4(point, 0.0, 1.0); }`;
const fragment = `
precision highp float;
uniform vec2 size;      // the canvas, in device pixels
uniform float scale;    // device pixels per CSS pixel
uniform float time;     // seconds
uniform float clear;    // half the clear middle, in CSS pixels
uniform float fade;     // how far the stars fade in beyond it

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// One layer: a star in some of the cells of a grid, placed away from the cell's edges so its glow stays inside it.
vec3 layer(vec2 at, float cell, float share, float seed, float radius) {
  vec2 id = floor(at / cell) + seed;
  if (hash(id) > share) return vec3(0.0);
  vec2 centre = (0.25 + 0.5 * vec2(hash(id + 3.1), hash(id + 8.3))) * cell;
  vec2 d = mod(at, cell) - centre;
  float r2 = dot(d, d);
  float bright = pow(hash(id + 7.7), 3.0);               // most stars dim, a few bright
  float core = exp(-r2 / (radius * radius * (0.3 + 1.1 * bright)));
  float halo = exp(-sqrt(r2) / (radius * (1.2 + 4.0 * bright))) * 0.12 * bright;
  float twinkle = 0.72 + 0.28 * sin(time * (0.4 + 1.6 * hash(id + 1.3)) + 6.2831 * hash(id + 2.9));
  vec3 colour = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.86, 0.72), hash(id + 5.2));
  return colour * (core * (0.32 + 1.3 * bright) + halo) * twinkle;
}

void main() {
  vec2 at = gl_FragCoord.xy / scale;
  vec3 sky = layer(at + vec2(0.0, time * 1.2), 23.0, 0.32, 0.0, 0.45)
           + layer(at + vec2(0.0, time * 2.0), 53.0, 0.45, 17.0, 0.6)
           + layer(at + vec2(0.0, time * 3.0), 131.0, 0.55, 41.0, 0.8);
  float x = abs(at.x - size.x / scale * 0.5);
  gl_FragColor = vec4(sky * smoothstep(clear, clear + fade, x), 1.0);
}`;

export function Sky({ shown }: { shown: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const control = useRef<{ start: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    const element = canvas.current!;
    const gl = element.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) return;
    const shader = (type: number, source: string) => { const made = gl.createShader(type)!; gl.shaderSource(made, source); gl.compileShader(made); return made; };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program, 'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const [size, scale, time, clear, fade] = ['size', 'scale', 'time', 'clear', 'fade'].map(uniform);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const began = performance.now();

    const fit = () => {
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      element.width = Math.round(innerWidth * ratio);
      element.height = Math.round(innerHeight * ratio);
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform2f(size, element.width, element.height);
      gl.uniform1f(scale, ratio);
      // Clear over the content's column (40rem), fading in over 6rem beyond it.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      gl.uniform1f(clear, 20 * rem);
      gl.uniform1f(fade, 6 * rem);
    };
    const draw = (now: number) => { gl.uniform1f(time, still ? 40 : (now - began) / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); };

    let frame = 0, last = 0, running = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / 30) return;
      last = now;
      draw(now);
    };
    const start = () => {
      if (running) return;
      running = true;
      if (still) { draw(performance.now()); return; }
      frame = requestAnimationFrame(tick);
    };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const resize = () => { fit(); if (running) draw(performance.now()); };
    fit();
    addEventListener('resize', resize);
    control.current = { start, stop };
    return () => { stop(); removeEventListener('resize', resize); control.current = null; };
  }, []);

  // Drawn only while it shows; after fading out, it stops.
  useEffect(() => {
    if (shown) { control.current?.start(); return; }
    const timer = setTimeout(() => control.current?.stop(), 800);
    return () => clearTimeout(timer);
  }, [shown]);

  return <canvas ref={canvas} className="sky" data-shown={shown ? '' : undefined} aria-hidden="true" />;
}
