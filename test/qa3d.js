'use strict';
/* ============================================================
   3D engine QA (fresh engine): geometry, physics, signalling and
   headless service smokes. No WebGL needed.  Run: node test/qa3d.js
   ============================================================ */
const fs = require('fs'), path = require('path'), vm = require('vm');

function mkCtxStub() {
  return new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : typeof t[k] !== 'undefined' ? t[k] : () => {}), set: (t, k, v) => (t[k] = v, true) });
}
function mkEl(id) {
  return { id, style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains: () => true, toggle() {} },
    _html: '', textContent: '', className: '', value: 'auto', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); }, querySelector() { return mkEl(id + 'q'); }, querySelectorAll() { return [] },
    addEventListener() {}, getContext: () => mkCtxStub(), width: 0, height: 0 };
}
const els = {};
const sb = {
  console, Math, JSON, Date, performance, isFinite, Number, String, Object, Array, Float32Array, Map, Set,
  parseInt, parseFloat, setTimeout: (f) => f(), clearTimeout() {}, setInterval() {}, clearInterval() {},
  document: { getElementById: (id) => (els[id] = els[id] || mkEl(id)), createElement: (t) => mkEl(t), addEventListener() {}, body: mkEl('body') },
  localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame() {},
  window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, AudioContext: null },
};
sb.globalThis = sb;
vm.createContext(sb);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sb, { filename: f });
for (const f of ['src/util.js', 'js/data/trains.js', 'js/data/themes.js', 'js/data/geo.js', 'js/data/routes.js',
  'src/signals.js', 'src/physics.js', 'src/world.js', 'src/game.js']) load(f);
const { ROUTES, TRAINS, SignalBox, WB, Game, makeTrain, stepTrain, aiDrive, limitAt, gradeAt, elevAt,
  KM, MPS, KMH, mulberry32, clamp, lerp, stationByName, fmtClock } =
  vm.runInContext('({ ROUTES, TRAINS, SignalBox, WB, Game, makeTrain, stepTrain, aiDrive, limitAt, gradeAt, elevAt, KM, MPS, KMH, mulberry32, clamp, lerp, stationByName, fmtClock })', sb);

let failures = 0;
const fail = (m) => { failures++; console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

/* ================= geometry ================= */
console.log('\n== world geometry (9 real-geo routes) ==');
for (const r of Object.values(ROUTES)) {
  const p = WB.buildPath(r);
  let bad = null;
  for (let i = 0; i < p.N && !bad; i++) {
    if (!isFinite(p.ys[i]) || !isFinite(p.zs[i])) bad = 'non-finite @' + i;
    const tl = Math.hypot(p.tx[i], p.ty[i], p.tz[i]);
    if (Math.abs(tl - 1) > 0.02) bad = 'tangent not unit @' + i;
    if (i > 1) {
      const phi = Math.atan2(p.zs[i] - p.zs[i - 1], p.DS), pp = Math.atan2(p.zs[i - 1] - p.zs[i - 2], p.DS);
      const k = Math.abs(phi - pp) / p.DS;
      if (k > 1 / 150) { bad = `curvature R~${Math.round(1 / Math.max(k, 1e-9))}m @${i}`; break; }
    }
  }
  if (bad) fail(`${r.id}: ${bad}`);
  else {
    if (Math.abs(p.zs[0]) > 1) fail(`${r.id}: start z ${p.zs[0].toFixed(1)} != 0`);
    else if (Math.abs(p.ys[p.N - 1] - elevAt(r, p.L)) > 2) fail(`${r.id}: end elevation mismatch`);
    else ok(`${r.id}: ${p.N} samples, ${(p.L / KM).toFixed(1)}km, z∈[${Math.min(...p.zs).toFixed(0)},${Math.max(...p.zs).toFixed(0)}], geo=${p.geo}`);
  }
  /* terrain + posAt + carPose sanity */
  if (!bad) {
    const tf = WB.makeTerrainFn(r, p);
    for (let k = 0; k < 30; k++) {
      const h = tf(k * 997 % p.L, (k * 331) % 600 - 300);
      if (!isFinite(h)) { fail(`${r.id}: terrain non-finite`); bad = 1; break; }
    }
    const q = WB.posAt(p, p.L * 0.5, 0), i = Math.floor(p.L * 0.5 / p.DS);
    if (!bad && Math.abs(q.z - p.zs[i]) > 8) fail(`${r.id}: posAt z off sample`);
    const def = TRAINS[r.services[0].train];
    const c0 = WB.carPose(p, def, 600, 0), c2 = WB.carPose(p, def, 600, 2);
    if (!bad && (!isFinite(c0.x + c0.y + c0.z + c0.yaw) || !isFinite(c2.x + c2.y + c2.z))) fail(`${r.id}: carPose NaN`);
    if (!bad && !(c2.x < c0.x)) fail(`${r.id}: cars out of order`);
    const lay = WB.layout(r, p);
    if (!bad && !lay.platforms.length) fail(`${r.id}: no platforms laid out`);
  }
}

/* ================= physics ================= */
console.log('\n== physics ==');
{
  const wr = ROUTES.wr, def = TRAINS.wr_emu12;
  const tr = makeTrain(wr, def, { s0: 500 });
  let maxV = 0;
  for (let i = 0; i < 60 * 90; i++) { tr.throttle = 1; stepTrain(tr, 0.1, {}); maxV = Math.max(maxV, tr.v); }
  const lim = limitAt(wr, tr.s) * KMH;
  if (kmhOk(maxV, lim)) ok(`EMU accelerates to line limit (${(maxV * KMH).toFixed(0)} km/h vs limit ${lim.toFixed(0)})`);
  else fail(`EMU only reached ${(maxV * KMH).toFixed(0)} km/h, limit ${lim.toFixed(0)}`);
  /* service brake stop from line speed */
  let d = 0; tr.v = 22; tr.brakeCmd = 1; tr.throttle = 0;
  while (tr.v > 0.05 && d < 3000) { stepTrain(tr, 0.1, {}); d += tr.v * 0.1; }
  if (d < 900) ok(`service brake stop ${d.toFixed(0)} m from ${(22 * KMH).toFixed(0)} km/h`);
  else fail(`brake stop too long: ${d.toFixed(0)} m`);
  /* rack cap on Nilgiri */
  const nr = ROUTES.nilgiri, rt = makeTrain(nr, TRAINS.nmr_x, { s0: 3 * KM });
  for (let i = 0; i < 60 * 120; i++) { rt.throttle = 1; stepTrain(rt, 0.1, {}); }
  if (rt.v <= 8.75) ok(`NMR rack cap respected (${(rt.v * KMH).toFixed(1)} km/h in rack)`);
  else fail(`NMR overspeed in rack: ${(rt.v * KMH).toFixed(1)} km/h`);
  /* local EMU benchmarks (real Mumbai 12-car: ~0.8 m/s^2 start, 0-60 in ~26-30s,
     ~450 m service brake from 100 km/h) — the "accurate local" gate */
  const emu = makeTrain(wr, def, { s0: 300 });
  let a0 = null, t60 = null;
  for (let i = 0; i <= 60 * 40; i++) {
    emu.throttle = 1; stepTrain(emu, 0.1, {});
    if (a0 === null && emu.v > 1.39) a0 = emu.a;
    if (t60 === null && emu.v >= 60 * MPS) { t60 = i * 0.1; break; }
  }
  if (a0 >= 0.65 && a0 <= 1.05) ok(`EMU start accel ${(a0).toFixed(2)} m/s² (real ~0.8)`);
  else fail(`EMU start accel ${a0 && a0.toFixed(2)} out of real band 0.65-1.05`);
  if (t60 >= 20 && t60 <= 33) ok(`EMU 0-60 km/h in ${t60.toFixed(1)} s (real ~26-30 loaded)`);
  else fail(`EMU 0-60 in ${t60 && t60.toFixed(1)} s out of real band 20-33`);
  const bk = makeTrain(wr, def, { s0: 500 });
  bk.v = 100 * MPS; bk.brakeCmd = 1;
  let bd = 0;
  while (bk.v > 0.02 && bd < 2000) { stepTrain(bk, 0.1, {}); bd += bk.v * 0.1; }
  if (bd >= 380 && bd <= 540) ok(`EMU service brake 100-0 in ${bd.toFixed(0)} m (real ~450)`);
  else fail(`EMU brake 100-0 ${bd.toFixed(0)} m out of real band 380-540`);
  /* rollaway: doors open on a 1-in-100 downhill must hold */
  const rr = makeTrain(wr, def, { s0: 20000 });
  rr.v = 0; rr.doorsOpen = true; rr.brakeCmd = 0;
  const s0r = rr.s;
  for (let i = 0; i < 60 * 45; i++) stepTrain(rr, 0.1, {});
  if (rr.s - s0r < 2) ok(`doors-open parking brake holds (${(rr.s - s0r).toFixed(2)} m drift in 45 s)`);
  else fail(`rollaway with doors open: drifted ${(rr.s - s0r).toFixed(1)} m`);
  /* monsoon adhesion reduces braking */
  const w1 = makeTrain(wr, def, { s0: 500 }), w2 = makeTrain(wr, def, { s0: 500 });
  w1.v = w2.v = 25; w1.brakeCmd = w2.brakeCmd = 1;
  let d1 = 0, d2 = 0;
  while ((w1.v > 0.02 || w2.v > 0.02) && d1 < 4000) {
    if (w1.v > 0.02) { stepTrain(w1, 0.1, {}); d1 += w1.v * 0.1; }
    if (w2.v > 0.02) { stepTrain(w2, 0.1, { wet: 1 }); d2 += w2.v * 0.1; }
  }
  if (d2 > d1 * 1.05) ok(`monsoon stops longer (${d2.toFixed(0)}m vs ${d1.toFixed(0)}m dry)`);
  else fail(`wet/dry braking identical (${d2.toFixed(0)} vs ${d1.toFixed(0)})`);
}
function kmhOk(v, lim) { return v >= Math.min(lim, 26) * MPS - 1.5; }

/* ================= signalling ================= */
console.log('\n== signalling ==');
{
  const wr = ROUTES.wr, box = new SignalBox(wr);
  const a = makeTrain(wr, TRAINS.wr_emu12, { s0: 3000 });
  box.update([a]);
  const red = box.signals.filter((s) => s.track === 'main' && s.aspect === 'red');
  if (red.length >= 1) ok(`block occupancy shows red behind standing train (${red.length} signals red)`);
  else fail('no red aspects behind occupied block');
  /* single-line: opposing on main beyond a loop -> home red; in loop -> clear */
  const mys = ROUTES.mys, mbox = new SignalBox(mys, mys.services[0]);
  const loop = stationByName(mys, mbox.loops[0].n);
  const opp = makeTrain(mys, TRAINS.dmu_mys, { s0: loop.km + 2500, track: 'main' });
  mbox.update([opp]);
  const home = mbox.signals.find((s) => s.id === 'H0');
  const redOnMain = home.aspect === 'red';
  opp.track = 'loop'; opp.s = loop.km;
  mbox.update([opp]);
  const clearInLoop = home.aspect === 'green';
  if (redOnMain && clearInLoop) ok('single line: main occupancy holds home, loop refuge releases it');
  else fail(`single-line aspects: on main=${home.aspect} (want red first), in loop=${clearInLoop}`);
}

/* ================= service smokes ================= */
console.log('\n== service smokes (AI-driven headless) ==');
function smoke(routeId, svcIdx, maxSimS) {
  const r = ROUTES[routeId], svc = r.services[svcIdx || 0];
  const g = new Game(r, svc, 'service');
  g.cmd.throttle = 1;
  const dt = 0.5;
  let t = 0, collision = null, stops = 0;
  while (!g.done && t < maxSimS) {
    /* smoke driver: aiDrive moves the player too, cmd mirrors it after the fact */
    aiDrive(g.player, g.box, { dt, trains: g.trains });
    g.cmd.throttle = g.player.throttle; g.cmd.brake = g.player.brakeCmd;
    const prevS = g.player.s;
    const evs = g.advance(dt);
    t += dt;
    /* collision: any two live trains overlapping on the same track */
    for (let i = 0; i < g.trains.length && !collision; i++)
      for (let j = i + 1; j < g.trains.length; j++) {
        const A = g.trains[i], B = g.trains[j];
        if (A.track !== B.track || A.track === 'far') continue;
        const ov = Math.max(A.s - A.len, B.s - B.len) < Math.min(A.s, B.s) - 0.5; /* interval overlap */
        if (ov) { collision = `${A.label} × ${B.label} @km ${(A.s / KM).toFixed(2)}`; break; }
      }
    for (const e of evs) if (e.type === 'stop') stops++;
    if (g.player.s < prevS - 1e-6) { collision = 'player moved backwards'; break; }
  }
  const spads = g.score.spads;
  if (collision) fail(`${routeId}: collision — ${collision}`);
  else if (!g.done) fail(`${routeId}: did not finish in ${maxSimS}s sim (at km ${(g.player.s / KM).toFixed(1)}, ${stops} stops, spads=${spads})`);
  else ok(`${routeId} "${svc.label}": complete in ${fmtClock(t)} sim, ${stops}/${g.tt.filter((x) => x.halt).length} stops scored, spads=${spads}`);
  return { g, t, collision };
}

/* player-command smoke: drive via g.cmd ONLY (no aiDrive on player) —
   catches interactive-path softlocks like doors never closing */
{
  const r = ROUTES.wr, svc = r.services[0];
  const g = new Game(r, svc, 'service');
  const dt = 0.5;
  let t = 0, opens = 0, prevOpen = false;
  const brakeD = (v) => (v * v) / (2 * 0.72);
  while (!g.done && t < 4200) {
    /* station-aware naive driver via commands only */
    const nextHalt = (g.tt || []).find((row) => row.halt && !row.actual && row.st.km > g.player.s - 30);
    const v = g.player.v;
    if (g.player.doorsOpen) { g.cmd.throttle = 0; g.cmd.brake = 1; }
    else if (nextHalt) {
      const d = nextHalt.st.km - g.player.s;
      if (d < brakeD(v) * 1.25 + 30) { g.cmd.throttle = 0; g.cmd.brake = 1; }
      else if (d < 160 && v > 6 * MPS) { g.cmd.throttle = 0; g.cmd.brake = 0.7; }
      else { g.cmd.throttle = 1; g.cmd.brake = 0; }
    } else { g.cmd.throttle = g.player.s > g.end - 700 ? 0 : 1; g.cmd.brake = g.player.s > g.end - 500 ? 1 : 0; }
    g.advance(dt); t += dt;
    if (g.player.doorsOpen && !prevOpen) opens++;
    prevOpen = g.player.doorsOpen;
  }
  if (g.score.total >= 2 && opens >= 2) ok(`interactive drive: ${g.score.total} stops, doors cycled ${opens}x (departs cleanly)`);
  else fail(`interactive drive broken: stops=${g.score.total}, door cycles=${opens} @km ${(g.player.s / KM).toFixed(1)}`);
}

/* free roam must construct & run without a service (regression: svc null crash) */
{
  const r = ROUTES.mys;
  const g = new Game(r, null, 'freeroam');
  g.cmd.throttle = 1;
  for (let i = 0; i < 60 * 10; i++) g.advance(0.5);
  if (!g.done && g.player.s > 3000 && isFinite(g.player.v)) ok(`free roam runs (km ${(g.player.s / KM).toFixed(1)} after 10 sim-min)`);
  else fail(`free roam broken: done=${g.done} s=${g.player.s}`);
}

/* Nilgiri rack climb: X-class must make the 1-in-12-ish grades with cog assist */
{
  const nr = ROUTES.nilgiri;
  const tr = makeTrain(nr, TRAINS.nmr_x, { s0: 8 * KM });
  let worst = 0;
  for (let i = 0; i < 60 * 60 * 25; i++) {
    tr.throttle = 1;
    stepTrain(tr, 0.1, {});
    worst = Math.max(worst, gradeAt(nr, tr.s));
    if (tr.done) break;
  }
  if (tr.s > 25 * KM) ok(`NMR climbs with real grades (past km ${(tr.s / KM).toFixed(1)}, worst uphill ${(worst * 100).toFixed(1)}%)`);
  else fail(`NMR stalls on real grades at km ${(tr.s / KM).toFixed(1)} (worst ${(worst * 100).toFixed(1)}%)`);
}

smoke('mys', 0, 5200);           // single-line loop meet
smoke('konkan', 0, 12000);        // long single-line + tunnels
smoke('wr', 0, 5400);            // double line, chase + oncoming
smoke('chennai', 0, 4200);       // dense halts

console.log('\n' + (failures ? `❌ ${failures} FAILURE(S)` : '✅ 3D ENGINE QA PASSED'));
process.exit(failures ? 1 : 0);
