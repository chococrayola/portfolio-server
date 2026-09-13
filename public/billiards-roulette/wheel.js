/* Billiards Roulette — canvas wheel renderer + spin animation.
 *
 * Randomness: `Rand` wraps crypto.getRandomValues with rejection sampling,
 * so every option is exactly equally likely (no modulo bias) and weighted
 * picks are exact. The winner is chosen BEFORE the wheel starts turning;
 * the animation is only a visualisation that decelerates the wheel until
 * the pointer rests inside the winning slice.
 *
 * Loaded as a classic script: app.js picks up `RouletteWheel` and `Rand`
 * from the shared global scope. */
'use strict';

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const WHEEL_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* Solid-ball colours 1–8, cycled around the wheel. `text` is a label colour
 * with enough contrast on that fill. */
const BALL_PALETTE = [
  { fill: '#f4c20d', text: '#1b1500' }, // 1 — yellow
  { fill: '#1f57c8', text: '#ffffff' }, // 2 — blue
  { fill: '#d9283f', text: '#ffffff' }, // 3 — red
  { fill: '#6c2f93', text: '#ffffff' }, // 4 — purple
  { fill: '#f07f1f', text: '#1b1000' }, // 5 — orange
  { fill: '#1f9150', text: '#ffffff' }, // 6 — green
  { fill: '#7e2136', text: '#ffffff' }, // 7 — maroon
  { fill: '#1b1b1f', text: '#ffffff' }, // 8 — black
];

const Rand = (() => {
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  const one = new Uint32Array(1);
  const two = new Uint32Array(2);

  // Uniform integer in [0, n). Draws above the largest multiple of n that
  // fits in 32 bits are rejected, so `x % n` can't favour the low residues.
  function int(n) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    if (!hasCrypto) return Math.floor(Math.random() * n);
    const limit = 4294967296 - (4294967296 % n);
    let x;
    do {
      crypto.getRandomValues(one);
      x = one[0];
    } while (x >= limit);
    return x % n;
  }

  // Uniform float in [0, 1) with 53 bits of entropy.
  function float() {
    if (!hasCrypto) return Math.random();
    crypto.getRandomValues(two);
    return ((two[0] >>> 5) * 67108864 + (two[1] >>> 6)) / 9007199254740992;
  }

  // Index chosen proportionally to integer weights (exact, built on `int`).
  function weighted(weights) {
    const w = weights.map((x) => Math.max(1, Math.round(Number(x)) || 1));
    const total = w.reduce((a, b) => a + b, 0);
    let r = int(total);
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r < 0) return i;
    }
    return w.length - 1;
  }

  return { int, float, weighted, secure: hasCrypto };
})();

function mod(a, m) {
  return ((a % m) + m) % m;
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

class RouletteWheel {
  static colorFor(index, count) {
    const len = BALL_PALETTE.length;
    let i = index % len;
    // The last slice touches the first one — don't let them share a colour.
    if (count > 1 && index === count - 1 && i === 0) i = 1;
    return BALL_PALETTE[i];
  }

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTick = opts.onTick || null;
    this.timeScale = 1; // < 1 shortens spins (tests); reduced-motion is handled separately
    this.slices = [];
    this.arcs = [];
    this.rotation = 0; // radians, clockwise; 0 = slice 0 starts right under the pointer
    this.highlight = -1;
    this.spinning = false;
    this.cssSize = 0;
    this.dpr = 1;
    this._raf = 0;
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this.resize();
  }

  /* slices: [{ id, label, weight }] — colours are assigned by position. */
  setSlices(slices) {
    this.slices = slices.map((s, i) => ({
      id: s.id,
      label: String(s.label ?? ''),
      weight: Math.max(1, Math.round(Number(s.weight)) || 1),
      color: RouletteWheel.colorFor(i, slices.length),
    }));
    const total = this.slices.reduce((a, s) => a + s.weight, 0) || 1;
    let a = 0;
    this.arcs = this.slices.map((s) => {
      const span = (s.weight / total) * TAU;
      const arc = { start: a, end: a + span };
      a += span;
      return arc;
    });
    // Re-applying an identical list (e.g. a status refresh) keeps the
    // winner lit; any real change to the options clears it.
    const signature = this.slices.map((s) => `${s.id}\u0000${s.label}\u0000${s.weight}`).join('\u0001');
    if (signature !== this._signature) this.highlight = -1;
    this._signature = signature;
    this.draw();
  }

  resize() {
    const size = this.canvas.clientWidth || 0;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const px = Math.round(size * dpr);
    if (px && (this.canvas.width !== px || this.canvas.height !== px)) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.cssSize = size;
    this.dpr = dpr;
    this.draw();
  }

  /* Which slice sits at a given wheel-local angle (0 = top, clockwise). */
  indexAt(localAngle) {
    const a = mod(localAngle, TAU);
    for (let i = 0; i < this.arcs.length; i++) {
      if (a >= this.arcs[i].start && a < this.arcs[i].end) return i;
    }
    return this.arcs.length - 1;
  }
  indexUnderPointer() {
    return this.indexAt(-this.rotation);
  }

  /* Animate until the pointer rests inside slice `winnerIndex`. Resolves
   * { index, slice } read back from the final angle — by construction the
   * same slice, but the display is always the source of truth. */
  spin(winnerIndex) {
    const n = this.slices.length;
    if (this.spinning || !n) return Promise.resolve(null);
    const i = clamp(Math.floor(winnerIndex) || 0, 0, n - 1);
    const arc = this.arcs[i];
    const span = arc.end - arc.start;
    // Land anywhere inside the slice, but keep clear of its edges.
    const margin = Math.min(span * 0.12, 0.06);
    const target = arc.start + margin + (span - 2 * margin) * Rand.float();
    const from = mod(this.rotation, TAU);
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const turns = reduce ? 1 : 4 + Rand.int(4); // 4–7 full turns before settling
    const delta = mod(-target - from, TAU) + turns * TAU;
    const duration = (reduce ? 800 : 4200 + Rand.float() * 1800) * this.timeScale;

    this.rotation = from;
    this.highlight = -1;
    this.spinning = true;
    let lastIdx = this.indexUnderPointer();
    const t0 = performance.now();

    return new Promise((resolve) => {
      const frame = (now) => {
        const t = duration > 0 ? clamp((now - t0) / duration, 0, 1) : 1;
        const p = 1 - Math.pow(1 - t, 4); // ease-out quart: fast start, long coast
        this.rotation = from + delta * p;
        const idx = this.indexUnderPointer();
        if (idx !== lastIdx) {
          lastIdx = idx;
          if (this.onTick) this.onTick(idx);
        }
        this.draw();
        if (t < 1) {
          this._raf = requestAnimationFrame(frame);
          return;
        }
        this.rotation = mod(from + delta, TAU);
        this.spinning = false;
        this.highlight = this.indexUnderPointer();
        this.draw();
        resolve({ index: this.highlight, slice: this.slices[this.highlight] });
      };
      this._raf = requestAnimationFrame(frame);
    });
  }

  draw() {
    const { ctx, cssSize: S, dpr } = this;
    if (!S) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const c = S / 2;
    const rim = Math.max(6, S * 0.035);
    const R = c - rim; // felt radius
    const hub = Math.max(16, R * 0.15);

    ctx.save();
    ctx.translate(c, c);

    // Wooden rail with diamond sights, like a table's cushions.
    ctx.beginPath();
    ctx.arc(0, 0, c - 1, 0, TAU);
    const rail = ctx.createRadialGradient(0, 0, R, 0, 0, c);
    rail.addColorStop(0, '#6a3d22');
    rail.addColorStop(1, '#2d1a0e');
    ctx.fillStyle = rail;
    ctx.fill();
    ctx.fillStyle = '#f3e6c8';
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU - HALF_PI;
      const r = c - rim / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, Math.max(1.2, rim * 0.16), 0, TAU);
      ctx.fill();
    }

    const n = this.slices.length;
    if (!n) {
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fillStyle = '#0f5a38';
      ctx.fill();
      this._drawHub(ctx, hub);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.rotate(this.rotation);
    for (let i = 0; i < n; i++) {
      const s = this.slices[i];
      const arc = this.arcs[i];
      this._wedge(ctx, R, arc);
      ctx.fillStyle = s.color.fill;
      ctx.fill();
      this._drawLabel(ctx, s.label, R, hub, arc, s.color);
      if (this.highlight >= 0 && i !== this.highlight) {
        this._wedge(ctx, R, arc);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fill();
      }
      this._wedge(ctx, R, arc);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.highlight >= 0) {
      this._wedge(ctx, R - 1.5, this.arcs[this.highlight]);
      ctx.strokeStyle = '#fff6dc';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255, 246, 220, 0.9)';
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Soft vignette so the disc reads as felt with depth, not a flat pie.
    const vig = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fillStyle = vig;
    ctx.fill();

    this._drawHub(ctx, hub);
    ctx.restore();
  }

  _wedge(ctx, R, arc) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, arc.start - HALF_PI, arc.end - HALF_PI);
    ctx.closePath();
  }

  _drawHub(ctx, hub) {
    // Cue ball in the middle, complete with the red "measles" dot.
    const g = ctx.createRadialGradient(-hub * 0.35, -hub * 0.35, hub * 0.1, 0, 0, hub);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#cfc7b4');
    ctx.beginPath();
    ctx.arc(0, 0, hub, 0, TAU);
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = hub * 0.5;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hub * 0.3, hub * 0.2, Math.max(1.5, hub * 0.1), 0, TAU);
    ctx.fillStyle = '#d0342c';
    ctx.fill();
  }

  /* Label along the slice's bisector, hugging the rim. The font shrinks to
   * fit the wedge first (narrow slices, long names); only then is the text
   * cut with an ellipsis. Slices currently on the left half of the screen
   * get their text flipped (reading rim → centre) so no label is ever
   * upside down. */
  _drawLabel(ctx, text, R, hub, arc, color) {
    if (!text) return;
    const span = arc.end - arc.start;
    const mid = (arc.start + arc.end) / 2;
    const flip = mod(mid + this.rotation, TAU) > Math.PI;
    const tanHalf = Math.tan(Math.min(span, Math.PI * 0.999) / 2);
    const pad = Math.max(10, R * 0.07);
    // Innermost x where a label `size` tall still fits between the wedge's edges.
    const limitFor = (size) => R - pad - Math.max(hub + 6, size / (2 * tanHalf) + 2);
    let fs = clamp(Math.min(R * 0.095, 2 * (R * 0.55) * tanHalf * 0.85), 9, 21);
    let str = text;
    ctx.save();
    ctx.rotate(mid - HALF_PI + (flip ? Math.PI : 0));
    ctx.textAlign = flip ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ${WHEEL_FONT}`;
    let maxW = limitFor(fs);
    while (fs > 9 && ctx.measureText(str).width > maxW) {
      fs -= 1;
      ctx.font = `700 ${fs}px ${WHEEL_FONT}`;
      maxW = limitFor(fs);
    }
    if (maxW < 8) {
      ctx.restore();
      return;
    }
    if (ctx.measureText(str).width > maxW) {
      while (str.length > 1 && ctx.measureText(str.trimEnd() + '…').width > maxW) {
        str = str.slice(0, -1);
      }
      str = str.trimEnd() + '…';
    }
    ctx.fillStyle = color.text;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 3;
    ctx.fillText(str, flip ? -(R - pad) : R - pad, 0);
    ctx.restore();
  }
}
