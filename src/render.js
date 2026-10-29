/**
 * Canvas renderer: a baked terrain/track layer plus live trains, signals,
 * station labels, route highlight and the minimap.
 */

import { clamp, sample, TAU } from './geo.js';
import { WORLD, TRAIN_COLORS } from './world.js';
import { TUNING, playerTrain, trainPose } from './sim.js';

const LAYER_SCALE = 0.55;

export const PALETTE = {
  land: '#b7c69b',
  landDark: '#9fb183',
  field: ['#a9bd8a', '#c2cf9d', '#95ab7a', '#cfd6a4'],
  water: '#6da9c1',
  waterDeep: '#5d97b0',
  sand: '#e3d3a6',
  road: '#d9ccb0',
  urban: '#c6c0b2',
  urbanDark: '#b3ac9e',
  roof: '#a08d7a',
  ballast: '#8f8a7c',
  sleeper: '#6f6a5e',
  rail: '#5b584f',
  railTop: '#c4c1b4',
  platform: '#ded5c2',
  platformEdge: '#a89c86',
  canopy: '#b5654a',
  canopyAlt: '#e8dcc4',
  label: '#1d2733',
  labelBg: 'rgba(247,244,236,0.92)',
  water2: '#8fc0d2',
};

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Offset polyline for rails and platform edges. */
function offsetPolyline(path, lateral, step = 5) {
  const out = [];
  for (let s = 0; s <= path.length; s += step) {
    const p = sample(path, s);
    out.push({
      x: p.x - Math.sin(p.angle) * lateral,
      y: p.y + Math.cos(p.angle) * lateral,
    });
  }
  const end = sample(path, path.length);
  out.push({ x: end.x - Math.sin(end.angle) * lateral, y: end.y + Math.cos(end.angle) * lateral });
  return out;
}

function strokePolyline(ctx, pts, width, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawWater(ctx, rand) {
  // a bay in the north-west, kept clear of the running lines
  const bay = [
    { x: -200, y: -200 }, { x: 1500, y: -200 }, { x: 1290, y: 260 },
    { x: 1080, y: 640 }, { x: 930, y: 980 }, { x: 760, y: 1240 },
    { x: 420, y: 1360 }, { x: -200, y: 1200 },
  ];
  ctx.beginPath();
  ctx.moveTo(bay[0].x, bay[0].y);
  for (let i = 1; i < bay.length; i++) ctx.lineTo(bay[i].x, bay[i].y);
  ctx.closePath();
  ctx.fillStyle = PALETTE.water;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = i % 2 ? PALETTE.waterDeep : PALETTE.water2;
    ctx.lineWidth = 2 + rand() * 4;
    const y = -200 + rand() * 1500;
    const x = -200 + rand() * 1400;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 60, y + 10, x + 130, y - 4);
    ctx.stroke();
  }
  ctx.restore();

  // shoreline
  ctx.beginPath();
  ctx.moveTo(bay[1].x, bay[1].y);
  for (let i = 2; i < bay.length; i++) ctx.lineTo(bay[i].x, bay[i].y);
  ctx.strokeStyle = PALETTE.sand;
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = '#cbb98d';
  ctx.lineWidth = 3;
  ctx.stroke();

  // a river heading north-east across the top of the map
  const riverPts = [
    { x: 950, y: 1050 }, { x: 1350, y: 860 }, { x: 1800, y: 800 },
    { x: 2250, y: 640 }, { x: 2750, y: 560 }, { x: 3200, y: 400 },
    { x: 3700, y: 360 }, { x: 4300, y: 150 }, { x: 4900, y: 60 },
  ];
  strokePolyline(ctx, riverPts, 54, PALETTE.water, 1);
  strokePolyline(ctx, riverPts, 40, PALETTE.water2, 0.55);
  strokePolyline(ctx, riverPts, 10, '#bfe0ea', 0.35);
}

function drawTerrain(ctx, rand) {
  ctx.fillStyle = PALETTE.land;
  ctx.fillRect(-200, -200, WORLD.w + 400, WORLD.h + 400);

  // soft mottling
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.07;
    ctx.fillStyle = rand() > 0.5 ? PALETTE.landDark : '#c9d6ab';
    ctx.beginPath();
    ctx.ellipse(rand() * WORLD.w, rand() * WORLD.h, 60 + rand() * 220, 40 + rand() * 150, rand() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // fields
  for (let i = 0; i < 44; i++) {
    const w = 90 + rand() * 210;
    const h = 60 + rand() * 150;
    const x = rand() * WORLD.w;
    const y = 150 + rand() * (WORLD.h - 200);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rand() - 0.5) * 0.5);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = PALETTE.field[(rand() * PALETTE.field.length) | 0];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#7d9166';
    ctx.lineWidth = 1.5;
    for (let gx = -w / 2; gx < w / 2; gx += 13) {
      ctx.beginPath();
      ctx.moveTo(gx, -h / 2);
      ctx.lineTo(gx, h / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // parks and tree clusters
  for (let i = 0; i < 16; i++) {
    const x = rand() * WORLD.w;
    const y = rand() * WORLD.h;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#8fae74';
    ctx.beginPath();
    ctx.ellipse(x, y, 60 + rand() * 110, 45 + rand() * 80, rand() * TAU, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.6;
    for (let t = 0; t < 10; t++) {
      ctx.fillStyle = '#6f9159';
      ctx.beginPath();
      ctx.arc(x + (rand() - 0.5) * 160, y + (rand() - 0.5) * 120, 4 + rand() * 5, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawRoads(ctx, world, rand) {
  const majors = world.stations.filter((s) => s.major);
  ctx.lineCap = 'round';
  for (let i = 0; i < majors.length - 1; i++) {
    const a = majors[i];
    const b = majors[i + 1];
    const mx = (a.x + b.x) / 2 + (rand() - 0.5) * 180;
    const my = (a.y + b.y) / 2 + (rand() - 0.5) * 180;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.strokeStyle = PALETTE.road;
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.strokeStyle = '#c2b394';
    ctx.lineWidth = 6;
    ctx.setLineDash([10, 12]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

function drawUrban(ctx, world, rand) {
  for (const station of world.stations) {
    if (!station.major) continue;
    const count = 34;
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU;
      const r = 40 + rand() * 190;
      const x = station.x + Math.cos(a) * r;
      const y = station.y + Math.sin(a) * r;
      const w = 12 + rand() * 26;
      const h = 10 + rand() * 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rand() - 0.5) * 0.6);
      ctx.fillStyle = rand() > 0.65 ? PALETTE.urbanDark : PALETTE.urban;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = PALETTE.roof;
      ctx.fillRect(-w / 2, -h / 2, w, 3);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

function drawTrack(ctx, path) {
  const centre = offsetPolyline(path, 0, 6);
  strokePolyline(ctx, centre, 30, '#9c9584', 0.35);
  strokePolyline(ctx, centre, 24, PALETTE.ballast, 1);

  // sleepers
  ctx.strokeStyle = PALETTE.sleeper;
  ctx.lineWidth = 2.4;
  ctx.globalAlpha = 0.85;
  for (let s = 0; s < path.length; s += 13) {
    const p = sample(path, s);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    ctx.beginPath();
    ctx.moveTo(p.x - nx * 10, p.y - ny * 10);
    ctx.lineTo(p.x + nx * 10, p.y + ny * 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // two rails on each track
  for (const lat of [-4.6, 4.6]) {
    const pts = offsetPolyline(path, lat, 7);
    strokePolyline(ctx, pts, 2.4, PALETTE.rail, 1);
    strokePolyline(ctx, pts, 0.9, PALETTE.railTop, 0.9);
  }
}

function drawStation(ctx, station, world) {
  const path = world.paths[station.pathId];
  const len = station.major ? 190 : 150;
  const half = len / 2;
  const from = clamp(station.s - half, 4, path.length - 4);
  const to = clamp(station.s + half, 4, path.length - 4);

  for (const side of [-1, 1]) {
    // platform slab
    const pts = [];
    for (let s = from; s <= to; s += 6) {
      const p = sample(path, s);
      pts.push({ x: p.x - Math.sin(p.angle) * side * 26, y: p.y + Math.cos(p.angle) * side * 26 });
    }
    if (pts.length < 2) continue;

    const edge = [];
    const back = [];
    for (let i = 0; i < pts.length; i++) {
      const p = sample(path, from + (i / (pts.length - 1)) * (to - from));
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);
      edge.push({ x: p.x + nx * side * 17, y: p.y + ny * side * 17 });
      back.push({ x: p.x + nx * side * 36, y: p.y + ny * side * 36 });
    }

    const poly = [...edge, ...back.slice().reverse()];
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fillStyle = PALETTE.platform;
    ctx.fill();
    ctx.strokeStyle = PALETTE.platformEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // canopy stripes along the platform
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.clip();
    for (let s = from + 8; s < to; s += 26) {
      const p = sample(path, s);
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);
      ctx.strokeStyle = ((s / 26) | 0) % 2 ? PALETTE.canopy : PALETTE.canopyAlt;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * side * 20, p.y + ny * side * 20);
      ctx.lineTo(p.x + nx * side * 33, p.y + ny * side * 33);
      ctx.stroke();
    }
    ctx.restore();

    // station building on the major stops
    if (station.major) {
      const p = sample(path, station.s);
      const nx = -Math.sin(p.angle);
      const ny = Math.cos(p.angle);
      const bx = p.x + nx * side * 48;
      const by = p.y + ny * side * 48;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(p.angle);
      rr(ctx, -26, -13, 52, 26, 4);
      ctx.fillStyle = '#efe6d2';
      ctx.fill();
      ctx.strokeStyle = '#b9a98f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = PALETTE.canopy;
      ctx.fillRect(-26, -13, 52, 5);
      ctx.restore();
    }
  }
}

function drawStaticWorld(world) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(WORLD.w * LAYER_SCALE);
  canvas.height = Math.round(WORLD.h * LAYER_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(LAYER_SCALE, 0, 0, LAYER_SCALE, 0, 0);

  const rand = mulberry32(20261029);
  drawTerrain(ctx, rand);
  drawWater(ctx, rand);
  drawRoads(ctx, world, rand);
  drawUrban(ctx, world, rand);

  for (const path of Object.values(world.paths)) drawTrack(ctx, path);
  for (const station of world.stations) drawStation(ctx, station, world);

  return canvas;
}

/* ------------------------------------------------------------------ */
/* live frame                                                          */
/* ------------------------------------------------------------------ */

function visibleRect(cam, width, height) {
  const halfW = width / (2 * cam.zoom);
  const halfH = height / (2 * cam.zoom);
  return { x: cam.x - halfW, y: cam.y - halfH, w: halfW * 2, h: halfH * 2 };
}

function drawStaticRegion(ctx, layer, view) {
  const sx = clamp(view.x * LAYER_SCALE, 0, layer.width);
  const sy = clamp(view.y * LAYER_SCALE, 0, layer.height);
  const sw = clamp(view.w * LAYER_SCALE, 1, layer.width - sx);
  const sh = clamp(view.h * LAYER_SCALE, 1, layer.height - sy);
  if (sw <= 0 || sh <= 0) return;

  // destination rect must match the source crop after clamping
  const dx = sx / LAYER_SCALE;
  const dy = sy / LAYER_SCALE;
  const dw = sw / LAYER_SCALE;
  const dh = sh / LAYER_SCALE;
  ctx.drawImage(layer, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawRouteHighlight(ctx, world, train, zoom) {
  if (!train || train.route.length < 2) return;
  const path = world.paths[train.pathId];
  const from = Math.min(train.route[0].s, train.route[train.route.length - 1].s);
  const to = Math.max(train.route[0].s, train.route[train.route.length - 1].s);
  const pts = [];
  for (let s = from; s <= to; s += 12) pts.push(sample(path, s));
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#f6c453';
  ctx.lineWidth = 6 / zoom;
  ctx.setLineDash([16 / zoom, 14 / zoom]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawStationLabels(ctx, world, zoom) {
  if (zoom < 0.28) return;
  for (const station of world.stations) {
    if (!station.major && zoom < 0.55) continue;
    const size = clamp(13 / zoom, 8, 30);
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const label = station.name;
    const w = ctx.measureText(label).width;
    const padX = size * 0.55;
    const h = size * 1.7;

    const otherSide = station.major ? -1 : 1;
    const tx = station.x;
    const ty = station.y + otherSide * (44 + h * 0.2);

    ctx.globalAlpha = 0.94;
    rr(ctx, tx - w / 2 - padX, ty - h + size * 0.35, w + padX * 2, h, h * 0.35);
    ctx.fillStyle = station.major ? PALETTE.labelBg : 'rgba(247,244,236,0.78)';
    ctx.fill();
    ctx.strokeStyle = station.hub ? '#c08a3e' : 'rgba(60,70,60,0.25)';
    ctx.lineWidth = Math.max(1, 2 / zoom);
    ctx.stroke();

    ctx.fillStyle = PALETTE.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx, ty + size * 0.05);
    ctx.globalAlpha = 1;

    if (station.waiting > 1 && zoom > 0.5) {
      const count = `${Math.round(station.waiting)}`;
      ctx.font = `600 ${size * 0.8}px ui-sans-serif, system-ui, sans-serif`;
      const cw = ctx.measureText(count).width + size * 0.7;
      rr(ctx, tx + w / 2 + padX + 4, ty - h * 0.55, cw, h * 0.85, h * 0.3);
      ctx.fillStyle = '#3f5a46';
      ctx.fill();
      ctx.fillStyle = '#eef4e6';
      ctx.fillText(count, tx + w / 2 + padX + 4 + cw / 2, ty - h * 0.12);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawSignals(ctx, world, zoom) {
  if (zoom < 0.35) return;
  for (const [pathId, set] of Object.entries(world.signals)) {
    if (!Object.keys(world.signals).length) return;
    const path = world.paths[pathId];
    for (const dir of [1, -1]) {
      const list = dir > 0 ? set.plus : set.minus;
      for (const sig of list) {
        const p = sample(path, sig.s);
        const nx = -Math.sin(p.angle);
        const ny = Math.cos(p.angle);
        const px = p.x + nx * dir * 15;
        const py = p.y + ny * dir * 15;
        const r = 4.5 / Math.sqrt(zoom / 0.6);
        ctx.fillStyle = '#4a4f45';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = sig.red ? '#e0493c' : '#4fbf6a';
        ctx.beginPath();
        ctx.arc(px, py, r * 0.6, 0, TAU);
        ctx.fill();
        if (sig.red) {
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(px, py, r * 1.8, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}

function drawCoach(ctx, x, y, angle, len, livery, isLoco, doorsOpen, isPlayer) {
  const colors = TRAIN_COLORS[livery] || TRAIN_COLORS.local;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // shadow
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#1b2418';
  rr(ctx, -len / 2 + 2, -5, len, 13, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  // body
  rr(ctx, -len / 2, -7, len, 14, 3.5);
  ctx.fillStyle = isLoco ? colors.nose : colors.body;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,26,24,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // roof
  ctx.fillStyle = colors.roof;
  rr(ctx, -len / 2 + 1.5, -7, len - 3, 4, 2);
  ctx.fill();

  // stripe
  ctx.fillStyle = colors.stripe;
  ctx.fillRect(-len / 2 + 2, 0.4, len - 4, 1.6);

  // windows
  const windows = Math.max(2, Math.round(len / 6));
  const gap = (len - 6) / windows;
  ctx.fillStyle = '#cfe3ee';
  for (let i = 0; i < windows; i++) {
    const wx = -len / 2 + 3 + i * gap + gap * 0.18;
    ctx.fillRect(wx, -5.2, gap * 0.56, 3.2);
  }

  // doors
  if (doorsOpen) {
    ctx.fillStyle = 'rgba(255,236,180,0.95)';
    ctx.fillRect(-len / 2 + 2, -6.2, 2.4, 12.4);
    ctx.fillRect(len / 2 - 4.4, -6.2, 2.4, 12.4);
  }

  if (isLoco) {
    // headlight
    const grad = ctx.createLinearGradient(len / 2, 0, len / 2 + 26, 0);
    grad.addColorStop(0, 'rgba(255,244,200,0.55)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(len / 2 - 1, -4);
    ctx.lineTo(len / 2 + 26, -9);
    ctx.lineTo(len / 2 + 26, 9);
    ctx.lineTo(len / 2 - 1, 4);
    ctx.closePath();
    ctx.fill();

    if (isPlayer) {
      ctx.strokeStyle = '#ffcf5c';
      ctx.lineWidth = 1.4;
      rr(ctx, -len / 2 - 1, -8, len + 2, 16, 4.5);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawTrain(ctx, world, train, zoom) {
  const path = world.paths[train.pathId];
  const lateral = train.dir > 0 ? 4.6 : -4.6;
  const doorsOpen = train.state === 'dwell' && train.doors > 0.2;

  for (let i = train.coaches - 1; i >= 0; i--) {
    const s = train.s - train.dir * (i * train.coachLen);
    if (s < 0 || s > path.length) continue;
    const p = sample(path, s);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    drawCoach(
      ctx,
      p.x + nx * lateral,
      p.y + ny * lateral,
      p.angle,
      train.coachLen - 1.6,
      train.livery,
      i === 0,
      doorsOpen,
      world.playerId === train.id,
    );
  }

  // name plate when zoomed in
  if (zoom > 0.75) {
    const p = trainPose(world, train, train.length * 0.5);
    ctx.font = `600 ${9 / zoom}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(24,32,26,0.82)';
    ctx.fillText(train.name, p.x, p.y - 16 / zoom);
    ctx.textAlign = 'left';
  }
}

export function drawFrame(ctx, ui, world) {
  const { width, height, dpr, cam } = ui;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#8fb3a4';
  ctx.fillRect(0, 0, width, height);

  const view = visibleRect(cam, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawStaticRegion(ctx, ui.layer, view);

  const player = playerTrain(world);
  drawRouteHighlight(ctx, world, player, cam.zoom);
  drawSignals(ctx, world, cam.zoom);
  for (const train of world.trains) {
    if (train === player) continue;
    drawTrain(ctx, world, train, cam.zoom);
  }
  if (player) drawTrain(ctx, world, player, cam.zoom);

  drawStationLabels(ctx, world, cam.zoom);
  ctx.restore();

  drawMinimap(ctx, ui, world, view);
  drawScaleBar(ctx, ui, cam);
}

function drawScaleBar(ctx, ui, cam) {
  const lengths = [100, 250, 500, 1000, 2000];
  let chosen = lengths[0];
  for (const l of lengths) if (l * cam.zoom < 160) chosen = l;
  const px = chosen * cam.zoom;
  const x = 24;
  const y = ui.height - 26;
  ctx.strokeStyle = 'rgba(250,250,245,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4);
  ctx.lineTo(x + px, y + 4);
  ctx.stroke();
  ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(250,250,245,0.9)';
  ctx.fillText(`${chosen} m`, x, y - 8);
}

function drawMinimap(ctx, ui, world, view) {
  const w = Math.min(280, ui.width * 0.34);
  const h = (w * WORLD.h) / WORLD.w;
  const x = ui.width - w - 20;
  const y = ui.height - h - 20;
  const sx = w / WORLD.w;
  const sy = h / WORLD.h;

  ctx.save();
  rr(ctx, x - 8, y - 8, w + 16, h + 16, 12);
  ctx.fillStyle = 'rgba(16,26,24,0.62)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(240,240,230,0.28)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  rr(ctx, x, y, w, h, 7);
  ctx.clip();
  ctx.fillStyle = 'rgba(120,160,170,0.5)';
  ctx.fillRect(x, y, w, h);

  for (const path of Object.values(world.paths)) {
    ctx.beginPath();
    for (let s = 0; s <= path.length; s += 40) {
      const p = sample(path, s);
      const px = x + p.x * sx;
      const py = y + p.y * sy;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(250,246,232,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const station of world.stations) {
    ctx.fillStyle = station.major ? '#ffd479' : 'rgba(250,246,232,0.75)';
    ctx.beginPath();
    ctx.arc(x + station.x * sx, y + station.y * sy, station.major ? 2.6 : 1.6, 0, TAU);
    ctx.fill();
  }

  for (const train of world.trains) {
    const p = sample(world.paths[train.pathId], train.s);
    const px = x + p.x * sx;
    const py = y + p.y * sy;
    ctx.fillStyle = world.playerId === train.id ? '#ffcf5c' : '#ef6f5a';
    ctx.beginPath();
    ctx.arc(px, py, world.playerId === train.id ? 4 : 2.6, 0, TAU);
    ctx.fill();
    if (world.playerId === train.id) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // viewport
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + view.x * sx, y + view.y * sy, view.w * sx, view.h * sy);
  ctx.restore();

  ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(240,240,230,0.7)';
  ctx.fillText('NETWORK', x, y - 14);
  ctx.restore?.();
}

export function buildLayer(world) {
  return drawStaticWorld(world);
}
