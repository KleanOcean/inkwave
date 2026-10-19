// INKWAVE / RALLY — DOM-only interface for tennis duel and target practice.
// The scene and simulation own all game state; this class only presents snapshots
// and emits intent through callbacks.

const AIM_IDS = new Set(['left', 'center', 'right']);
const PHASES = new Set(['ready', 'playing', 'paused', 'finished']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const integer = (value) => Math.max(0, Math.round(Number(value) || 0));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, label, action) {
  const node = el('button', className);
  node.type = 'button';
  node.dataset.action = action;
  node.textContent = label;
  return node;
}

function makeEmblem() {
  const wrap = el('div', 'tn-brand__mark');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M8 18c9 0 15 4 18 8s9 8 18 8M18 8c0 9 4 15 8 18s8 9 8 18"/></svg>';
  return wrap;
}

export class TennisUI {
  constructor(root, callbacks = {}) {
    if (!(root instanceof Element)) throw new TypeError('TennisUI requires a DOM root element.');
    this.callbacks = callbacks;
    this.phase = 'ready';
    this.cache = Object.create(null);
    this.movePointers = new Map();
    this.swingPointers = new Set();
    this.lastChargeLabel = -1;
    this.toastTimer = 0;
    this.timingTimer = 0;
    this.impactTimer = 0;
    this.sweepTimer = 0;

    this.element = el('section', 'tn');
    this.element.id = 'tennis-ui';
    this.element.setAttribute('aria-label', 'INKWAVE 网球俱乐部');
    this.element.dataset.phase = 'ready';
    root.appendChild(this.element);

    this._build();
    this._bind();
    this.render({ phase: 'ready', remaining: 60, score: 0, combo: 0, bestCombo: 0, feeds: 0, returns: 0, targetHits: 0, misses: 0 });
  }

  _build() {
    const masthead = el('header', 'tn-masthead');
    const brand = el('div', 'tn-brand');
    brand.append(makeEmblem());
    const brandText = el('div', 'tn-brand__text');
    brandText.append(el('strong', '', 'INKWAVE / RALLY'), el('span', '', 'TENNIS CLUB'));
    brand.append(brandText);

    const utility = el('div', 'tn-utility');
    this.soundButton = button('tn-icon-btn', '声音：开', 'mute');
    this.soundButton.setAttribute('aria-pressed', 'false');
    this.effectsButton = button('tn-icon-btn', '动效：开', 'effects');
    this.effectsButton.setAttribute('aria-pressed', 'true');
    this.pauseButton = button('tn-icon-btn tn-icon-btn--pause', '暂停', 'pause');
    utility.append(this.soundButton, this.effectsButton, this.pauseButton);
    masthead.append(brand, utility);

    this.stats = el('div', 'tn-stats tn-stats--practice');
    this.stats.setAttribute('aria-label', '当前比赛数据');
    this.scoreValue = this._stat(this.stats, '得分', '0', 'score');
    this.timeValue = this._stat(this.stats, '剩余时间', '1:00', 'time');
    this.comboValue = this._stat(this.stats, '连续命中', '0', 'combo');

    this.duelStats = el('div', 'tn-stats tn-stats--duel');
    this.duelStats.setAttribute('aria-label', '1 对 1 比分');
    this.playerPointsValue = this._stat(this.duelStats, 'YOU', '0', 'player');
    this.botPointsValue = this._stat(this.duelStats, 'BOT', '0', 'bot');
    this.serverValue = this._stat(this.duelStats, '发球方', '你', 'server');
    this.rallyValue = this._stat(this.duelStats, '本回合', '0', 'rally');

    this.readyPanel = el('section', 'tn-panel tn-ready');
    this.readyPanel.setAttribute('aria-labelledby', 'tn-ready-title');
    this.readyKicker = el('p', 'tn-kicker', '1V1 BOT DUEL');
    this.inkBadge = el('div', 'tn-ink-badge', 'INK POWER · 喷墨对决');
    this.readyTitle = el('h1', 'tn-ready__title');
    this.readyTitle.id = 'tn-ready-title';
    this.readyIntro = el('p', 'tn-ready__intro', '先到 7 分并领先 2 分获胜。每分只有一次发球机会，按住蓄力，松开完成发球。');

    const modeGroup = el('div', 'tn-ready-choice');
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', '比赛模式');
    modeGroup.append(el('span', 'tn-control-label', '比赛模式'));
    const modeButtons = el('div', 'tn-segment');
    this.modeButtons = new Map();
    [['duel', '1V1 对决'], ['practice', '60 秒练习']].forEach(([id, label]) => {
      const control = button('tn-segment__button', label, 'mode');
      control.dataset.mode = id;
      control.setAttribute('aria-pressed', String(id === 'duel'));
      this.modeButtons.set(id, control);
      modeButtons.append(control);
    });
    modeGroup.append(modeButtons);

    this.difficultyGroup = el('div', 'tn-ready-choice tn-ready-choice--difficulty');
    this.difficultyGroup.setAttribute('role', 'group');
    this.difficultyGroup.setAttribute('aria-label', '机器人难度');
    this.difficultyGroup.append(el('span', 'tn-control-label', '机器人难度'));
    const difficultyButtons = el('div', 'tn-segment');
    this.difficultyButtons = new Map();
    [['easy', 'EASY · 轻松'], ['normal', 'NORMAL · 标准']].forEach(([id, label]) => {
      const control = button('tn-segment__button', label, 'difficulty');
      control.dataset.difficulty = id;
      control.setAttribute('aria-pressed', String(id === 'normal'));
      this.difficultyButtons.set(id, control);
      difficultyButtons.append(control);
    });
    this.difficultyGroup.append(difficultyButtons);

    const steps = el('ol', 'tn-steps');
    steps.append(
      this._step('01', '移动', 'WASD / 方向键'),
      this._step('02', '瞄准', '鼠标或 1 / 2 / 3'),
      this._step('03', '击球', '按住并释放空格或鼠标')
    );
    this.startButton = button('tn-primary', '开始对决', 'start');
    this.startButton.autofocus = true;
    const original = el('a', 'tn-original', '返回原版 INKWAVE');
    original.href = '?game=inkwave';
    this.readyPanel.append(this.readyKicker, this.inkBadge, this.readyTitle, this.readyIntro, modeGroup, this.difficultyGroup, steps, this.startButton, original);

    this.pausePanel = el('section', 'tn-modal tn-pause');
    this.pausePanel.hidden = true;
    this.pausePanel.setAttribute('role', 'dialog');
    this.pausePanel.setAttribute('aria-modal', 'true');
    this.pausePanel.setAttribute('aria-labelledby', 'tn-pause-title');
    const pauseTitle = el('h2', '', '休息一下');
    pauseTitle.id = 'tn-pause-title';
    this.resumeButton = button('tn-primary', '继续挑战', 'resume');
    const pauseRestart = button('tn-secondary', '重新开始', 'restart');
    const pauseMenu = button('tn-secondary', '返回球会', 'menu');
    this.pausePanel.append(el('p', 'tn-kicker', 'MATCH PAUSED'), pauseTitle, el('p', '', '比赛已经暂停，准备好再继续。'), this.resumeButton, pauseRestart, pauseMenu);

    this.resultPanel = el('section', 'tn-modal tn-results');
    this.resultPanel.hidden = true;
    this.resultPanel.setAttribute('role', 'dialog');
    this.resultPanel.setAttribute('aria-modal', 'true');
    this.resultPanel.setAttribute('aria-labelledby', 'tn-result-title');
    this.resultKicker = el('p', 'tn-kicker', 'FULL TIME');
    this.resultTitle = el('h2', '', '本轮结束');
    this.resultTitle.id = 'tn-result-title';
    this.resultScore = el('strong', 'tn-results__score', '0');
    this.resultLabel = el('span', 'tn-results__score-label', 'POINTS');
    const resultList = el('dl', 'tn-results__list');
    this.resultRows = [
      this._result(resultList, '成功回球'),
      this._result(resultList, '落点命中率'),
      this._result(resultList, '最佳连击')
    ];
    this.restartButton = button('tn-primary', '再打一轮', 'restart');
    const resultMenu = button('tn-secondary', '返回球会', 'menu');
    this.resultPanel.append(this.resultKicker, this.resultTitle, this.resultScore, this.resultLabel, resultList, this.restartButton, resultMenu);

    this.playControls = el('section', 'tn-play-controls');
    this.playControls.setAttribute('aria-label', '击球控制');
    const aimBlock = el('div', 'tn-aim');
    aimBlock.append(el('span', 'tn-control-label', '落点方向'));
    const aimButtons = el('div', 'tn-aim__buttons');
    this.aimButtons = new Map();
    this.aimPointLabels = new Map();
    [['left', '左路', 'LEFT', '100'], ['center', '中路', 'CENTER', '150'], ['right', '右路', 'RIGHT', '100']].forEach(([id, cn, en, points]) => {
      const aim = button('tn-aim-btn', '', 'aim');
      aim.dataset.aim = id;
      aim.setAttribute('aria-pressed', id === 'center' ? 'true' : 'false');
      aim.setAttribute('aria-label', `${cn}，${points} 分`);
      const pointLabel = el('b', 'tn-aim-btn__points', points);
      aim.append(el('span', 'tn-aim-btn__en', en), el('span', 'tn-aim-btn__cn', cn), pointLabel);
      this.aimButtons.set(id, aim);
      this.aimPointLabels.set(id, { node: pointLabel, label: cn, points });
      aimButtons.append(aim);
    });
    aimBlock.append(aimButtons);

    const strikeBlock = el('div', 'tn-strike');
    const strikeHead = el('div', 'tn-strike__head');
    strikeHead.append(el('span', 'tn-control-label', '击球蓄力'));
    this.hitStatus = el('strong', 'tn-hit-status', '等待来球');
    strikeHead.append(this.hitStatus);
    this.chargeMeter = el('div', 'tn-charge');
    this.chargeMeter.setAttribute('role', 'progressbar');
    this.chargeMeter.setAttribute('aria-label', '击球蓄力');
    this.chargeMeter.setAttribute('aria-valuemin', '0');
    this.chargeMeter.setAttribute('aria-valuemax', '100');
    this.chargeMeter.setAttribute('aria-valuenow', '0');
    this.chargeFill = el('span', 'tn-charge__fill');
    this.chargeMeter.append(this.chargeFill);
    this.chargeText = el('span', 'tn-charge__value', '0%');
    this.strikeHint = el('span', 'tn-strike__hint', '按住 SPACE / 鼠标，靠近来球时释放');
    strikeBlock.append(strikeHead, this.chargeMeter, this.chargeText, this.strikeHint);
    this.playControls.append(aimBlock, strikeBlock);

    this.touchControls = el('section', 'tn-touch');
    this.touchControls.setAttribute('aria-label', '触控操作');
    const dpad = el('div', 'tn-dpad');
    const directions = [
      ['up', '前进', 0, -1, '↑'], ['left', '向左', -1, 0, '←'],
      ['right', '向右', 1, 0, '→'], ['down', '后退', 0, 1, '↓']
    ];
    directions.forEach(([id, label, x, z, glyph]) => {
      const control = button(`tn-touch-btn tn-dpad__${id}`, glyph, 'move');
      control.dataset.x = String(x);
      control.dataset.z = String(z);
      control.setAttribute('aria-label', label);
      dpad.append(control);
    });
    this.swingButton = button('tn-swing', '按住蓄力\n松开挥拍', 'swing');
    this.touchControls.append(dpad, this.swingButton);

    this.feedback = el('div', 'tn-feedback');
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-live', 'polite');
    this.feedback.setAttribute('aria-atomic', 'true');

    this.timingFeedback = el('div', 'tn-timing');
    this.timingFeedback.setAttribute('aria-hidden', 'true');

    this.impactFeedback = el('div', 'tn-impact');
    this.impactFeedback.setAttribute('aria-hidden', 'true');
    const impactSplat = el('span', 'tn-impact__splat');
    for (let i = 0; i < 7; i++) impactSplat.append(el('i', `tn-impact__drop tn-impact__drop--${i + 1}`));
    const impactLines = el('span', 'tn-impact__lines');
    for (let i = 0; i < 4; i++) impactLines.append(el('i', `tn-impact__line tn-impact__line--${i + 1}`));
    this.impactWord = el('strong', 'tn-impact__word', 'SERVE!');
    this.impactFeedback.append(impactSplat, impactLines, this.impactWord);

    this.errorPanel = el('section', 'tn-error');
    this.errorPanel.hidden = true;
    this.errorPanel.setAttribute('role', 'alert');
    this.errorMessage = el('p', '', '');
    const reload = button('tn-primary', '重新载入', 'reload');
    this.errorPanel.append(el('strong', '', '训练模式未能启动'), this.errorMessage, reload);

    this.element.append(masthead, this.stats, this.duelStats, this.readyPanel, this.pausePanel, this.resultPanel, this.playControls, this.touchControls, this.feedback, this.timingFeedback, this.impactFeedback, this.errorPanel);
  }

  _stat(parent, label, value, key) {
    const item = el('div', `tn-stat tn-stat--${key}`);
    item.append(el('span', '', label));
    const output = el('strong', '', value);
    item.append(output);
    parent.append(item);
    return output;
  }

  _step(number, title, detail) {
    const item = el('li', 'tn-step');
    item.append(el('b', 'tn-step__number', number), el('strong', '', title), el('span', '', detail));
    return item;
  }

  _result(parent, label) {
    const wrap = el('div', 'tn-results__row');
    const term = el('dt', '', label);
    wrap.append(term);
    const value = el('dd', '', '0');
    wrap.append(value);
    parent.append(wrap);
    return { label: term, value };
  }

  _bind() {
    this.element.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-action]');
      if (!target || target.disabled) return;
      const action = target.dataset.action;
      if (action === 'start') { target.blur(); this.callbacks.onStart?.(); }
      else if (action === 'pause') this.callbacks.onPause?.();
      else if (action === 'resume') this.callbacks.onResume?.();
      else if (action === 'restart') this.callbacks.onRestart?.();
      else if (action === 'menu') { this._clearDecorativeFeedback(); this.callbacks.onMenu?.(); }
      else if (action === 'mute') this.callbacks.onMute?.();
      else if (action === 'effects') this.callbacks.onEffectsToggle?.();
      else if (action === 'aim') this.callbacks.onAimPreset?.(target.dataset.aim);
      else if (action === 'mode' && this.phase === 'ready') this.callbacks.onModeChange?.(target.dataset.mode);
      else if (action === 'difficulty' && this.phase === 'ready') this.callbacks.onDifficultyChange?.(target.dataset.difficulty);
      else if (action === 'reload') window.location.reload();
    });

    // During play, Space belongs to the racket even if a utility button still has focus.
    this.element.addEventListener('keydown', (event) => {
      if (this.phase === 'playing' && event.code === 'Space' && event.target.closest('button, a')) {
        event.preventDefault();
        event.target.blur();
      }
      if (event.key === 'Tab') this._trapModalFocus(event);
    });

    this.element.querySelectorAll('[data-action="move"]').forEach((control) => {
      control.addEventListener('pointerdown', (event) => this._moveDown(event, control));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        control.addEventListener(type, (event) => this._moveUp(event));
      }
    });
    this.swingButton.addEventListener('pointerdown', (event) => this._swingDown(event));
    this.swingButton.addEventListener('pointerup', (event) => this._swingUp(event));
    this.swingButton.addEventListener('pointercancel', (event) => this._swingCancel(event));
    this.swingButton.addEventListener('lostpointercapture', (event) => this._swingCancel(event));
    window.addEventListener('blur', () => this._releaseTouches());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._releaseTouches(); });
  }

  _moveDown(event, control) {
    if (this.phase !== 'playing') return;
    event.preventDefault();
    control.setPointerCapture?.(event.pointerId);
    this.movePointers.set(event.pointerId, { x: Number(control.dataset.x), z: Number(control.dataset.z) });
    control.classList.add('is-pressed');
    this._emitMove();
  }

  _moveUp(event) {
    if (!this.movePointers.has(event.pointerId)) return;
    this.movePointers.delete(event.pointerId);
    this.element.querySelectorAll('[data-action="move"].is-pressed').forEach((node) => {
      if (![...this.movePointers.values()].some((value) => Number(node.dataset.x) === value.x && Number(node.dataset.z) === value.z)) node.classList.remove('is-pressed');
    });
    this._emitMove();
  }

  _emitMove() {
    let x = 0, z = 0;
    for (const value of this.movePointers.values()) { x += value.x; z += value.z; }
    this.callbacks.onMove?.({ x: Math.sign(x), z: Math.sign(z) });
  }

  _swingDown(event) {
    if (this.phase !== 'playing' || this.swingPointers.has(event.pointerId)) return;
    event.preventDefault();
    this.swingButton.setPointerCapture?.(event.pointerId);
    this.swingPointers.add(event.pointerId);
    this.swingButton.classList.add('is-pressed');
    if (this.swingPointers.size === 1) this.callbacks.onChargeStart?.();
  }

  _swingUp(event) {
    if (!this.swingPointers.delete(event.pointerId)) return;
    if (this.swingPointers.size === 0) {
      this.swingButton.classList.remove('is-pressed');
      this.callbacks.onChargeEnd?.();
    }
  }

  _swingCancel(event) {
    if (!this.swingPointers.has(event.pointerId)) return;
    this._cancelCharge();
  }

  _cancelCharge() {
    if (!this.swingPointers.size) return;
    this.swingPointers.clear();
    this.swingButton.classList.remove('is-pressed');
    this.callbacks.onChargeCancel?.();
  }

  _releaseTouches() {
    if (this.movePointers.size) {
      this.movePointers.clear();
      this.element.querySelectorAll('[data-action="move"].is-pressed').forEach((node) => node.classList.remove('is-pressed'));
      this.callbacks.onMove?.({ x: 0, z: 0 });
    }
    this._cancelCharge();
  }

  _trapModalFocus(event) {
    const modal = this.phase === 'paused' ? this.pausePanel : this.phase === 'finished' ? this.resultPanel : null;
    if (!modal || modal.hidden) return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  render(snapshot = {}, extras = {}) {
    const nextPhase = PHASES.has(snapshot.phase) ? snapshot.phase : this.phase;
    const mode = extras.mode === 'practice' ? 'practice' : 'duel';
    const difficulty = extras.difficulty === 'easy' ? 'easy' : 'normal';
    this._renderMode(mode, difficulty, snapshot);
    this._setPhase(nextPhase);

    const score = integer(snapshot.score);
    const remaining = clamp(snapshot.remaining ?? 60, 0, 5999);
    const combo = integer(snapshot.combo);
    const returns = integer(snapshot.returns);
    const targetHits = integer(snapshot.targetHits);
    const bestCombo = integer(snapshot.bestCombo);
    this._scoreText('score', this.scoreValue, score.toLocaleString('zh-CN'));
    this._text('time', this.timeValue, this._time(remaining));
    this._text('combo', this.comboValue, String(combo));

    if (mode === 'duel') {
      const playerPoints = integer(snapshot.points?.player);
      const botPoints = integer(snapshot.points?.bot);
      this._scoreText('player-points', this.playerPointsValue, String(playerPoints));
      this._scoreText('bot-points', this.botPointsValue, String(botPoints));
      this._text('server', this.serverValue, snapshot.server === 'bot' ? 'BOT' : '你');
      this._text('rally', this.rallyValue, String(integer(snapshot.rally)));
      const won = snapshot.winner === 'player';
      this.resultPanel.dataset.winner = snapshot.winner || '';
      this._text('result-title', this.resultTitle, won ? '你赢了！' : '对手获胜');
      this._text('result-kicker', this.resultKicker, won ? 'MATCH WINNER' : 'FULL TIME');
      this._text('result-score', this.resultScore, `${playerPoints} : ${botPoints}`);
      this._text('result-label', this.resultLabel, 'YOU / BOT');
      this._setResult(0, '最终比分', `${playerPoints} : ${botPoints}`);
      this._setResult(1, '最长回合', `${integer(snapshot.bestRally)} 拍`);
      this._setResult(2, '成功回球', String(returns));
      this.restartButton.textContent = '再打一场';
    } else {
      this.resultPanel.dataset.winner = '';
      this._text('result-title', this.resultTitle, '本轮结束');
      this._text('result-kicker', this.resultKicker, 'FULL TIME');
      this._text('result-score', this.resultScore, score.toLocaleString('zh-CN'));
      this._text('result-label', this.resultLabel, 'POINTS');
      this._setResult(0, '成功回球', String(returns));
      this._setResult(1, '落点命中率', returns ? `${Math.round(targetHits / returns * 100)}%` : '0%');
      this._setResult(2, '最佳连击', String(bestCombo));
      this.restartButton.textContent = '再打一轮';
    }

    const aimId = extras.aimId === '' ? '' : AIM_IDS.has(extras.aimId) ? extras.aimId : 'center';
    if (this.cache.aim !== aimId) {
      this.cache.aim = aimId;
      this.aimButtons.forEach((node, id) => {
        const active = id === aimId;
        node.classList.toggle('is-selected', active);
        node.setAttribute('aria-pressed', String(active));
      });
    }

    const muted = Boolean(extras.muted);
    if (this.cache.muted !== muted) {
      this.cache.muted = muted;
      this.soundButton.textContent = muted ? '声音：关' : '声音：开';
      this.soundButton.setAttribute('aria-pressed', String(muted));
    }

    const reducedMotion = Boolean(extras.reducedMotion);
    const effects = extras.effects !== false && !reducedMotion;
    if (this.cache.effects !== effects || this.cache.reducedMotion !== reducedMotion) {
      this.cache.effects = effects;
      this.cache.reducedMotion = reducedMotion;
      this.element.dataset.effects = effects ? 'on' : 'off';
      this.effectsButton.textContent = effects ? '动效：开' : '动效：关';
      this.effectsButton.setAttribute('aria-pressed', String(effects));
      this.effectsButton.disabled = reducedMotion || (nextPhase !== 'ready' && nextPhase !== 'playing');
      this.effectsButton.title = reducedMotion ? '系统已开启减少动态效果' : '';
      if (!effects) {
        this.impactFeedback.classList.remove('is-visible');
        this.timingFeedback.classList.remove('is-visible');
        this.element.classList.remove('is-point-sweep');
      }
    }

    const canHit = Boolean(extras.canHit);
    const canServe = mode === 'duel' && Boolean(extras.canServe ?? snapshot.canServe);
    const charging = Boolean(extras.charging);
    const charge = clamp(extras.charge, 0, 1);
    this.element.classList.toggle('is-can-hit', canHit);
    this.element.classList.toggle('is-can-serve', canServe);
    this.element.classList.toggle('is-charging', charging);
    this.element.classList.toggle('is-full-charge', charging && charge >= 0.92);
    this.hitStatus.textContent = canServe ? '可以发球' : canHit ? '可以击球' : charging ? '保持蓄力' : '等待来球';
    this.strikeHint.textContent = canServe ? '松开发球，自动瞄准对角发球区' : '按住 SPACE / 鼠标，靠近来球时释放';
    this._charge(charge);
  }

  _renderMode(mode, difficulty, snapshot) {
    this.element.dataset.mode = mode;
    this.element.dataset.difficulty = difficulty;
    this.stats.hidden = mode !== 'practice';
    this.duelStats.hidden = mode !== 'duel';
    if (this.cache.mode !== mode) {
      this.cache.mode = mode;
      this.modeButtons.forEach((node, id) => {
        const active = id === mode;
        node.classList.toggle('is-selected', active);
        node.setAttribute('aria-pressed', String(active));
      });
      this.aimButtons.forEach((node, id) => {
        const point = this.aimPointLabels.get(id);
        point.node.hidden = mode === 'duel';
        node.setAttribute('aria-label', mode === 'duel' ? point.label : `${point.label}，${point.points} 分`);
      });
      this.difficultyGroup.hidden = mode !== 'duel';
      this.inkBadge.hidden = mode !== 'duel';
      if (mode === 'duel') {
        this.readyKicker.textContent = '1V1 BOT DUEL';
        this.readyTitle.textContent = '正面对决，\n先赢七分。';
        this.readyIntro.textContent = '先到 7 分并领先 2 分获胜。松开发球时自动瞄准对角发球区；单次发球失误直接失分。';
        this.startButton.textContent = '开始对决';
      } else {
        this.readyKicker.textContent = '60 秒落点挑战';
        this.readyTitle.textContent = '把每一拍，\n打到点上。';
        this.readyIntro.textContent = '预判来球、选择落点，在球靠近时释放击球。蓄力越久，回球越快、弧线越低。';
        this.startButton.textContent = '开始挑战';
      }
    }
    if (this.cache.difficulty !== difficulty) {
      this.cache.difficulty = difficulty;
      this.difficultyButtons.forEach((node, id) => {
        const active = id === difficulty;
        node.classList.toggle('is-selected', active);
        node.setAttribute('aria-pressed', String(active));
      });
    }
    const locked = (PHASES.has(snapshot.phase) ? snapshot.phase : this.phase) !== 'ready';
    this.modeButtons.forEach((node) => { node.disabled = locked; });
    this.difficultyButtons.forEach((node) => { node.disabled = locked || mode !== 'duel'; });
  }

  _setResult(index, label, value) {
    const row = this.resultRows[index];
    this._text(`result-row-${index}-label`, row.label, label);
    this._text(`result-row-${index}-value`, row.value, value);
  }

  _scoreText(key, node, value) {
    const changed = this.cache[key] !== undefined && this.cache[key] !== value;
    this._text(key, node, value);
    if (!changed || this.phase === 'ready' || this.element.dataset.effects === 'off') return;
    node.classList.remove('is-score-pop');
    void node.offsetWidth;
    node.classList.add('is-score-pop');
  }

  _setPhase(phase) {
    if (phase === this.phase && this.cache.phaseSet) return;
    const previous = this.phase;
    this.phase = phase;
    this.cache.phaseSet = true;
    this.element.dataset.phase = phase;
    this.readyPanel.hidden = phase !== 'ready';
    this.pausePanel.hidden = phase !== 'paused';
    this.resultPanel.hidden = phase !== 'finished';
    this.playControls.hidden = phase !== 'playing';
    this.touchControls.hidden = phase !== 'playing';
    this.pauseButton.hidden = phase !== 'playing';
    const utilityVisible = phase === 'ready' || phase === 'playing';
    this.soundButton.hidden = !utilityVisible;
    this.effectsButton.hidden = !utilityVisible;
    this.soundButton.disabled = !utilityVisible;
    this.effectsButton.disabled = !utilityVisible || Boolean(this.cache.reducedMotion);
    if (phase === 'ready' || phase === 'paused') this._clearDecorativeFeedback();
    if (phase === 'ready') {
      window.clearTimeout(this.toastTimer);
      window.clearTimeout(this.timingTimer);
      this.feedback.classList.remove('is-visible');
      this.timingFeedback.classList.remove('is-visible');
      this.element.querySelectorAll('.is-score-pop').forEach((node) => node.classList.remove('is-score-pop'));
    }
    if (phase !== 'playing' && previous === 'playing') this._releaseTouches();
    const focusTarget = phase === 'ready' ? this.startButton : phase === 'paused' ? this.resumeButton : phase === 'finished' ? this.restartButton : null;
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  _charge(value) {
    const charge = clamp(value, 0, 1);
    this.chargeFill.style.transform = `scaleX(${charge.toFixed(3)})`;
    const percentage = Math.round(charge * 100);
    this.chargeMeter.setAttribute('aria-valuenow', String(percentage));
    // Keep the readable label stable enough to avoid announcing every animation frame.
    const label = Math.round(percentage / 5) * 5;
    if (label !== this.lastChargeLabel) {
      this.lastChargeLabel = label;
      this.chargeText.textContent = `${label}%`;
    }
  }

  _text(key, node, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    node.textContent = value;
  }

  _time(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  notify(event = {}) {
    const type = event.type || '';
    const duel = this.cache.mode === 'duel';
    let kind = type;
    let duration = 1500;
    let message = '';
    if (type === 'start') message = duel ? 'MATCH START · 对决开始' : '挑战开始';
    else if (type === 'pause') message = '比赛暂停';
    else if (type === 'resume') message = '继续比赛';
    else if (type === 'feed') message = '发球！盯住来球';
    else if (type === 'serve-toss') message = event.actor === 'bot' ? 'BOT · 对手抛球' : 'TOSS · 松开发球';
    else if (type === 'serve') {
      message = event.actor === 'bot' ? 'BOT SERVE · 对手发球' : 'SERVE · 发球！';
      if (event.actor !== 'bot') this._showImpact('SERVE!', 'serve');
    }
    else if (type === 'bounce') {
      message = duel ? (event.side === 'player' ? '球落在你方场区' : '球落在对手场区') : '球已落地';
    } else if (type === 'hit') {
      if (!duel || event.actor == null) message = '漂亮的回球';
      else if (event.actor === 'bot') message = 'BOT · 对手回球';
      else {
        const timing = { perfect: 'PERFECT', good: 'GOOD', late: 'LATE' }[event.timing] || 'HIT';
        const stroke = event.stroke === 'backhand' ? '反手' : '正手';
        this._showTiming(timing, event.timing || 'good');
        message = `${timing} · ${stroke}`;
      }
      if (event.actor !== 'bot') {
        const impact = event.timing === 'perfect' ? ['PERFECT!', 'perfect']
          : Number(event.quality) >= 0.78 || Number(event.charge) >= 0.72 ? ['SMASH!', 'smash'] : ['HIT!', 'hit'];
        this._showImpact(impact[0], impact[1]);
      }
    } else if (type === 'swing-miss') message = '挥拍太早或太晚';
    else if (type === 'point') {
      const won = event.winner === 'player';
      const reason = {
        net: '下网', out: '出界', 'double-bounce': '两次落地', 'wrong-side': '落点错误',
        'serve-fault': '发球失误', 'serve-volley': '接发球过早'
      }[event.reason] || '本分结束';
      const lead = event.reason === 'out' ? 'OUT' : event.reason === 'net' ? 'NET' : 'POINT';
      message = `${lead} · ${won ? '你得分' : '对手得分'} / ${reason}`;
      kind = event.reason === 'out' ? 'out' : 'point';
      duration = 2200;
      const pointImpact = won ? ['POINT!', 'point'] : event.reason === 'out' ? ['OUT!', 'out'] : ['BOT POINT!', 'bot'];
      this._showImpact(pointImpact[0], pointImpact[1], 1250);
      this._sweepScore(won ? 'player' : 'bot');
    } else if (type === 'finish') {
      message = event.winner === 'player' ? 'WINNER · 你赢了！' : duel ? 'MATCH · 对手获胜' : '时间到！';
      kind = event.winner === 'player' ? 'winner' : 'finish';
      duration = 2800;
      if (event.winner === 'player') this._showImpact('WINNER!', 'winner', 1800);
    }
    if (type === 'score') {
      const points = integer(event.points);
      const combo = integer(event.combo);
      const scoredTarget = event.targetId !== null && event.targetId !== undefined;
      message = `${scoredTarget ? '落点命中' : '有效回球'} +${points}${combo > 1 ? ` · ${combo} 连击` : ''}`;
      if (scoredTarget) this._showImpact('INK!', 'perfect');
    } else if (type === 'miss') {
      const reason = { net: '球触网了', out: '出界', missed: '错过来球' }[event.reason] || '这一球未得分';
      message = reason;
    }
    if (!message) return;
    this.feedback.textContent = message;
    this.feedback.dataset.kind = kind;
    this.feedback.classList.remove('is-visible');
    void this.feedback.offsetWidth;
    this.feedback.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.feedback.classList.remove('is-visible'), duration);
  }

  _showTiming(label, timing) {
    if (this.element.dataset.effects === 'off') return;
    this.timingFeedback.textContent = label;
    this.timingFeedback.dataset.timing = timing;
    this.timingFeedback.classList.remove('is-visible');
    void this.timingFeedback.offsetWidth;
    this.timingFeedback.classList.add('is-visible');
    window.clearTimeout(this.timingTimer);
    this.timingTimer = window.setTimeout(() => this.timingFeedback.classList.remove('is-visible'), 900);
  }

  _showImpact(label, tone, duration = 950) {
    if (this.element.dataset.effects === 'off') return;
    this.impactWord.textContent = label;
    this.impactFeedback.dataset.tone = tone;
    this.impactFeedback.classList.remove('is-visible');
    void this.impactFeedback.offsetWidth;
    this.impactFeedback.classList.add('is-visible');
    window.clearTimeout(this.impactTimer);
    this.impactTimer = window.setTimeout(() => this.impactFeedback.classList.remove('is-visible'), duration);
  }

  _sweepScore(winner) {
    if (this.element.dataset.effects === 'off') return;
    this.element.dataset.pointWinner = winner;
    this.element.classList.remove('is-point-sweep');
    void this.element.offsetWidth;
    this.element.classList.add('is-point-sweep');
    window.clearTimeout(this.sweepTimer);
    this.sweepTimer = window.setTimeout(() => this.element.classList.remove('is-point-sweep'), 760);
  }

  _clearDecorativeFeedback() {
    window.clearTimeout(this.impactTimer);
    window.clearTimeout(this.sweepTimer);
    window.clearTimeout(this.timingTimer);
    this.impactFeedback.classList.remove('is-visible');
    this.timingFeedback.classList.remove('is-visible');
    this.element.classList.remove('is-point-sweep');
  }

  fail(message) {
    this._releaseTouches();
    this.errorMessage.textContent = String(message || '发生未知错误。请重新载入后再试。');
    this.errorPanel.hidden = false;
    this.readyPanel.hidden = true;
    this.pausePanel.hidden = true;
    this.resultPanel.hidden = true;
    this.playControls.hidden = true;
    this.touchControls.hidden = true;
    this.pauseButton.hidden = true;
    this.soundButton.disabled = true;
    this.effectsButton.disabled = true;
    this.soundButton.hidden = true;
    this.effectsButton.hidden = true;
    this.element.classList.add('has-error');
    requestAnimationFrame(() => this.errorPanel.querySelector('button')?.focus({ preventScroll: true }));
  }
}
