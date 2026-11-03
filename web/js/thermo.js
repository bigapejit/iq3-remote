// The temperature strip: one bar per degree, bottom to top, along the right edge.
// While the IQ3 is on, slide to set the target. It is also the power switch:
//   off → pull the bars up and hold 3 s: they stretch apart, then "brup", it turns on.
//   on  → slide to the bottom, keep pulling down and hold 3 s to turn it off.
const EMBER = '255,138,69';
const READY = '168,220,234';
const DIM = '139,151,163';
const BONE = '236,230,220';
const PAD = 8;
const ENGAGE_PX = 34;      // how far past the end the pull must go before the hold counts
const HOLD_MS = 3000;

function bar(g, x, y, w, h) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  g.fill();
}

const buzz = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

export class ThermoStrip {
  constructor(root, bubble, { onCommit, onPower, onRelease, onDrag } = {}) {
    this.root = root;
    this.bubble = bubble;
    this.bigEl = bubble.querySelector('b');
    this.smallEl = bubble.querySelector('small');
    this.canvas = root.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.onCommit = onCommit;
    this.onPower = onPower;
    this.onRelease = onRelease;
    this.onDrag = onDrag;
    this.min = 350;
    this.max = 430;
    this.v = { mode: 'wake', target: null, pending: null, current: null, tone: 'off' };
    this.live = null;
    this.lens = 0.35;
    this.dragging = false;
    this.pull = 0;           // + up, − down, in px past the end
    this.pullShown = 0;
    this.pullVel = 0;
    this.held = 0;           // ms held while engaged
    this.fired = null;       // 'on' | 'off' once the hold completes
    this.firedNote = '';
    this.flash = 0;
    this.fingerY = 0;
    this.lastBuzz = 0;
    this.last = 0;
    this.raf = 0;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(root);
    this.resize();
  }

  setScale(min, max) {
    if (min === this.min && max === this.max) return;
    this.min = min;
    this.max = max;
    this.kick();
  }

  setValues(v) {
    Object.assign(this.v, v);
    this._bubble();
    this.kick();
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.kick();
  }

  value() {
    if (this.live != null) return this.live;
    if (this.v.pending != null) return this.v.pending;
    return this.v.target;
  }

  spacing() { return (this.h - PAD * 2) / (this.max - this.min + 1); }
  yOf(val) { return this.h - PAD - (val - this.min + 0.5) * this.spacing(); }

  // ---- Touch ---------------------------------------------------------------------------
  _bind() {
    const el = this.root;
    let startY = 0;
    let startV = 0;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      startY = e.clientY;
      const cur = this.value();
      startV = Math.round(cur != null ? cur : (this.min + this.max) / 2);
      this.live = this.v.mode === 'adjust' ? startV : null;
      this.pull = 0;
      this.held = 0;
      this.fired = null;
      this.firedNote = '';
      this.fingerY = e.clientY - this.root.getBoundingClientRect().top;
      this.last = performance.now();
      if (this.onDrag) this.onDrag(true);
      this._bubble();
      this.kick();
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const up = startY - e.clientY;
      this.fingerY = e.clientY - this.root.getBoundingClientRect().top;
      if (this.v.mode === 'adjust' && !this.fired) {
        const raw = startV + up / this.spacing();
        const next = Math.max(this.min, Math.min(this.max, Math.round(raw)));
        if (next !== this.live) {
          this.live = next;
          buzz(4);
        }
        const below = this.min - 0.5 - raw;
        this.pull = below > 0 ? -below * this.spacing() : 0;
      } else if (this.v.mode === 'wake' && !this.fired) {
        this.pull = Math.max(0, up);
      }
      this._bubble();
      this.kick();
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      const fired = this.fired;
      if (this.onDrag) this.onDrag(false);
      // Still inside the pointerup: anything that needs a user gesture (the Bluetooth picker) runs here.
      if (this.onRelease) this.onRelease(fired);
      if (!fired && this.v.mode === 'adjust' && this.live != null && this.onCommit) this.onCommit(this.live);
      this.live = null;
      this.pull = 0;
      this.held = 0;
      this._bubble();
      this.kick();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _engaged() { return Math.abs(this.pull) > ENGAGE_PX; }

  _fire(dir) {
    this.fired = dir;
    this.flash = 1;
    buzz([18, 34, 80]);                   // the "brup"
    this.firedNote = (this.onPower && this.onPower(dir)) || '';
    this._bubble();
  }

  // ---- Bubble -----------------------------------------------------------------------------
  _bubble() {
    const b = this.bubble;
    let big = '';
    let small = '';
    let y = null;
    const v = this.value();
    if (this.dragging) {
      y = Math.max(40, Math.min(this.h - 40, this.fingerY));
      if (this.fired) {
        big = this.fired === 'on' ? 'On' : 'Off';
        small = this.firedNote;
      } else if (this._engaged()) {
        big = String(Math.max(1, Math.ceil((HOLD_MS - this.held) / 1000)));
        small = this.pull > 0 ? 'Hold to turn on' : 'Hold to turn off';
      } else if (this.v.mode === 'adjust') {
        big = `${this.live}°`;
        small = this.live === this.min ? 'Keep pulling down to turn off' : '';
        y = this.yOf(this.live);
      } else {
        small = 'Pull up and hold to turn on';
      }
    } else if (this.v.pending != null && v != null) {
      big = `${Math.round(v)}°`;
      small = this.v.mode === 'adjust' ? 'Setting' : 'When it turns on';
      y = this.yOf(Math.round(v));
    }
    b.classList.toggle('on', !!(big || small));
    this.bigEl.textContent = big;
    this.smallEl.textContent = small;
    if (y != null) b.style.top = `${this.root.offsetTop + y}px`;
  }

  // ---- Animation ----------------------------------------------------------------------------
  kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => this._tick());
  }

  _tick() {
    this.raf = 0;
    const now = performance.now();
    const dt = Math.min(50, now - (this.last || now));
    this.last = now;

    // Hold timer with accelerating haptic ticks
    if (this.dragging && !this.fired && this._engaged()) {
      const before = Math.ceil((HOLD_MS - this.held) / 1000);
      this.held = Math.min(HOLD_MS, this.held + dt);
      const p = this.held / HOLD_MS;
      if (now - this.lastBuzz > 320 - 230 * p) { buzz(3); this.lastBuzz = now; }
      if (Math.ceil((HOLD_MS - this.held) / 1000) !== before) this._bubble();
      if (this.held >= HOLD_MS) this._fire(this.pull > 0 ? 'on' : 'off');
    } else if (!this.fired) {
      this.held = Math.max(0, this.held - dt * 3);
    }

    // Rubber band: the shown pull follows the finger, and springs back with a little bounce
    const goal = this.dragging && !this.fired ? this.pull : 0;
    this.pullVel += ((goal - this.pullShown) * 180 - this.pullVel * 18) * (dt / 1000);
    this.pullShown += this.pullVel * (dt / 1000);
    this.flash = Math.max(0, this.flash - dt / 700);
    this.lens += ((this.dragging ? 1 : 0.35) - this.lens) * 0.22;

    this._draw();
    const settling = Math.abs(this.pullShown) > 0.3 || Math.abs(this.pullVel) > 0.3 || this.flash > 0 || Math.abs((this.dragging ? 1 : 0.35) - this.lens) > 0.004;
    if (this.dragging || this.held > 0 || settling) this.kick();
  }

  _draw() {
    const { g, w, h } = this;
    if (!w || !h) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { mode, current, tone } = this.v;
    const awake = mode === 'adjust';
    const val = this.value();
    const level = val != null ? Math.round(val) : null;
    const sp = this.spacing();
    const right = w - 14;
    const pullingOn = !awake && this.dragging;
    const accent = tone === 'ready' ? READY : tone === 'heat' || awake || pullingOn ? EMBER : DIM;
    const p = this.held / HOLD_MS;

    // Stretch: bars spread apart away from the anchored end and get thinner
    const pullAmt = this.pullShown;
    const s = 1 - Math.exp(-Math.abs(pullAmt) / 150);
    const anchor = pullAmt >= 0 ? h - PAD : PAD;
    const spread = 1 + 0.5 * s;
    const yAt = (v) => anchor + (this.yOf(v) - anchor) * spread;
    const thick = Math.max(0.8, Math.min(3, sp * 0.36) * (1 - 0.6 * s));
    const focus = this.dragging ? this.fingerY : level != null ? yAt(level) : h / 2;
    const sigma = 46;

    // What's lit: the level when awake; while pulling to turn on, a fill rising with the hold;
    // while pulling to turn off, the level draining away.
    let litTo = null;
    if (awake && level != null) litTo = pullAmt < -1 ? this.min + (level - this.min) * (1 - p) : level;
    else if (!awake && this.dragging && pullAmt > 1) litTo = this.min + (this.max - this.min) * p * 0.75;

    g.textAlign = 'right';
    g.font = '400 11px Saira, system-ui, sans-serif';
    for (let v = this.min; v <= this.max; v++) {
      const y = yAt(v);
      if (y < -4 || y > h + 4) continue;
      const major = v % 10 === 0;
      const mid = v % 5 === 0;
      const dy = (y - focus) / sigma;
      const mag = 1 + 1.7 * this.lens * Math.exp(-dy * dy);
      const len = (major ? 20 : mid ? 15 : 10) * mag * (1 + 0.25 * s);
      let color = BONE;
      let alpha;
      if (litTo != null && v <= litTo) {
        color = accent;
        const frac = (v - this.min) / Math.max(1, litTo - this.min);
        alpha = 0.22 + 0.6 * frac * frac + 0.2 * (mag - 1);
      } else {
        alpha = (awake ? 0.15 : 0.12) + 0.22 * (mag - 1);
      }
      alpha += this.flash * 0.5;
      g.fillStyle = `rgba(${color},${Math.min(1, alpha).toFixed(3)})`;
      bar(g, right - len, y - thick / 2, len, thick);
      if (major && awake && s < 0.05 && (level == null || Math.abs(v - level) > 3)) {
        g.fillStyle = `rgba(${BONE},${Math.min(0.8, 0.22 + 0.35 * (mag - 1)).toFixed(3)})`;
        g.fillText(String(v), right - len - 8, y + 4);
      }
    }

    // The level marker, with its number when idle
    if (awake && level != null && s < 0.5) {
      const y = yAt(level);
      const len = 30 * (1 + 1.7 * this.lens);
      g.fillStyle = `rgba(${accent},${1 - s})`;
      bar(g, right - len, y - 1.6, len, 3.2);
      g.beginPath();
      g.arc(right - len - 7, y, 3.2, 0, Math.PI * 2);
      g.fill();
      if (!this.dragging) {
        g.font = '500 12px Saira, system-ui, sans-serif';
        g.fillText(String(level), right - len - 15, y + 4);
      }
    }

    // Where the oven actually is right now
    if (current != null && awake) {
      const y = Math.max(PAD, Math.min(h - PAD, yAt(current)));
      g.fillStyle = `rgba(${BONE},.95)`;
      g.beginPath();
      g.moveTo(right + 4, y);
      g.lineTo(right + 11, y - 4.5);
      g.lineTo(right + 11, y + 4.5);
      g.closePath();
      g.fill();
    }
  }
}
