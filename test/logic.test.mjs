import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALANCE,
  STATIONS,
  applyJolt,
  createRider,
  difficultyFor,
  resolveJolt,
  scoreStop,
  stepBalance,
  tripChance,
} from '../game.js';

const DT = 1 / 60;

/** Run the balance model until something interesting happens. */
function run(rider, { held = () => false, seconds = 4 } = {}) {
  const seen = [];
  for (let t = 0; t < seconds; t += DT) {
    const result = stepBalance(rider, DT, held(t));
    seen.push(result);
    if (result === 'fall' || result === 'saved') break;
  }
  return seen;
}

test('tripChance is a bounded ramp, not a coin flip', () => {
  assert.equal(tripChance(0), 0);
  assert.equal(tripChance(BALANCE.tripFloor), 0);
  assert.ok(tripChance(BALANCE.tripFloor + BALANCE.tripSpan * 0.5) > 0.1);
  assert.equal(tripChance(99), BALANCE.tripMax);
  // monotonic
  let prev = -1;
  for (let risk = 0; risk <= 2; risk += 0.05) {
    const c = tripChance(risk);
    assert.ok(c >= prev, `tripChance must never decrease (risk ${risk})`);
    prev = c;
  }
});

test('small jolts wobble, hard jolts trip', () => {
  const soft = createRider();
  assert.notEqual(applyJolt(soft, 1, 0.2), 'stumble');
  assert.equal(soft.stumble, 0);

  let trips = 0;
  for (let i = 0; i < 200; i++) {
    const rider = createRider();
    if (applyJolt(rider, 1, 2) === 'stumble') trips++;
  }
  assert.ok(trips > 150, `a 2.0 jolt should reliably trip riders (got ${trips}/200)`);
});

test('one bump can never wipe the coach', () => {
  const riders = Array.from({ length: 12 }, () => createRider({ grip: 2 }));
  const tripped = resolveJolt(riders, 1, 5);
  assert.equal(tripped, BALANCE.tripsPerJolt);
  assert.equal(riders.filter((r) => r.stumble > 0).length, BALANCE.tripsPerJolt);
  // everyone still got shoved, tripped or not
  assert.ok(riders.every((r) => Math.abs(r.balv) > 0));
});

test('resolveJolt picks the least steady riders first', () => {
  const steady = Array.from({ length: 6 }, () => createRider({ grip: 0.1 }));
  const wobbly = Array.from({ length: 6 }, () => createRider({ grip: 3 }));
  resolveJolt([...steady, ...wobbly], 1, 2);
  assert.equal(steady.filter((r) => r.stumble > 0).length, 0, 'steady riders keep their feet');
  assert.equal(wobbly.filter((r) => r.stumble > 0).length, BALANCE.tripsPerJolt);
});

test('higher grip means more risk', () => {
  const low = createRider({ grip: 0.2 });
  const high = createRider({ grip: 1.2 });
  applyJolt(low, 1, 1);
  applyJolt(high, 1, 1);
  assert.ok(Math.abs(high.balv) > Math.abs(low.balv));
});

test('an unattended stumble ends on the floor, then recovers', () => {
  const rider = createRider();
  applyJolt(rider, 1, 2, true); // force the trip: this test is about what happens next
  assert.ok(rider.stumble > 0);

  const states = run(rider);
  assert.equal(states.at(-1), 'fall');
  assert.ok(rider.down > 0);

  run(rider, { seconds: 2 });
  assert.equal(rider.down, 0);
  assert.equal(rider.bal, 0);
  assert.equal(rider.stumble, 0);
});

test('a guard holding on cancels a stumble, but only inside the window', () => {
  const early = createRider();
  applyJolt(early, 1, 2, true);
  assert.equal(run(early, { held: () => true }).at(-1), 'saved');
  assert.equal(early.down, 0);

  const late = createRider();
  applyJolt(late, 1, 2, true);
  const tooLate = run(late, { held: (t) => t > BALANCE.stumble });
  assert.equal(tooLate.at(-1), 'fall');
});

test('a held rider cannot fall', () => {
  const rider = createRider();
  for (let i = 0; i < 8; i++) {
    applyJolt(rider, i % 2 ? -1 : 1, 2, true);
    run(rider, { held: () => true, seconds: 0.5 });
    assert.equal(rider.down, 0);
  }
});

test('a rider on the floor cannot be re-tripped', () => {
  const rider = createRider();
  rider.down = 1;
  assert.equal(applyJolt(rider, 1, 3), 'none');
});

test('walking riders are harder to trip than standing ones', () => {
  let standing = 0;
  let walking = 0;
  for (let i = 0; i < 400; i++) {
    const a = createRider({ state: 'stand' });
    const b = createRider({ state: 'walk' });
    if (applyJolt(a, 1, 0.95) === 'stumble') standing++;
    if (applyJolt(b, 1, 0.95) === 'stumble') walking++;
  }
  assert.ok(standing > walking * 2, `standing ${standing} should trip far more than walking ${walking}`);
});

test('scoreStop rewards exchange and punctuality, punishes stragglers', () => {
  const clean = scoreStop({ boarded: 4, alighted: 3, missed: 0, dwellLeft: 9, dwellMax: 18 });
  assert.equal(clean.exchange, 56);
  assert.equal(clean.punctual, 30);
  assert.equal(clean.penalty, 0);
  assert.equal(clean.total, 86);

  const missed = scoreStop({ boarded: 2, alighted: 1, missed: 3, dwellLeft: 9, dwellMax: 18 });
  assert.equal(missed.punctual, 0, 'left-behind passengers kill the punctuality bonus');
  assert.equal(missed.penalty, 30);
  assert.equal(missed.total, 24 - 30);
});

test('scoreStop never returns NaN on degenerate input', () => {
  const s = scoreStop({ boarded: 0, alighted: 0, missed: 0, dwellLeft: 0, dwellMax: 0 });
  assert.ok(Number.isFinite(s.total));
});

test('difficulty ramps and then plateaus', () => {
  const first = difficultyFor(0);
  const mid = difficultyFor(6);
  const late = difficultyFor(20);
  assert.ok(mid.force > first.force);
  assert.ok(mid.bumpMin < first.bumpMin);
  assert.equal(late.force, difficultyFor(11).force, 'force plateaus at stop 10');
  assert.ok(first.dwell > late.dwell);
  assert.ok(difficultyFor(-5).force === first.force, 'negative stops are clamped');
});

test('stations are a sane, non-empty list', () => {
  assert.ok(STATIONS.length >= 10);
  for (const name of STATIONS) assert.ok(name.trim().length > 0);
  assert.equal(new Set(STATIONS).size, STATIONS.length);
});
