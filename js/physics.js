'use strict';
/* ============================================================
   Bharat Rail Sim — train physics & AI driver
   ============================================================ */
function makeTrain(defId, opts) {
  const def = TRAINS[defId];
  const t = {
    def, id: defId, dir: (opts && opts.dir) || 1,
    s: (opts && opts.s) || 0,   // head position along route (m)
    v: 0, throttle: 0, brakeCmd: 0, emerg: false,
    fApplied: 0, a: 0,
    label: (opts && opts.label) || def.name,
    ai: (opts && opts.ai) || null,   // {plan:[{km, dwell}], pace, t0, despawnKm}
    dwell: 0, berthed: false,
    panto: def.power && !def.aiOnly ? true : !!def.pantoCars,
    lights: true, wheelDist: 0, chuffPhase: 0,
    passengers: 0, boardT: 0, doorState: 'closed',
    sound: def.sound, horn: def.horn,
    rainFactor: 1,
    crashed: false, despawn: false,
    stopsDone: {}, nextStopIdx: 0,
  };
  if (t.ai && t.ai.nextStopIdx === undefined) t.ai.nextStopIdx = 0;
  Object.defineProperty(t, 'head', { get() { return t.s; } });
  Object.defineProperty(t, 'rear', { get() { return t.s - t.def.length * t.dir; } });
  return t;
}

/* physics step. ctx: {route, limits, grads, elevFn, weatherRain} */
function stepTrain(t, dt, ctx) {
  if (t.crashed) { t.v = Math.max(0, t.v - 2 * dt); t.s += t.v * t.dir * dt; return; }
  const def = t.def;
  const kmHere = t.s / KM;
  const grade = gradeAt(ctx.grads, kmHere);
  const limit = limitAt(ctx.limits, kmHere) * MPS;

  // traction
  let F = 0;
  const hasPanto = !def.pantoCars || t.panto;
  if (t.throttle > 0 && hasPanto && !t.emerg && t.brakeCmd < 0.9) {
    const powerF = def.power / Math.max(t.v, 1.8);
    const taper = clamp((def.vmax - t.v) / (def.vmax * 0.07), 0, 1);
    F = t.throttle * Math.min(def.fMax, powerF) * taper * t.rainFactor * (def.rack ? 1 : t.rainFactor * 0 + 1);
    if (def.rack) F = t.throttle * Math.min(def.fMax, def.power / Math.max(t.v, 1.2)); // rack: no adhesion limit
  }
  // brakes
  const bCmd = t.emerg ? 1 : t.brakeCmd;
  let Fb = bCmd * def.brake * def.mass * (def.rack && grade < 0 ? 1.15 : 1);
  if (t.emerg) Fb = def.emerg * def.mass;
  if (!hasPanto && def.pantoCars) F = 0;
  // resistance (per mass) — Davis-like
  const v = t.v;
  const Fres = def.mass * (0.0035 + 0.00003 * v + 0.00012 * v * v) * Math.sign(v || 1);
  // rolling (small constant when moving)
  const Froll = def.mass * 0.0006 * Math.sign(v || (F > 0 ? 1 : 0));
  // integrate force with jerk limiting
  const target = F - Fb - Fres - Froll;
  const maxD = def.jerk * def.mass * dt * (t.emerg ? 4 : 1);
  t.fApplied += clamp(target - t.fApplied, -maxD, maxD);
  let a = t.fApplied / def.mass - G * grade;
  // rack self-hold on downhill: pinion brakes keep below 20
  if (def.rack && grade < -0.005 && bCmd === 0) a = Math.min(a, 0);
  t.a = a;
  t.v = Math.max(0, t.v + a * dt);
  const ds = t.v * t.dir * dt;
  t.s += ds; t.wheelDist += Math.abs(ds);
  // steam chuff phase: 4 beats per wheel rev
  if (def.sound === 'steam') {
    const circ = 3.4;
    const ph = t.wheelDist / circ;
    if ((ph | 0) > (t.chuffPhase | 0) && t.throttle > 0) { t.chuffEvent = true; }
    t.chuffPhase = ph;
  }
}

/* ---------- AI driver ---------- */
function aiDrive(t, dt, ctx) {
  const ai = t.ai;
  if (!ai) return;
  const def = t.def;
  const limit = limitAt(ctx.limits, t.s / KM) * MPS * 0.97;

  // despawn behind player
  if (ai.despawnKm !== undefined) {
    const rel = (ai.despawnKm - t.s) * t.dir;
    if (rel < 0) t.despawn = true;
  }

  // meeting train (opposing, must stop at loop)
  if (ai.stopAt !== undefined) {
    const d = (ai.stopAt - t.s) * t.dir;
    const brakeB = Math.max(0.3, def.brake * 0.5);
    const vAllow = Math.sqrt(2 * brakeB * Math.max(0, d - 30)) + 0.3;
    if (d <= 0) { // reached/passed the loop — pin
      t.v = 0; t.throttle = 0; t.brakeCmd = 1; ai.arrived = true;
      return;
    }
    const dv2 = vAllow - t.v;
    if (t.dwell > 0) { t.throttle = 0; t.brakeCmd = 1; t.dwell -= dt; if (t.dwell <= 0) t.brakeCmd = 0; return; }
    if (dv2 > 0.4) { t.throttle = clamp(t.throttle + dt * 0.5, 0, 1); t.brakeCmd = 0; }
    else if (dv2 < -0.5) { t.throttle = 0; t.brakeCmd = clamp((0 - dv2) * 0.25, 0, 1); }
    else { t.throttle = t.v > 0.3 ? 0.12 : 0; t.brakeCmd = 0; }
    if (d < 60 && t.v < 0.4) { t.v = 0; t.throttle = 0; t.brakeCmd = 1; ai.arrived = true; }
    return;
  }

  // determine target points: next planned stop / red signals
  let targetKm = Infinity, targetSpeed = limit, targetIsStop = false;
  if (ai.pace) targetSpeed = Math.min(targetSpeed, ai.pace * MPS);
  // planned stops
  if (ai.plan && ai.plan.length) {
    if (ai.nextStopIdx === undefined) ai.nextStopIdx = 0;
    while (ai.nextStopIdx < ai.plan.length && (ai.plan[ai.nextStopIdx].done || ai.plan[ai.nextStopIdx].km < t.s - 50)) ai.nextStopIdx++;
    if (ai.nextStopIdx < ai.plan.length) {
      const p = ai.plan[ai.nextStopIdx];
      targetKm = p.km + 10;
      targetIsStop = true;
    }
  }
  // signals (same track AI only)
  if (!ai.opposite && ctx.signals) {
    const sig = Signals.nextAhead(ctx.signals, t.s);
    if (sig) {
      const asp = sig.aspect || 'G';
      const d = sig.km - t.s;
      const aspV = ASPECT[asp].speed;
      if (asp === 'R') { if (d < 1600) { const sigT = sig.km - 15; if (sigT < targetKm) { targetKm = sigT; targetIsStop = false; } } }
      else if (asp === 'Y') targetSpeed = Math.min(targetSpeed, 42 * MPS);
      else if (asp === 'YY') targetSpeed = Math.min(targetSpeed, 68 * MPS);
    }
  }
  // speed control toward possible stop
  const dTarget = (targetKm === Infinity ? Infinity : (targetKm - t.s) * t.dir);
  let vTarget = targetSpeed;
  if (dTarget < Infinity) {
    const brakeA = def.brake * 0.55 + 0.12;
    const vStop = Math.sqrt(Math.max(0, 2 * brakeA * Math.max(0, dTarget - 8))) + 0.25;
    vTarget = Math.min(vTarget, vStop);
  }
  // throttle/brake decision
  const dv = vTarget - t.v;
  if (t.dwell > 0) { t.throttle = 0; t.brakeCmd = 1; t.dwell -= dt; if (t.dwell <= 0) t.brakeCmd = 0; return; }
  if (t.v < 0.15 && dTarget < 40) { // arrived
    if (targetIsStop && ai.plan && ai.nextStopIdx < ai.plan.length && !ai.plan[ai.nextStopIdx].done) {
      ai.plan[ai.nextStopIdx].done = true;
      t.dwell = ai.plan[ai.nextStopIdx].dwell || 20;
      t.dwell += (ai.dwellExtra || 0);
    } else if (targetKm === Infinity) { t.despawn = true; }
    return;
  }
  if (dv > 0.4) { t.throttle = clamp(t.throttle + dt * 0.5, 0, 1); t.brakeCmd = 0; }
  else if (dv < -0.5) { t.throttle = 0; t.brakeCmd = clamp((0 - dv) * 0.25, 0, 1); }
  else { t.throttle = t.v > 0.3 ? 0.12 : 0; t.brakeCmd = 0; }
  if (t.emerg) t.emerg = false;
}

/* compute plan for chase/same-direction AI: halt points matched to platform berth */
function buildAiPlan(route, stops, dwell, trainLen) {
  const list = stops === 'all' ? route.stations : stops.map((n) => stationByName(route, n)).filter(Boolean);
  return list.map((s) => ({
    km: s.km + Math.max(s.plat * 0.35, Math.min(s.plat + 25, (trainLen || 200) * 0.72)),
    dwell, done: false,
  }));
}

/* pre-simulate an AI train backwards in time so it is already on the line at scenario start */
function preSim(t, seconds, ctx) {
  const dt = 0.25;
  let sim = 0;
  while (sim < seconds) { aiDrive(t, dt, ctx); stepTrain(t, dt, ctx); sim += dt; }
}
