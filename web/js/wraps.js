// Finishes for the 3D IQ3: the four official brushed-aluminum colors, plus custom wraps
// generated as tileable textures (no image downloads needed).
import * as THREE from 'three';

export const WRAPS = [
  { id: 'onyx', name: 'Onyx', group: 'colors', color: '#1f2023', metalness: 0.85, roughness: 0.36, brushed: true },
  { id: 'sapphire', name: 'Sapphire', group: 'colors', color: '#4b80c2', metalness: 0.85, roughness: 0.28, brushed: true },
  { id: 'gunmetal', name: 'Gunmetal', group: 'colors', color: '#71767c', metalness: 0.95, roughness: 0.3, brushed: true },
  { id: 'amethyst', name: 'Amethyst', group: 'colors', color: '#6a3cc4', metalness: 0.85, roughness: 0.32, brushed: true },
  { id: 'rust', name: 'Rust', group: 'wraps', pattern: 'rust', metalness: 0.15, roughness: 0.88, envIntensity: 0.6 },
  { id: 'carbon', name: 'Carbon', group: 'wraps', pattern: 'carbon', metalness: 0.3, roughness: 0.42, clearcoat: 1 },
  { id: 'camo', name: 'Camo', group: 'wraps', pattern: 'camo', metalness: 0, roughness: 0.86 },
  { id: 'marble', name: 'Marble', group: 'wraps', pattern: 'marble', metalness: 0, roughness: 0.28, clearcoat: 1 },
  { id: 'aurora', name: 'Aurora', group: 'wraps', pattern: 'aurora', metalness: 0.9, roughness: 0.2, iridescence: 0.7 },
  { id: 'gold', name: 'Gold', group: 'wraps', color: '#d2a24a', metalness: 1, roughness: 0.26, brushed: true },
];
export const DEFAULT_WRAP = 'onyx';
export const wrapById = (id) => WRAPS.find((w) => w.id === id) || WRAPS[0];

// ---- Tileable noise -------------------------------------------------------------
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = Float32Array.from({ length: 256 }, () => r());
  const lat = (x, y) => val[perm[perm[x & 255] + (y & 255)]];
  return (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = lat(x0, y0); const b = lat(x1, y0); const c = lat(x0, y1); const d = lat(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Fractal noise over u, v in [0, 1). Integer base keeps it seamless.
function fbm(n, u, v, base, octaves) {
  let sum = 0; let amp = 0.5; let f = base; let norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * n(u * f, v * f, f); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

function hexRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

function ramp(stops) {
  const s = stops.map(([t, hex]) => [t, hexRgb(hex)]);
  return (t) => {
    if (t <= s[0][0]) return [...s[0][1]];
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i][0]) {
        const k = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        return s[i][1].map((c, j) => s[i - 1][1][j] + (c - s[i - 1][1][j]) * k);
      }
    }
    return [...s[s.length - 1][1]];
  };
}

function paint(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---- Patterns --------------------------------------------------------------------
const PATTERNS = {
  // Weathered steel: orange and ochre rust, peppered with dark scale and a few olive patches.
  rust() {
    const n = valueNoise(7); const m = valueNoise(19); const k = valueNoise(29);
    const col = ramp([[0, '#2b2e19'], [0.3, '#4a3b19'], [0.44, '#874816'], [0.58, '#b0601c'], [0.74, '#c98230'], [1, '#d99c4c']]);
    return paint(512, (u, v) => {
      const big = fbm(n, u, v, 4, 5);
      const fine = fbm(m, u, v, 64, 2);
      const patch = fbm(k, u, v, 6, 4);
      let c = col(0.16 + big * 0.62 + (fine - 0.5) * 0.3);
      if (patch < 0.34) c = c.map((x, i) => x * 0.4 + [36, 42, 25][i] * 0.6);
      if (fine > 0.67) c = c.map((x) => x * 0.42);
      else if (fine > 0.63) c = c.map((x) => x * 0.72);
      return c;
    });
  },
  // Holographic foil: soft pastel bands that drift with the surface.
  aurora() {
    const n = valueNoise(31);
    const hsl = (h, s, l) => {
      const a = s * Math.min(l, 1 - l);
      const f = (k) => { const q = (k + h * 12) % 12; return l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)); };
      return [f(0) * 255, f(8) * 255, f(4) * 255];
    };
    return paint(512, (u, v) => {
      const t = fbm(n, u, v, 2, 4);
      const hue = (((u + v + t * 1.3) % 1) + 1) % 1;
      return hsl(hue, 0.38, 0.82);
    });
  },
  carbon() {
    const size = 256; const cell = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#08090a';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size / cell; i++) {
      for (let j = 0; j < size / cell; j++) {
        const x = i * cell; const y = j * cell;
        const across = (i + j) % 2 === 0;
        const gr = across ? g.createLinearGradient(x, y, x, y + cell) : g.createLinearGradient(x, y, x + cell, y);
        gr.addColorStop(0, '#0d0e10');
        gr.addColorStop(0.5, '#3c4046');
        gr.addColorStop(1, '#0d0e10');
        g.fillStyle = gr;
        g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
    return c;
  },
  camo() {
    const n = valueNoise(3); const m = valueNoise(11);
    return paint(512, (u, v) => {
      const a = fbm(n, u, v, 3, 4);
      const b = fbm(m, u, v, 4, 4);
      if (a > 0.58) return [42, 40, 29];
      if (b > 0.56) return [109, 90, 58];
      if (a < 0.42) return [140, 137, 92];
      return [75, 81, 40];
    });
  },
  marble() {
    const n = valueNoise(5); const m = valueNoise(23);
    return paint(512, (u, v) => {
      const t = fbm(n, u, v, 3, 5);
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 2 + v + t * 2.4) * Math.PI * 2)), 14);
      const thread = Math.pow(1 - Math.abs(Math.sin((u * 5 + t * 4) * Math.PI * 2)), 30) * 0.4;
      const base = 238 - fbm(m, u, v, 6, 3) * 18;
      const dark = Math.min(1, vein * 0.85 + thread);
      return [base - dark * 122, base - dark * 120, base - dark * 112];
    });
  },
  // Brushed aluminum: dense, fine, low-contrast horizontal streaks, tinted by the color.
  brushed() {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#efefef';
    g.fillRect(0, 0, size, size);
    const r = rng(42);
    for (let k = 0; k < 9000; k++) {
      const y = Math.floor(r() * size) + 0.5;
      const x = r() * size;
      const len = 120 + r() * 800;
      const a = 0.012 + r() * 0.035;
      g.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.lineWidth = 0.5 + r() * 0.7;
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + len, y);
      g.moveTo(x - size, y); g.lineTo(x - size + len, y);
      g.stroke();
    }
    return c;
  },
};

const canvasCache = {};
function patternCanvas(name) {
  if (!canvasCache[name]) canvasCache[name] = PATTERNS[name]();
  return canvasCache[name];
}

const texCache = {};
export function wrapMaps(wrap) {
  const key = wrap.pattern || (wrap.brushed ? 'brushed' : null);
  if (!key) return { map: null, roughnessMap: null };
  if (!texCache[key]) {
    const canvas = patternCanvas(key);
    const rep = { carbon: 5, rust: 1.4, camo: 1.2, brushed: 1.6 }[key] || 1;
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(rep, rep);
    map.anisotropy = 8;
    let roughnessMap = null;
    if (key === 'brushed') {
      roughnessMap = new THREE.CanvasTexture(canvas);
      roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
      roughnessMap.repeat.set(rep, rep);
      roughnessMap.anisotropy = 8;
    }
    texCache[key] = { map, roughnessMap };
  }
  return texCache[key];
}

// ---- Swatches -----------------------------------------------------------------------
function mix(hex, toward, k) {
  const a = hexRgb(hex); const b = hexRgb(toward);
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * k)).join(',')})`;
}

const swatchCache = {};
export function swatchBackground(wrap) {
  if (wrap.pattern) {
    if (!swatchCache[wrap.pattern]) {
      const small = document.createElement('canvas');
      small.width = small.height = 112;
      const src = patternCanvas(wrap.pattern);
      const g = small.getContext('2d');
      g.drawImage(src, 0, 0, wrap.pattern === 'carbon' ? src.width / 2.2 : src.width / 1.6, wrap.pattern === 'carbon' ? src.height / 2.2 : src.height / 1.6, 0, 0, 112, 112);
      swatchCache[wrap.pattern] = small.toDataURL('image/png');
    }
    return `radial-gradient(circle at 30% 26%, rgba(255,255,255,.28), rgba(255,255,255,0) 46%), url(${swatchCache[wrap.pattern]}) center / cover`;
  }
  return `radial-gradient(circle at 30% 26%, ${mix(wrap.color, '#ffffff', 0.38)}, ${wrap.color} 54%, ${mix(wrap.color, '#000000', 0.5)})`;
}
