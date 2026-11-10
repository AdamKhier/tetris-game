/* Tetris — keyboard, touch and gamepad controls.
   Single game loop with a unified input layer, so every control source
   (keyboard, on-screen buttons, swipe, gamepad) feeds the same actions. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Board + piece definitions
   * ------------------------------------------------------------------ */

  const COLS = 10;
  const ROWS = 20;

  const DAS = 150; // delayed auto shift (ms before auto-repeat)
  const ARR = 38; // auto repeat rate (ms between repeated moves)
  const LOCK_DELAY = 500;
  const MAX_LOCK_RESETS = 15;
  const CLEAR_FLASH = 170;
  const SOFT_DROP_MULT = 20;
  const GAMEPAD_DEADZONE = 0.45;

  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  const COLORS = {
    I: '#2ee6ff',
    J: '#4a7dff',
    L: '#ffa63d',
    O: '#ffe14b',
    S: '#43e37a',
    T: '#c46bff',
    Z: '#ff4d6d',
  };

  // Spawn-state cells inside a square box (SRS layout).
  const SHAPE_DEFS = {
    I: { box: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    J: { box: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { box: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    O: { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    S: { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    T: { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    Z: { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  };

  // Pre-compute the four rotation states of every piece.
  const PIECES = {};
  for (const type of TYPES) {
    const def = SHAPE_DEFS[type];
    const states = [];
    let cells = def.cells.map((c) => c.slice());
    for (let r = 0; r < 4; r++) {
      states.push(cells);
      cells = cells.map(([x, y]) => [def.box - 1 - y, x]);
    }
    PIECES[type] = { states };
  }

  // SRS wall kicks, expressed with y growing downwards (screen coordinates).
  const KICKS_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  };

  const KICKS_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  };

  const SCORE_TABLE = [0, 100, 300, 500, 800];

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */

  const ui = {
    board: document.getElementById('board'),
    wrap: document.getElementById('board-wrap'),
    shell: document.getElementById('board-shell'),
    playfield: document.querySelector('.playfield'),
    rail: document.querySelector('.rail'),
    hold: document.getElementById('hold-canvas'),
    next: document.getElementById('next-canvas'),
    overlay: document.getElementById('overlay'),
    ovEyebrow: document.getElementById('ov-eyebrow'),
    ovTitle: document.getElementById('ov-title'),
    ovText: document.getElementById('ov-text'),
    ovBtn: document.getElementById('ov-btn'),
    ovFoot: document.getElementById('ov-foot'),
    score: document.getElementById('score'),
    lines: document.getElementById('lines'),
    level: document.getElementById('level'),
    best: document.getElementById('best'),
    pauseBtn: document.getElementById('btn-pause'),
    soundBtn: document.getElementById('btn-sound'),
    undoBtn: document.getElementById('btn-undo'),
    padStatus: document.getElementById('pad-status'),
    padLabel: document.getElementById('pad-label'),
    touchPad: document.getElementById('touch-pad'),
  };

  const boardCtx = ui.board.getContext('2d');

  /* ------------------------------------------------------------------ *
   * Drawing helpers
   * ------------------------------------------------------------------ */

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function mix(hex, target, amount) {
    const parse = (h) => {
      const s = h.replace('#', '');
      return [
        parseInt(s.slice(0, 2), 16),
        parseInt(s.slice(2, 4), 16),
        parseInt(s.slice(4, 6), 16),
      ];
    };
    const a = parse(hex);
    const b = parse(target);
    const out = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
  }

  const spriteCache = new Map();

  function getSprite(color) {
    let sprite = spriteCache.get(color);
    if (sprite) return sprite;

    const S = 64;
    sprite = document.createElement('canvas');
    sprite.width = S;
    sprite.height = S;
    const ctx = sprite.getContext('2d');
    const pad = 3;
    const r = 12;

    const fill = ctx.createLinearGradient(0, 0, S, S);
    fill.addColorStop(0, mix(color, '#ffffff', 0.34));
    fill.addColorStop(0.55, color);
    fill.addColorStop(1, mix(color, '#000000', 0.34));
    ctx.fillStyle = fill;
    roundRect(ctx, pad, pad, S - pad * 2, S - pad * 2, r);
    ctx.fill();

    const gloss = ctx.createLinearGradient(0, pad, 0, S * 0.6);
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gloss;
    roundRect(ctx, pad + 4, pad + 4, S - pad * 2 - 8, S * 0.4, r * 0.7);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.lineWidth = 2;
    roundRect(ctx, pad, pad, S - pad * 2, S - pad * 2, r);
    ctx.stroke();

    spriteCache.set(color, sprite);
    return sprite;
  }

  function drawBlock(ctx, x, y, size, color) {
    const pad = Math.max(0.5, size * 0.05);
    ctx.drawImage(getSprite(color), x + pad, y + pad, size - pad * 2, size - pad * 2);
  }

  function drawGhost(ctx, x, y, size, color) {
    const pad = Math.max(1, size * 0.11);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, Math.max(2, size * 0.2));
    ctx.fill();
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.07);
    roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, Math.max(2, size * 0.2));
    ctx.stroke();
    ctx.restore();
  }

  function drawPieceCentered(ctx, type, x, y, w, h) {
    const cells = PIECES[type].states[0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of cells) {
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }
    const pw = maxX - minX + 1;
    const ph = maxY - minY + 1;
    const cell = Math.max(3, Math.min(w / (pw + 0.7), h / (ph + 0.7)));
    const ox = x + (w - pw * cell) / 2;
    const oy = y + (h - ph * cell) / 2;
    for (const [cx, cy] of cells) {
      drawBlock(ctx, ox + (cx - minX) * cell, oy + (cy - minY) * cell, cell, COLORS[type]);
    }
  }

  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  function makeBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
  }

  const state = {
    board: makeBoard(),
    active: null,
    queue: [],
    bag: [],
    hold: null,
    holdUsed: false,
    score: 0,
    lines: 0,
    level: 1,
    best: 0,
    status: 'ready',
    dropTimer: 0,
    lockTimer: 0,
    lockResets: 0,
    grounded: false,
    clearing: [],
    clearTimer: 0,
    combo: 0,
  };

  /* ------------------------------------------------------------------ *
   * Sound
   * ------------------------------------------------------------------ */

  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore (private mode) */
      }
    },
  };

  const Sfx = {
    ctx: null,
    muted: store.get('tetris.muted', '0') === '1',

    init() {
      if (!this.ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        try {
          this.ctx = new AudioCtor();
        } catch {
          return;
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    },

    tone(freq, dur = 0.07, type = 'square', gain = 0.05, endFreq = null) {
      if (this.muted) return;
      this.init();
      const ac = this.ctx;
      if (!ac) return;
      const t0 = ac.currentTime;
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
      }
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(amp).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    move() {
      this.tone(150, 0.03, 'square', 0.025);
    },
    rotate() {
      this.tone(320, 0.05, 'triangle', 0.045, 430);
    },
    lock() {
      this.tone(95, 0.09, 'square', 0.04, 60);
    },
    drop() {
      this.tone(210, 0.11, 'sawtooth', 0.04, 48);
    },
    hold() {
      this.tone(440, 0.07, 'sine', 0.05, 620);
    },
    undo() {
      this.tone(360, 0.12, 'triangle', 0.05, 170);
    },
    clear(count) {
      const notes = count >= 4 ? [523, 659, 784, 1047]
        : count === 3 ? [523, 659, 880]
          : count === 2 ? [440, 660]
            : [523];
      notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'triangle', 0.055), i * 55));
    },
    levelUp() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.1, 'square', 0.04), i * 70));
    },
    over() {
      [440, 350, 260, 170].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'sawtooth', 0.045), i * 130));
    },
    start() {
      this.tone(392, 0.09, 'square', 0.045);
      setTimeout(() => this.tone(587, 0.14, 'square', 0.045), 95);
    },
  };

  /* ------------------------------------------------------------------ *
   * Rules
   * ------------------------------------------------------------------ */

  function dropInterval() {
    const lvl = Math.min(state.level, 20);
    return Math.max(60, 1000 * Math.pow(0.8 - (lvl - 1) * 0.007, lvl - 1));
  }

  function collides(type, rot, x, y) {
    const cells = PIECES[type].states[rot];
    for (let i = 0; i < cells.length; i++) {
      const gx = x + cells[i][0];
      const gy = y + cells[i][1];
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && state.board[gy][gx]) return true;
    }
    return false;
  }

  function nextType() {
    if (!state.bag.length) {
      state.bag = TYPES.slice();
      for (let i = state.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.bag[i], state.bag[j]] = [state.bag[j], state.bag[i]];
      }
    }
    return state.bag.pop();
  }

  function ensureQueue() {
    while (state.queue.length < 5) state.queue.push(nextType());
  }

  function spawn(type) {
    const pieceType = type || state.queue.shift();
    ensureQueue();
    state.active = {
      type: pieceType,
      rot: 0,
      x: pieceType === 'O' ? 4 : 3,
      y: pieceType === 'I' ? -1 : 0,
    };
    state.dropTimer = 0;
    state.lockTimer = 0;
    state.lockResets = 0;
    state.grounded = false;
    undoCapturedForPiece = false;
    renderPanels();
    if (collides(pieceType, 0, state.active.x, state.active.y)) gameOver();
  }

  function afterMove() {
    if (state.grounded && state.lockResets < MAX_LOCK_RESETS) {
      state.lockTimer = 0;
      state.lockResets += 1;
    }
  }

  function move(dx, dy) {
    const a = state.active;
    if (state.status !== 'playing' || !a) return false;
    if (collides(a.type, a.rot, a.x + dx, a.y + dy)) return false;
    a.x += dx;
    a.y += dy;
    afterMove();
    return true;
  }

  function rotate(dir) {
    const a = state.active;
    if (state.status !== 'playing' || !a) return false;
    if (a.type === 'O') {
      Sfx.rotate();
      return true;
    }
    const from = a.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const table = a.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}${to}`] || [[0, 0]];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (!collides(a.type, to, a.x + kx, a.y + ky)) {
        a.rot = to;
        a.x += kx;
        a.y += ky;
        afterMove();
        Sfx.rotate();
        return true;
      }
    }
    return false;
  }

  function hardDrop() {
    const a = state.active;
    if (state.status !== 'playing' || !a) return;
    // Snapshot before the piece moves or scores, so undo rewinds the whole drop.
    captureUndo();
    let dist = 0;
    while (dist < ROWS + 2 && !collides(a.type, a.rot, a.x, a.y + dist + 1)) dist += 1;
    a.y += dist;
    if (dist > 0) addScore(dist * 2);
    Sfx.drop();
    lockPiece();
  }

  function holdPiece() {
    if (state.status !== 'playing' || !state.active || state.holdUsed) return;
    const current = state.active.type;
    const swapped = state.hold;
    state.hold = current;
    spawn(swapped || undefined);
    state.holdUsed = true;
    Sfx.hold();
    renderPanels();
  }

  function addScore(points) {
    if (!points) return;
    state.score += points;
    if (state.score > state.best) {
      state.best = state.score;
      store.set('tetris.best', String(state.best));
    }
    renderStats();
  }

  function clearLines() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (!state.board[y][x]) {
          full = false;
          break;
        }
      }
      if (full) rows.push(y);
    }
    if (!rows.length) {
      state.combo = 0;
      return 0;
    }

    const kept = [];
    for (let y = 0; y < ROWS; y++) {
      if (!rows.includes(y)) kept.push(state.board[y]);
    }
    while (kept.length < ROWS) kept.unshift(new Array(COLS).fill(null));
    state.board = kept;

    const count = rows.length;
    state.combo += 1;
    addScore(SCORE_TABLE[count] * state.level);
    if (state.combo > 1) addScore(50 * (state.combo - 1) * state.level);

    const previousLevel = state.level;
    state.lines += count;
    state.level = 1 + Math.floor(state.lines / 10);
    renderStats();

    state.clearing = rows;
    state.clearTimer = CLEAR_FLASH;
    Sfx.clear(count);
    if (state.level > previousLevel) Sfx.levelUp();

    return count;
  }

  function lockPiece() {
    const a = state.active;
    if (!a) return;
    if (!undoCapturedForPiece) captureUndo();
    const cells = PIECES[a.type].states[a.rot];
    let topOut = false;
    for (let i = 0; i < cells.length; i++) {
      const x = a.x + cells[i][0];
      const y = a.y + cells[i][1];
      if (y < 0) {
        topOut = true;
        continue;
      }
      if (y < ROWS && x >= 0 && x < COLS) state.board[y][x] = a.type;
    }
    state.active = null;
    state.holdUsed = false;
    Sfx.lock();
    if (topOut) {
      gameOver();
      return;
    }
    clearLines();
    spawn();
  }

  function gameOver() {
    state.active = null;
    setStatus('over');
    store.set('tetris.best', String(state.best));
    Sfx.over();
  }

  function startGame() {
    Sfx.init();
    state.board = makeBoard();
    state.active = null;
    state.queue = [];
    state.bag = [];
    state.hold = null;
    state.holdUsed = false;
    state.score = 0;
    state.lines = 0;
    state.level = 1;
    state.dropTimer = 0;
    state.lockTimer = 0;
    state.lockResets = 0;
    state.grounded = false;
    state.clearing = [];
    state.clearTimer = 0;
    state.combo = 0;
    undoSnapshot = null;
    undoUsed = false;
    undoCapturedForPiece = false;
    setStatus('playing');
    ensureQueue();
    spawn();
    renderStats();
    renderPanels();
    Sfx.start();
  }

  function setStatus(status) {
    state.status = status;
    document.body.dataset.status = status;
    syncOverlay();
    refreshUndoButton();
  }

  function togglePause() {
    if (state.status === 'playing') {
      setStatus('paused');
    } else if (state.status === 'paused') {
      setStatus('playing');
    }
  }

  function syncOverlay() {
    const status = state.status;
    if (status === 'playing') return;

    if (status === 'paused') {
      ui.ovEyebrow.textContent = 'Paused';
      ui.ovTitle.textContent = 'Take a breath';
      ui.ovText.textContent = 'The stack will wait.';
      ui.ovBtn.textContent = 'Resume';
      ui.ovFoot.textContent = 'Press P, Start, or tap resume';
    } else if (status === 'over') {
      ui.ovEyebrow.textContent = 'Game over';
      ui.ovTitle.textContent = 'Nice run';
      ui.ovText.textContent = `${state.score.toLocaleString()} points · ${state.lines} lines · level ${state.level}`;
      ui.ovBtn.textContent = 'Play again';
      ui.ovFoot.textContent = state.score >= state.best && state.score > 0 ? 'New best score' : 'Press R or Start to retry';
    } else {
      ui.ovEyebrow.textContent = 'Ready';
      ui.ovTitle.textContent = 'Tetris';
      ui.ovText.textContent = 'Clear lines. Keep the stack low. Don\u2019t top out.';
      ui.ovBtn.textContent = 'Play';
      ui.ovFoot.textContent = 'Keyboard · touch · controller';
    }
  }

  function toggleMute() {
    Sfx.muted = !Sfx.muted;
    store.set('tetris.muted', Sfx.muted ? '1' : '0');
    ui.soundBtn.textContent = Sfx.muted ? '🔇' : '🔊';
    ui.soundBtn.setAttribute('aria-label', Sfx.muted ? 'Unmute sound' : 'Mute sound');
    if (!Sfx.muted) {
      Sfx.init();
      Sfx.rotate();
    }
  }

  /* ------------------------------------------------------------------ *
   * Derived data: gravity, DAS
   * ------------------------------------------------------------------ */

  function updateGravity(dt) {
    const a = state.active;
    if (!a) return;

    const grounded = collides(a.type, a.rot, a.x, a.y + 1);
    if (grounded) {
      if (!state.grounded) {
        state.grounded = true;
        state.lockTimer = 0;
      }
      state.lockTimer += dt;
      if (state.lockTimer >= LOCK_DELAY) lockPiece();
      return;
    }

    state.grounded = false;
    state.lockTimer = 0;
    state.dropTimer += dt * (input.down ? SOFT_DROP_MULT : 1);

    const interval = dropInterval();
    let guard = 0;
    while (state.dropTimer >= interval && guard < 24) {
      guard += 1;
      state.dropTimer -= interval;
      if (canStepDown()) {
        a.y += 1;
        if (input.down) addScore(1);
      } else {
        state.dropTimer = 0;
        break;
      }
    }
  }

  function canStepDown() {
    const a = state.active;
    return !!a && !collides(a.type, a.rot, a.x, a.y + 1);
  }

  function updateHorizontal(dt) {
    if (!state.active) return;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir === 0) {
      das.dir = 0;
      das.timer = 0;
      return;
    }
    if (dir !== das.dir) {
      das.dir = dir;
      das.timer = DAS;
      if (move(dir, 0)) Sfx.move();
      return;
    }
    das.timer -= dt;
    let guard = 0;
    while (das.timer <= 0 && guard < 12) {
      guard += 1;
      if (!move(dir, 0)) {
        das.timer = ARR;
        break;
      }
      Sfx.move();
      das.timer += ARR;
    }
  }

  const das = { dir: 0, timer: 0 };

  /* ---------- undo (one per piece placement) ---------- */

  let undoSnapshot = null;
  let undoUsed = false;
  let undoCapturedForPiece = false;

  function captureUndo() {
    const a = state.active;
    undoCapturedForPiece = true;
    undoSnapshot = {
      board: state.board.map((row) => row.slice()),
      active: a ? { ...a } : null,
      score: state.score,
      lines: state.lines,
      level: state.level,
      hold: state.hold,
      holdUsed: state.holdUsed,
      queue: state.queue.slice(),
      bag: state.bag.slice(),
      combo: state.combo,
    };
    undoUsed = false;
    refreshUndoButton();
  }

  function undoMove() {
    if (state.status !== 'playing' || !undoSnapshot || undoUsed) return false;
    const snap = undoSnapshot;

    state.board = snap.board.map((row) => row.slice());
    state.active = snap.active ? { ...snap.active } : null;
    state.score = snap.score;
    state.lines = snap.lines;
    state.level = snap.level;
    state.hold = snap.hold;
    state.holdUsed = snap.holdUsed;
    state.queue = snap.queue.slice();
    state.bag = snap.bag.slice();
    state.combo = snap.combo;

    state.clearing = [];
    state.clearTimer = 0;
    state.dropTimer = 0;
    state.lockTimer = 0;
    state.lockResets = 0;
    state.grounded = false;
    undoUsed = true;

    renderStats();
    renderPanels();
    refreshUndoButton();
    Sfx.undo();
    return true;
  }

  function refreshUndoButton() {
    if (!ui.undoBtn) return;
    ui.undoBtn.disabled = !(state.status === 'playing' && undoSnapshot && !undoUsed);
  }

  function update(dt) {
    if (state.clearTimer > 0) {
      state.clearTimer -= dt;
      if (state.clearTimer <= 0) {
        state.clearTimer = 0;
        state.clearing = [];
      }
    }
    updateHorizontal(dt);
    updateGravity(dt);
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  let cellSize = 30;

  function drawBoard() {
    const ctx = boardCtx;
    const w = COLS * cellSize;
    const h = ROWS * cellSize;

    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0c1122');
    bg.addColorStop(1, '#070a14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(140, 170, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let y = 1; y < ROWS; y++) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const type = state.board[y][x];
        if (type) drawBlock(ctx, x * cellSize, y * cellSize, cellSize, COLORS[type]);
      }
    }

    const a = state.active;
    if (a) {
      const cells = PIECES[a.type].states[a.rot];

      if (state.status === 'playing' || state.status === 'paused') {
        let ghostY = a.y;
        let guard = 0;
        while (guard < ROWS + 2 && !collides(a.type, a.rot, a.x, ghostY + 1)) {
          ghostY += 1;
          guard += 1;
        }
        if (ghostY !== a.y) {
          for (let i = 0; i < cells.length; i++) {
            const gy = ghostY + cells[i][1];
            if (gy < 0) continue;
            drawGhost(ctx, (a.x + cells[i][0]) * cellSize, gy * cellSize, cellSize, COLORS[a.type]);
          }
        }
      }

      for (let i = 0; i < cells.length; i++) {
        const py = a.y + cells[i][1];
        if (py < 0) continue;
        drawBlock(ctx, (a.x + cells[i][0]) * cellSize, py * cellSize, cellSize, COLORS[a.type]);
      }
    }

    if (state.clearTimer > 0) {
      const t = state.clearTimer / CLEAR_FLASH;
      for (let i = 0; i < state.clearing.length; i++) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.42 * t})`;
        ctx.fillRect(0, state.clearing[i] * cellSize, w, cellSize);
      }
    }
  }

  function renderStats() {
    ui.score.textContent = state.score.toLocaleString();
    ui.lines.textContent = String(state.lines);
    ui.level.textContent = String(state.level);
    ui.best.textContent = state.best.toLocaleString();
  }

  function renderHold() {
    const { ctx, w, h } = fitCanvas(ui.hold);
    ctx.clearRect(0, 0, w, h);
    if (!state.hold) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(150, 170, 220, 0.28)';
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('—', w / 2, h / 2);
      return;
    }
    ctx.globalAlpha = state.holdUsed ? 0.32 : 1;
    drawPieceCentered(ctx, state.hold, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  function renderNext() {
    const { ctx, w, h } = fitCanvas(ui.next);
    ctx.clearRect(0, 0, w, h);
    const items = state.queue.slice(0, 3);
    if (!items.length) return;

    const horizontal = w > h * 1.3;
    const slotW = horizontal ? w / items.length : w;
    const slotH = horizontal ? h : h / items.length;

    for (let i = 0; i < items.length; i++) {
      const ox = horizontal ? i * slotW : 0;
      const oy = horizontal ? 0 : i * slotH;
      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.35, 0.78 - i * 0.16);
      drawPieceCentered(ctx, items[i], ox, oy, slotW, slotH);
    }
    ctx.globalAlpha = 1;
  }

  function renderPanels() {
    renderHold();
    renderNext();
  }

  function resizeBoard() {
    // The board shares a row with the hold/next rail, so the usable square is
    // whatever the playfield leaves over once the rail and gap are counted.
    const styles = getComputedStyle(ui.playfield);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const gap = parseFloat(styles.columnGap) || 0;
    const railW = ui.rail ? ui.rail.offsetWidth : 0;

    const availW = ui.playfield.clientWidth - padX - railW - gap;
    const availH = ui.playfield.clientHeight - padY;
    if (availW < 2 || availH < 2) return;

    cellSize = Math.max(6, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    const w = cellSize * COLS;
    const h = cellSize * ROWS;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    ui.shell.style.width = `${w}px`;
    ui.shell.style.height = `${h}px`;
    ui.board.width = Math.round(w * dpr);
    ui.board.height = Math.round(h * dpr);
    ui.board.style.width = '100%';
    ui.board.style.height = '100%';
    ui.wrap.style.width = '100%';
    ui.wrap.style.height = '100%';
    boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderPanels();
  }

  /* ------------------------------------------------------------------ *
   * Unified input
   * ------------------------------------------------------------------ */

  const sources = {
    key: { left: false, right: false, down: false },
    touch: { left: false, right: false, down: false },
    pad: { left: false, right: false, down: false },
  };

  const input = { left: false, right: false, down: false };

  function syncInput() {
    input.left = sources.key.left || sources.touch.left || sources.pad.left;
    input.right = sources.key.right || sources.touch.right || sources.pad.right;
    input.down = sources.key.down || sources.touch.down || sources.pad.down;
    if (!input.left && !input.right) {
      das.dir = 0;
      das.timer = 0;
    }
  }

  function doAction(action) {
    if (action === 'confirm') {
      if (state.status === 'ready' || state.status === 'over') startGame();
      else if (state.status === 'paused') setStatus('playing');
      return;
    }
    if (action === 'pause') {
      togglePause();
      return;
    }
    if (action === 'restart') {
      if (state.status !== 'ready') startGame();
      return;
    }
    if (action === 'mute') {
      toggleMute();
      return;
    }
    if (action === 'undo') {
      undoMove();
      return;
    }
    if (action === 'start') {
      startGame();
      return;
    }

    // Any gameplay input on the title / game-over screen starts a run.
    if (state.status === 'ready' || state.status === 'over') {
      startGame();
      return;
    }
    if (state.status !== 'playing') return;

    if (action === 'rotateCW') rotate(1);
    else if (action === 'rotateCCW') rotate(-1);
    else if (action === 'hold') holdPiece();
    else if (action === 'hardDrop') hardDrop();
  }

  /* ---------- keyboard ---------- */

  const KEY_ACTIONS = {
    ArrowLeft: 'left',
    a: 'left',
    A: 'left',
    ArrowRight: 'right',
    d: 'right',
    D: 'right',
    ArrowDown: 'down',
    s: 'down',
    S: 'down',
    ArrowUp: 'rotateCW',
    x: 'rotateCW',
    X: 'rotateCW',
    w: 'rotateCW',
    W: 'rotateCW',
    z: 'rotateCCW',
    Z: 'rotateCCW',
    Control: 'rotateCCW',
    ' ': 'hardDrop',
    c: 'hold',
    C: 'hold',
    Shift: 'hold',
    b: 'undo',
    B: 'undo',
    p: 'pause',
    P: 'pause',
    Escape: 'pause',
    r: 'restart',
    R: 'restart',
    m: 'mute',
    M: 'mute',
    Enter: 'confirm',
  };

  const heldKeys = new Set();

  function updateKeyDirections() {
    sources.key.left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    sources.key.right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    sources.key.down = heldKeys.has('ArrowDown') || heldKeys.has('s') || heldKeys.has('S');
    syncInput();
  }

  window.addEventListener('keydown', (event) => {
    const action = KEY_ACTIONS[event.key];
    if (!action) return;

    if (event.key === ' ' || event.key.startsWith('Arrow')) event.preventDefault();
    if (event.repeat) return;

    Sfx.init();
    heldKeys.add(event.key);
    updateKeyDirections();

    if (action === 'left' || action === 'right' || action === 'down') {
      if (state.status === 'ready' || state.status === 'over') startGame();
      return;
    }
    doAction(action);
  });

  window.addEventListener('keyup', (event) => {
    if (!KEY_ACTIONS[event.key]) return;
    heldKeys.delete(event.key);
    updateKeyDirections();
  });

  window.addEventListener('blur', () => {
    heldKeys.clear();
    updateKeyDirections();
    sources.touch.left = sources.touch.right = sources.touch.down = false;
    syncInput();
    if (state.status === 'playing') setStatus('paused');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.status === 'playing') setStatus('paused');
  });

  /* ---------- touch buttons ---------- */

  ui.touchPad.querySelectorAll('.tbtn').forEach((btn) => {
    const act = btn.dataset.act;

    const press = (event) => {
      event.preventDefault();
      Sfx.init();
      btn.classList.add('on');
      if (act === 'left' || act === 'right' || act === 'down') {
        sources.touch[act] = true;
        syncInput();
        if (state.status === 'ready' || state.status === 'over') startGame();
      } else if (act === 'rotate') {
        doAction('rotateCW');
      } else if (act === 'drop') {
        doAction('hardDrop');
      } else if (act === 'hold') {
        doAction('hold');
      }
    };

    const release = (event) => {
      if (event) event.preventDefault();
      btn.classList.remove('on');
      if (act === 'left' || act === 'right' || act === 'down') {
        sources.touch[act] = false;
        syncInput();
      }
    };

    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  /* ---------- swipe / tap on the board ---------- */

  let swipe = null;

  ui.wrap.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.overlay')) return;
    if (state.status === 'ready' || state.status === 'over') {
      startGame();
      return;
    }
    Sfx.init();
    swipe = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      time: performance.now(),
    };
    try {
      ui.wrap.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });

  ui.wrap.addEventListener('pointermove', (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const step = Math.max(18, cellSize * 0.9);
    if (event.clientX - swipe.lastX > step) {
      swipe.lastX += step;
      if (move(1, 0)) Sfx.move();
    } else if (swipe.lastX - event.clientX > step) {
      swipe.lastX -= step;
      if (move(-1, 0)) Sfx.move();
    }
  });

  ui.wrap.addEventListener('pointerup', (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - swipe.time;
    swipe = null;

    if (dist < 14 && elapsed < 280) {
      doAction('rotateCW');
      return;
    }
    if (dist > 44 && Math.abs(dy) > Math.abs(dx) * 1.1) {
      if (dy > 0) doAction('hardDrop');
      else doAction('hold');
    }
  });

  ui.wrap.addEventListener('pointercancel', () => {
    swipe = null;
  });

  ui.overlay.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#ov-btn')) return;
    doAction('confirm');
  });

  ui.ovBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    doAction('confirm');
  });

  ui.undoBtn.addEventListener('click', () => {
    Sfx.init();
    doAction('undo');
  });

  ui.pauseBtn.addEventListener('click', () => {
    Sfx.init();
    togglePause();
  });

  ui.soundBtn.addEventListener('click', () => {
    toggleMute();
  });

  /* ---------- gamepad ---------- */

  const padState = {
    connected: false,
    id: '',
    mapping: '',
    prev: [],
    statusText: '',
  };

  // Mapping: left stick and d-pad left/right move, A hard drops,
  // X rotates, Y holds. B is kept as rotate-counter-clockwise and
  // d-pad up/down as hard drop / soft drop.
  const PAD_BUTTONS = {
    rotateCW: [2], // X
    rotateCCW: [1], // B
    hold: [3], // Y
    hardDrop: [0, 12], // A, d-pad up
    pause: [9],
    mute: [8],
  };

  function setPadStatus(pad) {
    const label = pad
      ? (pad.id || 'Controller').replace(/\s*\([^)]*\)\s*/g, ' ').trim().slice(0, 34) + (pad.mapping === 'standard' ? '' : ' · custom map')
      : 'No controller — press a pad button';
    if (label === padState.statusText) return;
    padState.statusText = label;
    ui.padLabel.textContent = label;
    ui.padStatus.classList.toggle('online', !!pad);
  }

  function getFirstGamepad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  function pollGamepad() {
    const pad = getFirstGamepad();
    setPadStatus(pad);

    if (!pad) {
      padState.connected = false;
      padState.prev = [];
      if (sources.pad.left || sources.pad.right || sources.pad.down) {
        sources.pad.left = sources.pad.right = sources.pad.down = false;
        syncInput();
      }
      return;
    }

    padState.connected = true;
    padState.id = pad.id || '';
    padState.mapping = pad.mapping || '';

    const axes = pad.axes || [];
    const ax = typeof axes[0] === 'number' ? axes[0] : 0;
    const ay = typeof axes[1] === 'number' ? axes[1] : 0;

    const pressed = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      pressed[i] = !!(b && (b.pressed || b.value > 0.4));
    }

    // First frame with this pad (or a layout change): record state without
    // firing actions, so already-held buttons don't all fire at once.
    if (padState.prev.length !== pressed.length) {
      padState.prev = pressed;
      return;
    }

    const edge = (i) => !!pressed[i] && !padState.prev[i];

    // Movement: left stick or d-pad left/right.
    sources.pad.left = !!pressed[14] || ax < -GAMEPAD_DEADZONE;
    sources.pad.right = !!pressed[15] || ax > GAMEPAD_DEADZONE;
    sources.pad.down = !!pressed[13] || ay > GAMEPAD_DEADZONE;
    syncInput();

    for (const action in PAD_BUTTONS) {
      const indexes = PAD_BUTTONS[action];
      for (let i = 0; i < indexes.length; i++) {
        if (edge(indexes[i])) {
          if (action === 'pause') {
            if (state.status === 'over' || state.status === 'ready') startGame();
            else togglePause();
          } else if (action === 'mute') {
            toggleMute();
          } else {
            doAction(action);
          }
          break;
        }
      }
    }

    padState.prev = pressed;
  }

  window.addEventListener('gamepadconnected', () => {
    Sfx.init();
    const pad = getFirstGamepad();
    if (pad) setPadStatus(pad);
  });

  window.addEventListener('gamepaddisconnected', () => {
    setPadStatus(null);
  });

  /* ------------------------------------------------------------------ *
   * Loop
   * ------------------------------------------------------------------ */

  let lastTime = 0;

  function frame(now) {
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 100) dt = 100;
    if (dt < 0) dt = 0;

    pollGamepad();
    if (state.status === 'playing') update(dt);
    drawBoard();

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function enableTouchControls() {
    document.body.classList.add('touch');
  }

  function init() {
    if (window.matchMedia('(pointer: coarse)').matches) enableTouchControls();
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') enableTouchControls();
    }, { passive: true });

    state.best = Number(store.get('tetris.best', '0')) || 0;
    ui.soundBtn.textContent = Sfx.muted ? '🔇' : '🔊';
    ui.soundBtn.setAttribute('aria-label', Sfx.muted ? 'Unmute sound' : 'Mute sound');

    ensureQueue();
    renderStats();
    setStatus('ready');
    refreshUndoButton();
    renderPanels();
    resizeBoard();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resizeBoard).observe(ui.playfield);
    }
    window.addEventListener('resize', resizeBoard);
    window.addEventListener('orientationchange', () => setTimeout(resizeBoard, 120));

    requestAnimationFrame(frame);
  }

  init();

  // Small hook for debugging / automated checks.
  window.Tetris = {
    state,
    startGame,
    move,
    rotate,
    hardDrop,
    holdPiece,
    undoMove,
    lockPiece,
    spawn,
    clearLines,
    setStatus,
    togglePause,
    doAction,
    get cellSize() {
      return cellSize;
    },
  };
})();
