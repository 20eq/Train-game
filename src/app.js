/**
 * The game shell: boots the renderer, switches cities, drives the simulation
 * and paints the HUD. Rendering is behind `createRenderer` so the whole app can
 * be booted headlessly in the tests with a stub.
 */

import * as THREE from '../vendor/three.module.js';
import { CITIES, LOCOS, getCity, getService, liveryFor, servicesFor } from './cities.js';
import { createWorld } from './world.js';
import { buildWorld3D, updateWorld3D, cameraPose, createRenderer, moveCab } from './scene3d.js';
import {
  KMH, formatClock, nextSignal, playerTrain, setPlayer, speedLimitFor,
  stationDistance, stepWorld, toggleDoors,
} from './sim.js';

const $ = (id) => document.getElementById(id);

const CAMERA_MODES = ['cab', 'chase', 'lineside'];
const CAMERA_LABELS = { cab: 'cab', chase: 'chase', lineside: 'lineside' };

// Only the newest boot listens for input. Booting twice happens in the tests
// and must never leave a stale handler driving the same page.
let activeApp = null;

export function bootApp(options = {}) {
  const makeRenderer = options.createRenderer || createRenderer;
  const canvas = options.canvas || $('scene');

  // A missing WebGL context must not stop the game from starting: the menu,
  // the HUD and the simulation all work without one.
  let renderer = null;
  let rendererError = null;
  try {
    renderer = makeRenderer(canvas);
  } catch (err) {
    rendererError = err;
    renderer = { render() {}, setSize() {}, setPixelRatio() {} };
  }

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.25, 7000);

  const ui = {
    mode: 'cab',
    paused: false,
    orbit: 0.7,
    height: 26,
    distance: 52,
  };

  const controls = {
    power: 0, brakeNotch: 0, hazard: false, autopilot: false,
    get throttle() { return this.power > 0; },
    get brake() { return this.brakeNotch > 0; },
  };
  const NOTCHES = 8;
  let serviceId = options.service || 'express';
  let pendingCity = options.city || 'mumbai';
  let pendingLine = null;
  let menuStep = 'lines';   // 'lines' | 'services' — which card the Drive panel shows

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
  let summaryShown = false;

  /* ------------------------------- career ------------------------------
   * A driver keeps their rank between runs. XP is awarded at the end of a
   * run from the score, so a clean run actually advances you.
   */
  const RANKS = [
    { name: 'Trainee', at: 0 },
    { name: 'Assistant Driver', at: 1200 },
    { name: 'Shunter', at: 3000 },
    { name: 'Main Line Driver', at: 6000 },
    { name: 'Senior Driver', at: 12000 },
    { name: 'Loco Pilot', at: 22000 },
    { name: 'Motorman', at: 40000 },
  ];

  const memoryStore = new Map();
  const store = {
    get(key, fallback) {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        if (raw != null) return JSON.parse(raw);
      } catch { /* private mode, no storage: keep it in memory */ }
      return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    },
    set(key, value) {
      memoryStore.set(key, value);
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
      } catch { /* not persisting is not a failure */ }
    },
  };

  const career = store.get('trainDriver.career', { xp: 0, runs: 0, best: 0 });

  function rankFor(xp) {
    let rank = RANKS[0];
    for (const r of RANKS) if (xp >= r.at) rank = r;
    return rank;
  }

  function nextRankFor(xp) {
    return RANKS.find((r) => r.at > xp) || null;
  }

  function paintCareer() {
    const rank = rankFor(career.xp);
    const next = nextRankFor(career.xp);
    const floor = rank.at;
    const span = next ? next.at - floor : 1;
    const into = next ? Math.min(1, (career.xp - floor) / span) : 1;

    if (el.careerRank) el.careerRank.textContent = rank.name;
    if (el.careerXp) el.careerXp.textContent = String(Math.round(career.xp));
    if (el.careerBar) el.careerBar.style.width = `${Math.round(into * 100)}%`;
    if (el.careerNext) {
      el.careerNext.textContent = next
        ? `${Math.round(next.at - career.xp)} xp to ${next.name}`
        : 'top rank';
    }
    if (el.hudRank) el.hudRank.textContent = rank.name;
  }

  /* ------------------------------- shell ------------------------------- */

  const el = {
    hud: $('hud'),
    cityName: $('cityName'),
    lineName: $('lineName'),
    lineMap: $('lineMap'),
    mapLine: $('mapLine'),
    mapMeta: $('mapMeta'),
    mapRail: $('mapRail'),
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
    cityBtn: $('cityBtn'),
    stopZone: $('stopZone'),
    servicePanel: $('servicePanel'),
    serviceName: $('serviceName'),
    powerNotch: $('powerNotch'),
    brakeNotch: $('brakeNotch'),
    messageList: $('messageList'),
    summary: $('overlaySummary'),
    summaryTitle: $('summaryTitle'),
    summaryStars: $('summaryStars'),
    summaryXp: $('summaryXp'),
    missionText: $('missionText'),
    missionMeta: $('missionMeta'),
    missionBar: $('missionBar'),
    hudRank: $('hudRank'),
    popupLayer: $('popupLayer'),
    touchPower: $('touchPower'),
    touchBrake: $('touchBrake'),
    touchHorn: $('touchHorn'),
    touchDoors: $('touchDoors'),
    careerChip: $('careerChip'),
    careerRank: $('careerRank'),
    careerXp: $('careerXp'),
    careerBar: $('careerBar'),
    careerNext: $('careerNext'),
    restartBtn: $('restartBtn'),
    summaryBody: $('summaryBody'),
    summaryNext: $('summaryNext'),
  };

  const show = (node, visible) => {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
  };

  /* ------------------------------- cities ------------------------------ */

  function renderCityCards() {
    if (!el.cityCards) return;
    el.cityCards.innerHTML = '';

    CITIES.forEach((city, index) => {
      const localStock = city.stock?.local || { cars: 9 };
      const expressStock = city.stock?.express || { cars: 18, name: 'Express' };
      const localLivery = liveryFor(city, 'emu');
      const expressLivery = liveryFor(city, 'lhb');

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'city';
      card.dataset.city = city.id;

      // a livery preview: local rake beside the express rake
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const localBand = document.createElement('i');
      localBand.style.background = localLivery.body;
      const expressBand = document.createElement('i');
      expressBand.style.background = expressLivery.body;
      const locoBand = document.createElement('i');
      locoBand.style.background = expressLivery.stripe;
      swatch.append(localBand, expressBand, locoBand);

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);

      const name = document.createElement('strong');
      name.textContent = city.city;
      const line = document.createElement('em');
      line.textContent = city.lines.map((l) => l.name).join(' · ');

      const fleet = document.createElement('span');
      fleet.className = 'fleet';
      fleet.textContent = `${city.lines.length} lines · ${localStock.cars}-car locals · ${expressStock.cars}-coach express`
        + ` · ${city.services.length} services`;

      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = city.blurb;

      const go = document.createElement('span');
      go.className = 'go';
      go.textContent = '▶';

      const body = document.createElement('span');
      body.className = 'body';
      body.append(name, line, fleet, blurb);

      card.append(key, swatch, body, go);
      card.addEventListener('click', (event) => {
        event.preventDefault();
        showLines(city.id);
      });
      el.cityCards.appendChild(card);
    });
  }

  /** A small shared header for both steps of the Drive menu. */
  function menuShell(city, heading, subheading) {
    el.servicePanel.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card wide';
    el.servicePanel.appendChild(card);

    const eyebrow = document.createElement('p');
    eyebrow.className = 'studio';
    eyebrow.textContent = `${city.city} · ${subheading}`;
    card.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.className = 'menu-title';
    title.textContent = heading;
    card.appendChild(title);

    const list = document.createElement('div');
    list.className = 'cities';
    card.appendChild(list);
    return { card, list };
  }

  function setBack(card, label, handler) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ghost';
    back.textContent = label;
    back.addEventListener('click', handler);
    card.appendChild(back);
  }

  function openPanel() {
    show(el.overlayTitle, false);
    el.servicePanel.removeAttribute('hidden');
    show(el.servicePanel, true);
  }

  /**
   * Step one of the Drive menu: which of this city's lines are you working?
   * Every line keeps its own roster, so the next step shows only its trains.
   */
  function showLines(cityId) {
    pendingCity = cityId;
    pendingLine = null;
    menuStep = 'lines';
    const city = getCity(cityId);
    if (!el.servicePanel) return;

    const { card, list } = menuShell(city, 'Which line?', city.lines.map((l) => l.name).join(' · '));

    city.lines.forEach((line, index) => {
      const services = servicesFor(city, line.id);
      const local = services.find((sv) => sv.type === 'local');
      const express = services.find((sv) => sv.type === 'express');
      const stations = line.stations.length;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'city line';
      row.dataset.line = line.id;

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(index + 1);

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      for (const colour of [line.colour, liveryFor(city, 'emu').body, liveryFor(city, 'lhb').body]) {
        const band = document.createElement('i');
        band.style.background = colour;
        swatch.appendChild(band);
      }

      const body = document.createElement('span');
      body.className = 'body';
      const name = document.createElement('strong');
      name.textContent = line.name;
      const note = document.createElement('em');
      note.textContent = line.note;
      const fleet = document.createElement('span');
      fleet.className = 'fleet';
      fleet.textContent = `${stations} stations · ${services.length} services`
        + (local ? ` · ${local.cars}-car locals` : '')
        + (express ? ` · ${express.cars}-coach express` : '');
      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = services.map((sv) => sv.name).join(' · ');
      body.append(name, note, fleet, blurb);

      const go = document.createElement('span');
      go.className = 'go';
      go.textContent = '▶';

      row.append(key, swatch, body, go);
      row.addEventListener('click', (event) => {
        event.preventDefault();
        showServices(city.id, line.id);
      });
      list.appendChild(row);
    });

    setBack(card, '← back to cities', () => {
      show(el.servicePanel, false);
      el.servicePanel.setAttribute('hidden', '');
      show(el.overlayTitle, true);
    });
    openPanel();
  }

  /** Step two: the trains working that line — local, passenger, express. */
  function showServices(cityId, lineId) {
    pendingCity = cityId;
    const city = getCity(cityId);
    const line = city.lines.find((l) => l.id === lineId) || city.lines[0];
    pendingLine = line.id;
    menuStep = 'services';
    if (!el.servicePanel) return;

    const { card, list } = menuShell(city, line.name, line.note);

    servicesFor(city, line.id).forEach((service) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'city service';
      row.dataset.service = service.id;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = service.type === 'local' ? 'LOCAL' : service.type === 'passenger' ? 'PASSENGER' : 'EXPRESS';

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      const rake = liveryFor(city, service.stock);
      const bands = service.loco
        ? [rake.body, rake.stripe, (LOCOS[service.loco] || {}).body || rake.body]
        : [rake.body, rake.stripe, rake.door];
      for (const colour of bands) {
        const b = document.createElement('i');
        b.style.background = colour;
        swatch.appendChild(b);
      }

      const body = document.createElement('span');
      body.className = 'body';
      const name = document.createElement('strong');
      name.textContent = service.name;
      const kind = document.createElement('em');
      kind.textContent = service.kindLabel;
      const fleet = document.createElement('span');
      fleet.className = 'fleet';
      fleet.textContent = `${service.cars}-coach rake · ${Math.round(service.vmax * 3.6)} km/h · `
        + (service.stops === 'majors' ? 'principal stops' : 'all stations');
      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = service.blurb;
      body.append(name, kind, fleet, blurb);

      const go = document.createElement('span');
      go.className = 'go';
      go.textContent = '▶';

      row.append(badge, swatch, body, go);
      row.addEventListener('click', (event) => {
        event.preventDefault();
        startCity(city.id, service.id);
      });
      list.appendChild(row);
    });

    setBack(card, `← back to ${city.city} lines`, () => showLines(city.id));
    openPanel();
  }

  function startCity(cityId, nextServiceId = serviceId) {
    const city = getCity(cityId);
    serviceId = nextServiceId;
    const service = getService(city, serviceId);
    world = createWorld({ city: city.id, service: service.id });
    view = buildWorld3D(world);
    setPlayer(world, world.trains[0].id);
    controls.power = 0;
    controls.brakeNotch = 0;
    controls.hazard = false;
    controls.autopilot = false;
    ui.paused = false;
    ui.mode = 'cab';
    ui.orbit = 0.7;
    summaryShown = false;
    seenMessages = 0;
    if (el.popupLayer) el.popupLayer.innerHTML = '';
    if (el.missionText) el.missionText.__set = false;
    show(el.summary, false);

    if (el.cityName) el.cityName.textContent = city.city;
    if (el.lineName) el.lineName.textContent = service.lineName || city.lines[0].name;
    show(el.overlayTitle, false);
    show(el.servicePanel, false);
    show(el.overlayPause, false);
    show(el.hud, true);
    if (el.serviceName) el.serviceName.textContent = `${service.name} · ${service.kindLabel}`;
    buildLineMap(service);
    resize();
    updateWorld3D(view, world);
    pushTicker(`${service.name} · ${service.cars} coaches · ready to depart`, 'info', 4);
    return world;
  }

  function showSummary() {
    if (!el.summary) return;
    const train = playerTrain(world);
    const broken = {};
    for (const p of world.penalties) broken[p.category] = (broken[p.category] || 0) + p.amount;

    el.summaryBody.innerHTML = '';
    const lead = document.createElement('p');
    lead.className = 'lede';
    lead.textContent = `${train.name} · ${train.stats.stops} stops · `
      + `${train.stats.missed} missed · ${Math.round(world.delivered)} passengers carried`;
    el.summaryBody.appendChild(lead);

    const score = document.createElement('p');
    score.className = 'bigscore';
    score.textContent = String(Math.round(world.score));
    el.summaryBody.appendChild(score);

    const list = document.createElement('ul');
    list.className = 'breakdown';
    for (const [category, amount] of Object.entries(broken)) {
      const li = document.createElement('li');
      li.textContent = `${category}: ${Math.round(amount)}`;
      list.appendChild(li);
    }
    if (!list.children.length) {
      const li = document.createElement('li');
      li.textContent = 'No penalties — a clean run.';
      list.appendChild(li);
    }
    el.summaryBody.appendChild(list);

    // ---- grade the run and bank the career progress --------------------
    const total = Math.max(1, train.stats.stops + train.stats.missed);
    const ratio = train.stats.stops / total;
    const stars = ratio >= 0.95 && world.penalties.length === 0 ? 3
      : ratio >= 0.8 ? 2
        : ratio >= 0.5 ? 1 : 0;
    if (el.summaryStars) {
      el.summaryStars.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const star = document.createElement('i');
        star.textContent = '★';
        if (i < stars) star.className = 'on';
        el.summaryStars.appendChild(star);
      }
    }
    if (el.summaryTitle) {
      el.summaryTitle.textContent = stars === 3 ? 'A clean run' : stars === 2 ? 'Arrived' : 'Run complete';
    }

    // a stop is worth XP on top of the score, a penalty costs some
    const earned = Math.max(0, Math.round(world.score / 10) + train.stats.stops * 8
      - world.penalties.length * 5);
    career.xp += earned;
    career.runs += 1;
    career.best = Math.max(career.best || 0, Math.round(world.score));
    store.set('trainDriver.career', career);
    paintCareer();

    if (el.summaryXp) el.summaryXp.textContent = `+${earned} xp`;

    show(el.summary, true);
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

  /**
   * The line map: every station on the service's line, the major ones named,
   * the next one ringed, and where your train and the traffic are on it.
   */
  function buildLineMap(service) {
    if (!el.mapRail) return;
    const pathId = service.line;
    const stations = world.stationsOnPath[pathId] || [];
    const pathLen = world.paths[pathId] ? world.paths[pathId].length : 1;
    if (el.mapLine) el.mapLine.textContent = service.lineName || pathId;
    if (el.mapMeta) el.mapMeta.textContent = `${stations.length} stations · ${(pathLen / 1000).toFixed(1)} km`;
    if (el.lineMap) el.lineMap.style.setProperty('--accent', service.lineColour || '#ffcf5c');

    el.mapRail.innerHTML = '';
    const ticks = [];
    stations.forEach((st, i) => {
      const tick = document.createElement('span');
      tick.className = `railtick${st.major ? ' major' : ''}`;
      tick.style.left = `${(st.s / pathLen) * 100}%`;
      // name the majors, and never let the labels crowd: every other one
      const named = st.major && i % 2 === 0;
      if (named) {
        const label = document.createElement('b');
        label.textContent = st.name;
        tick.appendChild(label);
      }
      el.mapRail.appendChild(tick);
      ticks.push({ st, tick, label: named ? tick.children[0] : null });
    });

    // markers: you, plus every other train working the same line
    const me = document.createElement('i');
    me.className = 'railmark me';
    el.mapRail.appendChild(me);

    const others = world.trains
      .filter((t) => t.id !== world.playerId && t.pathId === pathId)
      .map((t) => {
        const mark = document.createElement('i');
        mark.className = 'railmark ai';
        el.mapRail.appendChild(mark);
        return { train: t, mark };
      });

    el.mapRail.__map = { stations, pathLen, ticks, me, others };
  }

  function updateLineMap() {
    const map = el.mapRail && el.mapRail.__map;
    if (!map || !world) return;
    const train = playerTrain(world);
    const at = (s) => `${Math.max(0, Math.min(1, s / map.pathLen)) * 100}%`;
    map.me.style.left = at(train.s);

    const nextId = train.route[train.idx] ? train.route[train.idx].id : null;
    for (const { st, tick } of map.ticks) {
      tick.classList.toggle('next', st.id === nextId);
    }
    for (const { train: other, mark } of map.others) {
      mark.style.left = at(other.s);
    }
  }

  /**
   * Points where you earned them: every new sim message pops up on the right,
   * with its value in the category colour, then fades.
   */
  let seenMessages = 0;
  function drainMessages() {
    if (!el.popupLayer || !world) return;
    const fresh = world.messages.slice(seenMessages);
    seenMessages = world.messages.length;
    for (const m of fresh) {
      if (!m.amount) continue;
      const pop = document.createElement('div');
      pop.className = `popup ${m.amount > 0 ? 'good' : 'bad'}`;
      const value = document.createElement('b');
      value.textContent = `${m.amount > 0 ? '+' : ''}${Math.round(m.amount)}`;
      const label = document.createElement('span');
      label.textContent = m.text;
      pop.append(value, label);
      el.popupLayer.appendChild(pop);
      // the CSS animation fades it out; drop the node once it has finished
      const life = globalThis.setTimeout || setTimeout;
      life(() => {
        if (typeof pop.remove === 'function') pop.remove();
        else if (el.popupLayer.removeChild) el.popupLayer.removeChild(pop);
      }, 3100);
    }
    // never let the layer grow without bound
    while (el.popupLayer.children.length > 5) {
      const oldest = el.popupLayer.firstElementChild || el.popupLayer.children[0];
      if (!oldest) break;
      if (el.popupLayer.removeChild) el.popupLayer.removeChild(oldest);
      else break;
    }
  }

  function updateMission() {
    const train = playerTrain(world);
    const route = train.route.length || 1;
    const index = Math.max(0, Math.min(route, train.idx));
    const done = train.dir > 0 ? index : route - index - 1;
    if (el.missionMeta) el.missionMeta.textContent = `stop ${Math.max(1, done + 1)} / ${route}`;
    if (el.missionBar) {
      el.missionBar.style.width = `${Math.max(0, Math.min(100, (done / route) * 100))}%`;
    }
    if (el.missionText && !el.missionText.__set) {
      const last = train.route[train.route.length - 1];
      el.missionText.textContent = `Run to ${last ? last.name : 'the terminus'} — ${route} stops, `
        + (world.service.stops === 'majors' ? 'principal stations only' : 'every station');
      el.missionText.__set = true;
    }
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
    if (el.power) el.power.style.height = `${Math.round((controls.power / NOTCHES) * 100)}%`;
    if (el.brake) el.brake.style.height = `${Math.round((controls.brakeNotch / NOTCHES) * 100)}%`;
    if (el.powerNotch) el.powerNotch.textContent = String(controls.power);
    if (el.brakeNotch) el.brakeNotch.textContent = String(controls.brakeNotch);
    if (el.camName) el.camName.textContent = CAMERA_LABELS[ui.mode] || ui.mode;
    updateLineMap();
    updateMission();
    drainMessages();

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

    if (el.messageList) {
      const recent = world.messages.slice(-3).reverse();
      const signature = recent.map((m) => m.text).join('|');
      if (signature !== el.messageList.__sig) {
        el.messageList.__sig = signature;
        el.messageList.innerHTML = '';
        for (const m of recent) {
          const row = document.createElement('li');
          row.className = m.amount < 0 ? 'bad' : m.amount > 0 ? 'good' : 'info';
          const cat = document.createElement('b');
          cat.textContent = m.category;
          const txt = document.createElement('span');
          txt.textContent = m.text;
          const amt = document.createElement('i');
          amt.textContent = m.amount ? `${m.amount > 0 ? '+' : ''}${m.amount}` : '';
          row.append(cat, txt, amt);
          el.messageList.appendChild(row);
        }
      }
    }

    // the green zone: how close the board is, so the stop can be planned
    if (el.stopZone) {
      const d = stop ? stationDistance(train, stop) : 9999;
      const inZone = Math.abs(d) <= 18;
      el.stopZone.classList.toggle('in', inZone);
      el.stopZone.style.opacity = d >= 0 && d < 700 ? '1' : '0.35';
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
    if (!summaryShown) show(el.overlayPause, ui.paused);
    controls.power = 0;
    controls.brakeNotch = 0;
    controls.hazard = false;
    if (ui.paused && el.pauseStats) {
      const train = playerTrain(world);
      el.pauseStats.textContent =
        `${train.name} · ${Math.round(train.stats.stops)} stops, ${train.stats.missed} missed · `
        + `${Math.round(world.delivered)} passengers carried`;
    }
  }

  const DRIVE_KEYS = new Set(['KeyW', 'KeyS', 'Space', 'ArrowUp', 'ArrowDown', 'KeyD', 'KeyX']);

  function notchPower(step) {
    controls.power = Math.max(0, Math.min(NOTCHES, controls.power + step));
    if (controls.power > 0) controls.brakeNotch = 0;
  }

  function notchBrake(step) {
    controls.brakeNotch = Math.max(0, Math.min(NOTCHES, controls.brakeNotch + step));
    if (controls.brakeNotch > 0) controls.power = 0;
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);

    // on the title card, 1-4 pick a city
    const serviceOpen = el.servicePanel && !el.servicePanel.classList.contains('hidden');
    if (serviceOpen) {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
      if (n !== undefined) {
        const city = getCity(pendingCity || 'mumbai');
        if (menuStep === 'lines') {
          const line = city.lines[n];
          if (line) { e.preventDefault(); showServices(city.id, line.id); }
        } else {
          const sv = servicesFor(city, pendingLine)[n];
          if (sv) { e.preventDefault(); startCity(city.id, sv.id); }
        }
      }
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        if (menuStep === 'services') showLines(pendingCity || 'mumbai');
        else {
          show(el.servicePanel, false);
          el.servicePanel.setAttribute('hidden', '');
          show(el.overlayTitle, true);
        }
      }
      return;
    }

    const menuOpen = !el.overlayTitle.classList.contains('hidden');
    if (menuOpen) {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
      if (n !== undefined && CITIES[n]) {
        e.preventDefault();
        showLines(CITIES[n].id);
      }
      return;
    }

    switch (e.code) {
      case 'KeyW': case 'ArrowUp':
        notchPower(1); e.preventDefault(); break;
      case 'KeyS': case 'ArrowDown':
        notchBrake(1); e.preventDefault(); break;
      case 'KeyX':
        controls.power = 0; controls.brakeNotch = 0; break;
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

    if (world.finished && !summaryShown) {
      summaryShown = true;
      showSummary();
    }

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

  if (el.resumeBtn) el.resumeBtn.addEventListener('click', togglePause);
  if (el.restartBtn) {
    el.restartBtn.addEventListener('click', () => {
      show(el.overlayPause, false);
      startCity(world ? world.city.id : pendingCity, serviceId);
    });
  }

  // ---- thumb controls: the same levers, sized for a phone ---------------
  function holdControl(node, onDown, onUp) {
    if (!node || !node.addEventListener) return;
    const down = (event) => {
      event.preventDefault?.();
      node.classList.add('held');
      onDown();
    };
    const up = () => {
      node.classList.remove('held');
      onUp?.();
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
  }

  let touchPowerT = null;
  let touchBrakeT = null;
  holdControl(
    el.touchPower,
    () => {
      if (!world) return;
      notchPower(1);
      // hold to keep notching up, one step at a time
      touchPowerT = (globalThis.setInterval || setInterval)(() => notchPower(1), 320);
    },
    () => {
      if (touchPowerT) (globalThis.clearInterval || clearInterval)(touchPowerT);
      touchPowerT = null;
    },
  );
  holdControl(
    el.touchBrake,
    () => {
      if (!world) return;
      notchBrake(1);
      touchBrakeT = (globalThis.setInterval || setInterval)(() => notchBrake(1), 320);
    },
    () => {
      if (touchBrakeT) (globalThis.clearInterval || clearInterval)(touchBrakeT);
      touchBrakeT = null;
    },
  );
  holdControl(el.touchHorn, () => world && horn(true), () => world && horn(false));
  holdControl(el.touchDoors, () => {
    if (!world) return;
    if (!toggleDoors(world, playerTrain(world))) pushTicker('doors interlocked — stop at a platform first', 'bad', 2.5);
  });
  if (el.cityBtn) el.cityBtn.addEventListener('click', backToTitle);
  if (el.summaryNext) {
    el.summaryNext.addEventListener('click', () => {
      show(el.summary, false);
      backToTitle();
    });
  }
  if (el.titleBtn) el.titleBtn.addEventListener('click', backToTitle);

  function detach() {
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', resize);
    }
    if (canvas && canvas.removeEventListener) {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    }
  }
  if (activeApp) activeApp.detach();
  activeApp = { detach };

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
    start, startCity, backToTitle, tick, updateHud, togglePause, cycleCamera, stop: detach,
    showLines, showServices, get menuStep() { return menuStep; },
    career, rankFor, RANKS,
    rendererError,
    ui, controls, keys, camera, renderer,
    get world() { return world; },
    get view() { return view; },
    get city() { return world ? world.city : null; },
    DRIVE_KEYS,
  };

  // the menu comes first: it must exist even if the scene below cannot render
  renderCityCards();
  paintCareer();

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
