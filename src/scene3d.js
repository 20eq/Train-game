/**
 * The 3D world: everything you can see out of the cab, built from the same
 * network the simulation drives, and rebuilt whenever you change city.
 *
 * World coordinates are the map's (x, y); in three.js the ground plane is XZ,
 * so a map point (x, y) becomes (x, 0, y) and a heading `a` becomes a yaw of
 * `PI/2 - a` (which points the group's local +Z along the direction of travel).
 */

import * as THREE from '../vendor/three.module.js';
import { sample } from './geo.js';
import { computeSignals, playerTrain } from './sim.js';

export const RAIL_HALF = 0.7175;
export const PLATFORM_LEN = 230;

const yawFor = (angle) => Math.PI / 2 - angle;

/* ------------------------------------------------------------------ */
/* small builders                                                      */
/* ------------------------------------------------------------------ */

/** A flat ribbon following the path, `width` metres wide, centred on `offset`. */
function ribbonGeometry(path, { width, offset = 0, y = 0, step = 5 }) {
  const n = Math.max(2, Math.ceil(path.length / step));
  const pos = new Float32Array((n + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const s = Math.min(path.length, (i / n) * path.length);
    const p = sample(path, s);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    for (let k = 0; k < 2; k++) {
      const w = offset + (k === 0 ? -width / 2 : width / 2);
      const o = (i * 2 + k) * 3;
      pos[o] = p.x + nx * w;
      pos[o + 1] = y;
      pos[o + 2] = p.y + ny * w;
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Deterministic scatter that avoids the station footprints. */
function scatter(rand, path, count, { minOff, maxOff, skip = [] }) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 12) {
    const s = rand() * path.length;
    if (skip.some((st) => Math.abs(st.s - s) < PLATFORM_LEN * 0.75)) continue;
    const side = rand() > 0.5 ? 1 : -1;
    const off = side * (minOff + rand() * (maxOff - minOff));
    const p = sample(path, s);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    out.push({ x: p.x + nx * off, z: p.y + ny * off, side, s, rand: rand() });
  }
  return out;
}

/** A canvas-backed texture, used for station name boards. */
function textTexture(text, { w = 512, h = 128, bg = '#12352c', fg = '#f3efe2', accent = '#ffcf5c' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillStyle = fg;
  ctx.font = `700 ${Math.floor(h * 0.42)}px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */
/* the pieces                                                          */
/* ------------------------------------------------------------------ */

function buildSky(scene, city) {
  const pal = city.palette;
  scene.background = new THREE.Color(pal.skyLow);
  scene.fog = new THREE.Fog(pal.fog, 420, 2600);

  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, pal.skyTop);
  grad.addColorStop(0.55, pal.skyLow);
  grad.addColorStop(1, pal.fog);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 16, 12),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(180, 24),
    new THREE.MeshBasicMaterial({ color: pal.sun, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }),
  );
  sun.position.set(-2400, 1100, -3600);
  sun.lookAt(0, 0, 0);
  scene.add(sun);
}

function buildGround(scene, city, world) {
  const pal = city.palette;
  const span = 14000;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span, span, 1, 1),
    new THREE.MeshLambertMaterial({ color: pal.ground[0] }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((world.bounds.minX + world.bounds.maxX) / 2, -0.05, (world.bounds.minY + world.bounds.maxY) / 2);
  scene.add(ground);

  // fields: big soft patches so the ground is not one flat colour
  const patchGeo = new THREE.PlaneGeometry(1, 1);
  const patches = new THREE.InstancedMesh(patchGeo, new THREE.MeshLambertMaterial({ vertexColors: false }), 90);
  const rand = mulberry(world.city.seed + 11);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const colour = new THREE.Color();
  for (let i = 0; i < 90; i++) {
    const x = world.bounds.minX + rand() * (world.bounds.maxX - world.bounds.minX);
    const z = world.bounds.minY + rand() * (world.bounds.maxY - world.bounds.minY);
    const w = 240 + rand() * 620;
    const h = 240 + rand() * 620;
    m.compose(new THREE.Vector3(x, 0.01, z), q, new THREE.Vector3(w, h, 1));
    patches.setMatrixAt(i, m);
    colour.set(pal.ground[1 + Math.floor(rand() * (pal.ground.length - 1))]);
    patches.setColorAt(i, colour);
  }
  patches.instanceMatrix.needsUpdate = true;
  if (patches.instanceColor) patches.instanceColor.needsUpdate = true;
  scene.add(patches);

  // distant hills
  const hillGeo = new THREE.ConeGeometry(1, 1, 6);
  const hills = new THREE.InstancedMesh(hillGeo, new THREE.MeshLambertMaterial({}), 26);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const r = 4200 + rand() * 1800;
    const cx = (world.bounds.minX + world.bounds.maxX) / 2 + Math.cos(a) * r;
    const cz = (world.bounds.minY + world.bounds.maxY) / 2 + Math.sin(a) * r;
    const hgt = 260 + rand() * 420;
    m.compose(new THREE.Vector3(cx, hgt * 0.32, cz), new THREE.Quaternion(), new THREE.Vector3(900 + rand() * 700, hgt, 900 + rand() * 600));
    hills.setMatrixAt(i, m);
    colour.set(pal.ground[2]);
    hills.setColorAt(i, colour);
  }
  hills.instanceMatrix.needsUpdate = true;
  if (hills.instanceColor) hills.instanceColor.needsUpdate = true;
  scene.add(hills);
}

export function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrack(scene, city, pathId, path) {
  const pal = city.palette;
  const group = new THREE.Group();
  group.name = `track:${pathId}`;

  const ballast = new THREE.Mesh(
    ribbonGeometry(path, { width: 7.2, y: 0.04 }),
    new THREE.MeshLambertMaterial({ color: pal.ballast }),
  );
  group.add(ballast);

  const railMat = new THREE.MeshLambertMaterial({ color: pal.rail });
  for (const side of [-1, 1]) {
    group.add(new THREE.Mesh(ribbonGeometry(path, { width: 0.16, offset: side * RAIL_HALF, y: 0.24 }), railMat));
  }

  // sleepers
  const sleeperGeo = new THREE.BoxGeometry(2.7, 0.16, 0.28);
  const count = Math.floor(path.length / 1.75);
  const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshLambertMaterial({ color: pal.sleepers }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const p = sample(path, i * 1.75);
    e.set(0, yawFor(p.angle), 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x, 0.16, p.y), q, one);
    sleepers.setMatrixAt(i, m);
  }
  sleepers.instanceMatrix.needsUpdate = true;
  group.add(sleepers);

  // catenary: a mast every 45 m with an arm reaching over the track, plus wire
  const mastCount = Math.floor(path.length / 45);
  const masts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.22, 8.6, 0.22),
    new THREE.MeshLambertMaterial({ color: '#5b6157' }),
    mastCount,
  );
  const arms = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.4, 0.16, 0.16),
    new THREE.MeshLambertMaterial({ color: '#5b6157' }),
    mastCount,
  );
  for (let i = 0; i < mastCount; i++) {
    const p = sample(path, i * 45 + 12);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    e.set(0, yawFor(p.angle), 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.x + nx * -4.2, 4.3, p.y + ny * -4.2), q, one);
    masts.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x + nx * -2.1, 8.4, p.y + ny * -2.1), q, one);
    arms.setMatrixAt(i, m);
  }
  masts.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  group.add(masts, arms);

  const wire = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(wirePositions(path), 3)),
    new THREE.LineBasicMaterial({ color: '#3f4744', transparent: true, opacity: 0.65 }),
  );
  group.add(wire);

  scene.add(group);
  return group;
}

function wirePositions(path) {
  const n = Math.ceil(path.length / 20);
  const pos = new Float32Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const p = sample(path, (i / n) * path.length);
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = 7.6;
    pos[i * 3 + 2] = p.y;
  }
  return pos;
}

function buildStation(scene, city, station) {
  const pal = city.palette;
  const g = new THREE.Group();
  g.position.set(station.x, 0, station.y);
  g.rotation.y = yawFor(station.angle);
  g.name = `station:${station.name}`;

  const deckMat = new THREE.MeshLambertMaterial({ color: pal.platform });
  const edgeMat = new THREE.MeshLambertMaterial({ color: '#e8c46a' });
  const roofMat = new THREE.MeshLambertMaterial({ color: pal.roof });
  const soffitMat = new THREE.MeshLambertMaterial({ color: '#c8c2b4' });
  const pillarMat = new THREE.MeshLambertMaterial({ color: '#8b8f88' });
  const wallMat = new THREE.MeshLambertMaterial({ color: pal.building });

  const deckGeo = new THREE.BoxGeometry(5.2, 0.95, PLATFORM_LEN);
  const edgeGeo = new THREE.BoxGeometry(0.55, 0.1, PLATFORM_LEN);
  const roofGeo = new THREE.BoxGeometry(4.4, 0.18, PLATFORM_LEN * 0.3);
  const pillarGeo = new THREE.BoxGeometry(0.2, 4.6, 0.2);

  for (const side of [-1, 1]) {
    const x = side * 5.4;
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(x, 0.475, 0);
    g.add(deck);

    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.set(side * 3.05, 0.96, 0);
    g.add(edge);

    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, 6.15, 0);
    g.add(roof);

    for (let i = -2; i <= 2; i++) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(side * 7.2, 2.3, i * 24);
      g.add(pillar);
    }

    // name board facing the track
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 1.05),
      new THREE.MeshBasicMaterial({ map: textTexture(station.name.toUpperCase()), side: THREE.DoubleSide }),
    );
    board.position.set(x, 3.5, 0);
    board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(board);

    // a little station building behind the platform
    const h = station.major ? 9 : 6.5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(9, h, 38), wallMat);
    b.position.set(side * 25, h / 2, station.major ? 10 : -14);
    g.add(b);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.45, 38.6), roofMat);
    cap.position.set(side * 25, h + 0.22, station.major ? 10 : -14);
    g.add(cap);
  }

  scene.add(g);
  return g;
}

function buildLineside(scene, city, world) {
  const pal = city.palette;
  const rand = mulberry(world.city.seed + 5);
  const trees = [];
  const blocks = [];
  for (const [pathId, path] of Object.entries(world.paths)) {
    const skip = world.stationsOnPath[pathId] || [];
    trees.push(...scatter(rand, path, pathId === 'main' ? 420 : 140, { minOff: 11, maxOff: 46, skip }));
    blocks.push(...scatter(rand, path, pathId === 'main' ? 220 : 70, { minOff: 42, maxOff: 190, skip }));
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.32, 3.4, 5),
    new THREE.MeshLambertMaterial({ color: '#6b573f' }),
    trees.length,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.3, 6.4, 6),
    new THREE.MeshLambertMaterial({}),
    trees.length,
  );
  trees.forEach((t, i) => {
    const h = 0.85 + t.rand * 0.6;
    m.compose(new THREE.Vector3(t.x, 1.7 * h, t.z), q, new THREE.Vector3(h, h, h));
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(t.x, (3.2 + 3.2) * h, t.z), q, new THREE.Vector3(h, h, h));
    leaves.setMatrixAt(i, m);
    colour.set(pal.ground[1 + Math.floor(t.rand * (pal.ground.length - 1))]).multiplyScalar(0.78);
    leaves.setColorAt(i, colour);
  });
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  scene.add(trunks, leaves);

  const city2 = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({}),
    blocks.length,
  );
  const e = new THREE.Euler();
  blocks.forEach((b, i) => {
    const w = 8 + b.rand * 16;
    const h = 6 + b.rand * 22;
    const d = 8 + ((b.rand * 91) % 1) * 18;
    e.set(0, b.rand * Math.PI, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(b.x, h / 2, b.z), q, new THREE.Vector3(w, h, d));
    city2.setMatrixAt(i, m);
    colour.set(pal.building).multiplyScalar(0.82 + b.rand * 0.3);
    city2.setColorAt(i, colour);
  });
  city2.instanceMatrix.needsUpdate = true;
  if (city2.instanceColor) city2.instanceColor.needsUpdate = true;
  scene.add(city2);
}

function buildSignals(scene, world) {
  const signals = [];
  const poleMat = new THREE.MeshLambertMaterial({ color: '#4a5149' });
  const headMat = new THREE.MeshLambertMaterial({ color: '#22282a' });

  computeSignals(world);
  for (const [pathId, set] of Object.entries(world.signals)) {
    const path = world.paths[pathId];
    for (const dirKey of ['plus', 'minus']) {
      const dir = dirKey === 'plus' ? 1 : -1;
      set[dirKey].forEach((sig, index) => {
        const p = sample(path, sig.s);
        const nx = -Math.sin(p.angle);
        const ny = Math.cos(p.angle);
        const g = new THREE.Group();
        g.position.set(p.x + nx * -4.6, 0, p.y + ny * -4.6);
        g.rotation.y = yawFor(p.angle);

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.6, 6), poleMat);
        pole.position.y = 2.8;
        g.add(pole);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.5, 0.45), headMat);
        head.position.set(0, 5.4, 0);
        g.add(head);

        const lampGeo = new THREE.SphereGeometry(0.2, 8, 6);
        const red = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#e8493a', toneMapped: false }));
        red.position.set(0, 5.72, 0.24);
        const green = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#3ec46a', toneMapped: false }));
        green.position.set(0, 5.1, 0.24);
        g.add(red, green);

        scene.add(g);
        signals.push({ pathId, dirKey, index, red, green });
      });
    }
  }
  return signals;
}

const liveryCache = new Map();

function liveryFor(city, kind) {
  const key = `${city.id}:${kind}`;
  if (!liveryCache.has(key)) {
    const spec = kind === 'express' ? city.express : city.livery;
    liveryCache.set(key, {
      body: new THREE.MeshLambertMaterial({ color: spec.body }),
      stripe: new THREE.MeshLambertMaterial({ color: spec.stripe }),
      roof: new THREE.MeshLambertMaterial({ color: spec.roof }),
      trim: new THREE.MeshLambertMaterial({ color: spec.trim || '#2c3a45' }),
      glass: new THREE.MeshLambertMaterial({ color: '#1d2a33' }),
    });
  }
  return liveryCache.get(key);
}

function buildTrain(scene, city, train, isPlayer = false) {
  const livery = liveryFor(city, train.kind === 'express' ? 'express' : 'local');
  const group = new THREE.Group();
  group.name = `train:${train.id}`;

  const bodyGeo = new THREE.BoxGeometry(2.9, 3.0, train.coachLen - 0.8);
  const bandGeo = new THREE.BoxGeometry(2.94, 0.78, train.coachLen - 3.0);
  const roofGeo = new THREE.BoxGeometry(2.6, 0.36, train.coachLen - 1.2);
  const bogieGeo = new THREE.BoxGeometry(2.3, 0.62, 2.6);
  const noseGeo = new THREE.BoxGeometry(2.86, 2.5, 1.4);

  for (let i = 0; i < train.coaches; i++) {
    const z = -train.coachLen * i - train.coachLen / 2;
    const body = new THREE.Mesh(bodyGeo, livery.body);
    body.position.set(0, 2.6, z);
    group.add(body);

    const band = new THREE.Mesh(bandGeo, livery.glass);
    band.position.set(0, 3.25, z);
    group.add(band);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.22, train.coachLen - 3.0), livery.stripe);
    stripe.position.set(0, 2.2, z);
    group.add(stripe);

    const roof = new THREE.Mesh(roofGeo, livery.roof);
    roof.position.set(0, 4.2, z);
    group.add(roof);

    for (const dz of [-5.6, 5.6]) {
      const bogie = new THREE.Mesh(bogieGeo, livery.trim);
      bogie.position.set(0, 0.85, z + dz);
      group.add(bogie);
    }
  }

  // the front of the leading coach: seen from outside for every train except
  // the one you are driving, where the cab shell stands in for it
  if (!isPlayer) {
    const nose = new THREE.Mesh(noseGeo, livery.body);
    nose.position.set(0, 2.55, 0.4);
    group.add(nose);
    const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), livery.glass);
    windscreen.position.set(0, 3.1, 1.12);
    group.add(windscreen);
  } else {
    // a low nose beyond the windscreen, so you can see the front of your train
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.7, 1.6), livery.body);
    hood.position.set(0, -0.35, 4.6);
    group.add(hood);
  }

  const lampGeo = new THREE.SphereGeometry(0.16, 8, 6);
  for (const dx of [-0.9, 0.9]) {
    const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }));
    lamp.position.set(dx, -0.5, 5.3);
    group.add(lamp);
  }

  scene.add(group);
  return group;
}

/** The driver's cab shell, built around an eye at the train group's origin. */
function buildCab(trainGroup) {
  const shell = new THREE.Group();
  shell.name = 'cab';
  shell.position.y = 1.15;
  const trim = new THREE.MeshLambertMaterial({ color: '#333d3a' });
  const glass = new THREE.MeshLambertMaterial({
    color: '#a8c8d8', transparent: true, opacity: 0.06, depthWrite: false,
  });

  // Only the frame: roof, A-pillars and the windscreen. The dashboard itself is
  // drawn by the HUD, which is where it can actually carry instruments.
  const lining = new THREE.MeshLambertMaterial({ color: '#b9bdb2' });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.1, 3.4), lining);
  roof.position.set(0, 4.75, 3.2);
  shell.add(roof);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.5, 0.09), trim);
    pillar.position.set(side * 1.52, 3.4, 2.0);
    shell.add(pillar);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.8), trim);
    rail.position.set(side * 1.3, 2.5, 3.0);
    shell.add(rail);
  }

  const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.4), glass);
  windscreen.position.set(0, 3.1, 4.4);
  shell.add(windscreen);

  trainGroup.add(shell);
  return shell;
}

/* ------------------------------------------------------------------ */
/* putting it together                                                 */
/* ------------------------------------------------------------------ */

export function buildWorld3D(world) {
  const scene = new THREE.Scene();
  buildSky(scene, world.city);
  buildGround(scene, world.city, world);

  for (const [pathId, path] of Object.entries(world.paths)) {
    buildTrack(scene, world.city, pathId, path);
  }
  for (const station of world.stations) {
    buildStation(scene, world.city, station);
  }
  buildLineside(scene, world.city, world);

  const ambient = new THREE.HemisphereLight(0xdfe9ef, 0x6f7a55, 1.15);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1d0, 1.35);
  sun.position.set(-900, 1400, -1100);
  scene.add(sun);

  const trainGroups = new Map();
  for (const train of world.trains) {
    trainGroups.set(train.id, buildTrain(scene, world.city, train, train.id === world.playerId));
  }
  const cab = buildCab(trainGroups.get(world.playerId));
  const signals = buildSignals(scene, world);

  return { scene, trainGroups, cab, signals, city: world.city };
}

const tmpVec = new THREE.Vector3();

/** Move the cab shell onto whichever train the player is driving. */
export function moveCab(view, world) {
  const group = view.trainGroups.get(world.playerId);
  if (!view.cab || !group || view.cab.parent === group) return;
  if (view.cab.parent) view.cab.parent.remove(view.cab);
  group.add(view.cab);
}

/** Move every train and lamp to where the simulation says it should be. */
export function updateWorld3D(view, world) {
  for (const train of world.trains) {
    const group = view.trainGroups.get(train.id);
    if (!group) continue;
    const p = sample(world.paths[train.pathId], train.s);
    const angle = train.dir > 0 ? p.angle : p.angle + Math.PI;
    group.position.set(p.x, 0, p.y);
    group.rotation.y = yawFor(angle);
  }

  for (const sig of view.signals) {
    const state = world.signals[sig.pathId]?.[sig.dirKey]?.[sig.index];
    const red = state ? state.red : false;
    sig.red.visible = red;
    sig.green.visible = !red;
  }
}

/** Where the camera sits this frame, and what it is looking at. */
export function cameraPose(world, { mode = 'cab', orbit = 0.6, height = 26, distance = 46 } = {}) {
  const train = playerTrain(world);
  const path = world.paths[train.pathId];
  const head = sample(path, train.s);
  const forward = train.dir > 0 ? head.angle : head.angle + Math.PI;
  const fx = Math.cos(forward);
  const fz = Math.sin(forward);

  if (mode === 'cab') {
    return {
      position: new THREE.Vector3(head.x, 4.2, head.y),
      target: new THREE.Vector3(head.x + fx * 120, 3.5, head.y + fz * 120),
      fov: 74,
    };
  }

  if (mode === 'chase') {
    const back = 30;
    return {
      position: new THREE.Vector3(head.x - fx * back, 9.0, head.y - fz * back),
      target: new THREE.Vector3(head.x + fx * 26, 3.4, head.y + fz * 26),
      fov: 62,
    };
  }

  // lineside / orbit: circle the train so you can watch it go past
  return {
    position: new THREE.Vector3(
      head.x + Math.cos(orbit) * distance,
      height,
      head.y + Math.sin(orbit) * distance,
    ),
    target: new THREE.Vector3(head.x, 3.0, head.y),
    fov: 52,
  };
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

export { THREE, tmpVec };
