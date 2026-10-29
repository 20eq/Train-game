import test from 'node:test';
import assert from 'node:assert/strict';

import { CITIES, getCity } from '../src/cities.js';
import { createWorld, makeRand } from '../src/world.js';
import { stepWorld } from '../src/sim.js';

test('there are four cities, each with its own line and livery', () => {
  assert.ok(CITIES.length >= 4);
  const ids = new Set(CITIES.map((c) => c.id));
  assert.equal(ids.size, CITIES.length, 'city ids must be unique');

  const liveries = new Set(CITIES.map((c) => c.livery.local));
  assert.equal(liveries.size, CITIES.length, 'each city needs a distinct local livery');

  const lines = new Set(CITIES.map((c) => c.line));
  assert.equal(lines.size, CITIES.length, 'each city needs its own line name');

  for (const city of CITIES) {
    assert.ok(city.stations.length >= 10, `${city.id} needs a real station list`);
    assert.ok(city.palette.skyTop && city.palette.ground.length >= 3);
    const names = new Set(city.stations.map(([n]) => n));
    assert.equal(names.size, city.stations.length, `${city.id} has duplicate station names`);
    // percentages must climb along the line
    const ats = city.stations.map(([, at]) => at);
    assert.deepEqual(ats, [...ats].sort((a, b) => a - b), `${city.id} stations are out of order`);
  }
});

test('getCity falls back safely', () => {
  assert.equal(getCity('kolkata').city, 'Kolkata');
  assert.equal(getCity('atlantis').id, CITIES[0].id);
});

test('each city builds its own distinct network', () => {
  const shapes = new Set();
  for (const city of CITIES) {
    const world = createWorld({ city: city.id });
    assert.equal(world.city.id, city.id);
    assert.deepEqual(Object.keys(world.paths).sort(), ['branch', 'main']);
    assert.ok(world.paths.main.length > 4000, `${city.id} trunk is too short`);
    assert.ok(world.stations.length >= city.stations.length);
    assert.equal(world.trains.length, 6);

    for (const train of world.trains) {
      assert.ok(train.route.length >= 3, `${train.id} needs a route`);
      for (const stop of train.route) {
        assert.ok(stop && Number.isFinite(stop.s), `${train.id} has an unresolved stop`);
        assert.equal(stop.pathId, train.pathId);
      }
      const ds = train.route.map((st) => st.s);
      assert.deepEqual(ds, [...ds].sort((a, b) => a - b));
    }

    const stations = world.stationsOnPath.main.map((st) => st.name).join('>');
    shapes.add(stations);
  }
  assert.equal(shapes.size, CITIES.length, 'every city must have its own station sequence');
});

test('the same seed grows the same railway', () => {
  const a = createWorld({ city: 'mumbai', startWaiting: false, seed: 5 });
  const b = createWorld({ city: 'mumbai', startWaiting: false, seed: 5 });
  assert.equal(a.paths.main.length.toFixed(3), b.paths.main.length.toFixed(3));
  const c = createWorld({ city: 'mumbai', startWaiting: false, seed: 6 });
  assert.notEqual(a.paths.main.length.toFixed(1), c.paths.main.length.toFixed(1));
});

test('makeRand is deterministic and in range', () => {
  const r1 = makeRand(99);
  const r2 = makeRand(99);
  for (let i = 0; i < 50; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

test('every city can be played: the fleet cycles its route without collisions', () => {
  for (const city of CITIES) {
    const world = createWorld({ city: city.id });
    for (let i = 0; i < 60 * 60 * 6; i++) stepWorld(world, 1 / 60, { autopilot: true });
    assert.equal(world.collisions, 0, `${city.id} had collisions`);
    for (const train of world.trains) {
      assert.ok(train.stats.stops >= 1, `${train.id} in ${city.id} never completed a stop`);
    }
  }
});
