/* ==========================================================================
   TRAIN GUARD
   A single-coach guard sim. Everything above `boot()` is pure logic and is
   exercised by test/game.test.mjs; everything below it is the browser layer.
   ========================================================================== */

/* ------------------------------- balance -------------------------------- */

/**
 * Riders don't fall at random: a hard enough jolt trips them into a stumble,
 * and a stumble is a countdown the guard can visibly cancel by holding on.
 * `risk = joltStrength * carriageForce * grip` decides who goes.
 */
export const BALANCE = Object.freeze({
  tripFloor: 0.58,   // risk below this never trips anyone
  tripSpan: 1.05,    // risk range over which the chance ramps up
  tripCurve: 2.3,    // how sharply trip risk climbs
  tripMax: 0.9,      // hard ceiling on trip chance per rider per jolt
  tripsPerJolt: 3,   // at most this many riders go down at once
  stumble: 1.3,      // seconds from stumble to floor
  wobbleAt: 0.3,     // lean above which a rider is visibly wobbling
  joltV: 5.5,        // visual kick per unit of risk
  saveRate: 4.2,     // 1/s lean decay while a guard holds on
  saveBurn: 3,       // stumble timer burn rate while held
  downTime: 1.4,     // seconds spent on the floor
});

export function createRider({ grip = 1, state = 'stand' } = {}) {
  return { bal: 0, balv: 0, grip, state, side: 1, down: 0, stumble: 0, stumbleMax: 0 };
}

/** Chance a single rider loses their footing on a jolt of this strength. */
export function tripChance(risk) {
  const x = (risk - BALANCE.tripFloor) / BALANCE.tripSpan;
  if (x <= 0) return 0;
  return Math.min(BALANCE.tripMax, Math.pow(x, BALANCE.tripCurve));
}

/** Apply a track jolt. Returns 'none' | 'wobble' | 'stumble'.
 *  `trip` forces the stumble decision; leave it null to roll for it. */
export function applyJolt(rider, dir, strength, trip = null, rng = Math.random) {
  if (rider.down > 0) return 'none';
  const vuln = rider.state === 'walk' ? 0.55 : 1;
  const risk = strength * vuln * rider.grip;
  rider.balv += dir * risk * BALANCE.joltV;

  const trips = trip === null ? rng() < tripChance(risk) : trip;
  if (rider.stumble <= 0 && trips) {
    const severity = Math.min(0.35, Math.max(0, risk - BALANCE.tripFloor) * 0.25);
    rider.stumbleMax = BALANCE.stumble * (1 - severity);
    rider.stumble = rider.stumbleMax;
    rider.side = dir < 0 ? -1 : 1;
    return 'stumble';
  }
  return risk > BALANCE.tripFloor ? 'wobble' : 'none';
}

/** Apply one jolt to a whole group, capping how many go down so a single bump
 *  can never wipe the coach. The least steady riders lose their footing first. */
export function resolveJolt(riders, dir, strength, rng = Math.random) {
  const candidates = [];
  for (const rider of riders) {
    if (rider.down > 0 || rider.stumble > 0) continue;
    const vuln = rider.state === 'walk' ? 0.55 : 1;
    const risk = strength * vuln * rider.grip;
    if (rng() < tripChance(risk)) candidates.push({ rider, risk });
  }
  candidates.sort((a, b) => b.risk - a.risk);
  const chosen = new Set(candidates.slice(0, BALANCE.tripsPerJolt).map((c) => c.rider));
  for (const rider of riders) applyJolt(rider, dir, strength, chosen.has(rider), rng);
  return chosen.size;
}

/** Returns 'ok' | 'wobble' | 'danger' | 'saving' | 'saved' | 'fall' | 'down'. */
export function stepBalance(rider, dt, held = false) {
  if (rider.down > 0) {
    rider.down -= dt;
    if (rider.down <= 0) { rider.down = 0; rider.bal = 0; rider.balv = 0; }
    return 'down';
  }

  if (rider.stumble > 0) {
    if (held) {
      rider.stumble -= dt * BALANCE.saveBurn;
      rider.bal -= rider.bal * Math.min(1, BALANCE.saveRate * dt);
      rider.balv = 0;
      if (rider.stumble <= 0 || Math.abs(rider.bal) < 0.18) {
        rider.stumble = 0;
        rider.bal *= 0.3;
        return 'saved';
      }
      return 'saving';
    }
    // nobody is holding on: the lean runs away and they go down
    rider.bal += (rider.side * 1.05 - rider.bal) * Math.min(1, 2.1 * dt);
    rider.stumble -= dt;
    if (rider.stumble <= 0 || Math.abs(rider.bal) >= 1) {
      rider.down = BALANCE.downTime;
      rider.stumble = 0;
      rider.bal = 0;
      rider.balv = 0;
      return 'fall';
    }
    return 'danger';
  }

  // free sway, always self-correcting
  rider.bal -= rider.bal * Math.min(1, 3.2 * dt);
  rider.balv -= rider.balv * Math.min(1, 6.5 * dt);
  rider.bal += rider.balv * dt;
  if (Math.abs(rider.bal) > 1) rider.bal = Math.sign(rider.bal);
  return Math.abs(rider.bal) > BALANCE.wobbleAt ? 'wobble' : 'ok';
}

/* -------------------------------- scoring -------------------------------- */

/** Exchange points + punctuality bonus − people left on the platform. */
export function scoreStop({ boarded = 0, alighted = 0, missed = 0, dwellLeft = 0, dwellMax = 1 }) {
  const exchange = (boarded + alighted) * 8;
  const punctual = missed === 0
    ? Math.round(Math.max(0, Math.min(1, dwellLeft / Math.max(1, dwellMax))) * 60)
    : 0;
  const penalty = missed * 10;
  return { exchange, punctual, penalty, total: exchange + punctual - penalty };
}

/** Difficulty curve by stop number. */
export function difficultyFor(idx) {
  const t = Math.min(1, Math.max(0, idx) / 10);
  return {
    force: 0.78 + 0.5 * t,          // jolt multiplier
    bumpMin: 2.6 - 1.3 * t,         // seconds between jolts
    bumpMax: 3.8 - 1.7 * t,
    speed: 0.45 + 0.55 * t,
    dwell: Math.max(11, 18 - idx * 0.6),
    boarders: Math.min(7, 3 + Math.floor(idx / 2)),
    alighters: Math.min(5, 2 + Math.floor(idx / 3)),
  };
}

export const STATIONS = [
  'Churchgate', 'Marine Lines', 'Charni Road', 'Grant Road', 'Mumbai Central',
  'Mahalaxmi', 'Lower Parel', 'Prabhadevi', 'Dadar', 'Matunga Road',
  'Mahim', 'Bandra', 'Khar Road', 'Santacruz', 'Vile Parle',
  'Andheri', 'Jogeshwari', 'Ram Mandir', 'Goregaon', 'Malad',
];

/* ==========================================================================
   BROWSER LAYER
   ========================================================================== */

function boot() {
  'use strict';

  /* ------------------------------ helpers ------------------------------- */
  const W = 960, H = 640;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  /* ----------------------------- geometry ------------------------------- */
  const CAR = { x: 56, y: 76, w: 848, h: 488, wall: 18 };
  const IN = {
    x: CAR.x + CAR.wall, y: CAR.y + CAR.wall,
    w: CAR.w - CAR.wall * 2, h: CAR.h - CAR.wall * 2,
  };
  const DOOR_W = 96;
  const DOOR_HALF = DOOR_W / 2;

  const DOORS = [
    { id: 0, side: 'top', x: 250, open: 0, target: 0, cd: 0 },
    { id: 1, side: 'top', x: 710, open: 0, target: 0, cd: 0 },
    { id: 2, side: 'bottom', x: 250, open: 0, target: 0, cd: 0 },
    { id: 3, side: 'bottom', x: 710, open: 0, target: 0, cd: 0 },
  ];

  const wallY = (side) => (side === 'top' ? CAR.y : CAR.y + CAR.h - CAR.wall);
  const platformY = (side) => (side === 'top' ? CAR.y - 34 : CAR.y + CAR.h + 34);

  const SEATS = [];
  const seat = (x, y, w, h, face, priority = false) =>
    SEATS.push({ x, y, w, h, face, priority, taken: null });
  for (let i = 0; i < 5; i++) seat(315 + i * 66, 98, 58, 40, 'down', i === 1 || i === 2);
  for (let i = 0; i < 5; i++) seat(315 + i * 66, 500, 58, 40, 'up', i === 1 || i === 2);
  for (let i = 0; i < 2; i++) seat(78, 236 + i * 62, 40, 54, 'right');
  for (let i = 0; i < 2; i++) seat(842, 236 + i * 62, 40, 54, 'left');

  const STAND = [
    [480, 186], [398, 190], [562, 190],
    [340, 258], [480, 258], [620, 258],
    [286, 330], [392, 330], [568, 330], [674, 330],
    [340, 402], [480, 402], [620, 402],
    [480, 468], [392, 466], [566, 466],
  ].map(([x, y]) => ({ x, y, taken: null }));

  /* ------------------------------ palette ------------------------------- */
  const C = {
    tunnel: '#05080f',
    platform: '#1d2637',
    platformLit: '#283448',
    edge: '#f2c14e',
    wall: '#3d4a64',
    wallDark: '#2e3850',
    floor: '#222c40',
    floorAlt: '#28334a',
    steel: '#46536d',
    hair: ['#1b1512', '#2a1c14', '#3a2a1c', '#141416', '#4a3626'],
    amber: '#ffc857',
    danger: '#ff5a5f',
    ok: '#57e08a',
  };
  const JACKETS = ['#c2543f', '#3f6fc2', '#4e9b6b', '#8d5bb8', '#c98b32', '#5d6b80', '#b8497a', '#2f8f96', '#8a4b3a', '#4b5f8a'];
  const SKINS = ['#e8b48c', '#c98b5e', '#a2663f', '#7a4a2b', '#f0c9a6', '#8e5a38'];

  /* ------------------------------- audio -------------------------------- */
  const Sound = (() => {
    let ac = null, master = null, muted = false;

    const init = () => {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.18;
      master.connect(ac.destination);
    };

    const tone = (freq, dur, { type = 'sine', vol = 0.4, slide = 0, delay = 0 } = {}) => {
      if (!ac || muted) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    };

    return {
      init, tone,
      get muted() { return muted; },
      toggle() { muted = !muted; return muted; },
      thump(k = 1) { tone(62, 0.24, { type: 'sine', vol: 0.55 * k, slide: -28 }); tone(130, 0.1, { type: 'triangle', vol: 0.16 * k, slide: -70 }); },
      chime() { tone(880, 0.16, { vol: 0.22 }); tone(1174, 0.3, { vol: 0.18, delay: 0.15 }); },
      slide() { tone(300, 0.32, { type: 'triangle', vol: 0.13, slide: -150 }); },
      buzz() { tone(140, 0.22, { type: 'square', vol: 0.1, slide: -40 }); },
      point() { tone(680, 0.07, { vol: 0.12 }); tone(1020, 0.1, { vol: 0.1, delay: 0.05 }); },
      fail() { tone(290, 0.45, { type: 'sawtooth', vol: 0.16, slide: -180 }); },
    };
  })();

  /* -------------------------------- state ------------------------------- */
  const game = {
    state: 'title',
    score: 0, hearts: 5, stops: 0, time: 0,
    cleanStops: 0, fallsThisStop: 0, best: 0,
  };
  try { game.best = Number(localStorage.getItem('trainguard.best') || 0) || 0; } catch { /* private mode */ }

  const world = {
    phase: 'dwell',
    phaseT: 0,
    speed: 0,
    dwell: 18, dwellMax: 18,
    cruiseLen: 9,
    bumpT: 3,
    scroll: 0,
    shake: 0,
    sway: 0, swayV: 0,
    station: STATIONS[0],
    boardersSent: 0, alightersDone: 0, missed: 0,
    closingOut: false, stuckT: 0,
    passengers: [],
    fx: [],
  };

  const player = {
    x: 480, y: 452, speed: 236,
    facing: -Math.PI / 2, steady: false, bob: 0,
  };

  const input = { up: 0, down: 0, left: 0, right: 0, pointer: null };

  /* ----------------------------- utilities ------------------------------ */
  const rr = (x, y, w, h, r) => {
    const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.closePath(); };
  const diff = () => difficultyFor(game.stops);

  /* ------------------------------- riders ------------------------------- */
  let nextId = 1;

  function makePassenger({ x, y, onboard = false } = {}) {
    const p = createRider({ grip: rnd(0.85, 1.15), state: onboard ? 'stand' : 'walk' });
    Object.assign(p, {
      id: nextId++, x, y, dir: -Math.PI / 2, r: 11,
      walkSpeed: rnd(48, 64),
      color: pick(JACKETS), skin: pick(SKINS), hair: pick(C.hair), bag: Math.random() < 0.24,
      onboard, seated: false, seat: null, spot: null,
      goal: null, door: null, waitT: 0, leaving: false, gone: false,
      dest: 0, walkPhase: rnd(0, TAU), held: false, exitStage: 0,
      state: onboard ? 'stand' : 'walk',
    });
    return p;
  }

  function nearestFree(list, p) {
    let best = null, bestD = Infinity;
    for (const s of list) {
      if (s.taken) continue;
      const cx = s.x + (s.w ? s.w / 2 : 0);
      const cy = s.y + (s.h ? s.h / 2 : 0);
      const d = (cx - p.x) ** 2 + (cy - p.y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  const setGoal = (p, x, y, then) => { p.goal = { x, y, then: then || null }; };

  const FACING = { down: Math.PI / 2, up: -Math.PI / 2, left: Math.PI, right: 0 };

  function seatDown(p, s) {
    p.seat = s; s.taken = p;
    p.seated = true; p.state = 'seated';
    p.dir = FACING[s.face] ?? -Math.PI / 2;
    p.stumble = 0; p.bal = 0; p.balv = 0;
    p.x = s.x + s.w / 2; p.y = s.y + s.h / 2;
    p.goal = null;
  }

  function seatSelf(p) {
    const s = nearestFree(SEATS, p);
    if (s) { setGoal(p, s.x + s.w / 2, s.y + s.h / 2, (q) => seatDown(q, s)); return true; }
    const spot = nearestFree(STAND, p);
    if (spot) { p.spot = spot; spot.taken = p; setGoal(p, spot.x, spot.y, (q) => { q.state = 'stand'; }); return true; }
    return false;
  }

  function enterCar(p) {
    p.onboard = true;
    p.goal = null;
    p.leaving = false;
    p.state = 'walk';

    // short hops and door-hangers ride standing, which leaves them exposed to jolts
    const shortHop = p.dest - game.stops <= 1;
    if ((shortHop || Math.random() < 0.3)) {
      const spot = nearestFree(STAND, p);
      if (spot) {
        p.spot = spot;
        spot.taken = p;
        setGoal(p, spot.x, spot.y, (q) => { q.state = 'stand'; });
        return;
      }
    }
    if (!seatSelf(p)) setGoal(p, rnd(430, 530), rnd(300, 380), (q) => { q.state = 'stand'; });
  }

  function startLeaving(p) {
    if (p.seat) { p.seat.taken = null; p.seat = null; p.seated = false; }
    if (p.spot) { p.spot.taken = null; p.spot = null; }
    p.leaving = true;
    p.state = 'walk';
    p.exitStage = 0;
    p.door = null;
    goalToDoor(p);
  }

  function goalToDoor(p) {
    const open = DOORS.filter((d) => d.open > 0.6);
    const pool = open.length ? open : DOORS;
    let best = pool[0], bestD = Infinity;
    for (const d of pool) {
      const dy = (d.side === 'top' ? IN.y + 26 : IN.y + IN.h - 26) - p.y;
      const d2 = (d.x - p.x) ** 2 + dy * dy;
      if (d2 < bestD) { bestD = d2; best = d; }
    }
    const insideY = best.side === 'top' ? IN.y + 26 : IN.y + IN.h - 26;
    setGoal(p, best.x, insideY, (q) => { q.door = best; q.state = 'stand'; });
  }

  /* ----------------------------- world flow ----------------------------- */
  const tickerEl = document.getElementById('ticker');
  let tickerText = '', sayCooldown = 0;

  /** Announce something; big messages can interrupt, small ones wait their turn. */
  function say(text, hold = 2.5) {
    if (tickerText === text) return;
    if (sayCooldown > 0 && hold < 3) return;
    tickerText = text;
    sayCooldown = hold;
    tickerEl.textContent = text;
  }

  const setPhase = (phase) => { world.phase = phase; world.phaseT = 0; };

  function spawnBoarders(n) {
    for (let i = 0; i < n; i++) {
      const door = pick(DOORS);
      const p = makePassenger({
        x: door.x + rnd(-40, 40),
        y: platformY(door.side) + rnd(-8, 8),
      });
      p.dest = game.stops + ri(1, 4);
      setGoal(p, door.x + rnd(-16, 16), platformY(door.side), null);
      world.passengers.push(p);
    }
    world.boardersSent += n;
  }

  function beginStop(index) {
    game.stops = index;
    world.station = STATIONS[index % STATIONS.length];
    const d = diff();
    world.dwell = world.dwellMax = d.dwell;
    world.boardersSent = 0;
    world.alightersDone = 0;
    world.missed = 0;
    world.closingOut = false;
    world.stuckT = 0;
    game.fallsThisStop = 0;
    setPhase('dwell');
    spawnBoarders(d.boarders);
    say(`${world.station.toUpperCase()} — doors released`, 3.5);
  }

  function beginBrake() {
    const nextIndex = game.stops + 1;
    setPhase('brake');
    say(`Approaching ${STATIONS[nextIndex % STATIONS.length]}`, 3.5);
    for (const p of world.passengers) {
      if (!p.onboard || p.gone || p.leaving) continue;
      if (p.dest <= nextIndex || Math.random() < 0.08) startLeaving(p);
    }
    Sound.chime();
  }

  function doorsShut() { return DOORS.every((d) => d.open === 0 && d.target === 0); }

  function departCheck() {
    if (world.phase !== 'dwell' || !doorsShut()) { world.stuckT = 0; return; }

    const waiting = world.passengers.filter((p) => !p.gone && (!p.onboard || p.leaving));
    if (!world.closingOut && waiting.length) {
      world.stuckT += 1 / 60;
      if (world.stuckT > 1.4) {
        world.stuckT = 0;
        say('Passengers still boarding — hold the doors.', 2.6);
      }
      return;
    }
    finaleStop(!world.closingOut);
  }

  function finaleStop(onTime) {
    // anyone still on the platform is left behind
    for (const p of world.passengers) {
      if (p.gone) continue;
      if (!p.onboard && !p.leaving) {
        p.leaving = true;
        world.missed++;
        setGoal(p, p.x, p.y < CAR.y ? -40 : H + 40, (q) => { q.gone = true; });
      } else if (p.onboard && p.leaving && !p.goal) {
        // could not get off — they ride to the next stop
        p.leaving = false;
        p.door = null;
        p.exitStage = 0;
        p.dest = game.stops + 1;
        if (!p.seated) seatSelf(p);
      }
    }

    const scored = scoreStop({
      boarded: Math.max(0, world.boardersSent - world.missed),
      alighted: world.alightersDone,
      missed: world.missed,
      dwellLeft: world.dwell,
      dwellMax: world.dwellMax,
    });
    addScore(scored.exchange + scored.penalty + (onTime ? scored.punctual : 0));
    if (onTime && scored.punctual > 40) Sound.point();

    game.cleanStops = game.fallsThisStop === 0 ? game.cleanStops + 1 : 0;
    if (game.cleanStops > 0 && game.cleanStops % 4 === 0 && game.hearts < 5) {
      game.hearts++;
      say('Clean run — safety rating restored.', 3);
      Sound.point();
    }

    world.closingOut = false;
    world.stuckT = 0;
    setPhase('depart');
    world.bumpT = 1.6;
    Sound.chime();
  }

  function forceCloseAll() {
    for (const d of DOORS) { d.target = 0; d.cd = 1; }
    Sound.slide();
  }

  const addScore = (n) => { game.score = Math.max(0, game.score + Math.round(n)); };

  function floatText(x, y, text, color) {
    world.fx.push({ x, y, text, color, life: 1.1, vy: -34 });
  }

  function onFall(p) {
    game.hearts--;
    game.fallsThisStop++;
    addScore(-40);
    world.shake = Math.min(18, world.shake + 10);
    floatText(p.x, p.y - 18, 'FALLEN −40', C.danger);
    Sound.fail();
    for (let i = 0; i < 8; i++) {
      world.fx.push({ x: p.x, y: p.y, vx: rnd(-80, 80), vy: rnd(-80, 80), life: 0.5, color: C.danger, dot: true });
    }
    if (game.hearts <= 0) endShift();
  }

  function onSaved(p) {
    addScore(5);
    floatText(p.x, p.y - 18, 'STEADIED +5', C.ok);
    Sound.point();
  }

  function endShift() {
    game.hearts = 0;
    game.state = 'over';
    if (game.score > game.best) {
      game.best = game.score;
      try { localStorage.setItem('trainguard.best', String(game.best)); } catch { /* ignore */ }
    }
    document.getElementById('finalScore').textContent = game.score.toLocaleString();
    document.getElementById('finalStops').textContent = String(game.stops);
    document.getElementById('finalBest').textContent = game.best.toLocaleString();
    document.getElementById('overlayOver').classList.remove('hidden');
    syncHud();
  }

  /* -------------------------------- loop -------------------------------- */
  function update(dt) {
    game.time += dt;
    world.shake = Math.max(0, world.shake - dt * 26);
    world.swayV += (-world.sway * 42 - world.swayV * 7) * dt;
    world.sway += world.swayV * dt;
    if (sayCooldown > 0) sayCooldown -= dt;

    updatePlayer(dt);
    updateCamera(dt);
    updateTrain(dt);
    updateDoors(dt);
    updatePassengers(dt);
    updateFx(dt);

    if (world.phase === 'dwell') {
      world.dwell = Math.max(0, world.dwell - dt);
      if (world.dwell <= 0 && !world.closingOut) {
        world.closingOut = true;
        say('Dwell expired — doors closing.', 3);
        forceCloseAll();
      }
      departCheck();
    }
    syncHud();
  }

  function updatePlayer(dt) {
    let dx = 0, dy = 0;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;

    if (input.pointer) {
      const px = input.pointer.x - player.x;
      const py = input.pointer.y - player.y;
      const d = Math.hypot(px, py);
      if (d > 8) { dx += px / d; dy += py / d; }
    }

    const len = Math.hypot(dx, dy);
    if (len > 0.01) {
      const sp = player.speed * (player.steady ? 0.35 : 1);
      player.x += (dx / len) * sp * dt;
      player.y += (dy / len) * sp * dt;
      player.facing = Math.atan2(dy, dx);
      player.bob += dt * (player.steady ? 5 : 11);
    } else {
      player.bob += dt * 2;
    }
    player.x = clamp(player.x, IN.x + 16, IN.x + IN.w - 16);
    player.y = clamp(player.y, IN.y + 16, IN.y + IN.h - 16);

    for (const p of world.passengers) p.held = false;
    if (player.steady) {
      for (const p of world.passengers) {
        if (!p.onboard || p.seated || p.gone || p.down > 0) continue;
        if (Math.hypot(p.x - player.x, p.y - player.y) < 62) p.held = true;
      }
    }
  }

  function updateCamera(dt) {
    const t = camTarget(player);
    const k = Math.min(1, 9 * dt);
    cam.x += (t.x - cam.x) * k;
    cam.y += (t.y - cam.y) * k;
  }

  function updateTrain(dt) {
    world.scroll += world.speed * 620 * dt;
    const d = diff();

    if (world.phase === 'depart') {
      world.phaseT += dt;
      world.speed = Math.min(d.speed, world.speed + dt * 0.34);
      if (world.speed >= d.speed - 0.001) {
        setPhase('cruise');
        world.cruiseLen = rnd(7, 11);
        world.bumpT = rnd(1.2, 2.2);
        say('Doors locked. Next stop ahead.', 2.4);
      }
      return;
    }

    if (world.phase === 'cruise') {
      world.phaseT += dt;
      world.bumpT -= dt;
      if (world.bumpT <= 0) {
        const big = Math.random() < 0.24;
        const base = big ? rnd(1.0, 1.28) : rnd(0.5, 1.0);
        joltTrain(Math.random() < 0.5 ? -1 : 1, base * d.force);
        world.bumpT = rnd(d.bumpMin, d.bumpMax);
      }
      if (world.phaseT > world.cruiseLen) beginBrake();
      return;
    }

    if (world.phase === 'brake') {
      world.phaseT += dt;
      world.speed = Math.max(0, world.speed - dt * 0.34);
      world.bumpT -= dt;
      if (world.bumpT <= 0 && world.speed > 0.3) {
        joltTrain(Math.random() < 0.5 ? -1 : 1, rnd(0.45, 0.85) * d.force);
        world.bumpT = rnd(1.5, 2.6);
      }
      if (world.speed <= 0) {
        world.speed = 0;
        beginStop(game.stops + 1);
      }
      return;
    }

    world.speed = 0;
  }

  function joltTrain(dir, strength) {
    world.shake = Math.min(16, world.shake + 2.5 + strength * 6);
    world.swayV += dir * strength * 2.2;
    Sound.thump(clamp(strength, 0.3, 1.3));

    const exposed = world.passengers.filter((p) => p.onboard && !p.seated && !p.gone);
    const tripped = resolveJolt(exposed, dir, strength);
    if (tripped) {
      world.shake = Math.min(20, world.shake + tripped * 2);
      say(tripped > 1 ? `${tripped} passengers losing their footing!` : 'Passenger losing their footing!', 1.8);
    }
  }

  function updateDoors(dt) {
    for (const d of DOORS) {
      if (d.cd > 0) d.cd -= dt;
      if (d.open !== d.target) {
        const step = dt / 0.5;
        d.open = d.target > d.open ? Math.min(d.target, d.open + step) : Math.max(d.target, d.open - step);
      }
      if (d.target === 0 && d.open > 0.1 && d.cd <= 0 && doorBlocked(d)) {
        d.target = 1;
        d.cd = 1.4;
        addScore(-15);
        floatText(d.x, wallY(d.side) + (d.side === 'top' ? -16 : 30), 'DOOR BLOCKED −15', C.danger);
        world.shake = Math.min(14, world.shake + 6);
        Sound.buzz();
        say('Obstruction — doors reopening.', 2.4);
      }
    }
  }

  function doorBlocked(d) {
    const y0 = wallY(d.side) - 12;
    const y1 = y0 + CAR.wall + 24;
    for (const p of world.passengers) {
      if (p.gone || p.seated || p.down > 0) continue;
      if (Math.abs(p.x - d.x) < DOOR_HALF - 8 && p.y > y0 && p.y < y1) return true;
    }
    return false;
  }

  const sideDoors = (side) => DOORS.filter((d) => d.side === side);

  function toggleDoors(side) {
    if (game.state !== 'playing') return;
    if (world.phase !== 'dwell' || world.speed > 0.01) {
      Sound.buzz();
      say('Doors interlocked while the train is moving.', 2);
      return;
    }
    if (world.closingOut) { Sound.buzz(); say('Departure in progress.', 1.5); return; }

    const anyOpen = sideDoors(side).some((d) => d.target === 1 || d.open > 0);
    for (const d of sideDoors(side)) {
      d.target = anyOpen ? 0 : 1;
      d.cd = anyOpen ? 0.5 : 0;
    }
    Sound.slide();
  }

  /* ----------------------------- passengers ----------------------------- */
  function updatePassengers(dt) {
    const list = world.passengers;

    for (const p of list) {
      if (p.gone) continue;
      if (!p.seated) p.state = p.goal ? 'walk' : 'stand';

      if (p.onboard && !p.seated) {
        const res = stepBalance(p, dt, p.held);
        if (res === 'fall') { onFall(p); continue; }
        if (res === 'saved') onSaved(p);
        if (p.down > 0) continue;
      }

      if (p.goal) {
        const dx = p.goal.x - p.x, dy = p.goal.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 4) {
          const then = p.goal.then;
          p.goal = null;
          if (then) then(p);
        } else {
          const sp = p.walkSpeed * (p.held ? 0.25 : 1);
          p.x += (dx / d) * sp * dt;
          p.y += (dy / d) * sp * dt;
          p.dir = Math.atan2(dy, dx);
          p.walkPhase += dt * 9;
        }
      }

      if (!p.onboard) boardTick(p);
      else if (p.leaving) exitTick(p, dt);
    }

    // shoulders
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.gone || a.seated || a.down > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.gone || b.seated || b.down > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < 484) {
          const d = Math.sqrt(d2);
          const push = (22 - d) / d * dt * 36;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }

    if (list.some((p) => p.gone)) {
      world.passengers = list.filter((p) => !p.gone);
    }
  }

  function boardTick(p) {
    if (p.leaving) {
      if (p.y < -20 || p.y > H + 20) p.gone = true;
      return;
    }
    if (p.goal) return;
    const door = DOORS
      .filter((d) => d.open > 0.7)
      .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    if (door) {
      const insideY = door.side === 'top' ? IN.y + 26 : IN.y + IN.h - 26;
      setGoal(p, door.x, insideY, enterCar);
    }
  }

  function exitTick(p, dt) {
    if (!p.door) { if (!p.goal) goalToDoor(p); return; }
    if (p.goal) return;

    if (p.door.open > 0.7) {
      p.waitT = 0;
      const outY = platformY(p.door.side);
      setGoal(p, p.door.x, outY, (q) => {
        q.exitStage = 1;
        setGoal(q, q.x + rnd(-40, 40), q.y < CAR.y ? -40 : H + 40, (r) => {
          r.gone = true;
          r.leaving = false;
          world.alightersDone++;
        });
      });
      return;
    }

    p.waitT += dt;
    if (p.waitT > 1.2) {
      p.waitT = 0;
      const alt = DOORS.filter((d) => d.open > 0.7);
      if (alt.length) { p.door = null; goalToDoor(p); }
    }
  }

  /* ------------------------------- effects ------------------------------ */
  function updateFx(dt) {
    for (const f of world.fx) {
      f.life -= dt;
      if (f.dot) {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= 1 - 2.4 * dt; f.vy *= 1 - 2.4 * dt;
      } else {
        f.y += f.vy * dt;
        f.vy *= 1 - 1.8 * dt;
      }
    }
    world.fx = world.fx.filter((f) => f.life > 0);
  }

  /* --------------------------------- HUD -------------------------------- */
  const $ = (id) => document.getElementById(id);
  const ui = {
    score: $('uiScore'), hearts: $('uiHearts'), stops: $('uiStops'),
    doorTop: $('uiDoorTop'), doorBottom: $('uiDoorBottom'),
    dwell: $('uiDwell'), dwellLabel: $('uiDwellLabel'),
    doorTopBtn: $('doorTop'), doorBottomBtn: $('doorBottom'),
    steadyBtn: $('steadyBtn'),
  };
  const cached = {};
  const put = (key, el, value) => {
    if (cached[key] === value) return;
    cached[key] = value;
    el.textContent = value;
  };

  function doorLabel(side) {
    if (world.phase !== 'dwell' || world.speed > 0.02) return 'LOCKED';
    const ds = sideDoors(side);
    if (ds.every((d) => d.open === 1)) return 'OPEN';
    if (ds.some((d) => d.open > 0 && d.open < 1)) return ds[0].target ? 'OPENING' : 'CLOSING';
    return 'CLOSED';
  }

  function syncHud() {
    put('score', ui.score, game.score.toLocaleString());
    put('hearts', ui.hearts, '♥'.repeat(game.hearts) + '♡'.repeat(Math.max(0, 5 - game.hearts)));
    put('stops', ui.stops, String(game.stops));

    const top = doorLabel('top'), bot = doorLabel('bottom');
    put('dt', ui.doorTop, top);
    put('db', ui.doorBottom, bot);
    const cls = (label) => (label === 'OPEN' ? 'door open'
      : label === 'CLOSED' ? 'door'
        : label === 'LOCKED' ? 'door locked' : 'door moving');
    if (ui.doorTopBtn.className !== cls(top)) ui.doorTopBtn.className = cls(top);
    if (ui.doorBottomBtn.className !== cls(bot)) ui.doorBottomBtn.className = cls(bot);

    const pct = world.phase === 'dwell' ? (world.dwell / world.dwellMax) * 100 : 0;
    const w = `${pct.toFixed(1)}%`;
    if (cached.dwell !== w) {
      cached.dwell = w;
      ui.dwell.style.width = w;
      ui.dwell.style.background = pct < 30
        ? 'linear-gradient(90deg,#ff5a5f,#ffc857)'
        : 'linear-gradient(90deg,#5ce1e6,#ffc857)';
    }
    const label = world.phase === 'dwell'
      ? `${world.station.toUpperCase()} · ${Math.ceil(world.dwell)}s`
      : `${world.station.toUpperCase()} · ${world.phase.toUpperCase()}`;
    put('dl', ui.dwellLabel, label);
    ui.steadyBtn.classList.toggle('on', player.steady);
  }

  /* ------------------------------- render ------------------------------- */
  // The world is 960x640, but phones would shrink the guard to a few pixels.
  // Below a legible scale the camera zooms in and follows the guard instead.
  const MIN_SCALE = 0.85;
  let view = { s: 1, ox: 0, oy: 0, cssScale: 1, cssOx: 0, cssOy: 0, w: W, h: H };
  const cam = { x: W / 2, y: H / 2 };

  function camTarget(p) {
    const half = view.w / 2;
    const halfH = view.h / 2;
    const lead = 26;
    const x = view.w >= CAR.w
      ? CAR.x + CAR.w / 2
      : clamp(p.x + Math.cos(p.facing) * lead, CAR.x + half, CAR.x + CAR.w - half);
    const y = view.h >= CAR.h
      ? CAR.y + CAR.h / 2
      : clamp(p.y + Math.sin(p.facing) * lead, CAR.y + halfH, CAR.y + CAR.h - halfH);
    return { x, y };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const fit = Math.min(rect.width / W, rect.height / H);
    const cssScale = Math.max(fit, MIN_SCALE);
    const cssOx = (rect.width - W * cssScale) / 2;
    const cssOy = (rect.height - H * cssScale) / 2;

    view = {
      s: cssScale * dpr,
      ox: cssOx * dpr,
      oy: cssOy * dpr,
      cssScale, cssOx, cssOy,
      w: rect.width / cssScale,
      h: rect.height / cssScale,
    };

    const t = camTarget(player);
    cam.x = t.x;
    cam.y = t.y;
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.cssOx) / view.cssScale,
      y: (clientY - rect.top - view.cssOy) / view.cssScale,
    };
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sh = world.shake;
    const shx = rnd(-sh, sh) * 0.5;
    const shy = rnd(-sh, sh) * 0.5;
    const swayX = world.sway * 4;

    const cx = clamp(cam.x, CAR.x + view.w / 2, CAR.x + CAR.w - view.w / 2);
    const cy = clamp(cam.y, CAR.y + view.h / 2, CAR.y + CAR.h - view.h / 2);
    const camX = view.w >= CAR.w ? cam.x : cx;
    const camY = view.h >= CAR.h ? cam.y : cy;

    ctx.setTransform(view.s, 0, 0, view.s,
      view.ox + (shx + swayX - camX) * view.s + (W / 2) * view.s,
      view.oy + (shy - camY) * view.s + (H / 2) * view.s);

    // whatever the viewport covers, it is tunnel out there
    const margin = 40;
    ctx.fillStyle = C.tunnel;
    ctx.fillRect(camX - view.w / 2 - margin, camY - view.h / 2 - margin, view.w + margin * 2, view.h + margin * 2);

    ctx.lineJoin = 'round';
    drawOutside();
    drawCar();
    drawSeats();
    drawPassengers();
    drawPlayer();
    drawFx();
    drawVignette();
  }

  function drawOutside() {
    const speed = clamp(world.speed, 0, 1);
    const scroll = world.scroll;
    const pad = 760;
    const x0 = -pad, x1 = W + pad, span = x1 - x0;

    // tunnel darkness beyond the coach, so a panning camera never shows bare canvas
    ctx.fillStyle = C.tunnel;
    ctx.fillRect(x0, -pad, span, H + pad * 2);

    for (const side of ['top', 'bottom']) {
      const y0 = side === 'top' ? 0 : CAR.y + CAR.h;
      const h = side === 'top' ? CAR.y : H - (CAR.y + CAR.h);

      ctx.fillStyle = C.tunnel;
      ctx.fillRect(x0, y0, span, h);

      ctx.globalAlpha = 1 - speed * 0.92;
      ctx.fillStyle = C.platform;
      ctx.fillRect(x0, y0, span, h);

      const tile = 64;
      const off = (((scroll * 0.35) % tile) + tile) % tile;
      for (let x = x0 - tile; x < x1 + tile; x += tile) {
        ctx.fillStyle = (((Math.round((x + off) / tile)) & 1) === 0) ? C.platformLit : C.platform;
        ctx.fillRect(x - off, y0 + 6, tile - 3, h - 12);
      }

      ctx.fillStyle = C.edge;
      ctx.globalAlpha = (1 - speed * 0.92) * 0.9;
      ctx.fillRect(x0, side === 'top' ? CAR.y - 7 : CAR.y + CAR.h + 1, span, 6);
      ctx.globalAlpha = 1;

      if (speed > 0.04) {
        ctx.globalAlpha = clamp(speed * 1.3, 0, 1) * 0.9;
        for (let i = 0; i < 9; i++) {
          const lx = x0 + ((((i * 122 - scroll * 1.35) % (span + 240)) + span + 240) % (span + 240)) - 120;
          const g = ctx.createLinearGradient(lx, 0, lx + 64, 0);
          g.addColorStop(0, 'rgba(120,190,255,0)');
          g.addColorStop(0.5, 'rgba(150,210,255,0.25)');
          g.addColorStop(1, 'rgba(120,190,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(lx, y0 + 8, 64, h - 16);
        }
        ctx.globalAlpha = 1;
      }

      const signA = clamp(1 - world.speed * 3, 0, 1);
      if (signA > 0.02) {
        ctx.globalAlpha = signA;
        const name = world.station.toUpperCase();
        ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
        const tw = ctx.measureText(name).width;
        const bx = CAR.x + CAR.w - (tw + 40) - 18;
        const by = side === 'top' ? 14 : CAR.y + CAR.h + 18;
        rr(bx, by, tw + 40, 28, 7);
        ctx.fillStyle = 'rgba(9,14,24,0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,200,87,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = C.amber;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, bx + (tw + 40) / 2, by + 14);
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = (1 - speed * 0.92) * 0.5;
      ctx.fillStyle = '#0e1522';
      for (let x = x0; x < x1; x += 240) {
        const px = x0 + ((((x - scroll * 0.35) % (span + 120)) + span + 120) % (span + 120)) - 60;
        ctx.fillRect(px, y0 + (side === 'top' ? 4 : h - 16), 10, 12);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCar() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 12;
    rr(CAR.x, CAR.y, CAR.w, CAR.h, 18);
    ctx.fillStyle = C.wallDark;
    ctx.fill();
    ctx.restore();

    rr(CAR.x, CAR.y, CAR.w, CAR.h, 18);
    ctx.fillStyle = C.wall;
    ctx.fill();

    // exterior trim
    rr(CAR.x + 5, CAR.y + 5, CAR.w - 10, CAR.h - 10, 14);
    ctx.strokeStyle = 'rgba(232,237,247,0.07)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    rr(IN.x, IN.y, IN.w, IN.h, 8);
    ctx.fillStyle = C.floor;
    ctx.fill();

    ctx.save();
    rr(IN.x, IN.y, IN.w, IN.h, 8);
    ctx.clip();

    // floor tiles + lit aisle down the middle
    ctx.fillStyle = C.floorAlt;
    for (let x = IN.x; x < IN.x + IN.w; x += 96) ctx.fillRect(x, IN.y, 48, IN.h);
    for (let y = IN.y; y < IN.y + IN.h; y += 96) ctx.fillRect(IN.x, y, IN.w, 1);

    const aisle = ctx.createLinearGradient(0, IN.y + IN.h / 2 - 66, 0, IN.y + IN.h / 2 + 66);
    aisle.addColorStop(0, 'rgba(120,190,255,0)');
    aisle.addColorStop(0.5, 'rgba(120,190,255,0.06)');
    aisle.addColorStop(1, 'rgba(120,190,255,0)');
    ctx.fillStyle = aisle;
    ctx.fillRect(IN.x, IN.y + IN.h / 2 - 66, IN.w, 132);

    drawInteriorFittings();

    // doorway keep-clear markings
    for (const d of DOORS) {
      const y = d.side === 'top' ? IN.y : IN.y + IN.h - 46;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(255,200,87,0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.moveTo(d.x - DOOR_HALF + 8, y + 44);
      ctx.lineTo(d.x - DOOR_HALF + 8, y + 4);
      ctx.lineTo(d.x + DOOR_HALF - 8, y + 4);
      ctx.lineTo(d.x + DOOR_HALF - 8, y + 44);
      ctx.stroke();
      ctx.restore();
    }

    // interior falloff
    const g = ctx.createRadialGradient(W / 2, H / 2, 170, W / 2, H / 2, 520);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(IN.x, IN.y, IN.w, IN.h);
    ctx.restore();

    drawDoors();
    drawDestinationPlaque();
  }

  function drawInteriorFittings() {
    // ceiling lights
    for (const lx of [300, 480, 660]) {
      for (const ly of [IN.y + 34, IN.y + IN.h - 34]) {
        const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, 120);
        lg.addColorStop(0, 'rgba(255,240,210,0.10)');
        lg.addColorStop(1, 'rgba(255,240,210,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(lx - 120, ly - 90, 240, 180);
        rr(lx - 26, ly - 3, 52, 6, 3);
        ctx.fillStyle = 'rgba(255,244,222,0.5)';
        ctx.fill();
      }
    }

    // grab poles
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2] of [
      [286, 258, 286, 402], [674, 258, 674, 402], [330, 330, 630, 330],
    ]) {
      ctx.strokeStyle = 'rgba(10,16,26,0.5)';
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(206,218,238,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
        circle(cx, cy, 4.5);
        ctx.fillStyle = 'rgba(206,218,238,0.5)';
        ctx.fill();
      }
    }

    // hanging straps along the centre rail
    for (let x = 360; x <= 600; x += 40) {
      const sway = Math.sin(game.time * 1.6 + x * 0.02) * (1.5 + world.speed * 4) + world.sway * 26;
      ctx.strokeStyle = 'rgba(214,224,240,0.28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 330);
      ctx.lineTo(x + sway, 352);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + sway, 356, 4, 0, TAU);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

  }

  function drawDestinationPlaque() {
    const px = 480, py = CAR.y + 4;
    rr(px - 74, py, 148, 17, 4);
    ctx.fillStyle = 'rgba(6,10,18,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(92,225,230,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,87,0.92)';
    ctx.font = '700 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nxt = STATIONS[(game.stops + 1) % STATIONS.length];
    const at = world.phase === 'dwell';
    ctx.fillText(`${at ? 'AT' : 'NEXT'} · ${(at ? world.station : nxt).toUpperCase()}`, px, py + 9);
    ctx.textAlign = 'left';
  }

  function drawDoors() {
    for (const d of DOORS) {
      const y = wallY(d.side);
      const left = d.x - DOOR_HALF;

      // the opening: a channel through the wall
      rr(left, y, DOOR_W, CAR.wall, 2);
      const ch = ctx.createLinearGradient(0, y, 0, y + CAR.wall);
      if (d.side === 'top') {
        ch.addColorStop(0, d.target ? '#2b3a52' : '#0b1220');
        ch.addColorStop(1, '#0a0f1a');
      } else {
        ch.addColorStop(0, '#0a0f1a');
        ch.addColorStop(1, d.target ? '#2b3a52' : '#0b1220');
      }
      ctx.fillStyle = ch;
      ctx.fill();

      // platform visible through the gap
      if (d.open > 0.02) {
        ctx.save();
        rr(left, y, DOOR_W, CAR.wall, 2);
        ctx.clip();
        ctx.globalAlpha = d.open * 0.9;
        ctx.fillStyle = C.platform;
        ctx.fillRect(left, y, DOOR_W, CAR.wall);
        ctx.fillStyle = C.edge;
        ctx.fillRect(left, d.side === 'top' ? y - 2 : y + CAR.wall - 2, DOOR_W, 4);
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // sliding leaves tuck into the wall pockets
      ctx.save();
      rr(left - 2, y, DOOR_W + 4, CAR.wall, 2);
      ctx.clip();
      const slide = d.open * (DOOR_HALF + 2);
      for (const dir of [-1, 1]) {
        const lx = dir < 0 ? left - slide : left + DOOR_HALF + slide;
        rr(lx, y + 1, DOOR_HALF, CAR.wall - 2, 2);
        const lg = ctx.createLinearGradient(0, y, 0, y + CAR.wall);
        lg.addColorStop(0, '#5a6884');
        lg.addColorStop(0.45, C.steel);
        lg.addColorStop(1, '#2f394f');
        ctx.fillStyle = lg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(10,16,26,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // window slit
        ctx.fillStyle = 'rgba(180,215,255,0.14)';
        ctx.fillRect(lx + 6, y + 6, DOOR_HALF - 12, CAR.wall - 12);
      }
      ctx.restore();

      // threshold light strip (red closed / amber moving / green open)
      const moving = d.open > 0 && d.open < 1;
      const strip = moving ? C.amber : d.open > 0.5 ? C.ok : C.danger;
      const stripY = d.side === 'top' ? y + CAR.wall - 3 : y;
      ctx.globalAlpha = d.open > 0.5 ? 0.9 : 0.75;
      ctx.fillStyle = strip;
      ctx.fillRect(left + 3, stripY, DOOR_W - 6, 3);
      ctx.globalAlpha = 1;

      // lamp post beside the doors
      const lampX = left - 12;
      const lampY = y + CAR.wall / 2;
      if (d.open > 0.5) {
        ctx.globalAlpha = 0.22;
        circle(lampX, lampY, 9);
        ctx.fillStyle = C.ok;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      circle(lampX, lampY, 3.2);
      ctx.fillStyle = d.open > 0.5 ? C.ok : strip;
      ctx.fill();
    }
  }

  function drawSeats() {
    for (const s of SEATS) {
      rr(s.x, s.y, s.w, s.h, 7);
      ctx.fillStyle = s.priority ? '#2e5f69' : '#31496f';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = s.priority ? '#4a8f99' : '#4a6da3';
      if (s.face === 'down') ctx.fillRect(s.x + 4, s.y + 3, s.w - 8, 6);
      else if (s.face === 'up') ctx.fillRect(s.x + 4, s.y + s.h - 9, s.w - 8, 6);
      else if (s.face === 'right') ctx.fillRect(s.x + 3, s.y + 4, 6, s.h - 8);
      else ctx.fillRect(s.x + s.w - 9, s.y + 4, 6, s.h - 8);

      if (!s.taken) {
        ctx.fillStyle = 'rgba(232,237,247,0.07)';
        circle(s.x + s.w / 2, s.y + s.h / 2, 5);
        ctx.fill();
      }
    }
  }

  function drawPassengers() {
    for (const p of world.passengers) if (!p.gone && p.seated) drawPassenger(p);
    for (const p of world.passengers) if (!p.gone && !p.seated) drawPassenger(p);
  }

  function drawPassenger(p) {
    const tripped = p.stumble > 0;
    const lean = p.down > 0 ? 0 : clamp(p.bal, -1, 1);
    const wobble = !tripped && Math.abs(lean) > BALANCE.wobbleAt;

    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.down > 0) ctx.rotate((p.id % 2 ? 1 : -1) * 1.3);
    else if (!p.seated) ctx.rotate(lean * 0.35);

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 7, 11, 5.5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 10.5, 0, 0, TAU);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (p.bag) {
      ctx.fillStyle = 'rgba(20,25,35,0.7)';
      rr(4, -3, 7, 9, 2);
      ctx.fill();
    }

    const hx = Math.cos(p.dir) * 1.5;
    const hy = -2.5 + Math.sin(p.dir) * 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, TAU);
    ctx.fillStyle = p.skin;
    ctx.fill();
    // hair covers only the back half of the head so the face still reads
    ctx.beginPath();
    ctx.arc(hx, hy, 6.05, p.dir + Math.PI / 2, p.dir - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = p.hair;
    ctx.fill();
    ctx.restore();

    if (tripped) {
      const left = clamp(p.stumble / (p.stumbleMax || 1), 0, 1);
      const pulse = 0.55 + 0.45 * Math.sin(game.time * 18);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = C.danger;
      ctx.lineWidth = 2;
      circle(p.x, p.y, 17);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = C.danger;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      ctx.stroke();

      ctx.fillStyle = C.danger;
      ctx.font = '800 16px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', p.x, p.y - 28 + Math.sin(game.time * 14) * 2);
    } else if ((wobble || p.held) && p.onboard && p.down <= 0) {
      const bx = p.x, by = p.y - 21, bw = 22;
      const t = clamp(Math.abs(lean) / BALANCE.wobbleAt, 0, 1);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(8,12,20,0.8)';
      rr(bx - bw / 2, by, bw, 4, 2);
      ctx.fill();
      ctx.fillStyle = p.held ? C.ok : C.amber;
      const ww = Math.max(3, t * bw);
      const x0 = lean < 0 ? bx - bw / 2 : bx + bw / 2 - ww;
      rr(x0, by, ww, 4, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (p.held && tripped) {
      ctx.strokeStyle = 'rgba(87,224,138,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      circle(p.x, p.y, 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawPlayer() {
    const px = player.x, py = player.y;
    const bob = Math.sin(player.bob) * 0.8;

    if (player.steady) {
      const g = ctx.createRadialGradient(px, py, 8, px, py, 62);
      g.addColorStop(0, 'rgba(255,200,87,0.18)');
      g.addColorStop(0.75, 'rgba(255,200,87,0.07)');
      g.addColorStop(1, 'rgba(255,200,87,0)');
      circle(px, py, 62);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,87,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = 'rgba(87,224,138,0.5)';
      ctx.lineWidth = 1.5;
      for (const p of world.passengers) {
        if (!p.held) continue;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(px, py + bob);

    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 8, 12, 6, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.ellipse(0, 0, 10.5, 11.5, 0, 0, TAU);
    ctx.fillStyle = '#ffc857';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,5,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.lineTo(8, -2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -3, 6.4, 0, TAU);
    ctx.fillStyle = '#e8b48c';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -3.4, 6.8, Math.PI, TAU);
    ctx.fillStyle = '#1b2436';
    ctx.fill();
    ctx.fillRect(-6.8, -4.4, 13.6, 2.2);
    ctx.restore();

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = C.amber;
    const fx = px + Math.cos(player.facing) * 18;
    const fy = py + Math.sin(player.facing) * 18;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(px + Math.cos(player.facing + 2.5) * 13, py + Math.sin(player.facing + 2.5) * 13);
    ctx.lineTo(px + Math.cos(player.facing - 2.5) * 13, py + Math.sin(player.facing - 2.5) * 13);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawFx() {
    for (const f of world.fx) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      if (f.dot) {
        circle(f.x, f.y, 3);
        ctx.fillStyle = f.color;
        ctx.fill();
      } else {
        ctx.fillStyle = f.color;
        ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 700);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (game.state === 'playing' && game.hearts <= 1) {
      ctx.fillStyle = `rgba(255,90,95,${0.05 + 0.04 * Math.sin(game.time * 5)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* -------------------------------- loop -------------------------------- */
  let last = performance.now();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (game.state === 'playing') update(dt);
    if (game.state !== 'paused') render();
    requestAnimationFrame(frame);
  }

  /* -------------------------------- input ------------------------------- */
  const keyMap = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  };

  window.addEventListener('keydown', (e) => {
    if (keyMap[e.code]) { input[keyMap[e.code]] = 1; e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); setSteady(true); return; }
    if (e.code === 'KeyQ') { e.preventDefault(); Sound.init(); toggleDoors('top'); return; }
    if (e.code === 'KeyE') { e.preventDefault(); Sound.init(); toggleDoors('bottom'); return; }
    if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
    if (e.code === 'KeyM') { toggleMute(); return; }
    if (e.code === 'Enter' && (game.state === 'title' || game.state === 'over')) { startGame(); return; }
  });

  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) input[keyMap[e.code]] = 0;
    if (e.code === 'Space') setSteady(false);
  });

  window.addEventListener('blur', () => {
    input.up = input.down = input.left = input.right = 0;
    input.pointer = null;
    setSteady(false);
  });

  function setSteady(on) {
    player.steady = on && game.state === 'playing';
    ui.steadyBtn.classList.toggle('on', player.steady);
  }

  ui.steadyBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Sound.init();
    setSteady(true);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    ui.steadyBtn.addEventListener(ev, () => setSteady(false));
  }

  ui.doorTopBtn.addEventListener('click', () => { Sound.init(); toggleDoors('top'); });
  ui.doorBottomBtn.addEventListener('click', () => { Sound.init(); toggleDoors('bottom'); });

  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing') return;
    Sound.init();
    canvas.setPointerCapture(e.pointerId);
    input.pointer = toWorld(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!input.pointer) return;
    input.pointer = toWorld(e.clientX, e.clientY);
  });
  const dropPointer = () => { input.pointer = null; };
  canvas.addEventListener('pointerup', dropPointer);
  canvas.addEventListener('pointercancel', dropPointer);

  /* ------------------------------- screens ------------------------------- */
  const overlays = { title: $('overlayTitle'), over: $('overlayOver'), pause: $('overlayPause') };
  const show = (el, on) => el.classList.toggle('hidden', !on);

  if (game.best > 0) $('bestLine').textContent = `Personal best: ${game.best.toLocaleString()}`;

  function startGame() {
    Sound.init();
    game.state = 'playing';
    game.score = 0;
    game.hearts = 5;
    game.stops = 0;
    game.time = 0;
    game.cleanStops = 0;
    game.fallsThisStop = 0;

    world.passengers = [];
    world.fx = [];
    world.speed = 0;
    world.scroll = 0;
    world.shake = 0;
    world.sway = 0;
    world.swayV = 0;
    world.closingOut = false;
    world.stuckT = 0;
    player.x = 480; player.y = 452; player.steady = false;
    player.facing = -Math.PI / 2;

    for (const s of SEATS) s.taken = null;
    for (const s of STAND) s.taken = null;
    for (const d of DOORS) { d.open = 0; d.target = 0; d.cd = 0; }

    for (const s of SEATS) {
      if (Math.random() < 0.72) {
        const p = makePassenger({ x: s.x + s.w / 2, y: s.y + s.h / 2, onboard: true });
        p.dest = ri(1, 4);
        seatDown(p, s);
        world.passengers.push(p);
      }
    }
    for (let i = 0; i < 3; i++) {
      const spot = STAND[i];
      const p = makePassenger({ x: spot.x, y: spot.y, onboard: true });
      p.dest = ri(1, 4);
      p.spot = spot;
      spot.taken = p;
      p.state = 'stand';
      world.passengers.push(p);
    }

    beginStop(0);
    world.dwell = world.dwellMax = 18;
    say('Shift begins — open the doors.', 4);

    show(overlays.title, false);
    show(overlays.over, false);
    show(overlays.pause, false);
    cached.dwell = null;
    syncHud();
  }

  function togglePause() {
    if (game.state === 'playing') {
      game.state = 'paused';
      show(overlays.pause, true);
    } else if (game.state === 'paused') {
      game.state = 'playing';
      show(overlays.pause, false);
      last = performance.now();
    }
  }

  function toggleMute() {
    Sound.init();
    const m = Sound.toggle();
    $('muteBtn').textContent = m ? '✕' : '♪';
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  $('muteBtn').addEventListener('click', toggleMute);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') togglePause();
  });

  /* -------------------------------- boot --------------------------------- */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  syncHud();
  requestAnimationFrame(frame);

  // handy handle for the headless smoke test and for tinkering in devtools
  window.__TG = {
    game, world, player, doors: DOORS, input, cam,
    get view() { return view; },
    toggleDoors, startGame, setSteady,
    step: update, render, resize: () => { resize(); },
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') boot();
