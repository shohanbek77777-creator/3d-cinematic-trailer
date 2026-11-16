// Shared math helpers: easing, deterministic noise / RNG, monotone splines.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const ease = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Mulberry32 seeded PRNG. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  return f;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- value noise ----------
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm2(x, y, octaves = 4, seed = 0, lac = 2, gain = 0.5) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, y * f, seed + i * 17);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}
export function ridged2(x, y, octaves = 5, seed = 0) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f, seed + i * 31) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
/** Smooth 1D noise in [-1,1] for camera shake. */
export function noise1(x, seed = 0) {
  return noise2(x, seed * 13.37, seed) * 2 - 1;
}

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson).
 * Gives smooth velocity, natural acceleration / braking and never overshoots,
 * so a duplicated distance (a stop) produces zero speed.
 */
export class MonotoneCubic {
  constructor(xs, ys) {
    const n = xs.length;
    this.xs = xs;
    this.ys = ys;
    const m = new Array(n).fill(0);
    if (n > 1) {
      const d = [];
      for (let i = 0; i < n - 1; i++) {
        const dx = xs[i + 1] - xs[i];
        d.push(dx > 1e-9 ? (ys[i + 1] - ys[i]) / dx : 0);
      }
      m[0] = d[0];
      m[n - 1] = d[n - 2];
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0;
        else m[i] = (d[i - 1] + d[i]) / 2;
      }
      for (let i = 0; i < n - 1; i++) {
        if (Math.abs(d[i]) < 1e-9) {
          m[i] = 0;
          m[i + 1] = 0;
          continue;
        }
        const a = m[i] / d[i], b = m[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
    }
    this.m = m;
  }
  _seg(x) {
    const xs = this.xs;
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  value(x) {
    const { xs, ys, m } = this;
    const n = xs.length;
    if (n === 0) return 0;
    if (n === 1 || x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = this._seg(x);
    const h = xs[i + 1] - xs[i];
    if (h < 1e-9) return ys[i + 1];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  }
  derivative(x) {
    const { xs, ys, m } = this;
    const n = xs.length;
    if (n < 2 || x <= xs[0] || x >= xs[n - 1]) return 0;
    const i = this._seg(x);
    const h = xs[i + 1] - xs[i];
    if (h < 1e-9) return 0;
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    return ((6 * t2 - 6 * t) * ys[i]) / h + (3 * t2 - 4 * t + 1) * m[i] + ((-6 * t2 + 6 * t) * ys[i + 1]) / h + (3 * t2 - 2 * t) * m[i + 1];
  }
}

export function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function formatTime(t, fps = 30) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
