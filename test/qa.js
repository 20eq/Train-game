'use strict';
/* ============================================================
   Headless QA: stubs the DOM/canvas, loads the game, then
   autopilots every service on every route to completion.
   Run: node test/qa.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------------- stubs ---------------- */
function mkCtxStub() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return {};
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: [] });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : () => {};
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function mkEl(id) {
  return {
    id, style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains: (c) => c === 'hidden', toggle() {} },
    _html: '', textContent: '', className: '', value: 'auto',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    appendChild() {}, querySelector() { return mkEl(id + '-q'); }, querySelectorAll() { return []; },
    addEventListener() {}, getContext: () => mkCtxStub(),
    width: 0, height: 0, onclick: null,
  };
}
const els = {};
const raf = { cb: null };
const sandbox = {
  console, Math, JSON, Date, performance, isFinite, Number, String, Object, Array, Float32Array,
  parseInt, parseFloat, setTimeout: (f) => { f(); return 0; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
  window: null,
  document: {
    getElementById: (id) => (els[id] = els[id] || mkEl(id)),
    createElement: (tag) => mkEl(tag),
    addEventListener() {},
    body: mkEl('body'),
  },
  localStorage: { getItem: () => null, setItem() {} },
  requestAnimationFrame: (f) => { raf.cb = f; },
};
sandbox.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, speechSynthesis: undefined,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['utils', 'data/trains', 'data/themes', 'data/routes', 'audio', 'signalling', 'physics', 'scenery', 'draw_world', 'draw_train', 'hud', 'game'];
for (const f of files) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: f + '.js' });
}
const { ROUTES, TRAINS, Signals, Game, limitAt, gradeAt, KM } = vm.runInContext(
  '({ ROUTES, TRAINS, Signals, Game, limitAt, gradeAt, KM })', sandbox);

/* ---------------- data validation ---------------- */
let failures = 0;
const fail = (msg) => { failures++; console.log('  ❌ ' + msg); };
const ok = (msg) => console.log('  ✅ ' + msg);

console.log('\n== Data validation ==');
for (const r of Object.values(ROUTES)) {
  let bad = false;
  for (let i = 0; i < r.stations.length; i++) {
    const s = r.stations[i];
    if (i > 0 && s.km <= r.stations[i - 1].km) { fail(`${r.id}: station ${s.n} not after previous`); bad = true; }
    if (s.km < 0 || s.km > r.km * KM) { fail(`${r.id}: station ${s.n} out of range`); bad = true; }
  }
  for (const svc of r.services) {
    const tt = svc.timetable;
    if (!tt.length) { fail(`${r.id}/${svc.id}: empty timetable`); bad = true; }
    for (let i = 1; i < tt.length; i++) if (tt[i].arr <= tt[i - 1].arr) { fail(`${r.id}/${svc.id}: timetable non-increasing at ${tt[i].st.n}`); bad = true; }
    if (tt[tt.length - 1].arr > 48 * 3600) { fail(`${r.id}/${svc.id}: timetable absurdly long`); bad = true; }
    for (const stn of (svc.stops === 'all' ? [] : svc.stops)) if (!r.stations.find((s) => s.n === stn)) { fail(`${r.id}/${svc.id}: stop ${stn} not a station`); bad = true; }
  }
  const sigs = Signals.build(r);
  for (let i = 1; i < sigs.length; i++) if (sigs[i].km <= sigs[i - 1].km) { fail(`${r.id}: signal order broken`); bad = true; }
  if (!bad) ok(`${r.id}: ${r.stations.length} stations, ${r.services.length} service(s), ${sigs.length} signals`);
}
for (const t of Object.values(TRAINS)) {
  if (!(t.mass > 0) || !(t.length > 0) || !isFinite(t.mass)) fail(`train ${t.id} bad mass/length`);
  if (!(t.power > 0) || !(t.fMax > 0)) fail(`train ${t.id} bad performance`);
}

/* ---------------- autopilot ---------------- */
console.log('\n== Autopilot end-to-end runs ==');
const autoKeys = {};
Game.boot();
Game.keys = autoKeys;

function autopilot() {
  const p = Game.player, r = Game.route;
  if (!p) return;
  const limit = limitAt(r.limits, p.s / KM);
  let vT = limit;
  let stopKm = null;
  const next = p.plan.find((x) => !x.done);
  if (next && !p.berthed) stopKm = next.ideal - 2;
  const sig = Signals.nextAhead(Game.signals, p.s);
  if (sig) {
    const d = sig.km - p.s;
    if (sig.aspect === 'R') {
      if (d < 1000) {
        const vStop = Math.sqrt(Math.max(0, 2 * 0.5 * Math.max(0, d - 28))) * 3.6;
        vT = Math.min(vT, vStop);
        stopKm = Math.min(stopKm === null ? 1e12 : stopKm, sig.km - 22);
      }
    } else if (sig.aspect === 'Y') vT = Math.min(vT, 42);
    else if (sig.aspect === 'YY') vT = Math.min(vT, 70);
  }
  // train ahead on same track? hold behind it (conservative curve)
  for (const t of Game.trains) {
    if (t === p || t.track === 'far' || (t.ai && t.ai.onLoop) || t.despawn) continue;
    const tRear = Math.min(t.s, t.rear);
    const d = tRear - p.s - 15;
    if (d > -50 && d < 2500) {
      const vStop = Math.sqrt(Math.max(0, 2 * 0.33 * Math.max(0, d))) * 3.6;
      vT = Math.min(vT, vStop);
      if (d < 45) vT = 0;
    }
  }
  if (stopKm !== null) {
    const d = stopKm - p.s;
    const vStop = Math.sqrt(Math.max(0, 2 * 0.42 * Math.max(0, d - 3))) * 3.6 + 0.4;
    vT = Math.min(vT, vStop);
  }
  for (const k of Object.keys(autoKeys)) delete autoKeys[k];
  if (p.emerg && p.v < 0.3) { autoKeys.Space = true; return; }
  if (p.berthed) {
    const cur = p.plan.find((x) => x.state === 'boarding' || x.state === 'ready');
    if (cur && (p.doorState === 'closed' || cur.state === 'ready')) autoKeys.ArrowUp = true;
    return;
  }
  const dv = vT - p.v * 3.6;
  if (p.v * 3.6 < 0.3 && vT < 0.5) return; // standing at a hold — wait
  if (dv > 1.2) autoKeys.ArrowUp = true;
  else if (dv < -1.4) autoKeys.ArrowRight = true;
}

async function runService(r, svc) {
  Game.start(r.id, svc.id, { tod: 'auto', weather: 'clear' });
  // drive the simulation directly (no rendering) in 0.5 s steps
  const DT = 0.5;
  let t = 0, lastS = 0, stuck = 0;
  const maxT = 40000; // sim seconds
  while (Game.state === 'play' && t < maxT) {
    autopilot();
    Game.update(DT, DT);
    t += DT;
    if (Math.floor(t) % 120 === 0) {
      if (Math.abs(Game.player.s - lastS) < 4 && Game.player.v < 0.05) stuck++; else stuck = 0;
      if (stuck > 30) {
        const sig = Signals.nextAhead(Game.signals, Game.player.s);
        const nextHalt = Game.player.plan.find((x) => !x.done);
        console.log(`    … waiting at s=${(Game.player.s / KM).toFixed(1)}km sig=${sig ? sig.aspect + '@' + (sig.km / KM).toFixed(1) : 'none'} next=${nextHalt ? nextHalt.st.n : 'end'} clock=${(Game.clock / 3600).toFixed(2)}h`);
        if (stuck > 120) break;
      }
      lastS = Game.player.s;
      if (!isFinite(Game.player.s) || !isFinite(Game.player.v)) { fail(`${r.id}/${svc.id}: NaN state`); return; }
    }
  }
  if (Game.state === 'done') {
    const sc = Game.score;
    const halts = sc.haltAcc.length;
    const good = sc.haltAcc.filter((a) => a >= 20).length;
    ok(`${r.id}/${svc.id} ✓ done in ${(t / 60).toFixed(0)}min sim | delay +${Math.round(sc.delayFinal)}s | halts ${good}/${halts} good | SPAD ${sc.spads} | pax ${Math.round(Game.player.passengers)}`);
    if (sc.spads > 0) fail(`${r.id}/${svc.id}: ${sc.spads} SPADs`);
    if (sc.delayFinal > 900) fail(`${r.id}/${svc.id}: very late (${Math.round(sc.delayFinal / 60)}min)`);
  } else if (Game.state === 'crash') {
    fail(`${r.id}/${svc.id}: CRASH at s=${(Game.player.s / KM).toFixed(1)}km`);
  } else {
    fail(`${r.id}/${svc.id}: did not finish (state=${Game.state}, s=${(Game.player.s / KM).toFixed(1)}km, t=${t}s)`);
  }
}

(async () => {
  for (const r of Object.values(ROUTES)) {
    for (const svc of r.services) {
      await runService(r, svc);
    }
  }
  console.log(`\n${failures === 0 ? '✅ ALL QA PASSED' : '❌ ' + failures + ' FAILURE(S)'}`);
  process.exit(failures ? 1 : 0);
})();
