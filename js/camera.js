// Orbit camera around the image. Distances and pan are stored relative to the
// scene size so the framing survives grid-resolution changes.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PITCH_LIMIT = 1.45;

export const HOME = Object.freeze({ yaw: 0.36, pitch: 0.18, zoom: 1, panX: 0, panY: 0 });

export class OrbitCamera {
  constructor() {
    Object.assign(this, HOME);
    this.vYaw = 0;       // inertia (rad/s)
    this.vPitch = 0;
    this.anim = null;    // { from, to, t, dur }
    this.swayT = 0;      // sway phase time
    this.swayEnv = 1;    // sway envelope (fades in after interaction)
    this.holding = false;
    this.moved = true;
  }

  orbit(dYaw, dPitch) {
    this.anim = null;
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.moved = true;
  }

  zoomBy(f) {
    this.anim = null;
    this.zoom = clamp(this.zoom * f, 0.08, 6);
    this.moved = true;
  }

  /** Pan by a fraction of the scene size, along the current screen axes. */
  pan(dx, dy) {
    this.anim = null;
    this.panX = clamp(this.panX + dx, -1, 1);
    this.panY = clamp(this.panY + dy, -1, 1);
    this.moved = true;
  }

  /** Called when a gesture starts: freeze sway into the pose so nothing jumps. */
  grab() {
    this.yaw += this.swayOffset();
    this.swayT = 0;
    this.swayEnv = 0;
    this.vYaw = this.vPitch = 0;
    this.holding = true;
    this.anim = null;
  }

  release(vYaw = 0, vPitch = 0) {
    this.holding = false;
    this.vYaw = clamp(vYaw, -6, 6);
    this.vPitch = clamp(vPitch, -6, 6);
  }

  reset(dur = 0.7) {
    this.yaw += this.swayOffset();
    this.swayT = 0;
    this.swayEnv = 0;
    // take the short way round
    const twoPi = Math.PI * 2;
    const yaw = this.yaw - twoPi * Math.round((this.yaw - HOME.yaw) / twoPi);
    this.anim = {
      from: { yaw, pitch: this.pitch, zoom: this.zoom, panX: this.panX, panY: this.panY },
      to: { ...HOME },
      t: 0,
      dur,
    };
    this.vYaw = this.vPitch = 0;
  }

  swayOffset() {
    return 0.38 * this.swayEnv * Math.sin(this.swayT * 0.32);
  }

  /** Advances inertia / animation / sway. Returns true if the view changed. */
  update(dt, sway) {
    let changed = this.moved;
    this.moved = false;
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      for (const k of ['yaw', 'pitch', 'zoom', 'panX', 'panY']) this[k] = a.from[k] + (a.to[k] - a.from[k]) * e;
      if (a.t >= 1) this.anim = null;
      changed = true;
    } else if (!this.holding && (this.vYaw !== 0 || this.vPitch !== 0)) {
      this.yaw += this.vYaw * dt;
      this.pitch = clamp(this.pitch + this.vPitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
      const f = Math.exp(-dt * 4.5);
      this.vYaw *= f;
      this.vPitch *= f;
      if (Math.abs(this.vYaw) < 0.01 && Math.abs(this.vPitch) < 0.01) this.vYaw = this.vPitch = 0;
      changed = true;
    }
    if (sway && !this.holding && !this.anim) {
      this.swayT += dt;
      this.swayEnv = Math.min(1, this.swayEnv + dt * 0.35);
      changed = true;
    }
    return changed;
  }

  /**
   * World-space pose. size: scene size (grid cells), fit: distance at zoom 1,
   * zMid: orbit-centre height, fov: vertical field of view (rad).
   */
  pose(size, fit, zMid, fov) {
    const yaw = this.yaw + this.swayOffset();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const back = [cp * sy, sp, cp * cy];
    const right = [cy, 0, -sy];
    const up = [-sy * sp, cp, -cy * sp];
    const tx = (this.panX * right[0] + this.panY * up[0]) * size;
    const ty = (this.panX * right[1] + this.panY * up[1]) * size;
    const tz = (this.panX * right[2] + this.panY * up[2]) * size + zMid;
    const dist = fit * this.zoom;
    const pos = [tx + back[0] * dist, ty + back[1] * dist, tz + back[2] * dist];
    const rot = new Float32Array([...right, ...up, ...back]);
    return { pos, rot, right, up, back, dist, tanFov: Math.tan(fov / 2) };
  }
}

/** Ray through a CSS-pixel position, for picking. shift: lens shift in uv units. */
export function screenRay(pose, x, y, w, h, shift = [0, 0]) {
  const u = ((2 * x - w) / h - shift[0]) * pose.tanFov;
  const v = ((h - 2 * y) / h - shift[1]) * pose.tanFov;
  const { right: r, up: p, back: b } = pose;
  const d = [r[0] * u + p[0] * v - b[0], r[1] * u + p[1] * v - b[1], r[2] * u + p[2] * v - b[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return { o: pose.pos, d: [d[0] / l, d[1] / l, d[2] / l] };
}
