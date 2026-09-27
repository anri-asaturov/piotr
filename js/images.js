// Image sources: procedural presets, user files and the camera, plus the
// downsampler that turns any of them into one pixel per grid cell.

const TAU = Math.PI * 2;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rng(seed) {
  // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

// ---- presets ----------------------------------------------------------------

function sunset() {
  const w = 640, h = 400, hor = Math.round(h * 0.64);
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const rnd = rng(11);

  let gr = g.createLinearGradient(0, 0, 0, hor);
  gr.addColorStop(0, '#07051f');
  gr.addColorStop(0.45, '#2a0b52');
  gr.addColorStop(0.78, '#8a1f6e');
  gr.addColorStop(1, '#f2536b');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, hor);

  for (let i = 0; i < 90; i++) {
    const s = rnd() < 0.12 ? 2.6 : 1.4;
    g.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.65})`;
    g.fillRect(rnd() * w, rnd() * hor * 0.55, s, s);
  }

  const cx = w / 2, cy = hor - h * 0.09, R = h * 0.25;
  gr = g.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 2.2);
  gr.addColorStop(0, 'rgba(255,110,130,0.5)');
  gr.addColorStop(1, 'rgba(255,60,130,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, hor);

  // Sun on its own layer so the stripes reveal the sky behind it.
  const sun = makeCanvas(Math.ceil(2 * R), Math.ceil(2 * R)), sg = sun.getContext('2d');
  gr = sg.createLinearGradient(0, 0, 0, 2 * R);
  gr.addColorStop(0, '#fff7ae');
  gr.addColorStop(0.45, '#ffc94d');
  gr.addColorStop(0.75, '#ff7a45');
  gr.addColorStop(1, '#ff3d7f');
  sg.fillStyle = gr;
  sg.beginPath();
  sg.arc(R, R, R, 0, TAU);
  sg.fill();
  sg.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 7; k++) sg.fillRect(0, R * (1.02 + k * 0.14), 2 * R, 2 + k * 1.7);
  g.drawImage(sun, cx - R, cy - R);

  ridge(g, w, hor, rnd, h * 0.22, '#5b2386', '#2a0d4e');
  ridge(g, w, hor, rnd, h * 0.13, '#34115c', '#12052a');

  gr = g.createLinearGradient(0, hor, 0, h);
  gr.addColorStop(0, '#1b0632');
  gr.addColorStop(1, '#040109');
  g.fillStyle = gr;
  g.fillRect(0, hor, w, h - hor);

  g.strokeStyle = '#ff47b5';
  g.lineWidth = 2.2;
  g.shadowColor = '#ff47b5';
  g.shadowBlur = 10;
  for (let k = 1; k <= 11; k++) {
    const t = k / 11, y = hor + (h - hor) * t * t;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  for (let k = -14; k <= 14; k++) {
    g.beginPath();
    g.moveTo(cx + k * 12, hor);
    g.lineTo(cx + k * 95, h);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = '#ffa6dd';
  g.fillRect(0, hor - 1, w, 2);
  return c;
}

function ridge(g, w, base, rnd, amp, top, bottom) {
  const p = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const gr = g.createLinearGradient(0, base - amp, 0, base);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, base);
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const n = 0.55 + 0.22 * Math.sin(t * 9 + p[0]) + 0.14 * Math.sin(t * 23 + p[1]) + 0.07 * Math.sin(t * 57 + p[2]);
    const valley = 0.3 + 0.7 * Math.min(1, Math.abs(t - 0.5) * 2.4);
    g.lineTo(t * w, base - amp * n * valley);
  }
  g.lineTo(w, base);
  g.closePath();
  g.fill();
}

function spectrum() {
  const s = 320, c = makeCanvas(s, s), g = c.getContext('2d');
  const img = g.createImageData(s, s), d = img.data;
  const bg = [10, 11, 20];
  for (let y = 0, o = 0; y < s; y++) {
    for (let x = 0; x < s; x++, o += 4) {
      const u = ((x + 0.5) / s) * 2 - 1, v = ((y + 0.5) / s) * 2 - 1;
      const r = Math.hypot(u, v) / 0.94;
      const [cr, cg, cb] = hsv(Math.atan2(v, u) / TAU + 0.5, Math.min(1, r * 1.15), 1 - 0.12 * r);
      const a = Math.max(0, Math.min(1, (1 - r) * s * 0.47));
      d[o] = bg[0] + (cr * 255 - bg[0]) * a;
      d[o + 1] = bg[1] + (cg * 255 - bg[1]) * a;
      d[o + 2] = bg[2] + (cb * 255 - bg[2]) * a;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function orbs() {
  const w = 480, h = 480, c = makeCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#06070d';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  const cols = ['255,77,109', '255,179,71', '77,212,255', '124,92,255', '61,255,168', '255,102,204', '255,224,102'];
  const rnd = rng(5);
  for (let i = 0; i < 12; i++) {
    const x = 40 + rnd() * (w - 80), y = 40 + rnd() * (h - 80), r = 45 + rnd() * 110;
    const col = cols[i % cols.length];
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col},0.95)`);
    gr.addColorStop(0.55, `rgba(${col},0.45)`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  return c;
}

function rings() {
  const s = 360, c = makeCanvas(s, s), g = c.getContext('2d');
  const img = g.createImageData(s, s), d = img.data;
  for (let y = 0, o = 0; y < s; y++) {
    for (let x = 0; x < s; x++, o += 4) {
      const u = x / s, v = y / s;
      const r1 = Math.hypot(u - 0.3, v - 0.38), r2 = Math.hypot(u - 0.7, v - 0.62);
      const t = 0.5 + 0.25 * (Math.cos(r1 * 44) + Math.cos(r2 * 44));
      const k = t * 0.6 + r1 * 0.5;
      const b = 0.15 + 0.85 * t * t;
      d[o] = 255 * b * (0.5 + 0.5 * Math.cos(TAU * k));
      d[o + 1] = 255 * b * (0.5 + 0.5 * Math.cos(TAU * (k + 0.33)));
      d[o + 2] = 255 * b * (0.5 + 0.5 * Math.cos(TAU * (k + 0.67)));
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function heart() {
  // 16×16 pixel art computed from the implicit heart curve.
  const N = 16, P = 16, c = makeCanvas(N * P, N * P), g = c.getContext('2d');
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    const x = ((i + 0.5) / N) * 2.7 - 1.35;
    const y = 1.3 - ((j + 0.5) / N) * 2.55;
    const a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y <= 0;
  };
  const rnd = rng(9);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let col;
      if (!inside(i, j)) {
        col = rnd() < 0.06 ? '#ffe27a' : (i + j) % 2 ? '#101433' : '#0d1029';
      } else if (!inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)) {
        col = '#5a0b24';
      } else {
        const hx = i - 4.5, hy = j - 4.5;
        const hl = hx * hx + hy * hy;
        col = hl < 2.2 ? '#ffe3ea' : hl < 5.5 ? '#ff8aa5' : i + j > 17 ? '#c8163f' : '#ff3358';
      }
      g.fillStyle = col;
      g.fillRect(i * P, j * P, P, P);
    }
  }
  return c;
}

function text(str) {
  const s = (str || '').trim() || 'PIOTR';
  const w = 1024, h = 512, c = makeCanvas(w, h), g = c.getContext('2d');
  const bg = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.6);
  bg.addColorStop(0, '#1c1236');
  bg.addColorStop(1, '#05040b');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const family = '"Arial Black", "Helvetica Neue", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let size = 400;
  g.font = `900 ${size}px ${family}`;
  const tw = g.measureText(s).width || 1;
  size = Math.min(size, (size * w * 0.86) / tw, h * 0.78);
  g.font = `900 ${size}px ${family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const gr = g.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2);
  gr.addColorStop(0, '#ffe08a');
  gr.addColorStop(0.5, '#ff6b6b');
  gr.addColorStop(1, '#a45bff');
  g.shadowColor = 'rgba(255,90,120,0.8)';
  g.shadowBlur = size * 0.12;
  g.fillStyle = gr;
  g.fillText(s, w / 2, h / 2 + size * 0.04);
  return c;
}

export const PRESETS = [
  { id: 'sunset', label: 'Sunset', draw: sunset },
  { id: 'spectrum', label: 'Spectrum', draw: spectrum },
  { id: 'orbs', label: 'Orbs', draw: orbs },
  { id: 'rings', label: 'Rings', draw: rings },
  { id: 'heart', label: 'Pixels', draw: heart },
  { id: 'text', label: 'Text', draw: text },
];

export function drawPreset(id, textValue) {
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  return p.draw(textValue);
}

/** Fits a canvas into a small square thumbnail (cover, or contain on a dark ground). */
export function thumbnail(src, size = 96, contain = false) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const s = (contain ? Math.min : Math.max)(size / src.width, size / src.height);
  const w = src.width * s, h = src.height * s;
  if (contain) {
    g.fillStyle = '#07060f';
    g.fillRect(0, 0, size, size);
  }
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

// ---- loading ------------------------------------------------------------------

/** Decodes an image file into a canvas no larger than maxDim (keeps memory bounded). */
export async function loadImageFile(file, maxDim = 2048) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = makeCanvas(w, h), g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Grid size for N cells along the long side of a w×h source. */
export function gridDims(N, w, h) {
  const a = Math.min(4, Math.max(0.25, w / h));
  return a >= 1 ? [N, Math.max(2, Math.round(N / a))] : [Math.max(2, Math.round(N * a)), N];
}

/** Box-filters any drawable down to W×H and returns its RGBA bytes. */
export class Sampler {
  constructor() {
    this.out = makeCanvas(1, 1);
    this.ctx = this.out.getContext('2d', { willReadFrequently: true });
    this.steps = [];
  }

  sample(src, sw, sh, W, H, mirror = false) {
    let cur = src, cw = sw, ch = sh, k = 0;
    // Halve repeatedly first: a single large downscale aliases in most browsers.
    while (cw >= W * 4 && ch >= H * 4) {
      const nw = Math.ceil(cw / 2), nh = Math.ceil(ch / 2);
      const c = this.steps[k] || (this.steps[k] = makeCanvas(1, 1));
      if (c.width !== nw || c.height !== nh) {
        c.width = nw;
        c.height = nh;
      }
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, nw, nh);
      g.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      cur = c;
      cw = nw;
      ch = nh;
      k++;
    }
    const o = this.out;
    if (o.width !== W || o.height !== H) {
      o.width = W;
      o.height = H;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    if (mirror) g.setTransform(-1, 0, 0, 1, W, 0);
    g.drawImage(cur, 0, 0, cw, ch, 0, 0, W, H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return g.getImageData(0, 0, W, H).data;
  }
}

export class Webcam {
  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    this.video = v;
    this.stream = null;
    this.facing = 'user';
  }

  static get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  get active() {
    return !!this.stream;
  }

  get ready() {
    return this.active && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start(facing = this.facing) {
    this.stop();
    this.facing = facing;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
  }

  stop() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }
}
