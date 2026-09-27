// Pointer-event gestures for the canvas (mouse, touch and pen share one path).
//   one pointer ........ orbit (or poke, in poke mode)
//   right/middle/shift . pan
//   two pointers ....... pinch to zoom + drag to pan
//   wheel / trackpad ... zoom
//   tap / double tap ... reported to the app (ripple / reset view)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function attachGestures(el, h) {
  const pts = new Map(); // pointerId -> { x, y }
  let mode = null;       // 'orbit' | 'pan' | 'poke' | 'multi'
  let base = null;       // two-pointer baseline
  let tap = null;        // tap candidate
  let lastTap = null;
  let vel = { yaw: 0, pitch: 0, t: 0 };
  const now = () => performance.now();

  const pair = () => {
    const [a, b] = pts.values();
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y) };
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      h.onStart?.();
      const mouse = e.pointerType === 'mouse';
      const poke = h.pokeMode?.();
      if (mouse && (e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey)) mode = 'pan';
      else if (mouse && e.button === 2) mode = poke ? 'orbit' : 'pan';
      else mode = poke ? 'poke' : 'orbit';
      tap = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId };
      vel = { yaw: 0, pitch: 0, t: now() };
      if (mode === 'poke') h.onPoke?.(e.clientX, e.clientY);
    } else {
      if (mode === 'poke') h.onPokeEnd?.();
      mode = 'multi';
      tap = null;
      base = pair();
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
    if (mode === 'orbit') {
      const k = Math.PI / Math.max(1, el.clientHeight);
      const dyaw = -dx * k, dpitch = dy * k;
      h.orbit(dyaw, dpitch);
      const t = now();
      const dt = Math.max(4, t - vel.t) / 1000;
      vel.yaw = vel.yaw * 0.6 + (dyaw / dt) * 0.4;
      vel.pitch = vel.pitch * 0.6 + (dpitch / dt) * 0.4;
      vel.t = t;
    } else if (mode === 'pan') {
      h.pan(dx, dy);
    } else if (mode === 'poke') {
      h.onPoke?.(e.clientX, e.clientY);
    } else if (mode === 'multi' && pts.size >= 2) {
      const cur = pair();
      h.zoom(base.d / Math.max(cur.d, 1));
      h.pan(cur.cx - base.cx, cur.cy - base.cy);
      base = cur;
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (mode === 'poke') h.onPokeEnd?.();
    const t = now();
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId && pts.size === 0 && t - tap.t < 350) {
      if (lastTap && t - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        h.onDoubleTap?.(e.clientX, e.clientY);
        lastTap = null;
      } else {
        h.onTap?.(e.clientX, e.clientY);
        lastTap = { t, x: e.clientX, y: e.clientY };
      }
    }
    tap = null;
    if (pts.size === 0) {
      const fling = mode === 'orbit' && t - vel.t < 60;
      h.onEnd?.(fling ? vel.yaw : 0, fling ? vel.pitch : 0);
      mode = null;
    } else if (pts.size === 1) {
      mode = 'orbit';
      vel = { yaw: 0, pitch: 0, t };
    } else {
      base = pair();
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const k = e.ctrlKey ? 0.01 : 0.0015; // trackpad pinch arrives as ctrl + wheel
    h.zoom(Math.exp(clamp(dy * k, -0.5, 0.5)));
  }, { passive: false });

  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
