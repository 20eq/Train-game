'use strict';
/* ============================================================
   Render smoke test: stub canvas, drive Game.render across the
   whole of every route at several times of day. Catches runtime
   errors in all draw paths. Run: node test/render.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function mkCtxStub(name) {
  const calls = { count: 0 };
  return new Proxy({}, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k === 'canvas') return { width: 1280, height: 720 };
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (typeof k === 'string') {
        calls.count++;
        return t[k] !== undefined ? t[k] : () => {};
      }
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
    addEventListener() {}, getContext: () => mkCtxStub(), width: 0, height: 0, onclick: null,
  };
}
const els = {};
const sandbox = {
  console, Math, JSON, Date, performance, isFinite, Number, String, Object, Array, Float32Array,
  parseInt, parseFloat, setTimeout: (f) => f(), clearTimeout() {}, setInterval() {}, clearInterval() {},
  window: null,
  document: {
    getElementById: (id) => (els[id] = els[id] || mkEl(id)),
    createElement: (t) => mkEl(t), addEventListener() {}, body: mkEl('body'),
  },
  localStorage: { getItem: () => null, setItem() {} },
  requestAnimationFrame() {},
};
sandbox.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['utils', 'data/trains', 'data/themes', 'data/routes', 'audio', 'signalling', 'physics', 'scenery', 'draw_world', 'draw_train', 'hud', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
}
const { Game, ROUTES, KM } = vm.runInContext('({ Game, ROUTES, KM })', sandbox);
Game.boot();

let failures = 0;
for (const r of Object.values(ROUTES)) {
  for (const svc of r.services) {
    for (const tod of ['auto', 'night', 'dusk', 'dawn']) {
      for (const weather of ['clear', 'monsoon']) {
      Game.start(r.id, svc.id, { tod, weather });
      // sample renders along the whole line + around each station
      const spots = [];
      for (let km = 0; km <= r.km; km += r.km / 24) spots.push(km * KM);
      for (const st of r.stations) { spots.push(st.km - 200); spots.push(st.km + st.plat * 0.4); }
      spots.push(r.km * KM - 300);
      let drew = 0;
      for (const s of spots) {
        Game.player.s = Math.max(0, s);
        Game.player.v = 15;
        Game.cam.km = Game.player.s;
        try {
          Game.render(0.016);
          drew++;
        } catch (e) {
          failures++;
          console.log(`  ❌ render ${r.id}/${svc.id} tod=${tod} wx=${weather} @${(s / KM).toFixed(1)}km: ${e.message}`);
          break;
        }
      }
      // results screen render of stats markup
      try { Game.finishRun(); } catch (e) { failures++; console.log(`  ❌ finishRun ${r.id}/${svc.id}: ${e.message}`); }
      if (drew === spots.length) console.log(`  ✅ ${r.id}/${svc.id} [${tod}/${weather}] rendered ${drew} views`);
      }
    }
  }
}
console.log(failures ? `❌ ${failures} render failure(s)` : '✅ RENDER SMOKE PASSED');
process.exit(failures ? 1 : 0);
