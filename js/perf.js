// Adaptive render resolution. The frame time is kept near the display refresh
// interval (never chasing more than 60 fps) by stepping the render pixel ratio
// (render pixels per CSS pixel) up and down.

export const LEVELS = [0.25, 0.33, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const FIXED = { low: 0.5, medium: 0.75, native: 1, super: 1.5 };

export class Perf {
  constructor(coarse) {
    this.mode = 'auto';
    this.level = LEVELS.indexOf(coarse ? 0.7 : 1);
    this.budget = 1000 / 60;
    this.avg = this.budget;
    this.lastChange = 0;
    this.blockUntil = LEVELS.map(() => 0);
    this.penalty = LEVELS.map(() => 4000);
    this.calib = [];
    this.calibrated = false;
    this.fps = 0;
    this.frames = 0;
    this.fpsT = 0;
    this.lastFrameAt = 0;
  }

  /** Feeds rAF deltas measured while nothing heavy is drawn (refresh-rate probe). */
  calibrate(dt) {
    if (this.calibrated) return true;
    if (dt > 2 && dt < 100) this.calib.push(dt);
    if (this.calib.length >= 16) {
      this.calib.sort((a, b) => a - b);
      const refresh = this.calib[this.calib.length >> 1];
      this.budget = Math.max(refresh, 1000 / 60);
      this.avg = this.budget;
      this.calibrated = true;
    }
    return this.calibrated;
  }

  cap(dpr) {
    return Math.min(2, Math.max(1.5, dpr));
  }

  ratio(dpr) {
    if (this.mode !== 'auto') return (FIXED[this.mode] || 1) * Math.min(dpr, 2);
    return Math.min(LEVELS[this.level], this.cap(dpr));
  }

  setMode(mode) {
    this.mode = mode;
    this.avg = this.budget;
  }

  /**
   * Records a rendered frame. dt: ms since the previous rendered frame (0 when
   * the previous rAF tick did not render). Returns true if the ratio changed.
   */
  frame(dt, t, dpr) {
    this.frames++;
    this.lastFrameAt = t;
    if (t - this.fpsT >= 500) {
      this.fps = (this.frames * 1000) / (t - this.fpsT);
      this.frames = 0;
      this.fpsT = t;
    }
    if (!(dt > 0) || dt > 250) return false;
    this.avg += (dt - this.avg) * 0.12;
    if (this.mode !== 'auto' || t - this.lastChange < 700) return false;

    let maxL = LEVELS.length - 1;
    while (maxL > 0 && LEVELS[maxL] > this.cap(dpr) + 1e-6) maxL--;
    if (this.level > maxL) return this.set(maxL, t);

    if (this.avg > this.budget * 1.2 && this.level > 0) {
      const target = LEVELS[this.level] * Math.sqrt(this.budget / this.avg);
      let nl = this.level - 1;
      while (nl > 0 && LEVELS[nl] > target) nl--;
      const from = this.level;
      this.blockUntil[from] = t + this.penalty[from];
      this.penalty[from] = Math.min(this.penalty[from] * 2, 60000);
      return this.set(nl, t);
    }
    if (this.avg < this.budget * 1.08 && this.level < maxL &&
        t - this.lastChange > 1500 && t >= this.blockUntil[this.level + 1]) {
      return this.set(this.level + 1, t);
    }
    return false;
  }

  set(level, t) {
    this.level = level;
    this.lastChange = t;
    this.avg = this.budget;
    return true;
  }
}
