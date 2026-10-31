'use strict';
/* ============================================================
   Bharat Rail Sim 3D — world geometry (pure math, no THREE)
   A "route" becomes a 3D region: winding horizontal alignment,
   terrain heightfield, scatter placement, structures.
   ============================================================ */
const World3D = {
  DS: 6,            // path sample spacing (m)
  CORRIDOR: 55,     // terrain blend half-width around track (m)
  TRACK_GAUGE_VIS: 2.6,

  /* Build the sampled path for a route.
     x = along-line (m), z = lateral offset (curvature), y = elevation.
     Curvature: smooth fbm, gentle (|dz/ds| < 0.12), scaled by route length. */
  buildPath(route) {
    const N = Math.floor(route.km * KM / this.DS) + 2;
    const n = fbm1D(hashStr(route.id + 'curve'), 3);
    const amp = Math.min(240, 90 + route.km * 1.1); // lateral amplitude
    const xs = new Float32Array(N), ys = new Float32Array(N), zs = new Float32Array(N);
    // integrate dz/ds = k * n(x), with k tapering to 0 near terminals
    let z = 0;
    const L = route.km * KM;
    for (let i = 0; i < N; i++) {
      const x = i * this.DS;
      // flatten curvature within 500 m of any station centre (platforms straight)
      let flat = 1;
      for (const st of route.stations) {
        const d = Math.abs(x - (st.km + st.plat / 2));
        if (d < 700) { flat = Math.min(flat, d / 700); }
      }
      const slope = n(x / 950) * 0.085 * flat;
      z += slope * this.DS;
      z = clamp(z, -amp, amp);
      xs[i] = x; ys[i] = route.elevAt(x / KM); zs[i] = z;
    }
    // tangents (unit, in xz-plane + dy)
    const tx = new Float32Array(N), ty = new Float32Array(N), tz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      let dx = xs[b] - xs[a], dy = ys[b] - ys[a], dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dy, dz) || 1;
      tx[i] = dx / l; ty[i] = dy / l; tz[i] = dz / l;
    }
    return { xs, ys, zs, tx, ty, tz, N, L, ds: this.DS };
  },

  /* fractional index lookup along the path (path x is uniform) */
  idxOf(path, m) { return clamp(m / this.DS, 0, path.N - 1); },

  /* position + orientation at metres-along m, optionally offset laterally by `lat` (m, right-hand side looking along +x) */
  posAt(path, m, lat) {
    const f = this.idxOf(path, m);
    const i = Math.min(path.N - 2, Math.floor(f)), t = f - i;
    const x = lerp(path.xs[i], path.xs[i + 1], t);
    const y = lerp(path.ys[i], path.ys[i + 1], t);
    const z = lerp(path.zs[i], path.zs[i + 1], t);
    const tx = lerp(path.tx[i], path.tx[i + 1], t), ty = lerp(path.ty[i], path.ty[i + 1], t), tz = lerp(path.tz[i], path.tz[i + 1], t);
    const tl = Math.hypot(tx, ty, tz) || 1;
    // right vector = tangent × up
    const rx = -tz / tl, ry = 0, rz = tx / tl;
    const o = lat || 0;
    return { x: x + rx * o, y: y + ry * o, z: z + rz * o, tx: tx / tl, ty: ty / tl, tz: tz / tl, rx, rz, yaw: Math.atan2(-tz / tl, tx / tl) };
  },

  /* Terrain height. Track corridor is graded flat to track level;
     beyond that, fbm hills per theme; sea/river cuts below water. */
  makeTerrainFn(route, path) {
    const th = THEMES[route.theme];
    const seaSide = th.seaSide === 'left' ? -1 : 1;
    const hasSea = th.sea !== undefined;
    const seaA = (th.seaFrom !== undefined ? th.seaFrom * KM : -1e12) - 900;
    const seaB = (th.seaTo !== undefined ? th.seaTo * KM : 1e12) + 900;
    const nH = fbm1D(hashStr(route.id + 'terr'), 4);
    const amp = (th.hills ? th.hills.amp : 34) * 1.4;
    const river = th.river;
    const rivA = river ? river.from * KM - 700 : 0, rivB = river ? river.to * KM + 700 : 0;
    const lakes = th.lake || [];
    return function (x, z) {
      const base = nH(x / 480, 0) * amp + nH(x / 90, 9) * 3;
      // distance to track corridor: nearest sample (path x is uniform: use x directly, lateral via |z - zc|)
      const f = clamp(x / World3D.DS, 0, path.N - 1);
      const i = Math.floor(f);
      const zc = lerp(path.zs[i], path.zs[Math.min(path.N - 1, i + 1)], f - i);
      const yc = lerp(path.ys[i], path.ys[Math.min(path.N - 1, i + 1)], f - i);
      const d = Math.abs(z - zc);
      let h;
      if (d < World3D.CORRIDOR) {
        h = lerp(yc - 0.9, base, smoothstep(World3D.CORRIDOR * 0.45, World3D.CORRIDOR, d));
      } else {
        h = base;
        // hills rise away from the line
        h += smoothstep(World3D.CORRIDOR, 500, d) * amp * 0.9 * (0.5 + 0.5 * nH(x / 300 + 40, 5));
      }
      // sea cut (only along the coastal stretch; never inside the graded corridor)
      const corrMask = smoothstep(World3D.CORRIDOR * 0.55, World3D.CORRIDOR * 1.5, d);
      if (hasSea && x > seaA && x < seaB && corrMask > 0.01) {
        const feather = Math.min(1, smoothstep(seaA, seaA + 900, x) * (1 - smoothstep(seaB - 900, seaB, x))) * corrMask;
        const shore = zc + seaSide * (th.seaDist || 190);
        const dz = (z - shore) * seaSide;
        if (dz < 0) h = Math.min(h, lerp(h, -6 + 22 * Math.exp(dz / 60) - 4, feather));
        else h = lerp(h, -3, Math.exp(-dz / 40) * feather);
      }
      if (river && x > rivA && x < rivB && corrMask > 0.01) {
        const feather = Math.min(1, smoothstep(rivA, rivA + 600, x) * (1 - smoothstep(rivB - 600, rivB, x))) * corrMask;
        const dzr = Math.abs(z - (zc + river.side * 150));
        if (dzr < 90) h = Math.min(h, lerp(h, lerp(-4, h, smoothstep(30, 90, dzr)), feather));
      }
      for (const lk of lakes) {
        const mid = (lk[0] + lk[1]) * 0.5 * KM;
        if (Math.abs(x - mid) < (lk[1] - lk[0]) * 0.5 * KM) h = Math.min(h, lerp(-3, h, smoothstep(60, 170, Math.abs(z - zc - 170))));
      }
      return h;
    };
  },

  /* Scatter + structures (pure data; renderer builds meshes) */
  scatter(route, path) {
    const rnd = mulberry32(hashStr(route.id + 'sc3d'));
    const th = THEMES[route.theme];
    const L = path.L;
    const terrain = this.makeTerrainFn(route, path);
    const out = { trees: [], buildings: [], poles: [], portals: [], piers: [], gates: [], rocks: [] };
    const isNearTrack = (x, z, margin) => {
      const i = clamp(Math.round(x / this.DS), 0, path.N - 1);
      return Math.abs(z - path.zs[i]) < margin;
    };
    // trees
    const kinds = th.trees || [{ k: 'shrub', d: 1 }];
    const tot = kinds.reduce((a, k) => a + k.d, 0);
    const dens = route.theme === 'konkan' ? 55 : route.theme === 'nilgiri' ? 70 : 34;
    for (let i = 0; i < L / KM * dens; i++) {
      const x = rnd() * L;
      const side = rnd() < 0.5 ? -1 : 1;
      const z = path.zs[Math.round(x / this.DS)] + side * (60 + rnd() * rnd() * 900);
      if (isNearTrack(x, z, 42)) continue;
      let r = rnd() * tot, k = kinds[0].k;
      for (const kk of kinds) { r -= kk.d; if (r <= 0) { k = kk.k; break; } }
      out.trees.push({ x, z, y: terrain(x, z), k, s: 0.7 + rnd() * 0.9 });
    }
    // buildings: near stations + skyline ranges
    const b = th.buildings || { d: 0.4, cols: ['#c9b8a8'] };
    const put = (x, big) => {
      const side = rnd() < 0.6 ? -1 : 1;
      const z = path.zs[Math.round(x / this.DS)] + side * (70 + rnd() * 160);
      if (isNearTrack(x, z, 55)) return;
      const r = rnd();
      let h = 5 + rnd() * 6;
      if (big && r > 0.7) h = 18 + rnd() * 40;
      out.buildings.push({ x, z, y: terrain(x, z), w: 9 + rnd() * 12, h, d: 9 + rnd() * 12, col: b.cols[(rnd() * b.cols.length) | 0], tone: rnd() });
    };
    for (const st of route.stations) {
      const n = st.term ? 26 : 6 + (rnd() * 10 | 0);
      for (let i = 0; i < n; i++) put(st.km + (rnd() - 0.2) * 900, st.term);
    }
    if (th.skyline) for (let i = 0; i < 90; i++) put(lerp(th.skyline.from, th.skyline.to, rnd()) * KM, true);
    // catenary poles
    if (route.electrified) for (let x = 30; x < L; x += 52) out.poles.push({ x, z: path.zs[Math.round(x / this.DS)] + 3.2, y: path.ys[Math.round(x / this.DS)] });
    // tunnel portals + depth info
    for (const tu of route.tunnels || []) {
      out.portals.push({ x: tu[0] * KM, dir: 1 }, { x: tu[1] * KM, dir: -1 });
    }
    // viaduct piers every 22 m where deck > terrain + 4
    for (const vi of route.viaducts || []) {
      for (let x = vi[0] * KM; x <= vi[1] * KM; x += 22) {
        const i = clamp(Math.round(x / this.DS), 0, path.N - 1);
        const g = terrain(x, path.zs[i]);
        if (path.ys[i] > g + 3) out.piers.push({ x, z: path.zs[i], yTop: path.ys[i], yBot: g });
      }
    }
    // level crossings
    for (const c of route.crossings || []) out.gates.push({ x: c * KM, z: path.zs[Math.round(c * KM / this.DS)] });
    return out;
  },

  /* car pose along path for a train whose head is at s (m), travelling dir */
  carPose(path, def, s, dir, carIdx) {
    let acc = 0;
    for (let i = 0; i < carIdx; i++) acc += def.cars[i].len + 0.7;
    const centre = s - dir * (acc + def.cars[carIdx].len / 2);
    return this.posAt(path, centre, 0);
  },

  /* camera basis at a path point */
  lookAtFrom(p, dist, height) {
    return { x: p.x - p.tx * dist + p.rx * 0, y: p.y + height, z: p.z - p.tz * dist };
  },
};
