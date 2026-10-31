'use strict';
/* ============================================================
   Bharat Rail Sim 3D — game core (fresh engine)
   Service / free-roam orchestration, AI traffic director (chase,
   oncoming far-track expresses, single-line loop meets), timetable
   actuals, scoring, SPAD tracking. No DOM, no THREE — QA-drivable.
   ============================================================ */
class Game {
  constructor(route, svc, mode) {
    this.route = route;
    this.svc = svc;
    this.mode = mode || 'service';
    this.clock = parseClock(svc.depart);
    this.end = routeEnd(route);
    this.box = new SignalBox(route, svc);
    this.wet = 0;                 // monsoon intensity 0..1
    this.events = [];
    this.score = { spads: 0, late: 0, stops: 0, total: 0 };
    this.done = false;
    this.tt = svc && this.mode === 'service' ? buildTimetable(route, svc) : [];
    const startStops = svc && svc.stops === 'all'
      ? route.stations.slice(1, -1).map((s) => s.n) : (svc ? svc.stops : []);
    this.player = makeTrain(route, TRAINS[svc ? svc.train : route.services[0].train], {
      s0: 60, stops: this.mode === 'service' ? startStops : [], label: 'You',
    });
    this.cmd = { throttle: 0, brake: 0 };
    this.trains = [this.player];
    this.nextOpp = 0;
    this.rng = mulberry32(hashStr(route.id + (svc ? svc.id : 'free')));
    /* meet AI: spawned at service start, parked before the loop; departs as the
       player approaches, always staying ahead of them */
    const L0 = routeEnd(route);
    this.meets = meetsOf(route, svc).map((cfg) => {
      const loop = stationByName(route, cfg.at);
      const m = { cfg, spawned: false, departed: false, cleared: false, ai: null, stage: '', spawnS: 0, parkS: 0 };
      if (loop) {
        m.spawnS = Math.max(loop.km - cfg.aheadKm * KM - 600, this.player.len + 700);
        m.parkS = loop.km + 85;
        const def = TRAINS[cfg.aiTrain];
        const ai = makeTrain(route, def, { s0: m.spawnS, track: 'main', stops: [], label: cfg.aiLabel });
        ai.holdKm = m.spawnS / KM; /* parked, waiting to depart */
        m.ai = ai; m.spawned = true; m.stage = 'waiting';
        this.trains.push(ai);
      }
      return m;
    });
    this.spawnChase();
    this.t = 0;
  }

  spawnChase() {
    const c = this.svc && this.svc.ai && this.svc.ai.chase;
    if (!c) return;
    const tr = makeTrain(this.route, TRAINS[c.train], {
      s0: Math.min(420 + Math.abs(c.t0 || 0) / 8, 900), track: 'main',
      stops: c.stops === 'all' ? this.route.stations.slice(1, -1).map((s) => s.n) : c.stops,
      label: c.label, ai: { pace: c.pace },
    });
    tr.s = this.player.s + tr.len + 120;   // starts just ahead; dwells let the player catch it
    this.trains.push(tr);
  }

  /* ---------- single-line meet director ---------- */
  updateMeets() {
    for (const m of this.meets) {
      if (!m.spawned) continue;
      const ai = m.ai;
      const loop = stationByName(this.route, m.cfg.at);
      if (!loop) continue;
      const loopM = loop.km;
      if (m.stage === 'waiting' && this.player.s > m.spawnS - 1200) {
        /* depart: race to the loop refuge, always ahead of the player */
        ai.holdKm = m.parkS / KM;
        m.stage = 'running';
        this.events.push({ type: 'meet', at: loop.n, who: m.cfg.aiLabel });
      }
      const inLoop = ai.s > loopM - 170 && ai.s < loopM + 170;
      ai.track = inLoop ? 'loop' : 'main';
      if (inLoop && ai.v < 0.2 && m.stage === 'running') m.stage = 'in loop';
      /* release once the player has passed the loop */
      if (m.stage === 'in loop' && this.player.s > loopM + 260) {
        m.cleared = true; ai.holdKm = null; m.stage = 'departing';
      }
      /* once well clear ahead, hand the train to the 'far' (beyond token section) */
      if (m.cleared && ai.track === 'main' && ai.s - ai.len > this.player.s + 1100) ai.track = 'far';
      /* main-line check: a waiting/running meet AI must never be passed by the player */
      if (!m.cleared && ai.s - ai.len < this.player.s - 5) {
        this.events.push({ type: 'error', who: 'meet ordering broken' });
      }
    }
  }

  /* ---------- oncoming far-track traffic (double line) ---------- */
  updateOpposite(dt) {
    const o = this.svc && this.svc.ai && this.svc.ai.opposite;
    if (!o || !this.route.double) return;
    this.nextOpp -= dt;
    if (this.nextOpp <= 0) {
      const [lo, hi] = o.every;
      this.nextOpp = lo + this.rng() * (hi - lo);
      const def = TRAINS[o.trains[Math.floor(this.rng() * o.trains.length)]];
      const tr = makeTrain(this.route, def, { s0: this.end - 250, track: 'far', label: def.name + ' (Up)' });
      this.trains.push(tr);
      this.events.push({ type: 'oncoming', who: tr.label });
    }
    for (const t of this.trains) if (t.track === 'far' && (t.s < 150 || t.s > this.end - 250)) t.track = 'gone';
    this.trains = this.trains.filter((t) => t.track !== 'gone');
  }

  /* ---------- player stop handling & scoring ---------- */
  playerStop(dt) {
    if (this.mode !== 'service' || this.done) return;
    const row = this.tt.find((r) => r.halt && !r.actual && Math.abs(r.st.km - this.player.s) < 60);
    if (!row) return;
    /* aiDrive owns the stop & dwell; we score the arrival when doors open */
    if (this.player.doorsOpen) {
      row.actual = Math.round(this.clock);
      row.delay = row.actual - row.arr;
      this.score.total++;
      this.score.late += Math.max(0, row.delay || 0);
      if (Math.abs(row.delay || 0) <= 60) this.score.stops++;
      this.events.push({ type: 'stop', n: row.st.n, delay: row.delay || 0 });
    }
  }

  advance(dt) {
    this.events.length = 0;
    if (this.done) return this.events;
    this.t += dt;
    this.clock += dt;
    this.player.throttle = this.cmd.throttle;
    this.player.brakeCmd = this.cmd.brake;
    this.box.update(this.trains);
    const ctx = { dt, wet: this.wet, trains: this.trains, player: this.player };
    /* AI first (they read signals), then integrate everyone */
    for (const tr of this.trains) if (tr !== this.player) aiDrive(tr, this.box, ctx);
    const prev = new Map();
    for (const tr of this.trains) prev.set(tr, stepTrain(tr, dt, { wet: this.wet }));
    for (const tr of this.trains) if (this.box.checkSpad(tr, prev.get(tr))) { this.events.push({ type: 'spad', who: tr.label }); if (tr === this.player) this.score.spads++; }
    /* AI trains that reached the terminus clear the section (platform/siding) */
    for (const tr of this.trains) if (tr !== this.player && tr.done && tr.s >= this.end - 120) tr.track = 'gone';
    this.trains = this.trains.filter((t) => t.track !== 'gone');
    this.updateMeets();
    this.updateOpposite(dt);
    this.playerStop(dt);
    if (this.player.s >= this.end - 60) {
      this.done = true;
      this.events.push({ type: 'done' });
    }
    return this.events;
  }

  /* HUD helpers */
  nextSignalInfo() {
    const n = this.box.nextSignal(this.player);
    if (!n) return null;
    return { aspect: n.sig.aspect, dist: n.dist, km: n.sig.km / KM, kind: n.sig.kind };
  }
  nextStopInfo() {
    if (this.mode !== 'service') return null;
    const row = this.tt.find((r) => r.halt && !r.actual && r.st.km > this.player.s + 5);
    return row ? { n: row.st.n, loc: row.st.loc, km: row.st.km, arr: row.arr, exp: Math.round(this.clock), platform: 1 + (Math.abs(Math.sin(row.st.km)) > 0.5 ? 0 : 1) } : null;
  }
}
