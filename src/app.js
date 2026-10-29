/**
 * The game shell: boots the renderer, switches cities, drives the simulation
 * and paints the HUD. Rendering is behind `createRenderer` so the whole app can
 * be booted headlessly in the tests with a stub.
 */

import * as THREE from '../vendor/three.module.js';
import { CITIES, getCity } from './cities.js';
import { createWorld } from './world.js';
import { buildWorld3D, updateWorld3D, cameraPose, createRenderer, moveCab } from './scene3d.js';
import {
  KMH, formatClock, nextSignal, playerTrain, setPlayer, speedLimitFor,
  stationDistance, stepWorld, toggleDoors,
} from './sim.js';

const $ = (id) => document.getElementById(id);

const CAMERA_MODES = ['cab', 'chase', 'lineside'];
const CAMERA_LABELS = { cab: 'cab', chase: 'chase', lineside: 'lineside' };

export function bootApp(options = {}) {
  const makeRenderer = options.createRenderer || createRenderer;
  const canvas = options.canvas || $('scene');
  const renderer = makeRenderer(canvas);

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.25, 7000);

  const ui = {
    mode: 'cab',
    paused: false,
    orbit: 0.7,
    height: 26,
    distance: 52,
  };

  const controls = { throttle: false, brake: false, hazard: false, autopilot: false };

  let audio = null;
  function horn(on) {
    if (on) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      audio ??= new Ctx();
      if (audio.state === 'suspended') audio.resume();
      if (audio.__horn) return;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, audio.currentTime + 0.06);
      gain.connect(audio.destination);
      const oscs = [233, 311].map((freq) => {
        const osc = audio.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start();
        return osc;
      });
      audio.__horn = { gain, oscs };
      setLamp(el.lampHorn, true, false, true);
    } else if (audio?.__horn) {
      const { gain, oscs } = audio.__horn;
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
      for (const osc of oscs) osc.stop(audio.currentTime + 0.22);
      audio.__horn = null;
      setLamp(el.lampHorn, false);
    }
  }
  const keys = new Set();

  let world = null;
  let view = null;
  let lastFrame = 0;
  let tickerUntil = 0;
  let lastTicker = '';
  let hudClock = 0;

  /* ------------------------------- shell ------------------------------- */

  const el = {
    hud: $('hud'),
    cityName: $('cityName'),
    lineName: $('lineName'),
    clock: $('clock'),
    score: $('scoreValue'),
    nextName: $('nextName'),
    nextDist: $('nextDist'),
    stopList: $('stopList'),
    speed: $('speedValue'),
    needle: $('needle'),
    limit: $('limitBadge'),
    power: $('powerBar'),
    brake: $('brakeBar'),
    lampDoors: $('lampDoors'),
    lampSignal: $('lampSignal'),
    lampLimit: $('lampLimit'),
    lampHorn: $('lampHorn'),
    camName: $('camName'),
    ticker: $('ticker'),
    overlayTitle: $('overlayTitle'),
    overlayPause: $('overlayPause'),
    cityCards: $('cityCards'),
    resumeBtn: $('resumeBtn'),
    titleBtn: $('titleBtn'),
    pauseStats: $('pauseStats'),
  };

  const show = (node, visible) => {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  };

  /* ------------------------------- cities ------------------------------ */

  function renderCityCards() {
    if (!el.cityCards) return;
    el.cityCards.innerHTML = '';
    for (const city of CITIES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'city';
      card.dataset.city = city.id;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = city.livery.local;

      const name = document.createElement('strong');
      name.textContent = city.city;
      const line = document.createElement('em');
      line.textContent = city.line;
      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = city.blurb;

      card.append(swatch, name, line, blurb);
      card.addEventListener('click', () => startCity(city.id));
      el.cityCards.appendChild(card);
    }
  }

  function startCity(cityId) {
    const city = getCity(cityId);
    world = createWorld({ city: city.id });
    view = buildWorld3D(world);
    setPlayer(world, 'exp1');
    controls.throttle = false;
    controls.brake = false;
    controls.hazard = false;
    controls.autopilot = false;
    ui.paused = false;
    ui.mode = 'cab';
    ui.orbit = 0.7;

    if (el.cityName) el.cityName.textContent = city.city;
    if (el.lineName) el.lineName.textContent = city.line;
    show(el.overlayTitle, false);
    show(el.overlayPause, false);
    show(el.hud, true);
    resize();
    updateWorld3D(view, world);
    pushTicker(`${city.city} · ${city.line} — ${playerTrain(world).name} ready`, 'info', 4);
    return world;
  }

  function backToTitle() {
    ui.paused = false;
    show(el.overlayPause, false);
    show(el.hud, false);
    show(el.overlayTitle, true);
  }

  /* -------------------------------- hud -------------------------------- */

  function pushTicker(text, tone = 'info', seconds = 3) {
    lastTicker = text;
    tickerUntil = world ? world.time + seconds : 0;
    if (!el.ticker) return;
    el.ticker.textContent = text;
    el.ticker.className = `ticker show ${tone}`;
  }

  function setLamp(node, on, warn = false, amber = false) {
    if (!node) return;
    node.classList.toggle('on', Boolean(on));
    node.classList.toggle('warn', Boolean(warn));
    node.classList.toggle('amber', Boolean(amber));
  }

  function updateHud() {
    const train = playerTrain(world);
    const stop = train.route[train.idx] || null;
    const speed = Math.max(0, train.v) * KMH;
    const limit = Math.round(speedLimitFor(world, train) * KMH);
    const sig = nextSignal(world, train);

    if (el.speed) el.speed.textContent = String(Math.round(speed));
    if (el.needle) el.needle.style.transform = `rotate(${-120 + Math.min(1, speed / 120) * 240}deg)`;
    if (el.limit) el.limit.textContent = String(limit);
    if (el.clock) el.clock.textContent = formatClock(world.time);
    if (el.score) el.score.textContent = String(Math.round(world.score));
    if (el.power) el.power.style.height = `${Math.round(Math.min(1, train.throttle || 0) * 100)}%`;
    if (el.brake) el.brake.style.height = `${Math.round(Math.min(1, train.braking || 0) * 100)}%`;
    if (el.camName) el.camName.textContent = CAMERA_LABELS[ui.mode] || ui.mode;

    if (stop) {
      const d = Math.abs(stationDistance(train, stop));
      if (el.nextName) el.nextName.textContent = stop.name;
      if (el.nextDist) el.nextDist.textContent = d > 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    }

    if (el.stopList) {
      const ahead = [];
      for (let i = 0; i < 3; i++) {
        const st = train.route[train.idx + train.dir * i];
        if (st) ahead.push(st.name);
      }
      el.stopList.innerHTML = '';
      for (const name of ahead.slice(1)) {
        const li = document.createElement('li');
        li.textContent = name;
        el.stopList.appendChild(li);
      }
    }

    setLamp(el.lampDoors, train.state === 'dwell' && train.doors > 0.15);
    setLamp(el.lampSignal, Boolean(sig && sig.red && sig.d < 520), true);
    setLamp(el.lampLimit, speed > limit + 2, true);
    setLamp(el.lampHorn, false);

    if (el.ticker && world.time > tickerUntil) el.ticker.classList.remove('show');
  }

  function drainEvents() {
    if (!world || !world.events.length) return;
    const ev = world.events[world.events.length - 1];
    if (ev.text !== lastTicker) pushTicker(ev.text, ev.tone || 'info', 3.5);
    world.events.length = 0;
    updateHud();
  }

  /* ------------------------------- input ------------------------------- */

  function cycleCamera() {
    const i = CAMERA_MODES.indexOf(ui.mode);
    ui.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    pushTicker(`camera · ${CAMERA_LABELS[ui.mode]}`, 'info', 1.6);
  }

  function togglePause() {
    if (!world) return;
    ui.paused = !ui.paused;
    show(el.overlayPause, ui.paused);
    controls.throttle = false;
    controls.brake = false;
    controls.hazard = false;
    if (ui.paused && el.pauseStats) {
      const train = playerTrain(world);
      el.pauseStats.textContent =
        `${train.name} · ${Math.round(train.stats.stops)} stops, ${train.stats.missed} missed · `
        + `${Math.round(world.delivered)} passengers carried`;
    }
  }

  const DRIVE_KEYS = new Set(['KeyW', 'KeyS', 'Space', 'ArrowUp', 'ArrowDown', 'KeyD']);

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (!world) return;

    switch (e.code) {
      case 'KeyW': case 'ArrowUp':
        controls.throttle = true; e.preventDefault(); break;
      case 'KeyS': case 'ArrowDown':
        controls.brake = true; e.preventDefault(); break;
      case 'Space':
        controls.hazard = true; e.preventDefault(); break;
      case 'KeyD':
        if (!toggleDoors(world, playerTrain(world))) pushTicker('doors interlocked — stop at a platform first', 'bad', 2.5);
        break;
      case 'KeyC':
        cycleCamera(); break;
      case 'KeyH':
        horn(true); break;
      case 'KeyT':
        controls.autopilot = !controls.autopilot;
        pushTicker(controls.autopilot ? 'autopilot on' : 'manual control', 'info', 2);
        break;
      case 'Tab': {
        e.preventDefault();
        const list = world.trains;
        const i = list.findIndex((t) => t.id === world.playerId);
        const next = list[(i + 1) % list.length];
        setPlayer(world, next.id);
        moveCab(view, world);
        pushTicker(`took ${next.name}`, 'info', 2.5);
        break;
      }
      case 'KeyP': case 'Escape':
        togglePause(); break;
      case 'Digit1': ui.mode = 'cab'; break;
      case 'Digit2': ui.mode = 'chase'; break;
      case 'Digit3': ui.mode = 'lineside'; break;
      default: break;
    }
  }

  function onKeyUp(e) {
    keys.delete(e.code);
    if (!world) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': controls.throttle = false; break;
      case 'KeyS': case 'ArrowDown': controls.brake = false; break;
      case 'Space': controls.hazard = false; break;
      case 'KeyH': horn(false); break;
      default: break;
    }
  }

  let dragging = null;

  function onPointerDown(e) {
    dragging = { x: e.clientX, y: e.clientY };
    if (ui.mode === 'cab') ui.mode = 'lineside';
    if (canvas && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    ui.orbit += dx * 0.006;
  }

  function onPointerUp() { dragging = null; }

  function onWheel(e) {
    ui.distance = Math.max(18, Math.min(160, ui.distance + Math.sign(e.deltaY) * 6));
  }

  /* ------------------------------- frame ------------------------------- */

  function resize() {
    const w = options.width || globalThis.innerWidth || 1280;
    const h = options.height || globalThis.innerHeight || 720;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (renderer.setSize) renderer.setSize(w, h, false);
    if (renderer.setPixelRatio) renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  }

  function drawFrame(dt) {
    if (!world) return;
    const pose = cameraPose(world, {
      mode: ui.mode, orbit: ui.orbit, height: ui.height, distance: ui.distance,
    });
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    if (renderer.render) renderer.render(view.scene, camera);
  }

  function tick(now = 0) {
    if (!world) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
    lastFrame = now;

    if (!ui.paused) {
      stepWorld(world, dt, controls.autopilot ? { autopilot: true } : controls);
      updateWorld3D(view, world);
      if (ui.mode === 'lineside') ui.orbit += dt * 0.06;
      drainEvents();
    }

    drawFrame(dt);

    hudClock += dt;
    if (hudClock > 0.08) { hudClock = 0; updateHud(); }
  }

  /* ------------------------------- wiring ------------------------------ */

  const raf = (fn) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else setTimeout(() => fn(Date.now()), 16);
  };

  let running = false;
  function loop(now) {
    tick(now);
    if (running) raf(loop);
  }

  function start(cityId = options.city || 'mumbai') {
    startCity(cityId);
    running = true;
    lastFrame = 0;
    raf(loop);
    return world;
  }

  renderCityCards();
  if (el.resumeBtn) el.resumeBtn.addEventListener('click', togglePause);
  if (el.titleBtn) el.titleBtn.addEventListener('click', backToTitle);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', resize);
  }
  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: true });
  }
  resize();

  const api = {
    start, startCity, backToTitle, tick, updateHud, togglePause, cycleCamera,
    ui, controls, keys, camera, renderer,
    get world() { return world; },
    get view() { return view; },
    get city() { return world ? world.city : null; },
    DRIVE_KEYS,
  };

  // build a city straight away so the title card sits over a live scene, but
  // hold the simulation until the player picks a line
  startCity(options.city || 'mumbai');
  updateWorld3D(view, world);
  drawFrame(0);
  ui.paused = true;
  show(el.hud, false);
  show(el.overlayTitle, true);
  running = true;
  raf(loop);

  if (typeof window !== 'undefined') window.__TG = api;
  return api;
}
