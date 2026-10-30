import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPath, catmullRom, project, sample } from '../src/geo.js';
import { createWorld } from '../src/world.js';
import {
  KMH, TUNING, computeSignals, gapAhead, nextSignal, playerTrain,
  setPlayer, speedLimitFor, stationDistance, stepWorld, toggleDoors,
} from '../src/sim.js';

const run = (world, seconds, controls = { autopilot: true }) => {
  const frames = Math.round(Math.min(seconds, 40) * 60);
  for (let i = 0; i < frames; i++) stepWorld(world, 1 / 60, controls);
};

test('paths measure themselves and can be sampled anywhere', () => {
  const path = buildPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], 8);
  assert.ok(path.length > 190 && path.length < 210, `length ${path.length}`);

  const start = sample(path, 0);
  const mid = sample(path, path.length / 2);
  const end = sample(path, path.length);
  assert.ok(Math.abs(start.x) < 2);
  assert.ok(Math.abs(mid.x - path.length / 2) < 6);
  assert.ok(Math.abs(end.x - 200) < 6);

  // sampling past the ends is clamped, never NaN
  assert.ok(Number.isFinite(sample(path, -50).x));
  assert.ok(Number.isFinite(sample(path, path.length + 500).x));
});

test('a box of control points becomes a rounded curve, not a polyline', () => {
  const pts = catmullRom([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }], 10);
  assert.equal(pts.length, 31);
  // the joint between two segments is a genuine curve: no sample sits sharply,
  // and the mid-sample pulls off the straight chord between its neighbours
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(chord > 0.1, `samples ${i - 1} and ${i + 1} collapsed`);
  }
  // the middle of the 0,100 -> 100,100 leg bows off the chord instead of
  // running dead straight through the corner
  const bow = Math.abs(pts[15].y - 100);
  assert.ok(bow > 5, `the corner should bow, got ${bow.toFixed(2)}`);
});

test('project() snaps a station onto the rails', () => {
  const path = buildPath([{ x: 0, y: 0 }, { x: 200, y: 0 }], 8);
  const hit = project(path, 100, 40);
  assert.ok(Math.abs(hit.x - 100) < 6);
  assert.ok(Math.abs(hit.y) < 1.5);
  assert.ok(hit.dist > 30 && hit.dist < 50);
});

test('the world has a trunk and a branch with a fleet on each', () => {
  const world = createWorld();
  assert.equal(Object.keys(world.paths).length, 3);
  assert.ok(world.stations.length >= 18);
  assert.equal(world.trains.length, 7);

  for (const train of world.trains) {
    assert.ok(train.route.length >= 3, `${train.id} needs a route`);
    for (const stop of train.route) {
      assert.ok(stop && Number.isFinite(stop.s), `${train.id} has an unresolved stop`);
      assert.equal(stop.pathId, train.pathId, `${train.id} stop ${stop.name} is on the wrong line`);
    }
    // routes are ordered along the line in the direction of travel
    const ds = train.route.map((st) => st.s);
    const sorted = [...ds].sort((a, b) => a - b);
    assert.deepEqual(ds, sorted, `${train.id} route is not in track order`);
  }
});

test('the express starts at a platform with its doors open', () => {
  const world = createWorld();
  const train = playerTrain(world);
  assert.equal(train.state, 'dwell');
  assert.ok(train.doors > 0);
  assert.ok(train.route[train.idx]);
});

test('power accelerates, brake stops, and nothing exceeds the limit', () => {
  const world = createWorld();
  const train = playerTrain(world);
  train.state = 'run';
  train.dwell = 0;
  train.doors = 0;

  for (let i = 0; i < 60 * 30; i++) stepWorld(world, 1 / 60, { throttle: true, brake: false, hazard: false });
  assert.ok(train.v > 5, `should be rolling, got ${train.v}`);
  assert.ok(train.v <= train.vmax + 1e-6, 'never exceed the design speed');

  for (let i = 0; i < 60 * 60; i++) stepWorld(world, 1 / 60, { throttle: false, brake: true, hazard: false });
  assert.equal(train.v, 0);
});

test('the emergency brake stops sooner than the service brake', () => {
  const make = () => {
    const world = createWorld();
    const train = playerTrain(world);
    train.state = 'run';
    train.dwell = 0;
    train.doors = 0;
    train.doorTarget = 0;
    train.v = 20;
    return { world, train };
  };

  const service = make();
  let serviceFrames = 0;
  while (service.train.v > 0.01 && serviceFrames < 60 * 120) {
    stepWorld(service.world, 1 / 60, { throttle: false, brake: true, hazard: false });
    serviceFrames++;
  }

  const emergency = make();
  let emergencyFrames = 0;
  while (emergency.train.v > 0.01 && emergencyFrames < 60 * 120) {
    stepWorld(emergency.world, 1 / 60, { throttle: false, brake: false, hazard: true });
    emergencyFrames++;
  }

  assert.ok(emergencyFrames < serviceFrames, `emergency ${emergencyFrames} < service ${serviceFrames}`);
});

test('doors only release at a platform, and only when nearly stopped', () => {
  const world = createWorld();
  const train = playerTrain(world);
  train.state = 'run';
  train.dwell = 0;

  const stop = train.route[train.idx];
  train.s = stop.s + 400;
  assert.equal(toggleDoors(world, train), false, 'doors must not open away from a platform');

  train.s = stop.s + 6;
  train.v = 0;
  assert.equal(toggleDoors(world, train), true);
  assert.equal(train.state, 'dwell');
});

test('arriving at a platform releases the doors and exchanges passengers', () => {
  const world = createWorld();
  const train = playerTrain(world);
  train.state = 'run';
  train.dwell = 0;
  const stop = train.route[train.idx];
  world.stationById.get(stop.id).waiting = 80;
  const before = world.stationById.get(stop.id).waiting;

  train.s = stop.s - 40;
  train.v = 1.5;
  for (let i = 0; i < 60 * 8; i++) stepWorld(world, 1 / 60, { throttle: false, brake: true, hazard: false });

  assert.equal(train.state, 'dwell');
  assert.ok(train.doors > 0, 'doors should be opening');
  assert.ok(train.onboard > 0, 'passengers should have boarded');
  assert.ok(world.stationById.get(stop.id).waiting < before, 'the platform queue should shrink');
});

test('a train that runs through a station is penalised', () => {
  const world = createWorld();
  const train = playerTrain(world);
  train.state = 'run';
  train.dwell = 0;
  const stop = train.route[train.idx];
  const before = train.stats.missed;

  train.s = stop.s;
  train.v = 25;
  for (let i = 0; i < 60 * 8; i++) stepWorld(world, 1 / 60, { throttle: true, brake: false, hazard: false });

  assert.equal(train.stats.missed, before + 1, 'sailing through counts as a miss');
  assert.notEqual(train.route[train.idx], stop, 'the next call should now be the following station');
});

test('signals are clear ahead, red behind a standing train', () => {
  const world = createWorld();
  const line = world.trains.find((t) => t.id === 'player').pathId;
  const [a, b] = world.trains.filter((t) => t.pathId === line && t.dir === 1);
  // stand the follower up in a block past the first signal, so a block is held
  b.s = 2050;
  b.v = 0;
  b.state = 'dwell';
  a.s = 1500;
  computeSignals(world);

  const sig = nextSignal(world, a);
  assert.ok(sig, 'the leader should see a signal');
  const anyRed = (world.signals[line]?.plus || []).some((s) => s.red);
  assert.ok(anyRed, 'a block holding a train must show red');
});

test('AI traffic never rear-ends itself and never deadlocks', () => {
  const world = createWorld();
  const minutes = 12;
  for (let i = 0; i < 60 * 60 * minutes; i++) stepWorld(world, 1 / 60, { autopilot: true });

  assert.equal(world.collisions, 0, 'the network should be collision free under autopilot');
  for (const train of world.trains) {
    assert.equal(train.stats.collisions, 0, `${train.id} collided`);
    assert.ok(train.stats.stops >= 3, `${train.id} only made ${train.stats.stops} stops in ${minutes} min`);
  }
  const delivered = world.delivered;
  assert.ok(delivered > 500, `passengers should be moving, delivered ${delivered}`);
});

test('a gap is only reported for a train that is actually in the way', () => {
  const world = createWorld();
  const line = world.trains.find((t) => t.id === 'player').pathId;
  const [lead, follow] = world.trains.filter((t) => t.pathId === line && t.dir === 1);
  // keep the rest of the fleet out of the measurement
  world.trains = [lead, follow];
  follow.s = lead.s - 500;
  lead.v = 20;
  lead.state = 'run';
  follow.v = 20;
  assert.equal(gapAhead(world, follow), null, 'a train running away ahead is not an obstacle');

  lead.v = 0;
  lead.state = 'dwell';
  const gap = gapAhead(world, follow);
  const tail = lead.length;
  assert.ok(gap !== null && Math.abs(gap - (500 - tail)) < 1,
    `expected ${500 - tail} m of clear road, got ${gap}`);
});

test('speed limits drop for the approach to a station', () => {
  const world = createWorld();
  const train = playerTrain(world);
  const stop = train.route[train.idx];
  train.state = 'run';
  train.s = stop.s - 1500;
  const line = speedLimitFor(world, train);
  train.s = stop.s - 100;
  const approach = speedLimitFor(world, train);
  assert.ok(approach < line, `approach ${approach} should be below line ${line}`);
  assert.ok(line * KMH > 60);
});

test('taking control hands the previous train to the autopilot', () => {
  const world = createWorld();
  const next = world.trains.find((t) => t.ai);
  setPlayer(world, next.id);
  assert.equal(world.playerId, next.id);
  assert.equal(next.ai, false);
  for (const other of world.trains) {
    if (other.id !== next.id) assert.equal(other.ai, true, `${other.id} should be on autopilot`);
  }
});

test('a train held at a red signal does not get its stop skipped by the idle guard', () => {
  const world = createWorld();
  const train = playerTrain(world);
  train.state = 'run';
  train.dwell = 0;
  // pick a stop with track behind it, so the train can be 300 m short of it
  train.idx = Math.min(2, train.route.length - 1);
  const stop = train.route[train.idx];
  train.s = stop.s - 300;
  train.v = 0;

  // park another train right in front so the signal stays red
  const blocker = world.trains.find((t) => t !== train && t.pathId === train.pathId && t.dir === train.dir);
  blocker.s = train.s + 90;
  blocker.v = 0;
  blocker.state = 'dwell';

  const before = train.stats.missed;
  for (let i = 0; i < 60 * 40; i++) stepWorld(world, 1 / 60, { throttle: false, brake: false, hazard: false });
  assert.equal(train.stats.missed, before, 'waiting for a red signal is not missing a stop');
  assert.ok(stationDistance(train, stop) > 0, 'the train must not have passed the platform');
});

test('TUNING is coherent', () => {
  assert.ok(TUNING.arriveWindow > 0);
  assert.ok(TUNING.overshoot > TUNING.arriveWindow);
  assert.ok(TUNING.exchangeAt > 0 && TUNING.exchangeAt < 1);
  assert.ok(TUNING.dwell > 0);
  assert.equal(KMH, 3.6);
});
