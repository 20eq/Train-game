import test from 'node:test';
import assert from 'node:assert/strict';

import { CITIES, getCity, liveryFor } from '../src/cities.js';
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

test('Mumbai locals wear the real yellow and violet', () => {
  const mumbai = CITIES.find((c) => c.id === 'mumbai');
  const emu = liveryFor(mumbai, 'emu');
  // the Western/Central/Harbour rake: yellow body, violet band, grey roof
  assert.equal(emu.body.toLowerCase(), '#f0c22c', 'Mumbai EMU body is yellow');
  assert.equal(emu.stripe.toLowerCase(), '#5a2a86', 'with the violet band');
  assert.ok(emu.roof && emu.trim, 'and a roof and underframe colour');

  // every other city keeps its own band, so no two locals look alike
  const bands = new Set(CITIES.map((c) => liveryFor(c, 'emu').stripe.toLowerCase()));
  assert.equal(bands.size, CITIES.length, 'each city has a distinct band colour');
  const bodies = new Set(CITIES.map((c) => liveryFor(c, 'emu').body.toLowerCase()));
  assert.equal(bodies.size, CITIES.length, 'and a distinct body colour');
});

test('every line runs its own local — Mumbai has three', () => {
  for (const city of CITIES) {
    const ids = city.services.map((sv) => sv.id);
    assert.equal(new Set(ids).size, ids.length, `${city.id} has duplicate service ids`);

    for (const line of city.lines) {
      const onLine = city.services.filter((sv) => sv.line === line.id);
      assert.ok(onLine.length >= 1, `${city.id}/${line.id} offers nothing to drive`);

      const local = onLine.find((sv) => sv.type === 'local');
      assert.ok(local, `${city.id}/${line.id} has no local`);
      assert.equal(local.stock, 'emu', `${city.id}/${line.id} local is suburban EMU stock`);
      assert.equal(local.loco, null, 'a suburban local is not locomotive hauled');
      assert.equal(local.lineName, line.name);
      assert.equal(local.lineColour, line.colour);
      assert.ok(local.cars >= 8 && local.cars <= 12, `${city.id}/${line.id} local has ${local.cars} cars`);

      // a loco-hauled working, where the line carries one, is genuinely different
      const passenger = onLine.find((sv) => sv.type === 'passenger');
      if (passenger) {
        assert.equal(passenger.stock, 'icf');
        assert.equal(passenger.loco, 'WAP4');
        assert.ok(passenger.cars >= 8);
      }
      const express = onLine.find((sv) => sv.type === 'express');
      if (express) {
        assert.equal(express.stock, 'lhb');
        assert.ok(['WAP7', 'WAP5'].includes(express.loco), 'the express is electric-hauled');
        assert.equal(express.stops, 'majors');
        if (passenger) assert.ok(express.cars > passenger.cars, 'the express carries the longest rake');
      }
    }
  }

  // Mumbai's three lines each have a local with its own name and line
  const mumbai = CITIES.find((c) => c.id === 'mumbai');
  const locals = mumbai.services.filter((sv) => sv.type === 'local');
  assert.equal(locals.length, 3, 'Western, Central and Harbour each run a local');
  assert.deepEqual(locals.map((sv) => sv.line), ['western', 'central', 'harbour']);
  assert.equal(new Set(locals.map((sv) => sv.name)).size, 3, 'and each has its own name');
  assert.equal(mumbai.services.length, 9, 'three lines x three classes of working');
});

test('every service builds its own run, on its own line', () => {
  for (const city of CITIES) {
    for (const sv of city.services) {
      const world = createWorld({ city: city.id, service: sv.id });
      const train = world.trains[0];
      assert.equal(world.service.id, sv.id, `${sv.id} resolves to itself`);
      assert.equal(train.name, sv.name);
      assert.equal(train.stock, sv.stock);
      assert.equal(train.loco, sv.loco);
      assert.equal(train.pathId, sv.line, 'the service runs the line it names');
      assert.equal(train.coaches, sv.cars);
      assert.ok(world.paths[sv.line], 'and that line exists');
      // the picker's line map needs stations to draw
      assert.ok(world.stationsOnPath[sv.line].length >= 10);
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
