// IQ3 device client: connect, remember and reconnect, live state, commands,
// temperature targeting by key presses, and draw (inhale) detection.
// Protocol notes live in ../../PROTOCOL.md.

export const UUID = {
  SCAN: 'edfec62e-9900-b00b-1e50-005041934743',
  SVC: 'edfec62e-9900-b00b-1e50-0050414e4743',
  CTRL: '01000000-0000-0000-0000-0050414e4743',
  STATE: '02000000-0000-0000-0000-0050414e4743',
  SESSION: '05000000-0000-0000-0000-0050414e4743',
  C06: '06000000-0000-0000-0000-0050414e4743',
  C07: '07000000-0000-0000-0000-0050414e4743',
  PATHS: '09000000-0000-0000-0000-0050414e4743',
  STATS: '0d000000-0000-0000-0000-0050414e4743',
  DIS: '0000180a-0000-1000-8000-00805f9b34fb',
  GAP: '00001800-0000-1000-8000-00805f9b34fb',
};

export const STATE = { OFF: 0, IDLE: 1, ON: 2, SMART_PATH: 3, PATH_SELECT: 4, PATH_TEMP: 5, PRECISION: 6, BOOST: 7, STANDBY: 8 };
const HEATING = new Set([2, 3, 4, 5, 6, 7]);
const KEY_UP = 0x02;
const KEY_DOWN = 0x04;
const STORE_KEY = 'iq3.device';

// Draw detection tuning (°C). A draw pulls air through the oven, so the reading dips below target.
const DRAW_DROP_C = 1.2;      // drop within the window that starts a draw
const DRAW_WINDOW_MS = 1600;
const DRAW_RECOVER_C = 0.8;   // rise from the low point that ends it
const DRAW_IDLE_MS = 2500;    // no further drop for this long ends it

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const bytesOf = (dv) => new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
export const hex = (arr) => Array.from(arr, (b) => (b & 255).toString(16).padStart(2, '0')).join(' ');
export const cToF = (c) => (c * 9) / 5 + 32;
export const fToC = (f) => ((f - 32) * 5) / 9;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${what} took longer than ${ms / 1000} s`);
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function waitVisible() {
  return new Promise((resolve) => {
    if (!document.hidden) return resolve();
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); resolve(); } };
    document.addEventListener('visibilitychange', on);
  });
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
}
function storeSaved(v) {
  try { v ? localStorage.setItem(STORE_KEY, JSON.stringify(v)) : localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}

export function parseState(dv) {
  if (dv.byteLength < 14) return null;
  const f = dv.getUint8(13);
  return {
    state: dv.getUint8(0),
    cur: dv.getUint16(1, true) / 100,
    target: dv.getUint16(3, true) / 100,
    path: dv.getUint8(7),
    timer: dv.getUint32(8, true),
    battery: Math.min(5, dv.getUint8(12)) * 20,
    celsius: (f & 0x02) !== 0,
    atTemp: (f & 0x04) !== 0,
    charging: (f & 0x08) !== 0,
    vibration: (f & 0x10) !== 0,
    stealth: (f & 0x20) !== 0,
  };
}

export function parsePaths(dv) {
  const paths = [];
  for (let i = 0; i < 4 && (i + 1) * 26 <= dv.byteLength; i++) {
    const o = i * 26;
    const seconds = dv.getInt16(o + 2, true);
    const n = Math.min(10, dv.getUint8(o + 24));
    const points = [];
    for (let j = 0; j < n; j++) points.push({ t: dv.getUint8(o + 4 + j * 2) / 255, c: dv.getUint8(o + 5 + j * 2) });
    paths.push({ index: i, minutes: seconds / 60, points });
  }
  return paths;
}

export class IQ3 extends EventTarget {
  constructor({ log } = {}) {
    super();
    this.log = log || (() => {});
    this.device = null;
    this.server = null;
    this.ch = {};
    this.link = 'idle';          // idle | searching | connecting | connected
    this.s = null;               // latest parsed state
    this.session = null;
    this.paths = null;
    this.saved = loadSaved();
    this.want = false;           // keep trying to stay connected
    this.seeking = false;
    this.chain = Promise.resolve();
    this.pollTimer = null;
    this.pollCount = 0;
    this.desiredC = null;        // target the user asked for, until the device matches it
    this.syncing = false;
    this.resync = false;
    this.stepC = null;           // learned size of one +/− press
    this.samples = [];
    this.draw = null;
    this.lastTargetChange = -Infinity;
    this._raw = {};
    this._onDisc = () => this._disconnected();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.link === 'connected') this._schedulePoll(0);
    });
  }

  get supported() { return !!navigator.bluetooth; }
  get canRestore() { return !!(navigator.bluetooth && navigator.bluetooth.getDevices); }
  get heating() { return !!this.s && HEATING.has(this.s.state); }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setLink(link) { if (this.link !== link) { this.link = link; this.emit('link', link); } }
  q(fn) { const run = this.chain.then(fn); this.chain = run.catch(() => {}); return run; }

  // ---- Finding and connecting -----------------------------------------------
  async pick() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [UUID.SCAN] },
        { services: [UUID.SVC] },
        { namePrefix: 'DAVINCI' },
        { namePrefix: 'DaVinci' },
        { namePrefix: 'IQ' },
      ],
      optionalServices: [UUID.SVC, UUID.SCAN, UUID.DIS, UUID.GAP],
    });
    this._adopt(device);
    this.want = true;
    this._seek(true);
  }

  // Reconnect to the IQ3 picked on an earlier visit, without the picker.
  async restore() {
    if (!this.canRestore) return false;
    let list = [];
    try { list = await navigator.bluetooth.getDevices(); } catch (e) { this.log('err', `getDevices: ${e.message}`); return false; }
    const device = list.find((d) => this.saved && d.id === this.saved.id) || list.find((d) => /iq3|davinci/i.test(d.name || ''));
    if (!device) return false;
    this._adopt(device);
    this.want = true;
    this._seek(false);
    return true;
  }

  // Start (or keep) looking for the IQ3 we already know. False if none is known.
  reconnect() {
    if (!this.device) return false;
    this.want = true;
    if (!this.seeking && !(this.server && this.server.connected)) this._seek(false);
    return true;
  }

  _adopt(device) {
    if (this.device && this.device !== device) {
      this.device.removeEventListener('gattserverdisconnected', this._onDisc);
      try { this.device.gatt.disconnect(); } catch { /* ignore */ }
    }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this._onDisc);
    this.saved = { id: device.id, name: device.name || 'IQ3' };
    storeSaved(this.saved);
  }

  async _seek(firstTime) {
    if (this.seeking) return;
    this.seeking = true;
    this.setLink('searching');
    const watcher = new AbortController();
    let watching = false;
    if (!firstTime && this.device.watchAdvertisements) {
      try { await this.device.watchAdvertisements({ signal: watcher.signal }); watching = true; } catch (e) { this.log('sys', `No advertisement watching (${e.message}); retrying on a timer`); }
    }
    try {
      let attempt = 0;
      while (this.want && !(this.server && this.server.connected)) {
        await waitVisible();
        attempt++;
        this.setLink('connecting');
        try {
          await this._connectOnce();
        } catch (e) {
          this.log('err', `Connect: ${e.name}: ${e.message}`);
          try { this.device.gatt.disconnect(); } catch { /* aborts a stalled attempt */ }
          if (!this.want) break;
          this.setLink('searching');
          this.emit('seek-failed', { attempt, error: e });
          await (watching ? this._nextAdvert(10000) : sleep(attempt < 3 ? 1000 : 4000));
        }
      }
    } finally {
      watcher.abort();
      this.seeking = false;
    }
  }

  _nextAdvert(ms) {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); this.device.removeEventListener('advertisementreceived', done); resolve(); };
      const t = setTimeout(done, ms);
      this.device.addEventListener('advertisementreceived', done);
    });
  }

  async _connectOnce() {
    const name = this.device.name || 'IQ3';
    this.log('sys', `Connecting to ${name}…`);
    this.server = await withTimeout(this.device.gatt.connect(), 12000, 'Connecting');
    const svc = await withTimeout(this.server.getPrimaryService(UUID.SVC), 10000, 'Finding the IQ3 service');
    this.ch = {};
    const wanted = { ctrl: UUID.CTRL, state: UUID.STATE, session: UUID.SESSION, c06: UUID.C06, c07: UUID.C07, paths: UUID.PATHS };
    for (const [key, uuid] of Object.entries(wanted)) {
      try { this.ch[key] = await svc.getCharacteristic(uuid); } catch { this.log('err', `Missing characteristic ${key}`); }
    }
    if (!this.ch.ctrl || !this.ch.state) throw new Error('This device is missing the IQ3 controls');
    this.setLink('connected');
    this.log('sys', `Connected to ${name}`);
    await this.readState();
    await this._listen();
    this.readSession().catch(() => {});
    this.readPaths().catch(() => {});
    this._schedulePoll(0);
    this.emit('connected');
    if (this.desiredC != null && this.heating) this._sync();
  }

  async _listen() {
    const subs = [
      ['state', (dv) => this._onState(dv)],
      ['session', (dv) => this._onSession(dv)],
      ['c06', (dv) => this._onRaw('06', dv)],
      ['c07', (dv) => this._onRaw('07', dv)],
    ];
    for (const [key, handler] of subs) {
      const c = this.ch[key];
      if (!c || !(c.properties.notify || c.properties.indicate)) continue;
      c.addEventListener('characteristicvaluechanged', (e) => handler(e.target.value));
      try { await this.q(() => c.startNotifications()); } catch (e) { this.log('err', `Notify ${key}: ${e.message}`); }
    }
  }

  _disconnected() {
    clearTimeout(this.pollTimer);
    this.server = null;
    if (this.draw) this._endDraw(performance.now());
    this.log('err', 'Disconnected');
    this.setLink(this.want ? 'searching' : 'idle');
    this.emit('disconnected');
    if (this.want) setTimeout(() => this._seek(false), 1500);
  }

  async forget() {
    this.want = false;
    const d = this.device;
    this.device = null;
    if (d) {
      d.removeEventListener('gattserverdisconnected', this._onDisc);
      try { d.gatt.disconnect(); } catch { /* ignore */ }
      try { if (d.forget) await d.forget(); } catch { /* older Chrome */ }
    }
    this.server = null;
    this.s = null;
    this.saved = null;
    storeSaved(null);
    clearTimeout(this.pollTimer);
    this.setLink('idle');
  }

  // ---- Reading ----------------------------------------------------------------
  _schedulePoll(ms) {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this._poll(), ms);
  }

  async _poll() {
    if (this.link !== 'connected') return;
    if (!document.hidden) {
      try {
        await this.readState();
        this.pollCount++;
        if (this.heating && this.pollCount % 3 === 0) await this.readSession();
      } catch (e) {
        this.log('err', `Poll: ${e.message}`);
      }
    }
    this._schedulePoll(this.heating || this.draw ? 600 : 2500);
  }

  async readState() {
    if (!this.ch.state) return;
    const dv = await this.q(() => this.ch.state.readValue());
    this._onState(dv);
  }

  async readSession() {
    if (!this.ch.session) return;
    const dv = await this.q(() => this.ch.session.readValue());
    this._onSession(dv);
  }

  async readPaths() {
    if (!this.ch.paths) return;
    const dv = await this.q(() => this.ch.paths.readValue());
    this.log('rx', `paths ${hex(bytesOf(dv))}`);
    this.paths = parsePaths(dv);
    this.emit('paths', this.paths);
  }

  _onRaw(name, dv) {
    const raw = hex(bytesOf(dv));
    if (this._raw[name] !== raw) { this._raw[name] = raw; this.log('rx', `char ${name}: ${raw}`); }
  }

  _onState(dv) {
    const raw = hex(bytesOf(dv));
    if (raw !== this._raw.state) { this._raw.state = raw; this.log('rx', `state ${raw}`); }
    const s = parseState(dv);
    if (!s) return;
    const prev = this.s;
    this.s = s;
    // Only big jumps (a new mode or a user change) pause draw detection; smart-path ramps are small steps.
    if (prev && Math.abs(prev.target - s.target) > 2) this.lastTargetChange = performance.now();
    this._detectDraw(s);
    this.emit('state', s);
    const turnedOn = prev && !HEATING.has(prev.state) && HEATING.has(s.state);
    if (turnedOn && this.desiredC != null) this._sync();
  }

  _onSession(dv) {
    const b = bytesOf(dv);
    const raw = hex(b);
    if (raw !== this._raw.session) { this._raw.session = raw; this.log('rx', `session ${raw}`); }
    if (b.length < 17) return;
    const puffs = b[16];
    const prev = this.session ? this.session.puffs : undefined;
    this.session = { puffs, lastPuffSec: b[6] / 10 + 1, flag: b[15] };
    if (prev !== undefined && puffs > prev) {
      this.log('sys', `The IQ3 counted draw ${puffs}`);
      this.emit('puff', { puffs, seconds: this.session.lastPuffSec, live: !!this.draw });
    }
    this.emit('session', this.session);
  }

  // A draw shows up as a quick dip below the target while the IQ3 is holding temperature.
  _detectDraw(s) {
    const now = performance.now();
    this.samples.push({ t: now, cur: s.cur });
    while (this.samples.length && now - this.samples[0].t > 4000) this.samples.shift();
    if (!HEATING.has(s.state) || this.syncing || now - this.lastTargetChange < 15000) {
      if (this.draw) this._endDraw(now);
      return;
    }
    if (!this.draw) {
      const holding = s.cur <= s.target + 1.5 && s.target - s.cur < 10;
      const recent = this.samples.filter((x) => now - x.t <= DRAW_WINDOW_MS).map((x) => x.cur);
      const peak = Math.max(...recent);
      if (holding && peak - s.cur >= DRAW_DROP_C) {
        this.draw = { start: now, low: s.cur, lastDrop: now, lastCur: s.cur };
        this.log('sys', `Draw started (${peak.toFixed(1)} to ${s.cur.toFixed(1)} °C)`);
        this.emit('draw', { phase: 'start' });
      }
      return;
    }
    const d = this.draw;
    if (s.cur < d.lastCur - 0.05) d.lastDrop = now;
    d.lastCur = s.cur;
    d.low = Math.min(d.low, s.cur);
    if (s.cur - d.low >= DRAW_RECOVER_C || now - d.lastDrop > DRAW_IDLE_MS || now - d.start > 15000) this._endDraw(now);
  }

  _endDraw(now) {
    const seconds = (now - this.draw.start) / 1000;
    this.draw = null;
    this.log('sys', `Draw ended after ${seconds.toFixed(1)} s`);
    this.emit('draw', { phase: 'end', seconds });
  }

  // ---- Commands ---------------------------------------------------------------
  async send(bytes, label) {
    if (!this.ch.ctrl) throw new Error('The IQ3 is not connected');
    if (bytes[0] === 0x20) throw new Error('Factory reset is blocked');
    const data = new Uint8Array(bytes);
    this.log('tx', `${label} [${hex(data)}]`);
    await this.q(() => (this.ch.ctrl.properties.write
      ? this.ch.ctrl.writeValueWithResponse(data)
      : this.ch.ctrl.writeValueWithoutResponse(data)));
  }

  async powerOn() {
    await this.send([0x30, 0x02], 'Power on');
    await sleep(500);
    await this.readState();
  }

  async powerOff() {
    this.desiredC = null;
    this.emit('desired', null);
    // Same three steps the official app sends.
    await this.send([0x30, 0x01], 'Standby');
    await sleep(500);
    await this.send([0x30, 0x00], 'Power off');
    await sleep(800);
    await this.send([0x10, 0x00], 'Release keys');
    await sleep(300);
    await this.readState();
  }

  async boost(on) {
    await this.send([0x30, on ? 0x04 : 0x09], on ? 'Boost' : 'End boost');
    await sleep(500);
    await this.readState();
  }

  async startPath(index) {
    this.desiredC = null;
    this.emit('desired', null);
    await this.send([0x30, 0x02], 'Power on');
    await sleep(500);
    await this.send([0x80, index], `Smart path ${index + 1}`);
    await sleep(500);
    await this.readState();
  }

  async setCelsius(on) { await this.send([0xf0, on ? 1 : 0], on ? 'Show °C' : 'Show °F'); await sleep(300); await this.readState(); }
  async setVibration(on) { await this.send([0x90, on ? 1 : 0], `Vibration ${on ? 'on' : 'off'}`); await sleep(300); await this.readState(); }
  async setStealth(on) { await this.send([0x60, on ? 0x04 : 0xff], `Dim display ${on ? 'on' : 'off'}`); await sleep(300); await this.readState(); }

  // ---- Temperature: the IQ3 has no working "set target" command, so press +/− until it matches.
  setTarget(celsius) {
    this.desiredC = celsius;
    this.emit('desired', celsius);
    if (this.heating) this._sync();
  }

  async _sync() {
    if (this.syncing) { this.resync = true; return; }
    this.syncing = true;
    this.emit('syncing', true);
    try {
      do {
        this.resync = false;
        await this._syncOnce();
      } while (this.resync && this.link === 'connected');
    } catch (e) {
      this.log('err', `Set temperature: ${e.message}`);
      this.emit('error', { message: "Couldn't change the temperature. Try again." });
    } finally {
      this.syncing = false;
      this.emit('syncing', false);
    }
  }

  async _syncOnce() {
    if (this.desiredC == null || !this.heating) return;
    if (this.s.state !== STATE.PRECISION) {
      await this.send([0x30, 0x05], 'Precision mode');
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        await this.readState();
        if (this.s.state === STATE.PATH_TEMP || this.s.state === STATE.PRECISION) break;
      }
    }
    let stalls = 0;
    for (let guard = 0; guard < 80; guard++) {
      if (this.resync || this.desiredC == null || this.link !== 'connected') return;
      const goal = this.desiredC;
      const step = this.stepC || (this.s.celsius ? 1 : 5 / 9);
      const diff = goal - this.s.target;
      if (Math.abs(diff) < step * 0.5) {
        this.desiredC = null;
        this.emit('desired', null);
        return;
      }
      const dir = diff > 0 ? KEY_UP : KEY_DOWN;
      // One press until the step size is known, then up to 5 at a time.
      const presses = this.stepC ? Math.max(1, Math.min(5, Math.round(Math.abs(diff) / step))) : 1;
      const before = this.s.target;
      for (let k = 0; k < presses; k++) await this._press(dir);
      await sleep(200);
      await this.readState();
      const moved = Math.abs(this.s.target - before);
      if (moved < 0.05) {
        if (++stalls >= 3) {
          this.log('sys', 'Target stopped moving, so it is probably at the limit');
          this.desiredC = null;
          this.emit('desired', null);
          return;
        }
      } else {
        stalls = 0;
        const per = moved / presses;
        if (per > 0.2 && per < 12) this.stepC = per;
      }
    }
  }

  async _press(mask) {
    await this.send([0x10, mask], mask === KEY_UP ? 'Press +' : 'Press −');
    await sleep(90);
    await this.send([0x11, mask], 'Release');
    await sleep(60);
  }
}
