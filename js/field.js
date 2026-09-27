// CPU side of the cell field.
//
// Every pixel of the downsampled image becomes one cell of a W×H grid; cell
// centres are one unit apart. Whenever something changes (and every frame while
// animating) we compute per cell:
//   z  height of the shape centre towards the viewer
//   r  shape size (0 = empty cell)
// plus, over a (2R+1)² window around the cell, the highest shape top and the
// lowest shape bottom. The shader uses those window extents to bound the
// distance to every cell it does not evaluate explicitly (see map() in
// shaders.js) — that bound is what keeps neighbouring domains from conflicting.

export const WINDOW_R = 4;
export const BASE_Z = -0.56;       // top of the back plate, root of pins and bars
export const DEPTH_SCALE = 0.6;    // depth slider 1.0 -> 0.6 × grid size
export const SCATTER_SCALE = 0.5;
export const WAVE_SCALE = 0.08;
export const FLOAT_SCALE = 0.05;

const EMPTY_TOP = -1e9;
const EMPTY_BOT = 1e9;
const TAU = Math.PI * 2;

// up/down: vertical extent of the shape as a multiple of its size r.
// spinFit: size factor that keeps a spinning shape inside its cell column.
export const SHAPES = {
  sphere:  { id: 0, label: 'Sphere',  up: 1,    down: 1,    grounded: false, spins: false },
  cube:    { id: 1, label: 'Cube',    up: 1,    down: 1,    grounded: false, spins: true, spinFit: Math.SQRT1_2, spinUp: Math.SQRT2 },
  pin:     { id: 2, label: 'Pin',     up: 1,    down: 0,    grounded: true,  spins: false },
  bar:     { id: 3, label: 'Bar',     up: 0,    down: 0,    grounded: true,  spins: false },
  diamond: { id: 4, label: 'Diamond', up: 1,    down: 1,    grounded: false, spins: true, spinFit: 1, spinUp: 1 },
  ring:    { id: 5, label: 'Ring',    up: 0.34, down: 0.34, grounded: false, spins: true, spinFit: 1, spinUp: 1 },
};

export class Field {
  constructor() {
    this.W = 0;
    this.H = 0;
    this.n = 0;
    this.R = WINDOW_R;
    this.levelKey = '';
    this.zMin = 0;
    this.zMax = 0;
    this.pushActive = false;
    this.ripples = [];
  }

  get size() {
    return Math.max(this.W, this.H);
  }

  alloc(w, h) {
    const n = w * h;
    this.W = w;
    this.H = h;
    this.n = n;
    this.color = new Uint8Array(n * 4);
    this.lum = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.level = new Float32Array(n);
    this.cells = new Float32Array(n * 4);
    this.top = new Float32Array(n);
    this.bot = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.sinR = new Float32Array(n);
    this.cosR = new Float32Array(n);
    this.sinP = new Float32Array(n);
    this.cosP = new Float32Array(n);
    this.rp = new Float64Array(36);
    this.waveK = NaN;
    this.push = new Float32Array(n);
    this.rnd = new Float32Array(n);
    this.rnd2 = new Float32Array(n);
    this.radial = new Float32Array(n);
    const m = Math.max(w, h) + 2 * 64;
    this.P = new Float32Array(m);
    this.G = new Float32Array(m);
    this.Q = new Float32Array(m);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let j = 0, c = 0; j < h; j++) {
      for (let i = 0; i < w; i++, c++) {
        this.rnd[c] = hash(i, j, 1);
        this.rnd2[c] = hash(i, j, 2);
        this.radial[c] = Math.hypot(i - cx, j - cy);
        this.sinP[c] = Math.sin(this.rnd[c] * TAU);
        this.cosP[c] = Math.cos(this.rnd[c] * TAU);
      }
    }
    this.pushActive = false;
    this.ripples.length = 0;
  }

  /** px: RGBA bytes in canvas order (top row first), w×h. */
  setPixels(px, w, h) {
    if (w !== this.W || h !== this.H) this.alloc(w, h);
    const { color, lum, alpha } = this;
    for (let row = 0; row < h; row++) {
      const j = h - 1 - row; // grid rows run bottom -> top
      let s = row * w * 4;
      let c = j * w;
      for (let i = 0; i < w; i++, s += 4, c++) {
        const r = px[s], g = px[s + 1], b = px[s + 2];
        const d = c * 4;
        color[d] = r;
        color[d + 1] = g;
        color[d + 2] = b;
        color[d + 3] = 255;
        lum[c] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        alpha[c] = px[s + 3] / 255;
      }
    }
    this.levelKey = '';
  }

  /** Brightness -> normalised height, cached until the mapping changes. */
  ensureLevels(s) {
    const key = `${s.invert}|${s.curve}|${s.terraces}`;
    if (key === this.levelKey) return;
    this.levelKey = key;
    const { lum, level, n } = this;
    const T = s.terraces;
    for (let c = 0; c < n; c++) {
      let l = s.invert ? 1 - lum[c] : lum[c];
      l = Math.pow(l, s.curve);
      if (T > 0) l = Math.round(l * T) / T;
      level[c] = l;
    }
  }

  // ---- interaction ----------------------------------------------------------

  addRipple(x, y, rt, strength = 1) {
    if (this.ripples.length >= 6) this.ripples.shift();
    this.ripples.push({ x, y, t0: rt, strength, amp: 0, front: 0, invW: 1 });
  }

  /** Advances ripples to real time rt; returns true while any is alive. */
  stepRipples(rt) {
    const S = this.size;
    const speed = 0.42 * S;
    const invW = 1 / Math.max(1.4, 0.028 * S);
    this.ripples = this.ripples.filter((q) => rt - q.t0 < 3.5);
    for (const q of this.ripples) {
      const age = rt - q.t0;
      q.front = age * speed;
      q.invW = invW;
      q.amp = 0.07 * S * q.strength * Math.exp(-age * 1.1) * Math.min(1, age * 8);
    }
    return this.ripples.length > 0;
  }

  /** Pushes cells near grid point (gx, gy) towards the viewer, like a pin-art toy. */
  poke(gx, gy, strength = 1) {
    const { W, H, push } = this;
    const S = this.size;
    const rad = Math.max(1.5, 0.05 * S);
    const hgt = 0.16 * S * strength;
    const R = Math.ceil(rad * 2.2);
    const i0 = Math.max(0, Math.floor(gx - R)), i1 = Math.min(W - 1, Math.ceil(gx + R));
    const j0 = Math.max(0, Math.floor(gy - R)), j1 = Math.min(H - 1, Math.ceil(gy + R));
    const inv = 1 / (rad * rad);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - gx, dy = j - gy;
        const v = hgt * Math.exp(-(dx * dx + dy * dy) * inv);
        const c = j * W + i;
        if (v > push[c]) push[c] = v;
      }
    }
    this.pushActive = true;
  }

  /** Lets poked cells sink back; returns true while any is still raised. */
  relax(dt) {
    if (!this.pushActive) return false;
    const f = Math.exp(-dt * 1.4);
    const push = this.push;
    let any = false;
    for (let c = 0; c < this.n; c++) {
      let v = push[c];
      if (v !== 0) {
        v *= f;
        if (v < 0.01) v = 0;
        else any = true;
        push[c] = v;
      }
    }
    this.pushActive = any;
    return true;
  }

  // ---- per-frame update -------------------------------------------------------

  /** Recomputes all cell data for settings s at animation time t (seconds). */
  update(s, t) {
    const { W, H, level, alpha, rnd2, push, cells, top, bot } = this;
    this.ensureLevels(s);
    const S = this.size;
    const shape = SHAPES[s.shape] || SHAPES.sphere;
    const spin = shape.spins && s.spin > 0;
    const rMax = 0.5 * (spin ? shape.spinFit : 1);
    const up = spin ? shape.spinUp : shape.up;
    const down = spin ? shape.spinUp : shape.down;
    const grounded = shape.grounded;
    const depth = s.depth * DEPTH_SCALE * S;
    const size = s.size * rMax;
    const sbl = s.sizeByLum;
    const scat = s.scatter * SCATTER_SCALE * S;
    const pushOn = this.pushActive;

    // Wave and float use cached per-cell sin/cos, so a frame costs two
    // multiply-adds per cell instead of a Math.sin:
    // sin(a - b) = sin a cos b - cos a sin b, sin(b + p) = sin b cos p + cos b sin p.
    const waveA = s.wave * WAVE_SCALE * S;
    if (waveA !== 0) this.ensureWave(TAU / (Math.max(0.03, s.waveLen) * S));
    const sw = Math.sin(t * s.waveSpeed * 2.5), cw = Math.cos(t * s.waveSpeed * 2.5);
    const floatA = s.float * FLOAT_SCALE * S;
    const sf = Math.sin(t * 1.3), cf = Math.cos(t * 1.3);
    const { sinR, cosR, sinP, cosP } = this;

    // Ripples: only cells inside each ring band pay for a sqrt + table lookup.
    const RP = this.rp;
    const nr = Math.min(this.ripples.length, 6);
    for (let k = 0; k < nr; k++) {
      const q = this.ripples[k];
      const bw = RIPPLE_BAND / q.invW;
      const inner = Math.max(0, q.front - bw);
      RP[k * 6] = q.x;
      RP[k * 6 + 1] = q.y;
      RP[k * 6 + 2] = inner * inner;
      RP[k * 6 + 3] = (q.front + bw) * (q.front + bw);
      RP[k * 6 + 4] = q.front;
      RP[k * 6 + 5] = q.invW;
    }
    const amps = this.ripples.map((q) => q.amp);

    let zMin = Infinity, zMax = -Infinity;
    for (let j = 0, c = 0; j < H; j++) {
      for (let i = 0; i < W; i++, c++) {
        const lv = level[c];
        let r = 0;
        if (alpha[c] >= 0.5) {
          r = size * (1 - sbl + sbl * (0.12 + 0.88 * lv));
          if (r < 0.012) r = 0;
        }
        let z = depth * lv;
        if (scat !== 0) z += scat * rnd2[c] * rnd2[c];
        if (waveA !== 0) z += waveA * (0.5 + 0.5 * (sinR[c] * cw - cosR[c] * sw));
        if (floatA !== 0) z += floatA * (0.5 + 0.5 * (sf * cosP[c] + cf * sinP[c]));
        if (pushOn) z += push[c];
        for (let k = 0, o = 0; k < nr; k++, o += 6) {
          const dx = i - RP[o], dy = j - RP[o + 1];
          const d2 = dx * dx + dy * dy;
          if (d2 > RP[o + 2] && d2 < RP[o + 3]) z += amps[k] * ripple((Math.sqrt(d2) - RP[o + 4]) * RP[o + 5]);
        }
        if (z < 0) z = 0;

        const o = c * 4;
        cells[o] = z;
        cells[o + 1] = r;
        if (r > 0) {
          const tp = z + up * r;
          const bt = grounded ? BASE_Z : z - down * r;
          top[c] = tp;
          bot[c] = bt;
          if (tp > zMax) zMax = tp;
          if (bt < zMin) zMin = bt;
        } else {
          top[c] = EMPTY_TOP;
          bot[c] = EMPTY_BOT;
        }
      }
    }

    // Window extrema go straight into channels z / w of the cell texture.
    windowFilter(top, W, H, true, this, cells, 2);
    windowFilter(bot, W, H, false, this, cells, 3);

    if (zMax < zMin) zMin = zMax = 0;
    this.zMin = zMin;
    this.zMax = zMax;
  }

  ensureWave(k) {
    if (k === this.waveK) return;
    this.waveK = k;
    const { radial, sinR, cosR, n } = this;
    for (let c = 0; c < n; c++) {
      const a = radial[c] * k;
      sinR[c] = Math.sin(a);
      cosR[c] = Math.cos(a);
    }
  }
}

// Ripple profile exp(-u²)·cos(2.2u) over |u| < RIPPLE_BAND, tabulated once.
const RIPPLE_BAND = 2.6;
const LUT_N = 512;
const LUT = new Float32Array(LUT_N + 2);
for (let k = 0; k <= LUT_N + 1; k++) {
  const u = (k / LUT_N) * 2 * RIPPLE_BAND - RIPPLE_BAND;
  LUT[k] = Math.exp(-u * u) * Math.cos(2.2 * u);
}
function ripple(u) {
  const x = ((u + RIPPLE_BAND) / (2 * RIPPLE_BAND)) * LUT_N;
  if (!(x >= 0 && x < LUT_N)) return 0;
  const k = x | 0;
  return LUT[k] + (LUT[k + 1] - LUT[k]) * (x - k);
}

// Separable (2R+1)² max / min filter of src (W×H) into every 4th float of dst,
// starting at channel `off` (the interleaved cell texture).
function windowFilter(src, W, H, isMax, f, dst, off) {
  const R = f.R;
  for (let j = 0; j < H; j++) line(src, j * W, 1, W, f.tmp, j * W, 1, R, isMax, f);
  for (let i = 0; i < W; i++) line(f.tmp, i, W, H, dst, i * 4 + off, W * 4, R, isMax, f);
}

// Sliding-window max/min over one strided line in O(1) per element
// (van Herk / Gil-Werman: per-block prefix and suffix extrema).
function line(src, s0, ss, n, dst, d0, ds, R, isMax, f) {
  const { P, G, Q } = f;
  const w = 2 * R + 1;
  const m = n + 2 * R;
  const pad = isMax ? EMPTY_TOP : EMPTY_BOT;
  for (let k = 0; k < R; k++) {
    P[k] = pad;
    P[m - 1 - k] = pad;
  }
  for (let x = 0, q = s0; x < n; x++, q += ss) P[x + R] = src[q];
  if (isMax) {
    for (let b = 0; b < m; b += w) {
      const e = b + w < m ? b + w : m;
      let a = P[b];
      G[b] = a;
      for (let k = b + 1; k < e; k++) {
        const v = P[k];
        if (v > a) a = v;
        G[k] = a;
      }
      a = P[e - 1];
      Q[e - 1] = a;
      for (let k = e - 2; k >= b; k--) {
        const v = P[k];
        if (v > a) a = v;
        Q[k] = a;
      }
    }
    for (let x = 0, d = d0; x < n; x++, d += ds) {
      const a = Q[x], b = G[x + 2 * R];
      dst[d] = a > b ? a : b;
    }
  } else {
    for (let b = 0; b < m; b += w) {
      const e = b + w < m ? b + w : m;
      let a = P[b];
      G[b] = a;
      for (let k = b + 1; k < e; k++) {
        const v = P[k];
        if (v < a) a = v;
        G[k] = a;
      }
      a = P[e - 1];
      Q[e - 1] = a;
      for (let k = e - 2; k >= b; k--) {
        const v = P[k];
        if (v < a) a = v;
        Q[k] = a;
      }
    }
    for (let x = 0, d = d0; x < n; x++, d += ds) {
      const a = Q[x], b = G[x + 2 * R];
      dst[d] = a < b ? a : b;
    }
  }
}

function hash(i, j, s) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
