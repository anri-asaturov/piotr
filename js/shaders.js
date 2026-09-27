// GLSL sources. The entire renderer is one fullscreen triangle and this
// fragment shader: no vertex buffers, no framebuffers, one draw call per frame.

export const VERT = /* glsl */ `#version 300 es
void main() {
  // Fullscreen triangle generated from gl_VertexID (0,1,2) — no attributes.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

// ---- frame / camera ---------------------------------------------------------
uniform vec2  uRes;        // drawing-buffer size in pixels
uniform vec2  uShift;      // lens shift: optical centre offset (in uv units)
uniform vec3  uCamPos;     // camera position (world units = grid cells)
uniform mat3  uCamRot;     // columns: right, up, back
uniform float uTanFov;     // tan(fov / 2)
uniform float uPixCone;    // size of one pixel at distance 1
uniform float uTime;

// ---- cell field -------------------------------------------------------------
// uCells  RGBA32F, one texel per cell:
//   x  height of the shape centre (towards the viewer)
//   y  shape size (0 = empty cell)
//   z  max shape top    over the (2R+1)^2 window around the cell
//   w  min shape bottom over the same window
// uColors RGBA8, one texel per cell: sRGB colour of the source pixel.
uniform sampler2D uCells;
uniform sampler2D uColors;
uniform vec2  uGridMax;    // (W - 1, H - 1)
uniform vec2  uGridHalf;   // ((W - 1) / 2, (H - 1) / 2): world -> grid offset
uniform float uWin;        // window radius R + 0.5
uniform vec2  uZRange;     // global (min bottom, max top) of all shapes
uniform vec3  uBoxMin;     // ray clipping box
uniform vec3  uBoxMax;

// ---- shape ------------------------------------------------------------------
uniform int   uShape;      // 0 sphere, 1 cube, 2 pin, 3 bar, 4 diamond, 5 ring
uniform float uBaseZ;      // root height of pins / bars (top of the back plate)
uniform float uSpin;       // spin speed in rad/s (0 = off)

// ---- look / options ---------------------------------------------------------
uniform int   uMode;       // 0 = neighbour-aware repetition, 1 = naive repetition
uniform int   uView;       // 0 shaded, 1 step heat map, 2 domains
uniform int   uMaxSteps;
uniform int   uShadowSteps;// 0 = shadows off
uniform int   uAO;         // 0 / 1
uniform int   uPlateOn;    // 0 / 1
uniform vec4  uPlate;      // (half size x, half size y, top z, thickness)
uniform vec3  uPlateCol;
uniform vec3  uLightDir;
uniform vec3  uSunCol;
uniform vec3  uSkyCol;
uniform int   uColorMode;  // 0 image, 1 clay, 2 glow
uniform vec3  uBgTop;
uniform vec3  uBgBottom;
uniform float uExposure;

out vec4 outColor;

const int   MAX_STEPS  = 320;
const int   MAX_SHADOW = 64;
const float BIG        = 1e9;

// Integer hash (Hoskins), stable on every GLSL ES 3.00 implementation.
float hash12(vec2 p) {
  uvec2 q = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}

// ---- primitives (centred at the origin, +z towards the viewer) --------------
float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Pin: spherical head at the origin on a thin shaft down to zb.
float sdPin(vec3 q, float zb, float r) {
  float head = length(q) - r;
  vec3 s = vec3(q.xy, q.z - clamp(q.z, zb, 0.0));
  return min(head, length(s) - max(0.22 * r, 0.035));
}

// Bar: square column from zb up to 0 (top face at the origin).
float sdBar(vec3 q, float zb, float r) {
  float hz = -0.5 * zb;
  return sdRoundBox(q - vec3(0.0, 0.0, 0.5 * zb), vec3(r, r, hz), min(0.12, 0.3 * r));
}

float sdOcta(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

// Ring lying in the image plane (facing the viewer).
float sdRing(vec3 p, float R, float r) {
  vec2 q = vec2(length(p.xy) - R, p.z);
  return length(q) - r;
}

float shapeDist(vec3 q, float r, float zb) {
  if (uShape == 0) return length(q) - r;
  if (uShape == 1) return sdRoundBox(q, vec3(r), 0.25 * r);
  if (uShape == 2) return sdPin(q, zb, r);
  if (uShape == 3) return sdBar(q, zb, r);
  if (uShape == 4) return sdOcta(q, r);
  return sdRing(q, 0.66 * r, 0.34 * r);
}

// Distance from grid-space point g to the shape living in cell cid.
// The shape (at any spin angle) always stays inside its own cell column
// |x - cid.x| <= 0.5, |y - cid.y| <= 0.5 — the CPU side guarantees that.
float cellDist(vec3 g, vec2 cid, vec4 c) {
  vec3 q = vec3(g.xy - cid, g.z - c.x);
  if (uSpin != 0.0) {
    float a = uTime * uSpin + 6.2831853 * hash12(cid);
    float s = sin(a), k = cos(a);
    q.xz = vec2(k * q.x - s * q.z, s * q.x + k * q.z);
  }
  return shapeDist(q, c.y, uBaseZ - c.x);
}

float sdPlate(vec3 p) {
  float h = 0.5 * uPlate.w;
  return sdRoundBox(p - vec3(0.0, 0.0, uPlate.z - h), vec3(uPlate.xy, h), min(0.35, h));
}

// ---- scene distance -----------------------------------------------------------
// Returns
//   x: exact distance to the geometry that was evaluated (+ back plate)
//   y: a step size that is safe with respect to *every* cell of the grid
// id: the cell that produced x (-1 = back plate, -2 = nothing).
//
// Neighbour-aware domain repetition: instead of evaluating only the cell that
// contains p (naive repetition, which breaks as soon as neighbouring cells
// differ), we evaluate the 2x2 block of cells closest to p. Every other cell is
// at least a1 = 0.5 + min(|q.x|, |q.y|) away in the image plane, and its shape
// lies between the window min bottom / max top stored for the centre cell; cells
// beyond the (2R+1)^2 window are at least a2 = R + 0.5 - max(|q.x|, |q.y|) away
// and inside the global z range. The step is clamped by those bounds, so the
// ray can never tunnel into a neighbouring domain it did not look at.
vec2 map(vec3 p, out ivec2 id) {
  vec3 g = vec3(p.xy + uGridHalf, p.z);                 // grid space
  vec2 c0 = clamp(floor(g.xy + 0.5), vec2(0.0), uGridMax);
  vec2 q = g.xy - c0;
  vec4 d0 = texelFetch(uCells, ivec2(c0), 0);
  float dn = BIG;
  float ds;
  id = ivec2(-2);

  if (uMode == 1) {
    // Naive repetition: only the domain containing p. Kept for comparison.
    dn = cellDist(g, c0, d0);
    id = ivec2(c0);
    ds = dn;
  } else {
    vec2 o = sign(q);
    for (int k = 0; k < 4; k++) {
      vec2 cid = c0 + vec2(float(k & 1), float(k >> 1)) * o;
      if (any(lessThan(cid, vec2(0.0))) || any(greaterThan(cid, uGridMax))) continue;
      vec4 cd = k == 0 ? d0 : texelFetch(uCells, ivec2(cid), 0);
      if (cd.y <= 0.0) continue;
      float d = cellDist(g, cid, cd);
      if (d < dn) { dn = d; id = ivec2(cid); }
    }
    vec2 aq = abs(q);
    float a1 = 0.5 + min(aq.x, aq.y);
    float a2 = max(uWin - max(aq.x, aq.y), 0.0);
    float zr = max(max(g.z - d0.z, d0.w - g.z), 0.0);
    float zg = max(max(g.z - uZRange.y, uZRange.x - g.z), 0.0);
    ds = min(dn, min(length(vec2(a1, zr)), length(vec2(a2, zg))));
  }

  if (uPlateOn == 1) {
    float dp = sdPlate(p);
    if (dp < dn) { dn = dp; id = ivec2(-1); }
    ds = min(ds, dp);
  }
  return vec2(dn, ds);
}

vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv;
  vec3 t1 = (uBoxMax - ro) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

float march(vec3 ro, vec3 rd, float tmin, float tmax, out ivec2 id, out int steps) {
  float t = tmin;
  id = ivec2(-2);
  steps = 0;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uMaxSteps || t > tmax) break;
    steps = i + 1;
    ivec2 cid;
    vec2 d = map(ro + rd * t, cid);
    if (d.x < max(0.5 * uPixCone * t, 1e-3)) { id = cid; return t; }
    t += d.y;
  }
  return -1.0;
}

vec3 calcNormal(vec3 p, ivec2 id, float t) {
  float e = max(0.5 * uPixCone * t, 1.5e-3);
  const vec2 k = vec2(1.0, -1.0);
  if (id.x < 0) {
    return normalize(k.xyy * sdPlate(p + k.xyy * e) + k.yyx * sdPlate(p + k.yyx * e) +
                     k.yxy * sdPlate(p + k.yxy * e) + k.xxx * sdPlate(p + k.xxx * e));
  }
  vec2 cid = vec2(id);
  vec4 c = texelFetch(uCells, id, 0);
  vec3 g = vec3(p.xy + uGridHalf, p.z);
  return normalize(k.xyy * cellDist(g + k.xyy * e, cid, c) + k.yyx * cellDist(g + k.yyx * e, cid, c) +
                   k.yxy * cellDist(g + k.yxy * e, cid, c) + k.xxx * cellDist(g + k.xxx * e, cid, c));
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  ivec2 id;
  for (int i = 0; i < 4; i++) {
    float h = 0.05 + 0.3 * float(i);
    float d = map(p + n * h, id).x;
    occ += (h - min(d, h)) * sca;
    sca *= 0.75;
  }
  return clamp(1.0 - 0.9 * occ, 0.0, 1.0);
}

int gShadowSteps = 0;   // profiling only (uView 3)

float calcShadow(vec3 ro, vec3 rd) {
  float tmax = boxHit(ro, rd).y;
  float res = 1.0;
  float t = 0.04;
  ivec2 id;
  for (int i = 0; i < MAX_SHADOW; i++) {
    if (i >= uShadowSteps || t > tmax) break;
    gShadowSteps = i + 1;
    vec2 d = map(ro + rd * t, id);
    res = min(res, 8.0 * d.x / t);
    if (res < 0.003) break;
    t += clamp(d.y, 0.03, 4.0);
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

vec3 background(vec2 uv) {
  float v = clamp(0.5 + 0.5 * uv.y, 0.0, 1.0);
  vec3 c = mix(uBgBottom, uBgTop, v * v * (3.0 - 2.0 * v));
  vec2 w = uv * vec2(0.6, 0.85);
  return c * (1.08 - 0.3 * dot(w, w));
}

vec3 shade(vec3 ro, vec3 rd, float t, ivec2 id) {
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p, id, t);

  vec3 alb;
  vec3 emi = vec3(0.0);
  float ks = 0.55, shin = 56.0;
  if (id.x < 0) {
    alb = uPlateCol;
    ks = 0.18; shin = 18.0;
    if (uView == 2) {
      // show the cell boundaries (domain borders) on the plate
      vec2 f = abs(fract(p.xy + uGridHalf + 0.5) - 0.5);
      alb = mix(alb, vec3(0.45, 0.5, 0.6), 1.0 - smoothstep(0.02, 0.05, 0.5 - max(f.x, f.y)));
    }
  } else {
    vec3 src = texelFetch(uColors, id, 0).rgb;
    vec3 lin = pow(src, vec3(2.2));
    if (uView == 2) {
      alb = 0.5 + 0.45 * cos(6.2831853 * (hash12(vec2(id)) + vec3(0.0, 0.33, 0.67)));
      alb *= alb;
    } else if (uColorMode == 1) {
      alb = vec3(0.6);
      ks = 0.3; shin = 24.0;
    } else if (uColorMode == 2) {
      alb = lin * 0.12;
      emi = lin * 2.4;
      ks = 0.9; shin = 90.0;
    } else {
      alb = lin;
    }
  }

  vec3 L = uLightDir;
  float ndl = dot(n, L);
  float sha = 1.0;
  if (ndl > 0.0 && uShadowSteps > 0) sha = calcShadow(p + n * 0.02, L);
  float occ = uAO == 1 ? calcAO(p, n) : 1.0;

  float dif = clamp(ndl, 0.0, 1.0) * sha;
  vec3  hv  = normalize(L - rd);
  float nv  = clamp(dot(n, -rd), 0.0, 1.0);
  float fre = pow(1.0 - nv, 5.0);
  float spe = pow(clamp(dot(n, hv), 0.0, 1.0), shin) * dif * (0.04 + 0.96 * fre) * ks * (shin + 8.0) / 25.0;
  float sky = clamp(0.6 + 0.4 * dot(n, normalize(vec3(0.0, 0.55, 1.0))), 0.0, 1.0);
  float bnc = clamp(0.5 - 0.5 * ndl, 0.0, 1.0);

  vec3 lig = uSunCol * dif * 2.1
           + uSkyCol * sky * occ * 0.75
           + uSunCol * bnc * occ * 0.08;
  vec3 col = alb * lig + emi * (0.4 + 0.6 * occ) + uSunCol * spe;
  col += uSkyCol * fre * occ * 0.18;
  return col;
}

// Turbo colour map (polynomial approximation by A. Mikhailov, Google).
vec3 turbo(float x) {
  const vec4 kr4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kg4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kb4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kr2 = vec2(-152.94239396, 59.28637943);
  const vec2 kg2 = vec2(4.27729857, 2.82956604);
  const vec2 kb2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kr4) + dot(v2, kr2), dot(v4, kg4) + dot(v2, kg2), dot(v4, kb4) + dot(v2, kb2));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  vec3 rd = normalize(uCamRot * vec3((uv - uShift) * uTanFov, -1.0));
  rd = mix(rd, vec3(1e-7), lessThan(abs(rd), vec3(1e-7)));   // no zero components for 1/rd
  vec3 ro = uCamPos;

  vec3 col = background(uv);
  int steps = 0;
  vec2 tb = boxHit(ro, rd);
  if (tb.x < tb.y && tb.y > 0.0) {
    ivec2 id;
    float t = march(ro, rd, max(tb.x, 0.0), tb.y, id, steps);
    if (t > 0.0) col = shade(ro, rd, t, id);
  }

  if (uView == 1) {
    float s = float(steps) / float(uMaxSteps);
    outColor = vec4(steps == 0 ? vec3(0.02, 0.02, 0.04) : turbo(s), 1.0);
    return;
  }
  if (uView == 3) {  // raw step counts, for profiling
    outColor = vec4(float(steps) / 255.0, float(gShadowSteps) / 255.0, 0.0, 1.0);
    return;
  }

  col = aces(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;   // dither against banding
  outColor = vec4(col, 1.0);
}
`;
