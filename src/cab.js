/**
 * Pseudo-3D cab view.
 *
 * A true pinhole projection: a point `z` metres ahead, `x` metres to the side
 * and `y` metres above rail level lands at
 *
 *     screenX = cx + x * f / z
 *     screenY = horizon - (y - EYE) * f / z
 *
 * so everything below the rail plane falls below the horizon, and the ground
 * rows can be inverted into distances to give texture that recedes correctly
 * without a single texture file.
 */

import { clamp, sample, TAU } from './geo.js';
import { TRAIN_COLORS } from './world.js';
import { KMH, stationDistance } from './sim.js';

const EYE = 2.7;            // driver's eye height above rail, metres
const HORIZON_FRAC = 0.46;  // horizon line as a fraction of canvas height
const GAUGE = 0.7175;       // half of 1.435 m standard gauge
const VIEW = 700;           // metres of world drawn

const PAL = {
  skyTop: '#6ea8cd',
  skyMid: '#b8d6e2',
  skyLow: '#f2e6c8',
  haze: '#f6ecd2',
  hillFar: '#a9bfa6',
  hillNear: '#93ad8c',
  ground: ['#9cb37f', '#8fa876', '#a8bd88', '#869f6f'],
  ballast: '#867f72',
  ballastTop: '#9d9484',
  sleeper: '#57534a',
  rail: '#4e4c45',
  railTop: '#d6d2c4',
  platform: '#ded4bf',
  platformSide: '#b9ad95',
  canopy: '#b15c42',
  post: '#5c655a',
  fence: '#8d8873',
  tree: ['#6d8a5c', '#7c9a67', '#5f7b51'],
};

const FIELDS = ['#93ab75', '#839c68', '#a2b782', '#7a9460', '#aabd8c', '#8ba072'];

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/* ------------------------------------------------------------------ */
/* track curve helper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Lateral offset (metres) of the track centreline `ahead` metres in front of the
 * train, relative to the direction the cab is facing. This is what bends the
 * whole scene on a curve.
 */
function makeCurve(world, train) {
  const path = world.paths[train.pathId];
  const here = sample(path, train.s);
  const nx = -Math.sin(here.angle);
  const ny = Math.cos(here.angle);
  return (ahead) => {
    const s = clamp(train.s + train.dir * ahead, 0, path.length);
    const there = sample(path, s);
    const lateral = (there.x - here.x) * nx + (there.y - here.y) * ny;
    return lateral * train.dir;
  };
}

/* ------------------------------------------------------------------ */
/* sky + distant scenery                                               */
/* ------------------------------------------------------------------ */

function drawSky(ctx, w, h, horizon, world) {
  const g = ctx.createLinearGradient(0, 0, 0, horizon + 4);
  g.addColorStop(0, PAL.skyTop);
  g.addColorStop(0.55, PAL.skyMid);
  g.addColorStop(1, PAL.skyLow);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon + 4);

  const sunX = w * 0.74;
  const sunY = horizon - h * 0.3;
  const haze = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, w * 0.45);
  haze.addColorStop(0, 'rgba(255,250,225,0.62)');
  haze.addColorStop(0.35, 'rgba(255,244,205,0.2)');
  haze.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, horizon + 4);

  const drift = (world.time * 6) % (w + 400);
  for (let i = 0; i < 6; i++) {
    const cx = ((i * 320 + drift) % (w + 400)) - 200;
    const cy = horizon - h * (0.22 + hash(i) * 0.18);
    const rx = 70 + hash(i * 3) * 60;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + hash(i * 7) * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, rx * 0.28, 0, 0, TAU);
    ctx.ellipse(cx + rx * 0.5, cy - rx * 0.1, rx * 0.6, rx * 0.22, 0, 0, TAU);
    ctx.fill();
  }
}

function drawHills(ctx, w, h, horizon, scroll) {

  // far ridge
  ctx.fillStyle = PAL.hillFar;
  ctx.beginPath();
  ctx.moveTo(0, horizon + 2);
  for (let x = 0; x <= w; x += 16) {
    const y = horizon - 30
      - Math.sin((x + scroll * 0.05) * 0.0042) * 20
      - Math.sin((x + 240 + scroll * 0.02) * 0.011) * 9;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, horizon + 2);
  ctx.closePath();
  ctx.fill();

  // near ridge
  ctx.fillStyle = PAL.hillNear;
  ctx.beginPath();
  ctx.moveTo(0, horizon + 2);
  for (let x = 0; x <= w; x += 16) {
    const y = horizon - 12
      - Math.sin((x + scroll * 0.12) * 0.0075) * 11
      - Math.sin((x + 90) * 0.019) * 5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, horizon + 2);
  ctx.closePath();
  ctx.fill();

  // distant town blocks
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 46; i++) {
    const x = ((i * 137 + scroll * 0.03) % (w + 200)) - 100;
    const bh = 6 + hash(i) * 26;
    const bw = 10 + hash(i * 3) * 26;
    ctx.fillStyle = i % 3 ? '#c3cdb6' : '#b3c0a8';
    ctx.fillRect(x, horizon - bh - 4, bw, bh);
  }
  ctx.globalAlpha = 1;

  // heat haze over the horizon line
  const hz = ctx.createLinearGradient(0, horizon - 8, 0, horizon + 10);
  hz.addColorStop(0, 'rgba(246,236,210,0.0)');
  hz.addColorStop(0.5, 'rgba(246,236,210,0.55)');
  hz.addColorStop(1, 'rgba(246,236,210,0)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, horizon - 8, w, 18);
}

/* ------------------------------------------------------------------ */
/* ground plane                                                        */
/* ------------------------------------------------------------------ */

function drawGround(ctx, w, h, horizon, f, scroll) {
  const bottom = h;
  if (bottom <= horizon + 1) return;

  // distance for each screen row, so fields recede correctly
  const step = 3;
  for (let y = Math.ceil(horizon) + 1; y < bottom; y += step) {
    const dy = Math.max(1, y - horizon);
    const z = (EYE * f) / dy;
    const worldZ = scroll + z;
    const idx = Math.floor(worldZ / 42);
    const shade = FIELDS[((idx % FIELDS.length) + FIELDS.length) % FIELDS.length];
    ctx.fillStyle = shade;
    ctx.fillRect(0, y, w, step + 1);

    // hedge lines between fields
    const edge = worldZ / 42 - idx;
    if (edge < 0.055) {
      ctx.fillStyle = 'rgba(105,124,84,0.55)';
      ctx.fillRect(0, y, w, Math.max(1, step * 0.7));
    }
  }

  // overall aerial perspective towards the horizon
  const fade = ctx.createLinearGradient(0, horizon, 0, horizon + h * 0.15);
  fade.addColorStop(0, 'rgba(236,230,205,0.34)');
  fade.addColorStop(1, 'rgba(236,230,205,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, horizon, w, h * 0.15);
}

/* ------------------------------------------------------------------ */
/* the permanent way                                                   */
/* ------------------------------------------------------------------ */

function projectTo(w, h, horizon, f, x, y, z) {
  const zz = Math.max(z, 0.35);
  return {
    x: w / 2 + (x * f) / zz,
    y: horizon - ((y - EYE) * f) / zz,
    s: f / zz,
  };
}

function stripSegment(ctx, w, h, horizon, f, curve, zFrom, zTo, xInner, xOuter, y, color) {
  const steps = Math.max(2, Math.ceil((zTo - zFrom) / 6));
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const z = zFrom + ((zTo - zFrom) * i) / steps;
    const p = projectTo(w, h, horizon, f, curve(z) + xInner, y, z);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  for (let i = steps; i >= 0; i--) {
    const z = zFrom + ((zTo - zFrom) * i) / steps;
    const p = projectTo(w, h, horizon, f, curve(z) + xOuter, y, z);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRailway(ctx, w, h, horizon, f, curve, scroll) {
  // ballast shoulder, then the running rails
  stripSegment(ctx, w, h, horizon, f, curve, 0.6, VIEW, -3.4, 3.4, -0.15, PAL.ballast);
  stripSegment(ctx, w, h, horizon, f, curve, 0.6, VIEW, -2.35, 2.35, 0, PAL.ballastTop);

  // ballast speckle: a scatter of stones, thinning with distance
  for (let i = 0; i < 260; i++) {
    const z = 2 + (hash(i * 1.7) * 120);
    const off = -3.2 + hash(i * 3.1) * 6.4;
    const p = projectTo(w, h, horizon, f, curve(z) + off, 0, z);
    if (p.s < 3) continue;
    const sz = clamp(p.s * 0.008, 0.5, 4);
    ctx.fillStyle = hash(i * 7.3) > 0.5 ? 'rgba(120,113,100,0.55)' : 'rgba(168,160,144,0.5)';
    ctx.fillRect(p.x, p.y, sz, sz * 0.7);
  }

  // sleepers: strong motion cue
  const spacing = 1.75;
  const phase = scroll % spacing;
  for (let i = 1; i < 90; i++) {
    const z = i * spacing - phase;
    if (z < 0.9 || z > 150) continue;
    const a = projectTo(w, h, horizon, f, curve(z) - 2.5, 0, z);
    const b = projectTo(w, h, horizon, f, curve(z) + 2.5, 0, z);
    ctx.strokeStyle = PAL.sleeper;
    ctx.lineWidth = clamp(a.s * 0.018, 0.5, 14);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // rails
  for (const side of [-1, 1]) {
    const inner = [];
    for (let i = 0; i <= 90; i++) {
      const z = 0.8 + Math.pow(i / 90, 1.9) * VIEW;
      inner.push(projectTo(w, h, horizon, f, curve(z) + side * GAUGE, 0.12, z));
    }
    ctx.beginPath();
    inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = PAL.rail;
    ctx.lineWidth = clamp(inner[0].s * 0.012, 1, 9);
    ctx.stroke();
    ctx.strokeStyle = PAL.railTop;
    ctx.lineWidth = clamp(inner[0].s * 0.004, 0.5, 3.5);
    ctx.stroke();
  }
}

function drawCatenary(ctx, w, h, horizon, f, curve, scroll) {
  const spacing = 48;
  const phase = scroll % spacing;

  for (let i = 1; i <= 15; i++) {
    const z = i * spacing - phase;
    if (z < 7) continue;
    const base = projectTo(w, h, horizon, f, curve(z) - 4.3, 0, z);
    const top = projectTo(w, h, horizon, f, curve(z) - 4.3, 8.3, z);
    const arm = projectTo(w, h, horizon, f, curve(z), 8.3, z);

    if (z < 320) {
      ctx.fillStyle = 'rgba(58,66,56,0.35)';
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, clamp(base.s * 0.5, 1, 40), clamp(base.s * 0.12, 0.6, 9), 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,80,74,0.9)';
      ctx.lineWidth = clamp(base.s * 0.22, 0.8, 26);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(arm.x, arm.y);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(70,80,74,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }

    // contact wire between masts
    const z2 = z + spacing;
    if (z2 < VIEW) {
      const a = projectTo(w, h, horizon, f, curve(z), 7.6, z);
      const b = projectTo(w, h, horizon, f, curve(z2), 7.6, z2);
      ctx.strokeStyle = 'rgba(58,68,64,0.5)';
      ctx.lineWidth = clamp(a.s * 0.012, 0.5, 3);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function drawTrackside(ctx, w, h, horizon, f, curve, world, train, scroll) {
  // telegraph poles and bushes blurring past on the right
  const spacing = 34;
  const phase = scroll % spacing;
  for (let i = 1; i < 26; i++) {
    const z = i * spacing - phase;
    if (z < 8) continue;
    const p = projectTo(w, h, horizon, f, curve(z) + 6.4, 0, z);
    const top = projectTo(w, h, horizon, f, curve(z) + 6.4, 6.2, z);
    ctx.strokeStyle = 'rgba(88,84,70,0.85)';
    ctx.lineWidth = clamp(p.s * 0.007, 0.5, 6);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    if (z < 200) {
      const armL = projectTo(w, h, horizon, f, curve(z) + 5.5, 6.2, z);
      const armR = projectTo(w, h, horizon, f, curve(z) + 7.3, 6.2, z);
      ctx.beginPath();
      ctx.moveTo(armL.x, armL.y);
      ctx.lineTo(armR.x, armR.y);
      ctx.stroke();
    }
  }

  // lineside trees
  for (let i = 0; i < 22; i++) {
    const z = 8 + ((i * 37 - scroll) % (VIEW * 0.8) + VIEW * 0.8) % (VIEW * 0.8);
    if (z < 6) continue;
    const side = i % 2 ? 1 : -1;
    const off = side * (9 + hash(i) * 12);
    const p = projectTo(w, h, horizon, f, curve(z) + off, 0, z);
    const height = 5 + hash(i * 3) * 5;
    const top = projectTo(w, h, horizon, f, curve(z) + off, height, z);
    const r = (top.s * height) / 6.5;
    const green = PAL.tree[i % PAL.tree.length];

    ctx.strokeStyle = 'rgba(74,62,46,0.9)';
    ctx.lineWidth = clamp(p.s * 0.02, 0.7, 12);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(top.x, top.y + r * 0.2);
    ctx.stroke();

    // three overlapping lobes read as foliage; one flat disc reads as a lollipop
    const lobes = [[-0.42, 0.16, 0.68], [0.4, 0.2, 0.6], [0, -0.1, 0.8]];
    for (const [dx, dy, k] of lobes) {
      ctx.fillStyle = green;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.ellipse(top.x + r * dx, top.y + r * dy, r * k, r * k * 0.92, dx * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(46,62,38,0.22)';
    ctx.beginPath();
    ctx.ellipse(top.x + r * 0.05, top.y + r * 0.55, r * 0.72, r * 0.34, 0, 0, TAU);
    ctx.fill();
  }

  // signals
  const sigs = world.signals[train.pathId]?.[train.dir > 0 ? 'plus' : 'minus'] || [];
  for (const sig of sigs) {
    const z = (sig.s - train.s) * train.dir;
    if (z < 3 || z > 420) continue;
    const base = projectTo(w, h, horizon, f, curve(z) - 4.9, 0, z);
    const head = projectTo(w, h, horizon, f, curve(z) - 4.9, 5.4, z);
    ctx.strokeStyle = '#4d554b';
    ctx.lineWidth = clamp(base.s * 0.008, 0.6, 5);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();

    const r = clamp(head.s * 0.28, 1.5, 16);
    ctx.fillStyle = '#242a26';
    rr(ctx, head.x - r * 0.8, head.y - r * 1.8, r * 1.6, r * 2.4, r * 0.3);
    ctx.fill();
    ctx.fillStyle = sig.red ? '#e8493a' : '#4fc46a';
    ctx.beginPath();
    ctx.arc(head.x, head.y - r * 1.1, r * 0.45, 0, TAU);
    ctx.fill();
    if (sig.red) {
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(head.x, head.y - r * 1.1, r * 1.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

function drawStation(ctx, w, h, horizon, f, curve, station, train, zAhead) {
  // The structure only exists where the station is: a distant platform is a
  // small band near the horizon, not a roof over the cab. It runs from just
  // before the stop board to ~230 m beyond it.
  const zNear = Math.max(2.4, zAhead - 25);
  // never draw a structure beyond the draw distance: at 1.5 km a platform quad
  // spans half the screen and paints over the whole landscape
  const zFar = Math.min(VIEW, zAhead + 230, 620);
  if (zFar <= zNear + 5) return;
  const fade = clamp(1.15 - zAhead / 620, 0.25, 1);
  const roofNear = Math.max(zNear, 7);
  const roofFar = Math.min(zFar, zNear + 130);
  const showRoof = zAhead > -24;

  const HEIGHT = 0.95;   // platform deck above rail
  const ROOF = 7.2;      // canopy underside above rail

  // a surface spanning track distance, at a fixed height (deck, roof, ...)
  const plane = (side, x1, x2, y, color, zA = zNear, zB = zFar) => {
    const steps = clamp(Math.ceil((zB - zA) / 8), 3, 40);
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const z = zA + ((zB - zA) * i) / steps;
      const p = projectTo(w, h, horizon, f, curve(z) + side * x2, y, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const z = zA + ((zB - zA) * i) / steps;
      const p = projectTo(w, h, horizon, f, curve(z) + side * x1, y, z);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // a vertical wall at a fixed offset from the centre line
  const wall = (side, x, yLow, yHigh, color, zA = zNear, zB = zFar) => {
    const steps = clamp(Math.ceil((zB - zA) / 8), 3, 40);
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const z = zA + ((zB - zA) * i) / steps;
      const p = projectTo(w, h, horizon, f, curve(z) + side * x, yHigh, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const z = zA + ((zB - zA) * i) / steps;
      const p = projectTo(w, h, horizon, f, curve(z) + side * x, yLow, z);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  for (const side of [-1, 1]) {
    ctx.globalAlpha = fade;

    // the deck: paving, a coping stone at the edge, and the vertical face that
    // makes it read as a platform rather than a painted apron
    plane(side, 2.75, 7.6, HEIGHT, PAL.platform);
    plane(side, 2.75, 3.25, HEIGHT + 0.01, '#e8c46a');
    plane(side, 2.75, 2.82, HEIGHT + 0.02, '#f2e6c2');
    wall(side, 2.78, 0.12, HEIGHT, 'rgba(120,112,98,0.95)');
    // a shadow on the ballast at the foot of the wall
    plane(side, 2.8, 3.5, 0.02, 'rgba(60,58,50,0.22)');

    // paving joints
    for (let z = zNear + 2; z < zFar; z += 3.2) {
      const a = projectTo(w, h, horizon, f, curve(z) + side * 3.4, HEIGHT, z);
      const b = projectTo(w, h, horizon, f, curve(z) + side * 7.4, HEIGHT, z);
      if (Math.abs(b.x - a.x) < 2) continue;
      ctx.strokeStyle = 'rgba(140,130,110,0.28)';
      ctx.lineWidth = clamp(a.s * 0.005, 0.4, 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // rear wall of the platform, which gives the deck a back edge
    wall(side, 7.6, HEIGHT, HEIGHT + 1.5, 'rgba(188,178,158,0.92)');
    wall(side, 7.6, HEIGHT + 1.5, HEIGHT + 1.62, 'rgba(146,136,118,0.92)');

    // canopy: a pale soffit with dark cross-ribs receding overhead, and a deep
    // red fascia hanging off the platform edge so the roof reads as a structure
    // rather than a coloured plane across the sky
    // the roof is seen from below, so only its underside is ever drawn: a top
    // face at this grazing angle simply paints over the soffit
    if (showRoof) plane(side, 3.05, 7.6, ROOF, 'rgba(226,220,205,0.97)', roofNear, roofFar);
    for (let z = roofNear + 2; showRoof && z < roofFar; z += 6.5) {
      const a = projectTo(w, h, horizon, f, curve(z) + side * 3.1, ROOF, z);
      const b = projectTo(w, h, horizon, f, curve(z) + side * 7.5, ROOF, z);
      if (Math.abs(b.x - a.x) < 2) continue;
      ctx.strokeStyle = 'rgba(146,134,116,0.55)';
      ctx.lineWidth = clamp(a.s * 0.014, 0.5, 6);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // a real canopy has a thin fascia lip, not a deep valance: anything thicker
    // sweeps across the whole windscreen from this seat height
    if (showRoof) wall(side, 3.08, ROOF - 0.3, ROOF, 'rgba(148,54,42,0.97)', roofNear, roofFar);
    if (showRoof) wall(side, 3.08, ROOF - 0.38, ROOF - 0.3, 'rgba(210,104,78,0.97)', roofNear, roofFar);
    if (showRoof) wall(side, 7.58, ROOF - 0.22, ROOF + 0.12, 'rgba(128,52,40,0.97)', roofNear, roofFar);

    // station building behind the platform
    const bldA = zNear + 26;
    const bldB = Math.min(zFar, zNear + 108);
    if (bldB > bldA + 8) {
      wall(side, 8.4, 0, 4.6, 'rgba(196,166,136,0.95)', bldA, bldB);
      plane(side, 8.4, 14.5, 4.6, 'rgba(150,104,86,0.95)', bldA, bldB);
      wall(side, 14.5, 0, 4.6, 'rgba(160,132,106,0.9)', bldA, bldB);
      // windows and a blind arcade along the front
      for (let z = bldA + 6; z < bldB - 4; z += 7) {
        const a = projectTo(w, h, horizon, f, curve(z) + side * 8.42, 1.5, z);
        const b = projectTo(w, h, horizon, f, curve(z) + side * 8.42, 3.5, z);
        const c = projectTo(w, h, horizon, f, curve(z + 2.6) + side * 8.42, 1.5, z + 2.6);
        if (Math.abs(c.x - a.x) < 1.6) continue;
        ctx.fillStyle = 'rgba(72,86,92,0.75)';
        ctx.fillRect(Math.min(a.x, c.x), Math.min(a.y, b.y), Math.abs(c.x - a.x), Math.abs(b.y - a.y));
      }
    }

    // platform furniture: benches against the back wall
    for (let z = roofNear + 6; z < Math.min(zFar, roofNear + 90); z += 12) {
      const a = projectTo(w, h, horizon, f, curve(z) + side * 6.6, HEIGHT, z);
      const b = projectTo(w, h, horizon, f, curve(z) + side * 7.5, HEIGHT, z);
      if (Math.abs(b.x - a.x) < 3) continue;
      ctx.fillStyle = 'rgba(96,74,58,0.85)';
      ctx.fillRect(Math.min(a.x, b.x), a.y - clamp(a.s * 0.05, 1, 6), Math.abs(b.x - a.x), clamp(a.s * 0.05, 1, 6));
    }

    // canopy columns
    for (let z = roofNear + 2; showRoof && z < roofFar - 6; z += 18) {
      wall(side, 6.95, HEIGHT, ROOF - 0.4, 'rgba(104,98,86,0.9)', z, z + 0.55);
    }

    // lamps under the canopy
    for (let z = roofNear + 6; showRoof && z < roofFar - 10; z += 18) {
      const p = projectTo(w, h, horizon, f, curve(z) + side * 5.6, ROOF - 0.8, z);
      if (p.s < 2) continue;
      ctx.fillStyle = 'rgba(255,232,164,0.85)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, clamp(p.s * 0.05, 1, 8), clamp(p.s * 0.02, 0.5, 3), 0, 0, TAU);
      ctx.fill();
    }

    // waiting passengers, only close enough to read
    const crowd = Math.min(14, Math.round(station.waiting / 9) + 3);
    for (let i = 0; i < crowd; i++) {
      const z = zNear + 12 + hash(i * 5.3 + side) * Math.min(150, zFar - zNear - 16);
      if (z < 14) continue;
      const p = projectTo(w, h, horizon, f, curve(z) + side * (4.6 + hash(i) * 2.4), HEIGHT, z);
      const sz = clamp(p.s * 0.1, 0.7, 14);
      if (sz < 1.2) continue;
      ctx.fillStyle = ['#c2543f', '#3f6fc2', '#4e9b6b', '#8d5bb8', '#c98b32', '#5d6b80'][i % 6];
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - sz * 0.55, sz * 0.3, sz * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e0aa82';
      ctx.beginPath();
      ctx.arc(p.x, p.y - sz * 1.28, sz * 0.27, 0, TAU);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

/** A clean floating station marker so the name is legible from a distance. */
function drawStationTag(ctx, w, h, horizon, f, curve, station, train) {
  const z = (station.s - train.s) * train.dir;
  if (z < 20 || z > 380) return;
  const p = projectTo(w, h, horizon, f, curve(z), 6.6, z);
  const fade = clamp(1 - (z - 20) / 360, 0.3, 1);
  ctx.globalAlpha = fade * 0.95;
  ctx.font = `800 ${clamp(26 - z * 0.028, 10, 18)}px ui-sans-serif, system-ui, sans-serif`;
  const label = station.name.toUpperCase();
  const tw = ctx.measureText(label).width;
  const pad = 10;
  const bh = 22;
  rr(ctx, p.x - tw / 2 - pad, p.y - bh, tw + pad * 2, bh, bh * 0.3);
  ctx.fillStyle = 'rgba(16,26,24,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,92,0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#ffcf5c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, p.x, p.y - bh / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // little pointer down to the platform
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - 5, p.y + 7);
  ctx.lineTo(p.x + 5, p.y + 7);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,207,92,0.7)';
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawOncoming(ctx, w, h, horizon, f, curve, world, train) {
  for (const other of world.trains) {
    if (other === train || other.pathId !== train.pathId || other.dir === train.dir) continue;
    const z = (other.s - train.s) * train.dir;
    if (z < -other.length - 10 || z > VIEW) continue;

    for (let i = other.coaches - 1; i >= 0; i--) {
      const zc = z - train.dir * (i * other.coachLen);
      if (zc < 1.2 || zc > VIEW) continue;
      const p = projectTo(w, h, horizon, f, curve(zc) - 1.9, 0, zc);
      const colors = TRAIN_COLORS[other.livery] || TRAIN_COLORS.local;
      const cw = clamp(p.s * (other.coachLen / 2) * 0.62, 1, 900);
      const ch = clamp(p.s * 1.9, 0.8, 700);
      if (cw < 1.2) continue;

      ctx.fillStyle = colors.body;
      rr(ctx, p.x - cw / 2, p.y - ch, cw, ch, Math.min(cw, ch) * 0.12);
      ctx.fill();
      ctx.fillStyle = colors.stripe;
      ctx.fillRect(p.x - cw / 2, p.y - ch * 0.62, cw, Math.max(0.6, ch * 0.07));
      if (zc < 160) {
        ctx.fillStyle = 'rgba(220,238,248,0.75)';
        const winW = cw / Math.max(2, Math.round(cw / 26));
        for (let k = 0; k < 6; k++) {
          ctx.fillRect(p.x - cw / 2 + (k + 0.3) * winW, p.y - ch * 0.82, winW * 0.45, ch * 0.2);
        }
        ctx.fillStyle = '#ffeaa7';
        ctx.beginPath();
        ctx.arc(p.x - cw * 0.18, p.y - ch * 0.3, Math.max(0.8, cw * 0.035), 0, TAU);
        ctx.arc(p.x + cw * 0.18, p.y - ch * 0.3, Math.max(0.8, cw * 0.035), 0, TAU);
        ctx.fill();
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* cab interior + dashboard                                            */
/* ------------------------------------------------------------------ */

function drawCabShell(ctx, w, h, dirt) {
  // windscreen grime and tint
  const glass = ctx.createLinearGradient(0, 0, 0, h);
  glass.addColorStop(0, `rgba(214,230,240,${0.10 + dirt * 0.10})`);
  glass.addColorStop(0.55, 'rgba(206,220,228,0.05)');
  glass.addColorStop(1, 'rgba(90,110,100,0.12)');
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, w, h);

  // soft vignette from the cab shell
  const vg = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.32, w / 2, h * 0.5, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(12,20,18,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // roof lining
  const roof = ctx.createLinearGradient(0, 0, 0, h * 0.1);
  roof.addColorStop(0, '#171d1c');
  roof.addColorStop(1, 'rgba(23,29,28,0)');
  ctx.fillStyle = roof;
  ctx.fillRect(0, 0, w, h * 0.1);

  // A-pillars
  const pw = Math.max(10, w * 0.012);
  ctx.fillStyle = 'rgba(20,26,25,0.92)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(pw, 0);
  ctx.lineTo(pw * 0.35, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(w - pw, 0);
  ctx.lineTo(w - pw * 0.35, h);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function dial(ctx, cx, cy, r, value, max, label, unit, accent, redZone = 0.82) {
  ctx.save();
  const face = ctx.createRadialGradient(cx, cy - r * 0.35, r * 0.15, cx, cy, r);
  face.addColorStop(0, '#2b3532');
  face.addColorStop(1, '#101716');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,236,228,0.3)';
  ctx.lineWidth = Math.max(1, r * 0.045);
  ctx.stroke();

  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = Math.PI * 0.75 + Math.PI * 1.5 * t;
    const major = i % 3 === 0;
    const inner = r * (major ? 0.72 : 0.82);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
    ctx.strokeStyle = t > redZone ? 'rgba(239,111,90,0.9)' : 'rgba(226,236,228,0.62)';
    ctx.lineWidth = Math.max(1, r * (major ? 0.036 : 0.018));
    ctx.stroke();
  }

  const t = clamp(value / max, 0, 1);
  const a = Math.PI * 0.75 + Math.PI * 1.5 * t;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * r * 0.14, cy - Math.sin(a) * r * 0.14);
  ctx.lineTo(cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.8, r * 0.06);
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.1, 0, TAU);
  ctx.fillStyle = accent;
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#eef3ec';
  ctx.font = `700 ${Math.round(r * 0.4)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(String(Math.round(value)), cx, cy + r * 0.46);
  ctx.fillStyle = 'rgba(226,236,228,0.6)';
  ctx.font = `600 ${Math.round(r * 0.16)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(unit, cx, cy + r * 0.68);
  ctx.fillStyle = 'rgba(226,236,228,0.45)';
  ctx.font = `700 ${Math.round(r * 0.15)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(label, cx, cy - r * 0.56);
  ctx.textAlign = 'left';
  ctx.restore();
}

function lever(ctx, x, y, w, h, value, label, color) {
  rr(ctx, x - 3, y - 3, w + 6, h + 6, (w + 6) * 0.3);
  ctx.fillStyle = 'rgba(8,13,12,0.85)';
  ctx.fill();

  const travel = h - w * 0.9;
  const knobY = y + travel * (1 - clamp(value, 0, 1));

  ctx.strokeStyle = 'rgba(226,236,228,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + w * 0.35);
  ctx.lineTo(x + w / 2, y + h - w * 0.35);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.3;
  rr(ctx, x + w * 0.18, knobY + w * 0.3, w * 0.64, y + h - knobY - w * 0.3, w * 0.3);
  ctx.fill();
  ctx.globalAlpha = 1;

  rr(ctx, x, knobY, w, w * 0.72, w * 0.22);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = 'rgba(230,240,232,0.78)';
  ctx.font = `800 ${Math.max(7, w * 0.3)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y - 8);
  ctx.textAlign = 'left';
}

function lamp(ctx, x, y, r, on, color) {
  if (on) {
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = on ? color : 'rgba(34,42,38,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,236,228,0.35)';
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function drawMirror(ctx, x, y, w, h, train) {
  rr(ctx, x, y, w, h, 7);
  ctx.fillStyle = '#0a1214';
  ctx.fill();

  ctx.save();
  rr(ctx, x + 2, y + 2, w - 4, h - 4, 5);
  ctx.clip();

  const horizon = y + h * 0.46;

  const sky = ctx.createLinearGradient(0, y, 0, horizon);
  sky.addColorStop(0, '#9dc2d6');
  sky.addColorStop(1, '#e2e7d4');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, horizon - y);

  ctx.fillStyle = '#7f976c';
  ctx.fillRect(x, horizon, w, y + h - horizon);

  // the line running away behind us
  ctx.strokeStyle = 'rgba(72,68,60,0.6)';
  ctx.lineWidth = Math.max(0.7, w * 0.01);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.16, y + h);
  ctx.lineTo(x + w * 0.47, horizon);
  ctx.moveTo(x + w * 0.84, y + h);
  ctx.lineTo(x + w * 0.53, horizon);
  ctx.stroke();

  // coaches receding, tallest nearest
  const count = Math.min(6, Math.max(1, train.coaches | 0));
  const colors = TRAIN_COLORS[train.livery] || TRAIN_COLORS.local;
  for (let i = 0; i < count; i++) {
    const k = i / count;
    const cw = w * (0.34 - k * 0.26);
    const ch = h * (0.34 - k * 0.26);
    if (cw < 2.2) break;
    const mx = x + w * 0.5 - cw / 2;
    const my = horizon - ch * 0.42 + k * h * 0.045;
    ctx.fillStyle = i === 0 ? colors.body : 'rgba(126,52,52,0.9)';
    rr(ctx, mx, my, cw, ch, Math.max(1, cw * 0.1));
    ctx.fill();
    if (i === 0) {
      ctx.fillStyle = colors.stripe;
      ctx.fillRect(mx, my + ch * 0.52, cw, Math.max(0.6, ch * 0.1));
      ctx.fillStyle = 'rgba(226,240,248,0.8)';
      ctx.fillRect(mx + cw * 0.3, my + ch * 0.16, cw * 0.4, Math.max(0.6, ch * 0.16));
      // tail lamps
      ctx.fillStyle = '#ff5f4a';
      ctx.beginPath();
      ctx.arc(mx + cw * 0.14, my + ch * 0.82, Math.max(1, cw * 0.05), 0, TAU);
      ctx.arc(mx + cw * 0.86, my + ch * 0.82, Math.max(1, cw * 0.05), 0, TAU);
      ctx.fill();
    }
  }

  ctx.fillStyle = 'rgba(184,206,216,0.13)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  ctx.strokeStyle = 'rgba(226,236,228,0.28)';
  ctx.lineWidth = 1.4;
  rr(ctx, x, y, w, h, 7);
  ctx.stroke();
}

/**
 * The whole cab view.
 * `hud` = { train, nextStation, signalRed, overspeed, speedLimit, horn, collisionT, dirt }
 */
export function drawCab(ctx, ui, world, hud) {
  const { width: w, height: h, dpr } = ui;
  const train = hud.train;
  const horizon = h * HORIZON_FRAC;
  const f = h * 1.12;   // ~35 mm: enough reach to read a station 200 m out

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const curve = makeCurve(world, train);

  // the view scrolls with the train's own odometer: this keeps sleepers, poles
  // and fields moving at exactly line speed
  const scroll = train.s;

  drawSky(ctx, w, h, horizon, world);
  drawHills(ctx, w, h, horizon, scroll);
  drawGround(ctx, w, h, horizon, f, scroll);

  // camera shake and roll from speed
  const speed01 = clamp(train.v / 26, 0, 1);
  const bob = Math.sin(world.time * 11) * speed01 * 1.1;
  const roll = Math.sin(world.time * 1.7) * speed01 * 0.0025;

  ctx.save();
  ctx.translate(w / 2, horizon + bob);
  ctx.rotate(roll);
  ctx.translate(-w / 2, -horizon);

  drawRailway(ctx, w, h, horizon, f, curve, scroll);
  drawCatenary(ctx, w, h, horizon, f, curve, scroll);
  drawTrackside(ctx, w, h, horizon, f, curve, world, train, scroll);

  if (hud.nextStation) {
    const z = (hud.nextStation.s - train.s) * train.dir;
    if (z > -140 && z < 620) drawStation(ctx, w, h, horizon, f, curve, hud.nextStation, train, z);
  }

  drawOncoming(ctx, w, h, horizon, f, curve, world, train);
  if (hud.nextStation) drawStationTag(ctx, w, h, horizon, f, curve, hud.nextStation, train);
  ctx.restore();

  drawCabShell(ctx, w, h, hud.dirt || 0);

  /* ------------------------------ dashboard ----------------------------- */
  const dashH = clamp(h * 0.21, 104, 190);
  const dashY = h - dashH;

  const dash = ctx.createLinearGradient(0, dashY, 0, h);
  dash.addColorStop(0, '#232b2d');
  dash.addColorStop(0.14, '#151c1d');
  dash.addColorStop(1, '#0a100f');
  ctx.fillStyle = dash;
  ctx.fillRect(0, dashY, w, dashH);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, dashY, w, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, dashY + 2, w, 4);

  const r = Math.min(dashH * 0.33, 54);
  const cx = w / 2;
  const cy = dashY + dashH * 0.47;

  dial(ctx, cx, cy, r, train.v * KMH, 120, 'SPEED', 'km/h', '#ffcf5c');

  const leverH = dashH * 0.44;
  const leverW = Math.max(15, dashH * 0.13);
  lever(ctx, cx - r * 3.5, dashY + dashH * 0.3, leverW, leverH, train.throttle, 'POWER', '#63c98a');
  lever(ctx, cx + r * 3.5 - leverW, dashY + dashH * 0.3, leverW, leverH, Math.min(1, train.braking), 'BRAKE', '#ef6f5a');

  // lamp column between dial and brake lever
  const dot = Math.max(4, dashH * 0.026);
  const colX = cx + r * 1.5;
  const colTop = dashY + dashH * 0.2;
  const rowH = dashH * 0.135;
  const lampDefs = [
    [train.state === 'dwell' && train.doors > 0.15, '#63c98a', 'DOOR'],
    [hud.signalRed, '#ef6f5a', 'SIGNAL'],
    [hud.overspeed, '#ef6f5a', 'LIMIT'],
    [hud.horn, '#ffcf5c', 'HORN'],
  ];
  lampDefs.forEach(([on, color, label], i) => {
    const yy = colTop + rowH * i + rowH * 0.4;
    lamp(ctx, colX, yy, dot, on, color);
    ctx.fillStyle = on ? 'rgba(238,243,236,0.9)' : 'rgba(226,236,228,0.42)';
    ctx.font = `700 ${Math.max(5.5, dashH * 0.033)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, colX + dot * 1.9, yy);
    ctx.textBaseline = 'alphabetic';
  });

  // next-stop strip
  const stripW = Math.min(w * 0.56, 600);
  const stripH = Math.max(22, dashH * 0.22);
  const stripX = (w - stripW) / 2;
  const stripY = dashY + dashH * 0.76;
  rr(ctx, stripX, stripY, stripW, stripH, 6);
  ctx.fillStyle = 'rgba(6,12,11,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,236,228,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (hud.nextStation) {
    const d = Math.abs(stationDistance(train, hud.nextStation));
    const prog = clamp(1 - d / 900, 0, 1);
    ctx.save();
    rr(ctx, stripX, stripY, stripW, stripH, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,207,92,0.18)';
    ctx.fillRect(stripX, stripY, stripW * prog, stripH);
    ctx.restore();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcf5c';
    ctx.font = `800 ${Math.max(9, stripH * 0.46)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(hud.nextStation.name.toUpperCase(), stripX + 10, stripY + stripH / 2 + 1);

    const txt = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#eef3ec';
    ctx.fillText(txt, stripX + stripW - 10, stripY + stripH / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // mirrors
  if (w > 560) {
    const mw = Math.min(w * 0.13, 190);
    const mh = dashH * 0.5;
    drawMirror(ctx, 18, dashY + dashH * 0.2, mw, mh, train);
    drawMirror(ctx, w - mw - 18, dashY + dashH * 0.2, mw, mh, train);
  }

  // speed limit roundel
  const limitR = clamp(Math.min(w, h) * 0.032, 15, 30);
  const rx = w - limitR - 26;
  const ry = h * 0.13;
  ctx.beginPath();
  ctx.arc(rx, ry, limitR, 0, TAU);
  ctx.fillStyle = hud.overspeed ? '#e0493c' : '#f7f2e0';
  ctx.fill();
  ctx.strokeStyle = '#c2352b';
  ctx.lineWidth = Math.max(2.5, limitR * 0.17);
  ctx.stroke();
  ctx.fillStyle = hud.overspeed ? '#fff' : '#1c2620';
  ctx.font = `800 ${Math.round(limitR * 0.74)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(hud.speedLimit), rx, ry + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (hud.collisionT > 0) {
    ctx.fillStyle = `rgba(224,73,60,${clamp(hud.collisionT, 0, 1) * 0.3})`;
    ctx.fillRect(0, 0, w, h);
  }
}
