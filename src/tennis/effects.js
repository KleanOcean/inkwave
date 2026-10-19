import * as THREE from 'three';

const CORAL = new THREE.Color('#ff4a45');
const VIOLET = new THREE.Color('#7060ff');
const LIME = new THREE.Color('#e5f67a');
const CREAM = new THREE.Color('#fffce5');
const TEAM = { player: CORAL, bot: VIOLET };
const SAMPLES = 18;

function ribbonGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(SAMPLES * 6);
  const indices = [];
  for (let i = 0; i < SAMPLES - 1; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  return geometry;
}

// A single flat ink silhouette, including satellite drops, shared by the decal pool.
function splatGeometry() {
  const vertices = [];
  const disc = (x, z, radius, segments, irregular = false) => {
    const point = (i) => {
      const angle = i / segments * Math.PI * 2;
      const r = radius * (irregular ? 0.78 + Math.sin(angle * 7) * 0.14 + Math.cos(angle * 11) * 0.08 : 1);
      return [x + Math.cos(angle) * r, 0, z + Math.sin(angle) * r];
    };
    for (let i = 0; i < segments; i++) vertices.push(x, 0, z, ...point(i + 1), ...point(i));
  };
  disc(0, 0, 1, 56, true);
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.399;
    const radius = 1.04 + (i % 3) * 0.12;
    disc(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.07 + (i % 3) * 0.045, 9);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function slashGeometry() {
  const positions = [], indices = [];
  for (let i = 0; i <= 32; i++) {
    const p = i / 32;
    const angle = -1.5 + p * 3.9;
    const width = Math.sin(p * Math.PI) * 0.5;
    positions.push(Math.cos(angle) * (1.15 - width), Math.sin(angle) * (1.15 - width), 0);
    positions.push(Math.cos(angle) * (1.15 + width * 0.32), Math.sin(angle) * (1.15 + width * 0.32), 0);
    if (i < 32) { const v = i * 2; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function inkMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
}

// Fixed pools: no event allocates geometry, material, texture or a render target.
export class TennisEffects {
  constructor(scene) {
    this.enabled = true;
    this.time = 0;
    this.lastActor = 'player';
    this.history = new Float32Array(SAMPLES * 3);
    this.trailGeometry = ribbonGeometry();
    this.trailMaterial = inkMaterial(CORAL, 0.94);
    this.ballTrail = new THREE.Mesh(this.trailGeometry, this.trailMaterial);
    this.ballTrail.frustumCulled = false;
    this.ballTrail.renderOrder = 2;
    scene.add(this.ballTrail);
    this.ballHalo = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), inkMaterial(LIME, 0.24));
    scene.add(this.ballHalo);

    this.racketTrails = ['player', 'bot'].map((actor) => {
      const mesh = new THREE.Mesh(slashGeometry(), inkMaterial(TEAM[actor], 0.95));
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      return { actor, mesh, age: 9, life: 0.52, size: 1, twist: 0 };
    });

    const capacity = 96;
    // instanceColor is handled by InstancedMesh; a vertexColors flag would turn
    // these black because the shared geometry deliberately has no color attribute.
    this.particles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), inkMaterial('#ffffff'), capacity);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.particles.frustumCulled = false;
    this.particleState = Array.from({ length: capacity }, () => ({ active: false, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0 }));
    this.particleCursor = 0;
    scene.add(this.particles);

    this.paint = new THREE.InstancedMesh(splatGeometry(), inkMaterial('#ffffff', 0.86), 32);
    this.paint.frustumCulled = false;
    this.paint.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.paintState = Array.from({ length: 32 }, () => ({ active: false, age: 0, life: 12, x: 0, z: 0, size: 0, rotation: 0 }));
    this.paintCursor = 0;
    scene.add(this.paint);

    const ringGeometry = new THREE.RingGeometry(0.8, 1, 40);
    this.rings = Array.from({ length: 6 }, () => {
      const mesh = new THREE.Mesh(ringGeometry, inkMaterial(LIME, 0.9));
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      return { mesh, age: 9, life: 0.6, size: 1 };
    });
    this.ringCursor = 0;
    this.chargeAura = new THREE.Group();
    this.chargeAura.add(new THREE.Mesh(new THREE.RingGeometry(0.98, 1.12, 48), inkMaterial(CORAL, 0.9)));
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.86, 36, 1, 0, Math.PI * 1.5), inkMaterial(CREAM));
    inner.position.z = 0.004;
    this.chargeAura.add(inner);
    this.chargeAura.rotation.x = -Math.PI / 2;
    scene.add(this.chargeAura);
    this.chargeDust = 0;
    this.matrix = new THREE.Matrix4();
    this.scale = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.direction = new THREE.Vector3();
    this.view = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.clear();
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (this.enabled && !next) this.clear();
    this.enabled = next;
  }

  clear() {
    this.hasLastBall = false;
    this.ballTrail.visible = false;
    this.ballHalo.visible = false;
    for (const trail of this.racketTrails) { trail.mesh.visible = false; trail.age = 9; }
    for (const particle of this.particleState) particle.active = false;
    this.particles.count = 0;
    for (const mark of this.paintState) mark.active = false;
    this.paint.count = 0;
    for (const ring of this.rings) { ring.mesh.visible = false; ring.age = 9; }
    this.chargeAura.visible = false;
    this.chargeDust = 0;
    this.celebrationUntil = 0;
    this.lastActor = 'player';
  }

  spawnParticles(x, y, z, color, count = 22, celebration = false) {
    for (let index = 0; index < count; index++) {
      const slot = this.particleCursor++ % this.particleState.length;
      const angle = index * 2.399 + this.time * 5;
      const speed = (celebration ? 3.8 : 2.3) + (index % 4) * 0.65;
      Object.assign(this.particleState[slot], {
        active: true, age: 0, life: celebration ? 1.4 : 0.65,
        x, y, z, vx: Math.cos(angle) * speed,
        vy: (celebration ? 4.8 : 2.5) + (index % 5) * 0.4,
        vz: Math.sin(angle) * speed,
        size: (celebration ? 0.2 : 0.14) + (index % 3) * 0.035,
      });
      this.particles.setColorAt(slot, index % 5 === 0 ? CREAM : color);
    }
    this.particles.instanceColor.needsUpdate = true;
  }

  stamp(x, z, color, size = 1) {
    const slot = this.paintCursor++ % this.paintState.length;
    Object.assign(this.paintState[slot], { active: true, age: 0, x, z, size, rotation: slot * 2.399 });
    this.paint.setColorAt(slot, color);
    this.paint.instanceColor.needsUpdate = true;
  }

  pulse(x, z, color, size = 1) {
    const ring = this.rings[this.ringCursor++ % this.rings.length];
    Object.assign(ring, { age: 0, size });
    ring.mesh.position.set(x, 0.065, z);
    ring.mesh.material.color.copy(color);
    ring.mesh.visible = true;
  }

  notify(event) {
    if (!this.enabled || !event) return;
    const actor = event.actor === 'bot' ? 'bot' : 'player';
    const x = event.x || 0, y = event.y ?? 1, z = event.z || 0;
    if (event.type === 'hit' || event.type === 'serve') {
      this.lastActor = actor;
      this.hasLastBall = false;
      const color = TEAM[actor];
      this.spawnParticles(x, y, z, color, event.charge > 0.75 ? 32 : 24);
      this.stamp(x, z, color, 0.75 + (event.charge || 0) * 0.4);
      this.pulse(x, z, color, 0.9);
      const trail = this.racketTrails[actor === 'bot' ? 1 : 0];
      Object.assign(trail, { age: 0, size: 1.2 + (event.charge || 0) * 0.6, twist: event.stroke === 'backhand' ? -0.8 : 0.5 });
      trail.mesh.position.set(x, y + 0.25, z);
      trail.mesh.visible = true;
    } else if (event.type === 'feed') {
      this.lastActor = 'bot';
      this.hasLastBall = false;
    } else if (event.type === 'bounce' || event.type === 'score') {
      const color = event.type === 'score' ? CORAL : TEAM[this.lastActor];
      this.stamp(x, z, color, event.type === 'score' ? 1.5 : 1.1);
      this.pulse(x, z, color, 1.1);
      this.spawnParticles(x, 0.12, z, color, 15);
    } else if (event.type === 'point' || event.type === 'finish') {
      const color = TEAM[event.winner] || CORAL;
      const winnerZ = event.winner === 'bot' ? -8 : 8;
      const atZ = Number.isFinite(event.z) ? z : winnerZ;
      this.spawnParticles(x, event.type === 'finish' ? 1.5 : 0.4, atZ, color, event.type === 'finish' ? 56 : 38, true);
      this.stamp(x, atZ, color, 1.7);
      this.pulse(x, atZ, color, 1.7);
      this.celebrationUntil = this.time + 1.5;
    }
  }

  updateRibbon(ball, camera) {
    if (!ball?.active || ball.state === 'waiting') {
      this.hasLastBall = false;
      this.ballTrail.visible = false;
      this.ballHalo.visible = false;
      return;
    }
    const end = this.history.length - 3;
    const frameJump = Math.hypot(ball.x - this.history[end], ball.y - this.history[end + 1], ball.z - this.history[end + 2]);
    if (!this.hasLastBall || frameJump > 3) {
      // Start with a short velocity streak. It remains visible on the first shot
      // frame and after throttled frames, without connecting across the court.
      const speed = Math.hypot(ball.vx || 0, ball.vy || 0, ball.vz || 0);
      const step = Math.min(0.014, 4 / Math.max(1, speed * (SAMPLES - 1)));
      for (let i = 0; i < SAMPLES; i++) {
        const past = (SAMPLES - 1 - i) * step;
        this.history[i * 3] = ball.x - (ball.vx || 0) * past;
        this.history[i * 3 + 1] = Math.max(0.09, ball.y - (ball.vy || 0) * past - 4.905 * past * past);
        this.history[i * 3 + 2] = ball.z - (ball.vz || 0) * past;
      }
    } else {
      this.history.copyWithin(0, 3);
      this.history[end] = ball.x;
      this.history[end + 1] = ball.y;
      this.history[end + 2] = ball.z;
    }
    this.hasLastBall = true;
    const color = TEAM[ball.lastHitter || this.lastActor] || CORAL;
    this.trailMaterial.color.copy(color);
    const positions = this.trailGeometry.attributes.position.array;
    let length = 0;
    for (let i = SAMPLES - 1; i >= 0; i--) {
      const h = i * 3, next = Math.min(SAMPLES - 1, i + 1) * 3;
      const px = this.history[h], py = this.history[h + 1], pz = this.history[h + 2];
      if (i < SAMPLES - 1) length += Math.hypot(px - this.history[next], py - this.history[next + 1], pz - this.history[next + 2]);
      // Trim to five metres even after a slow frame; avoid a court-length laser.
      const visible = length < 5;
      const prev = Math.max(0, i - 1) * 3;
      this.direction.set(this.history[next] - this.history[prev], this.history[next + 1] - this.history[prev + 1], this.history[next + 2] - this.history[prev + 2]);
      this.view.set((camera?.position.x || 0) - px, (camera?.position.y || 23) - py, (camera?.position.z || 29) - pz);
      this.side.crossVectors(this.direction, this.view).normalize();
      const width = visible ? 0.24 * Math.max(0, 1 - length / 5) : 0;
      // Collapsed tail vertices sit at the preceding visible sample, not in the distance.
      const anchor = visible ? h : next;
      const v = i * 6;
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        positions[v + side * 3] = this.history[anchor] + this.side.x * width * sign;
        positions[v + side * 3 + 1] = this.history[anchor + 1] + this.side.y * width * sign;
        positions[v + side * 3 + 2] = this.history[anchor + 2] + this.side.z * width * sign;
      }
    }
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.ballTrail.visible = true;
    this.ballHalo.visible = true;
    this.ballHalo.position.set(ball.x, ball.y, ball.z);
    this.ballHalo.scale.setScalar(1.2 + Math.sin(this.time * 22) * 0.15);
  }

  update(dt, ball, racketTips = {}, context = {}) {
    if (!this.enabled) return;
    dt = Math.min(0.1, Math.max(0, dt));
    this.time += dt;
    this.updateRibbon(ball, context.camera);
    for (const trail of this.racketTrails) {
      trail.age += dt;
      if (trail.age >= trail.life) { trail.mesh.visible = false; continue; }
      const p = trail.age / trail.life;
      if (context.camera) trail.mesh.quaternion.copy(context.camera.quaternion);
      trail.mesh.rotateZ(trail.twist + p * 1.8);
      trail.mesh.scale.setScalar(trail.size * (0.65 + Math.sin(p * Math.PI * 0.7) * 0.55));
      trail.mesh.material.opacity = Math.max(0, 1 - p * p);
    }
    this.chargeAura.visible = !!context.playing && !!context.charging && !!context.player;
    if (this.chargeAura.visible) {
      const charge = context.charge || 0;
      this.chargeAura.position.set(context.player.x, 0.075, context.player.z);
      this.chargeAura.rotation.z = this.time * (2 + charge * 5);
      this.chargeAura.scale.setScalar(0.8 + charge * 0.65 + Math.sin(this.time * 18) * charge * 0.045);
      this.chargeAura.children[0].material.color.copy(charge > 0.85 ? LIME : CORAL);
      this.chargeDust += dt;
      if (this.chargeDust > 0.13 && charge > 0.15) {
        this.chargeDust = 0;
        const angle = this.time * 8;
        this.spawnParticles(context.player.x + Math.cos(angle), 0.1, context.player.z + Math.sin(angle), charge > 0.85 ? LIME : CORAL, 2);
      }
    } else this.chargeDust = 0;

    let count = 0;
    this.rotation.identity();
    for (let i = 0; i < this.particleState.length; i++) {
      const p = this.particleState[i];
      p.age += dt;
      if (p.age >= p.life) p.active = false;
      if (p.active) {
        p.vy -= 8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const fade = Math.min(1, (1 - p.age / p.life) * 2.5);
        this.position.set(p.x, Math.max(0.07, p.y), p.z);
        this.scale.set(p.size * fade, p.size * fade * (1.3 + Math.abs(p.vy) * 0.08), p.size * fade);
        count = i + 1;
      } else this.scale.setScalar(0);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.particles.setMatrixAt(i, this.matrix);
    }
    this.particles.count = count;
    this.particles.instanceMatrix.needsUpdate = true;

    count = 0;
    for (let i = 0; i < this.paintState.length; i++) {
      const mark = this.paintState[i];
      mark.age += dt;
      if (mark.age >= mark.life) mark.active = false;
      if (mark.active) {
        const pop = 0.25 + Math.min(1, mark.age / 0.18) * 0.75;
        const fade = Math.min(1, (mark.life - mark.age) / 1.2);
        this.scale.setScalar(mark.size * pop * fade);
        this.position.set(mark.x, 0.045 + i * 0.00012, mark.z);
        this.rotation.setFromAxisAngle(this.axis, mark.rotation);
        count = i + 1;
      } else this.scale.setScalar(0);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.paint.setMatrixAt(i, this.matrix);
    }
    this.paint.count = count;
    this.paint.instanceMatrix.needsUpdate = true;
    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      if (ring.age >= ring.life) { ring.mesh.visible = false; continue; }
      const p = ring.age / ring.life;
      ring.mesh.scale.setScalar(ring.size * (0.45 + Math.sqrt(p) * 1.5));
      ring.mesh.material.opacity = 0.9 * (1 - p);
    }
  }

  isAnimating() {
    return this.enabled && (this.time < this.celebrationUntil || this.particleState.some((particle) => particle.active));
  }

  diagnostics() {
    return {
      enabled: this.enabled,
      activeParticles: this.particleState.filter((particle) => particle.active).length,
      particleCapacity: this.particleState.length,
      trailVisible: this.ballTrail.visible,
      trailWidth: 0.48,
      racketTrailsVisible: this.racketTrails.filter((trail) => trail.mesh.visible).length,
      activeRings: this.rings.filter((ring) => ring.mesh.visible).length,
      ringCapacity: this.rings.length,
      activePaint: this.paintState.filter((mark) => mark.active).length,
      paintCapacity: this.paintState.length,
      chargeAuraVisible: this.chargeAura.visible,
      celebrating: this.time < this.celebrationUntil,
    };
  }
}
