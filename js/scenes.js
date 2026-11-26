// scenes.js — procedural, offline, deterministic paintings for jigsaws.
// Same (id, seed) => same drawing. Only the seeded rng below is used: no Math.random, no Date, no text.
// Designed for puzzles: many distinct colour regions, detail everywhere, cheerful and high-contrast.

export const SCENES = [
  { id: 'mountains', name: 'Mountain Lake',      emoji: '🏔️' },
  { id: 'seaside',   name: 'Seaside Huts',       emoji: '⛱️' },
  { id: 'garden',    name: 'Cottage Garden',     emoji: '🏡' },
  { id: 'lighthouse',name: 'Lighthouse Sunset',  emoji: '🗼' },
  { id: 'balloons',  name: 'Hot-Air Balloons',   emoji: '🎈' },
  { id: 'autumn',    name: 'Autumn Woods',       emoji: '🍂' },
  { id: 'quilt',     name: 'Patchwork Quilt',    emoji: '🧵' },
  { id: 'night',     name: 'Village by Night',   emoji: '🌙' },
  { id: 'tulips',    name: 'Tulip Fields',       emoji: '🌷' },
  { id: 'birds',     name: 'Birds in Blossom',   emoji: '🐦' },
];

export function sceneName(id) { return (SCENES.find(s => s.id === id) || SCENES[0]).name; }
export function pickScene(seed) { return SCENES[Math.floor(rng(seed)() * SCENES.length)].id; }

export function paintScene(id, seed, w = 1600, h = 1200) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const R = rng(hash(id) ^ (seed >>> 0));
  const P = PAINTERS[id] || PAINTERS.mountains;
  g.save(); g.scale(w / 1600, h / 1200);           // paint in a fixed 1600x1200 space
  P(g, 1600, 1200, tools(R));
  g.restore();
  return c;
}

// ---------------------------------------------------------------- randomness
function rng(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function tools(R) {
  const rr = (a, b) => a + R() * (b - a);
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pick = a => a[Math.floor(R() * a.length)];
  return { R, rr, ri, pick };
}
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- shared drawing helpers
function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}
function rect(g, x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
function circle(g, x, y, r, fill) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function ellipse(g, x, y, rx, ry, rot, fill) { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); }
function poly(g, pts, fill) { g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); }

// fractal skyline (midpoint displacement) -> array of [x,y]
function peaks(t, w, base, amp, rough = 0.55, n = 7) {
  const N = 1 << n, ys = new Array(N + 1).fill(0);
  ys[0] = t.R(); ys[N] = t.R();
  let step = N, sc = 1;
  while (step > 1) { const half = step / 2;
    for (let i = half; i < N; i += step) ys[i] = (ys[i - half] + ys[i + half]) / 2 + (t.R() - 0.5) * sc;
    step = half; sc *= rough; }
  const mn = Math.min(...ys), mx = Math.max(...ys);
  return ys.map((v, i) => [i / N * w, base - amp * (v - mn) / ((mx - mn) || 1)]);
}
function fillUnder(g, pts, bottom, fill) {
  g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], bottom);
  for (const p of pts) g.lineTo(p[0], p[1]);
  g.lineTo(pts[pts.length - 1][0], bottom); g.closePath(); g.fill();
}
function sun(g, x, y, r, core, glow) {
  for (let i = 5; i >= 1; i--) circle(g, x, y, r * (1 + i * 0.35), glow.replace('A', (0.06 * (6 - i)).toFixed(2)));
  circle(g, x, y, r, core);
}
function cloud(g, t, x, y, s, light = '#ffffff', shade = 'rgba(180,195,220,0.9)') {
  const blobs = [];
  for (let i = 0; i < 6; i++) blobs.push([x + (i - 2.5) * s * 0.42 + t.rr(-8, 8), y - Math.sin((i + 0.5) / 6 * Math.PI) * s * t.rr(0.25, 0.45), s * t.rr(0.28, 0.42)]);
  for (const [bx, by, br] of blobs) ellipse(g, bx, by + br * 0.25, br * 1.1, br * 0.8, 0, shade);
  for (const [bx, by, br] of blobs) ellipse(g, bx, by, br * 1.05, br * 0.78, 0, light);
}
function gull(g, x, y, s, color = '#2b2b38') {
  g.strokeStyle = color; g.lineWidth = s * 0.12; g.lineCap = 'round'; g.beginPath();
  g.moveTo(x - s, y); g.quadraticCurveTo(x - s * 0.5, y - s * 0.55, x, y);
  g.quadraticCurveTo(x + s * 0.5, y - s * 0.55, x + s, y); g.stroke();
}
function pine(g, x, y, s, col, dark) {
  rect(g, x - s * 0.06, y - s * 0.25, s * 0.12, s * 0.3, '#5b3a22');
  for (let i = 0; i < 3; i++) {
    const ty = y - s * 0.2 - i * s * 0.32, bw = s * (0.42 - i * 0.1);
    poly(g, [[x, ty - s * 0.55], [x - bw, ty], [x + bw, ty]], i % 2 ? dark : col);
  }
}
function roundTree(g, t, x, y, s, hues) {
  rect(g, x - s * 0.07, y - s * 0.5, s * 0.14, s * 0.5, '#6b4527');
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU, d = s * 0.22;
    circle(g, x + Math.cos(a) * d, y - s * 0.75 + Math.sin(a) * d * 0.8, s * t.rr(0.2, 0.3), hsl(t.pick(hues), t.rr(45, 65), t.rr(28, 42)));
  }
  circle(g, x - s * 0.08, y - s * 0.85, s * 0.18, hsl(t.pick(hues), 55, 48));
}
function flower(g, x, y, r, petal, center, n = 5, rot = 0) {
  g.fillStyle = petal;
  for (let i = 0; i < n; i++) { const a = rot + i * TAU / n; g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.3, a, 0, TAU); g.fill(); }
  circle(g, x, y, r * 0.3, center);
}
function grass(g, t, x0, x1, y0, y1, n, hue) {
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = t.rr(x0, x1), y = t.rr(y0, y1), l = t.rr(10, 26) * (0.5 + (y - y0) / (y1 - y0 + 1));
    g.strokeStyle = hsl(hue + t.rr(-15, 15), 55, t.rr(25, 45)); g.lineWidth = t.rr(1.5, 3.5);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + t.rr(-6, 6), y - l * 0.6, x + t.rr(-10, 10), y - l); g.stroke();
  }
}
function meadowFlowers(g, t, x0, x1, y0, y1, n) {
  const cols = ['#e63946', '#ffb703', '#ffffff', '#c77dff', '#ff8fab', '#4cc9f0', '#f77f00'];
  for (let i = 0; i < n; i++) {
    const y = t.rr(y0, y1), k = 0.5 + (y - y0) / (y1 - y0 + 1);
    flower(g, t.rr(x0, x1), y, t.rr(5, 10) * k, t.pick(cols), '#ffd23f', t.ri(5, 6), t.rr(0, TAU));
  }
}
function house(g, t, x, y, w, h, wall, roof, opts = {}) {
  const lit = opts.lit;
  rect(g, x, y - h, w, h, wall);
  rect(g, x, y - h, w * 0.08, h, 'rgba(0,0,0,0.12)');
  const rh = h * t.rr(0.5, 0.75);
  poly(g, [[x - w * 0.08, y - h], [x + w / 2, y - h - rh], [x + w * 1.08, y - h]], roof);
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) { const k = i / 4; g.beginPath();
    g.moveTo(x - w * 0.08 + (w * 0.58) * k, y - h - rh * k); g.lineTo(x + w * 1.08 - (w * 0.58) * k, y - h - rh * k); g.stroke(); }
  if (opts.chimney !== false) rect(g, x + w * 0.68, y - h - rh * 0.8, w * 0.12, rh * 0.55, '#8c3b2b');
  const cols = Math.max(1, Math.round(w / 55)), win = lit ? '#ffd166' : '#bde0fe';
  const ww = w / (cols * 2 + 1);
  for (let i = 0; i < cols; i++) {
    const wx = x + ww * (1 + i * 2), wy = y - h * 0.78, wh = h * 0.28;
    if (lit) circle(g, wx + ww / 2, wy + wh / 2, ww * 1.1, 'rgba(255,200,90,0.18)');
    rect(g, wx - 3, wy - 3, ww + 6, wh + 6, '#fdf6e3');
    rect(g, wx, wy, ww, wh, lit && t.R() < 0.85 ? win : (lit ? '#2b2d42' : win));
    rect(g, wx + ww / 2 - 1.5, wy, 3, wh, '#fdf6e3'); rect(g, wx, wy + wh / 2 - 1.5, ww, 3, '#fdf6e3');
  }
  const dw = w * 0.2; rect(g, x + w / 2 - dw / 2, y - h * 0.4, dw, h * 0.4, opts.door || '#7b2d26');
  circle(g, x + w / 2 + dw * 0.28, y - h * 0.2, 3, '#ffd23f');
}

// ---------------------------------------------------------------- the scenes
const PAINTERS = {

  mountains(g, W, H, t) {
    const hue = t.rr(195, 215), horizon = H * 0.58;
    g.fillStyle = vgrad(g, 0, horizon, [hsl(hue, 70, 52), hsl(hue - 8, 75, 72), hsl(hue - 20, 80, 88)]); g.fillRect(0, 0, W, horizon);
    sun(g, t.rr(250, 1350), t.rr(120, 260), 70, '#fff4c2', 'rgba(255,240,180,A)');
    for (let i = 0; i < 6; i++) cloud(g, t, t.rr(0, W), t.rr(70, 330), t.rr(110, 200));
    const far = peaks(t, W, horizon - 40, 360, 0.6), mid = peaks(t, W, horizon - 5, 260, 0.55), near = peaks(t, W, horizon + 10, 150, 0.5);
    const layers = [[far, hsl(hue + 30, 25, 62)], [mid, hsl(hue + 40, 28, 46)], [near, hsl(130, 30, 34)]];
    for (const [pts, col] of layers.slice(0, 2)) {
      fillUnder(g, pts, H, col);
      // snow caps on the higher points
      g.fillStyle = 'rgba(255,255,255,0.92)';
      const top = Math.min(...pts.map(p => p[1]));
      for (let i = 1; i < pts.length - 1; i++) if (pts[i][1] < top + 70 && pts[i][1] <= pts[i - 1][1] && pts[i][1] <= pts[i + 1][1]) {
        const [px, py] = pts[i]; g.beginPath(); g.moveTo(px, py);
        g.lineTo(px - 55, py + 60); g.lineTo(px - 25, py + 48); g.lineTo(px, py + 66); g.lineTo(px + 28, py + 46); g.lineTo(px + 58, py + 62); g.closePath(); g.fill();
      }
    }
    fillUnder(g, near, H, layers[2][1]);
    // forest band
    for (let i = 0; i < 140; i++) { const x = t.rr(-20, W + 20), y = horizon + t.rr(-10, 45);
      pine(g, x, y, t.rr(45, 85), hsl(t.rr(120, 150), 40, t.rr(22, 32)), hsl(t.rr(120, 150), 45, t.rr(16, 24))); }
    // lake with reflection
    const lakeTop = horizon + 40, lakeBot = H * 0.8;
    g.fillStyle = vgrad(g, lakeTop, lakeBot, [hsl(hue, 55, 55), hsl(hue + 5, 60, 40)]); g.fillRect(0, lakeTop, W, lakeBot - lakeTop);
    g.save(); g.beginPath(); g.rect(0, lakeTop, W, lakeBot - lakeTop); g.clip();
    g.globalAlpha = 0.3; g.translate(0, 2 * lakeTop); g.scale(1, -1);
    for (const [pts, col] of layers) fillUnder(g, pts.map(([x, y]) => [x, y + 40]), lakeTop - 400, col);
    g.restore();
    for (let i = 0; i < 160; i++) { const y = t.rr(lakeTop + 5, lakeBot - 5), x = t.rr(0, W);
      rect(g, x, y, t.rr(20, 90), 2.5, `rgba(255,255,255,${t.rr(0.15, 0.45).toFixed(2)})`); }
    // rowboat
    const bx = t.rr(400, 1200), by = (lakeTop + lakeBot) / 2;
    poly(g, [[bx - 70, by], [bx + 70, by], [bx + 50, by + 22], [bx - 50, by + 22]], '#b5442b');
    rect(g, bx - 70, by - 4, 140, 6, '#f4e3c1'); circle(g, bx, by - 22, 14, '#2a6f97'); circle(g, bx, by - 44, 10, '#f1c27d');
    // meadow
    g.fillStyle = vgrad(g, lakeBot, H, [hsl(100, 50, 45), hsl(95, 55, 32)]); g.fillRect(0, lakeBot, W, H - lakeBot);
    grass(g, t, 0, W, lakeBot + 10, H, 900, 100);
    meadowFlowers(g, t, 0, W, lakeBot + 15, H, 420);
  },

  seaside(g, W, H, t) {
    const horizon = H * 0.42;
    g.fillStyle = vgrad(g, 0, horizon, ['#3a86ff', '#8ecae6', '#e0f4ff']); g.fillRect(0, 0, W, horizon);
    sun(g, t.rr(1100, 1450), t.rr(100, 180), 60, '#fff3b0', 'rgba(255,236,160,A)');
    for (let i = 0; i < 5; i++) cloud(g, t, t.rr(0, W), t.rr(60, 250), t.rr(100, 180));
    // headland with tiny houses
    const hd = peaks(t, W * 0.45, horizon + 5, 90, 0.5, 5);
    fillUnder(g, hd, horizon + 30, '#6a994e');
    for (let i = 0; i < 9; i++) { const x = t.rr(20, W * 0.4), y = horizon - t.rr(5, 35);
      rect(g, x, y - 14, 20, 14, t.pick(['#fff', '#ffd6a5', '#fdffb6', '#caffbf'])); poly(g, [[x - 3, y - 14], [x + 10, y - 24], [x + 23, y - 14]], '#d62828'); }
    // sea
    const shore = H * 0.66;
    g.fillStyle = vgrad(g, horizon, shore, ['#1d4e89', '#2a9d8f', '#76c7c0']); g.fillRect(0, horizon, W, shore - horizon);
    g.lineCap = 'round';
    for (let i = 0; i < 380; i++) { const y = t.rr(horizon + 5, shore - 6), k = (y - horizon) / (shore - horizon);
      g.strokeStyle = `rgba(255,255,255,${(0.25 + k * 0.4).toFixed(2)})`; g.lineWidth = 1.5 + k * 2.5;
      const x = t.rr(0, W), l = 10 + k * 30; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 4 - k * 4, x + l, y); g.stroke(); }
    // sailboats
    for (let i = 0; i < 6; i++) {
      const x = t.rr(150, W - 150), y = t.rr(horizon + 30, shore - 60), s = 0.6 + (y - horizon) / (shore - horizon);
      poly(g, [[x - 40 * s, y], [x + 40 * s, y], [x + 28 * s, y + 14 * s], [x - 28 * s, y + 14 * s]], t.pick(['#8d0801', '#264653', '#ffffff', '#e76f51']));
      rect(g, x - 2 * s, y - 90 * s, 4 * s, 90 * s, '#5c4033');
      poly(g, [[x + 3 * s, y - 88 * s], [x + 3 * s, y - 6 * s], [x + 50 * s, y - 6 * s]], t.pick(['#ffffff', '#ffbe0b', '#fb5607', '#ff006e', '#8338ec']));
      poly(g, [[x - 3 * s, y - 70 * s], [x - 3 * s, y - 6 * s], [x - 36 * s, y - 6 * s]], t.pick(['#ffffff', '#fefae0', '#a8dadc']));
    }
    for (let i = 0; i < 7; i++) gull(g, t.rr(100, W - 100), t.rr(60, horizon - 30), t.rr(10, 20));
    // foam line & sand
    g.fillStyle = vgrad(g, shore, H, ['#f6e2b3', '#e9c46a', '#d4a373']); g.fillRect(0, shore, W, H - shore);
    for (let x = 0; x < W; x += 18) ellipse(g, x, shore + 2, 16, 6, 0, 'rgba(255,255,255,0.9)');
    // beach huts
    const huts = ['#e63946', '#457b9d', '#ffb703', '#2a9d8f', '#f4a261', '#8338ec', '#ff006e', '#06d6a0', '#118ab2'];
    const hw = 120, gap = 22, n = Math.floor(W / (hw + gap)), off = (W - n * (hw + gap) + gap) / 2, hy = shore + 210;
    for (let i = 0; i < n; i++) {
      const x = off + i * (hw + gap), c1 = huts[(i + t.ri(0, 8)) % huts.length];
      rect(g, x, hy - 150, hw, 150, '#ffffff');
      for (let s = 0; s < 6; s += 2) rect(g, x + s * hw / 6, hy - 150, hw / 6, 150, c1);
      poly(g, [[x - 10, hy - 150], [x + hw / 2, hy - 205], [x + hw + 10, hy - 150]], t.pick(['#1d3557', '#9b2226', '#3d405b']));
      rect(g, x + hw * 0.3, hy - 95, hw * 0.4, 95, '#fefae0'); rect(g, x + hw * 0.34, hy - 90, hw * 0.32, 85, t.pick(huts));
      rect(g, x - 6, hy, hw + 12, 10, '#9c6644');
    }
    // umbrellas, towels, pebbles, shells
    for (let i = 0; i < 6; i++) {
      const x = t.rr(80, W - 80), y = t.rr(hy + 70, H - 40), c = t.pick(huts), r = t.rr(60, 85);
      rect(g, x - 2, y - r * 1.1, 4, r * 1.1, '#6c584c');
      g.fillStyle = c; g.beginPath(); g.arc(x, y - r * 1.1, r, Math.PI, 0); g.fill();
      g.fillStyle = '#fff'; for (let k = 0; k < 4; k += 2) { g.beginPath(); g.moveTo(x, y - r * 1.1); g.arc(x, y - r * 1.1, r, Math.PI + k * Math.PI / 4, Math.PI + (k + 1) * Math.PI / 4); g.fill(); }
      const tw = t.rr(90, 130); for (let s = 0; s < 5; s++) rect(g, x + 20 + s * tw / 5, y - 10, tw / 5, 40, s % 2 ? '#fff' : t.pick(huts));
    }
    for (let i = 0; i < 260; i++) ellipse(g, t.rr(0, W), t.rr(hy + 15, H), t.rr(3, 9), t.rr(2, 6), t.rr(0, 3), hsl(t.rr(20, 40), t.rr(10, 40), t.rr(45, 85)));
  },

  garden(g, W, H, t) {
    const horizon = H * 0.5;
    g.fillStyle = vgrad(g, 0, horizon, ['#74b9ff', '#a9d6ff', '#e8f6ff']); g.fillRect(0, 0, W, horizon);
    for (let i = 0; i < 5; i++) cloud(g, t, t.rr(0, W), t.rr(50, 220), t.rr(100, 170));
    fillUnder(g, peaks(t, W, horizon, 120, 0.5, 6), H, '#7cb518');
    for (let i = 0; i < 16; i++) roundTree(g, t, t.rr(0, W), horizon + t.rr(-10, 30), t.rr(120, 220), [95, 110, 130, 140]);
    g.fillStyle = vgrad(g, horizon + 20, H, ['#80b918', '#55a630', '#2b9348']); g.fillRect(0, horizon + 20, W, H);
    // cottage with stone wall
    const cx = t.rr(420, 800), cy = H * 0.72, cw = 520, ch = 270;
    rect(g, cx, cy - ch, cw, ch, '#f2e8cf');
    for (let r = 0; r < 12; r++) for (let k = 0; k < 14; k++) {
      const sx = cx + k * 38 + (r % 2) * 19 - 10, sy = cy - ch + r * 23;
      if (sx > cx - 5 && sx < cx + cw - 30) g.fillStyle = hsl(t.rr(25, 45), t.rr(15, 35), t.rr(70, 86)), g.fillRect(sx, sy, 34, 19);
    }
    poly(g, [[cx - 40, cy - ch], [cx + cw / 2, cy - ch - 200], [cx + cw + 40, cy - ch]], '#9a3b2f');
    for (let r = 0; r < 8; r++) for (let k = 0; k < 30; k++) {
      const yy = cy - ch - 200 + 25 * (r + 1), half = (cw / 2 + 40) * (r + 1) / 8, xx = cx + cw / 2 - half + k * 34 + (r % 2) * 17;
      if (xx < cx + cw / 2 + half - 20) { g.fillStyle = hsl(8 + t.rr(-6, 6), 55, t.rr(35, 48)); g.beginPath(); g.arc(xx + 17, yy - 4, 15, 0, Math.PI); g.fill(); }
    }
    rect(g, cx + cw * 0.7, cy - ch - 190, 44, 110, '#7f4f24');
    for (let i = 0; i < 6; i++) circle(g, cx + cw * 0.7 + 22 + i * 18 + t.rr(-6, 6), cy - ch - 205 - i * 30, 16 + i * 4, `rgba(240,240,240,${(0.8 - i * 0.12).toFixed(2)})`);
    const winCol = '#a2d2ff';
    for (const wx of [cx + 50, cx + cw - 150]) {
      rect(g, wx - 8, cy - ch + 60, 116, 106, '#fefae0'); rect(g, wx, cy - ch + 68, 100, 90, winCol);
      rect(g, wx + 48, cy - ch + 68, 4, 90, '#fefae0'); rect(g, wx, cy - ch + 111, 100, 4, '#fefae0');
      rect(g, wx - 12, cy - ch + 166, 124, 22, '#8d5524');
      for (let k = 0; k < 9; k++) flower(g, wx - 4 + k * 13, cy - ch + 164 + t.rr(-6, 4), 9, t.pick(['#e63946', '#ffafcc', '#ffd60a', '#ffffff']), '#ffbe0b', 5, t.rr(0, 3));
    }
    rect(g, cx + cw / 2 - 45, cy - 160, 90, 160, '#1d3557'); circle(g, cx + cw / 2 + 25, cy - 80, 6, '#ffd60a');
    g.strokeStyle = '#2d6a4f'; g.lineWidth = 10;
    for (let i = 0; i < 16; i++) { const a = i / 15 * Math.PI; circle(g, cx + cw / 2 + Math.cos(a) * 75, cy - 175 - Math.sin(a) * 60, 14, i % 3 ? '#40916c' : '#ff8fab'); }
    // cobbled path
    for (let r = 0; r < 14; r++) { const y = cy + r * 26 + 10, half = 40 + r * 14;
      for (let x = -half; x < half; x += 34) ellipse(g, cx + cw / 2 + x + (r % 2) * 17, y, 15, 10, 0, hsl(30, 10, t.rr(55, 75))); }
    // picket fence
    const fy = H * 0.8;
    rect(g, 0, fy - 70, W, 12, '#f8f9fa'); rect(g, 0, fy - 25, W, 12, '#f8f9fa');
    for (let x = 0; x < W; x += 36) { if (Math.abs(x - (cx + cw / 2)) < 110) continue; poly(g, [[x, fy], [x, fy - 100], [x + 11, fy - 114], [x + 22, fy - 100], [x + 22, fy]], '#ffffff'); rect(g, x + 18, fy - 100, 4, 100, '#ced4da'); }
    // hollyhocks behind and flowers in front
    for (let i = 0; i < 18; i++) {
      const x = t.rr(20, W - 20); if (Math.abs(x - (cx + cw / 2)) < 140) continue;
      const base = fy - 10, tall = t.rr(180, 300), c = t.pick(['#ff006e', '#ffbe0b', '#fb5607', '#ffffff', '#c77dff', '#ff8fab']);
      rect(g, x - 3, base - tall, 6, tall, '#2d6a4f');
      for (let k = 0; k < 9; k++) flower(g, x + t.rr(-6, 6), base - tall + k * tall / 11, 20 - k, c, '#ffe066', 5, k);
    }
    for (let i = 0; i < 40; i++) circle(g, t.rr(0, W), t.rr(fy + 10, H), t.rr(30, 60), hsl(t.rr(100, 150), 45, t.rr(25, 38)));
    meadowFlowers(g, t, 0, W, fy + 10, H, 520);
  },

  lighthouse(g, W, H, t) {
    const horizon = H * 0.55;
    g.fillStyle = vgrad(g, 0, horizon, ['#3d348b', '#7678ed', '#f7b801', '#f18701', '#f35b04']); g.fillRect(0, 0, W, horizon);
    const sx = t.rr(250, 700); sun(g, sx, horizon - 40, 90, '#ffe8a3', 'rgba(255,200,100,A)');
    for (let i = 0; i < 8; i++) { const y = t.rr(60, horizon - 140), x = t.rr(0, W);
      ellipse(g, x, y, t.rr(120, 260), t.rr(12, 24), 0, `rgba(255,${t.ri(140, 200)},${t.ri(120, 180)},0.55)`); }
    g.fillStyle = vgrad(g, horizon, H, ['#f48c06', '#9d4edd', '#240046']); g.fillRect(0, horizon, W, H - horizon);
    for (let i = 0; i < 300; i++) { const y = t.rr(horizon + 4, H), k = (y - horizon) / (H - horizon);
      const near = Math.abs(t.rr(-1, 1)) * 300 * (0.3 + k); const x = t.R() < 0.5 ? sx + t.rr(-near, near) : t.rr(0, W);
      rect(g, x, y, 15 + k * 60, 2 + k * 3, `rgba(255,${t.ri(190, 235)},150,${(0.25 + 0.4 * (1 - k)).toFixed(2)})`); }
    // rocks with foam
    for (let i = 0; i < 9; i++) { const x = t.rr(0, W * 0.65), y = t.rr(horizon + 80, H - 30), s = t.rr(30, 80);
      ellipse(g, x, y, s * 1.6, s, 0, hsl(260, 15, t.rr(15, 28))); ellipse(g, x - s * 0.4, y - s * 0.4, s * 0.7, s * 0.3, -0.3, 'rgba(255,255,255,0.25)');
      for (let k = 0; k < 8; k++) circle(g, x + t.rr(-s * 1.8, s * 1.8), y + s * 0.8 + t.rr(-4, 4), t.rr(5, 12), 'rgba(255,255,255,0.75)'); }
    // cliff on the right
    const cl = [[W * 0.58, H], [W * 0.62, H * 0.6], [W * 0.7, H * 0.5], [W * 0.8, H * 0.45], [W, H * 0.44], [W, H]];
    poly(g, cl, '#6f4518');
    for (let i = 0; i < 40; i++) { const y = t.rr(H * 0.5, H), x = t.rr(W * 0.62 + (H - y) * -0.05, W);
      poly(g, [[x, y], [x + t.rr(30, 80), y + t.rr(-10, 10)], [x + t.rr(20, 60), y + t.rr(20, 50)]], hsl(t.rr(20, 35), 40, t.rr(20, 38))); }
    poly(g, [[W * 0.66, H * 0.56], [W * 0.7, H * 0.49], [W * 0.8, H * 0.44], [W, H * 0.43], [W, H * 0.5], [W * 0.78, H * 0.51]], '#55a630');
    meadowFlowers(g, t, W * 0.72, W, H * 0.45, H * 0.5, 80);
    // lighthouse
    const lx = W * 0.83, base = H * 0.46, top = H * 0.12, bw = 70, tw = 46;
    for (let i = 0; i < 6; i++) { const y0 = base - (base - top) * i / 6, y1 = base - (base - top) * (i + 1) / 6;
      const w0 = bw - (bw - tw) * i / 6, w1 = bw - (bw - tw) * (i + 1) / 6;
      poly(g, [[lx - w0, y0], [lx + w0, y0], [lx + w1, y1], [lx - w1, y1]], i % 2 ? '#ffffff' : '#d00000'); }
    rect(g, lx - tw - 14, top - 14, (tw + 14) * 2, 14, '#1b1b1b');
    rect(g, lx - 34, top - 70, 68, 56, '#ffd60a');
    for (let i = -1; i <= 1; i++) rect(g, lx + i * 22 - 2, top - 70, 4, 56, '#1b1b1b');
    poly(g, [[lx - 44, top - 70], [lx, top - 115], [lx + 44, top - 70]], '#1b1b1b');
    g.fillStyle = 'rgba(255,240,150,0.28)';
    g.beginPath(); g.moveTo(lx, top - 42); g.lineTo(0, top - 160); g.lineTo(0, top + 40); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(lx, top - 42); g.lineTo(W, top - 120); g.lineTo(W, top + 20); g.closePath(); g.fill();
    rect(g, lx - 14, base - 60, 28, 60, '#3a2e39');
    house(g, t, W * 0.88, base + 2, 140, 80, '#fff1e6', '#8d0801', {});
    for (let i = 0; i < 6; i++) gull(g, t.rr(100, W * 0.7), t.rr(60, horizon - 80), t.rr(10, 22), '#2b2d42');
    for (let i = 0; i < 3; i++) { const x = t.rr(150, W * 0.55), y = t.rr(horizon + 30, horizon + 120);
      poly(g, [[x - 30, y], [x + 30, y], [x + 20, y + 10], [x - 20, y + 10]], '#1b1b1b'); poly(g, [[x, y - 60], [x, y - 2], [x + 30, y - 2]], '#fff1e6'); }
  },

  balloons(g, W, H, t) {
    const horizon = H * 0.62;
    g.fillStyle = vgrad(g, 0, horizon, ['#48cae4', '#90e0ef', '#caf0f8', '#ffe5b4']); g.fillRect(0, 0, W, horizon);
    for (let i = 0; i < 7; i++) cloud(g, t, t.rr(0, W), t.rr(60, horizon - 120), t.rr(90, 180));
    fillUnder(g, peaks(t, W, horizon, 80, 0.5, 6), H, '#90a955');
    // patchwork fields in perspective
    const rows = 7, cols = 9;
    for (let r = 0; r < rows; r++) { const y0 = horizon + (H - horizon) * Math.pow(r / rows, 1.6), y1 = horizon + (H - horizon) * Math.pow((r + 1) / rows, 1.6);
      for (let c = -2; c < cols + 2; c++) { const spread = (y) => (y - horizon) / (H - horizon) * 1.3 + 0.5;
        const xAt = (cc, y) => W / 2 + (cc - cols / 2) * (W / cols) * spread(y);
        const pts = [[xAt(c, y0), y0], [xAt(c + 1, y0), y0], [xAt(c + 1, y1), y1], [xAt(c, y1), y1]];
        poly(g, pts, t.pick(['#bfd200', '#80b918', '#55a630', '#d4a373', '#e9c46a', '#a7c957', '#6a994e', '#f2e8cf']));
        g.strokeStyle = '#386641'; g.lineWidth = 2 + r * 1.2; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.closePath(); g.stroke();
        if (t.R() < 0.25) circle(g, (pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2, 6 + r * 4, '#2d6a4f'); } }
    // balloons, far ones first
    const pal = ['#e63946', '#ffb703', '#fb8500', '#219ebc', '#8338ec', '#ff006e', '#06d6a0', '#ffffff', '#023047', '#f15bb5'];
    const list = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) if (t.R() < 0.85)
      list.push([(c + t.rr(0.15, 0.85)) * W / 5, 90 + (r + t.rr(0.1, 0.8)) * (horizon - 40) / 3, t.rr(0.4, 0.75) + r * 0.22]);
    list.sort((a, b) => a[2] - b[2]);
    for (const [x, y, s] of list) {
      const r = 110 * s, c1 = t.pick(pal); let c2 = t.pick(pal); if (c2 === c1) c2 = '#ffffff'; const c3 = t.pick(pal);
      const env = new Path2D();
      env.moveTo(x, y + r * 1.25);
      env.bezierCurveTo(x - r * 0.35, y + r * 0.9, x - r * 1.05, y + r * 0.35, x - r, y - r * 0.2);
      env.bezierCurveTo(x - r * 0.95, y - r * 1.1, x + r * 0.95, y - r * 1.1, x + r, y - r * 0.2);
      env.bezierCurveTo(x + r * 1.05, y + r * 0.35, x + r * 0.35, y + r * 0.9, x, y + r * 1.25);
      g.save(); g.clip(env);
      g.fillStyle = c1; g.fillRect(x - r * 1.1, y - r * 1.2, r * 2.2, r * 2.6);
      const gores = 10;                               // curved vertical gores, alternating colours
      for (let k = 0; k < gores; k++) {
        const a0 = -Math.PI / 2 + k * Math.PI / gores, a1 = a0 + Math.PI / gores;
        g.fillStyle = k % 2 ? c2 : c1; g.beginPath(); g.moveTo(x, y - r * 1.1);
        g.quadraticCurveTo(x + r * 1.45 * Math.sin(a0), y - r * 0.1, x, y + r * 1.3);
        g.quadraticCurveTo(x + r * 1.45 * Math.sin(a1), y - r * 0.1, x, y - r * 1.1); g.fill();
      }
      rect(g, x - r * 1.1, y + r * 0.15, r * 2.2, r * 0.18, c3);
      for (let k = 0; k < 7; k++) poly(g, [[x - r + k * r * 0.3, y + r * 0.33], [x - r + k * r * 0.3 + r * 0.15, y + r * 0.5], [x - r + k * r * 0.3 + r * 0.3, y + r * 0.33]], c3);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(x - r * 0.45, y - r * 0.45, r * 0.22, r * 0.4, 0.4, 0, TAU); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.beginPath(); g.ellipse(x + r * 0.8, y, r * 0.35, r * 1.2, 0, 0, TAU); g.fill();
      g.restore();
      g.strokeStyle = '#5c4033'; g.lineWidth = Math.max(1, 2 * s);
      g.beginPath(); g.moveTo(x - r * 0.2, y + r * 1.2); g.lineTo(x - r * 0.16, y + r * 1.5); g.moveTo(x + r * 0.2, y + r * 1.2); g.lineTo(x + r * 0.16, y + r * 1.5); g.stroke();
      rect(g, x - r * 0.18, y + r * 1.5, r * 0.36, r * 0.24, '#a47148');
      for (let k = 0; k < 3; k++) rect(g, x - r * 0.18, y + r * 1.53 + k * r * 0.07, r * 0.36, Math.max(1, r * 0.02), '#7f5539');
    }
    for (let i = 0; i < 5; i++) gull(g, t.rr(50, W - 50), t.rr(40, 300), t.rr(8, 14));
  },

  autumn(g, W, H, t) {
    const horizon = H * 0.55;
    g.fillStyle = vgrad(g, 0, horizon, ['#ffd6a5', '#ffe8c2', '#fff3d6']); g.fillRect(0, 0, W, horizon);
    sun(g, t.rr(300, 1300), t.rr(140, 260), 80, '#fff1b8', 'rgba(255,220,150,A)');
    const warm = [8, 18, 28, 38, 48, 0, 355];
    for (let layer = 0; layer < 3; layer++) {
      const n = 14 + layer * 4, light = 70 - layer * 14;
      for (let i = 0; i < n; i++) { const x = t.rr(-50, W + 50), y = horizon + t.rr(-20, 40) + layer * 40, s = t.rr(180, 280) * (0.7 + layer * 0.3);
        rect(g, x - s * 0.04, y - s * 0.5, s * 0.08, s * 0.5 + 80, hsl(25, 35, 30 - layer * 6));
        for (let k = 0; k < 26; k++) { const a = t.rr(0, TAU), d = t.rr(0, s * 0.38);
          circle(g, x + Math.cos(a) * d, y - s * 0.75 + Math.sin(a) * d * 0.85, t.rr(s * 0.06, s * 0.13), hsl(t.pick(warm), t.rr(70, 90), t.rr(light - 12, light))); } }
    }
    g.fillStyle = vgrad(g, horizon + 80, H, ['#bc6c25', '#9c4f1c', '#6f3a12']); g.fillRect(0, horizon + 80, W, H);
    // winding path
    g.fillStyle = '#e6ccb2'; g.beginPath(); g.moveTo(W * 0.48, horizon + 80);
    g.bezierCurveTo(W * 0.3, H * 0.75, W * 0.75, H * 0.8, W * 0.35, H); g.lineTo(W * 0.85, H);
    g.bezierCurveTo(W * 0.95, H * 0.8, W * 0.5, H * 0.75, W * 0.53, horizon + 80); g.closePath(); g.fill();
    // big trunks in front
    for (let i = 0; i < 5; i++) { const x = t.pick([t.rr(0, W * 0.3), t.rr(W * 0.75, W)]), w = t.rr(40, 80);
      rect(g, x, 0, w, H * 0.85, '#5e3a1a'); for (let k = 0; k < 18; k++) rect(g, x + t.rr(4, w - 10), t.rr(0, H * 0.8), 4, t.rr(30, 90), '#3f2410'); }
    // fallen leaves everywhere
    for (let i = 0; i < 1400; i++) { const y = t.rr(horizon + 80, H), k = (y - horizon) / (H - horizon);
      ellipse(g, t.rr(0, W), y, (4 + 9 * k) * t.rr(0.8, 1.3), (2.5 + 5 * k), t.rr(0, TAU), hsl(t.pick(warm), t.rr(70, 95), t.rr(40, 62))); }
    for (let i = 0; i < 70; i++) ellipse(g, t.rr(0, W), t.rr(0, H * 0.8), t.rr(7, 12), t.rr(4, 6), t.rr(0, TAU), hsl(t.pick(warm), 90, t.rr(45, 60)));
    // pumpkins & mushrooms
    for (let i = 0; i < 6; i++) { const x = t.rr(80, W - 80), y = t.rr(H * 0.8, H - 30), s = t.rr(28, 50);
      for (let k = -2; k <= 2; k++) ellipse(g, x + k * s * 0.35, y, s * 0.45, s * 0.6, 0, hsl(28, 90, 50 - Math.abs(k) * 4));
      rect(g, x - 4, y - s * 0.75, 8, s * 0.3, '#386641'); }
    for (let i = 0; i < 10; i++) { const x = t.rr(50, W - 50), y = t.rr(H * 0.72, H - 20), s = t.rr(14, 26);
      rect(g, x - s * 0.2, y - s * 0.8, s * 0.4, s * 0.8, '#fefae0');
      g.fillStyle = '#d00000'; g.beginPath(); g.arc(x, y - s * 0.75, s * 0.75, Math.PI, 0); g.fill();
      for (let k = 0; k < 4; k++) circle(g, x + t.rr(-s * 0.5, s * 0.5), y - s * t.rr(0.9, 1.3), s * 0.1, '#ffffff'); }
  },

  quilt(g, W, H, t) {
    const pal = t.pick([
      ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703', '#fb8500'],
      ['#ff8fab', '#fb6f92', '#ffe5ec', '#8ecae6', '#219ebc', '#ffb703', '#90be6d'],
      ['#9b2226', '#ae2012', '#ee9b00', '#e9d8a6', '#94d2bd', '#0a9396', '#005f73'],
      ['#6d597a', '#b56576', '#e56b6f', '#eaac8b', '#ffd6a5', '#caffbf', '#9bf6ff'],
    ]);
    rect(g, 0, 0, W, H, '#fdf0d5');
    const cols = 8, rows = 6, m = 30, cw = (W - 2 * m) / cols, ch = (H - 2 * m) / rows;
    // border
    for (let x = 0; x < W; x += 40) { rect(g, x, 0, 20, m, pal[0]); rect(g, x + 20, H - m, 20, m, pal[0]); }
    for (let y = 0; y < H; y += 40) { rect(g, 0, y, m, 20, pal[4]); rect(g, W - m, y + 20, m, 20, pal[4]); }
    const patterns = ['dots', 'stripes', 'gingham', 'triangles', 'flowers', 'star', 'hearts', 'logcabin', 'scallop', 'diamonds'];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = m + c * cw, y = m + r * ch, bg = t.pick(pal); let fg = t.pick(pal); if (fg === bg) fg = '#ffffff';
      g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip();
      rect(g, x, y, cw, ch, bg);
      const p = t.pick(patterns);
      if (p === 'dots') for (let yy = y + 12; yy < y + ch; yy += 26) for (let xx = x + 12 + ((yy - y) / 26 % 2) * 13; xx < x + cw; xx += 26) circle(g, xx, yy, 6, fg);
      if (p === 'stripes') { g.strokeStyle = fg; g.lineWidth = 9; for (let k = -ch; k < cw + ch; k += 24) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k - ch, y + ch); g.stroke(); } }
      if (p === 'gingham') { g.fillStyle = fg; g.globalAlpha = 0.55; for (let k = 0; k < cw; k += 28) g.fillRect(x + k, y, 14, ch); for (let k = 0; k < ch; k += 28) g.fillRect(x, y + k, cw, 14); g.globalAlpha = 1; }
      if (p === 'triangles') { const n = 3, sw = cw / n, sh = ch / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) poly(g, [[x + i * sw, y + j * sh], [x + (i + 1) * sw, y + j * sh], [x + i * sw, y + (j + 1) * sh]], (i + j) % 2 ? fg : t.pick(pal)); }
      if (p === 'flowers') for (let k = 0; k < 9; k++) flower(g, x + t.rr(15, cw - 15), y + t.rr(15, ch - 15), t.rr(10, 16), fg, '#ffd23f', 5, t.rr(0, 3));
      if (p === 'star') { const cx = x + cw / 2, cy = y + ch / 2, R1 = Math.min(cw, ch) * 0.42; const pts = [];
        for (let k = 0; k < 16; k++) { const rr = k % 2 ? R1 * 0.45 : R1, a = k * TAU / 16 - Math.PI / 2; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } poly(g, pts, fg); circle(g, cx, cy, R1 * 0.25, t.pick(pal)); }
      if (p === 'hearts') for (let yy = y + 24; yy < y + ch; yy += 44) for (let xx = x + 24; xx < x + cw; xx += 44) {
        g.fillStyle = fg; g.beginPath(); g.moveTo(xx, yy + 10); g.bezierCurveTo(xx - 18, yy - 4, xx - 8, yy - 16, xx, yy - 6); g.bezierCurveTo(xx + 8, yy - 16, xx + 18, yy - 4, xx, yy + 10); g.fill(); }
      if (p === 'logcabin') for (let k = 0; k < 5; k++) { const ix = k * cw / 11, iy = k * ch / 11; rect(g, x + ix, y + iy, cw - 2 * ix, ch - 2 * iy, k % 2 ? fg : t.pick(pal)); }
      if (p === 'scallop') for (let yy = y; yy < y + ch + 20; yy += 22) for (let xx = x + ((yy - y) / 22 % 2) * 14; xx < x + cw + 20; xx += 28) { g.fillStyle = fg; g.beginPath(); g.arc(xx, yy, 14, 0, Math.PI); g.fill(); }
      if (p === 'diamonds') for (let yy = y; yy < y + ch + 30; yy += 36) for (let xx = x + ((yy - y) / 36 % 2) * 22; xx < x + cw + 30; xx += 44) poly(g, [[xx, yy - 16], [xx + 14, yy], [xx, yy + 16], [xx - 14, yy]], fg);
      g.restore();
      g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.strokeRect(x + 8, y + 8, cw - 16, ch - 16); g.setLineDash([]);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(x, y, cw, ch);
    }
  },

  night(g, W, H, t) {
    const snowy = t.R() < 0.5, horizon = H * 0.62;
    g.fillStyle = vgrad(g, 0, horizon, ['#03045e', '#1b263b', '#3a0ca3', '#7209b7']); g.fillRect(0, 0, W, horizon);
    for (let i = 0; i < 420; i++) circle(g, t.rr(0, W), t.rr(0, horizon), t.rr(0.6, 2.6), `rgba(255,255,${t.ri(200, 255)},${t.rr(0.4, 1).toFixed(2)})`);
    for (let i = 0; i < 12; i++) { const x = t.rr(0, W), y = t.rr(20, horizon * 0.6); g.strokeStyle = '#fffbe6'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke(); circle(g, x, y, 3, '#fff'); }
    const mx = t.rr(200, 1400), my = t.rr(110, 220);
    sun(g, mx, my, 70, '#fdf0c2', 'rgba(253,240,194,A)');
    circle(g, mx - 20, my - 15, 14, '#efe3b0'); circle(g, mx + 24, my + 18, 10, '#efe3b0'); circle(g, mx + 10, my - 30, 7, '#efe3b0');
    fillUnder(g, peaks(t, W, horizon - 30, 140, 0.55, 6), H, '#22223b');
    fillUnder(g, peaks(t, W, horizon + 10, 70, 0.5, 6), H, snowy ? '#cdd7f0' : '#283618');
    const walls = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#8ab17d', '#b5838d', '#6d6875', '#f28482', '#84a59d'];
    // church
    const chx = t.rr(500, 1100), chy = horizon + 40;
    rect(g, chx, chy - 200, 150, 200, '#e0e1dd'); poly(g, [[chx - 10, chy - 200], [chx + 75, chy - 270], [chx + 160, chy - 200]], '#495057');
    rect(g, chx + 45, chy - 420, 60, 230, '#e0e1dd'); poly(g, [[chx + 38, chy - 420], [chx + 75, chy - 540], [chx + 112, chy - 420]], '#495057');
    circle(g, chx + 75, chy - 360, 18, '#ffd166'); rect(g, chx + 55, chy - 120, 40, 120, '#ffb703');
    for (const k of [0, 1]) rect(g, chx + 20 + k * 90, chy - 170, 20, 50, '#ffd166');
    // two rows of houses
    for (let row = 0; row < 2; row++) {
      const y = horizon + 70 + row * 150, s = 0.85 + row * 0.35; let x = t.rr(-80, 0);
      while (x < W) { const w = t.rr(110, 180) * s, h = t.rr(110, 160) * s;
        if (row === 0 && x + w > chx - 10 && x < chx + 170) { x += w + 10; continue; }
        house(g, t, x, y, w, h, t.pick(walls), t.pick(['#3d405b', '#6b2737', '#264653', '#5f0f40']), { lit: true, door: '#3d2c2e' });
        if (snowy) poly(g, [[x - w * 0.1, y - h], [x + w / 2, y - h - h * 0.55], [x + w * 1.1, y - h], [x + w / 2, y - h - h * 0.45]], '#f1f5ff');
        x += w + t.rr(8, 30); }
      for (let i = 0; i < 8; i++) pine(g, t.rr(0, W), y + 10, t.rr(70, 120) * s, '#1b4332', '#2d6a4f');
    }
    // street lamps & ground
    g.fillStyle = snowy ? vgrad(g, horizon + 230, H, ['#dfe7fd', '#b8c7f0']) : vgrad(g, horizon + 230, H, ['#344e41', '#1b2a1f']);
    g.fillRect(0, horizon + 230, W, H);
    for (let i = 0; i < 6; i++) { const x = 100 + i * (W - 200) / 5, y = H - 40;
      rect(g, x - 5, y - 200, 10, 200, '#212529'); circle(g, x, y - 210, 60, 'rgba(255,214,102,0.18)'); circle(g, x, y - 210, 22, '#ffd166'); }
    if (snowy) { for (let i = 0; i < 700; i++) circle(g, t.rr(0, W), t.rr(0, H), t.rr(1.5, 4.5), `rgba(255,255,255,${t.rr(0.5, 0.95).toFixed(2)})`); }
    else { for (let i = 0; i < 160; i++) circle(g, t.rr(0, W), t.rr(horizon + 200, H), t.rr(2, 4), 'rgba(220,255,120,0.9)'); }
  },

  tulips(g, W, H, t) {
    const horizon = H * 0.4;
    g.fillStyle = vgrad(g, 0, horizon, ['#4ea8de', '#90dbf4', '#e9f5db']); g.fillRect(0, 0, W, horizon);
    for (let i = 0; i < 6; i++) cloud(g, t, t.rr(0, W), t.rr(50, 230), t.rr(90, 170));
    fillUnder(g, peaks(t, W, horizon, 40, 0.5, 6), H, '#6a994e');
    for (let i = 0; i < 22; i++) roundTree(g, t, t.rr(0, W), horizon + 5, t.rr(60, 100), [100, 120, 140]);
    // windmill
    const wx = t.rr(250, 1350), wy = horizon + 10;
    poly(g, [[wx - 50, wy], [wx + 50, wy], [wx + 28, wy - 210], [wx - 28, wy - 210]], '#8d5524');
    poly(g, [[wx - 36, wy - 205], [wx + 36, wy - 205], [wx, wy - 255]], '#3d405b');
    rect(g, wx - 14, wy - 50, 28, 50, '#3d2c2e'); rect(g, wx - 10, wy - 140, 20, 22, '#fefae0');
    const rot = t.rr(0, Math.PI / 2);
    for (let k = 0; k < 4; k++) { g.save(); g.translate(wx, wy - 210); g.rotate(rot + k * Math.PI / 2);
      rect(g, -5, 0, 10, 190, '#5c4033'); rect(g, 6, 30, 42, 160, '#fdfcdc');
      g.strokeStyle = '#5c4033'; g.lineWidth = 3; for (let j = 0; j < 6; j++) { g.beginPath(); g.moveTo(6, 40 + j * 26); g.lineTo(48, 40 + j * 26); g.stroke(); }
      g.restore(); }
    circle(g, wx, wy - 210, 12, '#3d2c2e');
    // farmhouse
    house(g, t, Math.min(W - 260, wx + 220), horizon + 25, 200, 110, '#ffffff', '#9b2226', {});
    // converging stripes of tulips
    const vpX = W / 2, vpY = horizon - 160, cols = ['#e63946', '#ffbe0b', '#ff8fab', '#7b2cbf', '#fb5607', '#ffffff', '#d00000', '#f15bb5'];
    const n = 16, y0 = horizon + 40;
    g.fillStyle = vgrad(g, y0, H, ['#6b4f2a', '#4a3520']); g.fillRect(0, y0, W, H);
    const xAt = (i, y) => vpX + (i / n * W * 3 - W * 1.5 + W / n * 1.5) * (y - vpY) / (H - vpY);
    for (let i = 0; i < n; i++) { const c = cols[(i + t.ri(0, 7)) % cols.length];
      const pts = [[xAt(i, y0), y0], [xAt(i + 0.8, y0), y0], [xAt(i + 0.8, H), H], [xAt(i, H), H]];
      poly(g, pts, '#4f772d');
      for (let r = 0; r < 40; r++) { const y = y0 + Math.pow(r / 40, 1.7) * (H - y0), k = (y - vpY) / (H - vpY), xa = xAt(i, y), xb = xAt(i + 0.8, y);
        const sz = 3 + k * 14; for (let x = xa + sz; x < xb - sz * 0.5; x += sz * 1.6) {
          ellipse(g, x + t.rr(-1, 1) * sz * 0.2, y, sz * 0.55, sz * 0.8, 0, c);
          if (sz > 8) { rect(g, x - 1, y + sz * 0.5, 2, sz, '#2d6a4f'); poly(g, [[x - sz * 0.55, y - sz * 0.2], [x - sz * 0.3, y - sz * 1.05], [x, y - sz * 0.4]], c); poly(g, [[x + sz * 0.55, y - sz * 0.2], [x + sz * 0.3, y - sz * 1.05], [x, y - sz * 0.4]], c); } } }
    }
  },

  birds(g, W, H, t) {
    const base = t.pick([['#caf0f8', '#ade8f4'], ['#fde2e4', '#fad2e1'], ['#e2ece9', '#bee1e6'], ['#fff1e6', '#fde2e4']]);
    g.fillStyle = vgrad(g, 0, H, [base[0], base[1]]); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) circle(g, t.rr(0, W), t.rr(0, H), t.rr(20, 90), hsl(t.pick([340, 200, 50, 120, 280, 20]), 70, t.rr(75, 88), t.rr(0.3, 0.6)));
    // branches
    const branches = [];
    const main = [[-40, H * t.rr(0.55, 0.7)], [W * 0.3, H * t.rr(0.5, 0.65)], [W * 0.65, H * t.rr(0.45, 0.6)], [W + 40, H * t.rr(0.4, 0.55)]];
    const drawBranch = (pts, wdt) => { g.strokeStyle = '#5e3a1a'; g.lineCap = 'round'; g.lineJoin = 'round';
      for (let k = 0; k < pts.length - 1; k++) { g.lineWidth = wdt * (1 - k / pts.length * 0.6); g.beginPath(); g.moveTo(...pts[k]); g.lineTo(...pts[k + 1]); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = wdt * 0.2; g.beginPath(); g.moveTo(pts[0][0], pts[0][1] - wdt * 0.25); for (const p of pts) g.lineTo(p[0], p[1] - wdt * 0.25); g.stroke(); };
    drawBranch(main, 38); branches.push(main);
    const upper = [[W + 40, H * t.rr(0.12, 0.22)], [W * 0.7, H * t.rr(0.22, 0.3)], [W * 0.4, H * t.rr(0.2, 0.3)], [W * 0.12, H * t.rr(0.08, 0.18)]];
    drawBranch(upper, 30); branches.push(upper);
    for (let i = 0; i < 10; i++) { const src = i % 2 ? upper : main, k = t.ri(0, 2), a = src[k], b = src[k + 1], f = t.rr(0.1, 0.9);
      const sx = a[0] + (b[0] - a[0]) * f, sy = a[1] + (b[1] - a[1]) * f, up = t.R() < 0.6 ? -1 : 1;
      const tw = [[sx, sy], [sx + t.rr(60, 160), sy + up * t.rr(60, 140)], [sx + t.rr(160, 300), sy + up * t.rr(100, 260)]];
      drawBranch(tw, 16); branches.push(tw); }
    // blossoms & leaves along every branch
    const petals = t.pick([['#ffafcc', '#ffc8dd', '#ffffff'], ['#ffffff', '#fff0f3', '#ffccd5'], ['#ff8fab', '#fb6f92', '#ffe5ec']]);
    for (const br of branches) for (let k = 0; k < br.length - 1; k++) { const [ax, ay] = br[k], [bx, by] = br[k + 1];
      for (let j = 0; j < 34; j++) { const f = t.R(), x = ax + (bx - ax) * f + t.rr(-34, 34), y = ay + (by - ay) * f + t.rr(-34, 34);
        if (t.R() < 0.35) ellipse(g, x, y, 22, 9, t.rr(0, TAU), hsl(t.rr(95, 130), 50, t.rr(35, 50)));
        else flower(g, x, y, t.rr(14, 24), t.pick(petals), '#ffbe0b', 5, t.rr(0, TAU)); } }
    // birds perched on the main branch
    const species = [
      { back: '#6f4e37', belly: '#f77f00', head: '#6f4e37' },          // robin
      { back: '#1e6fd9', belly: '#f4a261', head: '#1e6fd9' },          // bluebird
      { back: '#ffd000', belly: '#ffea00', head: '#111111' },          // goldfinch
      { back: '#d00000', belly: '#e5383b', head: '#d00000' },          // cardinal
      { back: '#8d99ae', belly: '#f8f9fa', head: '#111111' },          // chickadee
    ];
    const perches = [];
    for (const [br, nb] of [[main, t.ri(3, 4)], [upper, t.ri(2, 3)]]) for (let i = 0; i < nb; i++) perches.push([br, (i + t.rr(0.3, 0.7)) / nb]);
    for (let i = 0; i < perches.length; i++) {
      const [br, f] = perches[i], seg = Math.min(2, Math.floor(f * 3)), lf = f * 3 - seg, a = br[seg], b = br[seg + 1];
      const x = a[0] + (b[0] - a[0]) * lf, y = a[1] + (b[1] - a[1]) * lf - 20, s = t.rr(80, 110), sp = species[(i + t.ri(0, 4)) % species.length], dir = t.R() < 0.5 ? -1 : 1;
      poly(g, [[x - dir * s * 0.7, y - s * 0.1], [x - dir * s * 1.5, y + s * 0.4], [x - dir * s * 1.3, y + s * 0.6]], sp.back);
      ellipse(g, x, y - s * 0.4, s * 0.85, s * 0.7, 0, sp.back);
      ellipse(g, x + dir * s * 0.2, y - s * 0.25, s * 0.55, s * 0.5, 0, sp.belly);
      ellipse(g, x - dir * s * 0.2, y - s * 0.45, s * 0.55, s * 0.35, dir * 0.4, 'rgba(0,0,0,0.2)');
      circle(g, x + dir * s * 0.55, y - s * 0.95, s * 0.42, sp.head);
      if (sp === species[4]) ellipse(g, x + dir * s * 0.6, y - s * 0.85, s * 0.25, s * 0.16, 0, '#ffffff');
      circle(g, x + dir * s * 0.7, y - s * 1.02, s * 0.08, '#ffffff'); circle(g, x + dir * s * 0.72, y - s * 1.02, s * 0.05, '#111');
      poly(g, [[x + dir * s * 0.9, y - s * 0.98], [x + dir * s * 1.18, y - s * 0.9], [x + dir * s * 0.9, y - s * 0.84]], '#f4a261');
      g.strokeStyle = '#3d2c2e'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 8, y + s * 0.2); g.lineTo(x - 10, y + s * 0.42); g.moveTo(x + 8, y + s * 0.2); g.lineTo(x + 10, y + s * 0.42); g.stroke();
    }
  },
};
