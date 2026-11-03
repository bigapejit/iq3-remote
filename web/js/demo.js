// A simulated IQ3 for ?demo. It speaks the same bytes as the real device, so the real
// parsing, temperature stepping and draw detection in iq3.js all run against it.
import { IQ3, sleep, fToC, parsePaths } from './iq3.js';

const PATHS = [[177, 188], [188, 199], [199, 210], [210, 221]];

export class FakeIQ3 extends IQ3 {
  constructor(opts) {
    super(opts);
    this.sim = {
      state: 1, curC: 26, targetC: fToC(390), celsius: false, vibration: true, stealth: false,
      battery: 4, path: 0, puffs: 0, drawUntil: 0, nextDraw: 0, boostFrom: null,
    };
    this.saved = { id: 'demo', name: 'DAVINCI IQ3' };
    const p = new URLSearchParams(location.search);
    if (p.has('hot')) {
      this.sim.state = 6;
      this.sim.curC = this.sim.targetC - 0.3;
      this.sim.nextDraw = performance.now() + Number(p.get('drawin') || 2500);
    }
    setInterval(() => this._simTick(0.2), 200);
  }

  get canRestore() { return true; }
  async restore() {
    if (new URLSearchParams(location.search).has('fresh')) { this.saved = null; return false; }
    this.device = { name: 'DAVINCI IQ3' };
    this.want = true;
    this._fakeConnect();
    return true;
  }
  async pick() { this.device = { name: 'DAVINCI IQ3' }; this.want = true; this._fakeConnect(); }
  reconnect() {
    if (!this.device) return false;
    if (this.link !== 'connected') this._fakeConnect();
    return true;
  }
  async forget() { this.want = false; this.device = null; this.ch = {}; this.s = null; this.setLink('idle'); }

  async _fakeConnect() {
    if (this._connecting) return;
    this._connecting = true;
    this.setLink('searching');
    await sleep(900);
    this.setLink('connecting');
    await sleep(500);
    this.ch = { ctrl: {}, state: {}, session: {}, paths: {} };
    this.setLink('connected');
    this.log('sys', 'Connected to the demo IQ3');
    await this.readState();
    await this.readSession();
    await this.readPaths();
    this._schedulePoll(0);
    this._connecting = false;
    this.emit('connected');
  }

  async readState() { this._onState(this._stateView()); }
  async readSession() {
    const b = new Uint8Array(20);
    b[6] = 24; b[16] = this.sim.puffs;
    this._onSession(new DataView(b.buffer));
  }
  async readPaths() {
    const b = new Uint8Array(104);
    const v = new DataView(b.buffer);
    PATHS.forEach(([a, z], i) => {
      const o = i * 26;
      v.setInt16(o, i, true); v.setInt16(o + 2, 480, true);
      b[o + 4] = 0; b[o + 5] = a; b[o + 6] = 240; b[o + 7] = z; b[o + 8] = 255; b[o + 9] = z; b[o + 24] = 3;
    });
    this.log('rx', 'paths (demo)');
    this.paths = parsePaths(v);
    this.emit('paths', this.paths);
  }

  _stateView() {
    const s = this.sim;
    const b = new Uint8Array(18);
    const v = new DataView(b.buffer);
    b[0] = s.state;
    v.setUint16(1, Math.round(s.curC * 100), true);
    v.setUint16(3, Math.round(s.targetC * 100), true);
    b[7] = s.path;
    b[12] = s.battery;
    const heating = [2, 3, 4, 5, 6, 7].includes(s.state);
    b[13] = (s.celsius ? 0x02 : 0) | (heating && Math.abs(s.curC - s.targetC) < 1.5 ? 0x04 : 0)
      | (s.vibration ? 0x10 : 0) | (s.stealth ? 0x20 : 0);
    return v;
  }

  async send(bytes, label) {
    this.log('tx', `${label} [${bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ')}] (demo)`);
    await sleep(40);
    const s = this.sim;
    const [cmd, val] = bytes;
    if (cmd === 0x30) {
      if (val === 0x02) { if (![3, 5, 6, 7].includes(s.state)) s.state = 6; }
      else if (val === 0x01) s.state = 8;
      else if (val === 0x00) s.state = 0;
      else if (val === 0x05) s.state = 6;
      else if (val === 0x04) { s.boostFrom = s.targetC; s.targetC = Math.min(221, s.targetC + 8); s.state = 7; }
      else if (val === 0x09) { s.targetC = s.boostFrom ?? s.targetC; s.state = 6; }
    } else if (cmd === 0x11 && (s.state === 6 || s.state === 5)) {
      const step = s.celsius ? 1 : 5 / 9;
      if (val === 0x02) s.targetC = Math.min(221, s.targetC + step);
      if (val === 0x04) s.targetC = Math.max(fToC(200), s.targetC - step);
    } else if (cmd === 0x80) {
      s.state = 3; s.path = val; s.targetC = PATHS[val][0];
    } else if (cmd === 0xf0) s.celsius = !!val;
    else if (cmd === 0x90) s.vibration = !!val;
    else if (cmd === 0x60) s.stealth = val === 0x04;
  }

  _simTick(dt) {
    const s = this.sim;
    const now = performance.now();
    const heating = [2, 3, 4, 5, 6, 7].includes(s.state);
    if (!heating) {
      s.curC += (26 - s.curC) * 0.02;
      return;
    }
    if (now < s.drawUntil) {
      s.curC -= 2.6 * dt;                      // air through the oven pulls the reading down
    } else {
      s.curC += Math.max(-1.2, Math.min(3.2, (s.targetC - s.curC) * 0.6)) * dt;
      const ready = Math.abs(s.curC - s.targetC) < 1;
      if (ready && !s.nextDraw) s.nextDraw = now + 5000;
      if (s.nextDraw && now > s.nextDraw) {
        s.drawUntil = now + 2800;
        s.nextDraw = now + 2800 + 9000;
        setTimeout(() => { s.puffs++; }, 3400);
      }
    }
  }
}
