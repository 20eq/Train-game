import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { installDom } from './dom.mjs';

const env = installDom();
await import('../src/main.js');
const TG = globalThis.window.__TG;

const read = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

test('the app boots into the cab with a live network', () => {
  assert.ok(TG, 'main.js should expose window.__TG after boot');
  assert.equal(TG.ui.view, 'cab');
  assert.equal(TG.world.trains.length, 7);
  assert.ok(TG.world.playerId);
});

test('frames run without throwing', () => {
  assert.doesNotThrow(() => env.run(120));
  const before = TG.world.time;
  env.run(120);
  assert.ok(TG.world.time > before, 'time should advance between frames');
});

test('the throttle and brake keys reach the player train', () => {
  const train = TG.world.trains.find((t) => t.id === TG.world.playerId);

  // let the opening station stop finish, the way a player would
  if (train.state === 'dwell') train.dwell = 0.4;

  env.press('KeyW');
  assert.equal(TG.controls.throttle, true);
  env.run(180);
  assert.ok(train.v > 1, `train should be moving, v=${train.v} (state ${train.state})`);
  env.release('KeyW');
  assert.equal(TG.controls.throttle, false);

  env.press('KeyS');
  env.run(240);
  assert.equal(train.v, 0, 'the brake should bring it to a stand');
  env.release('KeyS');
});

test('M swaps between the cab and the whole-map view', () => {
  const start = TG.ui.view;
  env.press('KeyM');
  assert.notEqual(TG.ui.view, start);
  assert.doesNotThrow(() => env.run(30));
  env.press('KeyM');
  assert.equal(TG.ui.view, start);
});

test('Tab hands the player to the next train', () => {
  const first = TG.world.playerId;
  env.press('Tab');
  assert.notEqual(TG.world.playerId, first);
  const player = TG.world.trains.find((t) => t.id === TG.world.playerId);
  assert.equal(player.ai, false, 'the train we took must stop being an autopilot');
  assert.doesNotThrow(() => env.run(60));
});

test('pausing freezes the clock and resuming restarts it', () => {
  env.press('KeyP');
  const frozen = TG.world.time;
  env.run(60);
  assert.equal(TG.world.time, frozen, 'a paused game must not advance');
  env.press('KeyP');
  env.run(60);
  assert.ok(TG.world.time > frozen);
});

test('index.html wires the module and the stylesheet, and has unique ids', async () => {
  const html = await read('index.html');
  assert.match(html, /<script type="module" src="src\/main\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);

  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate ids break getElementById');
});

test('every element the app looks up exists in the markup', async () => {
  const html = await read('index.html');
  const main = await read('src/main.js');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...main.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 8);
  assert.deepEqual([...new Set(used)].filter((id) => !htmlIds.has(id)), []);
});

test('the game makes no network calls and no external requests', async () => {
  for (const file of ['src/main.js', 'src/sim.js', 'src/world.js', 'src/cab.js', 'src/render.js', 'src/geo.js']) {
    const src = await read(file);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${file} should not fetch`);
    assert.doesNotMatch(src, /https?:\/\//, `${file} should not reference remote URLs`);
  }
});

test('the stylesheet is balanced', async () => {
  const css = await read('style.css');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close);
});
