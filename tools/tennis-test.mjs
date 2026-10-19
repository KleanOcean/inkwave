import test from 'node:test';
import assert from 'node:assert/strict';

import { COURT, TARGETS, TennisSession } from '../src/tennis/simulation.js';
import { selectGame } from '../src/game-route.js';

const EPS = 1e-8;

test('tennis is the homepage while explicit selections and original developer links remain valid', () => {
  assert.equal(selectGame(), 'tennis');
  assert.equal(selectGame('?game=tennis'), 'tennis');
  assert.equal(selectGame('?game=tennis&shadercheck'), 'tennis');
  assert.equal(selectGame('?mode=tennis'), 'tennis');
  assert.equal(selectGame('?game=inkwave'), 'inkwave');
  for (const link of ['?autostart=60&autopilot', '?nofullscreen', '?map=halyard&time=dusk&skipTitle&shadercheck', '?quality=low']) {
    assert.equal(selectGame(link), 'inkwave', link);
  }
  for (const link of ['?futureFlag', '?beacon', '?utm_source=club', '?v=2']) assert.equal(selectGame(link), 'tennis', link);
  for (const key of ['netmock', 'news', 'env', 'netlag', 'netjitter', 'netspike', 'mockauto', 'mocklat', 'mockfill', 'mockmatch']) {
    assert.equal(selectGame(`?${key}=1`), 'inkwave', key);
    assert.equal(selectGame(`?game=tennis&${key}=1`), 'tennis', key);
  }
});

function advance(session, seconds, dt = 1 / 120, input = {}) {
  let left = seconds;
  while (left > EPS && session.phase === 'playing') {
    const step = Math.min(dt, left);
    session.update(step, input);
    left -= step;
  }
}

function placeIncoming(session, overrides = {}) {
  Object.assign(session.ball, {
    x: 0,
    y: 1.35,
    z: 8.7,
    vx: 0,
    vy: 0,
    vz: 1,
    active: true,
    state: 'incoming',
    ...overrides,
  });
}

function simulateUntil(session, predicate, limit = 10, dt = 1 / 120, input = {}) {
  for (let elapsed = 0; elapsed < limit; elapsed += dt) {
    session.update(dt, input);
    if (predicate()) return true;
  }
  return false;
}

test('exports the court and target contract', () => {
  assert.deepEqual(COURT, { halfWidth: 5.5, halfLength: 12, netHeight: 1, ballRadius: 0.13 });
  assert.deepEqual(TARGETS.map(({ id, points }) => ({ id, points })), [
    { id: 'left', points: 100 },
    { id: 'center', points: 150 },
    { id: 'right', points: 100 },
  ]);
});

test('a real feed can be chased, returned, and scored on its opponent-side bounce', () => {
  const events = [];
  const session = new TennisSession({ random: () => 0.5, onEvent: (event) => events.push(event) });
  session.start();

  assert.equal(simulateUntil(session, () => session.ball.active && session.ball.state === 'incoming', 2), true);
  assert.equal(session.feeds, 1);
  assert.equal(simulateUntil(session, () => session.ball.z > 4.9, 3), true);
  assert.equal(simulateUntil(
    session,
    () => session.ball.y >= 0.3 && session.ball.y <= 2.8
      && Math.hypot(session.ball.x - session.player.x, session.ball.z - session.player.z) <= 2.2,
    1,
    1 / 120,
    { moveX: 0, moveZ: -1 },
  ), true);

  const prediction = session.predictShot(0.5, { x: 0, z: -6 });
  assert.ok(prediction);
  assert.ok(Math.abs(prediction.x) < 0.01);
  assert.ok(Math.abs(prediction.z + 6) < 0.01);
  assert.equal(session.swing(0.5, { x: 0, z: -6 }), true);
  assert.equal(session.returns, 1);
  assert.equal(session.score, 0, 'a hit is not scored until the first opponent-side bounce');

  assert.equal(simulateUntil(session, () => session.score > 0, 3), true);
  assert.equal(session.targetHits, 1);
  assert.equal(session.combo, 1);
  assert.equal(session.score, 150);
  assert.equal(session.ball.active, false);
  assert.ok(events.some((event) => event.type === 'bounce'));
  assert.ok(events.some((event) => event.type === 'score' && event.targetId === 'center'));
});

test('outgoing shots resolve as net and out misses', () => {
  const events = [];
  const session = new TennisSession({ onEvent: (event) => events.push(event) });
  session.start();

  Object.assign(session.ball, { x: 0, y: 0.8, z: 0.2, vx: 0, vy: 0, vz: -8, active: true, state: 'outgoing' });
  session.update(0.1);
  assert.equal(session.misses, 1);
  assert.equal(events.at(-1).reason, 'net');

  Object.assign(session.ball, { x: 6, y: 0.2, z: -5, vx: 0, vy: -2, vz: -1, active: true, state: 'outgoing' });
  session.update(0.1);
  assert.equal(session.misses, 2);
  assert.equal(events.at(-1).reason, 'out');
});

test('incoming second bounce resolves missed and clears combo', () => {
  const session = new TennisSession();
  session.start();
  session.combo = 3;
  Object.assign(session.ball, { x: 0, y: 0.14, z: 8, vx: 0, vy: -1, vz: 2, active: true, state: 'incoming' });
  session._incomingBounces = 1;
  session.update(0.05);
  assert.equal(session.misses, 1);
  assert.equal(session.combo, 0);
  assert.equal(session.ball.active, false);
});

test('swing rejects unreachable balls, cooldown repeats, and repeat hits', () => {
  const session = new TennisSession();
  session.start();

  placeIncoming(session, { x: 5 });
  assert.equal(session.canHit(), false);
  assert.equal(session.swing(), false);
  assert.equal(session.returns, 0);

  placeIncoming(session);
  assert.equal(session.canHit(), true);
  assert.equal(session.swing(), true);
  assert.equal(session.canHit(), false);
  assert.equal(session.swing(), false, 'cooldown and outgoing state reject an immediate repeat');
  assert.equal(session.returns, 1);

  placeIncoming(session);
  advance(session, 0.36);
  assert.equal(session.swing(), true);
  assert.equal(session.returns, 2);
});

test('movement normalizes diagonals and clamps the playable area', () => {
  const session = new TennisSession();
  session.start();
  session.update(0.5, { moveX: 1, moveZ: 1 });
  const diagonalDistance = Math.hypot(session.player.x, session.player.z - 9);
  assert.ok(Math.abs(diagonalDistance - 3.5) < 1e-8);
  assert.ok(Math.abs(session.player.x - (3.5 / Math.sqrt(2))) < 1e-8);

  session.update(10, { moveX: 1, moveZ: -1 });
  assert.deepEqual(session.player, { x: 7, z: 1.8 });
});

test('charge changes shot velocity while both shots maintain the aimed landing', () => {
  const makeShot = (charge) => {
    const session = new TennisSession();
    session.start();
    placeIncoming(session);
    assert.equal(session.swing(charge, { x: 0, z: -6 }), true);
    const horizontalSpeed = Math.hypot(session.ball.vx, session.ball.vz);
    assert.equal(simulateUntil(session, () => !session.ball.active, 3), true);
    return { session, horizontalSpeed };
  };

  const soft = makeShot(0);
  const hard = makeShot(1);
  assert.ok(hard.horizontalSpeed > soft.horizontalSpeed);
  assert.equal(soft.session.score, 150);
  assert.equal(hard.session.score, 150);
  assert.equal(soft.session.targetHits, 1);
  assert.equal(hard.session.targetHits, 1);
});

test('consecutive target multipliers cap at five and preserve best combo', () => {
  const session = new TennisSession();
  session.start();
  for (let hit = 0; hit < 6; hit += 1) {
    Object.assign(session.ball, {
      x: 0,
      y: 0.14,
      z: -6,
      vx: 0,
      vy: -1,
      vz: 0,
      active: true,
      state: 'outgoing',
    });
    session.update(0.02);
  }
  assert.equal(session.targetHits, 6);
  assert.equal(session.combo, 6);
  assert.equal(session.bestCombo, 6);
  assert.equal(session.score, 150 * (1 + 2 + 3 + 4 + 5 + 5));
});

test('a legal non-target return scores 25 and resets the combo', () => {
  const session = new TennisSession();
  session.start();
  session.combo = 3;
  session.bestCombo = 3;
  Object.assign(session.ball, {
    x: 0,
    y: 0.14,
    z: -10.5,
    vx: 0,
    vy: -1,
    vz: 0,
    active: true,
    state: 'outgoing',
  });
  session.update(0.02);
  assert.equal(session.score, 25);
  assert.equal(session.combo, 0);
  assert.equal(session.bestCombo, 3);
  assert.equal(session.misses, 0);
});

test('expiry deactivates a pending shot before it can score', () => {
  const session = new TennisSession({ duration: 0.01 });
  session.start();
  Object.assign(session.ball, {
    x: 0,
    y: 1,
    z: -6,
    vx: 0,
    vy: -1,
    vz: 0,
    active: true,
    state: 'outgoing',
  });
  session.update(1);
  assert.equal(session.phase, 'finished');
  assert.equal(session.score, 0);
  assert.equal(session.targetHits, 0);
  assert.equal(session.ball.active, false);
  session.update(10);
  assert.equal(session.score, 0);
});

test('pause/resume freezes and restart resets all mutable state', () => {
  const session = new TennisSession({ duration: 12 });
  session.start();
  advance(session, 1.2, 1 / 60, { moveX: 1, moveZ: -1 });
  const frozen = session.snapshot();
  assert.equal(session.pause(), true);
  session.update(5, { moveX: -1, moveZ: 1 });
  assert.deepEqual(session.snapshot(), { ...frozen, phase: 'paused' });
  assert.equal(session.resume(), true);
  session.update(0.1);
  assert.ok(session.elapsed > frozen.elapsed);

  session.score = 999;
  session.combo = 4;
  session.start();
  assert.equal(session.phase, 'playing');
  assert.equal(session.remaining, 12);
  assert.equal(session.elapsed, 0);
  assert.deepEqual(session.player, { x: 0, z: 9 });
  assert.equal(session.score, 0);
  assert.equal(session.combo, 0);
  assert.equal(session.ball.active, false);
});

test('exact duration expiry finishes once and freezes timer, movement, and scoring', () => {
  const events = [];
  const session = new TennisSession({ duration: 1, onEvent: (event) => events.push(event) });
  session.start();
  session.update(1, { moveX: 1 });
  assert.equal(session.phase, 'finished');
  assert.equal(session.elapsed, 1);
  assert.equal(session.remaining, 0);
  assert.equal(session.ball.active, false);
  const frozen = session.snapshot();
  session.update(30, { moveX: -1, moveZ: -1 });
  assert.deepEqual(session.snapshot(), frozen);
  assert.equal(events.filter((event) => event.type === 'finish').length, 1);
});

test('fixed substeps make deterministic updates stable across dt partitions', () => {
  const create = () => {
    const session = new TennisSession({ random: () => 0.5 });
    session.start();
    return session;
  };
  const fine = create();
  const coarse = create();
  advance(fine, 2.4, 1 / 240, { moveX: 1, moveZ: -1 });
  advance(coarse, 2.4, 0.4, { moveX: 1, moveZ: -1 });

  const a = fine.snapshot();
  const b = coarse.snapshot();
  assert.ok(Math.abs(a.elapsed - b.elapsed) < EPS);
  assert.ok(Math.abs(a.remaining - b.remaining) < EPS);
  assert.ok(Math.abs(a.player.x - b.player.x) < EPS);
  assert.ok(Math.abs(a.player.z - b.player.z) < EPS);
  for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.ok(Math.abs(a.ball[key] - b.ball[key]) < 1e-7, key);
});
