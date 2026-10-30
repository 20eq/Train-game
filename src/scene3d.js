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
import { LOCOS, liveryFor } from './cities.js';
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
const boardCache = new Map();

function textTexture(text, { w = 384, h = 96, bg = '#12352c', fg = '#f3efe2', accent = '#ffcf5c' } = {}) {
  const key = `${text}|${accent}|${w}x${h}`;
  if (boardCache.has(key)) return boardCache.get(key);
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // long names ("CHHATRAPATI SHIVAJI MAHARAJ TERMINUS") shrink to fit the board
  let size = Math.floor(h * 0.44);
  do {
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif`;
    if (ctx.measureText(text).width <= w * 0.9) break;
    size -= 2;
  } while (size > 14);
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  boardCache.set(key, tex);
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
  const pillarMat = new THREE.MeshLambertMaterial({ color: '#8b8f88' });
  const wallMat = new THREE.MeshLambertMaterial({ color: pal.building });
  const true_ = station.major;

  const deckGeo = new THREE.BoxGeometry(5.2, 0.95, PLATFORM_LEN);
  const edgeGeo = new THREE.BoxGeometry(0.55, 0.1, PLATFORM_LEN);
  // a big station gets a full-length canopy; a halt gets a short shelter
  const roofGeo = new THREE.BoxGeometry(4.4, 0.18, PLATFORM_LEN * (true_ ? 0.42 : 0.16));
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

    // support columns: three on a major station, two at a halt
    const posts = true_ ? [-38, 0, 38] : [-14, 14];
    for (const z of posts) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(side * 7.2, 2.3, z);
      g.add(pillar);
    }

    // name board facing the track, underlined in the line's colour
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.15),
      new THREE.MeshBasicMaterial({
        map: textTexture(station.name.toUpperCase(), { accent: station.colour || '#ffcf5c' }),
        side: THREE.DoubleSide,
      }),
    );
    board.position.set(x, 3.5, 0);
    board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(board);

    // a station building only where a station deserves one
    if (true_) {
      const h = 8.5;
      const b = new THREE.Mesh(new THREE.BoxGeometry(9, h, 38), wallMat);
      b.position.set(side * 25, h / 2, 10);
      g.add(b);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.45, 38.6), roofMat);
      cap.position.set(side * 25, h + 0.22, 10);
      g.add(cap);
    } else {
      // a small hut and a bench, enough to read as a halt at speed
      const hut = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.2, 6.5), wallMat);
      hut.position.set(side * 17, 1.6, -6);
      g.add(hut);
      const hutCap = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.35, 7), roofMat);
      hutCap.position.set(side * 17, 3.35, -6);
      g.add(hutCap);
    }
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
    trees.push(...scatter(rand, path, 300, { minOff: 11, maxOff: 46, skip }));
    blocks.push(...scatter(rand, path, 150, { minOff: 42, maxOff: 190, skip }));
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

const matCache = new Map();

function mat(key, color, extra) {
  const id = `${key}:${color}`;
  if (!matCache.has(id)) matCache.set(id, new THREE.MeshLambertMaterial({ color, ...extra }));
  return matCache.get(id);
}

/** Materials for a city's stock: EMU, ICF passenger and LHB express differ. */
export function stockMaterials(city, style) {
  const spec = liveryFor(city, style);
  const tag = `${city.id}-${style}`;
  return {
    body: mat(`${tag}-body`, spec.body),
    stripe: mat(`${tag}-stripe`, spec.stripe),
    roof: mat(`${tag}-roof`, spec.roof),
    door: mat(`${tag}-door`, spec.door || spec.body),
    end: mat(`${tag}-end`, spec.end || spec.body),
    glass: mat(`${tag}-glass`, '#1b2a33'),
    pane: mat(`${tag}-pane`, '#9fc0d2'),
    trim: mat(`${tag}-trim`, spec.trim || '#2c3a45'),
    lamp: new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }),
  };
}

/** A locomotive in its class livery: electric classes carry a pantograph. */
function buildLoco(city, locoClass, isPlayer) {
  const spec = LOCOS[locoClass] || LOCOS.WAP4;
  const group = new THREE.Group();
  const body = mat(`${city.id}-loco-${locoClass}`, spec.body);
  const stripe = mat(`${city.id}-loco-${locoClass}-st`, spec.stripe);
  const roof = mat(`${city.id}-loco-${locoClass}-rf`, spec.roof);
  const nose = mat(`${city.id}-loco-${locoClass}-ns`, spec.nose);
  const dark = mat('loco-dark', '#2b3134');

  const shell = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.1, 17.6), body);
  shell.position.set(0, 2.9, -1.6);
  group.add(shell);

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.7, 17.0), dark);
  skirt.position.set(0, 1.35, -1.6);
  group.add(skirt);

  const band = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.55, 15.0), stripe);
  band.position.set(0, 3.55, -1.8);
  group.add(band);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.94, 1.5, 4.2), body);
  cab.position.set(0, 3.6, 6.0);
  group.add(cab);

  const top = new THREE.Mesh(new THREE.BoxGeometry(2.86, 0.5, 16.4), roof);
  top.position.set(0, 4.55, -1.6);
  group.add(top);

  // nose and screen: the working end points up the line. The player's cab is
  // built around this end of the loco, so its own face is left open for the
  // interior to sit in.
  if (!isPlayer) {
    const front = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.6, 2.0), nose);
    front.position.set(0, 2.5, 8.2);
    group.add(front);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.95, 0.14), mat('loco-glass', '#16232b'));
    screen.position.set(0, 3.55, 9.2);
    group.add(screen);
  }

  for (const dx of [-1.0, 1.0]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#fff4d0', toneMapped: false }));
    lamp.position.set(dx, 1.85, 9.2);
    group.add(lamp);
  }

  // diesel classes carry side grilles instead of a pantograph
  if (spec.diesel) {
    for (const side of [-1, 1]) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 7.2), dark);
      grille.position.set(side * 1.52, 3.2, -2.4);
      group.add(grille);
    }
    const exhaust = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2.0), dark);
    exhaust.position.set(0, 4.85, 0.4);
    group.add(exhaust);
  } else {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.6), dark);
    base.position.set(0, 4.85, -4.6);
    group.add(base);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), dark);
    arm.position.set(0, 5.5, -4.1);
    arm.rotation.x = 0.5;
    group.add(arm);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.3), dark);
    shoe.position.set(0, 6.15, -3.6);
    group.add(shoe);
  }

  for (const dz of [-12, -6, 3, 7]) {
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 3.0), dark);
    bogie.position.set(0, 0.85, dz);
    group.add(bogie);
  }

  void isPlayer;
  return { group, length: 20 };
}

function instanced(geo, material, count) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  mesh.count = count;
  mesh.frustumCulled = false;
  return mesh;
}

const IDENT = new THREE.Quaternion();
const UNIT = new THREE.Vector3(1, 1, 1);

function put(mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, yaw = 0) {
  const m = new THREE.Matrix4();
  const q = yaw ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) : IDENT;
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  mesh.setMatrixAt(i, m);
}

/**
 * One rake, styled for its city.
 *
 * Suburban stock is a plain EMU: a cab at the front, rows of doors, a window
 * band and a curved roof. Long-distance stock is a locomotive plus a full rake
 * of coaches with end walls, vestibules and roof ribs between them.
 */
function buildTrain(scene, city, train, isPlayer = false) {
  const style = train.stock || (train.kind === 'express' ? 'lhb' : 'emu');
  const livery = stockMaterials(city, style);
  const kind = train.kind === 'express' ? 'express' : 'local';
  const group = new THREE.Group();
  group.name = `train:${train.id}`;

  const cars = train.coaches;
  const len = train.coachLen;
  const hasLoco = Boolean(train.loco);
  // the group origin is the nose of the train: the loco's own front sits on it
  const locoLen = hasLoco ? 18.2 : 0;
  const locoSpec = hasLoco ? (LOCOS[train.loco] || LOCOS.WAP4) : null;
  void locoSpec;
  const bodyH = kind === 'express' ? 3.0 : 2.9;
  const bodyY = 2.75;

  // ---- coaches: instanced, one draw call per part --------------------
  const bodyGeo = new THREE.BoxGeometry(2.9, bodyH, len - 0.7);
  const ribGeo = new THREE.BoxGeometry(2.94, bodyH - 0.6, 0.14);
  // a shallow crown, not a half-tube: radius matches the coach half-width and
  // the profile is squashed so only a low rim shows above the body
  const roofGeo = new THREE.CylinderGeometry(1.45, 1.45, len - 0.9, 14, 1, true, -Math.PI * 0.5, Math.PI);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.rotateY(Math.PI / 2);
  const bandGeo = new THREE.BoxGeometry(2.96, 0.8, len - 2.6);
  const paneGeo = new THREE.BoxGeometry(0.06, 0.5, 1.15);
  const stripeGeo = new THREE.BoxGeometry(2.98, 0.18, len - 2.6);
  const skirtGeo = new THREE.BoxGeometry(2.72, 0.6, len - 1.4);
  const doorGeo = new THREE.BoxGeometry(0.06, 1.95, 1.2);
  const bogieGeo = new THREE.BoxGeometry(2.3, 0.6, 2.6);
  const endGeo = new THREE.BoxGeometry(2.6, 2.7, 0.35);

  const bodies = instanced(bodyGeo, livery.body, cars);
  const roofs = instanced(roofGeo, livery.roof, cars);
  const ribs = style === 'icf' ? instanced(ribGeo, livery.roof, cars * 5) : null;
  const bands = instanced(bandGeo, livery.glass, cars);
  const stripes = instanced(stripeGeo, livery.stripe, cars);
  const skirts = instanced(skirtGeo, livery.trim, cars);
  const doors = instanced(doorGeo, livery.door, cars * 4);
  const panes = instanced(paneGeo, livery.pane, cars * 16);
  const bogies = instanced(bogieGeo, livery.trim, cars * 2);
  const ends = instanced(endGeo, livery.trim, cars * 2);

  let d = 0;
  let p = 0;
  let b = 0;
  let e = 0;
  for (let i = 0; i < cars; i++) {
    const z = -(locoLen + len * i + len / 2);
    put(bodies, i, 0, bodyY, z);
    put(roofs, i, 0, style === 'icf' ? bodyY + bodyH / 2 - 0.16 : bodyY + bodyH / 2 - 0.28, z, 1, style === 'icf' ? 0.16 : 0.34, 1);
    if (ribs) {
      for (let k = 0; k < 5; k++) {
        put(ribs, i * 5 + k, 0, bodyY, z - len * 0.36 + (k * len * 0.72) / 4);
      }
    }
    // the dark window band is what the panes sit on. On an EMU the livery
    // stripe already carries the band, so it is trimmed back to the glass
    put(bands, i, 0, bodyY + 0.52, z, 1, style === 'emu' ? 0.8 : 1, 1);
    // a suburban rake wears its colour as a broad band at window level (the
    // violet stripe of a Mumbai EMU), so the glass sits inside the band;
    // carriage stock keeps a thin lining stripe low down instead
    if (style === 'emu') {
      put(stripes, i, 0, bodyY + 0.38, z, 1, 5.2, 1);
    } else {
      put(stripes, i, 0, bodyY - 0.72, z);
    }
    put(skirts, i, 0, 1.55, z);

    // doors: two per side, at the ends of the saloon
    for (const side of [-1, 1]) {
      for (const dz of [-len * 0.28, len * 0.28]) {
        put(doors, d++, side * 1.46, 2.5, z + dz, 1, 1, 1);
      }
    }
    // window panes along the band
    for (const side of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        const pz = z - len * 0.36 + (k * len * 0.72) / 7;
        put(panes, p++, side * 1.49, 3.28, pz);
      }
    }
    for (const dz of [-len * 0.32, len * 0.32]) {
      put(bogies, b++, 0, 0.85, z + dz);
    }
    if (kind === 'express') {
      put(ends, e++, 0, 2.5, z - len / 2 + 0.2);
      put(ends, e++, 0, 2.5, z + len / 2 - 0.2);
    }
  }
  for (const mesh of [bodies, roofs, ribs, bands, stripes, skirts, doors, panes, bogies, ends]) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.count > 0) group.add(mesh);
  }

  // ---- locomotive --------------------------------------------------
  if (hasLoco) {
    const { group: loco } = buildLoco(city, train.loco, isPlayer);
    loco.position.set(0, 0, -9.0);
    // a locomotive is a lone machine: drop the express paintwork from the first
    // coach so the two read as a loco and a rake, not one long blue tube
    group.add(loco);
  } else if (!isPlayer) {
    // the front of a suburban rake: a flat cab end with a screen, the band
    // carried round the nose, a destination board and two marker lamps
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.9, 1.2), livery.end);
    nose.position.set(0, 2.75, 0.5);
    group.add(nose);

    const screen = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.14), livery.glass);
    screen.position.set(0, 3.5, 1.14);
    group.add(screen);

    const band = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.42, 0.08), livery.stripe);
    band.position.set(0, 2.63, 1.14);
    group.add(band);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.26, 0.06),
      new THREE.MeshBasicMaterial({ color: '#eae5d2' }),
    );
    board.position.set(0, 4.05, 1.14);
    group.add(board);

    const lampGeo = new THREE.SphereGeometry(0.16, 8, 6);
    for (const dx of [-0.9, 0.9]) {
      const lamp = new THREE.Mesh(lampGeo, livery.lamp);
      lamp.position.set(dx, 1.62, 1.16);
      group.add(lamp);
    }
  }

  if (isPlayer) {
    // a low nose beyond the windscreen, so you can see the front of your train
    const hoodMat = hasLoco && LOCOS[train.loco]
      ? mat(`${city.id}-loco-${train.loco}`, LOCOS[train.loco].body)
      : livery.body;
    // the bonnet sits below the windscreen, so the cab has a nose to look over
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.62, 2.2), hoodMat);
    hood.position.set(0, 2.28, 2.3);
    group.add(hood);
    for (const dx of [-0.9, 0.9]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), livery.lamp);
      lamp.position.set(dx, 2.16, 3.42);
      group.add(lamp);
    }
  }

  scene.add(group);
  return group;
}

/**
 * The driver's cab shell. Authored directly in the train group's local frame,
 * whose origin is the nose of the train on the railhead, so the eye lands at
 * CAB_EYE and everything here is measured from the rail.
 */
export const CAB_EYE = { x: 0.42, y: 3.45, z: -1.35 };

/**
 * The driver's cab: an outer shell in the locomotive's paint, and a dark
 * lining inside it. Authored in the train group's local frame, whose origin is
 * the nose of the train on the railhead.
 */
function buildCab(trainGroup, paint, accent) {
  const shell = new THREE.Group();
  shell.name = 'cab';

  const outer = paint || new THREE.MeshLambertMaterial({ color: '#2f3936' });
  const panel = new THREE.MeshLambertMaterial({ color: '#525c56', emissive: '#1d2422' });
  const frame = new THREE.MeshLambertMaterial({ color: '#333c39', emissive: '#121816' });
  const desk = new THREE.MeshLambertMaterial({ color: '#6d756e', emissive: '#232a27' });
  const glass = new THREE.MeshLambertMaterial({
    color: '#b9d6e2', transparent: true, opacity: 0.07, depthWrite: false,
  });

  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    shell.add(mesh);
    return mesh;
  };

  const screenZ = 1.0;
  const sillY = 2.42;
  const headY = 4.18;

  // ---- outer shell (seen from outside, in loco paint) -----------------
  add(new THREE.BoxGeometry(3.06, 0.2, 3.5), outer, 0, headY + 0.36, -0.25);   // roof skin
  add(new THREE.BoxGeometry(3.06, 0.55, 2.4), outer, 0, headY + 0.22, -0.4);    // roof over the cab
  add(new THREE.BoxGeometry(3.02, 0.85, 0.5), outer, 0, sillY - 0.55, screenZ); // nose below the screen
  add(new THREE.BoxGeometry(3.02, 0.62, 0.5), outer, 0, headY + 0.22, screenZ);  // header
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 3.5, 3.2), outer, side * 1.53, 2.9, -0.3);  // side skin
  }
  add(new THREE.BoxGeometry(2.9, 0.14, 3.4), panel, 0, 1.72, -0.2);           // floor

  // ---- interior lining -------------------------------------------------
  add(new THREE.BoxGeometry(2.86, 0.1, 3.1), panel, 0, headY + 0.02, -0.25);
  for (const side of [-1, 1]) {
    // the lining covers the whole wall, so the livery never shows inside
    add(new THREE.BoxGeometry(0.08, 2.9, 3.2), panel, side * 1.4, 2.9, -0.3);
  }

  // ---- windscreen ------------------------------------------------------
  add(new THREE.BoxGeometry(2.96, 0.18, 0.28), frame, 0, sillY - 0.09, screenZ);
  add(new THREE.BoxGeometry(2.96, 0.18, 0.28), frame, 0, headY + 0.09, screenZ);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, headY - sillY + 0.36, 0.26), frame,
      side * 1.44, (headY + sillY) / 2, screenZ);
  }
  add(new THREE.PlaneGeometry(2.76, headY - sillY), glass, 0, (headY + sillY) / 2, screenZ + 0.03);
  add(new THREE.PlaneGeometry(2.5, 0.4),
    new THREE.MeshBasicMaterial({ color: '#dfeef4', transparent: true, opacity: 0.1, depthWrite: false }),
    0, headY - 0.22, screenZ + 0.05);
  add(new THREE.BoxGeometry(0.05, 1.05, 0.05), frame, -0.5, 3.4, screenZ + 0.08, 0, 0, 0.5);
  // sun visor, flat against the header instead of slicing across the view
  add(new THREE.BoxGeometry(2.5, 0.3, 0.12), frame, 0, headY - 0.12, screenZ - 0.05);

  // ---- dash and console ------------------------------------------------
  add(new THREE.BoxGeometry(2.86, 0.4, 1.4), desk, 0, 2.72, 0.9);
  add(new THREE.BoxGeometry(2.82, 0.5, 0.3), panel, 0, 2.36, 1.16);
  add(new THREE.BoxGeometry(2.86, 0.7, 1.5), panel, 0, 2.1, 0.6);

  // the livery wraps round the cab end, exactly as it does on the rake behind
  if (accent) {
    const board = new THREE.MeshBasicMaterial({ color: '#eae5d2' });
    // under the screen, not across it: the band wraps the cab end at the
    // same height it runs along the coaches
    add(new THREE.BoxGeometry(3.0, 0.42, 0.06), accent, 0, 2.16, screenZ + 0.27);
    add(new THREE.BoxGeometry(1.85, 0.26, 0.05), board, 0, 4.4, screenZ + 0.26);
  }
  for (const [x, h] of [[-0.66, 0.3], [0.7, 0.26]]) {
    add(new THREE.BoxGeometry(0.09, h, 0.09), frame, x, 2.92 + h / 2, 0.72, -0.24, 0, 0);
    add(new THREE.SphereGeometry(0.08, 8, 6), frame, x, 2.92 + h, 0.68);
  }
  add(new THREE.BoxGeometry(0.8, 0.22, 0.18), panel, -0.05, 2.96, 0.6, -0.3, 0, 0);

  // ---- ceiling, side glass, rear bulkhead ------------------------------
  add(new THREE.BoxGeometry(0.28, 0.05, 0.4),
    new THREE.MeshBasicMaterial({ color: '#f6efd6', toneMapped: false }), 0, headY + 0.05, -0.7);
  for (const side of [-1, 1]) {
    add(new THREE.PlaneGeometry(2.4, 0.62), glass, side * 1.44, 3.42, -0.25, 0, Math.PI / 2, 0);
    add(new THREE.BoxGeometry(0.05, 0.8, 0.05), frame, side * 1.22, 3.42, 0.9);
    add(new THREE.BoxGeometry(0.09, 1.5, 0.4), outer, side * 1.44, 3.4, -1.5);
  }
  add(new THREE.BoxGeometry(2.86, 2.7, 0.12), panel, 0, 3.0, -1.68);
  add(new THREE.BoxGeometry(0.86, 1.9, 0.05), frame, 0.44, 2.75, -1.62);

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
  const playerTrain = world.trains.find((t) => t.id === world.playerId);
  const rake = stockMaterials(world.city, playerTrain?.stock || 'emu');
  const loco = playerTrain && playerTrain.loco ? LOCOS[playerTrain.loco] : null;
  const paint = loco ? mat(`${world.city.id}-loco-${playerTrain.loco}`, loco.body) : rake.body;
  const accent = loco ? mat(`${world.city.id}-loco-${playerTrain.loco}-st`, loco.stripe) : rake.stripe;
  const cab = buildCab(trainGroups.get(world.playerId), paint, accent);
  const signals = buildSignals(scene, world);

  // everything but the trains is static: freeze its matrices so the renderer
  // does not rebuild ~1400 of them every frame
  const moving = new Set();
  for (const group of trainGroups.values()) {
    group.traverse((o) => moving.add(o));
  }
  scene.traverse((o) => {
    if (!moving.has(o)) o.matrixAutoUpdate = false;
  });
  scene.updateMatrixWorld(true);

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
export function cameraPose(world, { mode = 'cab', orbit = 0.6, height = 22, distance = 78 } = {}) {
  const train = playerTrain(world);
  const path = world.paths[train.pathId];
  const head = sample(path, train.s);
  const forward = train.dir > 0 ? head.angle : head.angle + Math.PI;
  const fx = Math.cos(forward);
  const fz = Math.sin(forward);
  // right-hand vector on the ground plane
  const rx = fz;
  const rz = -fx;

  if (mode === 'cab') {
    // seated in the cab, just behind the nose, eye level with the windscreen
    return {
      position: new THREE.Vector3(
        head.x + fx * CAB_EYE.z + rx * CAB_EYE.x,
        CAB_EYE.y,
        head.y + fz * CAB_EYE.z + rz * CAB_EYE.x,
      ),
      target: new THREE.Vector3(head.x + fx * 160, 2.75, head.y + fz * 160),
      fov: 66,
    };
  }

  if (mode === 'chase') {
    // a drone over the shoulder of the loco: high enough to clear the coaches
    // (they trail 300 m back) and pitched down the line so you can drive on it
    const back = 30;
    const side = 11;
    return {
      position: new THREE.Vector3(
        head.x - fx * back + rx * side,
        16,
        head.y - fz * back + rz * side,
      ),
      target: new THREE.Vector3(head.x + fx * 55, 2.5, head.y + fz * 55),
      fov: 58,
    };
  }

  if (mode === 'overhead') {
    return {
      position: new THREE.Vector3(head.x + rx * 6, 120, head.y + rz * 6 - 8),
      target: new THREE.Vector3(head.x, 0, head.y - 56),
      fov: 52,
    };
  }

  // lineside / orbit: stand off the track and watch the whole rake go past.
  // the rake is 200-400 m long, so the eye is pulled back to frame it all
  const midfield = Math.min(train.length * 0.42, 150);
  const stand = distance + train.length * 0.14;
  return {
    position: new THREE.Vector3(
      head.x + Math.cos(orbit) * stand,
      height + train.length * 0.02,
      head.y + Math.sin(orbit) * stand,
    ),
    target: new THREE.Vector3(head.x - fx * midfield, 3.0, head.y - fz * midfield),
    fov: 44,
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
