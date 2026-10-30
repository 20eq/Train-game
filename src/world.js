/**
 * Turns a city definition into a live network: track geometry, stations,
 * signals and a fleet keeping to the timetable.
 *
 * The track is grown from the city's seed with a deterministic walk, so every
 * city has its own alignment while the rest of the game can rely on the same
 * shape of data.
 */

import { buildPath, sample } from './geo.js';
import { getCity, stockFor } from './cities.js';

export const COACH_LEN = 19;
export const LOCO_LEN = 21;
export const COACH_CAPACITY = 110;

/** Small deterministic PRNG so a seed always grows the same railway. */
export function makeRand(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A wandering alignment: the line bends steadily instead of zig-zagging. */
function growLine(rand, { segments, step, turn, heading }) {
  const pts = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  let a = heading;
  for (let i = 0; i < segments; i++) {
    a += (rand() - 0.5) * turn;
    // keep the line from curling back on itself
    a = Math.max(-2.1, Math.min(2.1, a));
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push({ x, y });
  }
  return pts;
}

function shiftTo(pts, minX, minY) {
  const ox = Math.min(...pts.map((p) => p.x));
  const oy = Math.min(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x - ox + minX, y: p.y - oy + minY }));
}

function stationsFor(path, defs, pathId, majorEvery = 3) {
  return defs.map(([name, at], i) => {
    const s = at * path.length;
    const p = sample(path, s);
    return {
      id: `${pathId}-${i}`,
      name,
      pathId,
      s,
      x: p.x,
      y: p.y,
      angle: p.angle,
      major: i === 0 || i === defs.length - 1 || i % majorEvery === 0,
      hub: at === 0 || at === 1,
      waiting: 0,
      delivered: 0,
    };
  });
}

/** The branch leaves a trunk station and curves away to a terminus. */
function branchFrom(rand, trunk, junction) {
  const head = sample(trunk, junction.s).angle;
  const side = rand() > 0.5 ? 1 : -1;
  const pts = [{ x: junction.x, y: junction.y }];
  let a = head + side * 0.55;
  let x = junction.x;
  let y = junction.y;
  const segments = 7;
  const step = 240 + rand() * 60;
  for (let i = 0; i < segments; i++) {
    a += (rand() - 0.5) * 0.34 + side * 0.045;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push({ x, y });
  }
  return buildPath(pts, 16);
}

function fleetFor(city, paths, onPath) {
  const main = onPath.main;
  const branch = onPath.branch;
  const first = main[0].name;
  const last = main[main.length - 1].name;
  const mid = main[Math.floor(main.length / 2)].name;
  const localStock = stockFor(city, 'local');
  const expressStock = stockFor(city, 'express');

  const mk = (def) => ({
    kind: 'local',
    cars: localStock.cars,
    vmax: 24,
    dir: 1,
    route: 'all',
    livery: 'local',
    ai: true,
    ...def,
  });

  return [
    // two long-distance workings: a locomotive and a full rake of coaches
    mk({ id: 'exp1', name: expressStock.name || `${city.city} Express`, kind: 'express',
      path: 'main', cars: expressStock.cars, vmax: 28,
      dir: 1, at: 0.03, route: 'majors', livery: 'express', startAtPlatform: true, ai: false }),
    mk({ id: 'exp2', name: `${city.city} Superfast`, kind: 'express', path: 'main',
      cars: Math.max(10, Math.round(expressStock.cars * 0.7)), vmax: 27,
      dir: -1, at: 0.86, route: 'majors', livery: 'express' }),
    mk({ id: 'loc1', name: `${last} Local`, path: 'main', vmax: 22, dir: 1, at: 0.16 }),
    mk({ id: 'loc2', name: `${first} Local`, path: 'main', vmax: 22, dir: -1, at: 0.7 }),
    mk({ id: 'loc3', name: `${mid} Local`, path: 'main', cars: Math.max(6, localStock.cars - 3),
      vmax: 20, dir: 1, at: 0.52 }),
    mk({ id: 'br1', name: `${branch[branch.length - 1].name} Shuttle`, path: 'branch', cars: 6, vmax: 20,
      dir: 1, at: 0.12 }),
  ].filter((def) => paths[def.path]);
}

export function createWorld({ city: cityId = 'mumbai', startWaiting = true, seed } = {}) {
  const city = getCity(cityId);
  const rand = makeRand(seed ?? city.seed);

  const trunkPts = shiftTo(
    growLine(rand, { segments: 22, step: 268, turn: 0.42, heading: -0.7 }),
    380,
    420,
  );
  const main = buildPath(trunkPts, 18);
  const mainStations = stationsFor(main, city.stations, 'main');

  const junction = mainStations[Math.max(1, Math.floor(mainStations.length * 0.34))];
  const branchPath = branchFrom(rand, main, junction);
  const branchDefs = city.branch.map(([name, at]) => [name, at]);
  const branchStations = stationsFor(branchPath, branchDefs, 'branch');

  const paths = { main };
  const stationsOnPath = { main: mainStations };
  paths.branch = branchPath;
  stationsOnPath.branch = branchStations;

  const stationById = new Map();
  const stations = [];
  for (const list of Object.values(stationsOnPath)) {
    for (const st of list) {
      // the junction is the same place on both lines: keep one record, remapped
      if (st === branchStations[0]) {
        st.name = junction.name;
        st.major = true;
      }
      stations.push(st);
      if (!stationById.has(st.id)) stationById.set(st.id, st);
    }
  }

  if (startWaiting) {
    for (const st of stations) {
      st.waiting = st.major ? 70 + Math.round(rand() * 90) : 20 + Math.round(rand() * 55);
    }
  }

  const routeIds = (pathId, kind) => (kind === 'majors'
    ? stationsOnPath[pathId].filter((st) => st.major)
    : stationsOnPath[pathId]
  ).map((st) => st.id);

  const trains = fleetFor(city, paths, stationsOnPath).map((def) => {
    const path = paths[def.path];
    const route = routeIds(def.path, def.route).map((id) => stationsOnPath[def.path].find((st) => st.id === id));
    let s = def.at * path.length;
    // the next call is the first station ahead *in the direction of travel*:
    // routes are ordered by distance, so a down-direction train counts back
    let idx;
    if (def.dir > 0) {
      idx = route.findIndex((st) => st.s > s);
    } else {
      idx = route.length - 1;
      while (idx > 0 && route[idx].s > s) idx--;
      if (route[idx].s > s) idx = -1;
    }
    if (idx < 0) idx = def.dir > 0 ? route.length - 1 : 0;

    const startStation = route.find((st) => Math.abs(st.s - s) < 320);
    const atPlatform = Boolean(def.startAtPlatform && startStation);
    if (atPlatform) {
      idx = route.indexOf(startStation);
      s = startStation.s;
    }

    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      livery: def.livery,
      pathId: def.path,
      route,
      idx,
      s,
      dir: def.dir,
      v: 0,
      vmax: def.vmax,
      accel: def.kind === 'express' ? 1.05 : 1.3,
      brake: def.kind === 'express' ? 1.6 : 1.9,
      coaches: def.cars,
      coachLen: COACH_LEN,
      locoLen: def.kind === 'express' ? LOCO_LEN : 0,
      length: def.cars * COACH_LEN + (def.kind === 'express' ? LOCO_LEN : 0),
      capacity: def.cars * stockFor(city, def.kind === 'express' ? 'express' : 'local').capacity,
      stock: stockFor(city, def.kind === 'express' ? 'express' : 'local'),
      onboard: 0,
      dest: new Map(),
      doors: atPlatform ? 0.4 : 0,
      doorTarget: atPlatform ? 1 : 0,
      dwell: atPlatform ? 18 : 0,
      state: atPlatform ? 'dwell' : 'run',
      exchanged: false,
      autoDepart: true,
      ai: def.ai !== false,
      throttle: 0,
      braking: 0,
      lastStop: null,
      speedLimit: def.vmax,
      stats: { delivered: 0, stops: 0, missed: 0, collisions: 0 },
      stun: 0,
      message: '',
      messageT: 0,
      arriveAtStart: atPlatform,
    };
  });

  const xs = Object.values(paths).flatMap((p) => p.pts.map((pt) => pt.x));
  const ys = Object.values(paths).flatMap((p) => p.pts.map((pt) => pt.y));

  return {
    city,
    paths,
    stations,
    stationById,
    stationsOnPath,
    trains,
    bounds: {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    },
    time: 6 * 3600,
    score: 0,
    playerId: 'exp1',
    events: [],
    signals: {},
    collisions: 0,
    delivered: 0,
  };
}

export { getCity };
