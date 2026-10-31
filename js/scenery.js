'use strict';
/* ============================================================
   Bharat Rail Sim — procedural scenery generation
   ============================================================ */
const Scenery = {
  generate(route) {
    const th = THEMES[route.theme];
    const seed = hashStr(route.id);
    const rnd = mulberry32(seed);
    const items = [];
    const L = route.km;
    const push = (km, side, kind, o) => items.push(Object.assign({ km: km * KM, side, kind }, o));

    const treeKinds = th.trees || [];
    const treeTotal = treeKinds.reduce((a, t) => a + t.d, 0) || 1;
    // trees
    const treeDens = route.theme === 'konkan' ? 26 : route.theme === 'nilgiri' ? 30 : 15; // per km both sides
    for (let i = 0; i < L * treeDens; i++) {
      const km = rnd() * L, side = rnd() < 0.55 ? -1 : 1;
      let r = rnd() * treeTotal, k = treeKinds[0].k;
      for (const t of treeKinds) { r -= t.d; if (r <= 0) { k = t.k; break; } }
      if (this.nearStation(route, km, 0.12)) continue;
      push(km, side, 'tree', { k, s: 0.7 + rnd() * 0.8, tone: rnd() });
    }
    // buildings (behind track)
    const b = th.buildings || { d: 0.4, low: 0.8, mid: 0.2, high: 0, cols: ['#c9b8a8'] };
    const cityDens = b.d * 14;
    for (let i = 0; i < L * cityDens; i++) {
      const km = rnd() * L;
      if (this.nearStation(route, km, 0.25)) continue;
      const r = rnd();
      let h = 6 + rnd() * 5, kind = 'low';
      if (r > 1 - b.high) { kind = 'high'; h = 26 + rnd() * 30; }
      else if (r > 1 - b.high - b.mid) { kind = 'mid'; h = 12 + rnd() * 12; }
      else h = 4 + rnd() * 5;
      if (b.slums && rnd() < b.slums * 0.5) { kind = 'colony'; h = 3 + rnd() * 2; }
      push(km, -1, 'building', { k: kind, w: kind === 'colony' ? 14 + rnd() * 20 : 8 + rnd() * 12, h, col: b.cols[(rnd() * b.cols.length) | 0], tone: rnd(), laterite: !!b.laterite });
    }
    // far skyline (parallax layer)
    if (th.skyline) {
      for (let km = th.skyline.from; km < th.skyline.to; km += 0.04) {
        if (rnd() < 0.6) push(km, -1, 'skyline', { w: 30 + rnd() * 60, h: (20 + rnd() * 90) * th.skyline.h, col: rnd() });
      }
    }
    // paddy / sugarcane / tea fields
    if (th.paddy) for (let km = 0; km < L; km += 0.5 + rnd()) push(km + rnd() * 0.4, rnd() < 0.5 ? -1 : 1, 'paddy', { w: 60 + rnd() * 160, tone: rnd() });
    if (th.sugarcane) for (let km = 0; km < L; km += 1.2 + rnd()) push(km + rnd() * 0.8, rnd() < 0.5 ? -1 : 1, 'cane', { w: 80 + rnd() * 120, tone: rnd() });
    if (th.tea) for (let km = 0; km < L; km += 0.09) { push(km, -1, 'tea', { w: 30 + rnd() * 50, tone: rnd() }); if (rnd() < 0.4) push(km + 0.04, 1, 'tea', { w: 20 + rnd() * 40, tone: rnd() }); }
    // windmills
    if (th.windmills) for (let km = th.windmills.from; km < th.windmills.to; km += 0.7) { if (rnd() < th.windmills.d) push(km + rnd() * 0.5, -1, 'windmill', { h: 30 + rnd() * 16, phase: rnd() * 6.28 }); }
    // temples / monuments / forts / gopurams
    const extras = th.extras || [];
    for (let km = 2; km < L; km += 6 + rnd() * 9) {
      const e = extras[(rnd() * extras.length) | 0];
      if (e === 'temple' || e === 'gopuram') push(km, rnd() < 0.7 ? -1 : 1, e === 'gopuram' ? 'gopuram' : 'temple', { s: 0.8 + rnd() * 0.6, tone: rnd() });
      else if (e === 'monument' && rnd() < 0.35) push(km, -1, 'monument', { s: 0.8 + rnd() * 0.5 });
      else if (e === 'fort' && rnd() < 0.3) push(km, -1, 'fort', { s: 1 + rnd() });
      else if (e === 'crossing') { /* handled by gates */ }
      else if (rnd() < 0.4) push(km, rnd() < 0.6 ? -1 : 1, 'temple', { s: 0.7 + rnd() * 0.5, tone: rnd() });
    }
    // rocks & bushes near track
    for (let i = 0; i < L * 6; i++) push(rnd() * L, rnd() < 0.5 ? -1 : 1, rnd() < 0.3 ? 'rock' : 'bush', { s: 0.5 + rnd() * 0.9, tone: rnd() });
    // cows & dogs (near track, waiting)
    for (let i = 0; i < L / 4; i++) push(rnd() * L, 1, rnd() < 0.75 ? 'cow' : 'dog', { s: 0.8 + rnd() * 0.5, tone: rnd(), flip: rnd() < 0.5 });
    // distant hills authored bumps handled in draw via fbm; milestones etc in draw.
    items.sort((a, b2) => a.km - b2.km);
    return { items, th };
  },
  nearStation(route, km, pad) {
    for (const s of route.stations) if (Math.abs(km - s.km / KM) < 0.25 + pad) return true;
    return false;
  },
  /* range query on sorted items */
  range(sc, km0, km1) {
    const arr = sc.items;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].km < km0) lo = m + 1; else hi = m; }
    const out = [];
    for (let i = lo; i < arr.length && arr[i].km <= km1; i++) out.push(arr[i]);
    return out;
  },
};
