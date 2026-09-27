// Tessera — real-time ray-marched image field.
// Wires renderer, cell field, camera, input and the hand-built UI together.

import { Renderer } from './renderer.js';
import { Field, SHAPES, BASE_Z, WINDOW_R, DEPTH_SCALE, SCATTER_SCALE } from './field.js';
import { OrbitCamera, screenRay, HOME } from './camera.js';
import { attachGestures } from './input.js';
import { Perf, LEVELS } from './perf.js';
import { PRESETS, drawPreset, thumbnail, loadImageFile, gridDims, Sampler, Webcam } from './images.js';
import * as UI from './ui.js';
import { DEFAULTS, loadSettings, saveSettings } from './settings.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const coarse = matchMedia('(pointer: coarse)').matches;

// Linear-space colours per backdrop.
const THEMES = {
  night: { top: [0.03, 0.04, 0.085], bottom: [0.003, 0.004, 0.01], plate: [0.02, 0.022, 0.03], sun: [1, 0.93, 0.84], sky: [0.34, 0.42, 0.62], exposure: 1.05 },
  studio: { top: [0.2, 0.21, 0.23], bottom: [0.05, 0.052, 0.058], plate: [0.1, 0.1, 0.105], sun: [1, 0.96, 0.9], sky: [0.5, 0.54, 0.62], exposure: 1 },
  paper: { top: [0.86, 0.82, 0.74], bottom: [0.56, 0.52, 0.46], plate: [0.62, 0.58, 0.52], sun: [1, 0.95, 0.88], sky: [0.7, 0.72, 0.78], exposure: 0.95 },
};
const VIEWS = { shaded: 0, steps: 1, domains: 2 };
const COLORS = { image: 0, clay: 1, glow: 2 };
const PLATE_MARGIN = 1.5;
const PLATE_THICK = 0.9;

const S = loadSettings();
const field = new Field();
const cam = new OrbitCamera();
const perf = new Perf(coarse);
perf.setMode(S.res);
const sampler = new Sampler();
const webcam = new Webcam();

let renderer = null;
let maxSize = 4096;
let source = null; // { el, w, h, mirror, kind: 'preset' | 'file' | 'camera' }
const dirty = { sample: true, field: true, colors: true, frame: true };
let animTime = 0;
let lastTick = performance.now();
let renderedPrev = false;
let pose = null;
let zMid = 0;
let poking = null;
let lastVideoTime = -1;
let lastSize = '';
let panel = null;
let picker = null;
let frameCount = 0;
const tools = {};

// ---- settings ---------------------------------------------------------------------

function set(key, value) {
  if (S[key] === value) return;
  S[key] = value;
  switch (key) {
    case 'preset':
    case 'text':
      loadPresetSource();
      if (key === 'text') refreshTextThumb();
      break;
    case 'grid':
      dirty.sample = true;
      break;
    case 'res':
      perf.setMode(value);
      break;
    case 'playing':
    case 'poke':
      syncTools();
      break;
  }
  dirty.field = true;
  dirty.frame = true;
  saveSettings(S);
  panel?.refresh();
}

function resetSettings() {
  for (const k of Object.keys(DEFAULTS)) S[k] = DEFAULTS[k];
  perf.setMode(S.res);
  if (source?.kind === 'preset') loadPresetSource();
  refreshTextThumb();
  dirty.sample = dirty.field = dirty.frame = true;
  saveSettings(S);
  syncTools();
  panel.refresh();
  cam.reset();
  UI.toast('Settings reset');
}

// ---- image sources -------------------------------------------------------------------

function useCanvas(c, kind) {
  source = { el: c, w: c.width, h: c.height, mirror: false, kind };
  dirty.sample = true;
}

function loadPresetSource() {
  stopCamera();
  useCanvas(drawPreset(S.preset, S.text), 'preset');
  panel?.refresh();
}

async function openFile(file) {
  if (!file) return;
  try {
    const c = await loadImageFile(file);
    stopCamera();
    useCanvas(c, 'file');
    panel?.refresh();
    UI.toast(file.name ? `Loaded ${file.name}` : 'Image loaded');
  } catch {
    UI.toast('Could not read that image');
  }
}

async function startCamera(facing) {
  try {
    await webcam.start(facing);
    source = { el: webcam.video, w: 0, h: 0, mirror: webcam.facing === 'user', kind: 'camera' };
    lastVideoTime = -1;
    dirty.sample = true;
  } catch (e) {
    UI.toast(e && e.name === 'NotAllowedError' ? 'Camera permission was denied' : 'No camera available');
    if (source?.kind === 'camera') loadPresetSource();
  }
  panel?.refresh();
}

function stopCamera() {
  if (webcam.active) webcam.stop();
}

function resample() {
  dirty.sample = false;
  if (!source) return;
  let { w, h } = source;
  if (source.kind === 'camera') {
    if (!webcam.ready) {
      dirty.sample = true;
      return;
    }
    w = webcam.video.videoWidth;
    h = webcam.video.videoHeight;
  }
  const [W, H] = gridDims(S.grid, w, h);
  field.setPixels(sampler.sample(source.el, w, h, W, H, source.mirror), W, H);
  dirty.field = dirty.colors = dirty.frame = true;
}

let thumbTimer = 0;
function refreshTextThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => picker?.setThumb('text', thumbnail(drawPreset('text', S.text), 96, true)), 250);
}

// ---- scene ----------------------------------------------------------------------------

function orbitCentre() {
  const size = field.size;
  return 0.5 * S.depth * DEPTH_SCALE * size + 0.25 * S.scatter * SCATTER_SCALE * size;
}

// The part of the screen not covered by the panel. The camera is lens-shifted so
// the image is centred (and fitted) in that area; changes are eased so opening or
// closing the panel glides the view instead of jumping.
const view = { sx: 0, sy: 0, fw: 1, fh: 1, ready: false };
let freeCx = '';

function freeArea() {
  const cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
  let x0 = 0, y0 = 0, x1 = cw, y1 = ch;
  const p = $('#panel');
  if (panel && !p.classList.contains('closed') && !document.body.classList.contains('bare')) {
    const r = p.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      if (r.width < cw * 0.7) x1 = Math.max(cw * 0.35, r.left - 8); // side panel
      else {
        y1 = Math.max(ch * 0.3, r.top); // bottom sheet
        y0 = Math.min(y1 * 0.3, $('#toolbar').getBoundingClientRect().bottom);
      }
    }
  }
  const cx = `${Math.round((x0 + x1) / 2)}px`;
  if (cx !== freeCx) {
    freeCx = cx;
    document.body.style.setProperty('--free-cx', cx);
    document.body.style.setProperty('--free-w', `${Math.round(x1 - x0)}px`);
  }
  return {
    sx: (x0 + x1 - cw) / ch,
    sy: (ch - y0 - y1) / ch,
    fw: (x1 - x0) / cw,
    fh: (y1 - y0) / ch,
  };
}

/** Eases the view towards the free area; returns true while it is moving. */
function updateView(dt) {
  const a = freeArea();
  if (!view.ready) {
    Object.assign(view, a, { ready: true });
    return true;
  }
  const k = 1 - Math.exp(-dt * 9);
  let moving = false;
  for (const key of ['sx', 'sy', 'fw', 'fh']) {
    const d = a[key] - view[key];
    if (Math.abs(d) > 1e-4) {
      view[key] += d * k;
      moving = true;
    } else view[key] = a[key];
  }
  return moving;
}

/**
 * Camera distance (at zoom 1) that fits the scene's bounding box into the free
 * area, seen from the home orientation (so orbiting never changes the zoom).
 * With the camera at target + back·d, a corner v (relative to the target) lands
 * at screen |x| / (d - v·back), which gives a closed-form minimum d per corner.
 */
function fitDistance(aspect, fov) {
  const t = Math.tan(fov / 2) * 0.93;
  const X = t * aspect * view.fw, Y = t * view.fh;
  const cp = Math.cos(HOME.pitch), sp = Math.sin(HOME.pitch);
  const cy = Math.cos(HOME.yaw), sy = Math.sin(HOME.yaw);
  const size = field.size;
  const m = S.plate ? PLATE_MARGIN : 0;
  const hx = field.W / 2 + m, hy = field.H / 2 + m;
  const zHi = (S.depth * DEPTH_SCALE + S.scatter * SCATTER_SCALE) * size + 0.5;
  const zLo = S.plate ? BASE_Z - PLATE_THICK : -0.5;
  let d = 0;
  for (const x of [-hx, hx]) {
    for (const y of [-hy, hy]) {
      for (const z of [zLo - zMid, zHi - zMid]) {
        const px = Math.abs(x * cy - z * sy);
        const py = Math.abs(-x * sy * sp + y * cp - z * cy * sp);
        const pb = x * cp * sy + y * sp + z * cp * cy;
        d = Math.max(d, Math.max(px / X, py / Y) + pb);
      }
    }
  }
  return d;
}

function frameUniforms(w, h) {
  const { W, H } = field;
  const fov = (S.fov * Math.PI) / 180;
  zMid = orbitCentre();
  pose = cam.pose(field.size, fitDistance(w / h, fov), zMid, fov);
  pose.shift = [view.sx, view.sy];
  const shape = SHAPES[S.shape] || SHAPES.sphere;
  const theme = THEMES[S.bg] || THEMES.night;
  const plate = S.plate;
  const hx = W / 2 + (plate ? PLATE_MARGIN : 0);
  const hy = H / 2 + (plate ? PLATE_MARGIN : 0);
  const zLo = Math.min(field.zMin, plate ? BASE_Z - PLATE_THICK : field.zMin);
  const zHi = Math.max(field.zMax, plate ? BASE_Z : field.zMax);
  const az = (S.lightAz * Math.PI) / 180, el = (S.lightEl * Math.PI) / 180;
  return {
    uRes: [w, h],
    uShift: pose.shift,
    uCamPos: pose.pos,
    uCamRot: pose.rot,
    uTanFov: pose.tanFov,
    uPixCone: (2 * pose.tanFov) / h,
    uTime: animTime,
    uGridMax: [W - 1, H - 1],
    uGridHalf: [(W - 1) / 2, (H - 1) / 2],
    uWin: field.R + 0.5,
    uZRange: [field.zMin, field.zMax],
    uBoxMin: [-hx - 0.02, -hy - 0.02, zLo - 0.02],
    uBoxMax: [hx + 0.02, hy + 0.02, zHi + 0.02],
    uShape: shape.id,
    uBaseZ: BASE_Z,
    uSpin: shape.spins && S.spin > 0 ? S.spin * 2.5 : 0,
    uMode: S.mode === 'naive' ? 1 : 0,
    uView: VIEWS[S.view] ?? 0,
    uMaxSteps: S.steps,
    uShadowSteps: S.shadows ? (coarse ? 32 : 48) : 0,
    uAO: S.ao ? 1 : 0,
    uPlateOn: plate ? 1 : 0,
    uPlate: [hx, hy, BASE_Z, PLATE_THICK],
    uPlateCol: theme.plate,
    uLightDir: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)],
    uSunCol: theme.sun,
    uSkyCol: theme.sky,
    uColorMode: COLORS[S.color] ?? 0,
    uBgTop: theme.top,
    uBgBottom: theme.bottom,
    uExposure: theme.exposure,
  };
}

function renderSize() {
  const dpr = window.devicePixelRatio || 1;
  const r = perf.ratio(dpr);
  const cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
  const w = cw * r, h = ch * r;
  const k = Math.min(1, maxSize / Math.max(w, h), Math.sqrt(12e6 / (w * h)));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), dpr];
}

/** Grid coordinates under a CSS-pixel position (plane through the orbit centre). */
function gridPointAt(x, y) {
  if (!pose || !field.n) return null;
  const r = canvas.getBoundingClientRect();
  const ray = screenRay(pose, x - r.left, y - r.top, r.width, r.height, pose.shift);
  if (Math.abs(ray.d[2]) < 1e-5) return null;
  const t = (zMid - ray.o[2]) / ray.d[2];
  if (!(t > 0)) return null;
  const gx = ray.o[0] + ray.d[0] * t + (field.W - 1) / 2;
  const gy = ray.o[1] + ray.d[1] * t + (field.H - 1) / 2;
  if (gx < -3 || gy < -3 || gx > field.W + 2 || gy > field.H + 2) return null;
  return [gx, gy];
}

// ---- frame loop -------------------------------------------------------------------------

function loop(now) {
  requestAnimationFrame(loop);
  const raw = now - lastTick;
  lastTick = now;
  if (!perf.calibrated) perf.calibrate(raw);
  if (!renderer || !renderer.ready || !perf.calibrated) {
    renderedPrev = false;
    return;
  }
  const dt = Math.min(raw, 100) / 1000;

  if (source?.kind === 'camera' && webcam.ready && webcam.video.currentTime !== lastVideoTime) {
    lastVideoTime = webcam.video.currentTime;
    dirty.sample = true;
  }
  if (dirty.sample) resample();
  if (!field.n) {
    renderedPrev = false;
    return;
  }

  if (S.playing) animTime += dt;
  if (poking) {
    const g = gridPointAt(poking.x, poking.y);
    if (g) field.poke(g[0], g[1]);
  }
  const relaxing = field.relax(dt);
  const rippling = field.stepRipples(now / 1000);
  const ambient = S.playing && (S.wave > 0 || S.float > 0);
  if (dirty.field || ambient || relaxing || rippling) {
    field.update(S, animTime);
    renderer.upload(field, dirty.colors);
    dirty.field = dirty.colors = false;
    dirty.frame = true;
  }
  const spinning = S.playing && S.spin > 0 && SHAPES[S.shape]?.spins;
  const moved = cam.update(dt, S.sway && S.playing) | updateView(dt);
  const [w, h, dpr] = renderSize();
  const sizeKey = `${w}x${h}`;
  if (sizeKey !== lastSize) {
    lastSize = sizeKey;
    dirty.frame = true;
  }
  if (!(dirty.frame || moved || spinning)) {
    renderedPrev = false;
    updateStats(now);
    return;
  }
  dirty.frame = false;
  renderer.resize(w, h);
  renderer.draw(frameUniforms(w, h));
  frameCount++;
  if (perf.frame(renderedPrev ? raw : 0, now, dpr)) dirty.frame = true;
  renderedPrev = true;
  updateStats(now);
}

let statsAt = 0;
function updateStats(now) {
  if (now - statsAt < 400) return;
  statsAt = now;
  const idle = now - perf.lastFrameAt > 700;
  $('#fps').textContent = idle ? 'idle' : `${Math.round(perf.fps)} fps`;
  $('#res').textContent = `${canvas.width}×${canvas.height} · ${field.W}×${field.H}`;
  if (panel && panel.current === 'engine' && !panel.collapsed) engineStats.refresh();
}

const engineStats = UI.Stats(() => [
  ['Grid', `${field.W} × ${field.H} = ${field.n.toLocaleString()} cells`],
  ['Render', `${canvas.width} × ${canvas.height} (${perf.ratio(window.devicePixelRatio || 1).toFixed(2)}× css px)`],
  ['Frame', `${perf.avg.toFixed(1)} ms · budget ${perf.budget.toFixed(1)} ms`],
  ['Window', `${2 * WINDOW_R + 1}×${2 * WINDOW_R + 1} cells`],
]);

// ---- screenshot / fullscreen / chrome ---------------------------------------------------

async function screenshot() {
  if (!renderer?.ready || !field.n) return;
  const w0 = canvas.width, h0 = canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let k = Math.min(
    Math.max(1, (canvas.clientWidth * dpr * 1.5) / w0),
    maxSize / Math.max(w0, h0),
    Math.sqrt(16e6 / (w0 * h0)),
  );
  if (perf.avg * k * k > 1500) k = Math.max(1, Math.sqrt(1500 / perf.avg));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  renderer.resize(w, h);
  renderer.draw(frameUniforms(w, h));
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  renderer.resize(w0, h0);
  dirty.frame = true;
  if (!blob) {
    UI.toast('Screenshot failed');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = UI.h('a', { href: url, download: `tessera-${Date.now()}.png` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  UI.toast(`Saved ${w}×${h} PNG`);
}

const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const el = d.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    req?.call(el)?.catch?.(() => {});
  }
}

function toggleUI() {
  document.body.classList.toggle('bare');
  syncTools();
}

function togglePanel() {
  const p = $('#panel');
  if (p.classList.contains('closed')) {
    p.classList.remove('closed');
    panel.setCollapsed(false);
  } else if (matchMedia('(max-width: 720px)').matches && panel.collapsed) {
    panel.setCollapsed(false);
  } else {
    p.classList.add('closed');
  }
  syncTools();
}

function syncTools() {
  const swap = (b, name) => b && b.replaceChild(UI.icon(name), b.firstChild);
  swap(tools.play, S.playing ? 'pause' : 'play');
  tools.play?.setAttribute('aria-label', S.playing ? 'Pause animation' : 'Play animation');
  tools.poke?.classList.toggle('on', S.poke);
  tools.poke?.setAttribute('aria-pressed', String(S.poke));
  const bare = document.body.classList.contains('bare');
  swap(tools.hide, bare ? 'eye' : 'eyeOff');
  tools.hide?.setAttribute('aria-label', bare ? 'Show interface' : 'Hide interface');
  tools.panel?.classList.toggle('on', !$('#panel').classList.contains('closed'));
  canvas.classList.toggle('poke', S.poke);
}

function buildToolbar() {
  const bar = $('#toolbar');
  const add = (key, label, ico, onClick) => {
    const b = UI.h('button', { class: `tool tool-${key}`, type: 'button', title: label, 'aria-label': label, onclick: onClick }, UI.icon(ico));
    bar.append(b);
    tools[key] = b;
  };
  add('panel', 'Settings', 'sliders', togglePanel);
  add('play', 'Pause animation', 'pause', () => set('playing', !S.playing));
  add('poke', 'Poke mode: drag to push pins', 'hand', () => set('poke', !S.poke));
  add('home', 'Reset view', 'home', () => cam.reset());
  add('snap', 'Save screenshot', 'snap', screenshot);
  if (fsSupported) add('fs', 'Fullscreen', 'expand', toggleFullscreen);
  add('hide', 'Hide interface', 'eyeOff', toggleUI);
}

function buildPanel() {
  const fileInput = $('#file');
  fileInput.addEventListener('change', () => {
    openFile(fileInput.files[0]);
    fileInput.value = '';
  });

  picker = UI.PresetPicker({
    presets: PRESETS.map((p) => ({ id: p.id, label: p.label, thumb: thumbnail(drawPreset(p.id, S.text), 96, p.id === 'text') })),
    get: () => (source?.kind === 'preset' ? S.preset : null),
    set: (id) => {
      S.preset = id;
      saveSettings(S);
      loadPresetSource();
    },
  });

  const num = (d) => (v) => v.toFixed(d);
  const pct = (v) => `${Math.round(v * 100)}%`;
  const deg = (v) => `${Math.round(v)}°`;
  const slider = (key, label, min, max, step, fmt, extra = {}) =>
    UI.Slider({ label, min, max, step, fmt, def: DEFAULTS[key], get: () => S[key], set: (v) => set(key, v), ...extra });
  const toggle = (key, label, extra = {}) => UI.Toggle({ label, get: () => S[key], set: (v) => set(key, v), ...extra });
  const seg = (key, label, options, extra = {}) => UI.Segmented({ label, options, get: () => S[key], set: (v) => set(key, v), ...extra });
  const spins = () => !!SHAPES[S.shape]?.spins;

  const tabs = [
    {
      id: 'image', label: 'Image', icon: 'image',
      items: [
        picker,
        UI.TextInput({ label: 'Text', get: () => S.text, set: (v) => set('text', v), when: () => S.preset === 'text' && source?.kind === 'preset', maxLength: 24 }),
        UI.Buttons([
          { label: 'Open image', icon: 'upload', onClick: () => fileInput.click() },
          { label: () => (webcam.active ? 'Stop camera' : 'Camera'), icon: 'camera', when: () => Webcam.supported, active: () => webcam.active,
            onClick: () => (webcam.active ? loadPresetSource() : startCamera()) },
          { label: 'Flip', icon: 'flip', when: () => webcam.active, onClick: () => startCamera(webcam.facing === 'user' ? 'environment' : 'user') },
        ]),
        UI.Note('Drop, paste or open any image. Each pixel becomes one shape.'),
        slider('grid', 'Resolution', 16, 192, 4, (v) => `${v} cells`),
        slider('curve', 'Depth curve', 0.3, 3, 0.05, num(2)),
        slider('terraces', 'Terraces', 0, 16, 1, (v) => (v ? `${v} levels` : 'off')),
        toggle('invert', 'Invert depth (dark comes forward)'),
      ],
    },
    {
      id: 'shape', label: 'Shape', icon: 'shapes',
      items: [
        seg('shape', null, Object.entries(SHAPES).map(([value, s]) => ({ value, label: s.label, icon: `shape-${value}` })), { cols: 3 }),
        slider('size', 'Size', 0.1, 1, 0.01, pct),
        slider('sizeByLum', 'Size from brightness', 0, 1, 0.01, pct),
        slider('depth', 'Depth', 0, 1, 0.01, pct),
        slider('scatter', 'Scatter', 0, 1, 0.01, pct),
        seg('color', 'Colour', [
          { value: 'image', label: 'Image' },
          { value: 'clay', label: 'Clay' },
          { value: 'glow', label: 'Glow' },
        ]),
      ],
    },
    {
      id: 'motion', label: 'Motion', icon: 'wave',
      items: [
        toggle('playing', 'Animate'),
        slider('wave', 'Wave', 0, 1, 0.01, pct),
        slider('waveLen', 'Wave length', 0.05, 1, 0.01, num(2), { when: () => S.wave > 0 }),
        slider('waveSpeed', 'Wave speed', 0, 3, 0.05, num(2), { when: () => S.wave > 0 }),
        slider('float', 'Float', 0, 1, 0.01, pct),
        slider('spin', 'Spin', 0, 1, 0.01, pct, { when: spins }),
        UI.Note('Spin applies to cubes, diamonds and rings.', { when: () => !spins() }),
        toggle('sway', 'Camera sway'),
        toggle('ripples', 'Tap ripples'),
        toggle('poke', 'Poke mode (drag pushes the pins)'),
      ],
    },
    {
      id: 'light', label: 'Light', icon: 'sun',
      items: [
        slider('lightAz', 'Light direction', 0, 360, 1, deg),
        slider('lightEl', 'Light height', 5, 90, 1, deg),
        toggle('shadows', 'Soft shadows'),
        toggle('ao', 'Ambient occlusion'),
        toggle('plate', 'Back plate'),
        seg('bg', 'Backdrop', [
          { value: 'night', label: 'Night' },
          { value: 'studio', label: 'Studio' },
          { value: 'paper', label: 'Paper' },
        ]),
        slider('fov', 'Field of view', 15, 90, 1, deg),
      ],
    },
    {
      id: 'engine', label: 'Engine', icon: 'chip',
      items: [
        seg('res', 'Render scale', [
          { value: 'auto', label: 'Auto' },
          { value: 'low', label: '50%' },
          { value: 'medium', label: '75%' },
          { value: 'native', label: '100%' },
          { value: 'super', label: '150%' },
        ]),
        slider('steps', 'Max ray steps', 32, 320, 8, (v) => `${v}`),
        seg('mode', 'Domain repetition', [
          { value: 'neighbor', label: 'Neighbour-aware' },
          { value: 'naive', label: 'Naive' },
        ]),
        UI.Note(() => (S.mode === 'naive'
          ? 'Naive: each step only sees the cell the ray is in, so it steps straight through taller neighbours. Look for bitten, missing and smeared shapes.'
          : `Neighbour-aware: each step checks the 2×2 nearest cells and limits the step with a distance bound for every other cell (window heights over ${2 * WINDOW_R + 1}×${2 * WINDOW_R + 1} cells), so rays never tunnel into a neighbouring domain.`)),
        seg('view', 'View', [
          { value: 'shaded', label: 'Shaded' },
          { value: 'steps', label: 'Step cost' },
          { value: 'domains', label: 'Domains' },
        ]),
        engineStats,
        UI.Buttons([{ label: 'Reset settings', icon: 'undo', onClick: resetSettings }]),
      ],
    },
  ];

  let initial = 'image';
  try { initial = localStorage.getItem('tessera.tab') || initial; } catch { /* ignore */ }
  panel = new UI.Panel($('#panel'), tabs, initial);
  if (coarse && matchMedia('(max-width: 720px)').matches) panel.setCollapsed(true);
}

// ---- input --------------------------------------------------------------------------------

function hideHint() {
  $('#hint').classList.remove('show');
}

function wireInput() {
  attachGestures(canvas, {
    pokeMode: () => S.poke,
    onStart: () => {
      cam.grab();
      hideHint();
    },
    onEnd: (vy, vp) => cam.release(vy, vp),
    orbit: (a, b) => cam.orbit(a, b),
    pan: (dx, dy) => {
      if (!pose) return;
      const wpp = (2 * pose.dist * pose.tanFov) / Math.max(1, canvas.clientHeight);
      cam.pan((-dx * wpp) / field.size, (dy * wpp) / field.size);
    },
    zoom: (f) => cam.zoomBy(f),
    onTap: (x, y) => {
      if (!S.ripples || S.poke) return;
      const g = gridPointAt(x, y);
      if (g) field.addRipple(g[0], g[1], performance.now() / 1000);
    },
    onDoubleTap: () => cam.reset(),
    onPoke: (x, y) => {
      poking = { x, y };
    },
    onPokeEnd: () => {
      poking = null;
    },
  });

  document.addEventListener('gesturestart', (e) => e.preventDefault());

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const k = e.key;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest('input, textarea, select, [contenteditable]')) return;
    // Space / Enter / arrows belong to a focused control (button, slider, tab…).
    if (t?.closest('button, a, [role="slider"], [role="switch"], [role="tab"]') &&
        (k === ' ' || k === 'Enter' || k.startsWith('Arrow'))) return;
    const shapes = Object.keys(SHAPES);
    if (k === ' ') set('playing', !S.playing);
    else if (k === 'r' || k === 'R') cam.reset();
    else if (k === 'h' || k === 'H') toggleUI();
    else if (k === 'f' || k === 'F') fsSupported && toggleFullscreen();
    else if (k === 's' || k === 'S') screenshot();
    else if (k === 'o' || k === 'O') $('#file').click();
    else if (k === 'p' || k === 'P') set('poke', !S.poke);
    else if (k === 'n' || k === 'N') set('mode', S.mode === 'naive' ? 'neighbor' : 'naive');
    else if (k >= '1' && k <= String(shapes.length)) set('shape', shapes[+k - 1]);
    else if (k === 'ArrowLeft') cam.orbit(0.08, 0);
    else if (k === 'ArrowRight') cam.orbit(-0.08, 0);
    else if (k === 'ArrowUp') cam.orbit(0, 0.06);
    else if (k === 'ArrowDown') cam.orbit(0, -0.06);
    else if (k === '+' || k === '=') cam.zoomBy(0.9);
    else if (k === '-' || k === '_') cam.zoomBy(1.1);
    else return;
    e.preventDefault();
  });

  const drop = $('#drop');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    drop.classList.add('show');
  });
  addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      drop.classList.remove('show');
    }
  });
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove('show');
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) openFile(f);
  });
  addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) openFile(item.getAsFile());
  });
}

// ---- boot ---------------------------------------------------------------------------------

function overlay(title, detail, error = false) {
  const o = $('#overlay');
  o.hidden = false;
  o.classList.toggle('error', error);
  o.querySelector('.title').textContent = title;
  o.querySelector('.detail').textContent = detail || '';
}

async function start() {
  buildToolbar();
  buildPanel();
  wireInput();
  syncTools();
  requestAnimationFrame(loop);

  try {
    renderer = new Renderer(canvas);
  } catch {
    overlay('WebGL 2 is not available',
      'This app ray-marches every pixel on the GPU and needs WebGL 2. Try a current Chrome, Edge, Firefox or Safari (iOS 15+), and check that hardware acceleration is enabled.', true);
    return;
  }
  renderer.onRestored = () => {
    dirty.field = dirty.colors = dirty.frame = true;
  };
  try {
    await renderer.init();
  } catch (e) {
    overlay('Could not compile the shader', String(e && e.message ? e.message : e), true);
    console.error(e);
    return;
  }
  const gl = renderer.gl;
  maxSize = Math.min(...gl.getParameter(gl.MAX_VIEWPORT_DIMS), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 8192);
  loadPresetSource();
  $('#overlay').hidden = true;

  const hint = $('#hint');
  hint.textContent = coarse
    ? 'Drag to orbit · Pinch to zoom · Two fingers to pan · Tap for ripples · Double-tap to reset'
    : 'Drag to orbit · Scroll to zoom · Right-drag to pan · Click for ripples · Double-click to reset';
  hint.classList.add('show');
  setTimeout(hideHint, 7000);
}

// Expose a tiny handle for debugging from the console.
window.tessera = {
  S, set, cam, field, perf, LEVELS,
  get renderer() { return renderer; },
  get frames() { return frameCount; },
  _uniforms: () => frameUniforms(canvas.width, canvas.height),
};

start();
