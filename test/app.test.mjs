import test from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import { installDom } from './dom.mjs';

const read = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

const env = installDom();
const { bootApp } = await import('../src/app.js');

// a renderer stub: the app only needs render/setSize/setPixelRatio
const rendered = { frames: 0 };
const app = bootApp({
  createRenderer: () => ({
    render() { rendered.frames++; },
    setSize() {},
    setPixelRatio() {},
  }),
  width: 1280,
  height: 720,
});

const step = (n = 1) => {
  for (let i = 0; i < n; i++) app.tick(performance.now() + i * 16);
};

test('the app boots onto the title card with a live scene behind it', () => {
  assert.ok(app.world, 'a city is built straight away');
  assert.ok(app.view, 'and its scene too');
  assert.equal(app.ui.paused, true, 'the simulation waits for the player');
  assert.ok(env.elements.get('overlayTitle').classList.contains('hidden') === false);
  assert.equal(rendered.frames > 0, true, 'the title sits over a rendered frame');
});

test('the title card offers a different local for every city', () => {
  const cards = env.elements.get('cityCards');
  assert.ok(cards.children.length >= 4, `expected a card per city, got ${cards.children.length}`);

  const ids = cards.children.map((c) => c.dataset.city);
  assert.deepEqual(ids, ['mumbai', 'delhi', 'kolkata', 'chennai'], 'one card per city, in order');

  // each card names its line, its fleet, and previews both liveries
  for (const card of cards.children) {
    const text = JSON.stringify(card, (k, v) => (k === 'listeners' ? undefined : v));
    assert.match(text, /car locals/);
    assert.match(text, /coach/);
    const swatch = card.children.find((c) => c.className === 'swatch');
    assert.equal(swatch.children.length, 3, 'local, express and locomotive bands');
    for (const band of swatch.children) assert.match(band.style.background, /^#[0-9a-f]{6}$/i);
  }
});

test('a city opens its line menu, then a line opens its trains', () => {
  const card = env.elements.get('cityCards').children.find((c) => c.dataset.city === 'kolkata');
  assert.ok(card, 'Kolkata should be on the title card');
  card.emit('click');

  const panel = env.elements.get('servicePanel');
  assert.equal(panel.classList.contains('hidden'), false, 'the Drive menu should open');
  assert.equal(app.menuStep, 'lines', 'a city asks for a line first');
  const lines = panel.children[0].children.find((c) => c.className === 'cities');
  assert.deepEqual(lines.children.map((c) => c.dataset.line), ['circular', 'sealdah', 'howrah']);

  lines.children[2].emit('click');
  assert.equal(app.menuStep, 'services', 'a line asks for a train next');
  const trains = panel.children[0].children.find((c) => c.className === 'cities');
  const ids = trains.children.map((c) => c.dataset.service);
  assert.deepEqual(ids, ['howrah-local', 'howrah-passenger', 'howrah-express'], 'local, passenger and express');

  // run the local first
  trains.children[0].emit('click');
  assert.equal(app.world.city.id, 'kolkata');
  assert.equal(app.world.trains[0].pathId, 'howrah', 'it runs the line it was picked on');
  assert.equal(app.world.trains[0].stock, 'emu', 'the local is an EMU');
  assert.equal(app.world.trains[0].loco, null);
  assert.equal(app.ui.paused, false);
  assert.equal(env.elements.get('cityName').textContent, 'Kolkata');
  assert.ok(env.elements.get('hud').classList.contains('hidden') === false);
  assert.match(env.elements.get('serviceName').textContent, new RegExp(app.world.service.name));
});

test('every line in Mumbai runs its own local', () => {
  app.backToTitle();
  env.elements.get('cityCards').children.find((c) => c.dataset.city === 'mumbai').emit('click');
  const panel = env.elements.get('servicePanel');
  const lines = panel.children[0].children.find((c) => c.className === 'cities');
  assert.equal(lines.children.length, 3, 'Mumbai has three lines');

  const locals = [];
  for (let i = 0; i < lines.children.length; i++) {
    lines.children[i].emit('click');
    const trains = panel.children[0].children.find((c) => c.className === 'cities');
    const local = trains.children.find((c) => c.dataset.service.endsWith('-local'));
    assert.ok(local, `line ${i} has a local of its own`);
    local.emit('click');
    locals.push({ name: app.world.trains[0].name, line: app.world.trains[0].pathId });
    app.backToTitle();
    env.elements.get('cityCards').children.find((c) => c.dataset.city === 'mumbai').emit('click');
  }

  assert.deepEqual(locals.map((l) => l.line), ['western', 'central', 'harbour']);
  assert.equal(new Set(locals.map((l) => l.name)).size, 3, 'and each local has its own name');
});

test('a line offers three genuinely different machines', () => {
  app.backToTitle();
  env.elements.get('cityCards').children[3].emit('click');
  const panel = env.elements.get('servicePanel');
  panel.children[0].children.find((c) => c.className === 'cities').children[1].emit('click');  // Chennai north
  const list = panel.children[0].children.find((c) => c.className === 'cities');

  const seen = [];
  for (const card of list.children) {
    card.emit('click');
    const train = app.world.trains[0];
    seen.push({ id: card.dataset.service, stock: train.stock, loco: train.loco, cars: train.coaches });
  }

  assert.deepEqual(seen.map((x) => x.stock), ['emu', 'icf', 'lhb']);
  assert.deepEqual(seen.map((x) => x.loco), [null, 'WAP4', 'WAP7']);
  assert.ok(seen[2].cars > seen[1].cars, 'the express is the longest rake');
  assert.ok(seen[0].cars >= 8, 'a suburban rake is at least eight cars');
  assert.ok(seen.every((x) => x.id.startsWith('north-')), 'all three work the same line');
});

test('frames advance the timetable and draw every time', () => {
  const before = app.world.time;
  const frames = rendered.frames;
  step(40);
  assert.ok(app.world.time > before, 'time should pass once the game is running');
  assert.ok(rendered.frames > frames, 'each frame should render');
});

test('the power and brake notches reach the player train', () => {
  const train = app.world.trains.find((t) => t.id === app.world.playerId);
  if (train.state === 'dwell') train.dwell = 0.3;

  env.press('KeyW');
  env.press('KeyW');
  env.press('KeyW');
  assert.equal(app.controls.power, 3, 'each press is one notch');
  assert.equal(app.controls.brakeNotch, 0);
  step(600);
  assert.ok(train.v > 1, `the train should roll, v=${train.v} state=${train.state}`);

  env.press('KeyX');
  assert.equal(app.controls.power, 0, 'X releases the lever');

  for (let i = 0; i < 8; i++) env.press('KeyS');
  assert.equal(app.controls.brakeNotch, 8);
  assert.equal(app.controls.power, 0, 'the brake takes the power off');
  step(300);
  assert.equal(train.v, 0, 'full brake should bring it to a stand');
  env.press('KeyX');
  assert.equal(app.controls.brakeNotch, 0);
});

test('C cycles the camera and the HUD says which one', () => {
  assert.equal(app.ui.mode, 'cab');
  env.press('KeyC');
  assert.equal(app.ui.mode, 'chase');
  env.press('KeyC');
  assert.equal(app.ui.mode, 'lineside');
  env.press('KeyC');
  assert.equal(app.ui.mode, 'cab');
  assert.equal(env.elements.get('camName').textContent, 'cab');
});

test('the HUD reports the next stop and the speed limit', () => {
  step(2);
  assert.ok(env.elements.get('nextName').textContent.length > 0);
  const speed = Number(env.elements.get('speedValue').textContent);
  assert.ok(Number.isFinite(speed) && speed >= 0);
  const limit = Number(env.elements.get('limitBadge').textContent);
  assert.ok(limit > 0, 'a speed limit should be shown');
  assert.match(env.elements.get('clock').textContent, /^\d\d:\d\d(:\d\d)?$/);
});

test('Tab hands over to another train in the same world', () => {
  app.startCity('mumbai', 'local');
  const first = app.world.playerId;
  env.press('Tab');
  assert.notEqual(app.world.playerId, first);
  step(20);
});

test('pause freezes the clock and resume restarts it', () => {
  env.press('KeyP');
  assert.equal(app.ui.paused, true);
  const frozen = app.world.time;
  step(30);
  assert.equal(app.world.time, frozen);

  env.press('KeyP');
  assert.equal(app.ui.paused, false);
  step(30);
  assert.ok(app.world.time > frozen);
});

test('index.html wires the module, the stylesheet and unique ids', async () => {
  const html = await read('index.html');
  assert.match(html, /<script type="module">/);
  assert.match(html, /from '\.\/src\/app\.js'/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<canvas id="scene">/);

  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate ids break getElementById');
});

test('every element the app looks up exists in the markup', async () => {
  const html = await read('index.html');
  const src = await read('src/app.js');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...src.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 12);
  assert.deepEqual([...new Set(used)].filter((id) => !htmlIds.has(id)), []);
});

test('three.js is vendored, not loaded from the network', async () => {
  const files = ['src/app.js', 'src/scene3d.js', 'src/world.js', 'src/sim.js', 'src/cities.js', 'src/geo.js'];
  for (const file of files) {
    const src = await read(file);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${file} should not fetch`);
    assert.doesNotMatch(src, /https?:\/\//, `${file} should not reference a remote URL`);
  }
  const app = await read('src/app.js');
  assert.match(app, /from '\.\.\/vendor\/three\.module\.js'/, 'three.js must come from vendor/');
});

test('the stylesheet is balanced and the page has no leftover ids', async () => {
  const css = await read('style.css');
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
  const html = await read('index.html');
  assert.doesNotMatch(html, /id="map"/, 'the old 2D map canvas is gone');
  assert.doesNotMatch(css, /#map\b/, 'and its styles too');
});

test('the line map draws the whole route, your train and the traffic', () => {
  app.startCity('chennai', 'local');
  const rail = env.elements.get('mapRail');
  const stations = app.world.stationsOnPath[app.world.service.line];
  const ticks = rail.children.filter((c) => c.className.startsWith('railtick'));
  assert.equal(ticks.length, stations.length, 'every station on the line gets a tick');
  assert.equal(env.elements.get('mapLine').textContent, 'South Line');
  assert.match(env.elements.get('mapMeta').textContent, /^\d+ stations · \d+\.\d km$/);

  const me = rail.children.find((c) => c.className === 'railmark me');
  assert.ok(me, 'the player has a marker');
  const traffic = rail.children.filter((c) => c.className === 'railmark ai');
  assert.equal(traffic.length, app.world.trains.filter((t) => t.pathId === app.world.service.line).length - 1);

  const before = me.style.left;
  app.tick(4000);
  assert.notEqual(me.style.left, before, 'the marker follows the train');
  assert.ok(me.style.left.endsWith('%'));
});

test('the picker survives a browser without WebGL', () => {
  app.startCity('mumbai', 'express');
  const broken = bootApp({
    createRenderer: () => { throw new Error('WebGL unavailable'); },
    width: 1280, height: 720,
  });
  assert.ok(broken.rendererError, 'the failure should be reported, not thrown');
  assert.equal(broken.world.city.id, 'mumbai', 'a city still builds');

  // this boot owns the menu now: it must list every city and be usable
  const cards = env.elements.get('cityCards');
  assert.equal(cards.children.length, 4, 'and the menu is still there to choose from');
  cards.children[2].emit('click');
  const panel = env.elements.get('servicePanel');
  panel.children[0].children.find((c) => c.className === 'cities').children[2].emit('click');  // howrah
  panel.children[0].children.find((c) => c.className === 'cities').children[2].emit('click');  // express
  assert.equal(broken.world.city.id, 'kolkata');
  assert.equal(broken.world.trains[0].stock, 'lhb');
  assert.equal(broken.world.trains[0].pathId, 'howrah');
  broken.tick(1000);
});

test('number keys walk the menu: city, then line, then train', () => {
  // booted last, so this instance owns the keyboard
  const fresh = bootApp({
    createRenderer: () => ({ render() {}, setSize() {}, setPixelRatio() {} }),
    width: 1280, height: 720,
  });
  env.press('Digit2');
  const panel = env.elements.get('servicePanel');
  assert.equal(panel.classList.contains('hidden'), false, 'a city key opens its Drive menu');
  assert.equal(fresh.menuStep, 'lines');

  env.press('Digit3');
  assert.equal(fresh.menuStep, 'services', 'key 3 picks the third line');

  // escape walks back up the menu instead of starting a run
  env.press('Escape');
  assert.equal(fresh.menuStep, 'lines', 'escape goes back to the line list');
  assert.equal(panel.classList.contains('hidden'), false, 'and the menu stays open');

  env.press('Digit3');
  env.press('Digit3');
  assert.equal(fresh.world.city.id, 'delhi');
  assert.equal(fresh.world.trains[0].pathId, 'ghaziabad', 'the third line in Delhi');
  assert.equal(fresh.world.trains[0].stock, 'lhb', 'key 3 is the express');
  fresh.stop();
});
