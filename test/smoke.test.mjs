import test from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness.mjs';

const { key } = installDom();
const { default: _unused } = { default: null }; // keep linters quiet about the stub import order
void _unused;

await import('../game.js');
const TG = globalThis.window.__TG;

assert.ok(TG, 'game.js should expose window.__TG after boot');

const DT = 1 / 60;
const step = (frames, each) => {
  for (let i = 0; i < frames; i++) {
    if (each) each(i);
    TG.step(DT);
  }
};

/** Plays like a competent guard: opens doors when people wait, closes them when empty,
 *  and sprints to steady anyone who trips. */
function autoplayStep() {
  const w = TG.world;
  if (TG.game.state !== 'playing') return;

  const tripped = w.passengers
    .filter((p) => p.stumble > 0 && p.onboard)
    .sort((a, b) => Math.hypot(a.x - TG.player.x, a.y - TG.player.y)
      - Math.hypot(b.x - TG.player.x, b.y - TG.player.y))[0];

  if (tripped) {
    const dist = Math.hypot(tripped.x - TG.player.x, tripped.y - TG.player.y);
    if (dist > 34) {
      TG.player.x += ((tripped.x - TG.player.x) / dist) * 220 * DT;
      TG.player.y += ((tripped.y - TG.player.y) / dist) * 220 * DT;
      TG.setSteady(false);
    } else {
      TG.setSteady(true);
    }
  } else {
    TG.setSteady(false);
    if (w.phase === 'dwell') {
      const waiting = w.passengers.some((p) => !p.gone && (!p.onboard || p.leaving));
      const shut = TG.doors.every((d) => d.target === 0);
      const wide = TG.doors.every((d) => d.target === 1);
      if (waiting && shut) {
        TG.toggleDoors('top');
        TG.toggleDoors('bottom');
      } else if (!waiting && wide) {
        TG.toggleDoors('top');
        TG.toggleDoors('bottom');
      }
    }
  }
  TG.step(DT);
}

function autoplay(frames) {
  for (let i = 0; i < frames; i++) autoplayStep();
}

/** Advance with the bot until `predicate` holds. Bounded, with a real diagnostic
 *  instead of a wall-clock race (a stop cycle is dwell + depart + cruise + brake,
 *  and cruise alone is randomised between 7 and 11 seconds). */
function playUntil(predicate, { maxSeconds = 60, label = 'condition' } = {}) {
  const frames = Math.round(maxSeconds * 60);
  for (let i = 0; i < frames; i++) {
    if (predicate()) return i / 60;
    autoplayStep();
  }
  const w = TG.world;
  assert.fail(
    `timed out after ${maxSeconds}s waiting for ${label} ` +
    `(phase=${w.phase}, speed=${w.speed.toFixed(2)}, stops=${TG.game.stops}, dwell=${w.dwell.toFixed(1)})`,
  );
}

test('the game boots into the title screen with nothing running', () => {
  assert.equal(TG.game.state, 'title');
  assert.equal(TG.world.passengers.length, 0);
});

test('starting a shift seats the coach and fills the platform', () => {
  TG.startGame();
  assert.equal(TG.game.state, 'playing');
  assert.equal(TG.game.hearts, 5);
  assert.ok(TG.world.passengers.some((p) => p.seated), 'some passengers should start seated');
  assert.ok(TG.world.passengers.some((p) => !p.onboard), 'the platform should have a queue');
  assert.equal(TG.world.phase, 'dwell');
});

test('doors are interlocked while the train is moving', () => {
  TG.startGame();
  step(10);
  TG.world.phase = 'cruise';
  TG.world.speed = 0.8;
  const before = TG.doors.map((d) => d.target);
  TG.toggleDoors('top');
  assert.deepEqual(TG.doors.map((d) => d.target), before, 'targets must not change while moving');
  TG.world.phase = 'dwell';
  TG.world.speed = 0;
});

test('opening doors boards the queue and closing them departs the stop', () => {
  TG.startGame();
  const boarders = TG.world.boardersSent;
  assert.ok(boarders > 0);

  TG.toggleDoors('top');
  TG.toggleDoors('bottom');
  step(60 * 6);
  assert.ok(TG.world.passengers.filter((p) => p.onboard).length > boarders * 0.5, 'most of the queue should be aboard');

  // boarding should complete and the doors close on their own once the queue is in
  const departedIn = playUntil(() => TG.world.phase !== 'dwell', { label: 'departure from stop 0' });
  assert.ok(departedIn < 20, `should depart promptly, took ${departedIn.toFixed(1)}s`);

  const arrivedIn = playUntil(() => TG.game.stops >= 1, { label: 'arrival at the next stop' });
  assert.ok(arrivedIn < 20, `should reach the next stop promptly, took ${arrivedIn.toFixed(1)}s`);
  assert.ok(TG.game.score > 0, 'boarding people should score');
});

test('a three minute shift stays finite, well-formed, and survivable', () => {
  TG.startGame();
  autoplay(60 * 180);

  assert.ok(TG.game.stops >= 3, `expected several stops, got ${TG.game.stops}`);
  assert.ok(Number.isFinite(TG.game.score));

  for (const p of TG.world.passengers) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'passenger position must stay finite');
    assert.ok(Number.isFinite(p.bal), 'balance must stay finite');
    assert.ok(!Number.isNaN(p.stumble) && !Number.isNaN(p.down));
    assert.ok(p.x > -120 && p.x < 1100 && p.y > -120 && p.y < 780, `passenger escaped the coach at ${p.x},${p.y}`);
  }

  assert.ok(TG.game.hearts >= 0 && TG.game.hearts <= 5);
  assert.ok(TG.game.state === 'playing' || TG.game.state === 'over');
  assert.ok(['dwell', 'depart', 'cruise', 'brake'].includes(TG.world.phase));
});

test('running out of safety rating ends the shift and records a best', () => {
  TG.startGame();

  // stand somebody up and trip them with one heart left
  const victim = TG.world.passengers.find((p) => p.onboard);
  assert.ok(victim, 'the coach should be occupied');
  if (victim.seat) { victim.seat.taken = null; victim.seat = null; }
  if (victim.spot) { victim.spot.taken = null; victim.spot = null; }
  victim.seated = false;
  victim.state = 'stand';
  victim.stumble = 0.05;
  victim.stumbleMax = 1;
  TG.player.x = 10;
  TG.player.y = 10;
  TG.setSteady(false);

  TG.game.hearts = 1;
  step(30);

  assert.equal(TG.game.hearts, 0);
  assert.equal(TG.game.state, 'over');
  assert.ok(TG.game.best >= TG.game.score);
  assert.notEqual(
    globalThis.document.getElementById('overlayOver').className,
    'hidden',
    'the shift-over overlay should be visible',
  );
});

test('keyboard shortcuts wire up: doors, steady and pause', () => {
  TG.startGame();
  step(5);
  key('keydown', 'KeyQ');
  assert.ok(TG.doors.filter((d) => d.side === 'top').every((d) => d.target === 1), 'Q opens the north doors');
  key('keydown', 'KeyQ');
  assert.ok(TG.doors.filter((d) => d.side === 'top').every((d) => d.target === 0), 'Q closes them again');

  key('keydown', 'Space');
  assert.equal(TG.player.steady, true);
  key('keyup', 'Space');
  assert.equal(TG.player.steady, false);

  key('keydown', 'KeyP');
  assert.equal(TG.game.state, 'paused');
  key('keydown', 'KeyP');
  assert.equal(TG.game.state, 'playing');
});

test('the renderer runs a full frame without throwing', () => {
  TG.startGame();
  step(30);
  assert.doesNotThrow(() => {
    TG.render();
    TG.toggleDoors('top');
    TG.setSteady(true);
    TG.render();
  });
  TG.setSteady(false);
});
