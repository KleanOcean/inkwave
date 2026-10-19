import test from 'node:test';
import assert from 'node:assert/strict';

import { DuelSession } from '../src/tennis/duel.js';

const DT = 1 / 120;

function advance(session, seconds, input = {}, dt = DT) {
  let left = seconds;
  while (left > 1e-10 && session.phase === 'playing') {
    const step = Math.min(dt, left);
    session.update(step, input);
    left -= step;
  }
}

function until(session, predicate, seconds = 8, inputFor = () => ({}), dt = DT) {
  for (let elapsed = 0; elapsed < seconds && session.phase === 'playing'; elapsed += dt) {
    session.update(dt, inputFor());
    if (predicate()) return true;
  }
  return false;
}

function placeHumanReturn(session, overrides = {}) {
  Object.assign(session.ball, {
    x: session.player.x,
    y: 1.25,
    z: session.player.z - 0.6,
    vx: 0,
    vy: 0,
    vz: 2,
    active: true,
    state: 'incoming',
    lastHitter: 'bot',
    ...overrides,
  });
  session.rallyState = 'rally';
  session._servePending = false;
  session._bounceCount = 1;
}

function forcePoint(session, winner) {
  const hitter = winner === 'player' ? 'bot' : 'player';
  Object.assign(session.ball, {
    x: 0,
    y: 0.25,
    z: hitter === 'player' ? 0.05 : -0.05,
    vx: 0,
    vy: 0,
    vz: hitter === 'player' ? -12 : 12,
    active: true,
    state: hitter === 'player' ? 'outgoing' : 'incoming',
    lastHitter: hitter,
  });
  session.rallyState = 'rally';
  session._servePending = false;
  session.update(0.02);
}

function nextPoint(session) {
  advance(session, 1.81);
}

test('starts with the documented snapshot and a manual player serve toss', () => {
  const events = [];
  const session = new DuelSession({ random: () => 0.5, onEvent: (event) => events.push(event) });
  const ready = session.snapshot();
  assert.equal(ready.mode, 'duel');
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(ready.points, { player: 0, bot: 0 });
  session.start();
  assert.equal(session.server, 'player');
  assert.equal(session.rallyState, 'serve');
  assert.equal(session.canServe(), true);
  assert.equal(session.swing(0.5, { x: -2, z: -4.5 }), true);
  assert.equal(session.rallyState, 'toss');
  assert.equal(session.canServe(), false);
  assert.equal(events.at(-1).type, 'serve-toss');
  advance(session, 0.41);
  assert.ok(events.some((event) => event.type === 'serve' && event.actor === 'player'));
  assert.equal(session.ball.lastHitter, 'player');
  assert.equal(session.rallyState, 'rally');
});

test('runs a real serve, bot return, human return, and point flow', () => {
  const events = [];
  const session = new DuelSession({ difficulty: 'normal', random: () => 0.5, onEvent: (event) => events.push(event) });
  session.start();
  const serveTarget = session.predictShot(0.55, { x: 0, z: -9 });
  assert.ok(serveTarget.x < 0 && serveTarget.z >= -6.4 && serveTarget.z < 0);
  session.swing(0.55, { x: 0, z: -9 });
  assert.equal(until(session, () => events.some((event) => event.type === 'hit' && event.actor === 'bot'), 8), true);
  assert.equal(until(
    session,
    () => session.canHit(),
    6,
    () => ({
      moveX: Math.sign(session.ball.x - session.player.x),
      moveZ: Math.sign(session.ball.z - session.player.z),
    }),
  ), true);
  assert.equal(session.swing(0.8, { x: 7, z: -8 }), true);
  assert.equal(until(session, () => events.some((event) => event.type === 'point'), 4), true);
  assert.equal(session.returns, 1);
  assert.ok(session.rally >= 2);
  assert.equal(events.find((event) => event.type === 'point').reason, 'out');
  assert.deepEqual(session.points, { player: 0, bot: 1 });
});

test('bot motion is finite and difficulty changes speed and reaction', () => {
  const make = (difficulty) => {
    const session = new DuelSession({ difficulty, random: () => 0.5 });
    session.start();
    placeHumanReturn(session);
    session.ball.lastHitter = 'player';
    session.ball.state = 'outgoing';
    session.ball.x = 4.5;
    session.ball.z = -4;
    session.ball.y = 3;
    session.ball.vz = -3;
    session.ball.vy = 1;
    session._botReaction = session.settings.reaction;
    return session;
  };
  const easy = make('easy');
  const normal = make('normal');
  advance(easy, 0.6);
  advance(normal, 0.6);
  assert.ok(normal.bot.x > easy.bot.x);
  assert.ok(normal.bot.x < 4.5, 'normal bot must move rather than teleport');
  assert.ok(easy.bot.x >= 0 && easy.bot.x < 4.5);
});

test('serve order is player, bot twice, then player twice', () => {
  const session = new DuelSession({ random: () => 0.5 });
  session.start();
  assert.equal(session.server, 'player');
  forcePoint(session, 'bot');
  nextPoint(session);
  assert.equal(session.server, 'bot');
  forcePoint(session, 'player');
  nextPoint(session);
  assert.equal(session.server, 'bot');
  forcePoint(session, 'bot');
  nextPoint(session);
  assert.equal(session.server, 'player');
  forcePoint(session, 'player');
  nextPoint(session);
  assert.equal(session.server, 'player');
});

test('underpowered service fault is one fault and receiving a serve on the volley loses the point', () => {
  const events = [];
  const fault = new DuelSession({ random: () => 0.5, onEvent: (event) => events.push(event) });
  fault.start();
  fault.swing(0.05, { x: 0, z: -9 });
  assert.equal(until(fault, () => fault.rallyState === 'between', 4), true);
  assert.deepEqual(fault.points, { player: 0, bot: 1 });
  assert.equal(events.find((event) => event.type === 'point').reason, 'serve-fault');

  const volleyEvents = [];
  const volley = new DuelSession({ onEvent: (event) => volleyEvents.push(event) });
  volley.start();
  placeHumanReturn(volley, { lastHitter: 'bot' });
  volley._servePending = true;
  volley._bounceCount = 0;
  assert.equal(volley.swing(0.5, { x: 0, z: -6 }), false);
  assert.deepEqual(volley.points, { player: 0, bot: 1 });
  assert.equal(volleyEvents.find((event) => event.type === 'point').reason, 'serve-volley');
});

test('serve side is captured at launch and the player cannot move during the toss', () => {
  const events = [];
  const session = new DuelSession({ random: () => 0.5, onEvent: (event) => events.push(event) });
  session.start();
  const serveX = session.player.x;
  session.swing(0.55, { x: 0, z: -9 });
  advance(session, 0.2, { moveX: -1 });
  assert.equal(session.player.x, serveX, 'server movement is frozen while the toss is attached to the body');
  advance(session, 0.21, { moveX: -1 });
  assert.equal(session.rallyState, 'rally');
  assert.equal(until(session, () => events.some((event) => event.type === 'bounce'), 2, () => ({ moveX: -1 })), true);
  assert.ok(session.player.x < 0, 'the player crossed center after striking the serve');
  assert.equal(events.some((event) => event.type === 'point' && event.reason === 'serve-fault'), false);
});

test('bot movement predicts the airborne landing instead of chasing the current ball position', () => {
  const session = new DuelSession({ difficulty: 'normal', random: () => 0.5 });
  session.start();
  Object.assign(session.ball, {
    x: -4,
    y: 4,
    z: -4,
    vx: 4,
    vy: 2,
    vz: -3,
    active: true,
    state: 'outgoing',
    lastHitter: 'player',
  });
  session.rallyState = 'rally';
  session._servePending = false;
  session._botReaction = 0;
  session.update(0.1);
  assert.ok(session.ball.x < 0 && session.ball.y > 3, 'ball remains left and airborne during the observation');
  assert.ok(session.bot.x > 0, 'bot leads toward the predicted right-side landing');
});

test('net, out, and double bounce award exactly one point each', () => {
  for (const [reason, setup] of [
    ['net', { x: 0, y: 0.2, z: 0.04, vx: 0, vy: 0, vz: -10 }],
    ['out', { x: 6, y: 0.14, z: -6, vx: 0, vy: -1, vz: 0 }],
    ['double-bounce', { x: 0, y: 0.14, z: -6, vx: 0, vy: -1, vz: 0 }],
  ]) {
    const events = [];
    const session = new DuelSession({ onEvent: (event) => events.push(event) });
    session.start();
    Object.assign(session.ball, { ...setup, active: true, state: 'outgoing', lastHitter: 'player' });
    session.rallyState = 'rally';
    session._servePending = false;
    session._bounceCount = reason === 'double-bounce' ? 1 : 0;
    session.update(0.04);
    const first = { ...session.points };
    session.update(1);
    assert.deepEqual(session.points, first);
    assert.equal(events.filter((event) => event.type === 'point').length, 1);
    assert.equal(events.find((event) => event.type === 'point').reason, reason);
  }
});

test('match requires seven points and a two-point lead', () => {
  const session = new DuelSession();
  session.start();
  for (let i = 0; i < 6; i += 1) {
    forcePoint(session, 'player'); nextPoint(session);
    forcePoint(session, 'bot'); nextPoint(session);
  }
  assert.deepEqual(session.points, { player: 6, bot: 6 });
  forcePoint(session, 'player'); nextPoint(session);
  assert.equal(session.phase, 'playing');
  assert.equal(session.winner, null);
  forcePoint(session, 'player');
  assert.equal(session.phase, 'finished');
  assert.equal(session.winner, 'player');
  assert.deepEqual(session.points, { player: 8, bot: 6 });
  const frozen = session.snapshot();
  session.update(20, { moveX: 1, moveZ: -1 });
  assert.deepEqual(session.snapshot(), frozen);
});

test('pause freezes all clocks and restart resets the match', () => {
  const session = new DuelSession();
  session.start();
  session.swing(0.5, { x: -2, z: -4.5 });
  advance(session, 0.2, { moveX: 1 });
  session.pause();
  const frozen = session.snapshot();
  session.update(10, { moveX: -1, moveZ: -1 });
  assert.deepEqual(session.snapshot(), { ...frozen, phase: 'paused' });
  session.resume();
  advance(session, 0.1);
  assert.ok(session.elapsed > frozen.elapsed);
  session.points.player = 5;
  session.start();
  assert.deepEqual(session.points, { player: 0, bot: 0 });
  assert.equal(session.elapsed, 0);
  assert.equal(session.rallyState, 'serve');
  assert.equal(session.canServe(), true);
});

test('prediction is deterministic and contact offset plus charge alter the shot', () => {
  let randomCalls = 0;
  const session = new DuelSession({ random: () => { randomCalls += 1; return 0.75; } });
  session.start();
  placeHumanReturn(session, { x: session.player.x + 1.6 });
  const a = session.predictShot(0.2, { x: 0, z: -7 });
  const b = session.predictShot(0.2, { x: 0, z: -7 });
  const hard = session.predictShot(0.9, { x: 0, z: -7 });
  assert.deepEqual(a, b);
  assert.equal(randomCalls, 0);
  assert.notEqual(a.z, hard.z);
  assert.ok(a.quality < 1);
  assert.notEqual(a.x, 0);
  session.swing(0.2, { x: 0, z: -7 });
  const softSpeed = Math.hypot(session.ball.vx, session.ball.vz);

  const centered = new DuelSession({ random: () => 0.5 });
  centered.start();
  placeHumanReturn(centered);
  const centeredPrediction = centered.predictShot(0.2, { x: 0, z: -7 });
  assert.ok(centeredPrediction.quality > a.quality);
  const high = new DuelSession({ random: () => 0.5 });
  high.start();
  placeHumanReturn(high);
  high.swing(0.9, { x: 0, z: -7 });
  assert.ok(Math.hypot(high.ball.vx, high.ball.vz) > softSpeed);
});

test('fixed substeps are stable across update partitions', () => {
  const create = () => {
    const session = new DuelSession({ random: () => 0.5 });
    session.start();
    session.swing(0.5, { x: -2, z: -4.5 });
    return session;
  };
  const fine = create();
  const coarse = create();
  advance(fine, 2.2, { moveX: 1, moveZ: -1 }, 1 / 240);
  advance(coarse, 2.2, { moveX: 1, moveZ: -1 }, 0.2);
  const a = fine.snapshot();
  const b = coarse.snapshot();
  assert.ok(Math.abs(a.elapsed - b.elapsed) < 1e-8);
  assert.deepEqual(a.points, b.points);
  for (const actor of ['player', 'bot']) {
    assert.ok(Math.abs(a[actor].x - b[actor].x) < 1e-8);
    assert.ok(Math.abs(a[actor].z - b[actor].z) < 1e-8);
  }
  for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) assert.ok(Math.abs(a.ball[key] - b.ball[key]) < 1e-7, key);
});
