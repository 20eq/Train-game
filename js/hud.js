'use strict';
/* ============================================================
   Bharat Rail Sim — HUD & overlays (DOM)
   ============================================================ */
const $ = (id) => document.getElementById(id);

const HUD = {
  els: {}, ttRows: [],
  init() {
    const root = $('hud');
    root.innerHTML = `
      <div id="hudTop">
        <div class="panel" id="nextStop">
          <div class="ns-label">NEXT STATION</div>
          <div class="ns-name"><span id="nsName">—</span> <span id="nsLocal"></span></div>
          <div class="ns-dist"><span id="nsDist">—</span> · ETA <span id="nsEta">—</span> <span id="nsLate"></span></div>
        </div>
        <div class="panel center" id="clockPanel">
          <div id="clock">00:00</div>
          <div id="delayRow"><span id="delay">On Time</span><button id="warpBtn" title="Time compression (T)">1×</button></div>
        </div>
        <div class="panel right" id="statPanel">
          <div class="stat"><span id="score">100</span><label>SCORE</label></div>
          <div class="stat"><span id="pax">0</span><label>ON BOARD</label></div>
          <div class="stat"><span id="elev">—</span><label>ALT m</label></div>
        </div>
      </div>
      <div id="banner" class="hidden"></div>
      <div id="hudBottom">
        <div class="panel" id="gaugePanel">
          <canvas id="gauge" width="150" height="150"></canvas>
          <div id="limitCircle"><span id="limitVal">100</span></div>
        </div>
        <div class="panel" id="levers">
          <div class="lever"><label>THR</label><div class="bar"><div id="thrBar"></div></div><span id="thrNotch">N0</span></div>
          <div class="lever"><label>BRK</label><div class="bar"><div id="brkBar" class="red"></div></div><span id="brkNotch">REL</span></div>
          <div id="emgBtn" class="minibtn">EMG</div>
          <div id="hornBtn" class="minibtn">🎺</div>
        </div>
        <div class="panel" id="signalPanel">
          <div class="sig-label">NEXT SIGNAL</div>
          <div class="sig-row"><span class="lamp" id="sigLamp"></span><span id="sigAspect">CLEAR</span></div>
          <div class="sig-sub"><span id="sigName">—</span> · <span id="sigDist">—</span></div>
          <div class="sig-sub" id="gradeRow">—</div>
        </div>
        <div id="touchBtns">
          <button id="mapBtn">Map</button><button id="ttBtn">Times</button><button id="pauseBtn">⏸</button>
        </div>
      </div>`;
    this.g = $('gauge').getContext('2d');
  },
  set(id, txt) { const e = $(id); if (e && e.textContent !== txt) e.textContent = txt; },
  showBanner(txt, cls, ms) {
    const b = $('banner');
    b.textContent = txt; b.className = cls || '';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.className = 'hidden'; }, ms || 2600);
  },
  drawGauge(kmh, vmax, thr, brk, emerg, overspeed) {
    const c = this.g, W = 150, H = 150, cx = W / 2, cy = H / 2, R = 62;
    c.clearRect(0, 0, W, H);
    const maxK = Math.ceil((vmax * 3.6 + 20) / 40) * 40;
    // dial
    c.beginPath(); c.arc(cx, cy, R + 12, 0, 7);
    c.fillStyle = '#14181f'; c.fill();
    c.strokeStyle = '#3a4250'; c.lineWidth = 2; c.stroke();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // ticks
    c.strokeStyle = '#8a94a4'; c.fillStyle = '#aeb6c2'; c.font = '9px sans-serif'; c.textAlign = 'center';
    for (let s = 0; s <= maxK; s += maxK / 8) {
      const a = a0 + (s / maxK) * (a1 - a0);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2));
      c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      c.stroke();
      c.fillText(String(s), cx + Math.cos(a) * (R - 13), cy + Math.sin(a) * (R - 13) + 3);
    }
    // red zone past vmax
    const av = a0 + (vmax * 3.6 / maxK) * (a1 - a0);
    c.beginPath(); c.strokeStyle = '#c23c2c'; c.lineWidth = 4;
    c.arc(cx, cy, R, av, a1); c.stroke();
    // needle
    const an = a0 + clamp(kmh / maxK, 0, 1.02) * (a1 - a0);
    c.strokeStyle = overspeed ? '#ff5340' : '#f2c518'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx - Math.cos(an) * 10, cy - Math.sin(an) * 10);
    c.lineTo(cx + Math.cos(an) * (R - 6), cy + Math.sin(an) * (R - 6)); c.stroke();
    c.beginPath(); c.arc(cx, cy, 4.5, 0, 7); c.fillStyle = '#d8dde4'; c.fill();
    // digital
    c.fillStyle = '#fff'; c.font = 'bold 17px monospace'; c.textAlign = 'center';
    c.fillText(String(Math.round(kmh)), cx, cy + 32);
    c.font = '8px sans-serif'; c.fillStyle = '#8a94a4';
    c.fillText('km/h', cx, cy + 42);
  },
  setSignal(aspect, name, dist) {
    const lamp = $('sigLamp'), asp = $('sigAspect');
    const map = { G: ['#2fbf4f', 'CLEAR'], YY: ['#f5c518', 'ATTENTION'], Y: ['#f5c518', 'CAUTION'], R: ['#e8352c', 'DANGER'] };
    const m = map[aspect] || map.G;
    lamp.style.background = m[0];
    lamp.style.boxShadow = `0 0 8px ${m[0]}`;
    this.set('sigAspect', m[1]);
    this.set('sigName', name || '—');
    this.set('sigDist', dist === null ? '—' : dist.toFixed(2) + ' km');
  },
  setLever(id, frac, text) { $(id).style.height = `${Math.round(clamp(frac, 0, 1) * 100)}%`; },
};

/* ---------- overlays ---------- */
const Overlays = {
  init() {
    $('ttOverlay').innerHTML = `<h2>RUNNING BOARD</h2><table id="ttTable"><thead><tr><th>Station</th><th>Arr</th><th>Dep</th><th>Actual</th><th></th></tr></thead><tbody></tbody></table><div class="hint">Tab / Times to close</div>`;
    $('mapOverlay').innerHTML = `<h2>ROUTE MAP</h2><canvas id="mapCanvas"></canvas><div class="hint">M / Map to close</div>`;
  },
  buildTimetable(tt) {
    const tb = $('ttTable').querySelector('tbody');
    tb.innerHTML = '';
    this.ttRows = [];
    tt.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.st.n}<span class="loc">${row.st.loc || ''}</span></td><td>${fmtClock(row.arr)}</td><td>${row.halt ? fmtClock(row.dep) : '—'}</td><td class="actual" id="tta${i}">—</td><td class="mark" id="ttm${i}"></td>`;
      tb.appendChild(tr);
      this.ttRows.push(tr);
    });
  },
  markRow(idx, cls) { this.ttRows.forEach((r, i) => r.className = i === idx ? cls : (i < idx ? 'done' : '')); },
  setActual(idx, txt, late) {
    const e = $('tta' + idx);
    if (e) { e.textContent = txt; e.className = 'actual ' + (late > 60 ? 'late' : late > 15 ? 'minor' : 'ok'); }
  },
  drawMap(canvas, game) {
    const c = canvas.getContext('2d');
    const W = canvas.width = Math.min(900, window.innerWidth - 80);
    const H = canvas.height = Math.min(430, window.innerHeight - 160);
    const r = game.route;
    c.fillStyle = '#10151d'; c.fillRect(0, 0, W, H);
    const kmToX = (km) => 30 + (km / (r.km * KM)) * (W - 60);
    const yMid = H * 0.55;
    // tunnels & limits
    for (const tu of r.tunnels || []) { c.fillStyle = '#1b2129'; c.fillRect(kmToX(tu[0] * KM), yMid - 26, kmToX(tu[1] * KM) - kmToX(tu[0] * KM), 52); }
    // ghat shading
    for (const gr of r.gradients) {
      if (gr[2] === 0) continue;
      c.fillStyle = 'rgba(200,120,60,0.12)';
      c.fillRect(kmToX(gr[0] * KM), yMid - 34, kmToX(gr[1] * KM) - kmToX(gr[0] * KM), 68);
      c.fillStyle = 'rgba(230,160,90,0.8)'; c.font = '10px sans-serif'; c.textAlign = 'center';
      c.fillText(`1/${Math.round(1 / gr[2])}`, (kmToX(gr[0] * KM) + kmToX(gr[1] * KM)) / 2, yMid + 46);
    }
    // main line
    c.strokeStyle = '#5a6675'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(20, yMid); c.lineTo(W - 20, yMid); c.stroke();
    if (r.double) {
      c.strokeStyle = '#3c4552'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(20, yMid + 7); c.lineTo(W - 20, yMid + 7); c.stroke();
    }
    // signals
    c.fillStyle = '#8892a0';
    for (const s of game.signals) { c.fillRect(kmToX(s.km), yMid - 14, 1.2, 10); }
    // stations
    c.font = '11px sans-serif'; c.textAlign = 'center';
    r.stations.forEach((st, i) => {
      const x = kmToX(st.km);
      c.fillStyle = st.term ? '#f2c518' : '#cfd6de';
      c.fillRect(x - 1, yMid - 8, 2, 16);
      const up = i % 2 === 0;
      c.fillStyle = '#aeb6c2';
      c.fillText(st.n, x, up ? yMid - 18 : yMid + 26);
      if (st.loc) { c.fillStyle = '#68727f'; c.font = '9px sans-serif'; c.fillText(st.loc, x, up ? yMid - 7 : yMid + 37); c.font = '11px sans-serif'; }
    });
    // trains
    for (const t of game.trains) {
      if (t.despawn) continue;
      const x = kmToX(t.s);
      c.fillStyle = t === game.player ? '#f2c518' : '#5aa2e0';
      c.beginPath();
      c.moveTo(x, yMid - 12); c.lineTo(x - 5, yMid - 22); c.lineTo(x + 5, yMid - 22);
      c.closePath(); c.fill();
    }
    // meets
    for (const m of game.meets || []) {
      const st = stationByName(r, m.at);
      c.fillStyle = '#e8552c'; c.font = 'bold 10px sans-serif';
      c.fillText('⟳ ' + m.aiLabel, kmToX(st.km), yMid - 44);
    }
    c.fillStyle = '#68727f'; c.font = '10px sans-serif'; c.textAlign = 'left';
    c.fillText('0 km', 12, H - 8); c.textAlign = 'right';
    c.fillText(r.km.toFixed(0) + ' km', W - 12, H - 8);
  },
};
