import * as THREE from 'three';
import { R3D } from './render3d.js';

/* ============================================================
   Bharat Rail Sim 3D — game controller
   Reuses: TRAINS/ROUTES/THEMES, physics.js, signalling.js, audio.js
   ============================================================ */
const $id = (i) => document.getElementById(i);

const G3D = {
  state: 'picker', // picker | loading | play | pause | done | crash
  route: null, svc: null, mode: 'service', // service | roam
  clock: 0, todOffset: 0, rainAmt: 0, timeScale: 1,
  trains: [], player: null, built: new Map(),
  cam: { mode: 0, yaw: 0.4, pitch: 0.3, dist: 42, ts: null },
  keys: {}, last: 0, oppTimer: 30, meets: [], score: null,
  lightning: 20, flash: 0, miniT: 0, drag: null,

  /* ---------------- picker & boot ---------------- */
  boot() {
    this.canvas = $id('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 6000);
    this.bindInput();
    this.buildPicker();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    window.onerror = (m) => { const e = $id('err'); if (e) { e.textContent = 'Error: ' + m; e.classList.remove('hidden'); } };
    requestAnimationFrame((t) => this.frame(t));
  },

  buildPicker() {
    const grid = $id('pickGrid');
    grid.innerHTML = '';
    for (const r of Object.values(ROUTES)) {
      const card = document.createElement('div');
      card.className = 'pcard theme-' + r.theme;
      card.innerHTML = `<div class="pcard-art"></div><div class="pcard-b">
        <div class="pcity">${r.city}</div><h3>${r.title}</h3>
        <div class="psub">${r.sub} · ${r.km.toFixed(0)} km · ${r.badge}</div>
        <div class="pbtns">
          <button data-m="service">🚉 Service run</button>
          <button data-m="roam" class="ghost">🧭 Free roam</button>
        </div></div>`;
      card.querySelectorAll('button').forEach((b) => {
        b.onclick = (e) => { e.stopPropagation(); this.launch(r.id, b.dataset.m, $id('todSel').value, $id('wxSel').value); };
      });
      grid.appendChild(card);
    }
    $id('picker').classList.remove('hidden');
  },

  launch(routeId, mode, tod, wx) {
    $id('picker').classList.add('hidden');
    const lo = $id('loading');
    lo.classList.remove('hidden');
    $id('loadTip').textContent = ROUTES[routeId].title;
    this.state = 'loading';
    setTimeout(() => { try { this.start(routeId, mode, tod, wx); } catch (e) { $id('err').textContent = 'Load failed: ' + e.message; $id('err').classList.remove('hidden'); } lo.classList.add('hidden'); }, 60);
  },

  start(routeId, mode, tod, wx) {
    const r = ROUTES[routeId];
    this.route = r; this.mode = mode;
    // signals for the sim (2-D logic reused)
    this.signals = Signals.build(r);
    for (const s of this.signals) s.aspect = 'G';
    r.signals3d = this.signals;
    this.path = World3D.buildPath(r);
    this.scat = World3D.scatter(r, this.path);
    const built = R3D.buildScene(r, this.path, this.scat);
    this.scene = built.scene; this.env = built;
    this.hemi = built.hemi; this.sun = built.sun;

    // weather & time
    this.rainAmt = wx === 'monsoon' ? 1 : 0;
    this.env.rain.material.opacity = this.rainAmt * 0.55;
    this.scene.fog.near = this.rainAmt ? 120 : 350;
    this.scene.fog.far = this.rainAmt ? 1500 : 3200;
    const svc = r.services[0];
    this.svc = mode === 'service' ? svc : null;
    const dep = parseClock(this.svc ? this.svc.depart : '10:00');
    this.clock = dep - 20;
    this.todOffset = tod === 'auto' ? 0 : ({ dawn: 6.2, noon: 12.5, dusk: 18.1, night: 22.5 })[tod] - dep / 3600;

    // player
    const p = makeTrain(this.svc ? this.svc.train : r.services[0].train, { s: 0, label: this.svc ? this.svc.label : 'Free roam' });
    p.rainFactor = this.rainAmt ? 0.85 : 1;
    p.throttle = 0; p.brakeCmd = 1;
    if (this.svc) {
      p.plan = this.svc.timetable.map((row, i) => ({
        st: row.st, i, arr: row.arr, dep: row.dep, halt: row.halt,
        ideal: row.st.km + Math.max(row.st.plat * 0.35, Math.min(row.st.plat + 25, p.def.length * 0.72)),
        state: i === 0 ? 'boarding' : 'pending', acc: null, done: false, announced: false,
      }));
      p.plan[0].done = true; p.plan[0].state = 'boarding';
      p._originDep = this.svc.timetable[0].dep;
      this.clock = parseClock(this.svc.depart) - 20;
    }
    p.berthed = true; p.boardT = 15; p.doorState = 'open';
    this.player = p;
    this.trains = [p];
    this.built.clear();
    this.built.set(p, R3D.buildTrain(p.def));
    this.scene.add(this.built.get(p).grp);

    // chase AI
    this.meets = [];
    this.oppTimer = 25 + Math.random() * 30;
    if (this.svc && this.svc.ai && this.svc.ai.chase) {
      const c = this.svc.ai.chase;
      const at = makeTrain(c.train, { s: 0, dir: 1, label: c.label, ai: { plan: buildAiPlan(r, c.stops, c.dwell, TRAINS[c.train].length), opposite: false } });
      at.rainFactor = p.rainFactor; at.throttle = 0.5;
      preSim(at, -c.t0, this.simCtx());
      this.trains.push(at);
      this.findBuilt(at);
    }

    // scoring / hud
    this.score = { pts: 100, spads: 0, overT: 0, haltAcc: [], lcBonus: 0, delayF: 0 };
    this.timeScale = 1;
    if (this.svc) this.buildTT();
    $id('hud').classList.remove('hidden');
    $id('modeBadge').textContent = mode === 'roam' ? 'FREE ROAM · ' + r.title : this.svc.label + ' · ' + r.title;
    this.state = 'play';
    this.cam.mode = 1; this.cam.yaw = 0.4; this.cam.pitch = 0.32; this.cam.dist = 40;
    Snd.init(); if (Snd.ready) Snd.resume();
    this.msg(mode === 'roam' ? 'Free roam — explore the line. C to change camera.' : 'Signalling cleared. ' + this.svc.label + ' ready to depart.', 3600);
  },

  findBuilt(t) { // ensure every train has a mesh
    if (!this.built.get(t)) { const b = R3D.buildTrain(t.def); this.built.set(t, b); this.scene.add(b.grp); }
    return this.built.get(t);
  },

  simCtx() { return { route: this.route, grads: this.route.gradList, limits: this.route.limits, signals: this.signals, elevAt: this.route.elevAt }; },

  /* ---------------- loop ---------------- */
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    if (this.state === 'play') {
      const sdt = dt * this.timeScale;
      const steps = Math.min(6, Math.ceil(sdt / 0.03));
      const h = sdt / steps;
      for (let i = 0; i < steps; i++) this.step(h);
      this.envUpd(sdt);
    }
    if (['play', 'pause', 'done', 'crash'].includes(this.state)) this.renderFrame(dt);
  },

  step(dt) {
    const p = this.player, r = this.route;
    this.clock += dt;
    this.applyInput(dt);
    const ctx = this.simCtx();
    for (const t of this.trains) {
      if (t !== p) aiDrive(t, dt, ctx);
      stepTrain(t, dt, ctx);
    }
    // signals
    const occ = [];
    for (const t of this.trains) {
      if (t.track === 'far' || (t.ai && t.ai.onLoop)) continue;
      const b0 = Signals.blockOf(this.signals, Math.min(t.s, t.rear) + 2), b1 = Signals.blockOf(this.signals, Math.max(t.s, t.rear) - 2);
      for (let b = b0; b <= b1; b++) if (b >= 0 && !occ.includes(b)) occ.push(b);
    }
    occ.sort((a, b) => a - b);
    for (const s of this.signals) s.aspect = Signals.aspectFor(this.signals, s.idx, occ);
    this.updateSignalsVis();
    // stations
    if (this.mode === 'service') this.stationLogic(dt);
    // AI spawner
    this.aiSpawn(dt);
    this.trains = this.trains.filter((t) => !t.despawn);
    // gates
    Gates.update(this.gates3dSim || (this.gates3dSim = this.env.gates.map((g) => ({ km: g.x, id: g.x, closed: 0, bell: 0 }))), this.trains, dt, true);
    this.env.gates.forEach((g3, i) => {
      const g = this.gates3dSim[i];
      const target = g.closed ? 0 : -Math.PI / 2;
      for (const { piv } of g3.pivots) piv.rotation.x = lerp(piv.rotation.x, target, Math.min(1, dt * 2));
    });
    // collisions
    for (const t of this.trains) {
      if (t === p || t.track === 'far' || (t.ai && t.ai.onLoop) || t.despawn) continue;
      if (Math.max(p.s, p.rear) > Math.min(t.s, t.rear) + 2 && Math.min(p.s, p.rear) < Math.max(t.s, t.rear) - 2) return this.crash(t);
    }
    // SPAD & overspeed
    const prev = this._prevS === undefined ? p.s : this._prevS;
    for (const s of this.signals) {
      if (prev < s.km && p.s >= s.km && s.aspect === 'R' && p.v > 1.2) {
        this.score.spads++; this.score.pts -= 25; p.emerg = true;
        this.msg('🚨 Signal passed at DANGER — emergency brake!', 3600);
      }
    }
    this._prevS = p.s;
    const lim = limitAt(r.limits, p.s / KM);
    this.overFlash = (p.v * 3.6 - lim) > 3;
    if (p.v * 3.6 - lim > 12) { this.score.overT += dt; this.score.pts -= dt * 2; }
    if (p.s > r.km * KM + 400) { p.s = r.km * KM + 400; p.v = 0; }
    // audio
    Snd.update(dt, { v: p.v, notch: p.throttle, brake: p.brakeCmd, sound: p.def.sound, wheelDist: p.wheelDist, inTunnel: inRanges(r.tunnels || [], p.s), rain: this.rainAmt > 0 });
    if (p.def.sound === 'steam' && p.chuffEvent) { p.chuffEvent = false; Snd.chuff(p.throttle); }
  },

  stationLogic(dt) {
    const p = this.player;
    const next = p.plan.find((x) => !x.done);
    if (next && !p.berthed) {
      const err = p.s - next.ideal;
      const inZone = p.s > next.st.km - 25 && p.s < next.st.km + next.st.plat + 70;
      if (p.v < 0.25 && inZone && Math.abs(err) <= 55) {
        p.berthed = true;
        const acc = Math.abs(err) <= 3 ? 25 : Math.abs(err) <= 8 ? 20 : Math.abs(err) <= 15 ? 13 : Math.abs(err) <= 28 ? 7 : 3;
        next.acc = acc; this.score.haltAcc.push(acc);
        const delay = this.clock - next.arr;
        this.setActual(next.i, fmtClock(this.clock) + (delay > 45 ? ` (+${fmtDur(delay)})` : ''), delay);
        if (next.halt) {
          next.state = 'boarding';
          p.boardT = this.svc.dwell + (this.route.rack ? 15 : 0);
          p.doorState = 'open';
          p.passengers += 40 + Math.random() * 60;
          this.msg(`🛑 ${next.st.n} — stop ${err >= 0 ? '+' : ''}${err.toFixed(0)} m. Boarding…`, 2400);
        } else { this.finish(); return; }
      } else if ((p.s > next.ideal + 70 && p.v > 2) || (p.v < 0.3 && p.s > next.ideal + 55)) {
        if (!next.halt) { this.finish(); return; }
        next.done = true; next.acc = 0; this.score.haltAcc.push(0); this.score.pts -= 12;
        this.msg('❌ Halt at ' + next.st.n + ' MISSED!', 3000);
        this.setActual(next.i, 'skipped', 9999);
      }
    }
    if (p.berthed) {
      const cur = p.plan.find((x) => x.state === 'boarding' || x.state === 'ready');
      if (cur && cur.state === 'boarding') {
        p.boardT -= dt;
        if (p.boardT <= 6 && !cur._b) { cur._b = 1; Snd.doorBeeps(3); }
        if (p.boardT <= 1.2 && !cur._w) { cur._w = 1; Snd.guardWhistle(); }
        if (p.boardT <= 0) { p.doorState = 'closing'; cur.state = 'ready'; this.msg('Doors closing — ready to depart ' + cur.st.n, 1800); }
      }
      if (cur && cur.state === 'boarding' && p.throttle > 0.15 && p.boardT > 1) { cur.state = 'ready'; this.score.pts -= 2; this.msg('Passengers still boarding! (−2)', 1600); }
      if (cur && p.v > 0.4) { cur.done = true; cur.state = 'departed'; p.berthed = false; }
    }
    const last = p.plan[p.plan.length - 1];
    if (last.done && p.v < 0.3 && p.s > last.st.km - 30) this.finish();
  },

  aiSpawn(dt) {
    const r = this.route;
    const cfg = this.svc && this.svc.ai && this.svc.ai.opposite;
    if (cfg) {
      this.oppTimer -= dt;
      if (this.oppTimer <= 0) {
        this.oppTimer = cfg.every[0] + Math.random() * (cfg.every[1] - cfg.every[0]);
        const defId = cfg.trains[(Math.random() * cfg.trains.length) | 0];
        const t = makeTrain(defId, { s: r.km * KM + 60, dir: -1, label: 'Passing train', ai: { opposite: true, pace: TRAINS[defId].vmax * 3.6 * (0.5 + Math.random() * 0.4) } });
        t.track = 'far'; t.rainFactor = this.player.rainFactor; t.throttle = 0.8;
        this.trains.push(t);
      }
    }
    // meets (single line)
    for (const m of (this.svc && this.svc.meets) || []) {
      const st = stationByName(r, m.at);
      if (!m.spawned && st.km - this.player.s < m.triggerKm * KM && this.player.s < st.km) {
        m.spawned = true;
        const ai = makeTrain(m.aiTrain, { s: st.km + m.aheadKm * KM, dir: -1, label: m.aiLabel, ai: { stopAt: st.km + st.plat * 0.55, opposite: true } });
        ai.rainFactor = this.player.rainFactor;
        this.trains.push(ai); m.train = ai;
        this.msg('⚠ Single line: opposing ' + m.aiLabel + ' — hold at signal.', 4200);
      }
      if (m.train && m.train.ai.arrived && !m.cleared) { m.cleared = true; m.train.track = 'far'; m.train.ai.onLoop = true; this.msg('✔ Loop cleared — line ahead is yours.', 3000); }
      if (m.train && m.cleared && this.player.s > st.km + 2500) m.train.despawn = true;
    }
    for (const t of this.trains) {
      if (t === this.player) continue;
      if (t.ai && t.ai.opposite && t.dir === -1 && !t.ai.stopAt && t.s < -t.def.length - 50) t.despawn = true;
      if (t.dir === 1 && t.ai && !t.ai.stopAt && t.s > r.km * KM + 300) t.despawn = true;
    }
  },

  applyInput(dt) {
    const p = this.player, k = this.keys;
    if (this.state !== 'play' || p.crashed) return;
    if (k.ArrowUp || k.KeyW) { p.throttle = clamp(p.throttle + dt * 0.7, 0, 1); if (!k.ArrowRight && !p.emerg) p.brakeCmd = clamp(p.brakeCmd - dt * 1.4, 0, 1); }
    if (k.ArrowDown || k.KeyS) p.throttle = clamp(p.throttle - dt * 0.9, 0, 1);
    if (k.ArrowRight || k.KeyD) { p.brakeCmd = clamp(p.brakeCmd + dt * 0.8, 0, 1); p.throttle = Math.min(p.throttle, 0.05); }
    if (k.ArrowLeft || k.KeyA) p.brakeCmd = clamp(p.brakeCmd - dt * 1.1, 0, 1);
    if (k.Space && !p._l) { p.emerg = !p.emerg; p._l = 1; if (p.emerg) Snd.hiss(true); }
    if (!k.Space) p._l = 0;
  },

  crash(other) {
    this.state = 'crash'; this.player.v = 0; other.v = 0; Snd.stopAll(); Snd.thunder();
    $id('crashInfo').textContent = `Collision with ${other.label} at ${fmtClock(this.clock)}.`;
    $id('crash').classList.remove('hidden');
  },

  finish() {
    if (this.state !== 'play') return;
    this.state = 'done'; Snd.stopAll();
    const sc = this.score, tt = this.svc.timetable;
    sc.delayF = Math.max(0, this.clock - tt[tt.length - 1].arr);
    const punct = clamp(100 - (sc.delayF / 60) * 9, 0, 100);
    const stops = sc.haltAcc.length ? sc.haltAcc.reduce((a, b) => a + b, 0) / (sc.haltAcc.length * 25) * 100 : 100;
    const sig = clamp(100 - sc.spads * 30, 0, 100);
    const spd = clamp(100 - sc.overT * 3, 0, 100);
    const total = clamp(punct * 0.35 + stops * 0.25 + sig * 0.25 + spd * 0.15 + sc.lcBonus, 0, 100);
    const stars = total >= 92 ? 5 : total >= 78 ? 4 : total >= 60 ? 3 : total >= 40 ? 2 : 1;
    $id('resStars').textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    $id('resStats').textContent = `Punctuality ${Math.round(punct)} · Stops ${Math.round(stops)} · Signals ${Math.round(sig)} · Speed ${Math.round(spd)} — Total ${Math.round(total)}/100`;
    $id('results').classList.remove('hidden');
  },

  quit() { this.state = 'picker'; Snd.stopAll(); $id('hud').classList.add('hidden'); ['ttOverlay', 'mapOverlay', 'results', 'crash', 'pause'].forEach(i => $id(i).classList.add('hidden')); this.buildPicker(); },

  /* ---------------- environment ---------------- */
  envUpd(dt) {
    const p = this.player;
    const tod = ((this.clock / 3600 + this.todOffset) % 24 + 24) % 24;
    const sunH = Math.sin((tod - 6) / 12 * Math.PI);
    const duskF = clamp(1 - Math.abs(sunH) / 0.26, 0, 1);
    const night = clamp((0.1 - sunH) / 0.22, 0, 1);
    const th = THEMES[this.route.theme];
    const dayTop = new THREE.Color(th.sky.dayTop), dayBot = new THREE.Color(th.sky.dayBot);
    const duskTop = new THREE.Color(th.sky.duskTop), duskBot = new THREE.Color(th.sky.duskBot);
    const nTop = new THREE.Color(th.sky.nightTop), nBot = new THREE.Color(th.sky.nightBot);
    const top = dayTop.clone().lerp(duskTop, duskF).lerp(nTop, night);
    const bot = dayBot.clone().lerp(duskBot, duskF).lerp(nBot, night);
    this.env.sky.top.value.copy(top); this.env.sky.bot.value.copy(bot);
    this.renderer.setClearColor(bot);
    const ang = (tod - 6) / 12 * Math.PI;
    const px = this.player ? World3D.posAt(this.path, this.player.s, 0) : { x: 0, y: 0, z: 0 };
    this.sun.position.set(px.x + Math.cos(ang) * 800, 60 + Math.max(0, sunH) * 700 + 40, px.z + 300);
    this.sun.target.position.set(px.x, px.y, px.z);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = (0.15 + Math.max(0, sunH) * 1.5) * (1 - night * 0.85);
    this.hemi.intensity = 0.25 + Math.max(0, sunH) * 0.75 + duskF * 0.1;
    const dirV = new THREE.Vector3().subVectors(this.sun.position, this.camera.position).normalize();
    this.env.sunDisc.position.copy(this.camera.position).addScaledVector(dirV, 4600);
    this.env.sunDisc.material.color.setHex(night > 0.5 ? 0xd8e0f0 : 0xffeeb0);
    this.env.stars.material.opacity = night * 0.9;
    this.scene.fog.color.copy(bot);
    // lightning
    if (this.rainAmt > 0) {
      this.lightning -= dt;
      if (this.lightning <= 0) { this.lightning = 16 + Math.random() * 26; this.flash = 0.35; Snd.thunder(); }
      this.flash = Math.max(0, this.flash - dt);
      this.hemi.intensity += this.flash * 3;
      // rain follows camera
      const rp = this.env.rain.geometry.attributes.position;
      const cp = this.camera.position;
      for (let i = 0; i < rp.count; i++) {
        let y = rp.getY(i) - dt * 34;
        if (y < 0) { y = 38; rp.setX(i, cp.x + (Math.random() - 0.5) * 90); rp.setZ(i, cp.z + (Math.random() - 0.5) * 90); }
        rp.setY(i, y);
      }
      rp.needsUpdate = true;
    }
    // headlight
    const pb = this.findBuilt(this.player);
    pb.head.intensity = night > 0.25 ? 2.4 : 0;
  },

  updateSignalsVis() {
    for (const s of this.env.signals) {
      const a = s.sig.aspect;
      for (const L of s.lamps) {
        const on = (L.k === 'g' && a === 'G') || (L.k === 'y1' && (a === 'Y' || a === 'YY')) || (L.k === 'y2' && a === 'YY') || (L.k === 'r' && a === 'R');
        L.m.color.setHex(on ? s.cols[L.k[0]] : 0x26262a);
      }
    }
  },

  /* ---------------- camera ---------------- */
  updateCamera(dt) {
    const p = this.player, cam = this.cam;
    const head = World3D.posAt(this.path, p.s, 0);
    const modes = ['cab', 'chase', 'orbit', 'trackside'];
    $id('camLabel').textContent = '📷 ' + modes[cam.mode];
    if (cam.mode === 0) { // cab: driver's eye just inside the lead car nose
      const lead = p.def.cars[0].len / 2 - 1.4;
      this.camera.position.set(head.x + head.tx * lead, head.y + 3.7, head.z + head.tz * lead);
      const look = World3D.posAt(this.path, p.s + 140, 0);
      this.camera.lookAt(look.x, look.y + 2.2, look.z);
      // subtle sway
      this.camera.position.y += Math.sin(this.clock * 2.2) * 0.03 * Math.min(1, p.v / 8);
    } else if (cam.mode === 1) { // chase
      cam.dist = lerp(cam.dist, 30 + p.v * 0.6, dt * 2);
      const off = cam.dist;
      const cy = Math.atan2(-head.tz, head.tx);
      const ex = head.x - Math.cos(cy) * off, ez = head.z + Math.sin(cy) * off;
      this.camera.position.lerp(new THREE.Vector3(ex, head.y + 11, ez), Math.min(1, dt * 3.5));
      this.camera.lookAt(head.x, head.y + 2.4, head.z);
    } else if (cam.mode === 2) { // orbit around player
      const d = cam.dist, cy = cam.yaw, cp = cam.pitch;
      this.camera.position.set(
        head.x + Math.cos(cy) * Math.cos(cp) * d,
        head.y + 3 + Math.sin(cp) * d,
        head.z + Math.sin(cy) * Math.cos(cp) * d
      );
      this.camera.lookAt(head.x, head.y + 2.5, head.z);
    } else { // trackside: fixed post every 700 m
      const ti = Math.floor((p.s - 60) / 700);
      const ts = clamp(ti * 700, 0, this.path.L - 10);
      if (cam.ts !== ts) { cam.ts = ts; cam.tsP = World3D.posAt(this.path, ts, 14); cam.tsP.y += 5; }
      this.camera.position.copy(cam.tsP);
      this.camera.lookAt(head.x, head.y + 2, head.z);
    }
  },

  renderFrame(dt) {
    for (const t of this.trains) R3D.poseTrain(t, this.path, this.findBuilt(t));
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 0.12) { this.hudT = 0; this.updateHUD(); }
    this.miniT += dt;
    if (this.miniT > 0.5) { this.miniT = 0; this.drawMini($id('mini'), false); if (!$id('mapOverlay').classList.contains('hidden')) this.drawMini($id('bigMap'), true); }
  },

  /* ---------------- HUD ---------------- */
  msg(t, ms) { const b = $id('banner'); b.textContent = t; b.classList.remove('hidden'); clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.add('hidden'), ms || 2400); },

  updateHUD() {
    const p = this.player, r = this.route;
    $id('spd').textContent = Math.round(p.v * 3.6);
    $id('spdOver').className = this.overFlash ? 'over' : '';
    $id('thr').style.height = Math.round(p.throttle * 100) + '%';
    $id('brk').style.height = Math.round((p.emerg ? 1 : p.brakeCmd) * 100) + '%';
    $id('notch').textContent = p.emerg ? 'EMG' : 'N' + Math.round(p.throttle * 8);
    $id('clk').textContent = fmtClock(this.clock);
    const sig = Signals.nextAhead(this.signals, p.s);
    if (sig) {
      const map = { G: ['#2fbf4f', 'CLEAR'], YY: ['#f5c518', 'ATTENTION'], Y: ['#f5c518', 'CAUTION'], R: ['#e8352c', 'DANGER'] };
      const m = map[sig.aspect];
      $id('sigLamp').style.background = m[0];
      $id('sigAsp').textContent = m[1];
      $id('sigDist').textContent = ((sig.km - p.s) / 1000).toFixed(2) + ' km';
    }
    if (this.mode === 'service') {
      const next = p.plan.find((x) => !x.done);
      if (next) {
        $id('nsName').textContent = next.st.n;
        $id('nsLocal').textContent = next.st.loc || '';
        const d = Math.max(0, next.st.km - p.s);
        $id('nsDist').textContent = d > 950 ? (d / KM).toFixed(1) + ' km' : Math.round(d) + ' m';
      }
      $id('score').textContent = Math.max(0, Math.round(this.score.pts + this.score.lcBonus));
      $id('pax').textContent = Math.round(p.passengers);
      $id('alt').textContent = Math.round(r.elevAt(p.s / KM)) + 'm';
    } else {
      $id('nsName').textContent = 'Free roam';
      $id('nsDist').textContent = (p.s / KM).toFixed(1) + ' km';
    }
  },

  buildTT() {
    const tb = $id('ttBody');
    tb.innerHTML = '';
    this.ttRows = [];
    this.svc.timetable.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.st.n}</td><td>${fmtClock(row.arr)}</td><td>${row.halt ? fmtClock(row.dep) : '—'}</td><td class="actual" id="a3d${i}">—</td>`;
      tb.appendChild(tr); this.ttRows.push(tr);
    });
  },
  setActual(i, txt, late) {
    const e = $id('a3d' + i);
    if (e) { e.textContent = txt; e.className = 'actual ' + (late > 60 ? 'late' : late > 15 ? 'minor' : 'ok'); }
  },

  drawMini(cv, big) {
    if (!cv || !this.path) return;
    const c = cv.getContext('2d');
    const W = cv.width = big ? Math.min(880, innerWidth - 100) : 230, H = cv.height = big ? Math.min(300, innerHeight - 200) : 74;
    const path = this.path;
    let minX = 0, maxX = path.L, minZ = 1e9, maxZ = -1e9;
    for (const z of path.zs) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const pad = 14;
    const sx = (m) => pad + (m / maxX) * (W - pad * 2);
    const sz = (z) => H - pad - ((z - minZ) / Math.max(1, maxZ - minZ)) * (H - pad * 2);
    c.fillStyle = '#0e1420'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#5a6675'; c.lineWidth = big ? 3 : 2;
    c.beginPath();
    for (let i = 0; i < path.N; i += 4) { const X = sx(path.xs[i]), Z = sz(path.zs[i]); i === 0 ? c.moveTo(X, Z) : c.lineTo(X, Z); }
    c.stroke();
    c.fillStyle = '#8a97a8'; c.font = big ? '11px sans-serif' : '8px sans-serif'; c.textAlign = 'center';
    for (const st of this.route.stations) {
      const X = sx(st.km), Z = sz(path.zs[Math.round(st.km / World3D.DS)]);
      c.fillStyle = st.term ? '#f2c518' : '#cfd6de';
      c.fillRect(X - 1.5, Z - 1.5, 3, 3);
      if (big) c.fillText(st.n, X, Z - 6);
    }
    for (const t of this.trains) {
      if (t.despawn) continue;
      const X = sx(clamp(t.s, 0, maxX)), Z = sz(path.zs[clamp(Math.round(t.s / World3D.DS), 0, path.N - 1)]);
      c.fillStyle = t === this.player ? '#f2c518' : '#5aa2e0';
      c.beginPath(); c.arc(X, Z, big ? 5 : 3.4, 0, 7); c.fill();
    }
    c.fillStyle = '#68727f'; c.textAlign = 'left';
    c.fillText('0 km', pad, H - 3); c.textAlign = 'right'; c.fillText((maxX / KM).toFixed(0) + ' km', W - pad, H - 3);
  },

  /* ---------------- input ---------------- */
  bindInput() {
    document.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Tab' && this.state === 'play') e.preventDefault();
      this.keys[e.code] = true;
      if (this.state !== 'play') { if (e.code === 'Escape' && this.state === 'pause') this.togglePause(); return; }
      if (e.code === 'KeyH') { Snd.init(); Snd.resume(); Snd.hornStart(this.player.horn); }
      if (e.code === 'KeyC') this.cam.mode = (this.cam.mode + 1) % 4;
      if (e.code === 'Digit1') this.cam.mode = 0;
      if (e.code === 'Digit2') this.cam.mode = 1;
      if (e.code === 'Digit3') this.cam.mode = 2;
      if (e.code === 'Digit4') this.cam.mode = 3;
      if (e.code === 'KeyT') this.cycleWarp();
      if (e.code === 'Tab') this.toggleOv('ttOverlay');
      if (e.code === 'KeyM') this.toggleOv('mapOverlay');
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyP' && this.player.def.pantoCars) { this.player.panto = !this.player.panto; this.msg(this.player.panto ? 'Pantograph raised' : '⚠ Pantograph lowered — traction off!', 1800); }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyH') Snd.hornEnd(); });
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.cam.yaw += (e.clientX - this.drag.x) * 0.005;
      this.cam.pitch = clamp(this.cam.pitch + (e.clientY - this.drag.y) * 0.004, 0.05, 1.35);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.drag = null));
    cv.addEventListener('wheel', (e) => { this.cam.dist = clamp(this.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 8, 300); e.preventDefault(); }, { passive: false });
    document.addEventListener('click', (e) => {
      const id = e.target.id;
      if (id === 'pauseBtn') this.togglePause();
      if (id === 'resumeBtn') this.togglePause();
      if (id === 'quitBtn' || id === 'crashQuit' || id === 'resQuit') this.quit();
      if (id === 'crashRetry' || id === 'resRetry') { ['crash', 'results', 'pause'].forEach(i => $id(i).classList.add('hidden')); this.start(this.route.id, this.mode, $id('todSel').value, $id('wxSel').value); }
      if (id === 'ttBtn') this.toggleOv('ttOverlay');
      if (id === 'mapBtn') this.toggleOv('mapOverlay');
      if (id === 'camBtn') this.cam.mode = (this.cam.mode + 1) % 4;
      if (id === 'hornBtn') { Snd.init(); Snd.resume(); Snd.hornStart(this.player ? this.player.horn : 'loco'); setTimeout(() => Snd.hornEnd(), 900); }
      if (id === 'warpBtn') this.cycleWarp();
    });
  },
  togglePause() {
    if (this.state === 'play') { this.state = 'pause'; $id('pause').classList.remove('hidden'); Snd.stopAll(); }
    else if (this.state === 'pause') { this.state = 'play'; $id('pause').classList.add('hidden'); this.last = performance.now(); }
  },
  toggleOv(id) {
    const el = $id(id);
    const show = el.classList.contains('hidden');
    $id('ttOverlay').classList.add('hidden'); $id('mapOverlay').classList.add('hidden');
    if (show) el.classList.remove('hidden');
  },
  cycleWarp() {
    const o = [1, 2, 4, 8];
    this._wi = ((this._wi || 0) + 1) % 4;
    this.timeScale = o[this._wi];
    $id('warpBtn').textContent = this.timeScale + '×';
    this.msg('Time compression ' + this.timeScale + '×', 1100);
  },
  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  },
};
window.G3D = G3D;
G3D.boot();
