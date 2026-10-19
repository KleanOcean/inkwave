import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/build/three.module.js';

const three = new vm.SyntheticModule(Object.keys(THREE), function () {
  for (const [key, value] of Object.entries(THREE)) this.setExport(key, value);
});
const module = new vm.SourceTextModule(await readFile(new URL('../src/tennis/effects.js', import.meta.url), 'utf8'));
await module.link((specifier) => {
  assert.equal(specifier, 'three');
  return three;
});
await module.evaluate();
const { TennisEffects } = module.namespace;
const ball = { active: true, state: 'rally', x: 1, y: 1, z: 5, vx: 2, vy: 3, vz: -18, lastHitter: 'player' };
const context = { camera: new THREE.PerspectiveCamera(), playing: true, player: { x: 0, z: 9 } };
context.camera.position.set(0, 23, 29);
context.camera.lookAt(0, 0, 0);

test('a real contact creates broad geometry, colored paint, and visible ink drops', () => {
  const effects = new TennisEffects(new THREE.Scene());
  effects.notify({ type: 'serve', actor: 'player', x: 1, y: 2, z: 9, charge: 1 });
  effects.update(1 / 30, ball, {}, context);
  effects.update(1 / 30, { ...ball, z: 4 }, {}, context);
  const state = effects.diagnostics();
  assert.ok(state.activeParticles > 20);
  assert.equal(state.activePaint, 1);
  assert.equal(state.racketTrailsVisible, 1);
  assert.ok(effects.ballTrail.isMesh, 'trail must have world-space width, unlike a one-pixel line');
  const positions = effects.trailGeometry.attributes.position.array;
  assert.ok([...positions].every(Number.isFinite));
  assert.ok(Math.hypot(...[0, 1, 2].map((axis) => positions[102 + axis] - positions[105 + axis])) > 0.3);
  assert.equal(effects.particles.material.vertexColors, false);
  assert.equal(effects.paint.material.vertexColors, false);
  const color = new THREE.Color();
  effects.paint.getColorAt(0, color);
  assert.equal(color.getHexString(), 'ff4a45');
});

test('rapid contacts reuse a bounded number of GPU resources and expire', () => {
  const scene = new THREE.Scene();
  const effects = new TennisEffects(scene);
  const objects = scene.children.length;
  const resources = scene.children.map((object) => object.geometry);
  for (let i = 0; i < 200; i++) {
    effects.notify({ type: 'hit', actor: i % 2 ? 'bot' : 'player', x: 0, y: 1, z: 3, charge: 1 });
    effects.notify({ type: 'bounce', x: 2, z: -4 });
    effects.update(1 / 30, ball, {}, context);
  }
  assert.equal(scene.children.length, objects);
  assert.deepEqual(scene.children.map((object) => object.geometry), resources);
  assert.ok(effects.diagnostics().activeParticles <= effects.diagnostics().particleCapacity);
  assert.ok(effects.diagnostics().activePaint <= effects.diagnostics().paintCapacity);
  for (let i = 0; i < 140; i++) effects.update(0.1, { active: false }, {}, context);
  assert.equal(effects.isAnimating(), false);
  assert.equal(effects.diagnostics().activeParticles, 0);
  assert.equal(effects.diagnostics().activePaint, 0);
  assert.equal(effects.diagnostics().racketTrailsVisible, 0);
  assert.equal(effects.diagnostics().activeRings, 0);
});

test('effects off clears live trails, charge aura, ink and particles immediately', () => {
  const effects = new TennisEffects(new THREE.Scene());
  effects.notify({ type: 'finish', winner: 'player', points: { player: 7, bot: 4 } });
  effects.update(0.1, ball, {}, { ...context, charging: true, charge: 1 });
  assert.equal(effects.diagnostics().chargeAuraVisible, true);
  effects.setEnabled(false);
  const state = effects.diagnostics();
  for (const key of ['trailVisible', 'chargeAuraVisible', 'celebrating']) assert.equal(state[key], false);
  for (const key of ['activeParticles', 'activePaint', 'racketTrailsVisible', 'activeRings']) assert.equal(state[key], 0);
  effects.notify({ type: 'hit', x: 0, y: 1, z: 9 });
  effects.update(0.1, ball, {}, context);
  assert.equal(effects.diagnostics().activeParticles, 0);
  effects.setEnabled(true);
  assert.equal(effects.diagnostics().activePaint, 0, 'old ink must not return when reenabled');
});

test('bounce follows the last hitter color and decorative paint cannot prolong celebration', () => {
  const effects = new TennisEffects(new THREE.Scene());
  effects.notify({ type: 'hit', actor: 'bot', x: 1, y: 1, z: -9 });
  effects.notify({ type: 'bounce', x: 1, z: 6 });
  effects.update(0.1, { active: false }, {}, context);
  const color = new THREE.Color();
  effects.paint.getColorAt(1, color);
  assert.equal(color.getHexString(), '7060ff');
  for (let i = 0; i < 20; i++) effects.update(0.1, { active: false }, {}, context);
  assert.ok(effects.diagnostics().activePaint > 0);
  assert.equal(effects.isAnimating(), false, 'static decals must not keep the idle render loop alive');
  effects.clear();
  assert.equal(effects.diagnostics().activePaint, 0);
});

test('the first shot frame and a throttled frame keep a short visible streak', () => {
  const effects = new TennisEffects(new THREE.Scene());
  for (const position of [{ x: 0, y: 2, z: 9 }, { x: 3, y: 1, z: -7 }]) {
    const movingBall = { ...ball, ...position };
    effects.update(1 / 30, movingBall, {}, context);
    const vertices = effects.trailGeometry.attributes.position.array;
    assert.ok([...vertices].every(Number.isFinite));
    let farthest = 0;
    for (let i = 0; i < vertices.length; i += 3) {
      farthest = Math.max(farthest, Math.hypot(vertices[i] - movingBall.x, vertices[i + 1] - movingBall.y, vertices[i + 2] - movingBall.z));
    }
    assert.ok(farthest > 1, 'a visible streak must not collapse on the first render');
    assert.ok(farthest < 5.3, 'a throttled frame must not create a court-length laser');
  }
});
