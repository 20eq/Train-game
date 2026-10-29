/**
 * Browser glue: camera, input, HUD, the frame loop.
 */

import { clamp, sample } from './geo.js';
import { WORLD, createWorld } from './world.js';
import {
  KMH, driveAI, formatClock, gapAhead, nextSignal, playerTrain,
  setPlayer, speedLimitFor, stationDistance, stepWorld, toggleDoors,
} from './sim.js';
import { buildLayer, drawFrame } from './render.js';
import { drawCab } from './cab.js';

const HORN = (() => {
  let ac = null;
  return () => {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime;
      for (const [freq, gainV] of [[196, 0.09], [294, 0.06]]) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(gainV, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      }
    } catch { /* audio is a nicety, never fatal */ }
  };
})();

function boot() {
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');

  const world = createWorld();
  const layer = buildLayer(world);

  const cam = { x: 0, y: 0, zoom: 0.62, follow: true };
  const controls = { throttle: false, brake: false, hazard: false, autopilot: false };
  const keys = new Set();

  const ui = {
    canvas, ctx, layer, cam,
    width: 1280, height: 800, dpr: 1,
    view: 'cab', // 'cab' views for driving; 'map' is the network overview
  };

  let hornT = 0;

  let paused = false;
  let lastEvent = { text: 'Welcome to the Western Line network.', tone: 'info', t: 0 };

  /* ------------------------------- sizing ------------------------------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    ui.width = Math.max(320, rect.width);
    ui.height = Math.max(240, rect.height);
    ui.dpr = dpr;
    canvas.width = Math.round(ui.width * dpr);
    canvas.height = Math.round(ui.height * dpr);
    ctx.imageSmoothingEnabled = true;
  }

  function focusTrain(train, instant = false) {
    const p = sample(world.paths[train.pathId], train.s);
    if (instant) {
      cam.x = p.x;
      cam.y = p.y;
    }
    cam.follow = true;
  }

  /* ------------------------------- camera ------------------------------- */
  function screenToWorld(sx, sy) {
    return {
      x: (sx - ui.width / 2) / cam.zoom + cam.x,
      y: (sy - ui.height / 2) / cam.zoom + cam.y,
    };
  }

  function clampCamera() {
    cam.zoom = clamp(cam.zoom, 0.16, 2.2);
    const halfW = ui.width / (2 * cam.zoom);
    const halfH = ui.height / (2 * cam.zoom);
    cam.x = clamp(cam.x, Math.min(halfW, WORLD.w / 2), Math.max(WORLD.w - halfW, WORLD.w / 2));
    cam.y = clamp(cam.y, Math.min(halfH, WORLD.h / 2), Math.max(WORLD.h - halfH, WORLD.h / 2));
  }

  function fitMap() {
    cam.follow = false;
    cam.zoom = Math.min(ui.width / WORLD.w, ui.height / WORLD.h) * 0.94;
    cam.x = WORLD.w / 2;
    cam.y = WORLD.h / 2;
    clampCamera();
  }

  /* --------------------------------- UI -------------------------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    kind: $('uiKind'), train: $('uiTrain'), next: $('uiNext'), dist: $('uiDist'),
    speed: $('uiSpeed'), power: $('uiPower'), brakeBar: $('uiBrake'),
    score: $('uiScore'), clock: $('uiClock'), pax: $('uiPax'), doors: $('uiDoors'),
    signal: $('uiSignal'), fleet: $('uiFleet'), ticker: $('uiTicker'),
    autopilot: $('uiAutopilot'), capacity: $('uiCapacity'),
  };
  const cached = {};
  const put = (key, node, value) => {
    if (cached[key] === value) return;
    cached[key] = value;
    node.textContent = value;
  };

  function buildFleet() {
    el.fleet.innerHTML = '';
    world.trains.forEach((train, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fleet-item';
      btn.dataset.id = train.id;
      btn.innerHTML = `<span class="num">${i + 1}</span>
        <span class="nm">${train.name}</span>
        <span class="kd">${train.kind}</span>`;
      btn.addEventListener('click', () => takeControl(train.id));
      el.fleet.appendChild(btn);
    });
  }

  function takeControl(id) {
    setPlayer(world, id);
    const train = playerTrain(world);
    focusTrain(train);
    controls.autopilot = false;
    syncFleet();
  }

  function syncFleet() {
    for (const btn of el.fleet.children) {
      btn.classList.toggle('active', btn.dataset.id === world.playerId);
    }
  }

  function syncHud() {
    const train = playerTrain(world);
    const isPlayer = train.id === world.playerId;
    const kmh = Math.round(train.v * KMH);

    put('train', el.train, train.name);
    put('kind', el.kind, train.kind.toUpperCase());
    put('speed', el.speed, String(kmh));
    put('score', el.score, world.score.toLocaleString());
    put('clock', el.clock, formatClock(world.time));
    put('pax', el.pax, `${train.onboard}`);
    put('capacity', el.capacity, `/ ${train.capacity}`);

    const station = train.route[train.idx];
    if (station) {
      put('next', el.next, station.name);
      const d = Math.max(0, stationDistance(train, station));
      put('dist', el.dist, d > 900 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
    }

    put('doors', el.doors, train.state === 'dwell'
      ? (train.doors > 0.3 ? 'DOORS OPEN' : 'DOORS CLOSING')
      : 'DOORS LOCKED');
    el.doors.className = train.state === 'dwell' ? 'doors open' : 'doors';

    el.power.style.height = `${Math.round(train.throttle * 100)}%`;
    el.brakeBar.style.height = `${Math.round(clamp(train.braking, 0, 1) * 100)}%`;

    const sig = nextSignal(world, train);
    const stopDist = station ? stationDistance(train, station) : Infinity;
    let flag = '';
    let danger = false;
    if (sig && sig.red && sig.d < 420) {
      flag = `SIGNAL AT DANGER · ${Math.round(sig.d)} m`;
      danger = true;
    } else if (stopDist > 0 && stopDist < 360) {
      const need = (train.v * train.v) / (2 * train.brake);
      if (need > stopDist - 10) {
        flag = 'BRAKE FOR PLATFORM';
        danger = true;
      } else {
        flag = `STOPPING AT ${station.name.toUpperCase()}`;
      }
    } else if (train.state === 'dwell' && train.doors > 0.3) {
      flag = `BOARDING · ${Math.ceil(train.dwell)}s`;
    }
    put('signal', el.signal, flag);
    el.signal.classList.toggle('danger', danger);

    const gap = gapAhead(world, train);
    el.autopilot.textContent = controls.autopilot ? 'AUTOPILOT'
      : (gap !== null && gap < 160 ? `TRAIN AHEAD · ${Math.round(gap)} m` : '');
    el.autopilot.classList.toggle('warn', gap !== null && gap < 140);
    void isPlayer;
    syncFleet();
  }

  function pumpEvents() {
    if (!world.events.length) return;
    const ev = world.events[world.events.length - 1];
    if (ev.t !== lastEvent.t || ev.text !== lastEvent.text) {
      lastEvent = { ...ev, t: world.time };
      el.ticker.textContent = ev.text;
      el.ticker.className = `ticker ${ev.tone}`;
    }
  }

  /* -------------------------------- input ------------------------------- */
  const DRIVE_KEYS = new Set(['KeyW', 'KeyS', 'Space', 'ArrowUp', 'ArrowDown', 'KeyD']);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (['KeyW', 'KeyS', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      return;
    }
    keys.add(e.code);
    if (DRIVE_KEYS.has(e.code) && !overlays.title.classList.contains('hidden')) start();
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': controls.throttle = true; e.preventDefault(); break;
      case 'KeyS': case 'ArrowDown': controls.brake = true; e.preventDefault(); break;
      case 'Space': controls.hazard = true; e.preventDefault(); break;
      case 'KeyD': {
        const train = playerTrain(world);
        if (!toggleDoors(world, train)) {
          lastEvent = { text: 'Doors interlocked — stop at the platform first.', tone: 'bad', t: world.time };
          el.ticker.textContent = lastEvent.text;
          el.ticker.className = 'ticker bad';
        }
        break;
      }
      case 'Tab': {
        e.preventDefault();
        const i = world.trains.findIndex((t) => t.id === world.playerId);
        const next = world.trains[(i + 1) % world.trains.length];
        takeControl(next.id);
        break;
      }
      case 'KeyF': cam.follow = !cam.follow; break;
      case 'KeyM':
        ui.view = ui.view === 'cab' ? 'map' : 'cab';
        if (ui.view === 'map') fitMap();
        break;
      case 'KeyT': controls.autopilot = !controls.autopilot; break;
      case 'KeyH': HORN(); hornT = 0.6; break;
      case 'KeyP': case 'Escape': togglePause(); break;
      case 'Equal': case 'NumpadAdd': cam.zoom = clamp(cam.zoom * 1.18, 0.16, 2.2); clampCamera(); break;
      case 'Minus': case 'NumpadSubtract': cam.zoom = clamp(cam.zoom / 1.18, 0.16, 2.2); clampCamera(); break;
      default: {
        const digit = Number(e.key);
        if (digit >= 1 && digit <= world.trains.length) takeControl(world.trains[digit - 1].id);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyW' || e.code === 'ArrowUp') controls.throttle = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') controls.brake = false;
    if (e.code === 'Space') controls.hazard = false;
  });

  window.addEventListener('blur', () => {
    controls.throttle = false;
    controls.brake = false;
    controls.hazard = false;
    keys.clear();
  });

  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragging.moved = true;
    if (!dragging.moved) return;
    cam.follow = false;
    cam.x = dragging.camX - dx / cam.zoom;
    cam.y = dragging.camY - dy / cam.zoom;
    clampCamera();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging && !dragging.moved) {
      const rect = canvas.getBoundingClientRect();
      pickTrain(e.clientX - rect.left, e.clientY - rect.top);
    }
    dragging = null;
  });
  canvas.addEventListener('pointercancel', () => { dragging = null; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const factor = Math.exp(-e.deltaY * 0.0012);
    cam.zoom = clamp(cam.zoom * factor, 0.16, 2.2);
    const after = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    cam.follow = false;
    clampCamera();
  }, { passive: false });

  function pickTrain(sx, sy) {
    const p = screenToWorld(sx, sy);
    let best = null;
    let bestD = 46;
    for (const train of world.trains) {
      for (let i = 0; i < train.coaches; i += 1) {
        const s = train.s - train.dir * (i * train.coachLen);
        const path = world.paths[train.pathId];
        if (s < 0 || s > path.length) continue;
        const q = sample(path, s);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = train;
          break;
        }
      }
    }
    if (best) takeControl(best.id);
  }

  /* ------------------------------- screens ------------------------------ */
  const overlays = { title: $('overlayTitle'), pause: $('overlayPause') };
  const show = (node, on) => node.classList.toggle('hidden', !on);

  function togglePause() {
    if (document.getElementById('overlayTitle').classList.contains('hidden') === false) return;
    paused = !paused;
    show(overlays.pause, paused);
    controls.throttle = false;
    controls.brake = false;
    controls.hazard = false;
  }

  function start() {
    show(overlays.title, false);
    paused = false;
    const train = playerTrain(world);
    const p = sample(world.paths[train.pathId], train.s);
    cam.x = p.x;
    cam.y = p.y;
    cam.zoom = 0.72;
    cam.follow = true;
    clampCamera();
  }

  const startBtn = $('startBtn');
  if (startBtn) startBtn.addEventListener('click', start);
  const resumeBtn = $('resumeBtn');
  if (resumeBtn) resumeBtn.addEventListener('click', togglePause);
  const pauseBtn = $('pauseBtn');
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  const followBtn = $('followBtn');
  if (followBtn) followBtn.addEventListener('click', () => { cam.follow = !cam.follow; });
  const doorBtn = $('doorBtn');
  if (doorBtn) doorBtn.addEventListener('click', () => toggleDoors(world, playerTrain(world)));
  const mapBtnEl = $('mapBtn');

  if (mapBtnEl) {
    mapBtnEl.addEventListener('click', () => {
      ui.view = ui.view === 'cab' ? 'map' : 'cab';
      if (ui.view === 'map') fitMap();
    });
  }
  const autoBtn = $('autoBtn');
  if (autoBtn) autoBtn.addEventListener('click', () => { controls.autopilot = !controls.autopilot; });

  /* --------------------------------- loop ------------------------------- */
  let last = performance.now();

  function updateCamera(dt) {
    if (!cam.follow) return;
    const train = playerTrain(world);
    const p = sample(world.paths[train.pathId], train.s);
    const k = Math.min(1, dt * 4.5);
    cam.x += (p.x - cam.x) * k;
    cam.y += (p.y - cam.y) * k;
    clampCamera();
  }

  function hudFor(train) {
    const sig = nextSignal(world, train);
    const limit = speedLimitFor(world, train);
    return {
      train,
      nextStation: train.route[train.idx] || null,
      signalRed: Boolean(sig && sig.red && sig.d < 520),
      overspeed: train.v * KMH > limit * KMH + 2,
      speedLimit: Math.round(limit * KMH),
      horn: hornT > 0,
      collisionT: world.collisionT > 0 ? world.collisionT : 0,
      dirt: 0.35,
    };
  }

  function frame(now) {
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(raw, 0.1);

    if (!paused) {
      let remaining = dt;
      let guard = 0;
      while (remaining > 0 && guard++ < 4) {
        const step = Math.min(remaining, 0.05);
        stepWorld(world, step, controls);
        remaining -= step;
      }
      if (hornT > 0) hornT -= dt;
      updateCamera(dt);
      pumpEvents();
      syncHud();
    }

    if (ui.view === 'cab' || paused) {
      // paused still shows the cab, so the frozen frame reads correctly
      drawCab(ctx, ui, world, hudFor(playerTrain(world)));
    } else {
      drawFrame(ctx, ui, world);
    }
    requestAnimationFrame(frame);
  }

  /* --------------------------------- boot ------------------------------- */
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas);
  window.addEventListener('resize', resize);
  resize();
  buildFleet();
  takeControl(world.playerId);
  const first = playerTrain(world);
  const fp = sample(world.paths[first.pathId], first.s);
  cam.x = fp.x;
  cam.y = fp.y;
  clampCamera();
  syncHud();
  requestAnimationFrame(frame);

  window.__TG = {
    world, cam, controls, ui,
    start, takeControl, fitMap, togglePause,
    step: (dt) => stepWorld(world, dt, controls),
    render: () => drawFrame(ctx, ui, world),
    driveAI,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') boot();
