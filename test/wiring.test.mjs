import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

const html = await read('index.html');
const css = await read('style.css');
const js = await read('game.js');

const idsIn = (source) => new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));

test('every element the game looks up exists in index.html', () => {
  const htmlIds = idsIn(html);
  const used = [
    ...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g),
    ...js.matchAll(/\$\(['"]([^'"]+)['"]\)/g),
  ].map((m) => m[1]);

  assert.ok(used.length > 10, 'the game should be wiring up a fair amount of DOM');
  const missing = [...new Set(used)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `index.html is missing: ${missing.join(', ')}`);
});

test('the ids in index.html are unique', () => {
  const all = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], [], 'duplicate ids break getElementById wiring');
});

test('every id has a label, and every button declares a type', () => {
  for (const m of html.matchAll(/<button\b[^>]*>/g)) {
    assert.match(m[0], /type="(button|submit)"/, `button without type: ${m[0]}`);
  }
  const iconButtons = [...html.matchAll(/<button[^>]*class="icon-btn"[^>]*>/g)];
  for (const m of iconButtons) assert.match(m[0], /aria-label="/, `icon button needs a label: ${m[0]}`);
});

test('style.css is balanced', () => {
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  assert.equal(opens, closes, 'unbalanced braces in style.css');
  assert.ok(css.includes('#stage'), 'the canvas needs sizing');
});

test('index.html loads the game as a module and nothing is inlined', () => {
  assert.match(html, /<script type="module" src="game\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[\s\S]{40,}/, 'no big inline scripts');
});

test('the game never reaches for the network or for storage beyond the high score', () => {
  assert.doesNotMatch(js, /\bfetch\s*\(/, 'static game: no fetch');
  assert.doesNotMatch(js, /XMLHttpRequest|WebSocket|importScripts/);
  const storageKeys = [...js.matchAll(/localStorage\.(?:get|set)Item\(['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(storageKeys)], ['trainguard.best']);
});
