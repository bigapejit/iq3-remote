// The floating 3D IQ3, modeled from DaVinci's product photos: a brushed shell with a concave top,
// a vertical dot-matrix display, side button and rocker, knurled oven cap, and a mouthpiece arm
// hinged at the top-right corner that swings open when the IQ3 turns on.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrapById, wrapMaps, DEFAULT_WRAP } from './wraps.js';

// Proportions from the photos: about 2 : 1 tall, a little under half as deep as it is wide.
const W = 0.56;
const H = 1.12;
const D = 0.25;
const BEVEL = 0.03;
const BEVEL_T = 0.04;
const DIP = 0.03;                      // how far the top edge sags in the middle
const R_BOTTOM = 0.06;
const R_TOP = 0.03;
const FOV = 30;
const HOME = { x: 0.44, y: 0.6 };      // where the body sits on screen (fractions)
const SHOWCASE = { x: 0.5, y: 0.38 };  // raised while picking a wrap

// Mouthpiece arm: closed, it is the top of the device (full width and depth, flush with the
// sides, one seam line below it). It swings up from the top-right corner.
const ARM_T = 0.058;                   // visible thickness of the top cap
const ARM_BEVEL = 0.012;
const ARM_L = W - 2 * ARM_BEVEL;       // shape length; the bevel brings it to the full width
const ARM_SHAPE_T = ARM_T - 2 * ARM_BEVEL;
const HINGE = new THREE.Vector3(W / 2 - ARM_BEVEL, H / 2 - ARM_T + ARM_BEVEL, 0);
const OPEN_ANGLE = -1.76;
const OUTLET_X = -ARM_L + 0.1;

// Display: 3 columns of dots by 21 rows, upper middle of the front
const DOT_COLS = 3;
const DOT_ROWS = 21;
const DOT_DX = 0.028;
const DOT_DY = 0.0179;
const DOT_TOP = 0.341;

const LABEL = new THREE.Vector3(0, -0.27, D / 2);
const COLD = new THREE.Color('#8fa9bf');
const HOT = new THREE.Color('#ff9a5c');
const DOT_ON = {
  heat: new THREE.Color('#ffd7b8'),
  ready: new THREE.Color('#ffffff'),
  boost: new THREE.Color('#ffbf86'),
  idle: new THREE.Color('#ffffff'),
  off: new THREE.Color('#ffffff'),
};
const DOT_OFF = new THREE.Color('#0b0c0e');

const FONT = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'], 9: ['111', '101', '111', '001', '111'],
};

// ---- Geometry helpers -------------------------------------------------------------------
// Keep the flat front/back faces flat-shaded, smooth everything else (walls, bevels).
function shell(extruded) {
  const src = extruded.index ? extruded.toNonIndexed() : extruded;
  const pos = src.getAttribute('position');
  const caps = [];
  const sides = [];
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a)).normalize();
    (Math.abs(n.z) > 0.999 ? caps : sides).push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(caps, 3));
  capGeo.computeVertexNormals();
  let sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sides, 3));
  sideGeo = mergeVertices(sideGeo, 1e-5);
  sideGeo.computeVertexNormals();
  const out = mergeGeometries([capGeo, sideGeo.toNonIndexed()]);
  boxUV(out, 0.62);
  return out;
}

// Project UVs along whichever axis a surface faces, so wraps and brushing stay even.
function boxUV(geo, scale) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)); const ay = Math.abs(nor.getY(i)); const az = Math.abs(nor.getZ(i));
    let u; let v;
    if (az >= ax && az >= ay) { u = pos.getX(i); v = pos.getY(i); }
    else if (ax >= ay) { u = pos.getZ(i); v = pos.getY(i); }
    else { u = pos.getX(i); v = pos.getZ(i); }
    uv[i * 2] = u / scale + 0.5;
    uv[i * 2 + 1] = v / scale + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function bodyGeometry() {
  const w = W - 2 * BEVEL;
  const top = H / 2 - ARM_T - BEVEL;     // the body stops under the mouthpiece cap
  const bot = -H / 2 + BEVEL;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + R_BOTTOM, bot);
  s.lineTo(w / 2 - R_BOTTOM, bot);
  s.quadraticCurveTo(w / 2, bot, w / 2, bot + R_BOTTOM);
  s.lineTo(w / 2, top - R_TOP);
  s.quadraticCurveTo(w / 2, top, w / 2 - R_TOP, top);
  s.quadraticCurveTo(0, top - 2 * DIP, -w / 2 + R_TOP, top);   // the concave top
  s.quadraticCurveTo(-w / 2, top, -w / 2, top - R_TOP);
  s.lineTo(-w / 2, bot + R_BOTTOM);
  s.quadraticCurveTo(-w / 2, bot, -w / 2 + R_BOTTOM, bot);
  const depth = D - 2 * BEVEL_T;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: BEVEL, bevelSegments: 6, curveSegments: 32 });
  g.translate(0, 0, -depth / 2);
  return shell(g);
}

// The cap's profile follows the saddle of the top, with the device's rounded top corners at both ends.
function armGeometry() {
  const L = ARM_L;
  const t = ARM_SHAPE_T;
  const r = 0.03;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(-L / 2, -2 * DIP, -L, 0);
  s.lineTo(-L, t - r);
  s.quadraticCurveTo(-L, t, -L + r, t);
  s.quadraticCurveTo(-L / 2, t - 2 * DIP, -r, t);
  s.quadraticCurveTo(0, t, 0, t - r);
  s.lineTo(0, 0);
  const depth = D - 2 * BEVEL_T;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: BEVEL_T, bevelSize: ARM_BEVEL, bevelSegments: 5, curveSegments: 32 });
  g.translate(0, 0, -depth / 2);
  return shell(g);
}

function armTopY(x) {
  const s = (x + ARM_L) / ARM_L;
  return ARM_SHAPE_T + ARM_BEVEL - 4 * DIP * s * (1 - s);
}

function knurlGeometry() {
  const teeth = 44; const r = 0.074; const tooth = 0.0045;
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 2; i++) {
    const ang = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r - tooth;
    const x = Math.cos(ang) * rr; const y = Math.sin(ang) * rr;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.024, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(Math.PI / 2);
  return g;
}

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function outletTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8d9096';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1c1d20';
  for (const [x, y] of [[64, 34], [48, 50], [80, 50], [64, 50], [48, 66], [80, 66], [64, 66], [48, 82], [80, 82], [64, 82], [64, 98]]) {
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VAPOR_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const VAPOR_FRAG = `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * vAlpha);
  }`;

export class Stage {
  constructor(canvas, { reducedMotion = false, onFrame, wrap = DEFAULT_WRAP } = {}) {
    this.canvas = canvas;
    this.reduced = reducedMotion;
    this.onFrame = onFrame || null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);

    this.tele = { connected: false, mode: 'off', temp: null, heat: 0, dim: false, open: false };
    this.drawing = false;
    this.blipUntil = 0;
    this.lift = 0;
    this.heatShown = 0;
    this.yawUser = 0;
    this.yawVel = 0;
    this.dragging = false;
    this.showcase = false;
    this.place = { ...HOME };
    this.openPos = 0;
    this.openVel = 0;
    this.dotGlow = 0;
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();

    this._build();
    this.setWrap(wrap);
    this._bindDrag();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ---- Public ---------------------------------------------------------------------------
  set(t) { Object.assign(this.tele, t); this._drawDots(); }
  setDrawing(on) { this.drawing = on; }
  blip() { this.blipUntil = this.clock.elapsedTime + 1.4; }

  setShowcase(on) {
    if (this.showcase && !on) this.yawUser = Math.atan2(Math.sin(this.yawUser), Math.cos(this.yawUser));
    this.showcase = on;
  }

  setWrap(id) {
    const wrap = wrapById(id);
    const m = this.bodyMat;
    const maps = wrapMaps(wrap);
    m.map = maps.map;
    m.roughnessMap = maps.roughnessMap;
    m.color.set(wrap.pattern ? '#ffffff' : wrap.color);
    m.metalness = wrap.metalness;
    m.roughness = wrap.roughness;
    m.clearcoat = wrap.clearcoat || 0;
    m.clearcoatRoughness = 0.12;
    m.iridescence = wrap.iridescence || 0;
    m.iridescenceIOR = 1.6;
    m.iridescenceThicknessRange = [120, 900];
    m.envMapIntensity = wrap.envIntensity ?? 1;
    m.anisotropy = wrap.brushed ? 0.6 : 0;
    m.anisotropyRotation = Math.PI / 2;
    m.needsUpdate = true;
    // Same finish on the mouthpiece cap, but its upward-facing top catches less of the overhead light.
    this.armMat.copy(m);
    this.armMat.envMapIntensity = (wrap.envIntensity ?? 1) * 0.55;
    this.armMat.needsUpdate = true;
    this.wrap = wrap.id;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const dist = 6.2 * Math.max(1, (w / h) / 0.56);
    this.camera.position.set(0, 0.6, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.perPx = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * dist) / h;
    this._placeRoot();
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.vMat.uniforms.uScale.value = buf.y / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  }

  _placeRoot() {
    this.root.position.set((this.place.x - 0.5) * this.w * this.perPx, -(this.place.y - 0.5) * this.h * this.perPx, 0);
  }

  // ---- Build ----------------------------------------------------------------------------
  _build() {
    const s = this.scene;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-2, 3, 3);
    s.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(2.5, -0.5, 3);
    s.add(fill);
    this.rim = new THREE.DirectionalLight(COLD.clone(), 2.2);
    this.rim.position.set(2.6, 1.4, -2.4);
    s.add(this.rim);

    this.root = new THREE.Group();
    s.add(this.root);
    this.dev = new THREE.Group();
    this.root.add(this.dev);

    this.heatLight = new THREE.PointLight(0xff8a45, 0, 1.8, 2);
    this.heatLight.position.set(0, -0.66, 0.3);
    this.dev.add(this.heatLight);

    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x1f2023, metalness: 0.85, roughness: 0.36 });
    this.armMat = this.bodyMat.clone();
    const darkMetal = new THREE.MeshPhysicalMaterial({ color: 0x24262a, metalness: 0.9, roughness: 0.42 });

    // Shell
    this.dev.add(new THREE.Mesh(bodyGeometry(), this.bodyMat));

    // Dot-matrix display
    const dotGeo = new THREE.CircleGeometry(0.0044, 14);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.dots = new THREE.InstancedMesh(dotGeo, dotMat, DOT_COLS * DOT_ROWS);
    const m4 = new THREE.Matrix4();
    for (let r = 0; r < DOT_ROWS; r++) {
      for (let c = 0; c < DOT_COLS; c++) {
        m4.makeTranslation((c - 1) * DOT_DX, DOT_TOP - r * DOT_DY, D / 2 + 0.0008);
        const i = r * DOT_COLS + c;
        this.dots.setMatrixAt(i, m4);
        this.dots.setColorAt(i, DOT_OFF);
      }
    }
    this.dev.add(this.dots);
    this.glowMat = new THREE.SpriteMaterial({
      map: radialTexture([[0, 'rgba(255,255,255,.9)'], [0.3, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']]),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    });
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.set(0.26, 0.5, 1);
    glow.position.set(0, DOT_TOP - (DOT_ROWS - 1) * DOT_DY / 2, D / 2 + 0.02);
    this.dev.add(glow);

    // Right side: round control button above the +/- rocker
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.012, 32), this.bodyMat);
    btn.rotation.z = Math.PI / 2;
    btn.position.set(W / 2 + 0.002, 0.36, 0);
    this.dev.add(btn);
    const rocker = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.09, 6, 16), this.bodyMat);
    rocker.scale.set(0.55, 1, 1);
    rocker.position.set(W / 2 + 0.002, 0.2, 0);
    this.dev.add(rocker);

    // Knurled oven cap on the bottom, and the USB-C port on the back
    const knurl = new THREE.Mesh(knurlGeometry(), darkMetal);
    knurl.position.y = -H / 2 + 0.008;
    this.dev.add(knurl);
    const port = new THREE.Mesh(new RoundedBoxGeometry(0.034, 0.09, 0.01, 2, 0.004), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6 }));
    port.position.set(0, 0.02, -D / 2 + 0.002);
    this.dev.add(port);

    // Mouthpiece arm on its hinge, with the oval outlet near the free end
    this.armPivot = new THREE.Group();
    this.armPivot.position.copy(HINGE);
    this.dev.add(this.armPivot);
    this.armPivot.add(new THREE.Mesh(armGeometry(), this.armMat));
    const slope = Math.atan2(armTopY(OUTLET_X + 0.001) - armTopY(OUTLET_X - 0.001), 0.002);
    this.outlet = new THREE.Group();
    this.outlet.position.set(OUTLET_X, armTopY(OUTLET_X) + 0.001, 0);
    this.outlet.rotation.z = slope;
    this.armPivot.add(this.outlet);
    const oval = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.008, 40),
      [darkMetal, new THREE.MeshStandardMaterial({ map: outletTexture(), roughness: 0.55, metalness: 0.2 }), darkMetal],
    );
    oval.scale.set(1.45, 1, 1);
    this.outlet.add(oval);

    // Floor: a soft shadow and a ring of light that takes the heat color
    const floorY = -H / 2 - 0.3;
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: radialTexture([[0, 'rgba(0,0,0,.6)'], [0.35, 'rgba(0,0,0,.28)'], [1, 'rgba(0,0,0,0)']]),
      transparent: true, depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = floorY;
    this.root.add(this.shadow);
    this.floorMat = new THREE.MeshBasicMaterial({
      map: radialTexture([
        [0, 'rgba(255,255,255,.10)'], [0.3, 'rgba(255,255,255,.035)'], [0.37, 'rgba(255,255,255,0)'],
        [0.395, 'rgba(255,255,255,.42)'], [0.415, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)'],
      ], 512),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: COLD.clone(), opacity: 0.45,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY - 0.001;
    this.root.add(floor);

    // Vapor
    const n = this.reduced ? 70 : 260;
    this.vN = n;
    this.vNext = 0;
    this.emitAcc = 0;
    this.vPos = new Float32Array(n * 3);
    this.vVel = new Float32Array(n * 3);
    this.vAge = new Float32Array(n).fill(1);
    this.vLife = new Float32Array(n).fill(1);
    this.vStrong = new Float32Array(n);
    this.vSeed = Float32Array.from({ length: n }, () => Math.random() * 100);
    this.vSize = new Float32Array(n);
    this.vAlpha = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.vPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.vSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.vAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    this.vMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color('#f1ece4') } },
      vertexShader: VAPOR_VERT, fragmentShader: VAPOR_FRAG, transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, this.vMat);
    pts.frustumCulled = false;
    s.add(pts);
  }

  // Stacked digits, the way the real display shows temperature.
  _drawDots() {
    const t = this.tele;
    const live = t.connected && t.temp != null && t.mode !== 'off' && t.mode !== 'idle';
    const key = `${live ? Math.round(t.temp) : ''}|${t.mode}|${t.dim}`;
    if (key === this._dotKey) return;
    this._dotKey = key;
    const lit = new Set();
    if (live) {
      const digits = String(Math.max(0, Math.min(999, Math.round(t.temp)))).padStart(3, ' ');
      for (let d = 0; d < 3; d++) {
        const glyph = FONT[digits[d]];
        if (!glyph) continue;
        for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (glyph[r][c] === '1') lit.add((2 + d * 6 + r) * DOT_COLS + c);
      }
    }
    const on = (DOT_ON[t.mode] || DOT_ON.ready).clone().multiplyScalar(t.dim ? 0.45 : 1);
    for (let i = 0; i < DOT_COLS * DOT_ROWS; i++) this.dots.setColorAt(i, lit.has(i) ? on : DOT_OFF);
    this.dots.instanceColor.needsUpdate = true;
  }

  _bindDrag() {
    let lastX = 0;
    let lastT = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lastX = e.clientX;
      lastT = performance.now();
      this.yawVel = 0;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      this.yawUser += dx * 0.011;
      this.yawVel = (dx * 0.011) / Math.max(0.008, (now - lastT) / 1000);
      lastX = e.clientX;
      lastT = now;
    });
    const up = () => { this.dragging = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  // ---- Vapor --------------------------------------------------------------------------------
  _emit(count, at, dir, strong) {
    for (let k = 0; k < count; k++) {
      const i = this.vNext;
      this.vNext = (this.vNext + 1) % this.vN;
      const j = i * 3;
      this.vPos[j] = at.x + (Math.random() - 0.5) * 0.03;
      this.vPos[j + 1] = at.y + (Math.random() - 0.5) * 0.03;
      this.vPos[j + 2] = at.z + (Math.random() - 0.5) * 0.03;
      const sp = strong ? 0.32 + Math.random() * 0.22 : 0.05 + Math.random() * 0.04;
      this.vVel[j] = dir.x * sp + (Math.random() - 0.5) * 0.08;
      this.vVel[j + 1] = dir.y * sp + (strong ? 0.12 : 0.05) + Math.random() * 0.06;
      this.vVel[j + 2] = dir.z * sp + (Math.random() - 0.3) * 0.08;
      this.vAge[i] = 0;
      this.vLife[i] = strong ? 1.5 + Math.random() * 1.1 : 2.6 + Math.random() * 1.4;
      this.vStrong[i] = strong ? 1 : 0;
    }
  }

  _updateVapor(dt, t) {
    for (let i = 0; i < this.vN; i++) {
      if (this.vAge[i] >= 1) { this.vAlpha[i] = 0; continue; }
      this.vAge[i] = Math.min(1, this.vAge[i] + dt / this.vLife[i]);
      const a = this.vAge[i];
      const j = i * 3;
      const seed = this.vSeed[i];
      this.vVel[j] *= 1 - 0.9 * dt;
      this.vVel[j + 2] *= 1 - 0.9 * dt;
      this.vVel[j] += Math.sin(t * 1.3 + seed) * 0.05 * dt;
      this.vVel[j + 1] += 0.1 * dt;                       // warm vapor rises
      this.vVel[j + 2] += Math.cos(t * 1.1 + seed) * 0.04 * dt;
      this.vPos[j] += this.vVel[j] * dt;
      this.vPos[j + 1] += this.vVel[j + 1] * dt;
      this.vPos[j + 2] += this.vVel[j + 2] * dt;
      const strong = this.vStrong[i];
      this.vSize[i] = 0.05 + a * (strong ? 0.42 : 0.22);
      this.vAlpha[i] = (strong ? 0.2 : 0.07) * Math.min(1, a * 7) * Math.pow(1 - a, 1.4);
    }
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }

  // ---- Frame -----------------------------------------------------------------------------------
  _frame() {
    if (document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const tele = this.tele;
    const blip = t < this.blipUntil;
    const mode = tele.connected ? tele.mode : 'off';

    // Screen placement eases between home and the wrap showcase
    const goal = this.showcase ? SHOWCASE : HOME;
    const k = Math.min(1, dt * 4);
    this.place.x += (goal.x - this.place.x) * k;
    this.place.y += (goal.y - this.place.y) * k;
    this._placeRoot();

    // Float, lift during a draw
    const liftGoal = this.drawing ? 0.12 : blip ? 0.07 : 0;
    this.lift += (liftGoal - this.lift) * Math.min(1, dt * 2.6);
    const amp = this.reduced ? 0.006 : 0.026;
    this.dev.position.y = Math.sin(t * 1.1) * amp + this.lift;

    // Turn: idle sway, a springy spin the user can fling, a slow turntable while picking a wrap
    if (this.showcase) {
      this.yawUser += dt * 0.6;
      this.yawVel = 0;
    } else if (!this.dragging) {
      const acc = -this.yawUser * 5 - this.yawVel * 3.4;
      this.yawVel += acc * dt;
      this.yawUser += this.yawVel * dt;
    }
    const sway = this.reduced || this.showcase ? 0 : Math.sin(t * 0.33) * 0.07;
    this.dev.rotation.set(0.05 + Math.sin(t * 0.9) * 0.008, -0.42 + sway + this.yawUser, Math.sin(t * 0.7) * 0.012);

    // Mouthpiece springs open when the IQ3 is on, like a trunk
    const openGoal = tele.connected && tele.open ? 1 : 0;
    this.openVel += ((openGoal - this.openPos) * 70 - this.openVel * 11) * dt;
    this.openPos += this.openVel * dt;
    this.armPivot.rotation.z = OPEN_ANGLE * this.openPos;

    // Display glow
    let glow = 0;
    if (this.drawing || blip) glow = 0.75 + Math.sin(t * 24) * 0.12;
    else if (mode === 'heat') glow = 0.35 + Math.sin(t * 2.6) * 0.15;
    else if (mode === 'boost') glow = 0.5 + Math.sin(t * 6) * 0.2;
    else if (mode === 'ready') glow = 0.45;
    this.dotGlow += (glow - this.dotGlow) * Math.min(1, dt * 6);
    this.glowMat.opacity = this.dotGlow * (tele.dim ? 0.4 : 1);
    this.glowMat.color.copy(mode === 'heat' || mode === 'boost' ? HOT : DOT_ON.ready);

    // Heat tints the rim light, floor ring and oven glow
    this.heatShown += ((tele.connected ? tele.heat : 0) - this.heatShown) * Math.min(1, dt * 1.5);
    const hs = this.heatShown;
    this.rim.color.copy(COLD).lerp(HOT, hs);
    this.floorMat.color.copy(COLD).lerp(HOT, hs);
    this.floorMat.opacity = 0.32 + hs * 0.28 + (this.drawing ? 0.25 : 0);
    this.heatLight.intensity += ((hs * 1.4 + (this.drawing ? 2.2 : 0)) - this.heatLight.intensity) * Math.min(1, dt * 3);

    // Shadow tightens and fades as the device rises
    const rise = this.dev.position.y;
    this.shadow.scale.setScalar(1 - rise * 1.6);
    this.shadowMat.opacity = Math.max(0.35, 0.95 - rise * 3);

    // Vapor streams out of the outlet
    this.outlet.updateWorldMatrix(true, false);
    const at = this._v.set(0, 0.02, 0).applyMatrix4(this.outlet.matrixWorld);
    const dir = this._n.set(0, 1, 0).transformDirection(this.outlet.matrixWorld);
    if (this.drawing) this.emitAcc += dt * (this.reduced ? 18 : 70);
    else if (blip) this.emitAcc += dt * (this.reduced ? 12 : 45);
    else if (mode === 'ready' && this.openPos > 0.8 && !this.reduced) this.emitAcc += dt * 2.2;
    const count = Math.floor(this.emitAcc);
    this.emitAcc -= count;
    if (count) this._emit(count, at, dir, this.drawing || blip);
    this._updateVapor(dt, t);

    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame(this.anchors());
  }

  anchors() {
    const v = this._v.copy(LABEL);
    this.dev.localToWorld(v);
    v.project(this.camera);
    return {
      label: { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h },
      facing: Math.cos(this.dev.rotation.y),
      heat: this.heatShown,
    };
  }
}
