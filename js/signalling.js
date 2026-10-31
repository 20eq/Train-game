'use strict';
/* ============================================================
   Bharat Rail Sim — signalling (IR-style 4-aspect colour lights)
   Aspects: R (stop) · Y (caution 45) · YY (attention 75) · G (clear)
   ============================================================ */
const ASPECT = { R: { name: 'STOP', speed: 0 }, Y: { name: 'CAUTION', speed: 45 * MPS }, YY: { name: 'ATTENTION', speed: 75 * MPS }, G: { name: 'CLEAR', speed: Infinity } };

const Signals = {
  /* Build signal list for a route (player direction) */
  build(route) {
    const S = [];
    const inStation = (km, pad) => route.stations.some((st) => km > st.km - 550 - pad && km < st.km + st.plat + 350 + pad);
    let autoN = 1;
    if (route.block > 0) {
      for (let km = 800; km < route.km * KM - 400; km += route.block) {
        if (inStation(km, 250)) continue;
        S.push({ km, kind: 'auto', name: String(autoN++).padStart(2, '0') });
      }
    }
    for (const st of route.stations) {
      if (st.km > 500) S.push({ km: st.km - 380, kind: 'home', name: st.n.split(' ')[0].slice(0, 5) });
      if (!st.term && st.km + st.plat + 80 < route.km * KM - 100)
        S.push({ km: st.km + st.plat + 80, kind: 'starter', name: st.n.split(' ')[0].slice(0, 4) });
    }
    S.sort((a, b) => a.km - b.km);
    // blocks: block i is [S[i].km, S[i+1].km)
    S.forEach((s, i) => { s.idx = i; s.blockEnd = S[i + 1] ? S[i + 1].km : route.km * KM; });
    return S;
  },

  /* occupancy: set of block indices occupied by same-track trains */
  blockOf(signals, km) {
    // last signal whose km <= km
    let lo = 0, hi = signals.length - 1, res = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (signals[m].km <= km) { res = m; lo = m + 1; } else hi = m - 1; }
    return res;
  },

  /* Compute aspect for signal idx given occupied blocks (sorted array) */
  aspectFor(signals, idx, occ) {
    if (idx < 0 || idx >= signals.length) return 'G';
    if (!occ || !occ.length) return 'G';
    // which blocks ahead of this signal are occupied?
    const ahead = [];
    for (const b of occ) { if (b >= idx) ahead.push(b); }
    if (!ahead.length) return 'G';
    const nearest = ahead[0];
    const d = nearest - idx; // 0 = train inside this signal's own block -> still DANGER
    if (d <= 1) return 'R';
    if (d === 2) return 'Y';
    if (d === 3) return 'YY';
    return 'G';
  },

  /* find next signal ahead of km */
  nextAhead(signals, km) {
    for (let i = 0; i < signals.length; i++) if (signals[i].km > km + 0.5) return signals[i];
    return null;
  },
  signalBefore(signals, km) {
    let res = null;
    for (const s of signals) { if (s.km <= km + 0.5) res = s; else break; }
    return res;
  },
};

/* ============================================================
   Level crossings
   ============================================================ */
const Gates = {
  build(route) {
    return (route.crossings || []).map((km, i) => ({
      km: km * KM, id: i + 1, closed: 0, bell: 0, warned: false,
    }));
  },
  update(gates, trains, dt, snd) {
    for (const g of gates) {
      let near = 1e9, passed = 1e9;
      for (const t of trains) {
        const d = (g.km - t.head) * t.dir;
        if (d > 0) near = Math.min(near, d); else passed = Math.min(passed, -d);
      }
      const shouldClose = near < 900 || (g.closed && passed < 250);
      if (shouldClose && !g.closed) { g.closed = 1; g.bell = 1; if (snd) Snd.aiHorn('emu', 0.3); }
      if (!shouldClose && g.closed && passed > 250) { g.closed = 0; g.bell = 0; }
      if (g.closed && passed > 250 && near > 900) { g.closed = 0; }
    }
  },
};
