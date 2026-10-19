import { TARGETS, TennisSession } from './simulation.js';
import { DuelSession } from './duel.js';
import { TennisCourt } from './court.js';
import { TennisUI } from './ui.js';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class TennisSounds {
  constructor() {
    this.muted = true;
    try { this.muted = localStorage.getItem('inkwave.tennis.sound') !== 'on'; } catch { /* Storage is optional. */ }
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('inkwave.tennis.sound', this.muted ? 'off' : 'on'); } catch { /* Private browsing. */ }
    if (!this.muted) this.play('hit');
    else this.context?.suspend().catch(() => {});
  }

  play(type, event = {}) {
    if (this.muted || document.hidden) return;
    const frequencies = { start: 520, feed: 330, bounce: 180, hit: event.actor === 'bot' ? 580 : 720,
      'serve-toss': 280, serve: 820, point: event.winner === 'player' ? 1040 : 260,
      score: 1040, miss: 145, finish: 440 };
    if (!frequencies[type]) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context ||= new AudioContext();
      this.context.resume().catch(() => {});
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequencies[type], now);
      oscillator.frequency.exponentialRampToValueAtTime(frequencies[type] * 0.7, now + 0.13);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      oscillator.connect(gain); gain.connect(this.context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + 0.18);
    } catch { /* Audio cannot prevent a challenge from running. */ }
  }
}

class TennisGame {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.mode = params.get('play') === 'practice' ? 'practice' : 'duel';
    this.difficulty = params.get('difficulty') === 'easy' ? 'easy' : 'normal';
    this.effects = true;
    try { this.effects = localStorage.getItem('inkwave.tennis.effects') !== 'off'; } catch { /* Optional preference. */ }
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.keys = new Set();
    this.touchMove = { x: 0, z: 0 };
    this.chargeSources = new Set();
    this.charge = 0;
    this.aim = { x: 0, z: this.mode === 'duel' ? -9 : -6 };
    this.aimId = 'center';
    this.events = [];
    this.frames = 0;
    this.raf = 0;
    this.failed = false;
    this.celebrationUntil = 0;
    this.sounds = new TennisSounds();
    this.session = this.createSession();
    this.ui = new TennisUI(document.getElementById('ui-root'), {
      onStart: () => this.start(),
      onRestart: () => this.start(),
      onMenu: () => this.menu(),
      onModeChange: (mode) => this.selectMode(mode),
      onDifficultyChange: (difficulty) => this.selectDifficulty(difficulty),
      onEffectsToggle: () => this.toggleEffects(),
      onPause: () => this.pause(),
      onResume: () => this.resume(),
      onAimPreset: (id) => this.selectAim(id),
      onMute: () => { this.sounds.toggle(); this.render(); },
      onMove: (move) => { this.touchMove = move; },
      onChargeStart: () => this.beginCharge('touch'),
      onChargeEnd: () => this.releaseCharge('touch'),
      onChargeCancel: () => this.cancelCharge(),
    });
    window.addEventListener('error', (event) => { if (event.error) this.fail(event.error); });
    window.addEventListener('unhandledrejection', (event) => this.fail(event.reason || new Error('游戏运行遇到错误。')));
    this.motionPreference.addEventListener('change', () => this.render());
    this.frame = this.frame.bind(this);
    try {
      this.court = new TennisCourt(document.getElementById('app'));
      this.bindInput();
      this.render();
      // Read-only state makes browser QA observable without injecting balls or awarding synthetic points.
      window.__tennis = Object.freeze({
        snapshot: () => ({ ...this.session.snapshot(), mode: this.mode, difficulty: this.difficulty,
          charge: this.charge, charging: this.chargeSources.size > 0, canServe: this.session.canServe?.() || false,
          canHit: this.session.canHit(), aim: { ...this.aim }, aimId: this.aimId,
          effects: this.effects && !this.motionPreference.matches }),
        diagnostics: () => ({ frames: this.frames, rendering: !!this.raf, pixelRatio: this.court.renderer.getPixelRatio(),
          renderMs: this.renderMs || 0, frameGapMs: this.frameGapMs || 0,
          draws: this.court.renderer.info.render.calls, triangles: this.court.renderer.info.render.triangles,
          effects: this.court.effectDiagnostics?.() || null,
          events: this.events.map((event) => ({ ...event })) }),
      });
    } catch (error) { this.fail(error); }
    document.getElementById('fade').style.display = 'none';
  }

  onEvent(event) {
    this.events.push({ ...event, elapsed: this.session.elapsed });
    if (this.events.length > 40) this.events.shift();
    this.ui?.notify(event);
    this.court?.notify(event);
    this.sounds.play(event.type, event);
    if (event.type === 'point' || event.type === 'finish') this.clearInput();
    if (event.type === 'finish') this.celebrationUntil = performance.now() + 1800;
  }

  createSession() {
    const onEvent = (event) => this.onEvent(event);
    return this.mode === 'duel' ? new DuelSession({ difficulty: this.difficulty, onEvent }) : new TennisSession({ onEvent });
  }

  menu() {
    if (this.failed) return;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.celebrationUntil = 0;
    this.clearInput();
    this.session = this.createSession();
    this.events.length = 0;
    this.aim = { x: 0, z: this.mode === 'duel' ? -9 : -6 }; this.aimId = 'center';
    this.court.notify({ type: 'reset' });
    this.render();
  }

  selectMode(mode) {
    if (this.session.phase !== 'ready' || !['duel', 'practice'].includes(mode)) return;
    this.mode = mode;
    this.menu();
  }

  selectDifficulty(difficulty) {
    if (this.session.phase !== 'ready' || !['easy', 'normal'].includes(difficulty)) return;
    this.difficulty = difficulty;
    this.menu();
  }

  toggleEffects() {
    if (this.failed || this.motionPreference.matches) return;
    this.effects = !this.effects;
    try { localStorage.setItem('inkwave.tennis.effects', this.effects ? 'on' : 'off'); } catch { /* Optional preference. */ }
    this.render();
  }

  start() {
    if (this.failed) return;
    this.clearInput();
    this.events.length = 0;
    this.celebrationUntil = 0;
    this.session.start();
    this.render();
    this.court.canvas.focus({ preventScroll: true });
    this.wake();
  }

  pause() {
    const paused = this.session.pause();
    if (!paused && this.session.phase !== 'finished') return;
    this.clearInput();
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.session.phase === 'finished') { this.celebrationUntil = 0; this.court.settleEffects?.(); }
    this.sounds.context?.suspend().catch(() => {});
    this.render();
  }

  resume() {
    if (this.failed || document.hidden || !this.session.resume()) return;
    this.clearInput();
    if (!this.sounds.muted) this.sounds.context?.resume().catch(() => {});
    this.render();
    this.court.canvas.focus({ preventScroll: true });
    this.wake();
  }

  selectAim(id) {
    if (this.session.phase !== 'playing') return;
    const target = TARGETS.find((candidate) => candidate.id === id);
    if (!target) return;
    this.aim = { x: target.x, z: this.mode === 'duel' && id === 'center' ? -9 : target.z }; this.aimId = id;
    this.render();
  }

  aimAt(event) {
    if (this.session.phase !== 'playing') return;
    const point = this.court.aimAt(event.clientX, event.clientY);
    if (!point || point.z >= -0.6) return;
    this.aim = { x: clamp(point.x, -7, 7), z: clamp(point.z, -11, -2) };
    this.aimId = TARGETS.find((target) => Math.hypot(target.x - this.aim.x, target.z - this.aim.z) < target.radius)?.id || '';
  }

  beginCharge(source) {
    if (this.failed || this.session.phase !== 'playing') return;
    if (!this.chargeSources.size) this.charge = 0;
    this.chargeSources.add(source);
    this.render();
  }

  releaseCharge(source) {
    if (!this.chargeSources.delete(source) || this.chargeSources.size) return;
    if (!this.failed && !document.hidden && this.session.phase === 'playing') this.session.swing(this.charge, this.aim);
    this.charge = 0;
    this.render();
  }

  cancelCharge() { this.chargeSources.clear(); this.charge = 0; }

  clearInput() {
    this.keys.clear(); this.touchMove = { x: 0, z: 0 }; this.cancelCharge();
    this.pointerId = null;
  }

  bindInput() {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        if (this.session.phase === 'playing') this.pause();
        else if (this.session.phase === 'paused') this.resume();
        return;
      }
      if (this.session.phase !== 'playing' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (MOVE_KEYS.has(event.code)) { event.preventDefault(); this.keys.add(event.code); }
      if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) this.beginCharge('keyboard'); }
      const preset = { Digit1: 'left', Digit2: 'center', Digit3: 'right' }[event.code];
      if (preset) { event.preventDefault(); this.selectAim(preset); }
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'Space' && this.chargeSources.has('keyboard')) {
        event.preventDefault(); this.releaseCharge('keyboard');
      }
    });
    const canvas = this.court.canvas;
    canvas.addEventListener('pointermove', (event) => this.aimAt(event));
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.session.phase !== 'playing' || this.pointerId != null) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      this.aimAt(event); this.beginCharge('pointer');
    });
    canvas.addEventListener('pointerup', (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.releaseCharge('pointer');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, (event) => {
      if (event.pointerId === this.pointerId) { this.pointerId = null; this.cancelCharge(); this.render(); }
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.fail(new Error('图形资源已被浏览器释放。请关闭其他较重的页面，再重新载入。'));
    });
    window.addEventListener('blur', () => { this.clearInput(); this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clearInput(); this.pause(); } });
    window.addEventListener('resize', () => { if (!this.failed) { this.court.resize(); this.render(); } });
    window.addEventListener('pagehide', (event) => {
      this.pause();
      if (!event.persisted) {
        cancelAnimationFrame(this.raf);
        this.court.dispose();
        this.sounds.context?.close().catch(() => {});
      }
    });
  }

  wake() {
    if (this.raf || this.failed || this.session.phase !== 'playing' || document.hidden) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  shouldAnimate() {
    return this.session.phase === 'playing' || (this.session.phase === 'finished'
      && performance.now() < this.celebrationUntil && Boolean(this.court.isAnimating?.()));
  }

  frame(time) {
    this.raf = 0;
    if (this.failed || document.hidden) return;
    if (!this.shouldAnimate()) {
      if (this.session.phase === 'finished') { this.court.settleEffects?.(); this.render(); }
      return;
    }
    const dt = Math.max(0, (time - this.lastFrame) / 1000);
    if (dt >= 1 / 30) {
      this.frameGapMs = dt * 1000;
      this.lastFrame = time;
      if (this.session.phase === 'playing' && this.chargeSources.size) this.charge = Math.min(1, this.charge + dt / 0.85);
      const has = (key) => Number(this.keys.has(key));
      this.session.update(dt, {
        moveX: has('KeyD') + has('ArrowRight') - has('KeyA') - has('ArrowLeft') + this.touchMove.x,
        moveZ: has('KeyS') + has('ArrowDown') - has('KeyW') - has('ArrowUp') + this.touchMove.z,
      });
      this.render(dt);
    }
    if (this.shouldAnimate()) this.raf = requestAnimationFrame(this.frame);
    else if (this.session.phase === 'finished') { this.court.settleEffects?.(); this.render(); }
  }

  render(dt = 0) {
    if (this.failed) return;
    const snapshot = this.session.snapshot();
    const extras = { dt: Math.min(dt, 0.1), charge: this.charge, charging: this.chargeSources.size > 0,
      canHit: this.session.canHit(), canServe: this.session.canServe?.() || false,
      mode: this.mode, difficulty: this.difficulty, effects: this.effects && !this.motionPreference.matches,
      reducedMotion: this.motionPreference.matches, predictedAim: this.session.predictShot(this.charge, this.aim),
      aim: this.aim, aimId: this.aimId, muted: this.sounds.muted };
    this.ui.render(snapshot, extras);
    if (this.court) {
      const started = performance.now();
      this.court.render(snapshot, extras);
      this.renderMs = performance.now() - started;
      this.frames += 1;
    }
  }

  fail(error) {
    if (this.failed) return;
    this.session.pause(); this.clearInput();
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.failed = true;
    this.sounds.context?.suspend().catch(() => {});
    console.error('[tennis]', error);
    this.ui.fail(error.message || '无法创建 3D 网球场，请使用支持 WebGL2 的浏览器。');
  }
}

new TennisGame();
