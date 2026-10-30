import test from 'node:test';
import assert from 'node:assert/strict';

import { CITIES, getCity } from '../src/cities.js';
import { createWorld, makeRand } from '../src/world.js';
import { stepWorld } from '../src/sim.js';

test('there are four cities, each with its own line and livery', () => {
  assert.ok(CITIES.length >= 4);
  const ids = new Set(CITIES.map((c) => c.id));
  assert.equal(ids.size, CITIES.length, 'city ids must be unique');

  const liveries = new Set(CITIES.map((c) => c.rolling.emu.body));
  assert.equal(liveries.size, CITIES.length, 'each city needs a distinct local livery');

  const lines = new Set(CITIES.map((c) => c.line));
  assert.equal(lines.size, CITIES.length, 'each city needs its own line name');

  for (const city of CITIES) {
    assert.ok(city.palette.skyTop && city.palette.ground.length >= 3);
    assert.equal(city.lines.length, 3, `${city.id} needs three real lines`);

    // every city runs its own rakes: EMU, ICF and LHB, each in city colours
    for (const style of ['emu', 'icf', 'lhb']) {
      assert.ok(city.rolling[style].body, `${city.id} is missing its ${style} livery`);
    }

    for (const line of city.lines) {
      assert.ok(line.stations.length >= 10, `${city.id}/${line.id} needs a real station list`);
      const names = new Set(line.stations.map(([n]) => n));
      assert.equal(names.size, line.stations.length, `${city.id}/${line.id} has duplicates`);
      // percentages must climb along the line
      const ats = line.stations.map(([, at]) => at);
      assert.deepEqual(ats, [...ats].sort((a, b) => a - b), `${city.id}/${line.id} is out of order`);
    }
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
    assert.deepEqual(Object.keys(world.paths).sort(), city.lines.map((l) => l.id).sort());
    for (const line of city.lines) {
      assert.ok(world.paths[line.id].length > 4000, `${city.id}/${line.id} is too short`);
      assert.equal(world.stationsOnPath[line.id].length, line.stations.length);
    }
    assert.ok(world.stations.length >= city.lines.reduce((n, l) => n + l.stations.length, 0));
    assert.ok(world.trains.length >= 6, `${city.id} needs a working fleet`);

    for (const train of world.trains) {
      assert.ok(train.route.length >= 3, `${train.id} needs a route`);
      for (const stop of train.route) {
        assert.ok(stop && Number.isFinite(stop.s), `${train.id} has an unresolved stop`);
        assert.equal(stop.pathId, train.pathId);
      }
      const ds = train.route.map((st) => st.s);
      assert.deepEqual(ds, [...ds].sort((a, b) => a - b));
    }

    const stations = city.lines
      .map((line) => world.stationsOnPath[line.id].map((st) => st.name).join('>'))
      .join('|');
    shapes.add(stations);
  }
  assert.equal(shapes.size, CITIES.length, 'every city must have its own station sequence');
});

test('each city runs its own rolling stock, with long rakes', () => {
  const seen = new Set();
  for (const city of CITIES) {
    const world = createWorld({ city: city.id });
    const express = world.trains.find((t) => t.id === 'player');
    const local = world.trains.find((t) => t.stock === 'emu' && t.ai);

    // the world builds whichever service was asked for; express by default
    assert.equal(express.stock, 'lhb');
    assert.ok(['WAP7', 'WAP5'].includes(express.loco), 'the express is electric-hauled');
    assert.ok(express.coaches >= 15, `${city.id} express has only ${express.coaches} coaches`);
    assert.ok(express.locoLen > 0, 'a long-distance working needs a locomotive');
    assert.ok(express.length > 300, `${city.id} express is ${Math.round(express.length)} m long`);

    assert.equal(local.stock, 'emu');
    assert.equal(local.loco, null, 'suburban stock is not locomotive hauled');
    assert.ok(local.coaches >= 6 && local.coaches <= 12, `${city.id} local has ${local.coaches} cars`);

    // the express must be substantially longer than a local on the same line
    assert.ok(express.coaches > local.coaches, `${city.id} express must out-length its locals`);
    seen.add(`${express.coaches}:${local.coaches}`);
  }
  assert.ok(seen.size >= 3, 'the cities should not all run identical formations');
});

test('every city offers a local, a passenger and an express', () => {
  for (const city of CITIES) {
    assert.equal(city.services.length, 3, `${city.id} needs three services`);
    const ids = city.services.map((s) => s.id);
    assert.deepEqual(ids, ['local', 'passenger', 'express']);

    const [local, passenger, express] = city.services;
    assert.equal(local.stock, 'emu');
    assert.equal(passenger.stock, 'icf');
    assert.equal(passenger.loco, 'WAP4', 'a passenger working is loco hauled');
    assert.equal(express.stock, 'lhb');
    assert.ok(express.loco === 'WAP7' || express.loco === 'WAP5');

    // each service names the line it works
    for (const sv of city.services) {
      assert.ok(city.lines.some((l) => l.id === sv.line), `${city.id}/${sv.id} names a real line`);
      const line = city.lines.find((l) => l.id === sv.line);
      assert.equal(sv.lineName, line.name, `${city.id}/${sv.id} carries its line name`);
    }
    assert.ok(express.cars > passenger.cars, 'the express carries the longest rake');
    assert.equal(express.stops, 'majors');
    assert.equal(local.stops, 'all');
    assert.ok(passenger.accel < local.accel, 'a loco and ten coaches pull away slower than an EMU');
  }

  // and each one actually builds
  for (const city of CITIES) {
    for (const sv of ['local', 'passenger', 'express']) {
      const world = createWorld({ city: city.id, service: sv });
      const train = world.trains[0];
      assert.equal(train.name, city.services.find((s) => s.id === sv).name);
      assert.equal(train.stock, city.services.find((s) => s.id === sv).stock);
      assert.equal(train.loco, city.services.find((s) => s.id === sv).loco);
      assert.equal(train.pathId, city.services.find((s) => s.id === sv).line, 'the service runs its own line');
    }
  }
});

test('the same seed grows the same railway', () => {
  const a = createWorld({ city: 'mumbai', startWaiting: false, seed: 5 });
  const b = createWorld({ city: 'mumbai', startWaiting: false, seed: 5 });
  const key = Object.keys(a.paths)[0];
  assert.equal(a.paths[key].length.toFixed(3), b.paths[key].length.toFixed(3));
  const c = createWorld({ city: 'mumbai', startWaiting: false, seed: 6 });
  assert.notEqual(a.paths[key].length.toFixed(1), c.paths[key].length.toFixed(1));
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
