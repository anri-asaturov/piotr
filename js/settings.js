// Settings: defaults, validation and persistence (localStorage, best effort).

export const DEFAULTS = Object.freeze({
  // image
  preset: 'sunset',
  text: 'PIOTR',
  grid: 96,
  curve: 1,
  invert: false,
  terraces: 0,
  // shape
  shape: 'sphere',
  size: 0.9,
  sizeByLum: 0.35,
  depth: 0.3,
  scatter: 0,
  color: 'image',
  // motion
  playing: true,
  wave: 0.15,
  waveLen: 0.4,
  waveSpeed: 1,
  float: 0,
  spin: 0.6,
  sway: true,
  ripples: true,
  poke: false,
  // light
  lightAz: 125,
  lightEl: 40,
  shadows: true,
  ao: true,
  plate: true,
  bg: 'night',
  fov: 40,
  // engine
  res: 'auto',
  steps: 160,
  mode: 'neighbor',
  view: 'shaded',
});

export const ENUMS = {
  preset: ['sunset', 'spectrum', 'orbs', 'rings', 'heart', 'text'],
  shape: ['sphere', 'cube', 'pin', 'bar', 'diamond', 'ring'],
  color: ['image', 'clay', 'glow'],
  bg: ['night', 'studio', 'paper'],
  res: ['auto', 'low', 'medium', 'native', 'super'],
  mode: ['neighbor', 'naive'],
  view: ['shaded', 'steps', 'domains'],
};

const KEY = 'tessera.settings.v1';
const TRANSIENT = ['poke'];

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = saved[k];
    if (TRANSIENT.includes(k) || v === undefined || typeof v !== typeof DEFAULTS[k]) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
    s[k] = v;
  }
  return s;
}

let timer = 0;
export function saveSettings(s) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const out = { ...s };
      for (const k of TRANSIENT) delete out[k];
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* storage unavailable (private mode etc.) — settings just won't persist */
    }
  }, 300);
}
