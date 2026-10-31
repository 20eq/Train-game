'use strict';
/* ============================================================
   Bharat Rail Sim — rolling stock renderer & particles
   ============================================================ */
const LIVERY = {
  wr_violet: { body: '#e9e2d2', band: '#5c3a8e', roof: '#8a8d92', door: '#5c3a8e', front: '#f2c518' },
  cr_crimson: { body: '#8c2438', band: '#e8ddc0', roof: '#7a7d82', door: '#5e1a2a', front: '#f2c518' },
  ch_green: { body: '#e9e2d2', band: '#1d6b4a', roof: '#8a8d92', door: '#155740', front: '#f2c518' },
  kol_blue: { body: '#e9e2d2', band: '#2a4d9b', roof: '#8a8d92', door: '#223f80', front: '#f2c518' },
  memu: { body: '#e9e2d2', band: '#3a5fa8', roof: '#8a8d92', door: '#31518f', front: '#f2c518' },
  dmu: { body: '#e9e2d2', band: '#3a5fa8', roof: '#8a8d92', door: '#31518f', front: '#f2c518' },
  wdp4d: { body: '#d84b27', band: '#f5e9d8', roof: '#4a4d52', front: '#f2c518' },
  wdg4: { body: '#3a6ec2', band: '#f2c518', roof: '#4a4d52', front: '#f2c518' },
  wap7: { body: '#e8e6e0', band: '#c23b2e', roof: '#5a5d62', front: '#f2c518' },
  lhb: { body: '#41598f', band: '#dfe3e8', roof: '#7a7d82', door: '#35497a', front: '#f2c518' },
  icf: { body: '#7c2436', band: '#e8ddc0', roof: '#6a6d72', door: '#5e1a2a', front: '#f2c518' },
  vb: { body: '#eceef2', band: '#1e3a8a', roof: '#8a8d92', door: '#1e3a8a', front: '#1e3a8a' },
  nmr: { body: '#2b3d8f', band: '#e8c34a', roof: '#3a3430', door: '#22306e', front: '#e8c34a' },
  boxn: { body: '#8a6a4e', band: '#6a4e38', roof: '#5a4a3a', door: '#6a4e38', front: '#6a4e38' },
};
const CAR_H = { dtc: 3.66, mc: 3.66, tc: 3.66, 'memu-m': 3.8, 'memu-m2': 3.8, 'dmu-p': 3.8, 'loco-e': 4.2, 'loco-d': 4.3, wdg4: 4.4, steam: 3.8, tender: 3.0, ac1: 4.0, ac2: 4.0, ac3: 4.0, sl: 4.0, gs: 4.0, pc: 4.0, dq: 3.9, vb: 3.9, rack: 3.4, boxn: 3.4 };

function drawTrainFull(v, t, opts) {
  const { ctx } = v;
  const px = v.px, vs = v.vs;
  const far = opts && opts.far;
  const scale = far ? 0.92 : 1;
  const nl = v.nightF;
  const dir = t.dir;
  const gyBase = v.groundY(t.s);
  // iterate cars from rear to front
  const cars = t.def.cars;
  let pos = t.s;
  const order = [];
  let acc = 0;
  for (let i = 0; i < cars.length; i++) { order.push({ i, km: t.s - acc * dir }); acc += cars[i].len + 0.7; }
  if (dir < 0) order.reverse();
  for (const o of order) {
    const c = cars[o.i];
    const xC = v.xOf(o.km - (c.len / 2) * dir);
    const wPx = c.len * px * scale;
    const h = (CAR_H[c.k] || 3.8) * vs * scale;
    const gy = gyBase - 8 * scale; // rail top
    const bodyY = gy - h;
    const liv = LIVERY[c.livery] || LIVERY.lhb;
    const dark = 0.06 + nl * 0.3 + (far ? 0.14 : 0);
    // shadow
    if (!far) { ctx.fillStyle = 'rgba(20,16,10,0.3)'; ctx.fillRect(xC - wPx / 2 + 2, gy - 2, wPx, 5); }
    // bogies
    drawBogie(v, xC - wPx * 0.28, gy, t, c, scale, dark);
    drawBogie(v, xC + wPx * 0.28, gy, t, c, scale, dark);
    drawCarBody(v, c, xC, bodyY, wPx, h, liv, dark, nl, t, o.i, scale);
  }
  // head light glow & destination (front car)
  const headCar = dir > 0 ? cars[0] : cars[cars.length - 1];
  const headX = v.xOf(t.s + (dir > 0 ? 0.4 : -0.4) * 1);
  // particles emitted in world space (added by game)
}

function drawBogie(v, x, gy, t, c, scale, dark) {
  const { ctx } = v;
  const wr = 0.55 * v.vs * scale;
  ctx.fillStyle = mixHex('#2c2c30', '#000', dark);
  ctx.fillRect(x - 3.4 * v.vs * scale, gy - wr - 1.1 * v.vs * scale, 6.8 * v.vs * scale, 1.1 * v.vs * scale + 2);
  for (const off of [-1.6, 1.6]) {
    const wx = x + off * v.vs * scale;
    ctx.fillStyle = mixHex('#3a3a40', '#000', dark);
    ctx.beginPath(); ctx.arc(wx, gy - wr, wr, 0, 7); ctx.fill();
    const rot = t.wheelDist / (0.55);
    ctx.strokeStyle = mixHex('#888', '#000', dark); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(rot) * wr * 0.8, gy - wr + Math.sin(rot) * wr * 0.8);
    ctx.lineTo(wx - Math.cos(rot) * wr * 0.8, gy - wr - Math.sin(rot) * wr * 0.8);
    ctx.stroke();
  }
}

function drawCarBody(v, c, xC, y, w, h, liv, dark, nl, t, idx, scale) {
  const { ctx } = v;
  const body = mixHex(liv.body, '#0c1220', dark);
  ctx.fillStyle = body;
  const r = Math.min(4, w * 0.06);
  roundRect(ctx, xC - w / 2, y, w, h, r); ctx.fill();
  // roof
  ctx.fillStyle = mixHex(liv.roof, '#0c1220', dark);
  roundRect(ctx, xC - w / 2, y, w, h * 0.14, r); ctx.fill();
  // livery band
  ctx.fillStyle = mixHex(liv.band, '#0c1220', dark * 0.6);
  ctx.fillRect(xC - w / 2, y + h * 0.62, w, h * 0.13);

  const kind = c.k;
  const cab = kind === 'dtc' || kind === 'vb' && (idx === 0 || idx === t.def.cars.length - 1) || (kind === 'dmu-p' && c.cab) || kind === 'steam';
  const isCoach = ['ac1', 'ac2', 'ac3', 'sl', 'gs', 'pc', 'dq', 'rack'].includes(kind);

  if (kind === 'steam') { drawSteamLoco(v, c, xC, y, w, h, liv, dark, t, scale); return; }
  if (kind === 'tender') { drawTender(v, xC, y, w, h, liv, dark, t, scale); return; }
  if (kind === 'loco-e') { drawWAP7(v, xC, y, w, h, liv, dark, nl, t, scale); return; }
  if (kind === 'loco-d') { drawWDP4D(v, xC, y, w, h, liv, dark, nl, t, scale, 1); return; }
  if (kind === 'wdg4') { drawWDP4D(v, xC, y, w, h, liv, dark, nl, t, scale, -1); return; }
  if (kind === 'boxn') { drawBoxn(v, xC, y, w, h, liv, dark, t, scale); return; }

  // ---- generic body with windows/doors ----
  const frontDir = idx === 0 ? 1 : idx === t.def.cars.length - 1 ? -1 : 0;
  // windows
  const winY = y + h * 0.24, winH = h * 0.26;
  const crowd = clamp(t.passengers / 60, 0, 1);
  const lit = nl > 0.25;
  if (isCoach) {
    const nWin = Math.max(4, Math.floor(w / 9));
    for (let i = 0; i < nWin; i++) {
      const wx = xC - w / 2 + (i + 0.5) * (w / nWin);
      const skip = (kind === 'ac1' || kind === 'ac2' || kind === 'ac3' || kind === 'pc') ? i % 3 === 2 : false;
      if (skip) continue;
      const litW = lit && ((i * 7 + idx * 13) % 5 < 3 || crowd > 0.5);
      ctx.fillStyle = litW ? `rgba(255,222,150,${0.55 + crowd * 0.4})` : mixHex('#20303c', '#0c1220', dark);
      ctx.fillRect(wx - (w / nWin) * 0.32, winY, (w / nWin) * 0.64, winH);
      if (crowd > 0.25 && !litW === false) { // passenger silhouettes
        ctx.fillStyle = `rgba(40,30,20,${0.25 + crowd * 0.3})`;
        ctx.fillRect(wx - (w / nWin) * 0.22, winY + winH * 0.35, (w / nWin) * 0.44, winH * 0.65);
      }
    }
  } else {
    // EMU/DMU windows
    const nWin = Math.max(3, Math.floor(w / 11));
    for (let i = 0; i < nWin; i++) {
      const wx = xC - w / 2 + (i + 0.5) * (w / nWin);
      if (Math.abs((i + 0.5) / nWin - 0.22) < 0.09 || Math.abs((i + 0.5) / nWin - 0.78) < 0.09) continue; // door gaps
      const litW = lit && ((i * 5 + idx * 11) % 4 < 2 || crowd > 0.5);
      ctx.fillStyle = litW ? `rgba(255,222,150,${0.55 + crowd * 0.4})` : mixHex('#20303c', '#0c1220', dark);
      ctx.fillRect(wx - (w / nWin) * 0.3, winY, (w / nWin) * 0.6, winH);
    }
    // doors
    const doorOpen = t.doorState === 'open' ? 1 : t.doorState === 'closing' ? clamp(t.doorAnim || 0, 0, 1) : 0;
    for (const dp of [0.22, 0.78]) {
      const dx = xC - w / 2 + dp * w;
      ctx.fillStyle = mixHex(liv.door, '#0c1220', dark * 0.7);
      const dw = w * 0.075;
      const gap = doorOpen * dw * 0.9;
      ctx.fillRect(dx - dw - gap, y + h * 0.16, dw, h * 0.72);
      ctx.fillRect(dx + gap, y + h * 0.16, dw, h * 0.72);
    }
  }
  // cab windscreen for driving ends
  if (cab) {
    const fx = frontDir === 1 ? xC + w * 0.34 : xC - w * 0.34;
    ctx.fillStyle = mixHex('#18242e', '#0c1220', dark);
    ctx.fillRect(fx - w * 0.1, y + h * 0.2, w * 0.2, h * 0.34);
    // destination box
    ctx.fillStyle = '#111';
    ctx.fillRect(fx - w * 0.09, y + h * 0.58, w * 0.18, h * 0.14);
    if (t.destText && scale === 1) {
      ctx.fillStyle = '#ffdf4a';
      ctx.font = `bold ${Math.max(4.5, h * 0.11)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t.destText, fx, y + h * 0.68, w * 0.16);
    }
  }
  // pantograph
  if (c.panto && t.panto) {
    const pxr = xC + w * 0.1;
    ctx.strokeStyle = mixHex('#555', '#0c1220', dark); ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pxr - w * 0.05, y + 1);
    ctx.lineTo(pxr, y - h * 0.42);
    ctx.lineTo(pxr + w * 0.05, y + 1);
    ctx.moveTo(pxr - w * 0.06, y - h * 0.42);
    ctx.lineTo(pxr + w * 0.06, y - h * 0.42);
    ctx.stroke();
  }
  // number plate
  if (scale === 1 && w > 34) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${Math.max(4, h * 0.09)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String((idx + 1) * 2).padStart(4, '0'), xC, y + h * 0.95);
  }
}

function drawWAP7(v, xC, y, w, h, liv, dark, nl, t, scale) {
  const { ctx } = v;
  ctx.fillStyle = mixHex(liv.body, '#0c1220', dark);
  roundRect(ctx, xC - w / 2, y, w, h, 2.5); ctx.fill();
  // red stripe
  ctx.fillStyle = mixHex(liv.band, '#0c1220', dark * 0.6);
  ctx.fillRect(xC - w / 2, y + h * 0.55, w, h * 0.16);
  ctx.fillRect(xC - w / 2, y + h * 0.1, w, h * 0.06);
  // roof gear
  ctx.fillStyle = mixHex(liv.roof, '#0c1220', dark);
  ctx.fillRect(xC - w * 0.3, y - h * 0.1, w * 0.6, h * 0.12);
  // windscreen + face
  const dirSign = t.dir > 0 ? 1 : -1;
  const fx = xC + dirSign * w * 0.5;
  ctx.fillStyle = mixHex('#18242e', '#000', dark);
  ctx.fillRect(fx - dirSign * w * 0.16, y + h * 0.18, dirSign * w * 0.15, h * 0.4);
  // WAP-7 text
  if (scale === 1 && w > 30) {
    ctx.fillStyle = mixHex('#c23b2e', '#0c1220', dark * 0.5);
    ctx.font = `bold ${h * 0.16}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('WAP-7', xC - dirSign * w * 0.1, y + h * 0.42);
  }
  if (t.panto) {
    const pxr = xC - dirSign * w * 0.2;
    ctx.strokeStyle = mixHex('#555', '#0c1220', dark); ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pxr - w * 0.06, y - h * 0.04); ctx.lineTo(pxr, y - h * 0.5); ctx.lineTo(pxr + w * 0.06, y - h * 0.04);
    ctx.moveTo(pxr - w * 0.07, y - h * 0.5); ctx.lineTo(pxr + w * 0.07, y - h * 0.5);
    ctx.stroke();
  }
}
function drawWDP4D(v, xC, y, w, h, liv, dark, nl, t, scale, noseDir) {
  const { ctx } = v;
  const dirSign = (t.dir > 0 ? 1 : -1) * noseDir;
  ctx.fillStyle = mixHex(liv.body, '#0c1220', dark);
  ctx.beginPath();
  ctx.moveTo(xC - dirSign * w / 2, y);
  ctx.lineTo(xC - dirSign * w / 2, y + h);
  ctx.lineTo(xC + dirSign * w / 2, y + h);
  ctx.lineTo(xC + dirSign * w / 2, y + h * 0.55);
  ctx.quadraticCurveTo(xC + dirSign * w * 0.4, y + h * 0.5, xC + dirSign * w * 0.3, y + h * 0.28);
  ctx.quadraticCurveTo(xC + dirSign * w * 0.22, y, xC + dirSign * w * 0.05, y);
  ctx.closePath(); ctx.fill();
  // windscreen
  ctx.fillStyle = mixHex('#18242e', '#000', dark);
  ctx.beginPath();
  ctx.moveTo(xC + dirSign * w * 0.28, y + h * 0.32);
  ctx.lineTo(xC + dirSign * w * 0.42, y + h * 0.52);
  ctx.lineTo(xC + dirSign * w * 0.2, y + h * 0.52);
  ctx.lineTo(xC + dirSign * w * 0.2, y + h * 0.32);
  ctx.closePath(); ctx.fill();
  // side stripe
  ctx.fillStyle = mixHex(liv.band, '#0c1220', dark * 0.5);
  ctx.fillRect(xC - dirSign * w * 0.48, y + h * 0.62, dirSign * w * 0.9, h * 0.1);
  // grilles
  ctx.fillStyle = 'rgba(30,30,34,0.7)';
  for (let i = 0; i < 5; i++) ctx.fillRect(xC - dirSign * (w * 0.12 + i * w * 0.07), y + h * 0.16, dirSign * w * 0.04, h * 0.3);
  if (scale === 1 && w > 30) {
    ctx.fillStyle = '#f2c518'; ctx.font = `bold ${h * 0.14}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(noseDir > 0 ? 'WDP-4D' : 'WDG-4', xC - dirSign * w * 0.15, y + h * 0.42);
  }
}
function drawSteamLoco(v, c, xC, y, w, h, liv, dark, t, scale) {
  const { ctx } = v;
  const dirSign = t.dir > 0 ? 1 : -1;
  const nose = xC + dirSign * w / 2;
  // boiler
  ctx.fillStyle = mixHex('#1e2a4a', '#000', dark);
  ctx.beginPath();
  ctx.ellipse(xC + dirSign * w * 0.05, y + h * 0.42, w * 0.48, h * 0.42, 0, 0, 7);
  ctx.fill();
  // smokebox front
  ctx.fillStyle = mixHex('#101820', '#000', dark + 0.1);
  ctx.beginPath(); ctx.ellipse(nose - dirSign * w * 0.04, y + h * 0.42, w * 0.1, h * 0.42, 0, 0, 7); ctx.fill();
  // chimney
  ctx.fillStyle = mixHex('#0e1622', '#000', dark);
  ctx.fillRect(nose - dirSign * w * 0.22 - 2, y - h * 0.18, 4.5 * scale, h * 0.24);
  // dome & whistle
  ctx.fillStyle = mixHex('#e8c34a', '#000', dark);
  ctx.beginPath(); ctx.ellipse(xC + dirSign * w * 0.12, y + h * 0.08, w * 0.06, h * 0.1, 0, 0, 7); ctx.fill();
  // cab
  ctx.fillStyle = mixHex(liv.body, '#000', dark);
  ctx.fillRect(xC - dirSign * w * 0.5, y - h * 0.05, dirSign * w * 0.22, h * 0.62);
  ctx.fillStyle = mixHex('#18242e', '#000', dark);
  ctx.fillRect(xC - dirSign * w * 0.47, y + h * 0.12, dirSign * w * 0.14, h * 0.2);
  // yellow lining
  ctx.strokeStyle = mixHex(liv.band, '#000', dark); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(xC - dirSign * w * 0.5, y + h * 0.55); ctx.lineTo(nose - dirSign * w * 0.1, y + h * 0.55); ctx.stroke();
  // X class numbering
  if (scale === 1 && w > 24) {
    ctx.fillStyle = liv.band; ctx.font = `bold ${h * 0.16}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('X 37385', xC - dirSign * w * 0.16, y + h * 0.78);
  }
  // big drivers + rods
  const gy = y + h + 8 * 0;
  for (const off of [0.3, -0.3]) {
    const wx = xC + off * w;
    const wr = 0.75 * v.vs * scale;
    ctx.fillStyle = '#22201c';
    ctx.beginPath(); ctx.arc(wx, gy - wr, wr, 0, 7); ctx.fill();
    ctx.strokeStyle = '#b8b2a4'; ctx.lineWidth = 1.4;
    const rot = t.wheelDist / 0.75;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(rot) * wr * 0.85, gy - wr + Math.sin(rot) * wr * 0.85);
    ctx.lineTo(wx - Math.cos(rot) * wr * 0.85, gy - wr - Math.sin(rot) * wr * 0.85);
    ctx.stroke();
    // crank
    ctx.fillStyle = '#d8d2c4';
    ctx.beginPath(); ctx.arc(wx + Math.cos(rot) * wr * 0.6, gy - wr + Math.sin(rot) * wr * 0.6, 1.8, 0, 7); ctx.fill();
  }
  // connecting rod
  const w1 = xC + 0.3 * w, w2 = xC - 0.3 * w, wr = 0.75 * v.vs * scale, rot = t.wheelDist / 0.75;
  const cy = gy - wr + Math.sin(rot) * wr * 0.6;
  ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w1 + Math.cos(rot) * wr * 0.6, cy);
  ctx.lineTo(w2 + Math.cos(rot) * wr * 0.6, cy);
  ctx.stroke();
  // rack gear
  if (v.route.rack) {
    ctx.fillStyle = '#c8b24a';
    ctx.beginPath(); ctx.arc(xC, gy - 0.5 * v.vs * scale, 0.42 * v.vs * scale, 0, 7); ctx.fill();
  }
}
function drawTender(v, xC, y, w, h, liv, dark, t, scale) {
  const { ctx } = v;
  ctx.fillStyle = mixHex(liv.body, '#000', dark);
  roundRect(ctx, xC - w / 2, y + h * 0.15, w, h * 0.85, 2); ctx.fill();
  ctx.fillStyle = mixHex(liv.band, '#000', dark);
  ctx.fillRect(xC - w / 2, y + h * 0.5, w, h * 0.14);
  if (scale === 1) {
    ctx.fillStyle = liv.band; ctx.font = `bold ${h * 0.2}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('N M R', xC, y + h * 0.68);
  }
}
function drawBoxn(v, xC, y, w, h, liv, dark, t, scale) {
  const { ctx } = v;
  ctx.fillStyle = mixHex(liv.body, '#000', dark);
  ctx.beginPath();
  ctx.moveTo(xC - w / 2, y);
  ctx.lineTo(xC + w / 2, y);
  ctx.lineTo(xC + w / 2, y + h * 0.45);
  ctx.lineTo(xC + w * 0.3, y + h);
  ctx.lineTo(xC - w * 0.3, y + h);
  ctx.lineTo(xC - w / 2, y + h * 0.45);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(40,30,20,0.5)';
  ctx.fillRect(xC - w * 0.44, y, w * 0.88, h * 0.3);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- particles: steam & diesel exhaust ---------- */
class Particles {
  constructor(max) { this.list = []; this.max = max || 300; }
  /* m = world position (m), dy = height above ground (px), kind, strength 0..1 */
  emit(m, dy, kind, strength) {
    if (this.list.length >= this.max) return;
    this.list.push({
      m, dy, kind, age: 0,
      vx: -0.6 - Math.random() * 1.4,
      vy: -(16 + Math.random() * 22) * (0.5 + strength),
      size: 1.6 + Math.random() * 2, life: kind === 'steam' ? 2.6 : 1.5,
    });
  }
  update(dt) {
    for (const p of this.list) { p.age += dt; p.m += p.vx * dt * 14; p.dy += p.vy * dt; p.vy *= 0.995; p.size += dt * 3.4; }
    this.list = this.list.filter((p) => p.age < p.life);
  }
  draw(v) {
    const { ctx } = v;
    for (const p of this.list) {
      const x = v.xOf(p.m), y = v.groundY(p.m) + p.dy;
      const a = (1 - p.age / p.life) * 0.5;
      ctx.fillStyle = p.kind === 'steam' ? `rgba(242,242,240,${a})` : `rgba(56,56,60,${a * 0.85})`;
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, 7); ctx.fill();
    }
  }
}
