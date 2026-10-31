'use strict';
/* ============================================================
   Bharat Rail Sim — game controller
   ============================================================ */
const Game = {
  state: 'menu', route: null, svc: null, player: null, trains: [],
  signals: [], gates: [], meets: [], sc: null,
  cam: { km: 0, pxPerM: 2, zoom: 1, speed: 0, elevAt: (x) => 0, t: 0 },
  clock: 0, timeScale: 1, warpIdx: 0,
  score: null, keys: {}, lastFrame: 0, acc: 0,
  oppTimer: 8, lightning: 0, flashT: 0,
  weather: 'clear', rainAmt: 0, settings: { sound: true, ann: true },
  best: {},

  /* ---------------- boot ---------------- */
  boot() {
    HUD.init(); Overlays.init();
    this.settings = Object.assign({ sound: true, ann: true }, JSON.parse(localStorage.getItem('brs_set') || '{}'));
    this.best = JSON.parse(localStorage.getItem('brs_best') || '{}');
    Say.on = this.settings.ann;
    this.buildMenu();
    requestAnimationFrame((t) => this.frame(t));
  },

  buildMenu() {
    this.state = 'menu';
    document.body.className = 'in-menu';
    $('menu').classList.remove('hidden');
    $('brief').classList.add('hidden');
    $('playWrap').classList.add('hidden');
    const grid = $('routeGrid');
    grid.innerHTML = '';
    for (const r of Object.values(ROUTES)) {
      const svc = r.services[0];
      const tr = TRAINS[svc.train];
      const card = document.createElement('div');
      card.className = 'card theme-' + r.theme;
      card.innerHTML = `
        <div class="card-art"></div>
        <div class="card-body">
          <div class="card-city">${r.city}</div>
          <h3>${r.title}</h3>
          <div class="card-sub">${r.sub} · ${r.km.toFixed(0)} km</div>
          <div class="card-tags"><span class="tag">${r.badge}</span><span class="tag">${r.double ? 'Double line' : 'Single line'}</span><span class="tag">${r.electrified ? '25 kV AC' : 'Diesel'}</span>${r.rack ? '<span class="tag">Rack</span>' : ''}</div>
          <div class="card-svc">${svc.label} · ${TRAINS[svc.train].cls} · ${'★'.repeat(svc.difficulty)}</div>
        </div>`;
      card.onclick = () => this.openBrief(r.id);
      grid.appendChild(card);
    }
    Snd.stopAll();
  },

  openBrief(routeId) {
    this.route = ROUTES[routeId];
    this.state = 'brief';
    $('menu').classList.add('hidden');
    const b = $('brief');
    b.classList.remove('hidden');
    $('briefTitle').textContent = this.route.title + ' — ' + this.route.city;
    const svcList = $('svcList');
    svcList.innerHTML = '';
    for (const svc of this.route.services) {
      const tr = TRAINS[svc.train];
      const div = document.createElement('div');
      div.className = 'svc';
      const tt = svc.timetable;
      div.innerHTML = `
        <div class="svc-head"><b>${svc.label}</b><span>${tr.name}</span></div>
        <div class="svc-meta">${tr.desc}</div>
        <div class="svc-row"><span>Departs ${svc.depart} · ${tt[tt.length - 1].st.n} ${fmtClock(tt[tt.length - 1].arr)} · ${tt.filter(x => x.halt).length} halts</span></div>
        <button class="startBtn" data-svc="${svc.id}">▶ Drive this service</button>`;
      svcList.appendChild(div);
    }
    svcList.querySelectorAll('.startBtn').forEach((btn) => {
      btn.onclick = () => this.start(this.route.id, btn.dataset.svc, { tod: $('todSel').value, weather: $('wxSel').value });
    });
  },

  /* ---------------- scenario setup ---------------- */
  start(routeId, svcId, opts) {
    const r = ROUTES[routeId];
    const svc = r.services.find((s) => s.id === svcId);
    this.route = r; this.svc = svc;
    this.state = 'play';
    document.body.className = 'in-play';
    $('menu').classList.add('hidden'); $('brief').classList.add('hidden'); $('playWrap').classList.remove('hidden');
    $('hud').classList.remove('hidden');
    $('results').classList.add('hidden'); $('crash').classList.add('hidden'); $('pause').classList.add('hidden');

    // weather / time
    this.weather = (opts && opts.weather) || 'clear';
    this.rainAmt = this.weather === 'monsoon' ? 1 : 0;
    const departS = parseClock(svc.depart);
    this.clock = departS - 20;
    if (opts && opts.tod && opts.tod !== 'auto') {
      this.todOffset = ({ dawn: 6.2 - (departS / 3600), noon: 12.5 - departS / 3600, dusk: 18.1 - departS / 3600, night: 22.5 - departS / 3600 })[opts.tod] || 0;
    } else this.todOffset = 0;

    // world
    this.sc = Scenery.generate(r);
    this.signals = Signals.build(r);
    this.gates = Gates.build(r);

    // player
    const p = makeTrain(svc.train, { s: 0, label: svc.label });
    p.dir = 1;
    p.plan = svc.timetable.map((row, i) => ({
      st: row.st, i, arr: row.arr, dep: row.dep, halt: row.halt,
      ideal: row.st.km + Math.max(row.st.plat * 0.35, Math.min(row.st.plat + 25, p.def.length * 0.72)),
      state: i === 0 ? 'boarding' : 'pending',
      acc: null, done: false, announced: false,
    }));
    p.destText = svc.ann || '';
    p.doorState = 'open'; p.doorAnim = 0;
    p.boardT = 18; // pre-departure boarding
    p.berthed = true; // we start berthed at the origin platform
    p.rainFactor = this.rainAmt ? 0.85 : 1;
    this.player = p;
    this.trains = [p];
    // origin station is already "done" (we start berthed there); departure earliness checked separately
    p.plan[0].done = true; p.plan[0].state = 'boarding';
    p._originDep = svc.timetable[0].dep;

    // ideal stop for draw
    for (const row of r.stations) delete row.stopKm;
    for (const pl of p.plan) pl.st.stopKm = pl.ideal;

    // signals state
    for (const s of this.signals) s.aspect = 'G';

    // chase AI (same track, ahead)
    this.oppTimer = 20 + Math.random() * 30;
    this.meets = (svc.meets || []).map((m) => Object.assign({ spawned: false, cleared: false }, m));
    if (svc.ai && svc.ai.chase) {
      const c = svc.ai.chase;
      const at = makeTrain(c.train, { s: 0, dir: 1, label: c.label, ai: { plan: buildAiPlan(r, c.stops, c.dwell, TRAINS[c.train].length), opposite: false } });
      at.destText = '—';
      at.rainFactor = this.rainAmt ? 0.85 : 1;
      at.throttle = 0.6;
      const ctx = this.simCtx();
      preSim(at, -c.t0, ctx); // t0 negative => ran for -t0 seconds already
      this.trains.push(at);
    }

    // scoring
    this.score = {
      pts: 100, spads: 0, overspeedT: 0, jerkPen: 0, doorPen: 0, haltAcc: [], lcBonus: 0, delayFinal: 0, paxDelivered: 0,
    };
    this.timeScale = 1; this.warpIdx = 0; HUD.set('warpBtn', '1×');
    Overlays.buildTimetable(svc.timetable);
    Overlays.markRow(1, 'next');
    this.particles = new Particles(260);
    this.msg('Signalling cleared. ' + svc.label + ' ready to depart.', 3500);
    if (this.weather === 'monsoon') setTimeout(() => this.msg('⛈ Monsoon conditions — expect longer braking.', 4000), 3600);
    Snd.init(); if (this.settings.sound) { Snd.resume(); } else Snd.setMuted(true);
    if (Snd.ready) Snd.hiss(true);
    this.lastFrame = performance.now();
  },

  simCtx() {
    return { route: this.route, grads: this.route.gradList, limits: this.route.limits, signals: this.signals, elevAt: this.route.elevAt };
  },

  quitToMenu() {
    this.state = 'menu';
    Snd.stopAll();
    $('hud').classList.add('hidden');
    this.buildMenu();
  },

  /* ---------------- main loop ---------------- */
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.06, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    if (this.state === 'play') {
      const simDt = dt * this.timeScale;
      this.update(simDt, dt);
    }
    if (this.state === 'play' || this.state === 'crash' || this.state === 'done') this.render(dt);
  },

  update(dt, realDt) {
    const r = this.route, p = this.player;
    this.cam.t += dt;
    this.clock += dt;
    // substep physics
    const steps = Math.min(8, Math.ceil(dt / 0.025));
    const h = dt / steps;
    const ctx = this.simCtx();
    for (let i = 0; i < steps; i++) {
      this.applyInput(h);
      for (const t of this.trains) {
        if (t !== p) aiDrive(t, h, this.aiCtx(t));
        stepTrain(t, h, ctx);
      }
      this.checkWorld(h);
    }

    // signal occupancy & aspects
    this.updateSignals();

    // player station logic
    this.stationLogic(dt);

    // AI traffic
    this.dispatchAI(dt);
    this.trains = this.trains.filter((t) => !t.despawn);

    // meets
    this.updateMeets();

    // gates
    Gates.update(this.gates, this.trains.filter((t) => !t.despawn), dt, true);

    // camera
    const lead = Math.min(50, 10 + p.v * 1.3);
    const target = p.s + lead;
    this.cam.km += (target - this.cam.km) * Math.min(1, dt * 3.2);
    this.cam.speed = p.v;
    this.cam.zoom = this.cam.zoom; // user adjustable
    this.cam.pxPerM = clamp((window.innerWidth * 0.72) / p.def.length, 1.05, 2.5) * this.cam.zoom;
    this.cam.elevAt = r.elevAt;

    // particles
    this.updateParticles(dt);

    // audio
    Snd.update(dt, {
      v: p.v, notch: p.throttle, brake: p.brakeCmd, sound: p.sound, wheelDist: p.wheelDist,
      inTunnel: inRanges(r.tunnels || [], p.s), rain: this.rainAmt > 0,
    });
    if (p.def.sound === 'steam' && p.chuffEvent) { p.chuffEvent = false; if (this.settings.sound) Snd.chuff(p.throttle); }
    // opposite AI horns
    for (const t of this.trains) {
      if (t !== p && !t._horned && Math.abs(t.s - p.s) < 120 && t.dir !== p.dir) {
        t._horned = true;
        if (this.settings.sound && Math.random() < 0.8) Snd.aiHorn(t.horn, 0.4);
      }
    }
    // lightning
    if (this.rainAmt > 0) {
      this.lightning -= dt;
      if (this.lightning <= 0) { this.lightning = 18 + Math.random() * 30; this.flashT = 0.4; if (this.settings.sound) Snd.thunder(); }
      this.flashT = Math.max(0, this.flashT - dt);
    }

    // HUD
    this.updateHUD(dt);
    // timetable live
    const next = p.plan.find((x) => !x.done);
    if (next) Overlays.markRow(next.i, 'next');

    // results / crash handled in checkWorld
  },

  aiCtx(t) {
    return { route: this.route, grads: this.route.gradList, limits: this.route.limits, signals: this.signals, sameTrack: t.track !== 'far' ? this.player : null, elevAt: this.route.elevAt };
  },

  applyInput(dt) {
    const p = this.player;
    if (this.state !== 'play' || p.crashed) return;
    const k = this.keys;
    // throttle
    if (k.ArrowUp || k.KeyW) {
      p.throttle = clamp(p.throttle + dt * 0.7, 0, 1);
      // direct-release brake: applying power bleeds the brake off
      if (!k.ArrowRight && !k.KeyD && !p.emerg) p.brakeCmd = clamp(p.brakeCmd - dt * 1.4, 0, 1);
    }
    if (k.ArrowDown || k.KeyS) p.throttle = clamp(p.throttle - dt * 0.9, 0, 1);
    // brake
    if (k.ArrowRight || k.KeyD) { p.brakeCmd = clamp(p.brakeCmd + dt * 0.8, 0, 1); p.throttle = Math.min(p.throttle, 0.05); }
    if (k.ArrowLeft || k.KeyA) p.brakeCmd = clamp(p.brakeCmd - dt * 1.1, 0, 1);
    if (k.Space && !p._emgLatch) { p.emerg = !p.emerg; p._emgLatch = true; if (p.emerg && Snd.ready && this.settings.sound) Snd.hiss(true); }
    if (!k.Space) p._emgLatch = false;
  },

  keydown(e) {
    const k = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
    const playing = this.state === 'play' || this.state === 'pause';
    if (k === 'Tab' && playing) e.preventDefault();
    this.keys[k] = true;
    const p = this.player;
    if (this.state !== 'play' && this.state !== 'pause') {
      if (k === 'Escape' && this.state === 'brief') this.buildMenu();
      return;
    }
    if (k === 'Escape') { this.togglePause(); return; }
    if (this.state === 'pause') return;
    if (!p) return;
    if (k === 'KeyH') { Snd.init(); Snd.resume(); this._hornHeld = true; Snd.hornStart(p.horn); }
    if (k === 'KeyP' && p.def.pantoCars) { p.panto = !p.panto; if (Snd.ready && this.settings.sound) Snd.hiss(false); this.msg(p.panto ? 'Pantograph raised' : 'Pantograph lowered — traction off!', 1800); }
    if (k === 'KeyL') p.lights = !p.lights;
    if (k === 'KeyT') this.cycleWarp();
    if (k === 'Tab') this.toggleOverlay('ttOverlay');
    if (k === 'KeyM') this.toggleOverlay('mapOverlay');
    if (k === 'Equal' || k === 'NumpadAdd') this.cam.zoom = clamp(this.cam.zoom * 1.15, 0.55, 2.2);
    if (k === 'Minus' || k === 'NumpadSubtract') this.cam.zoom = clamp(this.cam.zoom / 1.15, 0.55, 2.2);
  },
  keyup(e) {
    this.keys[e.code] = false;
    if (e.code === 'KeyH') { this._hornHeld = false; Snd.hornEnd(); }
  },

  cycleWarp() {
    const opts = [1, 2, 4, 8];
    this.warpIdx = (this.warpIdx + 1) % opts.length;
    this.timeScale = opts[this.warpIdx];
    HUD.set('warpBtn', this.timeScale + '×');
    this.msg('Time compression ' + this.timeScale + '×', 1200);
  },

  togglePause() {
    if (this.state === 'play') { this.state = 'pause'; $('pause').classList.remove('hidden'); Snd.stopAll(); }
    else if (this.state === 'pause') { this.state = 'play'; $('pause').classList.add('hidden'); this.lastFrame = performance.now(); }
  },
  toggleOverlay(id) {
    const el = $(id);
    const show = el.classList.contains('hidden');
    $('ttOverlay').classList.add('hidden'); $('mapOverlay').classList.add('hidden');
    if (show) {
      el.classList.remove('hidden');
      if (id === 'mapOverlay') Overlays.drawMap($('mapCanvas'), this);
    }
  },

  /* ---------------- signalling ---------------- */
  updateSignals() {
    const occ = [];
    for (const t of this.trains) {
      if (t === this.player || t.track === 'far' || (t.ai && t.ai.onLoop)) continue;
      const rear = Math.min(t.s, t.rear), head = Math.max(t.s, t.rear);
      const b0 = Signals.blockOf(this.signals, rear + 2), b1 = Signals.blockOf(this.signals, head - 2);
      for (let b = b0; b <= b1; b++) if (b >= 0 && !occ.includes(b)) occ.push(b);
    }
    occ.sort((a, b) => a - b);
    this.occ = occ;
    for (const s of this.signals) s.aspect = Signals.aspectFor(this.signals, s.idx, occ);
  },

  /* ---------------- stations & scoring ---------------- */
  stationLogic(dt) {
    const p = this.player, r = this.route;
    const next = p.plan.find((x) => !x.done);
    // approach announcement
    if (next && !next.announced) {
      const d = next.st.km - p.s;
      if (d < 1100 && d > 0) {
        next.announced = true;
        if (this.settings.sound) Say.station(next.st.n, r.annLang, next.st.loc, !next.halt);
        if (next.halt) this.msg('Approaching ' + next.st.n + ' — brake for the platform.', 2600);
      }
    }
    // berthing
    if (next && !p.berthed) {
      const err = p.s - next.ideal;
      const inZone = p.s > next.st.km - 25 && p.s < next.st.km + next.st.plat + 70;
      if (p.v < 0.25 && inZone && Math.abs(err) <= 55) {
        p.berthed = true;
        const acc = Math.abs(err) <= 3 ? 25 : Math.abs(err) <= 8 ? 20 : Math.abs(err) <= 15 ? 13 : Math.abs(err) <= 28 ? 7 : 3;
        next.acc = acc;
        this.score.haltAcc.push(acc);
        const delay = this.clock - next.arr;
        Overlays.setActual(next.i, fmtClock(this.clock) + (delay > 45 ? ` (+${fmtDur(delay)})` : ''), delay);
        if (next.halt) {
          next.state = 'boarding';
          p.doorState = 'open'; p.doorAnim = 0;
          p.boardT = this.svc.dwell + (r.rack ? 15 : 0);
          p.passengers += 40 + Math.random() * 60;
          if (delay > 120) this.score.pts -= 3;
          this.msg(`🛑 ${next.st.n} — stop ${err >= 0 ? '+' : ''}${err.toFixed(0)} m. Boarding…`, 2400);
        } else {
          this.finishRun();
          return;
        }
      } else if ((p.s > next.ideal + 70 && p.v > 2) || (p.v < 0.3 && p.s > next.ideal + 55) || (p.v < 0.3 && p.s > next.st.km + next.st.plat + 90)) {
        if (!next.halt) { this.finishRun(); return; }
        // blew through the halt (or crept past it)
        next.done = true; next.acc = 0; next.missed = true;
        this.score.haltAcc.push(0);
        this.score.pts -= 12;
        this.msg('❌ Halt at ' + next.st.n + ' MISSED — passengers left behind!', 3200);
        if (this.settings.sound) Say.warn('Station ' + next.st.n + ' skipped!');
        Overlays.setActual(next.i, 'skipped', 9999);
      }
    }
    // boarding / departure
    if (p.berthed) {
      const cur = p.plan.find((x) => x.state === 'boarding' || x.state === 'ready');
      if (cur && cur.state === 'boarding') {
        p.boardT -= dt;
        p.doorAnim = 1;
        if (p.boardT <= 6 && !cur._beeped) { cur._beeped = true; if (this.settings.sound) Snd.doorBeeps(3); }
        if (p.boardT <= 1.2 && !cur._whistled) { cur._whistled = true; if (this.settings.sound) Snd.guardWhistle(); }
        if (p.boardT <= 0) {
          p.doorState = 'closing';
          cur.state = 'ready';
          this.msg('Doors closing — ready to depart ' + cur.st.n, 2000);
        }
      }
      // jumped the gun while boarding?
      if (cur && cur.state === 'boarding' && p.throttle > 0.15 && p.boardT > 1 && !cur._early) {
        cur._early = true;
        const pen = Math.min(8, p.boardT * 0.25);
        this.score.doorPen += pen;
        this.msg('Passengers still boarding! (−' + pen.toFixed(0) + ')', 2200);
        cur.state = 'ready';
      }
      if (cur && cur.state === 'ready' && p.doorState === 'closing') {
        p.doorAnim = clamp((p.doorAnim || 1) - dt * 0.5, 0, 1);
        if (p.doorAnim <= 0.05) p.doorState = 'closed';
      }
      if (p.v > 0.4 && this.clock < p._originDep - 40 && !p._earlyDep) {
        p._earlyDep = true;
        this.score.doorPen += 4;
        this.msg('Departing before path time — the section may not be clear!', 2600);
      }
      if (cur && p.v > 0.4) { // departed
        cur.done = true; cur.state = 'departed';
        p.berthed = false;
        Overlays.markRow(Math.min(cur.i + 1, p.plan.length - 1), 'next');
      }
    }
    // terminal complete?
    const last = p.plan[p.plan.length - 1];
    if (last.done && this.state === 'play' && p.v < 0.3 && p.s > last.st.km - 30) this.finishRun();
  },

  updateMeets() {
    const p = this.player;
    for (const m of this.meets) {
      const st = stationByName(this.route, m.at);
      if (!m.spawned && st.km - p.s < m.triggerKm * KM && p.s < st.km) {
        m.spawned = true;
        const ai = makeTrain(m.aiTrain, { s: st.km + m.aheadKm * KM, dir: -1, label: m.aiLabel, ai: { stopAt: st.km + st.plat * 0.55, opposite: true } });
        ai.destText = '—';
        ai.rainFactor = this.rainAmt ? 0.85 : 1;
        this.trains.push(ai);
        m.train = ai;
        this.msg('⚠ Single line: opposing train ' + m.aiLabel + ' — hold at signal.', 4200);
        if (this.settings.sound) Say.warn('Line clear report: opposing train crossing at ' + m.at + '.');
      }
      if (m.train && m.train.ai.arrived && !m.cleared) {
        m.cleared = true;
        m.train.track = 'far';
        m.train.ai.onLoop = true;
        this.msg('✔ Loop cleared — line ahead ' + m.at + '→' + (this.route.stations[this.route.stations.indexOf(st) + 1] || { n: 'end' }).n + ' is yours.', 3600);
      }
      if (m.train && m.cleared && p.s > st.km + 2500) m.train.despawn = true;
    }
  },

  dispatchAI(dt) {
    const r = this.route, svc = this.svc;
    const ai = svc.ai && svc.ai.opposite;
    if (!ai) return;
    // AI traffic: passing trains on the far track
    this.oppTimer -= dt;
    if (this.oppTimer <= 0) {
      this.oppTimer = ai.every[0] + Math.random() * (ai.every[1] - ai.every[0]);
      const defId = ai.trains[(Math.random() * ai.trains.length) | 0];
      const t = makeTrain(defId, { s: r.km * KM + 60, dir: -1, label: 'Passing train', ai: { opposite: true, pace: TRAINS[defId].vmax * 3.6 * (0.5 + Math.random() * 0.4) } });
      t.track = 'far';
      t.destText = '—';
      t.rainFactor = this.rainAmt ? 0.85 : 1;
      t.throttle = 0.8;
      this.trains.push(t);
    }
    for (const t of this.trains) {
      if (t === this.player) continue;
      // opposing pass-through trains leave at the start end
      if (t.ai && t.ai.opposite && t.dir === -1 && !t.ai.stopAt && t.s < -t.def.length - 50) t.despawn = true;
      // chase AI leaves after the route end
      if (t.dir === 1 && t.ai && !t.ai.opposite && !t.ai.stopAt && t.s > this.route.km * KM + 300) t.despawn = true;
    }
  },

  checkWorld(dt) {
    const p = this.player, r = this.route;
    if (this.state !== 'play') return;
    // SPAD
    for (const s of this.signals) {
      if (this._prevS !== undefined && this._prevS < s.km && p.s >= s.km) {
        if (s.aspect === 'R' && p.v > 1.2) {
          this.score.spads++;
          this.score.pts -= 25;
          p.emerg = true;
          this.msg('🚨 SIGNAL PASSED AT DANGER! Emergency brakes.', 4000);
          if (this.settings.sound) Say.warn('You have passed a signal at danger!');
        }
      }
    }
    this._prevS = p.s;
    // overspeed
    const limit = limitAt(r.limits, p.s / KM);
    const over = p.v * 3.6 - limit;
    if (over > 3) {
      this._overspeedFlash = true;
      if (over > 12) { this.score.overspeedT += dt; this.score.pts -= dt * 2; }
      if (over > 30) { p.emerg = true; this.msg('🚨 SEVERE OVERSPEED — emergency brake applied.', 3000); }
    } else this._overspeedFlash = false;
    // horn bonus at level crossings
    if (this._hornHeld) {
      for (const g of this.gates) {
        const d = g.km - p.s;
        if (d > 0 && d < 350 && !g._thanked) { g._thanked = true; this.score.lcBonus += 2; }
      }
    }
    // collision (same track)
    for (const t of this.trains) {
      if (t === p || t.track === 'far' || (t.ai && t.ai.onLoop) || t.despawn) continue;
      const pMin = Math.min(p.s, p.rear), pMax = Math.max(p.s, p.rear);
      const tMin = Math.min(t.s, t.rear), tMax = Math.max(t.s, t.rear);
      if (pMax > tMin + 2 && pMin < tMax - 2) { this.crash(t); return; }
    }
    // derailed off end? buffer stop at route extremity
    if (p.s > r.km * KM + 400) { p.s = r.km * KM + 400; if (p.v > 2) this.msg('⚠ Buffer stop!', 1500); p.v = 0; }
  },

  crash(other) {
    this.state = 'crash';
    this.player.v = 0; other.v = 0;
    Snd.stopAll();
    if (this.settings.sound) { Snd.thunder(); Snd.aiHorn('loco', 1); }
    $('crash').classList.remove('hidden');
    $('crashInfo').textContent = `Collision with ${other.label} at ${fmtClock(this.clock)}. All stops cancelled.`;
  },

  finishRun() {
    if (this.state !== 'play') return;
    this.state = 'done';
    Snd.stopAll();
    const p = this.player, sc = this.score;
    const tt = this.svc.timetable;
    sc.delayFinal = Math.max(0, this.clock - tt[tt.length - 1].arr);
    const punct = clamp(100 - (sc.delayFinal / 60) * 9, 0, 100);
    const smooth = clamp(100 - sc.jerkPen - sc.doorPen, 0, 100);
    const sigDisc = clamp(100 - sc.spads * 30, 0, 100);
    const speedDisc = clamp(100 - sc.overspeedT * 3, 0, 100);
    const stops = sc.haltAcc.length ? (sc.haltAcc.reduce((a, b) => a + b, 0) / (sc.haltAcc.length * 25)) * 100 : 100;
    const total = clamp(punct * 0.3 + smooth * 0.15 + sigDisc * 0.2 + speedDisc * 0.15 + stops * 0.2 + sc.lcBonus, 0, 100);
    const stars = total >= 92 ? 5 : total >= 78 ? 4 : total >= 60 ? 3 : total >= 40 ? 2 : 1;
    // persist best
    const key = this.route.id + '/' + this.svc.id;
    if (!this.best[key] || this.best[key].total < total) {
      this.best[key] = { total, stars, delay: sc.delayFinal };
      localStorage.setItem('brs_best', JSON.stringify(this.best));
    }
    $('resStars').textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    $('resTitle').textContent = stars >= 4 ? 'Excellent run, Driver!' : stars === 3 ? 'Good run.' : 'Room for improvement.';
    $('resStats').innerHTML = `
      <div><label>Punctuality</label><b>${Math.round(punct)}</b><span>${sc.delayFinal > 30 ? fmtDelay(sc.delayFinal) : 'On time'}</span></div>
      <div><label>Station stops</label><b>${Math.round(stops)}</b><span>${sc.haltAcc.filter(a => a >= 20).length}/${sc.haltAcc.length} good</span></div>
      <div><label>Signal discipline</label><b>${Math.round(sigDisc)}</b><span>${sc.spads} SPAD</span></div>
      <div><label>Speed limits</label><b>${Math.round(speedDisc)}</b><span>${Math.round(sc.overspeedT)}s over</span></div>
      <div><label>Smooth driving</label><b>${Math.round(smooth)}</b><span>${sc.doorPen > 3 ? 'doors/stranding' : 'clean'}</span></div>
      <div><label>Passengers delivered</label><b>${Math.round(p.passengers)}</b><span>to ${this.svc.to}</span></div>`;
    $('resTotal').textContent = Math.round(total) + ' / 100';
    $('results').classList.remove('hidden');
  },

  msg(txt, ms) { HUD.showBanner(txt, '', ms); },

  /* ---------------- particles ---------------- */
  updateParticles(dt) {
    const p = this.player;
    if (p.def.sound === 'steam' && p.throttle > 0.05) {
      const rate = dt * (4 + p.throttle * 26);
      this._steamAcc = (this._steamAcc || 0) + rate;
      while (this._steamAcc > 1) {
        this._steamAcc -= 1;
        this.particles.emit(p.s + 2.5, -(CAR_H.steam * 3 * this.cam.pxPerM) - 6, 'steam', 0.4 + p.throttle);
      }
    }
    if (p.def.sound === 'diesel' && p.throttle > 0.1) {
      this._exAcc = (this._exAcc || 0) + dt * 6;
      while (this._exAcc > 1) { this._exAcc -= 1; this.particles.emit(p.s - 6, -(CAR_H['loco-d'] * 3 * this.cam.pxPerM) - 4, 'exhaust', 0.5); }
    }
    this.particles.update(dt);
  },

  /* ---------------- HUD ---------------- */
  updateHUD(dt) {
    const p = this.player, r = this.route;
    const next = p.plan.find((x) => !x.done);
    if (next) {
      const d = Math.max(0, next.st.km - p.s);
      HUD.set('nsName', next.st.n);
      HUD.set('nsLocal', next.st.loc || '');
      HUD.set('nsDist', d > 950 ? (d / KM).toFixed(1) + ' km' : Math.round(d) + ' m');
      const eta = p.v > 1 ? this.clock + d / Math.max(p.v, 2) : next.arr;
      HUD.set('nsEta', fmtClock(Math.min(eta, next.arr + 3600)));
      const delay = this.clock - next.arr;
      HUD.set('nsLate', delay > 60 ? `· ${fmtDelay(delay)}` : '');
    } else {
      HUD.set('nsName', this.svc.to); HUD.set('nsDist', '');
    }
    HUD.set('clock', fmtClock(this.clock));
    const ttEnd = this.svc.timetable[this.svc.timetable.length - 1];
    HUD.set('delay', this.clock < ttEnd.arr ? fmtDelay(this.clock - ttEnd.arr) : '—');
    // signal
    const sig = Signals.nextAhead(this.signals, p.s);
    if (sig) {
      const d = sig.km - p.s;
      HUD.setSignal(sig.aspect, (sig.kind === 'auto' ? 'Auto ' : '') + sig.name, d > 30 ? d / KM : d / 1000);
    } else HUD.setSignal('G', '—', null);
    // gauge
    const limit = limitAt(r.limits, p.s / KM);
    HUD.drawGauge(p.v * 3.6, p.def.vmax, p.throttle, p.brakeCmd, p.emerg, this._overspeedFlash);
    HUD.set('limitVal', String(limit));
    $('limitCircle').className = this._overspeedFlash ? 'over' : '';
    HUD.set('thrNotch', p.emerg ? 'EMG' : 'N' + Math.round(p.throttle * 8));
    HUD.set('brkNotch', p.emerg ? 'EMG' : p.brakeCmd < 0.02 ? 'REL' : 'B' + Math.round(p.brakeCmd * 10));
    HUD.setLever('thrBar', p.throttle); HUD.setLever('brkBar', p.emerg ? 1 : p.brakeCmd);
    HUD.set('score', String(Math.max(0, Math.round(this.score.pts + this.score.lcBonus))));
    HUD.set('pax', String(Math.round(p.passengers)));
    // altitude/grade
    const elev = r.elevAt(p.s / KM);
    const gr = gradeAt(r.gradList, p.s / KM);
    const gmax = Math.max(...r.gradients.map(g2 => Math.abs(g2[2])));
    if (gmax > 0.004) {
      HUD.set('elev', String(Math.round(elev)));
      const grTxt = Math.abs(gr) < 0.0005 ? '— level' : `1/${Math.round(1 / Math.abs(gr))} ${gr > 0 ? '↑ climb' : '↓ fall'}`;
      HUD.set('gradeRow', 'Grade ' + grTxt);
    } else { HUD.set('elev', '—'); HUD.set('gradeRow', r.cat + ' · ' + (r.double ? 'Double line' : 'Single line')); }
  },

  /* ---------------- render ---------------- */
  render(dt) {
    const cv = $('game'), ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const tod = (this.clock / 3600 + this.todOffset + 24) % 24;
    const v = makeView(ctx, W, H, this.cam, this.route, this.sc, tod, this.weather);
    v.cam.t = this.cam.t * 1000;

    drawSky(v);
    drawHills(v);
    drawSea(v);
    drawSkyline(v);
    drawTunnelShells(v);
    drawGround(v);
    drawCatenary(v);
    drawItems(v, 'far');
    drawStations(v);
    // far-track trains
    for (const t of this.trains) {
      if (t === this.player || t.track === 'far') drawTrainFull(v, t, { far: true });
    }
    // near-track trains
    for (const t of this.trains) {
      if (t !== this.player && t.track !== 'far') drawTrainFull(v, t, { far: false });
    }
    drawTrainFull(v, this.player, { far: false });
    this.particles.draw(v);
    drawItems(v, 'near');
    drawTunnelInteriors(v);
    // night
    if (v.nightF > 0.02) { ctx.fillStyle = `rgba(10,14,38,${0.4 * v.nightF})`; ctx.fillRect(0, 0, W, H); }
    drawGates(v, this.gates);
    for (const s of this.signals) drawSignal(v, s, s.aspect);
    drawBoards(v);
    drawWeather(v, this.rainAmt);
    if (this.flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flashT * 0.5})`; ctx.fillRect(0, 0, W, H); }
    // map overlay live
    if (!$('mapOverlay').classList.contains('hidden')) Overlays.drawMap($('mapCanvas'), this);
  },
};

/* ---------------- input wiring ---------------- */
document.addEventListener('keydown', (e) => Game.keydown(e));
document.addEventListener('keyup', (e) => Game.keyup(e));
window.addEventListener('blur', () => { if (Game.state === 'play') Game.togglePause(); });

function bindUI() {
  document.addEventListener('DOMContentLoaded', () => {});
}
window.addEventListener('DOMContentLoaded', () => {
  Game.boot();
  // touch / mouse HUD buttons
  const hold = (id, code) => {
    const el = $(id);
    if (!el) return;
    const dn = (e) => { e.preventDefault(); Game.keys[code] = true; };
    const up = (e) => { e.preventDefault(); Game.keys[code] = false; };
    el.addEventListener('pointerdown', dn); el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
  };
  hold('emgBtn', 'Space'); hold('hornBtn', 'KeyH');
  // discrete buttons
  document.addEventListener('click', (e) => {
    const id = e.target.id;
    if (id === 'warpBtn') Game.cycleWarp();
    if (id === 'mapBtn') Game.toggleOverlay('mapOverlay');
    if (id === 'ttBtn') Game.toggleOverlay('ttOverlay');
    if (id === 'pauseBtn') Game.togglePause();
    if (id === 'resMenuBtn') Game.quitToMenu();
    if (id === 'resRetryBtn') Game.start(Game.route.id, Game.svc.id, { tod: 'auto', weather: Game.weather });
    if (id === 'crashRetryBtn') Game.start(Game.route.id, Game.svc.id, { tod: 'auto', weather: Game.weather });
    if (id === 'crashMenuBtn') Game.quitToMenu();
    if (id === 'pauseResume') Game.togglePause();
    if (id === 'pauseRestart') { $('pause').classList.add('hidden'); Game.state = 'play'; Game.start(Game.route.id, Game.svc.id, { tod: 'auto', weather: Game.weather }); }
    if (id === 'pauseMenu') Game.quitToMenu();
  });
});
