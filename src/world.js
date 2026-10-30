/**
 * Turns a city definition into a live network: track geometry, stations,
 * signals and a fleet keeping to the timetable.
 *
 * The track is grown from the city's seed with a deterministic walk, so every
 * city has its own alignment while the rest of the game can rely on the same
 * shape of data.
 */

import { buildPath, sample } from './geo.js';
import { getCity, getService, stockFor, LOCOS } from './cities.js';

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

/** Offset a polyline sideways, keeping the corridor shape shared. */
function offsetLine(pts, offset, wobble) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    const push = offset + Math.sin(i * 0.55 + wobble) * 40;
    return { x: p.x + nx * push, y: p.y + ny * push };
  });
}

/** The trains keeping to the timetable, spread over every line in the city. */
function fleetFor(city, paths, onPath, service) {
  const trains = [];
  const stock = (kind) => stockFor(city, kind);
  const playerLine = service.line;

  const mk = (def) => trains.push({
    kind: 'local',
    cars: stock('local').cars,
    vmax: 22,
    dir: 1,
    route: 'all',
    ai: true,
    ...def,
  });

  // ---- the train you chose to drive -----------------------------------
  const playerLineStations = onPath[playerLine] || onPath[Object.keys(paths)[0]];
  trains.push({
    id: 'player',
    name: service.name,
    kind: service.type === 'express' ? 'express' : service.type === 'passenger' ? 'passenger' : 'local',
    path: playerLine,
    cars: service.cars,
    vmax: service.vmax,
    accel: service.accel,
    brake: service.brake,
    dir: 1,
    at: 0.02,
    route: service.stops,
    livery: service.stock,
    startAtPlatform: true,
    ai: false,
    stock: service.stock,
    loco: service.loco,
    line: playerLine,
    lineName: service.lineName,
  });

  // ---- traffic: two workings on every line ----------------------------
  for (const line of city.lines) {
    const list = onPath[line.id];
    if (!list || !list.length) continue;
    const first = list[0].name;
    const last = list[list.length - 1].name;
    const mid = list[Math.floor(list.length / 2)].name;
    const expressStock = stock('express');
    const localStock = stock('local');

    const short = line.name.replace(/ Line$/, '');
    if (line.id === playerLine) {
      // somebody coming the other way, and a slow local in front of you
      mk({ id: `${line.id}-exp`, name: `${short} Superfast`, kind: 'express', path: line.id,
        cars: Math.max(10, Math.round(expressStock.cars * 0.65)), vmax: 27, dir: -1, at: 0.78,
        route: 'majors', stock: 'lhb', loco: city.id === 'delhi' ? 'WAP5' : 'WAP7', line: line.id });
      mk({ id: `${line.id}-loc`, name: `${short} Local`, path: line.id, cars: localStock.cars,
        vmax: 20, dir: 1, at: 0.42, stock: 'emu', line: line.id });
    } else {
      mk({ id: `${line.id}-loc`, name: `${short} Local`, path: line.id, cars: localStock.cars,
        vmax: 21, dir: -1, at: 0.55, stock: 'emu', line: line.id });
      mk({ id: `${line.id}-pax`, name: `${short} Passenger`, kind: 'passenger', path: line.id,
        cars: stock('passenger').cars, vmax: 21, dir: 1, at: 0.3,
        route: 'all', stock: 'icf', loco: 'WAP4', line: line.id });
    }
  }

  return trains;
}

export function createWorld({ city: cityId = 'mumbai', service: serviceId = null, startWaiting = true, seed } = {}) {
  const city = getCity(cityId);
  const service = getService(city, serviceId);
  const rand = makeRand(seed ?? city.seed);

  // one base alignment per city, then each line is cut through the same
  // corridor at its own offset — Western, Central and Harbour run side by
  // side, which is what you see from the cab and from the lineside
  const basePts = shiftTo(
    growLine(rand, { segments: 22, step: 268, turn: 0.42, heading: -0.7 }),
    380,
    420,
  );

  const paths = {};
  const stationsOnPath = {};
  const stationById = new Map();
  const stations = [];

  city.lines.forEach((line, index) => {
    const pts = offsetLine(basePts, line.offset, index * 1.7 + city.seed * 0.13);
    const path = buildPath(pts, 18);
    paths[line.id] = path;
    const list = stationsFor(path, line.stations, line.id, line.majorEvery || 4);
    for (const st of list) {
      st.line = line.id;
      st.lineName = line.name;
      st.colour = line.colour;
    }
    stationsOnPath[line.id] = list;
    for (const st of list) {
      stations.push(st);
      if (!stationById.has(st.id)) stationById.set(st.id, st);
    }
  });

  // a shared terminus keeps the three lines reading as one network
  const termini = city.lines.map((l) => stationsOnPath[l.id][0]);
  const hub = {
    id: 'hub',
    name: city.lines[0].stations[0][0],
    pathId: city.lines[0].id,
    s: termini[0].s,
    x: termini.reduce((sum, st) => sum + st.x, 0) / termini.length,
    y: termini.reduce((sum, st) => sum + st.y, 0) / termini.length,
    angle: termini[0].angle,
    major: true,
    hub: true,
    waiting: 0,
    delivered: 0,
  };

  if (startWaiting) {
    for (const st of stations) {
      st.waiting = st.major ? 70 + Math.round(rand() * 90) : 20 + Math.round(rand() * 55);
    }
  }

  const routeIds = (pathId, kind) => (kind === 'majors'
    ? stationsOnPath[pathId].filter((st) => st.major)
    : stationsOnPath[pathId]
  ).map((st) => st.id);

  const trains = fleetFor(city, paths, stationsOnPath, service).map((def) => {
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
      accel: def.accel ?? (def.kind === 'express' ? 1.05 : 1.3),
      brake: def.brake ?? (def.kind === 'express' ? 1.6 : 1.9),
      stock: def.stock || 'emu',
      loco: def.loco || null,
      locoSpec: LOCOS[def.loco] || null,
      coaches: def.cars,
      coachLen: COACH_LEN,
      locoLen: def.kind === 'express' ? LOCO_LEN : 0,
      length: def.cars * COACH_LEN + (def.kind === 'express' ? LOCO_LEN : 0),
      capacity: def.cars * (def.stock === 'icf' ? 90 : def.stock === 'emu' ? 112 : 72),
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
      lineName: def.lineName || city.lines.find((l) => l.id === def.path)?.name || '',
    };
  });

  const xs = Object.values(paths).flatMap((p) => p.pts.map((pt) => pt.x));
  const ys = Object.values(paths).flatMap((p) => p.pts.map((pt) => pt.y));

  return {
    city,
    service,
    paths,
    stations,
    stationById,
    stationsOnPath,
    hub,
    trains,
    bounds: {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    },
    time: 6 * 3600,
    score: 0,
    messages: [],
    penalties: [],
    finished: false,
    playerId: 'player',
    events: [],
    signals: {},
    collisions: 0,
    delivered: 0,
  };
}

export { getCity };
