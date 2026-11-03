import { IQ3, STATE, cToF, fToC } from './iq3.js';
import { Stage } from './stage.js';
import { ThermoStrip } from './thermo.js';
import { WRAPS, DEFAULT_WRAP, wrapById, swatchBackground } from './wraps.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---- Log, shown in the hidden developer sheet (long-press "IQ3") ----------------------
const logLines = [];
let devOpen = false;
let logQueued = false;
function log(kind, text) {
  const d = new Date();
  const t = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const mark = { tx: '→', rx: '←', err: '!', sys: '·' }[kind] || '·';
  logLines.push(`${t} ${mark} ${text}`);
  if (logLines.length > 800) logLines.shift();
  if (devOpen && !logQueued) { logQueued = true; requestAnimationFrame(renderLog); }
}

const iq3 = DEMO ? new (await import('./demo.js')).FakeIQ3({ log }) : new IQ3({ log });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stageEl = $('stage');
const ui = {
  drawStart: null, lastDraw: null, searchSince: null, toastTimer: 0, heatCss: -1, chargeCss: -1,
  intent: null,                 // { dir: 'on' | 'off', until } right after a power gesture
  powerOnAfterConnect: false,
  pickOnRelease: false,
  wrap: wrapById(store.get('iq3.wrap') || DEFAULT_WRAP).id,
};

// ---- Units and modes ----------------------------------------------------------------
const isC = () => !!(iq3.s && iq3.s.celsius);
const toDisp = (c) => (isC() ? c : cToF(c));
const fromDisp = (v) => (isC() ? v : fToC(v));
const intent = () => (ui.intent && performance.now() < ui.intent.until ? ui.intent.dir : null);

function modeOf(s) {
  if (!s) return 'off';
  if (s.state === STATE.BOOST) return 'boost';
  if ([2, 3, 4, 5, 6].includes(s.state)) return s.atTemp ? 'ready' : 'heat';
  if (s.state === STATE.IDLE || s.state === STATE.STANDBY) return 'idle';
  return 'off';
}

// One short status line under the name, the way the car app says "Parked" or "Charging".
function statusText(s, link, awake, now) {
  if (!DEMO && !iq3.supported) return { text: 'Bluetooth unavailable' };
  if (link === 'idle') return { text: 'Not connected' };
  if (link === 'searching') return { text: 'Looking for your IQ3' };
  if (link === 'connecting') return { text: 'Connecting' };
  if (!s) return { text: 'Connected' };
  if (ui.drawStart) return { text: `Drawing ${((now - ui.drawStart) / 1000).toFixed(1)} s`, hot: true };
  if (ui.lastDraw && now < ui.lastDraw.until) {
    const secs = `${ui.lastDraw.seconds.toFixed(1)} s`;
    return { text: ui.lastDraw.n ? `Draw ${ui.lastDraw.n} · ${secs}` : `Draw · ${secs}` };
  }
  if (intent() === 'on' && !iq3.heating) return { text: 'Turning on' };
  if (intent() === 'off' && iq3.heating) return { text: 'Turning off' };
  if (!awake) {
    if (s.charging) return { text: s.battery >= 100 ? 'Charged' : 'Charging', charging: true };
    return { text: 'Off' };
  }
  if (iq3.desiredC != null) return { text: `Setting ${Math.round(toDisp(iq3.desiredC))}°` };
  switch (s.state) {
    case STATE.BOOST: return { text: 'Boost', hot: true };
    case STATE.SMART_PATH:
    case STATE.PATH_SELECT: return { text: `Smart path ${s.path + 1}` };
    default: return s.atTemp ? { text: 'Ready' } : { text: `Heating to ${Math.round(toDisp(s.target))}°` };
  }
}

// ---- 3D stage and the label on the device -------------------------------------------
const coFront = $('coFront');
const coPort = $('coPort');

function onFrame(a) {
  const w = coFront.offsetWidth;
  const h = coFront.offsetHeight;
  coFront.style.transform = `translate(${(a.label.x - w / 2).toFixed(1)}px, ${(a.label.y - h / 2).toFixed(1)}px)`;
  coFront.style.opacity = a.facing > 0.5 ? '1' : '0';
  if (a.port) {
    coPort.style.transform = `translate(${(a.port.x - coPort.offsetWidth / 2).toFixed(1)}px, ${(a.port.y - coPort.offsetHeight / 2).toFixed(1)}px)`;
    coPort.style.opacity = a.port.facing > 0.55 ? '1' : '0';
  }
  // The stage light follows the eased heat and charge from the 3D loop.
  if (Math.abs(a.heat - ui.heatCss) > 0.002) {
    ui.heatCss = a.heat;
    stageEl.style.setProperty('--heat', a.heat.toFixed(3));
  }
  const charge = a.charge || 0;
  if (Math.abs(charge - ui.chargeCss) > 0.002) {
    ui.chargeCss = charge;
    stageEl.style.setProperty('--charge', charge.toFixed(3));
  }
}

let stage = null;
try {
  stage = new Stage($('gl'), { reducedMotion: reduced, onFrame, wrap: ui.wrap });
} catch (e) {
  log('err', `3D view unavailable: ${e.message}`);
  onFrame({ label: { x: innerWidth * 0.44, y: innerHeight * 0.68 }, facing: 1, heat: 0, charge: 0 });
}

// ---- Temperature strip, which is also the power switch -------------------------------
function commandFailed(what) {
  return (err) => {
    log('err', `${what}: ${err && err.message}`);
    ui.intent = null;
    toast(`${what} didn't go through. Try again.`);
    render();
  };
}

function onPower(dir) {
  const now = performance.now();
  if (dir === 'off') {
    ui.intent = { dir: 'off', until: now + 6000 };
    ui.powerOnAfterConnect = false;
    if (iq3.link === 'connected') iq3.powerOff().catch(commandFailed('Turning off'));
    render();
    return '';
  }
  ui.intent = { dir: 'on', until: now + 8000 };
  if (iq3.link === 'connected') {
    iq3.powerOn().catch(commandFailed('Turning on'));
    render();
    return '';
  }
  ui.powerOnAfterConnect = true;
  if (iq3.reconnect()) { render(); return 'Connecting to your IQ3'; }
  ui.pickOnRelease = true;
  return 'Let go to connect';
}

function onRelease(fired) {
  if (fired !== 'on' || !ui.pickOnRelease) return;
  ui.pickOnRelease = false;
  // Runs inside the pointerup, which is what lets Chrome open the Bluetooth picker.
  iq3.pick().catch((err) => {
    ui.powerOnAfterConnect = false;
    ui.intent = null;
    pickFailed(err);
    render();
  });
}

const strip = new ThermoStrip($('thermo'), $('bubble'), {
  onCommit: (v) => {
    if (iq3.link !== 'connected' || !iq3.s) return;
    const c = fromDisp(v);
    if (iq3.desiredC == null && Math.abs(c - iq3.s.target) < 0.3) return;
    iq3.setTarget(c);
    render();
  },
  onPower,
  onRelease,
  onDrag: (on) => stageEl.classList.toggle('adjusting', on),
});

// ---- Rendering --------------------------------------------------------------------------
function render() {
  const s = iq3.s;
  const link = iq3.link;
  const connected = link === 'connected' && !!s;
  const now = performance.now();
  if (ui.intent && connected && ((ui.intent.dir === 'on' && iq3.heating) || (ui.intent.dir === 'off' && !iq3.heating))) ui.intent = null;
  const want = intent();
  const awake = connected && (want === 'on' || (iq3.heating && want !== 'off'));
  let mode = connected ? modeOf(s) : 'off';
  if (awake && (mode === 'off' || mode === 'idle')) mode = 'heat';
  if (!awake && connected) mode = 'off';
  const unit = isC() ? 'C' : 'F';

  const st = statusText(s, link, awake, now);
  $('statusText').textContent = st.text;
  $('status').classList.toggle('hot', !!st.hot);
  $('status').classList.toggle('charging', !!st.charging);
  const tempEl = $('temp');
  tempEl.hidden = !awake;
  if (awake) tempEl.textContent = `${Math.round(toDisp(s.cur))}°`;

  let help = '';
  if (!DEMO && !iq3.supported) help = 'Open this page in Chrome on Android to use Bluetooth.';
  else if (link === 'idle' && !iq3.device) help = "Turn on the IQ3's Bluetooth: press up and down together 5 times. Then pull up on the bars and hold.";
  else if (!connected && ui.searchSince && now - ui.searchSince > 12000) help = "Still looking. Check that the IQ3's Bluetooth is on and the DaVinci app is closed.";
  $('help').textContent = help;
  $('help').hidden = !help;

  $('battery').hidden = !connected;
  if (connected) {
    $('batFill').setAttribute('width', (16.5 * Math.max(s.battery, 4) / 100).toFixed(1));
    $('batFill').classList.toggle('low', s.battery <= 20 && !s.charging);
    $('batFill').classList.toggle('charging', s.charging);
    $('batBolt').style.display = s.charging ? '' : 'none';
    $('batText').textContent = `${s.battery}%`;
  }

  // Label on the device: Boost while on, Connect before the first pairing
  let label = '';
  if (link === 'idle' && !iq3.device) { label = 'Connect'; coFront.dataset.act = 'connect'; }
  else if (awake && iq3.heating) {
    label = s.state === STATE.BOOST ? 'End boost' : 'Boost';
    coFront.dataset.act = 'boost';
  }
  coFront.textContent = label;
  coFront.hidden = !label;
  coPort.hidden = !(connected && s.charging);

  // Quick controls and settings
  for (const b of document.querySelectorAll('[data-needs-device]')) b.disabled = !connected;
  $('dockPaths').classList.toggle('on', connected && awake && (s.state === STATE.SMART_PATH || s.state === STATE.PATH_SELECT));
  $('unitF').setAttribute('aria-pressed', String(unit === 'F'));
  $('unitC').setAttribute('aria-pressed', String(unit === 'C'));
  $('swVibrate').setAttribute('aria-checked', String(connected && s.vibration));
  $('swDim').setAttribute('aria-checked', String(connected && s.stealth));
  $('forgetRow').hidden = !iq3.device && !iq3.saved;

  // Stage
  const heat = connected ? clamp01((s.cur - 30) / (Math.max(s.target, 120) - 30)) : 0;
  if (!stage) stageEl.style.setProperty('--heat', heat.toFixed(3));
  stageEl.classList.toggle('drawing', !!ui.drawStart);
  if (stage) stage.set({ connected, mode, temp: connected ? toDisp(s.cur) : null, heat, dim: connected && s.stealth, open: awake, charging: connected && s.charging, battery: connected ? s.battery : 0 });

  // Strip
  let [min, max] = unit === 'C' ? [177, 221] : [350, 430];
  const tgt = connected && s.target > 50 ? toDisp(s.target) : null;
  if (tgt != null && tgt > min - 60 && tgt < max + 40) { min = Math.min(min, Math.floor(tgt)); max = Math.max(max, Math.ceil(tgt)); }
  strip.setScale(min, max);
  strip.setValues({
    mode: awake ? 'adjust' : 'wake',
    target: tgt,
    pending: iq3.desiredC != null ? toDisp(iq3.desiredC) : null,
    current: connected ? toDisp(s.cur) : null,
    tone: mode === 'ready' ? 'ready' : mode === 'heat' || mode === 'boost' ? 'heat' : 'off',
  });

  if ($('sheetPaths').classList.contains('open')) renderPaths();
  updateWake();
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => el.classList.remove('on'), 3400);
}

function pickFailed(err) {
  if (err && err.name === 'NotFoundError' && /cancel/i.test(err.message)) return;
  log('err', `Pick: ${err && err.name}: ${err && err.message}`);
  toast(err && err.name === 'NotFoundError' ? 'No IQ3 found. Turn on its Bluetooth, then try again.' : "Couldn't open Bluetooth. Is it on for your phone?");
}

// ---- Smart paths sheet -------------------------------------------------------------------
function sparkline(points) {
  if (!points.length) return '';
  const xy = (p) => `${(2 + p.t * 116).toFixed(1)} ${(38 - ((p.c - 172) / 52) * 36).toFixed(1)}`;
  const pts = [...points];
  if (pts[pts.length - 1].t < 1) pts.push({ t: 1, c: pts[pts.length - 1].c });
  return `M${pts.map(xy).join('L')}`;
}

function renderPaths() {
  const list = $('pathList');
  const s = iq3.s;
  const paths = iq3.paths || [];
  if (!paths.length) { list.innerHTML = '<p class="empty">Reading paths from your IQ3.</p>'; return; }
  list.innerHTML = paths.map((p) => {
    const temps = p.points.map((x) => x.c);
    const a = Math.round(toDisp(temps[0] || 0));
    const z = Math.round(toDisp(temps[temps.length - 1] || 0));
    const active = !!s && iq3.heating && (s.state === STATE.SMART_PATH || s.state === STATE.PATH_SELECT) && s.path === p.index;
    return `<button class="path-row${active ? ' active' : ''}" data-act="path" data-i="${p.index}">
      <span><span class="range">${a}° to ${z}°</span><span class="meta">${active ? 'Running now, ' : ''}${Math.round(p.minutes)} min</span></span>
      <svg viewBox="0 0 120 40" aria-hidden="true"><path d="${sparkline(p.points)}"/></svg>
    </button>`;
  }).join('');
}

// ---- Wrap sheet ----------------------------------------------------------------------------
function renderWraps() {
  $('wrapName').textContent = wrapById(ui.wrap).name;
  const groups = [['colors', 'Original'], ['wraps', 'Wraps']];
  $('wrapList').innerHTML = groups.map(([g, label]) => `
    <p class="swatch-label">${label}</p>
    <div class="swatch-row">${WRAPS.filter((w) => w.group === g).map((w) => `
      <button class="swatch${w.id === ui.wrap ? ' on' : ''}" data-act="wrap" data-id="${w.id}" aria-label="${w.name}" aria-pressed="${w.id === ui.wrap}" style="background:${swatchBackground(w)}"></button>`).join('')}
    </div>`).join('');
}

// ---- Developer sheet ---------------------------------------------------------------------
function renderLog() {
  logQueued = false;
  const el = $('log');
  el.textContent = logLines.slice(-300).join('\n');
  el.scrollTop = el.scrollHeight;
}

function renderDevInfo() {
  const lines = [];
  lines.push(iq3.saved ? `Remembered: ${iq3.saved.name}` : 'No IQ3 remembered yet');
  lines.push(iq3.canRestore
    ? 'Auto-reconnect after reopening: on'
    : 'Auto-reconnect after reopening needs chrome://flags/#enable-web-bluetooth-new-permissions-backend turned on. While this page stays open it reconnects either way.');
  $('devInfo').textContent = lines.join('\n');
}

// ---- Sheets ---------------------------------------------------------------------------------
function openSheet(id) {
  closeSheets();
  $(id).classList.add('open');
  if (id === 'sheetPaths') { renderPaths(); if (!iq3.paths) iq3.readPaths().catch(() => {}); }
  if (id === 'sheetWrap') { renderWraps(); if (stage) stage.setShowcase(true); stageEl.classList.add('showcase'); }
  if (id === 'sheetDev') { devOpen = true; renderDevInfo(); renderLog(); }
}
function closeSheets() {
  for (const el of document.querySelectorAll('.sheet-wrap.open')) el.classList.remove('open');
  devOpen = false;
  if (stage) stage.setShowcase(false);
  stageEl.classList.remove('showcase');
}
for (const wrap of document.querySelectorAll('.sheet-wrap')) {
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheets(); });
}

// ---- Actions ---------------------------------------------------------------------------------
const ACT = {
  connect: () => iq3.pick(),
  boost: () => iq3.boost(!(iq3.s && iq3.s.state === STATE.BOOST)),
  paths: () => openSheet('sheetPaths'),
  path: (el) => { closeSheets(); return iq3.startPath(Number(el.dataset.i)); },
  wraps: () => openSheet('sheetWrap'),
  wrap: (el) => {
    ui.wrap = el.dataset.id;
    store.set('iq3.wrap', ui.wrap);
    if (stage) stage.setWrap(ui.wrap);
    renderWraps();
  },
  settings: () => openSheet('sheetSettings'),
  dev: () => openSheet('sheetDev'),
  unitF: () => (isC() ? iq3.setCelsius(false) : null),
  unitC: () => (isC() ? null : iq3.setCelsius(true)),
  vibrate: () => iq3.setVibration(!(iq3.s && iq3.s.vibration)),
  dim: () => iq3.setStealth(!(iq3.s && iq3.s.stealth)),
  close: () => closeSheets(),
  copy: async () => {
    try { await navigator.clipboard.writeText(logLines.join('\n')); toast(`Copied ${logLines.length} log lines`); }
    catch { toast('Copy blocked. Select the log text and copy it by hand.'); }
  },
  forget: async () => { closeSheets(); await iq3.forget(); toast('Forgot this IQ3. Pull up on the bars to pick it again.'); },
  install: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    showInstall(false);
  },
};

// ---- Installable app -------------------------------------------------------------------------
let installPrompt = null;
function showInstall(on) {
  $('install').hidden = !on;
  $('settingsDot').hidden = !on;
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstall(true);
});
window.addEventListener('appinstalled', () => { installPrompt = null; showInstall(false); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => log('err', `Service worker: ${e.message}`));

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const act = el.dataset.act;
  if (!ACT[act]) return;
  try {
    await ACT[act](el);
  } catch (err) {
    if (act === 'connect') pickFailed(err);
    else {
      log('err', `${act}: ${err && err.name}: ${err && err.message}`);
      toast(iq3.link === 'connected' ? "That didn't go through. Try again." : 'Connect your IQ3 first.');
    }
  } finally {
    render();
  }
});

// Long-press the name to open the developer sheet
{
  let timer = 0;
  const name = $('name');
  name.addEventListener('pointerdown', () => { timer = setTimeout(() => openSheet('sheetDev'), 650); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) name.addEventListener(ev, () => clearTimeout(timer));
  name.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- Device events -------------------------------------------------------------------------
iq3.addEventListener('link', (e) => {
  if (e.detail === 'searching' && !ui.searchSince) ui.searchSince = performance.now();
  if (e.detail === 'connected') ui.searchSince = null;
  render();
});
iq3.addEventListener('connected', () => {
  if (!ui.powerOnAfterConnect) return;
  ui.powerOnAfterConnect = false;
  ui.intent = { dir: 'on', until: performance.now() + 8000 };
  iq3.powerOn().catch(commandFailed('Turning on'));
  render();
});
iq3.addEventListener('state', render);
iq3.addEventListener('desired', render);
iq3.addEventListener('syncing', render);
iq3.addEventListener('paths', render);
iq3.addEventListener('error', (e) => toast(e.detail.message));
iq3.addEventListener('draw', (e) => {
  if (e.detail.phase === 'start') {
    ui.drawStart = performance.now();
    if (stage) stage.setDrawing(true);
  } else {
    ui.drawStart = null;
    ui.lastDraw = { n: null, seconds: e.detail.seconds, until: performance.now() + 6000 };
    if (stage) stage.setDrawing(false);
  }
  render();
});
iq3.addEventListener('puff', (e) => {
  const { puffs, seconds, live } = e.detail;
  // The IQ3 counted a draw the temperature dip missed: still show it.
  if (!live && !ui.drawStart && !(ui.lastDraw && performance.now() < ui.lastDraw.until)) {
    if (stage) stage.blip();
    ui.lastDraw = { n: puffs, seconds, until: performance.now() + 6000 };
  } else if (ui.lastDraw) {
    ui.lastDraw.n = puffs;
  }
  render();
});

// Live draw timer, intent timeouts and the "still looking" hint
setInterval(() => {
  if (ui.drawStart || ui.intent || (ui.lastDraw && performance.now() < ui.lastDraw.until + 200) || (ui.searchSince && iq3.link !== 'connected')) render();
}, 100);

// ---- Keep the screen awake while heating ------------------------------------------------------
let wake = null;
let wakeBusy = false;
async function updateWake() {
  if (wakeBusy || !navigator.wakeLock) return;
  const want = iq3.link === 'connected' && iq3.heating && !document.hidden;
  wakeBusy = true;
  try {
    if (want && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!want && wake) {
      await wake.release();
      wake = null;
    }
  } catch { /* not allowed right now */ }
  wakeBusy = false;
}
document.addEventListener('visibilitychange', updateWake);

// ---- Start -------------------------------------------------------------------------------------
render();
if (DEMO || iq3.supported) {
  iq3.restore().then((found) => { if (!found) log('sys', iq3.canRestore ? 'No remembered IQ3 yet' : 'This Chrome cannot restore devices on reload'); render(); });
}
log('sys', `Ready${DEMO ? ' (demo)' : ''}. ${navigator.userAgent}`);
