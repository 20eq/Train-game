'use strict';
/* ============================================================
   Bharat Rail Sim 3D — world builder (fresh engine)
   Builds the drivable 3D alignment from route data: real station
   lat/lon anchors (when GEO applied), curvature eased to real-rail
   minima, elevation from gradients, procedural terrain that keeps
   the rail corridor graded, and structure layout (platforms,
   loops, viaduct piers, tunnel portals, catenary poles...).
   Pure math — no DOM, no THREE. x = metres along, z = lateral.
   ============================================================ */
const WB = {
  DS: 6,

  /* ---------- alignment ---------- */
  buildPath(route) {
    const DS = this.DS, L = routeEnd(route), N = Math.floor(L / DS) + 1;
    const zs = new Float32Array(N), ys = new Float32Array(N);
    const sts = route.stations;
    const geo = sts.length > 1 && sts[0].lat != null && sts[1].lat != null;
    let sideFn;
    if (geo) {
      const lat0 = sts[0].lat, lon0 = sts[0].lon, cl0 = Math.cos(lat0 * D2R);
      const E = 111320 * cl0, Nn = 110540;
      const pts = sts.map((st) => ({ km: st.km, e: (st.lon - lon0) * E, n: (st.lat - lat0) * Nn })); /* st.km is already metres */
      const bearing = Math.atan2(pts[pts.length - 1].e, pts[pts.length - 1].n);
      const cb = Math.cos(bearing), sb = Math.sin(bearing);
      const anchors = pts.map((p) => ({ km: p.km, side: p.e * cb - p.n * sb }));
      sideFn = (m) => {
        if (m <= anchors[0].km) return anchors[0].side;
        for (let i = 1; i < anchors.length; i++) {
          if (m <= anchors[i].km) {
            const t = easeIO(invLerp(anchors[i - 1].km, anchors[i].km, m));
            return lerp(anchors[i - 1].side, anchors[i].side, t);
          }
        }
        return anchors[anchors.length - 1].side;
      };
    } else {
      const wob = fbm(hashStr(route.id), 4);
      sideFn = (m) => wob(m / 1700) * Math.min(700, 120 + m / 40);
    }
    for (let i = 0; i < N; i++) {
      const m = i * DS;
      let z = sideFn(m);
      if (m < 400) z = lerp(sideFn(0), z, easeIO(m / 400)); /* fade from origin station */
      const tail = L - m;
      if (tail < 400) z = lerp(sideFn(L), z, easeIO(tail / 400)); /* fade to end anchor */
      zs[i] = z;
      ys[i] = elevAt(route, m);
    }
    /* ease until heading rate is real-rail (target R>=320 m), clamped window */
    const smooth = () => {
      const t = Float32Array.from(zs);
      for (let i = 0; i < N; i++) {
        let acc = 0, w = 0;
        for (let j = -2; j <= 2; j++) {
          const ii = i + j;
          if (ii < 0 || ii >= N) continue;
          const wt = [1, 2, 3, 2, 1][j + 2];
          acc += t[ii] * wt; w += wt;
        }
        zs[i] = acc / w;
      }
    };
    let passes = 0;
    while (passes < 90) {
      let phiPrev = Math.atan2(zs[1] - zs[0], DS), mx = 0;
      for (let i = 2; i < N; i++) {
        const phi = Math.atan2(zs[i] - zs[i - 1], DS);
        mx = Math.max(mx, Math.abs(phi - phiPrev)); phiPrev = phi;
      }
      if (mx / DS <= 1 / 320) break;
      smooth(); passes++;
    }
    const tx = new Float32Array(N), ty = new Float32Array(N), tz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      let dx = (b - a) * DS, dy = ys[b] - ys[a], dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dy, dz) || 1;
      tx[i] = dx / l; ty[i] = dy / l; tz[i] = dz / l;
    }
    return { xs: null, ys, zs, tx, ty, tz, N, DS, L, geo };
  },

  posAt(p, m, zOff) {
    m = clamp(m, 0, p.L);
    const f = m / p.DS, i = Math.min(p.N - 2, Math.floor(f)), t = f - i;
    const tx = lerp(p.tx[i], p.tx[i + 1], t), tz = lerp(p.tz[i], p.tz[i + 1], t);
    return {
      x: m, y: lerp(p.ys[i], p.ys[i + 1], t), z: lerp(p.zs[i], p.zs[i + 1], t) + (zOff || 0),
      tx, ty: lerp(p.ty[i], p.ty[i + 1], t), tz, yaw: Math.atan2(tz, tx),
    };
  },

  carOffsets(def) {
    const out = []; let acc = 0;
    for (const c of def.cars) { out.push({ head: acc + c.len, centre: acc + c.len / 2, len: c.len, car: c }); acc += c.len; }
    return out;
  },

  /* pose (world x,y,z + yaw) of car #carIdx when the train head is at m */
  carPose(p, def, m, carIdx, dir) {
    const cars = this.carOffsets(def);
    const c = cars[clamp(carIdx, 0, cars.length - 1)];
    const d = dir || 1;
    const cm = m - d * c.centre, h = c.len / 2 - 1.2;
    const a = this.posAt(p, cm - d * h, 0), b = this.posAt(p, cm + d * h, 0);
    const q = this.posAt(p, cm, 0);
    return { x: q.x, y: q.y + 1.5, z: q.z, yaw: Math.atan2(d * (b.z - a.z), d * (b.x - a.x)), car: c.car };
  },

  /* ---------- terrain ---------- */
  fbm2(a, b) {
    /* two rotated 1D noise lookups — good enough for ground patchiness */
    const n = this._n2 || (this._n2 = [fbm(hashStr('patch-x'), 3), fbm(hashStr('patch-y'), 3)]);
    return 0.5 + 0.25 * (n[0](a) + n[1](b));
  },

  makeTerrainFn(route, p) {
    const hills = fbm(hashStr(route.id + '-t'), 4), hills2 = fbm(hashStr(route.id + '-t2'), 3);
    let eMin = Infinity, eMax = -Infinity;
    for (let i = 0; i < p.N; i += 16) { eMin = Math.min(eMin, p.ys[i]); eMax = Math.max(eMax, p.ys[i]); }
    const amp = clamp((eMax - eMin) / 7, 14, 150);
    return (x, z) => {
      const i = clamp(Math.floor(x / p.DS), 0, p.N - 1);
      const base = p.ys[i];
      const w = smoothstep(52, 300, Math.abs(z));
      const h = hills(x / 850 + Math.abs(z) / 2100) * amp + hills2(x / 240 + z / 260) * 7;
      return base + w * h - w * 9;
    };
  },

  /* ---------- structures & scenery layout ---------- */
  layout(route, p, svc) {
    const out = { platforms: [], loops: [], tunnels: [], viaducts: [], crossings: [], poles: [], posts: [], props: [], milestones: [] };
    for (const st of route.stations) {
      out.platforms.push({ km: st.km, len: Math.min(st.plat || 250, 280), n: st.n, loc: st.loc, y: this.posAt(p, st.km, 0).y });
    }
    for (const tu of route.tunnels || []) out.tunnels.push({ a: tu[0] * KM, b: tu[1] * KM });
    for (const vd of route.viaducts || []) out.viaducts.push({ a: vd[0] * KM, b: vd[1] * KM });
    for (const cx of route.crossings || []) out.crossings.push({ km: cx * KM });
    /* single-line loops: parallel track beside the main over [km-170, km+170] */
    const loopNames = new Set(meetsOf(route, svc).map((m) => m.at).concat(route.loops || []));
    for (const st of route.stations) {
      if (!loopNames.has(st.n)) continue;
      out.loops.push({ km: st.km, a: st.km - 170, b: st.km + 170, off: 5.4, n: st.n });
    }
    if (route.electrified) for (let m = 40; m < p.L; m += 52) out.poles.push(m);
    for (let m = 0; m < p.L; m += 480) out.posts.push(m);           /* lineside posts */
    for (let km = 0; km <= route.km; km++) out.milestones.push(km * KM);
    /* deterministic scenery props: trees & buildings outside the corridor */
    const rng = mulberry32(hashStr(route.id + 'props'));
    const theme = route.theme || '';
    const nProps = Math.floor(p.L / 26);
    for (let i = 0; i < nProps; i++) {
      const m = rng() * p.L, side = rng() > 0.5 ? 1 : -1;
      const z = side * (75 + rng() * 420);
      const tree = theme === 'nilgiri' || theme === 'konkan' ? rng() < 0.82 : rng() < 0.5;
      out.props.push({ m, z, kind: tree ? 'tree' : 'building', s: 0.7 + rng() * 0.9, rot: rng() * TAU });
    }
    return out;
  },

  loopOffsetAt(loop, m) {
    if (m < loop.a - 90 || m > loop.b + 90) return 0;
    const t1 = smoothstep(loop.a - 90, loop.a, m), t2 = smoothstep(loop.b + 90, loop.b, m);
    return loop.off * Math.min(t1, t2);
  },
};
