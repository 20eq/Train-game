'use strict';
/* ============================================================
   Bharat Rail Sim 3D — train physics & AI driving (fresh engine)
   Tractive effort curves, jerk-limited force build-up, Davis
   resistance, gradient forces, monsoon adhesion, rack mode,
   signal-aware AI with gradient-compensated braking.
   ============================================================ */
function makeTrain(route, def, opts) {
  const o = opts || {};
  let len = 0, mass = 0, axles = 0;
  for (const c of def.cars) { len += c.len; mass += (CAR_MASS[c.k] || 45); axles += 4; }
  mass *= 1000;
  return {
    def, route, label: o.label || def.name,
    track: o.track || 'main',
    s: o.s0 || 0, v: 0, a: 0,
    throttle: 0, brakeCmd: 0,
    len, mass, axles,
    wheelDist: 14,
    stops: (o.stops || []).map((n) => stationByName(route, n)).filter(Boolean),
    stopIdx: 0, dwell: 0, doorsOpen: false,
    ai: o.ai || null, holdKm: o.holdKm != null ? o.holdKm : null,
    grade: 0, wet: 1, chuffPhase: 0, chuffEvent: false,
    arrivedAt: null, done: false,
  };
}
const kmh = (tr) => tr.v * KMH;

function tractiveF(tr) {
  const d = tr.def;
  const cap = Math.min(d.fMax, d.power / Math.max(tr.v, 2.5));
  return cap * tr.throttle * tr.wet;
}
function brakeF(tr) {
  const d = tr.def;
  const cmd = tr.doorsOpen ? Math.max(tr.brakeCmd, 0.85) : tr.brakeCmd; /* parking brake while dwelling */
  const base = d.brake * tr.mass * 0.9 * tr.wet;
  return base * cmd;
}
function davisF(tr) {
  const u = Math.abs(tr.v) * KMH;
  const perT = 2.1 + 0.05 * u + 0.0021 * u * u;
  return (tr.mass / 1000) * perT;
}
function gradeForce(tr) { return tr.mass * G * tr.grade; }

/* advance one train by dt; ctx: { wet (0..1), rack check automatic } */
function stepTrain(tr, dt, ctx) {
  const d = tr.def, r = tr.route;
  ctx = ctx || {};
  tr.wet = ctx.wet ? clamp(1 - 0.30 * ctx.wet, 0.62, 1) : 1;
  tr.grade = gradeAt(r, tr.s);

  let F = tractiveF(tr) - brakeF(tr) - davisF(tr) - gradeForce(tr);
  /* rack sections: grip is positive — full brake authority, low cap */
  const onRack = (r.rackSpans || []).some((sp) => tr.s >= sp[0] * KM && tr.s <= sp[1] * KM);
  if (onRack) {
    F = tractiveF(tr) * 0.8 - davisF(tr) - gradeForce(tr) - (tr.brakeCmd > 0 ? tr.mass * G * Math.abs(tr.grade) * Math.min(tr.brakeCmd * 1.6, 1) * sign(-tr.grade || -1) * 0 : 0);
    if (tr.brakeCmd > 0.2 && tr.v > 0) F -= tr.mass * G * 0.06; /* rack retainer */
  }
  const aT = clamp(F / tr.mass, -1.8, d.cls === 'EMU' ? 1.15 : 0.65);
  /* jerk limit */
  const jMax = 0.65 * (d.jerk || 1);
  tr.a += clamp(aT - tr.a, -jMax * dt, jMax * dt);
  tr.v = Math.max(0, tr.v + tr.a * dt);

  /* speed ceilings: traction vmax, line limit, rack cap */
  let vCap = Math.min(d.vmax, limitAt(r, tr.s));
  if (onRack) vCap = Math.min(vCap, 8.6);
  if (tr.v > vCap) { tr.v = Math.max(vCap, tr.v - 0.55 * dt); tr.a = Math.min(tr.a, 0); }

  const prevS = tr.s;
  tr.s += tr.v * dt;
  const end = routeEnd(r) - 40;
  if (tr.s >= end) { tr.s = end; tr.v = 0; tr.done = true; }
  /* steam chuff events by distance */
  if (d.sound === 'steam') {
    tr.chuffPhase += tr.v * dt / 4.4;
    if (tr.chuffPhase >= 1) { tr.chuffPhase %= 1; tr.chuffEvent = true; }
  }
  return prevS;
}

/* ---------- AI driver ---------- */
const AI_BRAKE_A = 0.72;
function brakeDist(v, extra) { return (v * v) / (2 * AI_BRAKE_A * (extra || 1)); }

function aiDrive(tr, box, ctx) {
  ctx = ctx || {};
  const r = tr.route;
  /* dwelling at a stop */
  if (tr.dwell > 0) {
    tr.dwell -= ctx.dt || 0;
    tr.throttle = 0; tr.brakeCmd = 1;
    if (tr.dwell <= 0) { tr.doorsOpen = false; tr.stopIdx++; }
    return;
  }
  /* targets: hold point, next stop, next red signal, end of line */
  let vT = limitAt(r, tr.s), stopAt = Infinity;
  if (tr.holdKm != null) {
    const dh = tr.holdKm * KM - tr.s;
    if (dh > 6) { vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * AI_BRAKE_A * (dh - 4))) * 0.82); stopAt = tr.holdKm * KM; }
    else { tr.v = 0; return; }
  }
  const stop = tr.stops && tr.stops[tr.stopIdx];
  if (stop) {
    const d = stop.km - tr.s;
    if (d < 900) {
      const vAllow = Math.sqrt(Math.max(0, 2 * AI_BRAKE_A * Math.max(0, d - 14))) * 0.92;
      vT = Math.min(vT, vAllow);
      if (d < 18) {
        tr.v = 0; tr.throttle = 0; tr.brakeCmd = 1;
        tr.doorsOpen = true; tr.dwell = (ctx.dwellS || 22) + (tr.def.cls === 'Express' ? 8 : 0);
        return;
      }
    }
  }
  /* always: don't rear-end anything on the same track (brake like a real driver
     with sight of the train ahead — speed-match, then stop short of it) */
  for (const o of ctx.trains || []) {
    if (o === tr || o.track !== tr.track) continue;
    const gap = o.s - o.len - tr.s - 20;
    if (gap < -5) continue; /* that train is behind us — irrelevant */
    if (gap <= 0) { vT = 0; stopAt = Math.min(stopAt, tr.s + gap); }
    else if (gap < 2200) {
      vT = Math.min(vT, Math.max(0, o.v * 0.92 + Math.min(1.8, gap / 650)));
      const dStop = Math.sqrt(Math.max(0, 2 * AI_BRAKE_A * (gap - 8)));
      vT = Math.min(vT, dStop);
      if (gap < 30) vT = Math.min(vT, 0.6);
    }
  }
  const n = box.nextSignal(tr);
  if (n) {
    if (n.sig.aspect === 'red') {
      const d = Math.max(0, n.dist - 14);
      vT = Math.min(vT, Math.sqrt(2 * AI_BRAKE_A * d) * 0.88);
      if (d < 40 && tr.v > 1) vT = 0;
    } else if (n.sig.aspect === 'yellow') vT = Math.min(vT, 30 * MPS);
    else if (n.sig.aspect === 'yellow2') vT = Math.min(vT, 58 * MPS);
  }
  /* single-line: never enter an occupied section even if signalling missed it */
  if (box.single && ctx.player) {
    const mine = box._sectionOf(tr.s + 10), theirs = box._sectionOf(ctx.player.s + 10);
    if (mine && theirs && mine === theirs && ctx.player.s > tr.s && tr.s < mine.a + 60) {
      tr.v = Math.min(tr.v, 2); tr.throttle = 0; tr.brakeCmd = 1; return;
    }
  }
  /* throttle / brake with gradient compensation */
  const err = vT - tr.v;
  if (err > 0.4) {
    tr.brakeCmd = Math.max(0, tr.brakeCmd - 0.9 * (ctx.dt || 0));
    tr.throttle = clamp(tr.throttle + 0.55 * (ctx.dt || 0) + Math.max(0, tr.grade) * 4, 0, 1);
  } else if (err < -0.3) {
    tr.throttle = 0;
    /* steeper downhill -> stronger brake application */
    const gComp = 1 + Math.max(0, -tr.grade) * 26;
    tr.brakeCmd = clamp(tr.brakeCmd + 1.15 * (ctx.dt || 0) * gComp, 0, Math.min(1, -err / 4 + 0.3));
  } else {
    tr.throttle *= 0.94; tr.brakeCmd *= 0.9;
  }
}
