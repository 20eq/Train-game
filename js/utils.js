'use strict';
/* ============================================================
   Bharat Rail Sim — utilities
   ============================================================ */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothT = (t) => t * t * (3 - 2 * t);
const invLerp = (a, b, x) => (a === b ? 0 : clamp((x - a) / (b - a), 0, 1));
const smoothstep = (a, b, x) => smoothT(invLerp(a, b, x));
const KMH = 3.6;          // m/s -> km/h
const MPS = 1 / 3.6;      // km/h -> m/s
const KM = 1000;          // m per km
const G = 9.81;

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* 1-D value noise, -1..1, seeded */
function makeNoise1D(seed) {
  const rnd = mulberry32(seed);
  const N = 512, tab = new Float32Array(N);
  for (let i = 0; i < N; i++) tab[i] = rnd() * 2 - 1;
  return function (x) {
    const xi = Math.floor(x), t = x - xi;
    const a = tab[((xi % N) + N) % N], b = tab[(((xi + 1) % N) + N) % N];
    return lerp(a, b, smoothT(t));
  };
}
function fbm1D(seed, octaves) {
  const fns = [];
  for (let o = 0; o < octaves; o++) fns.push({ n: makeNoise1D(seed + o * 7919), s: Math.pow(2, o) });
  return function (x) {
    let v = 0, amp = 1, tot = 0;
    for (const f of fns) { v += f.n(x * f.s) * amp; tot += amp; amp *= 0.5; }
    return v / tot;
  };
}

/* ---------- time formatting (seconds since midnight) ---------- */
function fmtClock(t, withSec) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return withSec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}
function fmtDur(t) {
  t = Math.max(0, Math.round(t));
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
function fmtDelay(t) {
  const late = Math.round(t);
  if (late <= 30) return 'On Time';
  return `+${fmtDur(late)} late`;
}
function fmtKm(m) { return (m / KM).toFixed(1) + ' km'; }
function inRanges(ranges, m) { for (const r of ranges) if (m >= r[0] * KM && m <= r[1] * KM) return true; return false; }

/* Parse "HH:MM" -> seconds */
function parseClock(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
}

/* ---------- colour helpers ---------- */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
function shade(hex, f) { // f<0 darken, f>0 lighten
  const [r, g, b] = hexToRgb(hex);
  if (f >= 0) return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`;
  return `rgb(${Math.round(r * (1 + f))},${Math.round(g * (1 + f))},${Math.round(b * (1 + f))})`;
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------- geometric lookups over piecewise data ---------- */
/* grad: [[fromKm, toKm, gradeAsFraction], ...] e.g. 0.027 == 1 in 37 */
function gradeAt(grads, km) {
  for (const g of grads) if (km >= g[0] && km <= g[1]) return g[2];
  return 0;
}
function limitAt(limits, km) {
  let v = limits[0] ? limits[0][2] : 100;
  for (const l of limits) if (km >= l[0] && km <= l[1]) return l[2];
  return v;
}
/* cumulative elevation (m) at km, given grads (km, grade fraction) */
function buildElevation(gradList, elev0) {
  const pts = [];
  let elev = elev0 || 0;
  const list = gradList || [];
  let lastKm = list.length ? list[0][0] : 0;
  pts.push([lastKm, elev]);
  for (const g of list) {
    if (g[0] > lastKm) { lastKm = g[0]; pts.push([lastKm, elev]); }
    elev += (g[1] - g[0]) * g[2] * 1000;
    lastKm = g[1];
    pts.push([lastKm, elev]);
  }
  return function elevAt(km) {
    if (km <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (km <= pts[i][0]) {
        const [k0, e0] = pts[i - 1], [k1, e1] = pts[i];
        return lerp(e0, e1, k1 === k0 ? 0 : (km - k0) / (k1 - k0));
      }
    }
    return pts[pts.length - 1][1];
  };
}

/* estimate run time (s) over distance d (m) cruising at v (m/s), max speed vmax, accel a */
function estimateRun(d, v, vmax, a) {
  v = Math.min(v, vmax);
  const tAcc = v / a, dAcc = v * v / (2 * a);
  if (d <= dAcc * 1.6) { // triangular-ish
    const vp = Math.sqrt(d * a);
    return 2 * vp / a;
  }
  return tAcc + (d - dAcc) / v;
}

/* binary search: largest index with arr[i].km <= km  (arr sorted by km, item.km in metres) */
function idxForKm(arr, km) {
  let lo = 0, hi = arr.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].km <= km) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

/* human crowd colours */
const KURTA = ['#e8d9b5', '#c96f4a', '#7da3c0', '#d9c26b', '#9c7bb0', '#cfd4d8', '#e0b34d', '#6f9e86'];
const SARI = ['#d94f6b', '#e08a3c', '#3f9e5f', '#4a6fd1', '#c23a7a', '#e4c94f'];
