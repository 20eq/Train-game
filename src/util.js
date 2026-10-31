'use strict';
/* ============================================================
   Bharat Rail Sim 3D — core utilities (fresh engine)
   Pure math + formatting + route-geometry queries. No DOM.
   ============================================================ */
const TAU = Math.PI * 2;
const KM = 1000;                 // metres per kilometre
const KMH = 3.6;                 // m/s -> km/h
const MPS = 1 / 3.6;             // km/h -> m/s
const G = 9.81;
const D2R = Math.PI / 180;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothT = (t) => t * t * (3 - 2 * t);
const invLerp = (a, b, x) => (a === b ? 0 : clamp((x - a) / (b - a), 0, 1));
const smoothstep = (a, b, x) => smoothT(invLerp(a, b, x));
const easeIO = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/* deterministic RNG + 1-D value noise (world jitter that must repeat) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function noise1D(seed) {
  const r = mulberry32(seed), tab = new Float32Array(512);
  for (let i = 0; i < 512; i++) tab[i] = r() * 2 - 1;
  return (x) => {
    const i = Math.floor(x), t = x - i, u = smoothT(t);
    return lerp(tab[i & 511], tab[(i + 1) & 511], u);
  };
}
function fbm(seed, octaves) {
  const n = noise1D(seed);
  return (x) => {
    let a = 1, f = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += n(x * f) * a; norm += a; a *= 0.5; f *= 2.03; }
    return sum / norm;
  };
}

/* ---------- formatting ---------- */
function fmtClock(t) {
  t = ((t % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + (s ? ':' + String(s).padStart(2, '0') : '');
}
function fmtDur(t) {
  t = Math.max(0, Math.round(t));
  const m = Math.floor(t / 60), s = t % 60;
  return m ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's';
}
function fmtDelay(dt) { return (dt <= 4 ? 'on time' : '+' + Math.round(dt / 6) / 10 + ' min late'); }
function fmtKm(m) { return (m / KM).toFixed(1) + ' km'; }

/* ---------- route geometry queries (route is plain data) ---------- */
function routeEnd(route) { return route.km * KM; }
function gradeAt(route, m) {
  /* routes.js stores gradients as rise-per-metre (e.g. 0.025 = 2.5%) */
  for (const g of route.gradients || []) if (m >= g[0] * KM && m <= g[1] * KM) return g[2];
  return 0;
}
function elevAt(route, m) {
  /* integrate gradients from 0 to m on top of elev0 */
  let e = route.elev0 || 0, lim = m / KM;
  for (const g of route.gradients || []) {
    if (g[0] >= lim) break;
    e += g[2] * (Math.min(g[1], lim) - g[0]);
  }
  return e;
}
function limitAt(route, m) {
  let v = route.stationLimit || 65;
  for (const L of route.limits || []) if (m >= L[0] * KM && m < L[1] * KM) { v = L[2]; break; }
  return v * MPS;
}
function inRanges(ranges, m) {
  for (const r of ranges) if (m >= r[0] * KM && m <= r[1] * KM) return true;
  return false;
}
function nextStopAhead(route, m, stopsSet) {
  for (const st of route.stations) if (st.km > m + 5 && stopsSet.has(st.n)) return st;
  return null;
}
function meetsOf(route, svc) { return (svc && svc.meets) || route.meets || []; }
function stationByName(route, n) { return (route.stations || []).find((s) => s.n === n) || null; }

/* ---------- helpers the data layer (js/data/routes.js) consumes ---------- */
function parseClock(s) { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; }
function estimateRun(d, v, vmax, a) {
  v = Math.min(v, vmax);
  const tAcc = v / a, dAcc = (v * v) / (2 * a);
  if (d <= dAcc * 1.6) { const vp = Math.sqrt(d * a); return (2 * vp) / a; }
  return tAcc + (d - dAcc) / v;
}
function buildElevation(gradList, elev0) {
  /* piecewise-linear elevation profile over km; returns elevAt(km) */
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
  return (km) => {
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
