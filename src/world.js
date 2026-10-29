/**
 * The network: three lines, their stations, and the trains that work them.
 *
 * Everything is derived from a few control points, so the map stays editable
 * in one place and the geometry (station distances, platform headings) is
 * computed rather than hand-tuned.
 */

import { buildPath, project, sample } from './geo.js';

export const WORLD = { w: 5200, h: 3400 };

const MAIN_CONTROL = [
  [320, 3010], [740, 2930], [1150, 2985], [1540, 2825], [1930, 2860],
  [2310, 2700], [2690, 2745], [3030, 2540], [3370, 2470], [3660, 2210],
  [3830, 1930], [3860, 1620], [4010, 1330], [4210, 1150], [4390, 860],
  [4530, 560], [4700, 300],
].map(([x, y]) => ({ x, y }));

// Stations are placed by fraction of each line, then snapped onto the rails.
const MAIN_STATIONS = [
  { id: 'cg', name: 'Churchgate', at: 0.03, major: true },
  { id: 'ml', name: 'Marine Lines', at: 0.09 },
  { id: 'cr', name: 'Charni Road', at: 0.15 },
  { id: 'gr', name: 'Grant Road', at: 0.21 },
  { id: 'mct', name: 'Mumbai Central', at: 0.27, major: true },
  { id: 'mhl', name: 'Mahalaxmi', at: 0.33, hub: true },
  { id: 'lp', name: 'Lower Parel', at: 0.39 },
  { id: 'dad', name: 'Dadar', at: 0.45, major: true },
  { id: 'mtr', name: 'Matunga Road', at: 0.51 },
  { id: 'mhm', name: 'Mahim', at: 0.57, hub: true },
  { id: 'bnd', name: 'Bandra', at: 0.63, major: true },
  { id: 'snc', name: 'Santacruz', at: 0.69 },
  { id: 'and', name: 'Andheri', at: 0.75, major: true },
  { id: 'gor', name: 'Goregaon', at: 0.82 },
  { id: 'bor', name: 'Borivali', at: 0.89, major: true },
  { id: 'vir', name: 'Virar', at: 0.96, major: true },
];

const HARBOUR_STATIONS = [
  { id: 'mhl', name: 'Mahalaxmi', at: 0 },
  { id: 'wad', name: 'Wadala Road', at: 0.18 },
  { id: 'sew', name: 'Sewri', at: 0.35 },
  { id: 'rey', name: 'Reay Road', at: 0.52, major: true },
  { id: 'doc', name: 'Dockyard Road', at: 0.67 },
  { id: 'san', name: 'Sandhurst Road', at: 0.83 },
  { id: 'mas', name: 'Masjid', at: 1, major: true, hub: true },
];

const LINK_STATIONS = [
  { id: 'mas', name: 'Masjid', at: 0 },
  { id: 'chb', name: 'Chunabhatti', at: 0.26 },
  { id: 'ghk', name: 'Ghatkopar', at: 0.5, major: true },
  { id: 'vkv', name: 'Vidyavihar', at: 0.74 },
  { id: 'mhm', name: 'Mahim', at: 1, major: true, hub: true },
];

const TRAIN_DEFS = [
  {
    id: 'exp1', name: 'Saurashtra Express', kind: 'express', path: 'main',
    coaches: 12, vmax: 26, dir: 1, at: 0.03, route: 'majors', livery: 'express', startAtPlatform: true,
  },
  {
    id: 'exp2', name: 'Virar Fast', kind: 'express', path: 'main',
    coaches: 9, vmax: 25, dir: -1, at: 0.86, route: 'majors', livery: 'fast',
  },
  {
    id: 'loc1', name: 'Churchgate Local', kind: 'local', path: 'main',
    coaches: 7, vmax: 21, dir: 1, at: 0.14, route: 'all', livery: 'local',
  },
  {
    id: 'loc2', name: 'Borivali Local', kind: 'local', path: 'main',
    coaches: 7, vmax: 21, dir: -1, at: 0.72, route: 'all', livery: 'local',
  },
  {
    id: 'loc3', name: 'Andheri Local', kind: 'local', path: 'main',
    coaches: 6, vmax: 20, dir: 1, at: 0.52, route: 'all', livery: 'local2',
  },
  {
    id: 'harb', name: 'Harbour Local', kind: 'local', path: 'harbour',
    coaches: 6, vmax: 19, dir: 1, at: 0.12, route: 'all', livery: 'harbour',
  },
  {
    id: 'link', name: 'Link Shuttle', kind: 'shuttle', path: 'link',
    coaches: 3, vmax: 16, dir: 1, at: 0.08, route: 'all', livery: 'link',
  },
];

const COACH_LEN = 19;
const COACH_CAPACITY = 110;

function stationsFor(path, defs, pathId) {
  return defs.map((def) => {
    const s = def.at * path.length;
    const p = sample(path, s);
    return {
      id: def.id,
      name: def.name,
      pathId,
      s,
      x: p.x,
      y: p.y,
      angle: p.angle,
      major: Boolean(def.major),
      hub: Boolean(def.hub),
      waiting: 0,
      delivered: 0,
    };
  });
}

function buildHarbour(mainPath, hubStation) {
  const start = sample(mainPath, hubStation.s);
  const offsets = [[0, 0], [430, 150], [860, 105], [1270, 255], [1640, 430], [1960, 470], [2210, 585]];
  return buildPath(offsets.map(([dx, dy]) => ({ x: start.x + dx, y: start.y + dy })), 16);
}

function buildLink(harbourEnd, mahim) {
  const a = harbourEnd;
  const b = { x: mahim.x, y: mahim.y };
  const mix = (t, ox, oy) => ({ x: a.x + (b.x - a.x) * t + ox, y: a.y + (b.y - a.y) * t + oy });
  return buildPath([a, mix(0.24, 190, 90), mix(0.5, -150, -40), mix(0.76, 110, -110), b], 16);
}

export function createWorld({ startWaiting = true } = {}) {
  const main = buildPath(MAIN_CONTROL, 18);
  const mainStations = stationsFor(main, MAIN_STATIONS, 'main');
  const byId = new Map(mainStations.map((s) => [s.id, s]));

  const harbour = buildHarbour(main, byId.get('mhl'));
  const harbourStations = stationsFor(harbour, HARBOUR_STATIONS, 'harbour')
    // the hub keeps the main-line coordinates so the two lines actually meet
    .map((s) => (s.id === 'mhl' ? { ...s, x: byId.get('mhl').x, y: byId.get('mhl').y } : s));

  const harbourEnd = sample(harbour, harbour.length);
  const link = buildLink(harbourEnd, byId.get('mhm'));
  const linkStations = stationsFor(link, LINK_STATIONS, 'link')
    .map((s) => (s.id === 'mas' ? { ...s, x: harbourEnd.x, y: harbourEnd.y, angle: harbourEnd.angle } : s));

  const paths = { main, harbour, link };
  const stations = [...mainStations, ...harbourStations.filter((s) => s.id !== 'mhl'), ...linkStations.filter((s) => s.id !== 'mas' && s.id !== 'mhm')];
  const allById = new Map();
  for (const s of [...mainStations, ...harbourStations, ...linkStations]) {
    if (!allById.has(s.id)) allById.set(s.id, s);
  }

  const stationsOnPath = {
    main: mainStations,
    harbour: harbourStations,
    link: linkStations,
  };

  if (startWaiting) {
    for (const s of allById.values()) {
      s.waiting = s.major ? 60 + Math.round(Math.random() * 70) : 15 + Math.round(Math.random() * 45);
    }
  }

  const routes = {
    all: (pathId) => stationsOnPath[pathId].map((s) => s.id),
    majors: (pathId) => stationsOnPath[pathId].filter((s) => s.major).map((s) => s.id),
  };

  const trains = TRAIN_DEFS.map((def) => {
    const path = paths[def.path];
    const routeIds = def.route === 'majors' ? routes.majors(def.path) : routes.all(def.path);
    // resolve against this line's own station objects — hub stations exist on
    // several lines and each copy has its own distance along its own path
    const route = routeIds.map((id) => stationsOnPath[def.path].find((st) => st.id === id));
    let s = def.at * path.length;

    // find the first station in front of us in the direction of travel
    let idx = route.findIndex((st) => (st.s - s) * def.dir > 0);
    if (idx < 0) idx = def.dir > 0 ? route.length - 1 : 0;

    // the player's train starts standing at a platform, ready to work the doors
    const startStation = route.find((st) => Math.abs(st.s - s) < 320);
    const atPlatform = Boolean(def.startAtPlatform && startStation);
    if (atPlatform) {
      idx = route.indexOf(startStation);
      s = startStation.s;
    }

    return {
      arriveAtStart: atPlatform,
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
      accel: def.kind === 'express' ? 1.05 : 1.3,   // m/s²
      brake: def.kind === 'express' ? 1.6 : 1.9,    // m/s² service braking
      coaches: def.coaches,
      coachLen: COACH_LEN,
      length: def.coaches * COACH_LEN,
      capacity: def.coaches * COACH_CAPACITY,
      onboard: 0,
      dest: new Map(),
      doors: atPlatform ? 0.4 : 0,
      doorTarget: atPlatform ? 1 : 0,
      dwell: atPlatform ? 18 : 0,
      state: atPlatform ? 'dwell' : 'run',
      exchanged: false,
      autoDepart: true,
      ai: def.id !== 'exp1',
      throttle: 0,
      braking: 0,
      lastStop: null,
      speedLimit: def.vmax,
      stats: { delivered: 0, stops: 0, missed: 0, collisions: 0 },
      stun: 0,
      message: '',
      messageT: 0,
    };
  });

  const world = {
    paths,
    stations,
    stationById: allById,
    stationsOnPath,
    trains,
    time: 6 * 3600, // seconds since midnight, starts at 06:00
    score: 0,
    playerId: 'exp1',
    events: [],
    signals: {},
    collisions: 0,
    delivered: 0,
  };

  return world;
}

export const TRAIN_COLORS = {
  express: { body: '#274a86', stripe: '#e9eef7', roof: '#1a3563', nose: '#1b2b4a' },
  fast: { body: '#2f5aa8', stripe: '#f2d06b', roof: '#234379', nose: '#1b2b4a' },
  local: { body: '#8c3b3b', stripe: '#f0e3c8', roof: '#6f2d2d', nose: '#3a1a1a' },
  local2: { body: '#8c3b3b', stripe: '#f0e3c8', roof: '#6f2d2d', nose: '#3a1a1a' },
  harbour: { body: '#2c6b62', stripe: '#f0e3c8', roof: '#22544d', nose: '#15332f' },
  link: { body: '#6b5a2c', stripe: '#f0e3c8', roof: '#54461f', nose: '#332b13' },
};

export { COACH_LEN, COACH_CAPACITY };
