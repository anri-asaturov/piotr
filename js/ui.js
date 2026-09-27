// Hand-built UI components: no framework, just DOM + pointer events.
// Every control returns { el, refresh } and reads/writes through get/set.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---- icons (24×24, stroke) ----------------------------------------------------
const P = {
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  shapes: '<circle cx="8.5" cy="8.5" r="5"/><rect x="11.5" y="11.5" width="9" height="9" rx="1.8"/>',
  wave: '<path d="M2 12c2.2-5.5 4.8-5.5 7 0s4.8 5.5 7 0 3.6-3.4 6-1.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  camera: '<path d="M4 8h3l1.8-2.6h6.4L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>',
  flip: '<path d="M4.5 10A8 8 0 0 1 18.3 7M19.5 14A8 8 0 0 1 5.7 17"/><path d="M19 3.5V7.5h-4M5 20.5v-4h4"/>',
  play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.2" y="4.8" width="4" height="14.4" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.8" y="4.8" width="4" height="14.4" rx="1.2" fill="currentColor" stroke="none"/>',
  home: '<path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2"/><path d="M3.5 4v5h5"/>',
  snap: '<path d="M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5"/><circle cx="12" cy="12" r="3.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  hand: '<path d="M8 13V5.8a1.5 1.5 0 0 1 3 0V11.5M11 11V4.3a1.5 1.5 0 0 1 3 0V11M14 11V5.8a1.5 1.5 0 0 1 3 0v6M17 9.8a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.4a6 6 0 0 1-4.9-2.6L4.3 13.8a1.6 1.6 0 0 1 2.6-1.9L8 13.4"/>',
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  'shape-sphere': '<circle cx="12" cy="12" r="7.5"/><path d="M8.3 10.2a4.2 4.2 0 0 1 3.4-3.3" />',
  'shape-cube': '<path d="M12 3.2l7.8 4.4v8.8L12 20.8l-7.8-4.4V7.6z"/><path d="M4.2 7.6L12 12l7.8-4.4M12 12v8.8"/>',
  'shape-pin': '<circle cx="12" cy="7.5" r="4.2"/><path d="M12 11.7v9.3"/>',
  'shape-bar': '<rect x="3.5" y="12" width="4.2" height="8.5" rx="1"/><rect x="9.9" y="4.5" width="4.2" height="16" rx="1"/><rect x="16.3" y="8.5" width="4.2" height="12" rx="1"/>',
  'shape-diamond': '<path d="M12 3l8 9-8 9-8-9z"/><path d="M4 12h16"/>',
  'shape-ring': '<circle cx="12" cy="12" r="7.8"/><circle cx="12" cy="12" r="3.6"/>',
};

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

const withWhen = (ctl, when) => {
  if (!when) return ctl;
  const refresh = ctl.refresh;
  ctl.refresh = () => {
    const show = !!when();
    ctl.el.hidden = !show;
    if (show) refresh?.();
  };
  return ctl;
};

// ---- slider ---------------------------------------------------------------------
export function Slider({ label, min, max, step = 0.01, get, set, fmt = (v) => v.toFixed(2), def, when }) {
  const out = h('output', { class: 'val' });
  const fill = h('span', { class: 'fill' });
  const track = h('div', {
    class: 'track', role: 'slider', tabindex: '0', 'aria-label': label,
    'aria-valuemin': min, 'aria-valuemax': max,
  }, h('span', { class: 'rail' }, fill), h('span', { class: 'thumb' }));
  const head = h('div', { class: 'row', title: def !== undefined ? 'Double-click to reset' : null }, h('label', {}, label), out);
  const el = h('div', { class: 'ctl slider' }, head, track);
  const decimals = (String(step).split('.')[1] || '').length;
  const snap = (v) => clamp(+(Math.round((v - min) / step) * step + min).toFixed(decimals), min, max);

  const show = (v) => {
    el.style.setProperty('--p', ((v - min) / (max - min)).toFixed(4));
    out.textContent = fmt(v);
    track.setAttribute('aria-valuenow', v);
    track.setAttribute('aria-valuetext', fmt(v));
  };
  const commit = (v) => {
    v = snap(v);
    if (v !== get()) set(v);
    show(get());
  };
  const fromX = (x) => {
    const r = track.getBoundingClientRect();
    return min + (max - min) * clamp((x - r.left) / Math.max(1, r.width), 0, 1);
  };

  // Mouse/pen: act immediately. Touch: wait for a horizontal move (so vertical
  // swipes still scroll the panel), or treat a clean tap as a jump.
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, live: e.pointerType !== 'touch' };
    try { track.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (drag.live) {
      e.preventDefault();
      el.classList.add('active');
      commit(fromX(e.clientX));
    }
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.live && Math.abs(e.clientX - drag.x) > 5 && Math.abs(e.clientX - drag.x) > Math.abs(e.clientY - drag.y)) {
      drag.live = true;
      el.classList.add('active');
    }
    if (drag.live) commit(fromX(e.clientX));
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.live && e.type === 'pointerup' && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) commit(fromX(e.clientX));
    drag = null;
    el.classList.remove('active');
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    const big = Math.max(step, (max - min) / 10);
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    if (d !== undefined) commit(get() + d);
    else if (e.key === 'Home') commit(min);
    else if (e.key === 'End') commit(max);
    else return;
    e.preventDefault();
  });
  if (def !== undefined) head.addEventListener('dblclick', () => commit(def));
  return withWhen({ el, refresh: () => show(get()) }, when);
}

// ---- toggle -----------------------------------------------------------------------
export function Toggle({ label, get, set, when }) {
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': label }, h('span', { class: 'knob' }));
  const el = h('div', { class: 'ctl toggle' }, h('span', { class: 'lbl' }, label), sw);
  const refresh = () => {
    const on = !!get();
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
  };
  el.addEventListener('click', () => {
    set(!get());
    refresh();
  });
  return withWhen({ el, refresh }, when);
}

// ---- segmented control -------------------------------------------------------------
export function Segmented({ label, options, get, set, when, cols }) {
  const btns = options.map((o) =>
    h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', title: o.title || o.label,
      onclick: () => {
        set(o.value);
        refresh();
      },
    }, o.icon ? icon(o.icon) : null, o.label ? h('span', {}, o.label) : null));
  const seg = h('div', { class: 'seg' + (cols ? ' grid' : ''), role: 'radiogroup', 'aria-label': label || null }, btns);
  if (cols) seg.style.setProperty('--cols', cols);
  const el = h('div', { class: 'ctl' }, label ? h('div', { class: 'row' }, h('label', {}, label)) : null, seg);
  const refresh = () => {
    const v = get();
    options.forEach((o, i) => {
      const on = o.value === v;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-checked', String(on));
    });
  };
  return withWhen({ el, refresh }, when);
}

// ---- buttons ------------------------------------------------------------------------
export function Buttons(items, { when } = {}) {
  const made = items.map((it) => {
    const txt = h('span', {});
    const b = h('button', { class: 'btn', type: 'button', onclick: it.onClick }, it.icon ? icon(it.icon) : null, txt);
    return { it, b, txt };
  });
  const el = h('div', { class: 'ctl btns' }, made.map((m) => m.b));
  const refresh = () => {
    for (const { it, b, txt } of made) {
      txt.textContent = typeof it.label === 'function' ? it.label() : it.label;
      b.hidden = it.when ? !it.when() : false;
      b.classList.toggle('on', !!it.active?.());
    }
  };
  return withWhen({ el, refresh }, when);
}

// ---- text input ---------------------------------------------------------------------
export function TextInput({ label, get, set, when, maxLength = 32 }) {
  const input = h('input', {
    type: 'text', class: 'text', maxlength: maxLength, spellcheck: 'false', autocomplete: 'off',
    'aria-label': label, enterkeyhint: 'done',
  });
  input.addEventListener('input', () => set(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  const el = h('div', { class: 'ctl' }, h('div', { class: 'row' }, h('label', {}, label)), input);
  const refresh = () => {
    if (document.activeElement !== input) input.value = get();
  };
  return withWhen({ el, refresh }, when);
}

// ---- preset picker ------------------------------------------------------------------
export function PresetPicker({ presets, get, set }) {
  const items = presets.map((p) => {
    const b = h('button', { class: 'preset', type: 'button', title: p.label, onclick: () => set(p.id) },
      p.thumb, h('span', {}, p.label));
    return { p, b };
  });
  const el = h('div', { class: 'ctl presets' }, items.map((i) => i.b));
  const refresh = () => {
    const v = get();
    for (const { p, b } of items) b.classList.toggle('on', p.id === v);
  };
  const setThumb = (id, canvas) => {
    const it = items.find((i) => i.p.id === id);
    if (it) it.b.replaceChild(canvas, it.b.firstChild);
  };
  return { el, refresh, setThumb };
}

// ---- static bits ----------------------------------------------------------------------
export function Note(content, { when } = {}) {
  const el = h('p', { class: 'note' });
  const refresh = () => {
    el.textContent = typeof content === 'function' ? content() : content;
  };
  return withWhen({ el, refresh }, when);
}

export function Stats(lines) {
  const el = h('dl', { class: 'stats' });
  const refresh = () => {
    el.replaceChildren(...lines().flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  };
  return { el, refresh };
}

// ---- panel with tabs ------------------------------------------------------------------
export class Panel {
  constructor(root, tabs, initial) {
    this.root = root;
    this.controls = [];
    this.tabBtns = new Map();
    this.pages = new Map();
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    const pages = h('div', { class: 'pages' });
    for (const t of tabs) {
      const btn = h('button', {
        class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `page-${t.id}`,
        onclick: () => this.select(t.id, true),
      }, icon(t.icon), h('span', {}, t.label));
      const page = h('section', { class: 'page', role: 'tabpanel', id: `page-${t.id}`, 'aria-labelledby': `tab-${t.id}` },
        t.items.map((c) => c.el));
      this.controls.push(...t.items);
      this.tabBtns.set(t.id, btn);
      this.pages.set(t.id, page);
      bar.append(btn);
      pages.append(page);
    }
    const grip = h('div', { class: 'grip', 'aria-hidden': 'true' });
    root.append(grip, bar, pages);
    grip.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.select(this.pages.has(initial) ? initial : tabs[0].id, false);
    this.refresh();
  }

  get collapsed() {
    return this.root.classList.contains('collapsed');
  }

  setCollapsed(v) {
    this.root.classList.toggle('collapsed', v);
  }

  select(id, user) {
    if (user && id === this.current && !this.collapsed) {
      // tapping the active tab folds the sheet on phones
      if (matchMedia('(max-width: 720px)').matches) this.setCollapsed(true);
      return;
    }
    this.current = id;
    this.setCollapsed(false);
    for (const [k, b] of this.tabBtns) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    for (const [k, p] of this.pages) p.hidden = k !== id;
    try { localStorage.setItem('tessera.tab', id); } catch { /* ignore */ }
  }

  refresh() {
    for (const c of this.controls) c.refresh?.();
  }
}

// ---- toast ------------------------------------------------------------------------------
let toastTimer = 0;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  document.getElementById('hint')?.classList.remove('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
