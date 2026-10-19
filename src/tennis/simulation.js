export const COURT = Object.freeze({
  halfWidth: 5.5,
  halfLength: 12,
  netHeight: 1,
  ballRadius: 0.13,
});

export const TARGETS = Object.freeze([
  Object.freeze({ id: 'left', label: 'CROSSCOURT', x: -3.4, z: -8.5, radius: 1.55, points: 100, color: '#ff845c' }),
  Object.freeze({ id: 'center', label: 'PRECISION', x: 0, z: -6, radius: 1.35, points: 150, color: '#e5f67a' }),
  Object.freeze({ id: 'right', label: 'CROSSCOURT', x: 3.4, z: -8.5, radius: 1.55, points: 100, color: '#a59bf8' }),
]);

const GRAVITY = 9.81;
const STEP = 1 / 120;
const PLAYER_SPEED = 7;
const SWING_COOLDOWN = 0.35;
const MACHINE = Object.freeze({ x: 0, y: 1.7, z: -10.8 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class TennisSession {
  constructor({ duration = 60, random = Math.random, onEvent = () => {} } = {}) {
    this.duration = Math.max(0, Number.isFinite(duration) ? duration : 60);
    this.random = typeof random === 'function' ? random : Math.random;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.phase = 'ready';
    this.remaining = this.duration;
    this.elapsed = 0;
    this.player = { x: 0, z: 9 };
    this.ball = this._emptyBall();
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.feeds = 0;
    this.returns = 0;
    this.targetHits = 0;
    this.misses = 0;
    this._accumulator = 0;
    this._feedDelay = 1;
    this._feedIndex = 0;
    this._incomingBounces = 0;
    this._swingCooldown = 0;
  }

  start() {
    this.phase = 'playing';
    this.remaining = this.duration;
    this.elapsed = 0;
    this.player = { x: 0, z: 9 };
    this.ball = this._emptyBall();
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.feeds = 0;
    this.returns = 0;
    this.targetHits = 0;
    this.misses = 0;
    this._accumulator = 0;
    this._feedDelay = 1;
    this._feedIndex = 0;
    this._incomingBounces = 0;
    this._swingCooldown = 0;
    this._emit({ type: 'start' });
    if (this.duration === 0) this._finish();
    return this.snapshot();
  }

  pause() {
    if (this.phase !== 'playing') return false;
    this.phase = 'paused';
    this._emit({ type: 'pause' });
    return true;
  }

  resume() {
    if (this.phase !== 'paused') return false;
    this.phase = 'playing';
    this._emit({ type: 'resume' });
    return true;
  }

  update(dt, input = {}) {
    if (this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return this.snapshot();

    const activeTime = Math.min(dt, this.remaining);
    this.elapsed = Math.min(this.duration, this.elapsed + activeTime);
    this.remaining = Math.max(0, this.duration - this.elapsed);
    this._accumulator += activeTime;

    while (this._accumulator + 1e-12 >= STEP && this.phase === 'playing') {
      this._step(STEP, input);
      this._accumulator -= STEP;
      if (this._accumulator < 0) this._accumulator = 0;
    }

    if (this.remaining <= 1e-10) this._finish();
    return this.snapshot();
  }

  canHit() {
    const b = this.ball;
    return this.phase === 'playing'
      && b.active
      && b.state === 'incoming'
      && b.z > 0
      && b.y >= 0.3
      && b.y <= 2.8
      && Math.hypot(b.x - this.player.x, b.z - this.player.z) <= 2.25
      && this._swingCooldown <= 0;
  }

  swing(charge = 0.5, aim = { x: 0, z: -6 }) {
    if (this.phase !== 'playing') return false;
    const b = this.ball;
    if (!this.canHit()) {
      this._emit({ type: 'swing-miss', x: b.x, y: b.y, z: b.z });
      return false;
    }

    const shot = this.predictShot(charge, aim);
    if (!shot) return false;
    const flightTime = shot.flightTime;
    b.vx = (shot.x - b.x) / flightTime;
    b.vz = (shot.z - b.z) / flightTime;
    b.vy = (COURT.ballRadius - b.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    b.state = 'outgoing';
    this._incomingBounces = 0;
    this._swingCooldown = SWING_COOLDOWN;
    this.returns += 1;
    this._emit({ type: 'hit', charge: clamp(Number(charge) || 0, 0, 1), x: b.x, y: b.y, z: b.z, aimX: shot.x, aimZ: shot.z });
    return true;
  }

  predictShot(charge = 0.5, aim = { x: 0, z: -6 }) {
    if (!this.ball.active || this.ball.state !== 'incoming') return null;
    const amount = clamp(Number(charge) || 0, 0, 1);
    return {
      x: clamp(Number.isFinite(aim?.x) ? aim.x : 0, -7, 7),
      z: clamp(Number.isFinite(aim?.z) ? aim.z : -6, -11, -2),
      flightTime: 1.55 - 0.4 * amount,
    };
  }

  snapshot() {
    return {
      phase: this.phase,
      remaining: this.remaining,
      elapsed: this.elapsed,
      player: { ...this.player },
      ball: { ...this.ball },
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      feeds: this.feeds,
      returns: this.returns,
      targetHits: this.targetHits,
      misses: this.misses,
    };
  }

  _emptyBall() {
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false, state: 'waiting' };
  }

  _step(dt, input) {
    this._movePlayer(dt, input);
    this._swingCooldown = Math.max(0, this._swingCooldown - dt);

    if (!this.ball.active) {
      this._feedDelay -= dt;
      if (this._feedDelay <= 1e-10) this._launchFeed();
      return;
    }

    const b = this.ball;
    const previous = { x: b.x, y: b.y, z: b.z };
    b.x += b.vx * dt;
    b.y += b.vy * dt - 0.5 * GRAVITY * dt * dt;
    b.z += b.vz * dt;
    b.vy -= GRAVITY * dt;

    if (b.state === 'outgoing' && previous.z > 0 && b.z <= 0) {
      const ratio = previous.z / (previous.z - b.z);
      const crossingY = previous.y + (b.y - previous.y) * ratio;
      if (crossingY <= COURT.netHeight + COURT.ballRadius) {
        b.x = previous.x + (b.x - previous.x) * ratio;
        b.y = crossingY;
        b.z = 0;
        this._resolveMiss('net');
        return;
      }
    }

    if (previous.y > COURT.ballRadius && b.y <= COURT.ballRadius) {
      const ratio = (previous.y - COURT.ballRadius) / (previous.y - b.y);
      b.x = previous.x + (b.x - previous.x) * ratio;
      b.z = previous.z + (b.z - previous.z) * ratio;
      b.y = COURT.ballRadius;
      this._emit({ type: 'bounce', state: b.state, x: b.x, z: b.z });
      if (b.state === 'outgoing') {
        this._resolveReturn();
        return;
      }
      this._incomingBounces += 1;
      if (this._incomingBounces >= 2) {
        this._resolveMiss('missed');
        return;
      }
      b.vy = Math.abs(b.vy) * 0.75;
    }

    if (b.state === 'incoming' && b.z > 15) this._resolveMiss('missed');
  }

  _movePlayer(dt, input) {
    let x = Number.isFinite(input?.moveX) ? input.moveX : 0;
    let z = Number.isFinite(input?.moveZ) ? input.moveZ : 0;
    const magnitude = Math.hypot(x, z);
    if (magnitude > 1) {
      x /= magnitude;
      z /= magnitude;
    }
    this.player.x = clamp(this.player.x + x * PLAYER_SPEED * dt, -7, 7);
    this.player.z = clamp(this.player.z + z * PLAYER_SPEED * dt, 1.8, 13.5);
  }

  _launchFeed() {
    const positions = [0, -2.5, 2.5];
    const landingX = positions[this._feedIndex % positions.length] + (clamp(this.random(), 0, 1) - 0.5) * 0.5;
    this._feedIndex += 1;
    const flightTime = 1.5;
    this.ball = {
      x: MACHINE.x,
      y: MACHINE.y,
      z: MACHINE.z,
      vx: (landingX - MACHINE.x) / flightTime,
      vy: (COURT.ballRadius - MACHINE.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
      vz: (4.8 - MACHINE.z) / flightTime,
      active: true,
      state: 'incoming',
    };
    this._incomingBounces = 0;
    this.feeds += 1;
    this._emit({ type: 'feed', number: this.feeds, landingX });
  }

  _resolveReturn() {
    const { x, z } = this.ball;
    const insideOpponentCourt = Math.abs(x) <= COURT.halfWidth && z >= -COURT.halfLength && z <= 0;
    if (!insideOpponentCourt) {
      this._resolveMiss('out');
      return;
    }

    const target = TARGETS.find((candidate) => Math.hypot(x - candidate.x, z - candidate.z) <= candidate.radius);
    let points = 25;
    if (target) {
      this.targetHits += 1;
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      points = target.points * Math.min(this.combo, 5);
    } else {
      this.combo = 0;
    }
    this.score += points;
    this._emit({ type: 'score', points, total: this.score, combo: this.combo, targetId: target?.id ?? null, x, z });
    this._deactivateBall();
  }

  _resolveMiss(reason) {
    const { x, z } = this.ball;
    this.misses += 1;
    this.combo = 0;
    this._emit({ type: 'miss', reason, x, z });
    this._deactivateBall();
  }

  _deactivateBall() {
    this.ball.active = false;
    this.ball.state = 'waiting';
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this._feedDelay = 0.8;
    this._incomingBounces = 0;
  }

  _finish() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.elapsed = this.duration;
    this.remaining = 0;
    this._accumulator = 0;
    this.ball.active = false;
    this.ball.state = 'waiting';
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this._emit({ type: 'finish', score: this.score });
  }

  _emit(event) {
    this.onEvent(event);
  }
}
