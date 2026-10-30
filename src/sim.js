/**
 * The simulation: physics, station stops, signals, passengers and scoring.
 * No DOM, no canvas — everything here is deterministic enough to test.
 */

import { clamp, sample } from './geo.js';

/** 1 world unit = 1 metre. Speeds are metres per second; ×3.6 gives km/h. */
export const KMH = 3.6;

export const TUNING = Object.freeze({
  arriveWindow: 62,      // half the platform: stop anywhere alongside the deck
  overshoot: 78,         // past this you have run through the station
  coastDrag: 0.5,        // m/s² lost when neither power nor brake is applied
  emergencyMult: 1.9,
  blockLength: 430,      // signal block spacing
  safeGap: 34,           // AI keeps this much clear air to the train ahead
  dwell: 20,             // seconds a train may stand at a platform
  exchangeAt: 0.55,      // doors fraction where passengers swap
  boardingPoints: 1,     // per passenger
  accuracyPoints: 40,    // best-case stop bonus
  missedPenalty: 30,
  spadPenalty: 60,
  collisionPenalty: 120,
});

const clampIdx = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

export function stationDistance(train, station) {
  return (station.s - train.s) * train.dir;
}

export function formatClock(seconds) {
  const t = ((seconds % 86400) + 86400) % 86400;
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = Math.floor(t % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Distance to the nearest train ahead that is in our way.
 *
 * A train that is not moving away (dwelling, held at a signal, or crawling) is
 * an obstacle: we measure our nose to its tail. A train that is running ahead
 * of us is traffic we are following, not something to measure against — that is
 * what keeps the maps from showing phantom 16 m gaps at line speed.
 */
export function gapAhead(world, train) {
  let best = null;
  for (const other of world.trains) {
    if (other === train || other.pathId !== train.pathId || other.dir !== train.dir) continue;
    const ahead = (other.s - train.s) * train.dir;
    if (ahead <= 0) continue;
    const gap = ahead - other.length;
    if (gap < 0) return 0;
    const closing = train.v > other.v + 0.5;
    if (other.state === 'dwell' || other.v < 1 || closing) {
      if (best === null || gap < best) best = gap;
    }
  }
  return best;
}

/** Trains sharing a track — same direction only, since the line is double track. */
export function collisionPair(world) {
  for (let i = 0; i < world.trains.length; i++) {
    for (let j = i + 1; j < world.trains.length; j++) {
      const a = world.trains[i];
      const b = world.trains[j];
      if (a.pathId !== b.pathId || a.dir !== b.dir) continue;
      const [front, back] = a.s > b.s ? [a, b] : [b, a];
      const buffer = Math.min(front.length, back.length) * 0.55;
      if (Math.abs(a.s - b.s) < buffer && back.v > front.v + 1.2) return [a, b];
    }
  }
  return null;
}

/** Signal state per line and direction: a block is red while a train sits in it. */
export function computeSignals(world) {
  const out = {};
  for (const [pathId, path] of Object.entries(world.paths)) {
    const count = Math.floor(path.length / TUNING.blockLength);
    const plus = [];
    const minus = [];
    for (let i = 0; i < count; i++) {
      const s = (i + 0.6) * TUNING.blockLength;
      // a block is occupied when a train's nose has passed the signal and is
      // still inside the block — never by the train that is asking
      const occupied = (dir) => world.trains.some((t) => {
        if (t.pathId !== pathId || t.dir !== dir) return false;
        const ahead = (t.s - s) * dir;
        return ahead > 0 && ahead < TUNING.blockLength;
      });
      plus.push({ s, red: occupied(1) });
      minus.push({ s, red: occupied(-1) });
    }
    out[pathId] = { plus, minus };
  }
  world.signals = out;
  return out;
}

/** The next signal this train will reach, if any. */
export function nextSignal(world, train) {
  const set = world.signals[train.pathId];
  if (!set) return null;
  const list = train.dir > 0 ? set.plus : set.minus;
  let best = null;
  for (const sig of list) {
    const d = (sig.s - train.s) * train.dir;
    if (d <= 0) continue;
    if (!best || d < best.d) best = { ...sig, d };
  }
  return best;
}

function exchangePassengers(world, train, station) {
  const alight = Math.min(Math.floor(train.onboard), train.dest.get(station.id) || 0);
  if (alight > 0) {
    train.onboard -= alight;
    train.dest.set(station.id, (train.dest.get(station.id) || 0) - alight);
    train.stats.delivered += alight;
    station.delivered += alight;
    world.delivered += alight;
  }

  // nobody boards at a terminus: there is nowhere to go until we reverse
  const pos = train.route.findIndex((st) => st.id === station.id);
  const ahead = train.dir > 0 ? train.route.slice(pos + 1) : train.route.slice(0, pos).reverse();
  const room = train.capacity - train.onboard;
  const board = ahead.length ? Math.min(Math.floor(station.waiting), room) : 0;

  if (board > 0) {
    station.waiting -= board;
    train.onboard += board;
    for (let i = 0; i < board; i++) {
      const target = ahead[(Math.random() * ahead.length) | 0];
      train.dest.set(target.id, (train.dest.get(target.id) || 0) + 1);
    }
  }

  const isPlayer = world.playerId === train.id;
  if (isPlayer) {
    world.score += (alight + board) * TUNING.boardingPoints;
    if (alight + board > 0) {
      world.events.push({ text: `${station.name}: +${board} boarding, ${alight} alighting`, tone: 'good' });
    }
  }
  return { alight, board };
}

function stationBlocked(world, train, station) {
  // only a train actually standing at that platform counts — a following train
  // waiting behind the station must never lock the leader out of it
  return world.trains.some((other) => other !== train
    && other.pathId === train.pathId
    && other.dir === train.dir
    && other.state === 'dwell'
    && Math.abs(other.s - station.s) < other.length * 0.5 + 24);
}

function arrive(world, train, station) {
  const offset = Math.abs(train.s - station.s);
  train.s = station.s;
  train.v = 0;
  train.state = 'dwell';
  train.dwell = TUNING.dwell;
  train.lastStop = station.id;
  train.exchanged = false;
  train.stats.stops++;

  const isPlayer = world.playerId === train.id;
  if (isPlayer) {
    const bonus = Math.round(Math.max(0, TUNING.accuracyPoints - offset * 3));
    world.score += bonus;
    train.lastStopScore = bonus;
    world.events.push({ text: `${station.name} — stopped ${Math.round(offset)}m from the board (+${bonus})`, tone: 'good' });
  } else {
    train.lastStopScore = 0;
  }
  train.doors = train.doors || 0;
  train.doorTarget = 1;
  station.lastTrain = train.id;
}

function advance(world, train, reversed = false) {
  const route = train.route;
  train.idx += train.dir;
  if (train.idx >= route.length || train.idx < 0) {
    train.dir *= -1;
    train.idx = train.dir > 0 ? 1 : route.length - 2;
    train.idx = clampIdx(train.idx, route.length);
    if (reversed && world.playerId === train.id) {
      world.events.push({ text: 'Terminus — reverser set, heading back', tone: 'info' });
    }
  }
}

function depart(world, train) {
  train.state = 'run';
  train.doorTarget = 0;
  advance(world, train, true);
}

function missStop(world, train, station) {
  train.stats.missed++;
  advance(world, train);
  const isPlayer = world.playerId === train.id;
  if (isPlayer) {
    world.score = Math.max(0, world.score - TUNING.missedPenalty);
    world.events.push({ text: `MISSED ${station.name.toUpperCase()} −${TUNING.missedPenalty}`, tone: 'bad' });
  }
}

function stepTrain(world, train, dt) {
  const path = world.paths[train.pathId];

  if (train.stun > 0) {
    train.stun -= dt;
    train.v = 0;
    train.throttle = 0;
    train.braking = 1;
    return;
  }

  // ---- doors & dwell ----
  if (train.state === 'dwell') {
    const station = train.route[train.idx];
    const speed = dt / 0.6;
    train.doors += clamp(train.doorTarget - train.doors, -speed, speed);
    if (!train.exchanged && train.doors > TUNING.exchangeAt) {
      train.exchanged = true;
      exchangePassengers(world, train, station);
    }
    train.dwell -= dt;
    if (train.dwell <= 0) train.doorTarget = 0;
    if (train.doorTarget === 0 && train.doors <= 0.001) {
      train.doors = 0;
      if (train.autoDepart !== false) depart(world, train);
    }
    train.v = 0;
    return;
  }

  // ---- power / brake ----
  const throttle = clamp(train.throttle || 0, 0, 1);
  const braking = Math.max(0, train.braking || 0);
  let accel = throttle * train.accel - braking * train.brake;
  if (!throttle && !braking) accel = -Math.sign(train.v) * TUNING.coastDrag;

  train.v = clamp(train.v + accel * dt, 0, train.vmax);
  if (train.v < 0.5 && !throttle) train.v = 0;
  train.s += train.dir * train.v * dt;

  // ---- line ends ----
  if (train.s >= path.length) {
    train.s = path.length;
    train.v = 0;
  } else if (train.s <= 0) {
    train.s = 0;
    train.v = 0;
  }

  // ---- the stop we are running at ----
  const target = train.route[train.idx];
  if (target) {
    const d = stationDistance(train, target);
    if (Math.abs(d) <= TUNING.arriveWindow && train.v <= 2.6) {
      if (stationBlocked(world, train, target)) {
        train.v = 0; // hold short: the platform is still occupied
        return;
      }
      arrive(world, train, target);
      return;
    }
    if (d < -TUNING.overshoot) {
      missStop(world, train, target);
      return;
    }
  }

  // limbo guard: standing still on the running line with nothing in front of us
  // means the stop logic has lost track of this train — skip the call and go
  if (train.ai !== false && train.state === 'run' && train.v < 0.25 && !(train.throttle > 0)) {
    const gap = gapAhead(world, train);
    const sig = nextSignal(world, train);
    const blocked = (gap !== null && gap < TUNING.safeGap * 1.6)
      || (sig !== null && sig.red && sig.d < 90);
    train.idle = blocked ? 0 : (train.idle || 0) + dt;
    if (train.idle > 12) {
      train.idle = 0;
      const target = train.route[train.idx];
      const d = target ? stationDistance(train, target) : 0;
      if (target && d < -TUNING.arriveWindow) {
        // stopped beyond the platform edge in clear air: that is a miss, not a
        // queue, and the timetable has to say so
        missStop(world, train, target);
      } else {
        advance(world, train); // queued behind traffic: skip quietly
      }
    }
  } else {
    train.idle = 0;
  }
}

/** Autopilot: brake for the next stop, the red signal, or the train in front. */
export function driveAI(world, train, dt) {
  if (train.state === 'dwell') {
    train.throttle = 0;
    train.braking = 1;
    return; // the dwell timer closes the doors
  }

  const target = train.route[train.idx];
  let goal = train.vmax;

  if (target) {
    const d = stationDistance(train, target);
    // Braking curve: the highest speed from which the brakes can still pull us
    // up at the board. We aim at a comfortable fraction of the brake so there
    // is always margin left to correct with.
    const stopAt = Math.max(0, d - 5);
    const usable = train.brake * 0.55;
    goal = Math.min(goal, Math.sqrt(2 * usable * stopAt));
    if (d < 10) goal = Math.min(goal, Math.max(0, d * 0.35));
  }

  const sig = nextSignal(world, train);
  if (sig && sig.red) {
    goal = Math.min(goal, Math.sqrt(Math.max(0, 2 * train.brake * Math.max(0, sig.d - 14))));
  }

  const gap = gapAhead(world, train);
  if (gap !== null) {
    if (gap < TUNING.safeGap) goal = 0;
    else goal = Math.min(goal, Math.sqrt(Math.max(0, 2 * train.brake * (gap - TUNING.safeGap))));
  }

  if (train.v < goal - 0.3) {
    train.throttle = 1;
    train.braking = 0;
  } else if (train.v > goal + 0.3) {
    train.throttle = 0;
    // a tight proportional band: a lazy one lets the train drift past the board
    train.braking = clamp((train.v - goal) / 3.5, 0.2, 1);
  } else {
    train.throttle = 0;
    train.braking = 0;
  }
  void dt;
}

/** Player input: throttle/brake are booleans, hazard is the emergency brake. */
export function drivePlayer(world, train, controls) {
  if (train.state === 'dwell') {
    train.throttle = 0;
    train.braking = 1;
    return;
  }
  train.throttle = controls.throttle ? 1 : 0;
  train.braking = controls.hazard ? TUNING.emergencyMult : controls.brake ? 1 : 0;
}

export function toggleDoors(world, train) {
  const station = train.route[train.idx];
  if (train.state === 'dwell') {
    // closing early lets the train get away
    if (train.doors > 0.5) train.doorTarget = 0;
    else train.doorTarget = 1;
    return true;
  }
  if (!station) return false;
  const d = Math.abs(stationDistance(train, station));
  if (d <= TUNING.arriveWindow && train.v <= 1.2) {
    if (train.state !== 'dwell') arrive(world, train, station);
    train.doorTarget = 1;
    if (world.playerId === train.id) {
      world.events.push({ text: `${station.name} — doors released`, tone: 'info' });
    }
    return true;
  }
  return false;
}

export function setPlayer(world, trainId) {
  const train = world.trains.find((t) => t.id === trainId);
  if (!train) return null;
  for (const t of world.trains) {
    t.ai = t.id !== trainId;
    t.autoDepart = true;
  }
  world.playerId = trainId;
  world.events.push({ text: `Control: ${train.name}`, tone: 'info' });
  return train;
}

export function playerTrain(world) {
  return world.trains.find((t) => t.id === world.playerId) || world.trains[0];
}

/** Advance the whole network by dt seconds. */
export function stepWorld(world, dt, controls = {}) {
  dt = Math.min(dt, 0.05);
  world.time += dt;

  // commuters keep arriving
  for (const station of world.stationById.values()) {
    const rate = station.major ? 1.5 : 0.55;
    const cap = station.major ? 420 : 190;
    if (station.waiting < cap) station.waiting = Math.min(cap, station.waiting + rate * dt);
  }

  const player = playerTrain(world);
  for (const train of world.trains) {
    if (train === player && !controls.autopilot) drivePlayer(world, train, controls);
    else driveAI(world, train, dt);
    stepTrain(world, train, dt);
  }

  // AI trains hold their distance behind whoever is in front: this is a
  // timetable, not a demolition derby. Only the player can actually hit a train.
  for (const train of world.trains) {
    if (train === player && !controls.autopilot) continue;
    const lead = world.trains.find((o) => o !== train
      && o.pathId === train.pathId && o.dir === train.dir
      && (o.s - train.s) * train.dir > 0
      && (o.s - train.s) * train.dir < o.length + train.length + 40);
    if (!lead) continue;
    const limit = lead.s - train.dir * (lead.length + 16);
    if ((limit - train.s) * train.dir < 0) {
      train.s = limit;
      train.v = Math.min(train.v, lead.v);
    }
  }

  // hard collisions
  const pair = collisionPair(world);
  const playerInvolved = pair && (pair[0] === player || pair[1] === player);
  if (playerInvolved && pair[0].stun <= 0 && pair[1].stun <= 0) {
    const [a, b] = pair;
    a.v = 0;
    b.v = 0;
    a.throttle = 0;
    b.throttle = 0;
    a.braking = 1;
    b.braking = 1;
    a.stats.collisions++;
    b.stats.collisions++;
    a.stun = 2.5;
    b.stun = 2.5;
    world.collisions++;
    world.collisionT = 0.9;
    if (world.playerId === a.id || world.playerId === b.id) {
      world.score = Math.max(0, world.score - TUNING.collisionPenalty);
      world.events.push({ text: `COLLISION on the ${a.pathId} line −${TUNING.collisionPenalty}`, tone: 'bad' });
    }
  }

  computeSignals(world);

  if (world.collisionT > 0) world.collisionT -= dt;
  for (const t of world.trains) if (t.messageT > 0) t.messageT -= dt;
  if (world.events.length > 6) world.events.splice(0, world.events.length - 6);
  return world;
}

/** How far along the line a train is, 0..1 — handy for the map and HUD. */
/** Advisory limit for the stretch ahead: junctions and platforms are slower. */
export function speedLimitFor(world, train) {
  const target = train.route[train.idx];
  const base = train.kind === 'express' ? 26 : train.kind === 'shuttle' ? 16 : 21;
  if (!target) return base;
  const d = Math.abs(stationDistance(train, target));
  if (d < 220) return train.kind === 'express' ? 11 : 10;
  if (d < 620) return Math.min(base, 16);
  return base;
}

export function progress(world, train) {
  return clamp(train.s / world.paths[train.pathId].length, 0, 1);
}

export function trainPose(world, train, offset = 0) {
  const path = world.paths[train.pathId];
  const s = clamp(train.s - train.dir * offset, 0, path.length);
  return sample(path, s);
}
