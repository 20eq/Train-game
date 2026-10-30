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

test('choosing a city starts that line', () => {
  const card = env.elements.get('cityCards').children.find((c) => c.dataset.city === 'kolkata');
  assert.ok(card, 'Kolkata should be on the title card');
  card.emit('click');
  assert.equal(app.world.city.id, 'kolkata');
  assert.equal(app.ui.paused, false);
  assert.equal(env.elements.get('cityName').textContent, 'Kolkata');
  assert.ok(env.elements.get('hud').classList.contains('hidden') === false);
});

test('frames advance the timetable and draw every time', () => {
  const before = app.world.time;
  const frames = rendered.frames;
  step(40);
  assert.ok(app.world.time > before, 'time should pass once the game is running');
  assert.ok(rendered.frames > frames, 'each frame should render');
});

test('the throttle reaches the player train', () => {
  const train = app.world.trains.find((t) => t.id === app.world.playerId);
  if (train.state === 'dwell') train.dwell = 0.3;

  env.press('KeyW');
  assert.equal(app.controls.throttle, true);
  step(200);
  assert.ok(train.v > 1, `the train should roll, v=${train.v} state=${train.state}`);
  env.release('KeyW');
  assert.equal(app.controls.throttle, false);

  env.press('KeyS');
  step(260);
  assert.equal(train.v, 0, 'the brake should bring it to a stand');
  env.release('KeyS');
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

test('the picker survives a browser without WebGL', () => {
  const broken = bootApp({
    createRenderer: () => { throw new Error('WebGL unavailable'); },
    width: 1280, height: 720,
  });
  assert.ok(broken.rendererError, 'the failure should be reported, not thrown');
  assert.equal(broken.world.city.id, 'mumbai', 'a city still builds');
  const cards = env.elements.get('cityCards');
  assert.equal(cards.children.length, 4, 'and the menu is still there to choose from');
  cards.children[2].emit('click');
  assert.equal(broken.world.city.id, 'kolkata');
  broken.tick(1000);
});

test('number keys pick a city from the menu', () => {
  app.backToTitle();
  env.press('Digit2');
  assert.equal(app.world.city.id, 'delhi');
  app.backToTitle();
  env.press('Digit4');
  assert.equal(app.world.city.id, 'chennai');
  app.startCity('mumbai');
});
