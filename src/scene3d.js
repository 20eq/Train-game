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
  // haze thickens with distance so the horizon reads as atmosphere, not a
  // painted wall; the far plane is inside the fog so the map never "ends"
  scene.fog = new THREE.FogExp2(pal.fog, 0.00028);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, pal.skyTop);
  grad.addColorStop(0.42, pal.skyTop);
  grad.addColorStop(0.62, pal.skyLow);
  grad.addColorStop(0.72, pal.fog);
  grad.addColorStop(1, pal.fog);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 512);

  // a wide, low winter sun burning through the haze near the horizon
  const glow = ctx.createRadialGradient(32, 316, 2, 32, 316, 120);
  glow.addColorStop(0, 'rgba(255, 246, 224, 0.9)');
  glow.addColorStop(0.35, 'rgba(255, 240, 210, 0.28)');
  glow.addColorStop(1, 'rgba(255, 240, 210, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 190, 64, 260);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 24, 18),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  scene.add(dome);
}

/* ------------------------------------------------------------------ */
/* terrain                                                             */
/* ------------------------------------------------------------------ */

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise: cheap, deterministic, and identical between runs. */
function noise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, y * f, seed + i * 71) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Cross-section of the railway formation, measured from the track centre.
 * The bed is cut 0.9 m below natural ground so the ballast shoulder stands
 * proud of the field, the cess runs out to a drainage ditch, and past that
 * the ground lifts back to natural level.
 */
/**
 * A tileable ground texture: scrub, dry patches, plough lines. Vertex colours
 * can only vary every 50 m, which reads as flat paint; this supplies the
 * detail at the metre scale. Everything is drawn with gradients and fillRect
 * so the headless canvas stub can build it too.
 */
function groundTexture(seed) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const rand = mulberry(seed * 7 + 13);

  g.fillStyle = '#b9b9ae';
  g.fillRect(0, 0, size, size);

  // soft tonal blotches, drawn nine times so the tile wraps
  const blob = (x, y, r, colour, alpha) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const px = x + ox;
        const py = y + oy;
        if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
        const grad = g.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, colour);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = alpha;
        g.fillStyle = grad;
        g.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
    g.globalAlpha = 1;
  };

  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 70;
    const dark = rand() > 0.45;
    blob(x, y, r, dark ? 'rgba(96,102,74,1)' : 'rgba(214,208,186,1)', 0.16 + rand() * 0.18);
  }

  // clods and stubble: fine grain keeps it from looking airbrushed
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 1 + rand() * 3;
    const h = 1 + rand() * 2;
    g.globalAlpha = 0.05 + rand() * 0.16;
    g.fillStyle = rand() > 0.5 ? '#6c7052' : '#e0d9c2';
    g.fillRect(x, y, w, h);
  }
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Blend through the city's ground palette without hard steps. */
function grassTint(base, n, out) {
  const f = Math.min(0.9999, Math.max(0, n)) * (base.length - 1);
  const i = Math.floor(f);
  out.copy(base[i]).lerp(base[Math.min(base.length - 1, i + 1)], f - i);
  return out;
}

function bedProfile(d) {
  // the ground is dug down only under the ballast prism, whose sloped sides
  // stand ~0.6 m proud of the field. Beyond that the cess runs out flat to a
  // shallow ditch and then natural ground takes over.
  if (d < 5) return -0.62;
  if (d < 11) return -0.62 + 0.62 * smoothstep(5, 11, d);
  if (d < 30) return -0.16 * Math.sin(((d - 11) / 19) * Math.PI); // drainage lip
  return 0;
}

/** Two-point cross-section: a sloped face running along the path. */
function bankGeometry(path, offA, yA, offB, yB, step = 5) {
  const n = Math.max(2, Math.ceil(path.length / step));
  const pos = new Float32Array((n + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const p = sample(path, Math.min(path.length, (i / n) * path.length));
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? offA : offB;
      const o = (i * 2 + k) * 3;
      pos[o] = p.x + nx * off;
      pos[o + 1] = k === 0 ? yA : yB;
      pos[o + 2] = p.y + ny * off;
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

/**
 * The ground is a displaced heightfield, not a painted plane: hills that rise
 * away from the railway, undulation along the corridor, and a flat formation
 * where the track actually runs. Distance to the corridor decides how much
 * terrain is allowed to show.
 */
function buildGround(scene, city, world) {
  const pal = city.palette;
  const seed = city.seed;

  // decimated corridor samples, used to flatten the ground under the railway
  const corridor = [];
  for (const path of Object.values(world.paths)) {
    const step = Math.max(1, Math.floor(path.pts.length / 160));
    for (let i = 0; i < path.pts.length; i += step) corridor.push(path.pts[i]);
  }

  const distToRail = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < corridor.length; i++) {
      const p = corridor[i];
      const dx = p.x - x;
      const dz = p.y - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  const heightAt = (x, z) => {
    // broad hills, medium swells, small ripples. A railway valley is mostly
    // flat land with the country rising miles away, so the amplitudes stay
    // modest and the hills are pushed back.
    let h = (fbm(x / 3200, z / 3200, seed, 4) - 0.5) * 190;
    h += (fbm(x / 900, z / 900, seed + 11, 3) - 0.5) * 34;
    h += (fbm(x / 210, z / 210, seed + 23, 2) - 0.5) * 5;

    // a far ridge closing the horizon, so the map does not simply stop
    const cx = (world.bounds.minX + world.bounds.maxX) / 2;
    const cz = (world.bounds.minY + world.bounds.maxY) / 2;
    const r = Math.hypot(x - cx, z - cz);
    h += smoothstep(5600, 7800, r) * (200 + fbm(x / 1600, z / 1600, seed + 41, 3) * 460);

    // The railway runs on a level formation. Level means level: the ground is
    // exactly 0 out to 70 m either side, then blends into the hills over the
    // next 700 m. The old 90 m shelf was narrower than the grid step, so the
    // hills bled through and the train appeared to float.
    const d = distToRail(x, z);
    const mask = smoothstep(230, 1500, d);
    return h * mask + bedProfile(d);
  };

  const span = 16000;
  const seg = 300;
  const geo = new THREE.PlaneGeometry(span, span, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const cx = (world.bounds.minX + world.bounds.maxX) / 2;
  const cz = (world.bounds.minY + world.bounds.maxY) / 2;

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = pal.ground.map((c) => new THREE.Color(c));
  const dry = new THREE.Color(pal.ballast);
  const tint = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const y = heightAt(x, z);
    pos.setX(i, x);
    pos.setZ(i, z);
    pos.setY(i, y);

    // colour follows altitude and a little noise, so no two fields match
    const n = fbm(x / 420, z / 420, seed + 7, 3);
    const m = fbm(x / 1600, z / 1600, seed + 91, 2);
    grassTint(base, n, tint);
    tint.lerp(dry, Math.max(0, 0.28 - m) * 0.5);
    // higher ground is a touch paler and cooler
    tint.offsetHSL(0, -0.04, Math.min(0.07, Math.max(-0.04, y / 3000)));
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const tex = groundTexture(seed);
  tex.repeat.set(span / 300, span / 300);
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, map: tex }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
}

/**
 * A dense strip of ground that follows every line: this is what the ballast
 * shoulder, the cess and the verges are made of. The global heightfield is far
 * too coarse (one vertex every 53 m) to carry a 12 m wide formation, so the
 * ground you actually look at while driving is this mesh.
 */
function buildCorridorBed(scene, city, world) {
  const pal = city.palette;
  const seed = city.seed;
  const base = pal.ground.map((c) => new THREE.Color(c));
  const stone = new THREE.Color(pal.ballast);
  const earth = new THREE.Color(pal.ballast).lerp(new THREE.Color('#6b5f49'), 0.45);
  const tint = new THREE.Color();

  // lateral sampling: tight in the cess, opening out towards the fields
  const offsets = [
    -0.5, 0, 0.5, 2.6, 4.2, 6.4, 9, 13, 18, 24, 31, 39, 48, 60, 74, 90,
  ];
  const lanes = [];
  for (let i = offsets.length - 1; i >= 1; i--) lanes.push(-offsets[i]);
  lanes.push(...offsets);

  const group = new THREE.Group();
  group.name = 'formation';

  for (const [pathId, path] of Object.entries(world.paths)) {
    const step = 8;
    const n = Math.max(2, Math.ceil(path.length / step));
    const pos = new Float32Array((n + 1) * lanes.length * 3);
    const col = new Float32Array((n + 1) * lanes.length * 3);
    const uv = new Float32Array((n + 1) * lanes.length * 2);
    const idx = [];

    for (let i = 0; i <= n; i++) {
      const sPos = Math.min(path.length, (i / n) * path.length);
      const p = sample(path, sPos);
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);

      for (let k = 0; k < lanes.length; k++) {
        const off = lanes[k];
        const d = Math.abs(off);
        const x = p.x + nx * off;
        const z = p.y + ny * off;

        // a little natural roll on the outer lanes, none on the formation
        const roll = d > 24 ? (fbm(x / 190, z / 190, seed + 23, 2) - 0.5) * 2.4 : 0;
        const y = bedProfile(d) + roll;

        const o = (i * lanes.length + k) * 3;
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;

        if (d < 4.6) tint.copy(stone);
        else if (d < 9) tint.copy(stone).lerp(earth, (d - 4.6) / 4.4);
        else if (d < 26) tint.copy(earth).lerp(base[0], (d - 9) / 17);
        else {
          grassTint(base, fbm(x / 420, z / 420, seed + 7, 3), tint);
          tint.lerp(earth, Math.max(0, 0.26 - fbm(x / 900, z / 900, seed + 5, 2)) * 0.55);
        }
        col[o] = tint.r;
        col[o + 1] = tint.g;
        col[o + 2] = tint.b;

        const o2 = (i * lanes.length + k) * 2;
        uv[o2] = sPos / 300;
        uv[o2 + 1] = off / 300;
      }

      if (i < n) {
        for (let k = 0; k < lanes.length - 1; k++) {
          const a = i * lanes.length + k;
          const b = a + lanes.length;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, map: groundTexture(seed + 1),
    }));
    mesh.name = `bed:${pathId}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  scene.add(group);
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

  const ballastMat = new THREE.MeshLambertMaterial({ color: pal.ballast });
  const ballast = new THREE.Mesh(ribbonGeometry(path, { width: 7.2, y: 0.05 }), ballastMat);
  group.add(ballast);
  // the shoulder: 0.65 m of ballast standing proud of the field on both sides
  for (const side of [-1, 1]) {
    group.add(new THREE.Mesh(
      bankGeometry(path, side * 3.6, 0.05, side * 6.4, -0.62),
      ballastMat,
    ));
  }

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
  // support columns must reach the canopy, not stop a metre short of it
  const pillarGeo = new THREE.BoxGeometry(0.22, 5.86, 0.22);

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
      pillar.position.set(side * 7.2, 2.93, z);
      g.add(pillar);
    }

    // a longitudinal girder on the columns, and a valance along the platform
    // edge: without them the canopy reads as a slab hanging in the air
    const girder = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, roofGeo.parameters.depth - 1), pillarMat);
    girder.position.set(side * 7.2, 5.98, 0);
    g.add(girder);

    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.42, roofGeo.parameters.depth),
      roofMat,
    );
    valance.position.set(side * 3.24, 5.94, 0);
    g.add(valance);

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

/**
 * The small stuff that sells the scale: scrub on the cess, the boundary fence,
 * kilometre posts and the relay cabinets every railway has.
 */
function buildTrackside(scene, city, world) {
  const rand = mulberry(world.city.seed + 61);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colour = new THREE.Color();
  const bushGeo = new THREE.IcosahedronGeometry(1, 0);

  const bushes = [];
  const posts = [];
  const kms = [];
  for (const [pathId, path] of Object.entries(world.paths)) {
    const skip = world.stationsOnPath[pathId] || [];
    for (let s = 0; s < path.length; s += 7 + rand() * 9) {
      if (skip.some((st) => Math.abs(st.s - s) < PLATFORM_LEN * 0.6)) continue;
      const p = sample(path, s);
      const side = rand() > 0.5 ? 1 : -1;
      const off = side * (7.6 + rand() * 8);
      bushes.push({ x: p.x - Math.sin(p.angle) * off, z: p.y + Math.cos(p.angle) * off, r: rand(), angle: p.angle });
    }
    // fence posts along the boundary, every 6 m
    for (let s = 0; s < path.length; s += 6) {
      const p = sample(path, s);
      for (const side of [-1, 1]) {
        const off = side * 13.5;
        posts.push({ x: p.x - Math.sin(p.angle) * off, z: p.y + Math.cos(p.angle) * off, angle: p.angle });
      }
    }
    for (let s = 50; s < path.length; s += 200) {
      const p = sample(path, s);
      const off = 6.9;
      kms.push({ x: p.x - Math.sin(p.angle) * off, z: p.y + Math.cos(p.angle) * off, angle: p.angle });
    }
  }

  const bushMesh = new THREE.InstancedMesh(
    bushGeo,
    new THREE.MeshLambertMaterial({ flatShading: true }),
    bushes.length,
  );
  bushes.forEach((b, i) => {
    const r = 0.5 + b.r * 0.9;
    pos.set(b.x, r * 0.55, b.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.r * 6.28);
    scl.set(r * 1.4, r * 0.9, r * 1.4);
    m.compose(pos, q, scl);
    bushMesh.setMatrixAt(i, m);
    colour.set(city.palette.ground[1 + Math.floor(b.r * 2) % city.palette.ground.length])
      .multiplyScalar(0.5 + b.r * 0.3);
    bushMesh.setColorAt(i, colour);
  });
  bushMesh.instanceMatrix.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;
  scene.add(bushMesh);

  const postMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 1.1, 0.12),
    new THREE.MeshLambertMaterial({ color: '#7c7466' }),
    posts.length,
  );
  posts.forEach((p, i) => {
    pos.set(p.x, 0.45, p.z);
    m.compose(pos, q.identity(), scl.set(1, 1, 1));
    postMesh.setMatrixAt(i, m);
  });
  postMesh.instanceMatrix.needsUpdate = true;
  scene.add(postMesh);

  // one wire per side, strung along the fence posts
  const fenceMat = new THREE.LineBasicMaterial({ color: '#5d564c' });
  for (const path of Object.values(world.paths)) {
    for (const side of [-1, 1]) {
      const pts = [];
      for (let s = 0; s < path.length; s += 24) {
        const p = sample(path, s);
        const off = side * 13.5;
        pts.push(new THREE.Vector3(p.x - Math.sin(p.angle) * off, 0.95, p.y + Math.cos(p.angle) * off));
      }
      if (pts.length > 1) {
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), fenceMat));
      }
    }
  }
  const kmMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.95, 0.2),
    new THREE.MeshLambertMaterial({ color: '#d8d2c0' }),
    kms.length,
  );
  kms.forEach((k, i) => {
    m.compose(pos.set(k.x, 0.5, k.z), q.identity(), scl.set(1, 1, 1));
    kmMesh.setMatrixAt(i, m);
  });
  kmMesh.instanceMatrix.needsUpdate = true;
  scene.add(kmMesh);
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
  // canopies are two offset lumps rather than a cone, so a tree line reads as
  // vegetation at a distance instead of a row of triangles
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);
  const leavesLo = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), trees.length);
  const leavesHi = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), trees.length);
  const lat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();

  trees.forEach((t, i) => {
    const h = 0.85 + t.rand * 0.6;
    const rot = t.rand * Math.PI * 2;
    euler.set(0, rot, 0);
    lat.setFromEuler(euler);

    m.compose(new THREE.Vector3(t.x, 1.7 * h, t.z), q, new THREE.Vector3(h * 0.55, h, h * 0.55));
    trunks.setMatrixAt(i, m);

    const sway = 1.2 + t.rand * 0.9;
    scale.set(2.9 * h * sway, 2.4 * h, 2.9 * h * sway);
    m.compose(new THREE.Vector3(t.x, 5.4 * h, t.z), lat, scale);
    leavesLo.setMatrixAt(i, m);

    scale.set(1.9 * h * sway, 1.9 * h, 1.9 * h * sway);
    m.compose(new THREE.Vector3(t.x + Math.cos(rot) * 1.1 * h, 7.1 * h, t.z + Math.sin(rot) * 1.1 * h), lat, scale);
    leavesHi.setMatrixAt(i, m);

    colour.set(pal.ground[1 + Math.floor(t.rand * (pal.ground.length - 1))]).multiplyScalar(0.42 + t.rand * 0.2);
    leavesLo.setColorAt(i, colour);
    leavesHi.setColorAt(i, colour.clone().multiplyScalar(1.16));
  });
  trunks.instanceMatrix.needsUpdate = true;
  leavesLo.instanceMatrix.needsUpdate = true;
  leavesHi.instanceMatrix.needsUpdate = true;
  if (leavesLo.instanceColor) leavesLo.instanceColor.needsUpdate = true;
  if (leavesHi.instanceColor) leavesHi.instanceColor.needsUpdate = true;
  scene.add(trunks, leavesLo, leavesHi);

  const city2 = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({}),
    blocks.length,
  );
  const roofs = new THREE.InstancedMesh(
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
    colour.set(pal.building).multiplyScalar(0.7 + b.rand * 0.26);
    city2.setColorAt(i, colour);

    // a flat roof, slightly proud of the walls
    m.compose(new THREE.Vector3(b.x, h + 0.35, b.z), q, new THREE.Vector3(w + 0.7, 0.7, d + 0.7));
    roofs.setMatrixAt(i, m);
    roofs.setColorAt(i, colour.clone().multiplyScalar(0.72));
  });
  city2.instanceMatrix.needsUpdate = true;
  if (city2.instanceColor) city2.instanceColor.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  scene.add(city2, roofs);
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

/** A soft band, dark down the middle and fading to nothing at the edges. */
function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.22, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.8)');
  grad.addColorStop(0.78, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 8);
  return new THREE.CanvasTexture(c);
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

  // A contact shadow is what makes stock read as standing *on* the track
  // rather than hovering over it. One soft band per vehicle, no shadow maps.
  const shadowTex = contactShadowTexture();
  const shadowGeo = new THREE.PlaneGeometry(4.2, len + 0.4);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const shadows = instanced(shadowGeo, shadowMat, cars + (hasLoco ? 1 : 0));

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
    put(shadows, i, 0, 0.07, z + 0.1);

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
  // shadows first, so the transparent bands blend over the ballast and not
  // over each other
  shadows.instanceMatrix.needsUpdate = true;
  group.add(shadows);
  for (const mesh of [bodies, roofs, ribs, bands, stripes, skirts, doors, panes, bogies, ends]) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.count > 0) group.add(mesh);
  }

  // ---- locomotive --------------------------------------------------
  if (hasLoco) {
    const { group: loco } = buildLoco(city, train.loco, isPlayer);
    loco.position.set(0, 0, -9.0);
    const locoShadow = new THREE.PlaneGeometry(4.0, 19.6);
    locoShadow.rotateX(-Math.PI / 2);
    const ls = new THREE.Mesh(locoShadow, shadowMat);
    ls.position.set(0, 0.07, -9.0);
    group.add(ls);
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

  if (isPlayer && hasLoco) {
    // A loco has a short bonnet you look over from the cab. A suburban EMU
    // does not: its cab end is flush, and a slab of livery there reads as a
    // painted plate stuck to the windscreen.
    const hoodMat = LOCOS[train.loco]
      ? mat(`${city.id}-loco-${train.loco}`, LOCOS[train.loco].body)
      : livery.body;
    // the bonnet sits just above the screen sill, so it reads as a nose the
    // driver looks over rather than as a stripe below the glass
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 2.1), hoodMat);
    hood.position.set(0, 2.5, 2.55);
    group.add(hood);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 2.0), hoodMat);
    crown.position.set(0, 2.2, 2.55);
    group.add(crown);
    // the nose falls away towards the buffer beam
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 1.1), hoodMat);
    wedge.position.set(0, 2.3, 3.9);
    wedge.rotation.x = 0.3;
    group.add(wedge);
    for (const dx of [-0.86, 0.86]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), livery.lamp);
      lamp.position.set(dx, 2.14, 4.34);
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
 * The driver's cab. Authored in the train group's local frame, whose origin is
 * the nose of the train on the railhead, so the eye lands at CAB_EYE and every
 * measurement below is from the rail.
 *
 * The inside is deliberately darker than the world outside: a real cab is a
 * dim shell with a bright windscreen, and that contrast is most of what sells
 * the view as a view rather than as scenery.
 */
function buildCab(trainGroup, paint, accent) {
  const shell = new THREE.Group();
  shell.name = 'cab';

  const outer = paint || new THREE.MeshLambertMaterial({ color: '#2f3936' });

  // interior surfaces: near-black shell, slightly lifted panels, a lighter desk
  const wall = new THREE.MeshLambertMaterial({ color: '#1d2422', emissive: '#0b0f0e' });
  const lining = new THREE.MeshLambertMaterial({ color: '#2a322f', emissive: '#101514' });
  const frame = new THREE.MeshLambertMaterial({ color: '#151a19', emissive: '#080b0a' });
  const desk = new THREE.MeshLambertMaterial({ color: '#333b37', emissive: '#141917' });
  const trim = new THREE.MeshLambertMaterial({ color: '#454e48', emissive: '#171c1a' });
  const dialFace = new THREE.MeshBasicMaterial({ color: '#0d1412' });
  const dialGlow = new THREE.MeshBasicMaterial({ color: '#7fe0b0', toneMapped: false });
  const lamp = new THREE.MeshBasicMaterial({ color: '#ffd79a', toneMapped: false });
  const glass = new THREE.MeshLambertMaterial({
    color: '#a8c4d0', transparent: true, opacity: 0.05, depthWrite: false,
  });

  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    shell.add(mesh);
    return mesh;
  };

  const screenZ = 1.0;
  const sillY = 2.38;
  const headY = 4.12;
  const roofY = headY + 0.30;

  // a dim lamp over the desk: a real cab is dark, but the instrument face and
  // the handle gear still have to read
  const fill = new THREE.PointLight(0xffe0b0, 0.5, 4.5, 2);
  fill.position.set(0.1, roofY - 0.4, -0.2);
  shell.add(fill);

  // ---- outer shell, painted in the rake's colours ----------------------
  // every painted piece sits *outside* the screen plane, so nothing in the
  // rake's colours can poke into the cab and show above or below the glass
  add(new THREE.BoxGeometry(3.06, 0.22, 3.6), outer, 0, roofY + 0.16, -0.3);          // roof skin
  add(new THREE.BoxGeometry(2.62, 0.95, 0.5), outer, 0, sillY - 0.72, screenZ + 0.42); // nose
  // the header must sit clear above the glass, or its underside becomes a
  // painted band across the top of the windscreen
  add(new THREE.BoxGeometry(2.62, 0.62, 0.42), outer, 0, headY + 0.58, screenZ + 0.38); // header
  for (const side of [-1, 1]) {
    // the side skin has to carry the same window openings as the lining, or the
    // driver looks out at the inside of his own paintwork
    add(new THREE.BoxGeometry(0.06, 1.88, 3.4), outer, side * 1.52, 2.04, -0.35); // below the glass
    add(new THREE.BoxGeometry(0.06, 1.0, 3.4), outer, side * 1.52, 4.2, -0.35);   // above the glass
    add(new THREE.BoxGeometry(0.06, 0.74, 0.42), outer, side * 1.52, 3.34, 1.14); // front pier
    add(new THREE.BoxGeometry(0.06, 0.74, 0.62), outer, side * 1.52, 3.34, -1.75); // rear pier
  }

  // ---- interior shell --------------------------------------------------
  // five inward-facing planes rather than boxes: a sealed cabin cannot show
  // the livery through a seam, and back-face culling does the work for us
  // DoubleSide, not BackSide: these planes face into the cab, and the camera
  // sits off-centre, so culling them by winding drops whichever wall is behind
  // the eye and shows the painted shell through the gap
  const innerWall = new THREE.MeshLambertMaterial({
    color: '#1a211f', emissive: '#0a0e0d', side: THREE.DoubleSide,
  });
  const spanY = roofY - 0.04 - 1.72;

  const plane = (w, h, x, y, z, rx, ry) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), innerWall);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    shell.add(mesh);
    return mesh;
  };
  plane(2.94, 3.7, 0, 1.72, -0.05, -Math.PI / 2, 0);                     // floor
  // the ceiling runs right up to the screen header, otherwise the painted
  // roof shows through above the windscreen
  plane(2.94, 3.9, 0, roofY - 0.04, 0.4, Math.PI / 2, 0);                // ceiling
  // side walls are panelled round an opening, not solid: a motorman glances
  // out at the platform, and the earlier solid lining made the side windows
  // into painted fake panes
  const winLow = 3.02;
  const winHigh = 3.66;
  for (const side of [-1, 1]) {
    plane(3.5, winLow - 1.72, side * 1.44, (1.72 + winLow) / 2, -0.2, 0, side * Math.PI / 2);
    plane(3.5, roofY - 0.06 - winHigh, side * 1.44, (winHigh + roofY - 0.06) / 2, -0.2, 0, side * Math.PI / 2);
    // corner piers, so the painted shell cannot be seen through the front or
    // rear corners of the cab
    plane(0.62, winHigh - winLow, side * 1.44, (winLow + winHigh) / 2, 1.24, 0, side * Math.PI / 2);
    plane(0.5, winHigh - winLow, side * 1.44, (winLow + winHigh) / 2, -1.7, 0, side * Math.PI / 2);
  }
  plane(2.9, spanY, 0, 1.72 + spanY / 2, -1.78, 0, 0);                   // rear bulkhead
  // the front wall is only the strip below the screen: above and beside it the
  // window frame closes the gap
  // the front wall is the strip below the screen; the headlining above it is
  // its own panel, and both are a touch wider than the cab so no sliver of
  // the painted shell can show at the edges
  const belowH = sillY - 1.72;
  plane(3.04, belowH, 0, 1.72 + belowH / 2, screenZ, 0, Math.PI);              // under the screen
  add(new THREE.BoxGeometry(3.0, roofY - headY, 0.1), wall, 0, (headY + roofY) / 2, screenZ - 0.04);

  // ---- windscreen frame: slim pillars, thin header ---------------------
  add(new THREE.BoxGeometry(2.94, 0.1, 0.3), frame, 0, sillY - 0.05, screenZ);  // sill
  add(new THREE.BoxGeometry(2.94, 0.1, 0.3), frame, 0, headY + 0.05, screenZ);  // header
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, headY - sillY + 0.2, 0.28), frame,
      side * 1.44, (headY + sillY) / 2, screenZ);
  }
  // solid corners: no sight line out of the glass can reach painted metal
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.16, headY - sillY + 0.3, 0.7), wall,
      side * 1.45, (headY + sillY) / 2, screenZ + 0.1);
  }
  // centre divider: a three-piece screen, as on a real loco cab
  add(new THREE.BoxGeometry(0.06, headY - sillY, 0.24), frame, 0.06, (headY + sillY) / 2, screenZ);
  add(new THREE.PlaneGeometry(2.8, headY - sillY), glass, 0, (headY + sillY) / 2, screenZ + 0.03);
  add(new THREE.BoxGeometry(0.045, 1.0, 0.045), frame, -0.52, 3.3, screenZ + 0.09, 0, 0, 0.52);
  add(new THREE.BoxGeometry(0.045, 1.0, 0.045), frame, 0.6, 3.3, screenZ + 0.09, 0, 0, 0.52);

  // ---- the desk and the instrument binnacle ----------------------------
  add(new THREE.BoxGeometry(2.9, 0.09, 1.05), desk, 0, 2.62, 0.92, -0.1, 0, 0);   // desk top
  add(new THREE.BoxGeometry(2.9, 0.58, 0.34), lining, 0, 2.3, 1.28);              // fascia
  add(new THREE.BoxGeometry(2.9, 0.78, 1.3), wall, 0, 2.02, 0.55);                // pedestal

  // instrument binnacle: twin dials and a row of small lamps
  const bin = add(new THREE.BoxGeometry(1.16, 0.34, 0.16), frame, -0.18, 2.86, 0.98, -0.28, 0, 0);
  void bin;
  for (const dx of [-0.27, 0.27]) {
    add(new THREE.CylinderGeometry(0.125, 0.125, 0.02, 18), dialFace,
      -0.18 + dx, 2.885, 0.9, Math.PI / 2 - 0.28, 0, 0);
    add(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 16), dialGlow,
      -0.18 + dx, 2.89, 0.895, Math.PI / 2 - 0.28, 0, 0);
  }
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.055, 0.035, 0.02), i < 3 ? dialGlow : lamp,
      -0.62 + i * 0.17, 2.76, 0.9, -0.28, 0, 0);
  }

  // traction and brake handles, on the desk where the hands fall
  for (const [x, hgt] of [[-0.72, 0.28], [0.74, 0.24]]) {
    add(new THREE.BoxGeometry(0.07, hgt, 0.07), trim, x, 2.66 + hgt / 2, 0.72, -0.2, 0, 0);
    add(new THREE.SphereGeometry(0.07, 10, 8), frame, x, 2.66 + hgt, 0.69);
  }
  // handbrake / reverser wheel to the driver's left
  add(new THREE.TorusGeometry(0.11, 0.022, 6, 14), frame, -0.72, 2.92, 0.52, Math.PI / 2, 0, 0);

  // ---- ceiling: lamp, vents, grab rails -------------------------------
  add(new THREE.BoxGeometry(0.34, 0.04, 0.46), lamp, 0, roofY - 0.13, -0.5);
  add(new THREE.BoxGeometry(0.9, 0.05, 0.3), frame, 0.5, roofY - 0.13, -1.1);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.035, 0.035, 2.0), trim, side * 1.24, roofY - 0.16, -0.3);
  }

  // ---- side windows, with a slim frame --------------------------------
  for (const side of [-1, 1]) {
    add(new THREE.PlaneGeometry(2.3, 0.66), glass, side * 1.47, 3.34, -0.25, 0, Math.PI / 2, 0);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.4), frame, side * 1.4, 3.0, -0.25);
    add(new THREE.BoxGeometry(0.05, 0.06, 2.4), frame, side * 1.4, 3.68, -0.25);
    add(new THREE.BoxGeometry(0.05, 0.74, 0.06), frame, side * 1.4, 3.34, 0.95);
    add(new THREE.BoxGeometry(0.05, 0.74, 0.06), frame, side * 1.4, 3.34, -1.45);
  }

  // ---- the livery wraps round the cab end ------------------------------
  if (accent) {
    const board = new THREE.MeshBasicMaterial({ color: '#e8e2cf' });
    add(new THREE.BoxGeometry(3.04, 0.44, 0.05), accent, 0, 1.94, screenZ + 0.24);
    add(new THREE.BoxGeometry(1.75, 0.24, 0.04), board, 0, headY + 0.52, screenZ + 0.24);
  }

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
  buildCorridorBed(scene, world.city, world);

  for (const [pathId, path] of Object.entries(world.paths)) {
    buildTrack(scene, world.city, pathId, path);
  }
  for (const station of world.stations) {
    buildStation(scene, world.city, station);
  }
  buildLineside(scene, world.city, world);
  buildTrackside(scene, world.city, world);

  // overcast coastal light: a cool sky fill and a low warm key, so surfaces
  // separate by tone instead of by saturated colour
  const ambient = new THREE.HemisphereLight(0xc8d6dc, 0x4a4a38, 0.95);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffeed2, 1.15);
  sun.position.set(-1800, 900, -2200);
  scene.add(sun);
  const bounce = new THREE.DirectionalLight(0x8a94a0, 0.28);
  bounce.position.set(1400, 300, 1600);
  scene.add(bounce);

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
  // Compose every local matrix *before* freezing, otherwise objects positioned
  // with group transforms (stations, signals) keep an identity matrix and get
  // drawn in a heap at the world origin.
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!moving.has(o)) o.matrixAutoUpdate = false;
  });

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
