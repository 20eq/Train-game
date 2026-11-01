'use strict';
/* ============================================================
   Bharat Rail Sim 3D — main shell (fresh engine)
   Menus, input, cameras, HUD, minimap, pause, scoring.
   ============================================================ */
const App = {
  state: 'menu',   // menu | driving | paused
  camMode: 0,      // 0 cab 1 chase 2 orbit 3 trackside
  timeScale: 1,
  tod: 9, rain: 0, rainTarget: 0,
  keys: {},
  orbit: { az: 2.4, el: 0.4, r: 60 },

  autoDrive: false,

  start(route, svc, mode) {
    this.route = route; this.svc = svc; this.mode = mode;
    this.game = new Game(route, svc, mode);
    this.game.wet = this.rain;
    if (!this.r3d) this.r3d = new R3D(document.getElementById('gl'));
    const p = WB.buildPath(route);
    this.path = p;
    const lay = WB.layout(route, p, svc);
    this.lay = lay;
    this.r3d.build(route, p, lay, svc);
    this.r3d.attachSignals(this.game.box);
    /* train visuals */
    this.handles = new Map();
    for (const tr of this.game.trains) this.handles.set(tr, this.r3d.buildTrain(tr.def, tr === this.game.player));
    /* parked long-distance rakes on the far line near the terminus */
    if (this.statics) this.statics.forEach((h) => this.r3d.removeTrain(h)); /* previous run */
    this.statics = [];
    const parkDefs = (this.svc && this.svc.ai && this.svc.ai.opposite && this.svc.ai.opposite.trains) || ['konkan_exp', 'wdg_freight'];
    for (let k = 0; k < 2; k++) {
      const s = p.L - 320 - k * 420;
      if (s < 900) break;
      const def = TRAINS[parkDefs[k % parkDefs.length]];
      const h = this.r3d.buildTrain(def, false);
      h.cars.forEach((car, i) => {
        const pose = WB.carPose(p, def, s, i);
        car.position.set(pose.x, pose.y, pose.z - (route.double ? 4.9 : 5.6));
        car.rotation.y = -pose.yaw;
      });
      this.statics.push(h);
    }
    this._menuOff();
    this.state = 'driving';
    Snd.init(); Snd.resume();
    this.hud('Driving ' + (svc ? svc.label : route.title) + ' — ' + (mode === 'freeroam' ? 'Free roam' : svc ? svc.depart : ''));
  },

  _menuOff() { document.getElementById('menu').style.display = 'none'; document.getElementById('hud').style.display = 'flex'; },
  hud(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.style.opacity = 1; clearTimeout(this._tt); this._tt = setTimeout(() => (el.style.opacity = 0), 4200); },

  /* ---------------- input ---------------- */
  bind() {
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'driving' && e.key !== 'Escape') return;
      this.keys[e.key] = true;
      if (e.key === 'Tab') { e.preventDefault(); this._board(); }
      if (e.key === 'm' || e.key === 'M') this._map();
      if (e.key === 'c' || e.key === 'C') this.camMode = (this.camMode + 1) % 4;
      if (e.key >= '1' && e.key <= '4') this.camMode = +e.key - 1;
      if (e.key === 'h' || e.key === 'H') Snd.horn(this.game.player.def.horn);
      if (e.key === 'Escape') this._pause();
      if (e.key === 't' || e.key === 'T') this.timeScale = this.timeScale === 1 ? 4 : this.timeScale === 4 ? 12 : 1;
      if (e.key === 'b' || e.key === 'B') { this.autoDrive = !this.autoDrive; this.hud(this.autoDrive ? 'Auto driver engaged' : 'Manual control'); }
      if (e.key === 'p' || e.key === 'P') this.rainTarget = this.rainTarget > 0 ? 0 : 0.85;
      if (e.key === 'n' || e.key === 'N') this.tod = (this.tod + 12) % 24;
      if (e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key] = false; });
    const gl = document.getElementById('gl');
    let drag = null;
    gl.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.orbit.az -= (e.clientX - drag.x) * 0.006;
      this.orbit.el = clamp(this.orbit.el + (e.clientY - drag.y) * 0.004, 0.06, 1.35);
      drag = { x: e.clientX, y: e.clientY };
    });
    gl.addEventListener('wheel', (e) => { this.orbit.r = clamp(this.orbit.r + e.deltaY * 0.06, 14, 420); }, { passive: true });
  },

  _pause() {
    if (this.state === 'driving') { this.state = 'paused'; document.getElementById('pause').style.display = 'flex'; }
    else if (this.state === 'paused') { this.state = 'driving'; document.getElementById('pause').style.display = 'none'; }
  },

  _board() {
    const el = document.getElementById('board');
    if (el.style.display === 'flex') { el.style.display = 'none'; return; }
    let html = '<h3>' + this.route.title + (this.svc ? ' — ' + this.svc.label : '') + '</h3><table><tr><th>Station</th><th>Sch</th><th>Actual</th></tr>';
    for (const row of this.game.tt || []) {
      html += '<tr><td>' + row.st.n + '</td><td>' + (row.halt ? fmtClock(row.arr) : 'pass') + '</td><td>' + (row.actual != null ? fmtClock(row.actual) + (row.delay > 60 ? ' <b>+' + Math.round(row.delay / 60) + 'm</b>' : '') : '—') + '</td></tr>';
    }
    el.innerHTML = html + '</table>';
    el.style.display = 'flex';
  },

  _map() {
    const el = document.getElementById('mapbox');
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    const cv = document.getElementById('mapcv');
    cv.width = 520; cv.height = 190;
    const ctx = cv.getContext('2d');
    const p = this.path;
    let zn = 1e9, zx = -1e9;
    for (const z of p.zs) { zn = Math.min(zn, z); zx = Math.max(zx, z); }
    const X = (m) => 30 + (m / p.L) * 460, Y = (z) => 165 - ((z - zn) / Math.max(1, zx - zn)) * 140;
    ctx.fillStyle = '#0d1522'; ctx.fillRect(0, 0, 520, 190);
    ctx.strokeStyle = '#3d5a78'; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < p.N; i += 4) { const x = X(i * p.DS), y = Y(p.zs[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = '#ffd76e';
    for (const st of this.route.stations) { ctx.fillRect(X(st.km) - 2, Y(WB.posAt(p, st.km, 0).z) - 2, 5, 5); }
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
    for (const st of this.route.stations) if (st.term || st.km % (5 * KM) < 900) ctx.fillText(st.n.slice(0, 12), X(st.km) + 4, 14);
    ctx.fillStyle = '#ff5340';
    ctx.fillRect(X(this.game.player.s) - 2, Y(WB.posAt(p, this.game.player.s, 0).z) - 3, 5, 7);
    el.style.display = 'block';
  },

  /* ---------------- cameras ---------------- */
  placeCamera(dt) {
    const C = this.r3d.camera, p = this.path, tr = this.game.player;
    const head = WB.posAt(p, tr.s, 0);
    if (this.camMode === 0) { /* cab: behind the cab wall, eye over the console */
      C.position.set(head.x - 2.6, head.y + 3.3 + Math.sin(this.t * 7) * 0.02 * Math.min(tr.v, 15), head.z);
      const ahead = WB.posAt(p, Math.min(p.L, tr.s + 120), 0);
      C.lookAt(ahead.x, ahead.y + 1.8, ahead.z);
    } else if (this.camMode === 1) { /* chase */
      const back = WB.posAt(p, Math.max(0, tr.s - 42), 0);
      const want = new THREE.Vector3(back.x - 30, back.y + 14, back.z + 16);
      C.position.lerp(want, 1 - Math.pow(0.0015, dt));
      C.lookAt(head.x, head.y + 2.5, head.z);
    } else if (this.camMode === 2) { /* orbit */
      const a = this.orbit.az, e = this.orbit.el, r = this.orbit.r;
      C.position.set(head.x + Math.cos(a) * Math.cos(e) * r, head.y + Math.sin(e) * r, head.z + Math.sin(a) * Math.cos(e) * r);
      C.lookAt(head.x, head.y + 2, head.z);
    } else { /* trackside */
      const mPost = Math.round(tr.s / 480) * 480;
      const q = WB.posAt(p, clamp(mPost, 0, p.L), 9);
      C.position.set(q.x, q.y + 2.2, q.z);
      const ahead = WB.posAt(p, tr.s + 10, 0);
      C.lookAt(ahead.x, ahead.y + 2.4, ahead.z);
    }
  },

  /* ---------------- main loop ---------------- */
  t: 0, _last: 0,
  frame(ts) {
    requestAnimationFrame((t2) => this.frame(t2));
    const dtRaw = Math.min(0.1, (ts - this._last) / 1000 || 0.016);
    this._last = ts;
    if (this.state !== 'driving') { if (this.r3d) this.r3d.render(this.r3d.camera); return; }
    const dt = dtRaw * this.timeScale;
    this.t += dt;

    /* player controls (or auto demo driver) */
    const cmd = this.game.cmd;
    if (this.autoDrive) {
      aiDrive(this.game.player, this.game.box, { dt, trains: this.game.trains });
      cmd.throttle = this.game.player.throttle; cmd.brake = this.game.player.brakeCmd;
    } else if (this.keys['ArrowUp']) cmd.throttle = clamp(cmd.throttle + dt * 0.5, 0, 1);
    if (this.keys['ArrowDown']) cmd.throttle = clamp(cmd.throttle - dt * 0.8, 0, 1);
    if (this.keys['ArrowRight']) cmd.brake = clamp(cmd.brake + dt * 0.7, 0, 1);
    if (this.keys['ArrowLeft']) cmd.brake = clamp(cmd.brake - dt * 1.0, 0, 1);
    if (this.keys[' ']) { cmd.brake = 1; cmd.throttle = 0; }
    if (this.game.player.doorsOpen) { cmd.throttle = 0; }

    /* world clock: 1 real s = 30 game s at scale 1 */
    this.tod = (this.tod + (dt * 30) / 3600) % 24;
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.2);
    this.game.wet = this.rain;

    const evs = this.game.advance(dt);
    for (const e of evs) {
      if (e.type === 'stop') { Snd.doorChime(); this.hud(e.n + ' — ' + fmtDelay(e.delay)); Snd.speak(e.n + '. Doors open.'); }
      if (e.type === 'doors') { Snd.whistle(); this.hud('भरा है / khali — doors closing, stand clear'); }
      if (e.type === 'meet') { Snd.horn('emu'); this.hud('Crossing: ' + e.who + ' at ' + e.at); }
      if (e.type === 'spad' && e.who === 'You') this.hud('⚠ SPAD — signal passed at danger');
      if (e.type === 'done') { this.state = 'paused'; this._summary(); }
    }

    /* AI train handles (new spawns) */
    for (const tr of this.game.trains) if (!this.handles.has(tr)) this.handles.set(tr, this.r3d.buildTrain(tr.def, false));
    for (const [tr, h] of this.handles) if (!this.game.trains.includes(tr)) { this.r3d.removeTrain(h); this.handles.delete(tr); }

    /* audio + env */
    const pl = this.game.player;
    Snd.update(dt, { v: pl.v, notch: pl.throttle, brake: pl.brakeCmd, sound: pl.def.sound, inTunnel: inRanges(this.route.tunnels || [], pl.s), rain: this.rain > 0.2 });
    this.r3d.setDayNight(this.tod);
    this.r3d.setWeather(this.rain);
    this.r3d.updateSignals(this.game.box);
    this.r3d.followSun(this.r3d.camera.position);
    this.r3d.updateTrainVisuals(this.game, this.handles);
    this.r3d.setCabView(this.camMode === 0); /* after visuals: overrides lead-car visibility */
    this.placeCamera(dtRaw);
    this.r3d.animateRain(dtRaw, this.r3d.camera.position);
    this.r3d.animateWater(this.t);
    this.r3d.updateNightGlow(this.r3d._day == null ? 1 : this.r3d._day);
    this.r3d.updateCrowdWalk(this.t, this.t);
    this.r3d.animateClouds(dtRaw, this.r3d.camera.position);
    this.r3d.render(this.r3d.camera);
    this._hud();
  },

  _hud() {
    const g = this.game, pl = g.player, el = document.getElementById('hud');
    /* next-station announcement once per approach */
    const ann = g.nextStopInfo ? g.nextStopInfo() : null;
    if (ann && ann.km - pl.s < 750 && this._lastAnn !== ann.n) {
      this._lastAnn = ann.n;
      this.hud('Next station: ' + ann.n + (ann.loc ? '  ·  ' + ann.loc : ''));
      Snd.ding();
      Snd.speak('Next station, ' + ann.n + '.');
      if (ann.loc) Snd.speak('Agla station ' + ann.loc + '.');
    }
    document.getElementById('hSpeed').textContent = (pl.v * 3.6).toFixed(0);
    document.getElementById('hLimit').textContent = (limitAt(this.route, pl.s) * 3.6).toFixed(0);
    const sig = g.nextSignalInfo();
    const sigEl = document.getElementById('hSig');
    if (sig) { sigEl.textContent = sig.aspect.toUpperCase(); sigEl.style.color = sig.aspect === 'red' ? '#ff5340' : sig.aspect === 'green' ? '#3ad96e' : '#ffb300'; }
    else sigEl.textContent = '—';
    const ns = g.nextStopInfo ? g.nextStopInfo() : null;
    document.getElementById('hNext').textContent = ns ? ns.n : this.mode === 'freeroam' ? 'free roam' : fmtKm(pl.s);
    document.getElementById('hClock').textContent = fmtClock(this.tod * 3600);
    document.getElementById('hThrottle').style.width = (pl.throttle * 100).toFixed(0) + '%';
    document.getElementById('hBrake').style.width = (pl.brakeCmd * 100).toFixed(0) + '%';
    document.getElementById('hScore').textContent = (this.autoDrive ? 'AUTO · ' : '') + (this.mode === 'service' ? g.score.stops + '/' + g.score.total + ' on-time · ' + (g.score.spads ? 'SPAD!' : 'clean') : 'free');
  },

  _summary() {
    const g = this.game, el = document.getElementById('pause');
    const mins = Math.round((g.clock - parseClock(this.svc ? this.svc.depart : '00:00')) / 60);
    el.innerHTML = '<div class="card"><h2>Run complete</h2><p>' + g.score.stops + '/' + g.score.total + ' stops on time · ' + (g.score.spads ? g.score.spads + ' SPAD — driving licence reviewed' : 'no SPADs') + '</p><p>Time on cab: ' + mins + ' min</p><button onclick="location.reload()">Back to menu</button></div>';
    el.style.display = 'flex';
  },
};

/* ---------------- menu build ---------------- */
function buildMenu() {
  const list = document.getElementById('routes');
  let html = '';
  for (const r of Object.values(ROUTES)) {
    html += '<div class="route"><div class="rhead"><b>' + r.title + '</b><span>' + r.sub + ' · ' + (r.km).toFixed(0) + ' km · ' + r.stations.length + ' stations</span></div>';
    html += '<div class="svcs"><button class="free" data-route="' + r.id + '">Free roam</button>';
    for (const s of r.services) html += '<button data-route="' + r.id + '" data-svc="' + s.id + '">' + s.label + ' <small>' + s.depart + '</small></button><button data-route="' + r.id + '" data-svc="' + s.id + '" data-auto="1" title="AI drives, you ride along">▶ demo</button>';
    html += '</div></div>';
  }
  list.innerHTML = html;
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const r = ROUTES[b.dataset.route];
    const svc = b.dataset.svc ? r.services.find((s) => s.id === b.dataset.svc) : null;
    App.start(r, svc, svc ? 'service' : 'freeroam');
    if (b.dataset.auto) { App.autoDrive = true; App.camMode = 1; }
  });
}

buildMenu();
App.bind();
requestAnimationFrame((t) => { App._last = t; App.frame(t); });
