'use strict';
/* ============================================================
   Bharat Rail Sim — world renderer
   Side view: x = distance along line (m), y = elevation (exaggerated)
   ============================================================ */
const VS = 3.0; // vertical exaggeration

function makeView(ctx, W, H, cam, route, sc, tod, weather) {
  const th = THEMES[route.theme];
  const v = {
    ctx, W, H, cam, route, sc, th, tod, weather,
    px: cam.pxPerM, vs: cam.pxPerM * VS,
    nightF: nightFactor(tod), duskF: duskFactor(tod),
  };
  v.xOf = (m) => W / 2 + (m - cam.km) * v.px;
  v.groundY = (m) => H * 0.62 - (cam.elevAt(m / KM) - cam.elevAt(cam.km / KM)) * v.vs * 0.9;
  v.rnd = mulberry32(1234);
  return v;
}
function nightFactor(tod) { const s = Math.sin((tod - 6) / 12 * Math.PI); return clamp((0.1 - s) / 0.22, 0, 1); }
function duskFactor(tod) { const s = Math.sin((tod - 6) / 12 * Math.PI); return clamp(1 - Math.abs(s) / 0.26, 0, 1) * 0.9; }
function skyCols(th, v) {
  const s = th.sky, nf = v.nightF, df = v.duskF, dayF = Math.max(0, 1 - nf - df);
  const mix = (a, b, c) => {
    const m2 = (x, y, t) => mixHex(x, y, t);
    return m2(m2(a, b, clamp(df / Math.max(0.001, df + dayF + nf) * 2, 0, 1)), c, clamp(nf, 0, 1));
  };
  return { top: mix(s.dayTop, s.duskTop, s.nightTop), bot: mix(s.dayBot, s.duskBot, s.nightBot) };
}

function drawSky(v) {
  const { ctx, W, H } = v, c = skyCols(v.th, v);
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  g.addColorStop(0, c.top); g.addColorStop(1, c.bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.72);
  // stars
  if (v.nightF > 0.25) {
    const r = mulberry32(42);
    ctx.fillStyle = `rgba(255,255,255,${0.75 * v.nightF})`;
    for (let i = 0; i < 90; i++) {
      const x = (r() * W * 1.4 - (v.cam.km * 0.02) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
      const y = r() * H * 0.5, s = r() < 0.85 ? 1 : 2;
      ctx.fillRect(x, y, s, s);
    }
  }
  // sun / moon
  const sunH = Math.sin((v.tod - 6) / 12 * Math.PI);
  const sunX = v.W * ((v.tod - 6) / 12), sunY = H * 0.42 - sunH * H * 0.34;
  if (sunH > -0.05) {
    const rg = v.ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 90);
    rg.addColorStop(0, 'rgba(255,236,170,0.95)'); rg.addColorStop(0.25, 'rgba(255,200,90,0.5)'); rg.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(sunX, sunY, 90, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(sunX, sunY, 16, 0, 7); ctx.fill();
  } else {
    const mx = v.W * (((v.tod + 12 - 6) % 24) / 12), my = H * 0.3;
    ctx.fillStyle = `rgba(230,235,245,${0.85 * v.nightF})`;
    ctx.beginPath(); ctx.arc(mx, my, 13, 0, 7); ctx.fill();
    ctx.fillStyle = skyCols(v.th, v).top; ctx.beginPath(); ctx.arc(mx - 6, my - 4, 11, 0, 7); ctx.fill();
  }
  // clouds
  const r = mulberry32(7);
  for (let i = 0; i < 14; i++) {
    const span = 900;
    const cx = ((r() * 3000 - v.cam.km * 0.05) % 3000 + 3000) % 3000 - 600 + i * 0;
    const cy = H * (0.08 + r() * 0.3), cw = 90 + r() * 160;
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - v.nightF * 0.8)})`;
    ctx.beginPath();
    ctx.ellipse(cx * (W / 1200), cy, cw, cw * 0.32, 0, 0, 7); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx * (W / 1200) + cw * 0.4, cy + 6, cw * 0.6, cw * 0.24, 0, 0, 7); ctx.fill();
  }
}

function drawHills(v) {
  const { ctx, W, H } = v, th = v.th;
  const layers = [
    { p: 0.12, amp: (th.hills ? th.hills.amp : 46) * 1.1, col: th.hillFar, base: 0.47, f: th.hills ? th.hills.freq * 0.5 : 0.5, off: 0 },
    { p: 0.26, amp: (th.hills ? th.hills.amp : 40) * 0.8, col: th.hillMid, base: 0.53, f: th.hills ? th.hills.freq : 0.9, off: 40 },
  ];
  for (const L of layers) {
    const n = fbm1D(100 + L.off, 3);
    const g = ctx.createLinearGradient(0, H * L.base - 100, 0, H * 0.7);
    g.addColorStop(0, mixHex(L.col, '#ffffff', 0.12));
    g.addColorStop(1, mixHex(L.col, '#000000', 0.25));
    ctx.fillStyle = th.hillBlue && L.p < 0.2 ? mixHex(L.col, '#7080c0', 0.4) : g;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = (v.cam.km * L.p + x / v.px) / 260;
      const y = H * L.base - (0.5 + n(wx) * 0.9) * L.amp * (H / 700);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }
}

function drawSea(v) {
  const th = v.th;
  const segs = [];
  if (th.sea !== undefined) segs.push({ from: th.seaFrom, to: th.seaTo, col: th.sea, big: true });
  if (th.river) segs.push({ from: th.river.from, to: th.river.to, col: '#4a7d94' });
  if (th.lake) for (const l of th.lake) segs.push({ from: l[0], to: l[1], col: '#3f7d96' });
  for (const s of segs) {
    const a0 = smoothstep(s.from - 1.2, s.from + 1.5, v.cam.km / KM) * (1 - smoothstep(s.to - 1.5, s.to + 1.2, v.cam.km / KM));
    if (a0 <= 0.01) continue;
    const { ctx, W, H } = v;
    const yTop = H * 0.52, yBot = v.groundY(v.cam.km) - 6;
    ctx.save(); ctx.globalAlpha = Math.min(1, a0 * 1.4);
    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, mixHex(s.col, '#ffffff', 0.25)); g.addColorStop(1, s.col);
    ctx.fillStyle = g; ctx.fillRect(0, yTop, W, yBot - yTop);
    // waves
    const t = v.cam.t * 0.001;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
    const rr = mulberry32(9);
    for (let i = 0; i < 26; i++) {
      const wy = yTop + (i / 26) * (yBot - yTop) + Math.sin(t * 2 + i) * 2;
      const wx = ((rr() * 2000 - v.cam.km * 0.4 * (0.3 + i / 26)) % (W + 300) + W + 300) % (W + 300) - 150;
      const len = 20 + rr() * 60;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + len, wy); ctx.stroke();
    }
    if (s.big) { // foam near shore
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let x = 0; x < W; x += 7) {
        const p = Math.sin(x * 0.05 + t * 3) * 2;
        ctx.fillRect(x, yBot - 8 + p, 4, 2);
      }
    }
    ctx.restore();
  }
}

function drawSkyline(v) {
  const th = v.th;
  if (!th.skyline) return;
  const { ctx, W, H } = v;
  const a0 = smoothstep(th.skyline.from - 1, th.skyline.from + 0.6, v.cam.km / KM) * (1 - smoothstep(th.skyline.to - 0.6, th.skyline.to + 1, v.cam.km / KM));
  if (a0 <= 0.01) return;
  const items = Scenery.range(v.sc, th.skyline.from * KM - 300, th.skyline.to * KM + 300);
  const p = 0.32;
  ctx.save(); ctx.globalAlpha = a0;
  const base = v.groundY(v.cam.km) - 30;
  for (const it of items) {
    const x = v.xOf((it.km - v.cam.km) * p + v.cam.km);
    if (x < -80 || x > W + 80) continue;
    const h = it.h * (v.H / 700) * 1.4, w = it.w * 0.5;
    ctx.fillStyle = mixHex('#8d95a8', '#2a3140', 0.4 + it.col * 0.3);
    ctx.fillRect(x - w / 2, base - h, w, h + 4);
    if (it.h > 60) { ctx.fillStyle = 'rgba(255,220,140,0.5)'; for (let wy = base - h + 8; wy < base - 10; wy += 12) for (let wx = x - w / 2 + 4; wx < x + w / 2 - 4; wx += 10) if ((wx * 7 + wy * 13) % 5 < 2) ctx.fillRect(wx, wy, 3, 4); }
  }
  ctx.restore();
}

/* ---------- ground / track ---------- */
function inRanges(ranges, m) { for (const r of ranges) if (m >= r[0] * KM && m <= r[1] * KM) return true; return false; }

function drawGround(v) {
  const { ctx, W, H } = v;
  const m0 = v.cam.km - W / (2 * v.px) - 10, m1 = v.cam.km + W / (2 * v.px) + 10;
  // base soil
  ctx.fillStyle = v.th.soil; ctx.fillRect(0, v.groundY(v.cam.km) - 4, W, H);
  // grass/field tint strip
  ctx.fillStyle = v.th.ground; ctx.fillRect(0, v.groundY(v.cam.km) - 4, W, 26);
  // ballast
  ctx.fillStyle = v.th.ballast;
  const gy = v.groundY(v.cam.km);
  ctx.fillRect(0, gy - 2, W, 16);
  // viaduct structure
  for (const vi of v.route.viaducts || []) {
    const x0 = v.xOf(vi[0] * KM), x1 = v.xOf(vi[1] * KM);
    if (x1 < -50 || x0 > v.W + 50) continue;
    ctx.save();
    // valley behind
    const g = ctx.createLinearGradient(0, gy + 10, 0, H);
    g.addColorStop(0, mixHex(v.th.hillMid, '#20301f', 0.35)); g.addColorStop(1, mixHex(v.th.ground, '#1a2418', 0.5));
    ctx.fillStyle = g; ctx.fillRect(x0, gy + 12, x1 - x0, H);
    // pillars/arches
    ctx.fillStyle = mixHex(v.th.ballast, '#888', 0.15);
    const span = 14 * v.px;
    for (let x = x0; x < x1 - 4; x += span) {
      const pw = Math.max(3, span * 0.16);
      ctx.fillRect(x, gy + 12, pw, H - gy);
      ctx.fillRect(Math.min(x1 - pw, x + span - pw), gy + 12, pw, H - gy);
      ctx.beginPath(); ctx.arc(x + span / 2, gy + 14, span * 0.34, Math.PI, 0); ctx.fill();
    }
    // deck
    ctx.fillStyle = mixHex(v.th.ballast, '#777', 0.2); ctx.fillRect(x0, gy + 8, x1 - x0, 8);
    ctx.restore();
  }
  // sleepers
  const step = 0.62 * v.px;
  ctx.fillStyle = 'rgba(40,32,24,0.85)';
  for (let m = Math.floor(m0 / 0.62) * 0.62; m < m1; m += 0.62) {
    const x = v.xOf(m);
    ctx.fillRect(x, gy + 1, Math.max(1.5, step * 0.28), 9);
  }
  // rails
  ctx.fillStyle = '#9aa0a6'; ctx.fillRect(0, gy - 3, W, 2.5);
  ctx.fillStyle = '#5d6266'; ctx.fillRect(0, gy + 6, W, 2);
  // rack rail
  if (v.route.rack) {
    ctx.fillStyle = '#c8b24a';
    for (let m = Math.floor(m0 / 0.5) * 0.5; m < m1; m += 0.5) {
      const x = v.xOf(m);
      ctx.fillRect(x, gy + 2, Math.max(1, v.px * 0.2), 3);
    }
  }
}

function drawCatenary(v) {
  if (!v.route.electrified) return;
  const { ctx, W, H } = v;
  const m0 = v.cam.km - W / (2 * v.px), m1 = v.cam.km + W / (2 * v.px);
  const gy = v.groundY(v.cam.km);
  ctx.strokeStyle = 'rgba(70,70,75,0.9)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let m = Math.floor(m0 / 52.5) * 52.5; m < m1; m += 52.5) {
    const x = v.xOf(m);
    ctx.moveTo(x, gy + 2); ctx.lineTo(x, gy - 88 * (v.vs / (v.px * 3)));
  }
  ctx.stroke();
  // contact wire with sag
  ctx.strokeStyle = 'rgba(60,60,64,0.8)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let m = m0; m < m1; m += 4) {
    const x = v.xOf(m);
    const sag = Math.sin(m / 52.5 * Math.PI) * 2.4;
    const y = gy - 88 * (v.vs / (v.px * 3)) - 4 + sag;
    if (m === Math.floor(m0 / 4) * 4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ---------- tunnels ---------- */
function drawTunnelShells(v) {
  for (const tu of v.route.tunnels || []) {
    const x0 = v.xOf(tu[0] * KM), x1 = v.xOf(tu[1] * KM);
    if (x1 < -100 || x0 > v.W + 100) continue;
    const { ctx } = v, gy = v.groundY(v.cam.km);
    const r = mulberry32(hashStr(String(tu[0])));
    const n = fbm1D(hashStr('tu' + tu[0]), 3);
    ctx.fillStyle = mixHex(v.th.hillMid, '#243020', 0.45);
    ctx.beginPath(); ctx.moveTo(x0, gy + 6);
    const span = Math.max(60, x1 - x0);
    for (let x = x0; x <= x1; x += 10) {
      const f = (x - x0) / span;
      const hgt = (Math.sin(f * Math.PI) ** 0.7) * (120 + n(f * 6) * 50) * (v.H / 700);
      ctx.lineTo(x, gy - hgt * (v.vs / (v.px * 3)));
    }
    ctx.lineTo(x1, gy + 6); ctx.closePath(); ctx.fill();
    // vegetation dots on shell
    ctx.fillStyle = 'rgba(30,60,30,0.35)';
    for (let i = 0; i < span / 8; i++) {
      const x = x0 + r() * span, f = (x - x0) / span;
      const hgt = (Math.sin(f * Math.PI) ** 0.7) * (120 + n(f * 6) * 50) * (v.H / 700) * (v.vs / (v.px * 3));
      ctx.fillRect(x, gy - hgt * r(), 3, 3);
    }
  }
}
function drawTunnelInteriors(v) {
  for (const tu of v.route.tunnels || []) {
    const x0 = v.xOf(tu[0] * KM), x1 = v.xOf(tu[1] * KM);
    if (x1 < -100 || x0 > v.W + 100) continue;
    const { ctx } = v, gy = v.groundY(v.cam.km);
    ctx.fillStyle = '#14100d';
    ctx.fillRect(x0, gy - 150, x1 - x0, 160);
    // wall lights
    for (let m = tu[0] * KM + 20; m < tu[1] * KM; m += 33) {
      const x = v.xOf(m);
      ctx.fillStyle = 'rgba(255,180,90,0.8)'; ctx.fillRect(x, gy - 118, 3, 2);
      const g = ctx.createRadialGradient(x, gy - 117, 1, x, gy - 117, 22);
      g.addColorStop(0, 'rgba(255,180,90,0.35)'); g.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 22, gy - 139, 44, 44);
    }
    // portals
    for (const [x, inward] of [[x0, 1], [x1, -1]]) {
      ctx.fillStyle = '#3d3630';
      ctx.beginPath();
      ctx.moveTo(x - 26 * inward, gy + 10);
      ctx.lineTo(x - 26 * inward, gy - 66);
      ctx.quadraticCurveTo(x, gy - 108, x + 26 * inward, gy - 66);
      ctx.lineTo(x + 26 * inward, gy + 10);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#191512';
      ctx.beginPath();
      ctx.moveTo(x - 17 * inward, gy + 10);
      ctx.lineTo(x - 17 * inward, gy - 56);
      ctx.quadraticCurveTo(x, gy - 88, x + 17 * inward, gy - 56);
      ctx.lineTo(x + 17 * inward, gy + 10);
      ctx.closePath(); ctx.fill();
    }
  }
}

/* ---------- scenery items ---------- */
function drawItems(v, layer) {
  const { ctx, W } = v;
  const m0 = v.cam.km - W / (2 * v.px) - 60, m1 = v.cam.km + W / (2 * v.px) + 60;
  const items = Scenery.range(v.sc, m0, m1);
  const nl = v.nightF;
  for (const it of items) {
    const far = it.side < 0;
    if (layer === 'far' && !far) continue;
    if (layer === 'near' && far) continue;
    const x = v.xOf(it.km);
    const gy = v.groundY(it.km);
    const s = it.s || 1;
    switch (it.kind) {
      case 'tree': drawTree(v, x, gy, it.k, s, it.tone, nl); break;
      case 'building': drawBuilding(v, x, gy, it, nl); break;
      case 'paddy': if (layer === 'near') drawField(v, x, gy, it.w, '#7fae4e', '#5d8a3a', it.tone); break;
      case 'cane': if (layer === 'near') drawCane(v, x, gy, it.w, it.tone); break;
      case 'tea': if (layer === 'far' && it.km % 2 < 1) drawTeaRow(v, x, gy, it.w, it.tone); break;
      case 'windmill': drawWindmill(v, x, gy, it.h, it.phase); break;
      case 'temple': drawTemple(v, x, gy, s, it.tone); break;
      case 'gopuram': drawGopuram(v, x, gy, s); break;
      case 'monument': drawMonument(v, x, gy, s); break;
      case 'fort': drawFort(v, x, gy, s); break;
      case 'rock': drawRock(v, x, gy, s, it.tone); break;
      case 'bush': drawBush(v, x, gy, s, it.tone); break;
      case 'cow': if (layer === 'near') drawCow(v, x, gy, s, it.flip); break;
      case 'dog': if (layer === 'near') drawDog(v, x, gy, s, it.flip); break;
    }
  }
}

function drawTree(v, x, gy, k, s, tone, nl) {
  const { ctx } = v;
  const S = v.vs / (v.px * 3); // height normalisation
  const H = v.H / 700;
  const dark = 0.15 + nl * 0.35;
  if (k === 'palm') {
    const h = (14 + tone * 8) * S * 1.2;
    ctx.strokeStyle = mixHex('#8a6a44', '#000', dark); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.quadraticCurveTo(x + 3, gy - h * 0.6, x + 6, gy - h); ctx.stroke();
    const tx = x + 6, ty = gy - h;
    ctx.strokeStyle = mixHex('#2f7a3a', '#000', dark); ctx.lineWidth = 2.4;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * 0.15 - i * Math.PI * 0.14 + tone;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 12, ty + Math.sin(a) * 10 - 4, tx + Math.cos(a) * 20, ty + Math.sin(a) * 16 + 2);
      ctx.stroke();
    }
  } else if (k === 'eucalyptus' || k === 'pine') {
    const h = (18 + tone * 10) * S * 1.2;
    ctx.strokeStyle = mixHex(k === 'pine' ? '#4a3826' : '#9aa088', '#000', dark); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - h); ctx.stroke();
    ctx.fillStyle = mixHex(k === 'pine' ? '#28502e' : '#5d8a52', '#000', dark);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.ellipse(x + (tone - 0.5) * 5, gy - h + i * h * 0.22, (7 - i * 1.6) * S * 1.4, 5 * S, 0, 0, 7); ctx.fill();
    }
  } else {
    const h = (7 + tone * 5) * S * 1.2;
    ctx.strokeStyle = mixHex('#6a4a2e', '#000', dark); ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - h * 0.7); ctx.stroke();
    const cols = k === 'gulmohar' ? ['#c4453c', '#d4624c'] : ['#3f7a3a', '#4f8a44'];
    ctx.fillStyle = mixHex(cols[tone < 0.5 ? 0 : 1], '#000', dark);
    ctx.beginPath(); ctx.ellipse(x, gy - h, 7 * S * 1.4, 5.5 * S, 0, 0, 7); ctx.fill();
  }
}
function drawBuilding(v, x, gy, it, nl) {
  const { ctx } = v, S = v.vs / (v.px * 3), H = v.H / 700;
  const w = it.w * v.px * 0.5, h = it.h * S * 1.1 * H;
  const dark = 0.1 + nl * 0.4;
  ctx.fillStyle = mixHex(it.col, '#101820', dark);
  ctx.fillRect(x - w / 2, gy - h, w, h);
  ctx.fillStyle = mixHex(it.col, '#000', dark + 0.15);
  ctx.fillRect(x - w / 2, gy - h, w, Math.min(4, h * 0.12));
  if (it.k === 'colony') { ctx.fillStyle = 'rgba(120,70,40,0.8)'; ctx.fillRect(x - w / 2, gy - h * 0.35, w, Math.min(3, h * 0.1)); }
  // windows at dusk/night
  if (nl > 0.25 && it.k !== 'colony') {
    ctx.fillStyle = `rgba(255,214,130,${0.5 * nl})`;
    for (let wy = gy - h + 6; wy < gy - 6; wy += 9) for (let wx = x - w / 2 + 4; wx < x + w / 2 - 4; wx += 8) if (((wx * 31 + wy * 17) | 0) % 7 < 2) ctx.fillRect(wx, wy, 3.5, 4);
  }
}
function drawField(v, x, gy, w, c1, c2, tone) {
  const { ctx } = v;
  ctx.fillStyle = mixHex(c1, c2, tone);
  ctx.fillRect(x - w * v.px * 0.5, gy + 2, w * v.px * 0.5, 10);
}
function drawCane(v, x, gy, w, tone) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.fillStyle = mixHex('#5f9a3c', '#3d6b28', tone);
  ctx.fillRect(x - w * v.px * 0.5, gy - 9 * S, w * v.px * 0.5, 12 * S);
}
function drawTeaRow(v, x, gy, w, tone) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.fillStyle = mixHex('#3d7a3a', '#2c5a2e', tone);
  ctx.beginPath(); ctx.ellipse(x, gy, w * 0.35, 5 * S, 0, 0, 7); ctx.fill();
}
function drawWindmill(v, x, gy, h, phase) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  const hh = h * S;
  ctx.strokeStyle = '#d8dde2'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - hh); ctx.stroke();
  const a = v.cam.t * 0.0012 + phase;
  ctx.strokeStyle = '#eef2f5'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const an = a + i * 2.09;
    ctx.beginPath(); ctx.moveTo(x, gy - hh);
    ctx.lineTo(x + Math.cos(an) * hh * 0.3, gy - hh + Math.sin(an) * hh * 0.3); ctx.stroke();
  }
}
function drawTemple(v, x, gy, s, tone) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  const w = 16 * s * S * 1.4, h = 12 * s * S * 1.4;
  ctx.fillStyle = mixHex('#c9b483', '#241c10', 0.12 + v.nightF * 0.35);
  ctx.fillRect(x - w / 2, gy - h, w, h);
  ctx.fillStyle = mixHex('#d8a44c', '#241c10', 0.15 + v.nightF * 0.35);
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, gy - h);
  ctx.quadraticCurveTo(x, gy - h - 16 * S, x + w / 2 + 2, gy - h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8452c';
  ctx.fillRect(x - 1.2, gy - h - 19 * S, 2.4, 5);
}
function drawGopuram(v, x, gy, s) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  const w = 22 * s * S * 1.6, h = 34 * s * S * 1.6;
  ctx.fillStyle = mixHex('#b8905c', '#241c10', 0.15 + v.nightF * 0.4);
  for (let i = 0; i < 4; i++) {
    const ww = w * (1 - i * 0.2), hh = h * 0.25;
    ctx.fillRect(x - ww / 2, gy - hh * (i + 1), ww, hh + 1);
  }
  ctx.fillStyle = '#c94a2c';
  ctx.fillRect(x - 1.5, gy - h - 8 * S, 3, 9 * S);
}
function drawMonument(v, x, gy, s) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.fillStyle = mixHex('#b05a4a', '#241c10', 0.2 + v.nightF * 0.4);
  ctx.beginPath(); ctx.arc(x, gy, 14 * s * S * 1.6, Math.PI, 0); ctx.fill();
  ctx.fillRect(x - 14 * s * S * 1.6, gy - 6, 28 * s * S * 1.6, 8);
  ctx.fillStyle = '#efe6d8';
  ctx.fillRect(x - 3, gy - 20 * s * S, 6, 20 * s * S);
}
function drawFort(v, x, gy, s) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.fillStyle = mixHex(v.th.laterite || '#8a6a4a', '#241c10', 0.25 + v.nightF * 0.35);
  ctx.beginPath();
  ctx.moveTo(x - 46 * s * S, gy);
  for (let i = 0; i <= 6; i++) ctx.lineTo(x - 46 * s * S + i * 15 * s * S, gy - (20 + Math.sin(i * 1.7) * 14) * s * S);
  ctx.lineTo(x + 46 * s * S, gy); ctx.closePath(); ctx.fill();
}
function drawRock(v, x, gy, s, tone) {
  const { ctx } = v;
  ctx.fillStyle = mixHex('#8d867a', '#000', 0.15 + tone * 0.15 + v.nightF * 0.3);
  ctx.beginPath(); ctx.ellipse(x, gy, 5 * s, 3.4 * s * v.vs / (v.px * 3), 0, 0, 7); ctx.fill();
}
function drawBush(v, x, gy, s, tone) {
  const { ctx } = v;
  ctx.fillStyle = mixHex('#4f7a3c', '#000', 0.1 + tone * 0.2 + v.nightF * 0.3);
  ctx.beginPath(); ctx.ellipse(x, gy, 5 * s, 3.2 * s * v.vs / (v.px * 3), 0, 0, 7); ctx.fill();
}
function drawCow(v, x, gy, s, flip) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.save(); ctx.translate(x, gy); ctx.scale(flip ? -1 : 1, 1);
  ctx.fillStyle = mixHex('#e8e2d4', '#000', 0.1 + v.nightF * 0.3);
  ctx.beginPath(); ctx.ellipse(0, -4 * S, 6 * s, 2.8 * s * S, 0, 0, 7); ctx.fill();
  ctx.fillRect(-5 * s, -3.4 * S, 1.4 * s, 3.4 * S); ctx.fillRect(3.6 * s, -3.4 * S, 1.4 * s, 3.4 * S);
  ctx.beginPath(); ctx.ellipse(6.4 * s, -6 * S, 2 * s, 1.6 * s * S, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawDog(v, x, gy, s, flip) {
  const { ctx } = v, S = v.vs / (v.px * 3);
  ctx.save(); ctx.translate(x, gy); ctx.scale(flip ? -1 : 1, 1);
  ctx.fillStyle = mixHex('#b08a56', '#000', 0.15 + v.nightF * 0.3);
  ctx.beginPath(); ctx.ellipse(0, -2.6 * S, 3.6 * s, 1.8 * s * S, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(3.4 * s, -3.8 * S, 1.4 * s, 1.2 * s * S, 0, 0, 7); ctx.fill();
  ctx.restore();
}

/* ============================================================
   Stations
   ============================================================ */
function drawStations(v) {
  const { ctx, W } = v;
  const m0 = v.cam.km - W / (2 * v.px), m1 = v.cam.km + W / (2 * v.px);
  for (const st of v.route.stations) {
    if (st.km + st.plat < m0 - 60 || st.km - 100 > m1 + 60) continue;
    const gy = v.groundY(st.km);
    const x0 = v.xOf(st.km), x1 = v.xOf(st.km + st.plat);
    const ph = 1.0 * v.vs; // platform height px
    const nl = v.nightF;
    // platform slab (behind train = far side)
    ctx.fillStyle = mixHex('#b8b4ac', '#111', 0.05 + nl * 0.4);
    ctx.fillRect(x0, gy - ph, x1 - x0, ph + 8);
    ctx.fillStyle = 'rgba(180,160,40,0.9)'; // yellow safety line
    ctx.fillRect(x0, gy - ph, x1 - x0, 2.2);
    // pillars + canopy
    const hasCanopy = st.plat > 90;
    if (hasCanopy) {
      const ch = 4.6 * v.vs;
      ctx.strokeStyle = mixHex('#5a6a72', '#111', 0.1 + nl * 0.4); ctx.lineWidth = 2;
      for (let m = st.km + 14; m < st.km + st.plat - 8; m += 15) {
        const x = v.xOf(m);
        ctx.beginPath(); ctx.moveTo(x, gy - ph); ctx.lineTo(x, gy - ph - ch); ctx.stroke();
      }
      ctx.fillStyle = mixHex('#c8b23c', '#111', 0.08 + nl * 0.45);
      ctx.beginPath();
      ctx.moveTo(x0 - 6, gy - ph - ch + 6);
      ctx.quadraticCurveTo(v.xOf(st.km + st.plat / 2), gy - ph - ch - 8, x1 + 6, gy - ph - ch + 6);
      ctx.lineTo(x1 + 6, gy - ph - ch + 13);
      ctx.quadraticCurveTo(v.xOf(st.km + st.plat / 2), gy - ph - ch - 1, x0 - 6, gy - ph - ch + 13);
      ctx.closePath(); ctx.fill();
      // station name board on canopy
      drawNameBoard(v, v.xOf(st.km + st.plat / 2), gy - ph - ch - 2, st, st.plat > 160 ? 1 : 0.8);
      // FOB stairs
      const fx = v.xOf(st.km + st.plat * 0.72);
      ctx.strokeStyle = mixHex('#7a868c', '#111', 0.1 + nl * 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx - 8, gy - ph); ctx.lineTo(fx - 3, gy - ph - ch - 6); ctx.lineTo(fx + 3, gy - ph - ch - 6); ctx.lineTo(fx + 8, gy - ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - 6, gy - ph - ch * 0.5); ctx.lineTo(fx + 6, gy - ph - ch * 0.5); ctx.stroke();
    } else {
      drawNameBoard(v, v.xOf(st.km + st.plat * 0.5), gy - ph - 14, st, 0.7);
    }
    // lamps at night
    if (nl > 0.2) {
      for (let m = st.km + 20; m < st.km + st.plat; m += 60) {
        const x = v.xOf(m), y = gy - ph - (hasCanopy ? 4.6 * v.vs : 20);
        const g = ctx.createRadialGradient(x, y, 1, x, y, 30);
        g.addColorStop(0, `rgba(255,220,140,${0.5 * nl})`); g.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 30, y - 30, 60, 60);
      }
    }
    // crowd
    const cr = mulberry32(hashStr(st.n));
    const n = st.term ? 16 : 8 + ((cr() * 14) | 0);
    for (let i = 0; i < n; i++) {
      const px = v.xOf(st.km + 6 + cr() * (st.plat - 12));
      const py = gy - ph + 2 + cr() * 3;
      drawPerson(v, px, py, cr, 1.0, nl);
    }
    // chai stall / water booth
    if (st.plat > 60) drawChaiStall(v, v.xOf(st.km + st.plat * 0.3), gy - ph, nl);
    // stop marker board
    const stopKm = st.stopKm;
    if (stopKm) {
      const sx = v.xOf(stopKm);
      if (sx > -20 && sx < v.W + 20) {
        ctx.fillStyle = '#f2f2ee'; ctx.fillRect(sx - 7, gy - 15, 14, 10);
        ctx.fillStyle = '#222'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('STOP', sx, gy - 8);
        ctx.fillStyle = '#888'; ctx.fillRect(sx - 0.8, gy - 6, 1.6, 6);
      }
    }
    // km board
    const kx = v.xOf(st.km - 12);
    ctx.fillStyle = '#ddd'; ctx.fillRect(kx - 5, gy - 12, 10, 9);
    ctx.fillStyle = '#333'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((st.km / KM).toFixed(0), kx, gy - 5.5);
  }
}
function drawNameBoard(v, x, y, st, scale) {
  const { ctx } = v;
  const w = Math.max(70, Math.min(240, st.n.length * 9 + 60)) * scale, h = 22 * scale;
  ctx.fillStyle = '#f5e94a';
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.4; ctx.strokeRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.font = `bold ${10 * scale}px Arial, sans-serif`;
  ctx.fillText(st.n.toUpperCase(), x, y - h * 0.38, w - 8);
  ctx.font = `${9 * scale}px "Noto Sans", "Noto Sans Devanagari", "Noto Sans Tamil", "Noto Sans Bengali", "Noto Sans Kannada", sans-serif`;
  ctx.fillText(st.loc || '', x, y - h * 0.08, w - 8);
}
function drawPerson(v, x, y, rnd, s, nl) {
  const { ctx } = v;
  const h = 5.4 * v.vs / (v.px * 3) * (0.9 + rnd() * 0.25);
  const col = rnd() < 0.5 ? KURTA[(rnd() * KURTA.length) | 0] : SARI[(rnd() * SARI.length) | 0];
  ctx.fillStyle = mixHex(col, '#000', 0.05 + nl * 0.45);
  ctx.fillRect(x - 1.1 * s, y - h, 2.2 * s, h * 0.62);
  ctx.fillStyle = mixHex('#7a5a3c', '#000', 0.1 + nl * 0.4);
  ctx.beginPath(); ctx.arc(x, y - h - 1.2 * s, 1.3 * s, 0, 7); ctx.fill();
}
function drawChaiStall(v, x, y, nl) {
  const { ctx } = v;
  ctx.fillStyle = mixHex('#3f6a4a', '#000', 0.1 + nl * 0.4);
  ctx.fillRect(x - 7, y - 7, 14, 7);
  ctx.fillStyle = mixHex('#c84a2c', '#000', 0.1 + nl * 0.4);
  ctx.beginPath(); ctx.moveTo(x - 9, y - 7); ctx.lineTo(x + 9, y - 7); ctx.lineTo(x + 7, y - 11); ctx.lineTo(x - 7, y - 11); ctx.closePath(); ctx.fill();
  if (nl > 0.3) { ctx.fillStyle = `rgba(255,200,120,${nl})`; ctx.fillRect(x - 4, y - 5, 8, 3); }
}

/* ============================================================
   Signals / boards / crossings
   ============================================================ */
function drawSignal(v, sig, aspect) {
  const { ctx } = v;
  const x = v.xOf(sig.km);
  if (x < -30 || x > v.W + 30) return;
  const gy = v.groundY(sig.km);
  const h = 6.4 * v.vs;
  ctx.strokeStyle = '#4a4a50'; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - h); ctx.stroke();
  ctx.fillStyle = '#4a4a50'; ctx.fillRect(x - 4, gy - h - 2, 8, 3);
  // head: G, Y1, Y2, R top->bottom (IR style: red nearest ground)
  const lamps = [
    { c: '#2fbf4f', on: aspect === 'G', y: -h - 2 },
    { c: '#f5c518', on: aspect === 'YY' || aspect === 'Y', y: -h - 12 },
    { c: '#f5c518', on: aspect === 'YY', y: -h - 22 },
    { c: '#e8352c', on: aspect === 'R', y: -h - 32 },
  ];
  for (const L of lamps) {
    const y = gy + L.y;
    ctx.fillStyle = L.on ? L.c : '#26262a';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
    if (L.on) {
      const g = ctx.createRadialGradient(x, y, 1, x, y, 16);
      g.addColorStop(0, rgba2(L.c, 0.55)); g.addColorStop(1, rgba2(L.c, 0));
      ctx.fillStyle = g; ctx.fillRect(x - 16, y - 16, 32, 32);
    }
  }
  // id plate
  ctx.fillStyle = '#eee'; ctx.fillRect(x - 9, gy - h + 6, 18, 7);
  ctx.fillStyle = '#222'; ctx.font = '5.5px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(sig.kind === 'auto' ? sig.name : (sig.kind === 'home' ? sig.name : sig.name + '·D'), x, gy - h + 11.4);
}
function rgba2(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

function drawGates(v, gates) {
  const { ctx } = v;
  for (const g of gates) {
    const x = v.xOf(g.km);
    if (x < -60 || x > v.W + 60) continue;
    const gy = v.groundY(g.km);
    // road
    ctx.fillStyle = '#6a6a68'; ctx.fillRect(x - 5, gy + 4, 10, v.H);
    // gate posts both sides
    const ang = g.closed ? 0 : -Math.PI / 2;
    for (const dir of [-1, 1]) {
      ctx.save(); ctx.translate(x + dir * 22, gy);
      ctx.fillStyle = '#c23c2c'; ctx.fillRect(-2, -34, 4, 34);
      // barrier arm
      ctx.save(); ctx.translate(0, -30); ctx.rotate(dir > 0 ? ang : ang);
      ctx.fillStyle = '#e8e4da'; ctx.fillRect(0, -1.6, 20, 3.2);
      ctx.fillStyle = '#c23c2c';
      for (let i = 2; i < 20; i += 6) ctx.fillRect(i, -1.6, 3, 3.2);
      ctx.restore();
      // crossbuck
      ctx.strokeStyle = '#e8e4da'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-5, -31); ctx.lineTo(5, -37); ctx.moveTo(5, -31); ctx.lineTo(-5, -37); ctx.stroke();
      ctx.restore();
    }
    // waiting traffic
    const r = mulberry32(g.id * 77 + 5);
    for (let i = 0; i < 3; i++) {
      const vx = x - 26 - r() * 26, vy = gy + 8 + i * 3;
      if (i === 0) { // auto rickshaw
        ctx.fillStyle = '#e8c832'; ctx.fillRect(vx, vy - 8, 9, 6);
        ctx.beginPath(); ctx.arc(vx + 9, vy - 4, 3, 0, 7); ctx.fill();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(vx + 2, vy - 1, 1.6, 0, 7); ctx.fill();
      } else if (i === 1) { // scooter
        ctx.fillStyle = '#3a6ec2'; ctx.fillRect(vx, vy - 5, 6, 2.4);
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(vx + 1, vy - 2, 1.6, 0, 7); ctx.arc(vx + 5, vy - 2, 1.6, 0, 7); ctx.fill();
      } else { // cow
        drawCow(v, vx + 4, vy, 0.9, false);
      }
    }
    if (g.bell) {
      ctx.fillStyle = '#ffdf4a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🔔', x + 30, gy - 26);
    }
  }
}

function drawBoards(v) {
  const { ctx } = v;
  const m0 = v.cam.km - v.W / (2 * v.px), m1 = v.cam.km + v.W / (2 * v.px);
  const gy = v.groundY(v.cam.km);
  // speed limit changes
  const lims = v.route.limits;
  for (let i = 1; i < lims.length; i++) {
    const km = lims[i][0] * KM;
    if (km < m0 || km > m1) continue;
    const x = v.xOf(km);
    ctx.strokeStyle = '#c23c2c'; ctx.lineWidth = 2.4;
    ctx.fillStyle = '#f5f5f0';
    ctx.beginPath(); ctx.arc(x, gy - 24, 9, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(lims[i][2]), x, gy - 21.6);
    ctx.fillStyle = '#888'; ctx.fillRect(x - 0.8, gy - 15, 1.6, 15);
  }
  // whistle boards W/L before crossings
  for (const g of v.route.crossings || []) {
    for (const off of [0.6, 0.3]) {
      const km = (g - off) * KM;
      if (km < m0 || km > m1) continue;
      const x = v.xOf(km);
      ctx.fillStyle = '#f2c518';
      ctx.beginPath(); ctx.moveTo(x, gy - 30); ctx.lineTo(x + 7, gy - 22); ctx.lineTo(x, gy - 14); ctx.lineTo(x - 7, gy - 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#222'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('W/L', x, gy - 20);
      ctx.fillStyle = '#888'; ctx.fillRect(x - 0.8, gy - 14, 1.6, 14);
    }
  }
  // gradient posts
  for (const gr of v.route.gradients) {
    if (gr[2] === 0) continue;
    const km = gr[0] * KM;
    if (km < m0 || km > m1) continue;
    const x = v.xOf(km);
    const oneIn = Math.round(1 / Math.abs(gr[2]));
    ctx.fillStyle = '#f5f5f0'; ctx.fillRect(x - 9, gy - 20, 18, 9);
    ctx.fillStyle = '#222'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`1/${oneIn}`, x, gy - 13.4);
    ctx.fillStyle = '#888'; ctx.fillRect(x - 0.8, gy - 11, 1.6, 11);
  }
  // km posts every km
  const k0 = Math.ceil(m0 / KM), k1 = Math.floor(m1 / KM);
  for (let k = k0; k <= k1; k++) {
    const x = v.xOf(k * KM);
    ctx.fillStyle = '#e8e4da'; ctx.fillRect(x - 2, gy - 8, 4, 8);
    ctx.fillStyle = '#333'; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(k), x, gy - 10);
  }
}

/* rain & weather overlay */
function drawWeather(v, rainAmt) {
  if (rainAmt <= 0.01) return;
  const { ctx, W, H } = v;
  ctx.strokeStyle = `rgba(180,200,230,${0.35 * rainAmt})`;
  ctx.lineWidth = 1;
  const r = mulberry32((v.cam.t * 0.1) | 0);
  ctx.beginPath();
  const slant = -clamp(v.cam.speed * 2.2, 0, 60) - 18;
  for (let i = 0; i < 130 * rainAmt; i++) {
    const x = r() * (W + 200) - 100, y = r() * H;
    ctx.moveTo(x, y); ctx.lineTo(x + slant * 0.12, y + 13);
  }
  ctx.stroke();
}
