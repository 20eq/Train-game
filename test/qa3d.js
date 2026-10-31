'use strict';
/* ============================================================
   3D world QA: geometry + physics integration, no WebGL needed.
   Run: node test/qa3d.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkCtxStub() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return {};
      if (k === 'measureText') return () => ({ width: 10 });
      if (/Gradient|Pattern/.test(String(k))) return () => ({ addColorStop() {} });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : () => {};
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function mkEl(id) {
  return {
    id, style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, contains: () => true, toggle() {} },
    _html: '', textContent: '', className: '', value: 'auto',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); }, querySelector() { return mkEl(id + '-q'); },
    querySelectorAll() { return []; }, addEventListener() {}, getContext: () => mkCtxStub(), width: 0, height: 0,
  };
}
const els = {};
const sandbox = {
  console, Math, JSON, Date, performance, isFinite, Number, String, Object, Array, Float32Array,
  parseInt, parseFloat, setTimeout: (f) => f(), clearTimeout() {}, setInterval() {}, clearInterval() {},
  window: null,
  document: { getElementById: (id) => (els[id] = els[id] || mkEl(id)), createElement: (t) => mkEl(t), addEventListener() {}, body: mkEl('body') },
  localStorage: { getItem: () => null, setItem() {} },
  requestAnimationFrame() {},
};
sandbox.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['utils', 'data/trains', 'data/themes', 'data/geo', 'data/routes', 'audio', 'signalling', 'physics']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
}
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js3d', 'world.js'), 'utf8'), sandbox, { filename: 'world.js' });
const { ROUTES, TRAINS, Signals, World3D, makeTrain, stepTrain, aiDrive, limitAt, KM, mulberry32, clamp, stationByName } =
  vm.runInContext('({ ROUTES, TRAINS, Signals, World3D, makeTrain, stepTrain, aiDrive, limitAt, KM, mulberry32, clamp, stationByName })', sandbox);

let failures = 0;
const fail = (m) => { failures++; console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

console.log('\n== 3D world geometry ==');
for (const r of Object.values(ROUTES)) {
  const p = World3D.buildPath(r);
  let bad = null, zPrevPhi = 0;
  // finite & tangent unit
  for (let i = 0; i < p.N; i++) {
    if (!isFinite(p.xs[i]) || !isFinite(p.ys[i]) || !isFinite(p.zs[i])) { bad = 'non-finite sample @' + i; break; }
    const tl = Math.hypot(p.tx[i], p.ty[i], p.tz[i]);
    if (Math.abs(tl - 1) > 0.02) { bad = 'tangent not unit @' + i; break; }
    // curvature check: heading rate must stay within real-rail radius (>=150 m)
    if (i > 1) {
      const DS = World3D.DS;
      const phi = Math.atan2(p.zs[i] - p.zs[i - 1], DS);
      const kappa = Math.abs(phi - zPrevPhi) / DS;
      if (kappa > 1 / 150) { bad = 'curvature spike @' + i + ' (R~' + Math.round(1 / Math.max(kappa, 1e-9)) + 'm)'; break; }
      zPrevPhi = phi;
    } else if (i === 1) zPrevPhi = Math.atan2(p.zs[1] - p.zs[0], World3D.DS);
  }
  // ends reasonably centred
  if (Math.abs(p.zs[0]) > 30) bad = 'start z not ~0';
  if (!bad && Math.abs(p.zs[p.N - 1]) > 240) bad = 'end z wild';
  // posAt consistent with samples
  if (!bad) {
    for (const frac of [0.13, 0.5, 0.87]) {
      const m = frac * p.L;
      const q = World3D.posAt(p, m, 0);
      const i = Math.floor(m / World3D.DS);
      if (Math.abs(q.x - m) > 0.01) { bad = 'posAt x mismatch'; break; }
      if (Math.abs(q.z - p.zs[i]) > 12) { bad = 'posAt z far from sample'; break; }
      const c0 = World3D.carPose(p, r.services[0] ? TRAINS[r.services[0].train] : TRAINS.wr_emu12, m, 1, 0);
      if (!isFinite(c0.x + c0.y + c0.z)) { bad = 'carPose NaN'; break; }
    }
  }
  // car ordering: car 1 centre behind car 0 centre
  if (!bad) {
    const tr = TRAINS[r.services[0].train];
    const a = World3D.carPose(p, tr, 500, 1, 0), b = World3D.carPose(p, tr, 500, 1, 1);
    if (!(b.x < a.x)) bad = 'cars out of order';
  }
  // terrain
  if (!bad) {
    const tf = World3D.makeTerrainFn(r, p);
    for (let k = 0; k < 40; k++) {
      const m = (k / 40) * p.L;
      const i = Math.round(m / World3D.DS);
      const hCorr = tf(p.xs[i], p.zs[i]);
      if (Math.abs(hCorr - (p.ys[i] - 0.9)) > 2.5) { bad = 'corridor not graded @' + i; break; }
      const hFar = tf(p.xs[i], p.zs[i] + 600);
      if (!isFinite(hFar)) { bad = 'terrain NaN far'; break; }
    }
  }
  // scatter
  if (!bad) {
    const sc = World3D.scatter(r, p);
    for (const t of sc.trees) {
      const i = clamp(Math.round(t.x / World3D.DS), 0, p.N - 1);
      if (Math.abs(t.z - p.zs[i]) < 40) { bad = 'tree on track'; break; }
    }
    for (const pi of sc.piers) if (pi.yTop - pi.yBot < 1.5) { bad = 'useless pier'; break; }
    if (!sc.gates.length && (r.crossings || []).length) bad = 'gates missing';
  }
  // signals list for 3D present
  if (!bad) {
    r.signals3d = Signals.build(r);
    if (!r.signals3d.length && r.block > 0) bad = 'no signals generated';
  }
  if (bad) fail(`${r.id}: ${bad}`);
  else ok(`${r.id}: path ${p.N} samples, ${Math.round(p.L / KM)}km, z∈[${p.zs.reduce((a, b) => Math.min(a, b), 1e9) | 0},${p.zs.reduce((a, b) => Math.max(a, b), -1e9) | 0}] — geometry OK`);
}

/* ---- sim integration on the 3D path (autopilot smoke, meet route) ---- */
console.log('\n== 3D sim smoke (mys meet + konkan timetable) ==');
function driveOnce(routeId, svcId, maxS) {
  const r = ROUTES[routeId];
  const svc = r.services.find((s) => s.id === svcId);
  r.signals3d = Signals.build(r);
  for (const s of r.signals3d) s.aspect = 'G';
  const p = makeTrain(svc.train, { s: 0, label: svc.label });
  p.plan = svc.timetable.map((row, i) => ({
    st: row.st, i, arr: row.arr, dep: row.dep, halt: row.halt,
    ideal: row.st.km + Math.max(row.st.plat * 0.35, Math.min(row.st.plat + 25, p.def.length * 0.72)),
    state: i === 0 ? 'boarding' : 'pending', done: false,
  }));
  p.plan[0].done = true; p.plan[0].state = 'boarding';
  p.berthed = true; p.boardT = 12;
  const sigs = r.signals3d;
  let t = 0, crashed = false;
  const meets = (svc.meets || []).map((m) => Object.assign({ spawned: false, cleared: false }, m));
  const trains = [p];
  const ctx = { route: r, grads: r.gradList, limits: r.limits, signals: sigs };
  while (t < maxS) {
    // signal aspects from occupancy (same as the real game)
    const occ = [];
    for (const tr of trains) {
      if (tr.track === 'far' || (tr.ai && tr.ai.onLoop)) continue;
      const b0 = Signals.blockOf(sigs, Math.min(tr.s, tr.rear) + 2), b1 = Signals.blockOf(sigs, Math.max(tr.s, tr.rear) - 2);
      for (let b = b0; b <= b1; b++) if (b >= 0 && !occ.includes(b)) occ.push(b);
    }
    occ.sort((a, b) => a - b);
    for (const s of sigs) s.aspect = Signals.aspectFor(sigs, s.idx, occ);
    // player autopilot
    const keys = {};
    let vT = limitAt(r.limits, p.s / KM);
    let stopKm = null;
    const next = p.plan.find((x) => !x.done);
    if (next && !p.berthed) stopKm = next.ideal - 2;
    let nx = null;
    for (const s of sigs) if (s.km > p.s + 0.5) { nx = s; break; }
    if (nx) {
      const d = nx.km - p.s;
      if (nx.aspect === 'R' && d < 1000) { vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.5 * Math.max(0, d - 28))) * 3.6); stopKm = Math.min(stopKm ?? 1e12, nx.km - 22); }
      else if (nx.aspect === 'Y') vT = Math.min(vT, 42);
      else if (nx.aspect === 'YY') vT = Math.min(vT, 70);
    }
    for (const tr of trains) {
      if (tr === p || tr.track === 'far' || (tr.ai && tr.ai.onLoop)) continue;
      const d = Math.min(tr.s, tr.rear) - p.s - 15;
      if (d > -50 && d < 2500) { vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.33 * Math.max(0, d))) * 3.6); if (d < 45) vT = 0; }
    }
    // single-line rule: hold at the meet station's home signal until the loop clears
    for (const m of meets) {
      if (m.spawned && !m.cleared && m.train) {
        const st = stationByName(r, m.at);
        const dd = st.km - p.s;
        if (dd > -80 && dd < 2600) {
          stopKm = Math.min(stopKm ?? 1e12, st.km - 420);
          if (dd < 620) vT = 0;
        }
      }
    }
    if (stopKm !== null) vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.42 * Math.max(0, stopKm - p.s - 3))) * 3.6 + 0.4);
    if (p.berthed) {
      const cur = p.plan.find((x) => x.state === 'boarding' || x.state === 'ready');
      if (cur && (p.doorState === 'closed' || cur.state === 'ready')) p.throttle = clamp(p.throttle + 0.035, 0, 1), p.brakeCmd = clamp(p.brakeCmd - 0.07, 0, 1);
      if (cur && cur.state === 'boarding') { p.boardT -= 0.5; if (p.boardT <= 0) { p.doorState = 'closing'; cur.state = 'ready'; } }
    } else {
      const dv = vT - p.v * 3.6;
      if (!(p.v * 3.6 < 0.3 && vT < 0.5)) {
        if (dv > 1.2) { p.throttle = clamp(p.throttle + 0.035, 0, 1); p.brakeCmd = clamp(p.brakeCmd - 0.07, 0, 1); }
        else if (dv < -1.4) { p.throttle = 0; p.brakeCmd = clamp(p.brakeCmd + 0.04, 0, 1); }
      }
    }
    for (const tr of trains) { if (tr !== p) aiDrive(tr, 0.5, ctx); stepTrain(tr, 0.5, ctx); }
    // meets
    for (const m of meets) {
      const st = stationByName(r, m.at);
      if (!m.spawned && st.km - p.s < m.triggerKm * KM && p.s < st.km) {
        m.spawned = true;
        const ai = makeTrain(m.aiTrain, { s: st.km + m.aheadKm * KM, dir: -1, label: m.aiLabel, ai: { stopAt: st.km + st.plat * 0.55, opposite: true } });
        trains.push(ai); m.train = ai;
      }
      if (m.train && m.train.ai.arrived && !m.cleared) { m.cleared = true; m.train.track = 'far'; m.train.ai.onLoop = true; }
    }
    for (const tr of trains) {
      if (tr === p || tr.track === 'far' || (tr.ai && tr.ai.onLoop)) continue;
      if (Math.max(p.s, p.rear) > Math.min(tr.s, tr.rear) + 2 && Math.min(p.s, p.rear) < Math.max(tr.s, tr.rear) - 2) { crashed = true; break; }
    }
    if (crashed) break;
    // berth logic mirrors 3D game
    if (next && !p.berthed) {
      const err = p.s - next.ideal;
      if (p.v < 0.25 && p.s > next.st.km - 25 && p.s < next.st.km + next.st.plat + 70 && Math.abs(err) <= 55) {
        p.berthed = true;
        if (next.halt) { next.state = 'boarding'; p.boardT = 20; }
      } else if ((p.s > next.ideal + 70 && p.v > 2) || (p.v < 0.3 && p.s > next.ideal + 55)) next.done = true;
    }
    if (p.berthed) {
      const cur = p.plan.find((x) => x.state === 'ready');
      if (cur && p.v > 0.4) { cur.done = true; cur.state = 'departed'; p.berthed = false; }
    }
    t += 0.5;
    if (p.s > r.km * KM) break;
  }
  return { crashed, t, pos: p.s / KM };
}
const mys = driveOnce('mys', 'mys-dmu', 12000);
if (mys.crashed) fail('mys 3D smoke: collision'); else ok(`mys 3D smoke: no collision (reached ${mys.pos.toFixed(1)} km in ${Math.round(mys.t)}s sim)`);
const kon = driveOnce('konkan', 'konkan-vb', 20000);
if (kon.crashed) fail('konkan 3D smoke: collision'); else ok(`konkan 3D smoke: reached ${kon.pos.toFixed(1)} km`);

console.log(failures ? `\n❌ ${failures} FAILURE(S)` : '\n✅ 3D QA PASSED');
process.exit(failures ? 1 : 0);
