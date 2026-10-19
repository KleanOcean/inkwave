import { COURT } from './simulation.js';

const GRAVITY = 9.81;
const STEP = 1 / 120;
const PLAYER_SPEED = 7;
const PLAYER_REACH = 2.25;
const BOT_REACH = 2.45;
const TOSS_TIME = 0.4;
const POINT_DELAY = 1.8;
const SWING_COOLDOWN = 0.34;

const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ speed: 3.8, reaction: 0.46, precision: 0.68 }),
  normal: Object.freeze({ speed: 5.4, reaction: 0.22, precision: 0.88 }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export class DuelSession {
  constructor({ difficulty = 'normal', random = Math.random, onEvent = () => {} } = {}) {
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    this.settings = DIFFICULTIES[this.difficulty];
    this.random = typeof random === 'function' ? random : Math.random;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.phase = 'ready';
    this.elapsed = 0;
    this.player = { x: 2.4, z: 9 };
    this.bot = { x: 0, z: -9 };
    this.ball = this._emptyBall();
    this.points = { player: 0, bot: 0 };
    this.winner = null;
    this.server = 'player';
    this.rallyState = 'serve';
    this.rally = 0;
    this.bestRally = 0;
    this.returns = 0;
    this.misses = 0;
    this._accumulator = 0;
    this._tossElapsed = 0;
    this._pendingStroke = null;
    this._betweenDelay = 0;
    this._botServeDelay = 0;
    this._botReaction = 0;
    this._botCooldown = 0;
    this._playerCooldown = 0;
    this._bounceCount = 0;
    this._servePending = false;
    this._serveOriginX = null;
    this._pointLocked = false;
  }

  start() {
    this.phase = 'playing';
    this.elapsed = 0;
    this.points = { player: 0, bot: 0 };
    this.winner = null;
    this.rally = 0;
    this.bestRally = 0;
    this.returns = 0;
    this.misses = 0;
    this._accumulator = 0;
    this._beginPoint();
    this._emit({ type: 'start' });
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
    this.elapsed += dt;
    this._accumulator += dt;
    while (this._accumulator + 1e-12 >= STEP && this.phase === 'playing') {
      this._step(STEP, input);
      this._accumulator -= STEP;
      if (this._accumulator < 0) this._accumulator = 0;
    }
    return this.snapshot();
  }

  canServe() {
    return this.phase === 'playing' && this.rallyState === 'serve' && this.server === 'player' && !this._pointLocked;
  }

  canHit() {
    return this.phase === 'playing'
      && this.rallyState === 'rally'
      && this.ball.active
      && this.ball.lastHitter === 'bot'
      && this.ball.state === 'incoming'
      && this.ball.z > 0
      && this.ball.y >= 0.3
      && this.ball.y <= 2.8
      && Math.hypot(this.ball.x - this.player.x, this.ball.z - this.player.z) <= PLAYER_REACH
      && this._playerCooldown <= 0
      && (!this._servePending || this._bounceCount > 0);
  }

  swing(charge = 0.5, aim = { x: 0, z: -9 }) {
    if (this.canServe()) {
      this._beginToss('player', charge, aim);
      return true;
    }
    if (this.phase !== 'playing' || this.rallyState !== 'rally') return false;

    const inPlayerReach = this.ball.active
      && this.ball.lastHitter === 'bot'
      && this.ball.z > 0
      && this.ball.y >= 0.3
      && this.ball.y <= 2.8
      && Math.hypot(this.ball.x - this.player.x, this.ball.z - this.player.z) <= PLAYER_REACH;
    if (inPlayerReach && this._servePending && this._bounceCount === 0) {
      this._awardPoint('bot', 'serve-volley', this.ball.x, this.ball.z);
      return false;
    }
    if (!this.canHit()) {
      this.misses += 1;
      this._emit({ type: 'swing-miss', actor: 'player', x: this.ball.x, y: this.ball.y, z: this.ball.z });
      return false;
    }

    const plan = this._planShot('player', charge, aim, false);
    this._applyShot('player', charge, plan, false);
    this._playerCooldown = SWING_COOLDOWN;
    this.returns += 1;
    this.rally += 1;
    this._botReaction = this.settings.reaction;
    return true;
  }

  predictShot(charge = 0.5, aim = { x: 0, z: -9 }) {
    if (this.canServe()) return this._publicPlan(this._planShot('player', charge, aim, true));
    if (!this.canHit()) return null;
    return this._publicPlan(this._planShot('player', charge, aim, false));
  }

  snapshot() {
    return {
      mode: 'duel',
      phase: this.phase,
      elapsed: this.elapsed,
      player: { ...this.player },
      bot: { ...this.bot },
      ball: { ...this.ball },
      points: { ...this.points },
      winner: this.winner,
      difficulty: this.difficulty,
      server: this.server,
      rallyState: this.rallyState,
      rally: this.rally,
      bestRally: this.bestRally,
      returns: this.returns,
      misses: this.misses,
      canServe: this.canServe(),
    };
  }

  _emptyBall() {
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false, state: 'waiting', lastHitter: null };
  }

  _step(dt, input) {
    this._playerCooldown = Math.max(0, this._playerCooldown - dt);
    this._botCooldown = Math.max(0, this._botCooldown - dt);
    this._movePlayer(dt, input);

    if (this.rallyState === 'between') {
      this._betweenDelay -= dt;
      if (this._betweenDelay <= 1e-10) this._beginPoint();
      return;
    }
    if (this.rallyState === 'serve' && this.server === 'bot') {
      this._botServeDelay -= dt;
      if (this._botServeDelay <= 1e-10) this._beginToss('bot', 0.58, this._defaultServeAim('bot'));
      return;
    }
    if (this.rallyState === 'toss') {
      this._updateToss(dt);
      return;
    }
    if (this.rallyState !== 'rally' || !this.ball.active) return;

    this._updateBot(dt);
    this._integrateBall(dt);
    if (this.phase === 'playing' && this.rallyState === 'rally') this._tryBotHit();
  }

  _movePlayer(dt, input) {
    if (this.rallyState === 'between' || (this.rallyState === 'toss' && this._pendingStroke?.actor === 'player')) return;
    let x = finite(input?.moveX, 0);
    let z = finite(input?.moveZ, 0);
    const magnitude = Math.hypot(x, z);
    if (magnitude > 1) {
      x /= magnitude;
      z /= magnitude;
    }
    this.player.x = clamp(this.player.x + x * PLAYER_SPEED * dt, -7, 7);
    this.player.z = clamp(this.player.z + z * PLAYER_SPEED * dt, 1.8, 13.5);
  }

  _updateBot(dt) {
    if (this.ball.lastHitter !== 'player') return;
    this._botReaction = Math.max(0, this._botReaction - dt);
    if (this._botReaction > 0) return;
    const target = this._predictBotIntercept();
    const targetX = clamp(target.x, -7, 7);
    const targetZ = clamp(target.z, -11, -2);
    let dx = targetX - this.bot.x;
    let dz = targetZ - this.bot.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-10) return;
    const travel = Math.min(distance, this.settings.speed * dt);
    dx /= distance;
    dz /= distance;
    this.bot.x = clamp(this.bot.x + dx * travel, -7, 7);
    this.bot.z = clamp(this.bot.z + dz * travel, -13.5, -1.8);
  }

  _predictBotIntercept() {
    const b = this.ball;
    const discriminant = Math.max(0, b.vy * b.vy + 2 * GRAVITY * Math.max(0, b.y - COURT.ballRadius));
    const timeToGround = Math.max(0, (b.vy + Math.sqrt(discriminant)) / GRAVITY);
    let timeToContact = timeToGround;
    if (this._servePending && this._bounceCount === 0) {
      const impactVy = b.vy - GRAVITY * timeToGround;
      const reboundVy = Math.abs(impactVy) * 0.72;
      const playableRise = Math.min(0.3, Math.max(0.08, (reboundVy - Math.sqrt(Math.max(0, reboundVy * reboundVy - 2 * GRAVITY * 0.55))) / GRAVITY));
      timeToContact += playableRise;
    }
    return {
      x: b.x + b.vx * timeToContact,
      z: b.z + b.vz * timeToContact,
    };
  }

  _tryBotHit() {
    if (this.ball.lastHitter !== 'player'
      || this.ball.z >= 0
      || this.ball.y < 0.3
      || this.ball.y > 2.9
      || this._botReaction > 0
      || this._botCooldown > 0
      || (this._servePending && this._bounceCount === 0)
      || Math.hypot(this.ball.x - this.bot.x, this.ball.z - this.bot.z) > BOT_REACH) return;

    const errorScale = (1 - this.settings.precision) * 2.2;
    const errorX = (clamp(this.random(), 0, 1) - 0.5) * errorScale;
    const errorZ = (clamp(this.random(), 0, 1) - 0.5) * errorScale;
    const aim = {
      x: clamp(this.player.x * 0.65 + errorX, -4.8, 4.8),
      z: clamp(7.2 + errorZ, 3.2, 10.8),
    };
    const charge = this.difficulty === 'normal' ? 0.62 : 0.5;
    const plan = this._planShot('bot', charge, aim, false);
    this._applyShot('bot', charge, plan, false);
    this._botCooldown = SWING_COOLDOWN;
    this.rally += 1;
  }

  _beginToss(actor, charge, aim) {
    const position = actor === 'player' ? this.player : this.bot;
    this.rallyState = 'toss';
    this._tossElapsed = 0;
    this._pendingStroke = { actor, charge: clamp(finite(charge, 0.5), 0, 1), aim: { x: finite(aim?.x, 0), z: finite(aim?.z, actor === 'player' ? -9 : 9) } };
    this.ball = { x: position.x, y: 1.15, z: position.z, vx: 0, vy: 0, vz: 0, active: true, state: 'waiting', lastHitter: null };
    this._emit({ type: 'serve-toss', actor, x: this.ball.x, y: this.ball.y, z: this.ball.z });
  }

  _updateToss(dt) {
    this._tossElapsed = Math.min(TOSS_TIME, this._tossElapsed + dt);
    const progress = this._tossElapsed / TOSS_TIME;
    const actor = this._pendingStroke.actor;
    const position = actor === 'player' ? this.player : this.bot;
    this.ball.x = position.x;
    this.ball.z = position.z;
    this.ball.y = 1.15 + 1.35 * Math.sin(progress * Math.PI * 0.82);
    if (this._tossElapsed + 1e-10 < TOSS_TIME) return;

    const { charge, aim } = this._pendingStroke;
    const plan = this._planShot(actor, charge, aim, true);
    this._applyShot(actor, charge, plan, true);
    this._pendingStroke = null;
    this.rallyState = 'rally';
    this._servePending = true;
    this._bounceCount = 0;
  }

  _applyShot(actor, charge, plan, serve) {
    this.ball.vx = plan.vx;
    this.ball.vy = plan.vy;
    this.ball.vz = plan.vz;
    this.ball.active = true;
    this.ball.state = actor === 'player' ? 'outgoing' : 'incoming';
    this.ball.lastHitter = actor;
    this._bounceCount = 0;
    if (serve) this._serveOriginX = plan.originX;
    const common = { actor, x: this.ball.x, y: this.ball.y, z: this.ball.z, charge: clamp(finite(charge, 0.5), 0, 1) };
    if (serve) {
      this._emit({ type: 'serve', ...common, stroke: 'serve', aimX: plan.x, aimZ: plan.z });
    } else {
      this._emit({
        type: 'hit',
        ...common,
        stroke: plan.stroke,
        quality: plan.quality,
        timing: plan.timing,
        aimX: plan.x,
        aimZ: plan.z,
      });
    }
  }

  _planShot(actor, chargeValue, aim, serve) {
    const charge = clamp(finite(chargeValue, 0.5), 0, 1);
    const position = actor === 'player' ? this.player : this.bot;
    const origin = serve
      ? { x: position.x, y: this.ball.active ? this.ball.y : 2.3, z: position.z }
      : { x: this.ball.x, y: this.ball.y, z: this.ball.z };
    const offset = Math.hypot(origin.x - position.x, origin.z - position.z);
    const verticalError = Math.abs(origin.y - 1.25);
    const quality = serve ? 1 : clamp(1 - offset / PLAYER_REACH - verticalError * 0.11, 0.12, 1);
    const timing = quality >= 0.78 ? 'perfect' : quality >= 0.46 ? 'good' : 'late';
    let targetX;
    let targetZ;

    if (serve) {
      const direction = position.x >= 0 ? -1 : 1;
      const requestedX = Math.abs(finite(aim?.x, 2));
      targetX = direction * clamp(requestedX || 2, 1.35, 3.9);
      const requestedDepth = Math.abs(finite(aim?.z, actor === 'player' ? -4.6 : 4.6));
      const depth = clamp(requestedDepth, 3.2, 5.5);
      targetZ = actor === 'player' ? -depth : depth;
      if (charge < 0.12) targetZ = actor === 'player' ? 0.75 : -0.75;
    } else {
      const requestedX = clamp(finite(aim?.x, 0), -7, 7);
      const requestedZ = actor === 'player'
        ? clamp(finite(aim?.z, -9), -11, -2)
        : clamp(finite(aim?.z, 9), 2, 11);
      const powerDepth = (charge - 0.5) * 2;
      const shortError = (1 - quality) * 1.5;
      targetX = requestedX + (origin.x - position.x) * (1 - quality) * 1.1;
      targetZ = actor === 'player'
        ? requestedZ - powerDepth + shortError
        : requestedZ + powerDepth - shortError;
      targetX = clamp(targetX, -7, 7);
      targetZ = actor === 'player' ? clamp(targetZ, -11.5, -1.2) : clamp(targetZ, 1.2, 11.5);
    }

    const flightTime = serve
      ? 1.12 - 0.18 * charge
      : 1.52 - 0.48 * charge + 0.18 * (1 - quality);
    const vx = (targetX - origin.x) / flightTime;
    const vz = (targetZ - origin.z) / flightTime;
    const vy = (COURT.ballRadius - origin.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    const forehand = actor === 'player' ? origin.x >= position.x : origin.x <= position.x;
    return { x: targetX, z: targetZ, flightTime, quality, timing, vx, vy, vz, originX: origin.x, stroke: forehand ? 'forehand' : 'backhand' };
  }

  _publicPlan(plan) {
    return {
      x: plan.x,
      z: plan.z,
      flightTime: plan.flightTime,
      quality: plan.quality,
      timing: plan.timing,
      vx: plan.vx,
      vy: plan.vy,
      vz: plan.vz,
    };
  }

  _integrateBall(dt) {
    const b = this.ball;
    const previous = { x: b.x, y: b.y, z: b.z };
    b.x += b.vx * dt;
    b.y += b.vy * dt - 0.5 * GRAVITY * dt * dt;
    b.z += b.vz * dt;
    b.vy -= GRAVITY * dt;

    const crossedNet = (previous.z > 0 && b.z <= 0) || (previous.z < 0 && b.z >= 0);
    if (crossedNet) {
      const ratio = Math.abs(previous.z) / Math.abs(b.z - previous.z);
      const crossingY = previous.y + (b.y - previous.y) * ratio;
      if (crossingY <= COURT.netHeight + COURT.ballRadius) {
        b.x = previous.x + (b.x - previous.x) * ratio;
        b.y = crossingY;
        b.z = 0;
        this._awardPoint(this._opponent(b.lastHitter), 'net', b.x, b.z);
        return;
      }
    }

    if (previous.y > COURT.ballRadius && b.y <= COURT.ballRadius) {
      const ratio = (previous.y - COURT.ballRadius) / (previous.y - b.y);
      b.x = previous.x + (b.x - previous.x) * ratio;
      b.z = previous.z + (b.z - previous.z) * ratio;
      b.y = COURT.ballRadius;
      const side = b.z >= 0 ? 'player' : 'bot';
      this._emit({ type: 'bounce', x: b.x, z: b.z, side });

      if (this._bounceCount === 0) {
        if (Math.abs(b.x) > COURT.halfWidth || Math.abs(b.z) > COURT.halfLength) {
          this._awardPoint(this._opponent(b.lastHitter), 'out', b.x, b.z);
          return;
        }
        const expectedSide = b.lastHitter === 'player' ? 'bot' : 'player';
        if (side !== expectedSide) {
          this._awardPoint(this._opponent(b.lastHitter), this._servePending ? 'serve-fault' : 'wrong-side', b.x, b.z);
          return;
        }
        if (this._servePending && !this._legalServiceBounce(b.lastHitter, b.x, b.z)) {
          this._awardPoint(this._opponent(b.lastHitter), 'serve-fault', b.x, b.z);
          return;
        }
        this._bounceCount = 1;
        if (this._servePending) this._servePending = false;
        b.vy = Math.abs(b.vy) * 0.72;
        return;
      }

      this._awardPoint(b.lastHitter, 'double-bounce', b.x, b.z);
    }
  }

  _legalServiceBounce(actor, x, z) {
    const originX = this._serveOriginX ?? (actor === 'player' ? this.player.x : this.bot.x);
    const diagonal = originX >= 0 ? x < 0 : x > 0;
    const correctHalf = actor === 'player' ? z < 0 : z > 0;
    return diagonal && correctHalf && Math.abs(x) <= COURT.halfWidth && Math.abs(z) <= 6.4;
  }

  _awardPoint(winner, reason, x, z) {
    if (this._pointLocked || this.phase !== 'playing') return;
    this._pointLocked = true;
    this.ball.active = false;
    this.ball.state = 'waiting';
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.points[winner] += 1;
    this.bestRally = Math.max(this.bestRally, this.rally);
    this._emit({ type: 'point', winner, reason, points: { ...this.points }, rally: this.rally, x, z });

    if (this.points[winner] >= 7 && this.points[winner] - this.points[this._opponent(winner)] >= 2) {
      this.winner = winner;
      this.phase = 'finished';
      this.rallyState = 'between';
      this._accumulator = 0;
      this._emit({ type: 'finish', winner, points: { ...this.points } });
      return;
    }
    this.rallyState = 'between';
    this._betweenDelay = POINT_DELAY;
  }

  _beginPoint() {
    const total = this.points.player + this.points.bot;
    this.server = total === 0 || Math.floor((total - 1) / 2) % 2 === 1 ? 'player' : 'bot';
    const side = total % 2 === 0 ? 1 : -1;
    this.player = { x: this.server === 'player' ? side * 2.4 : 0, z: 9 };
    this.bot = { x: this.server === 'bot' ? side * 2.4 : 0, z: -9 };
    this.ball = this._emptyBall();
    this.rallyState = 'serve';
    this.rally = 0;
    this._pointLocked = false;
    this._betweenDelay = 0;
    this._botServeDelay = this.server === 'bot' ? 0.72 : 0;
    this._botReaction = 0;
    this._botCooldown = 0;
    this._playerCooldown = 0;
    this._bounceCount = 0;
    this._servePending = false;
    this._serveOriginX = null;
    this._pendingStroke = null;
    this._tossElapsed = 0;
  }

  _defaultServeAim(actor) {
    const position = actor === 'player' ? this.player : this.bot;
    return { x: position.x >= 0 ? -2.2 : 2.2, z: actor === 'player' ? -4.6 : 4.6 };
  }

  _opponent(actor) {
    return actor === 'player' ? 'bot' : 'player';
  }

  _emit(event) {
    this.onEvent(event);
  }
}
