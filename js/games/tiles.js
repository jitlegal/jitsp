// Tile Match — an original tile-matching solitaire plug-in for the family games shell (see GAMES.md).
// Remove matching pairs of free tiles (nothing on top, and an open left or right side).
// Every deal is built by reverse play (pairs placed onto free spots), so it can always be cleared.
// Keyboard: arrows move among free tiles, Enter/Space picks, H help, U undo, S shuffle, Esc puts back.

const SVGNS = 'http://www.w3.org/2000/svg';
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shuffle = (arr, r) => { for (let i = arr.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const derive = (seed, i) => (Math.imul((seed ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0, 0x85EBCA6B) >>> 1);

// ───────────── faces (34): 3 suits × 1–9, 4 compass arrows, sun, moon, cloud ─────────────
const f1 = n => +n.toFixed(1);
const circ = (cx, cy, r) => `M${f1(cx - r)},${f1(cy)}a${r},${r} 0 1,0 ${f1(2 * r)},0a${r},${r} 0 1,0 ${f1(-2 * r)},0Z`;
const polar = (cx, cy, r, deg) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)];
const poly = pts => 'M' + pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L') + 'Z';
const STAR = poly(Array.from({ length: 10 }, (_, k) => polar(50, 54, k % 2 ? 20 : 47, k * 36)));
const RING = circ(50, 50, 46) + circ(50, 50, 29) + circ(50, 50, 12);
const BAMBOO = 'M40,4h20v26h-20zM34,30h32v8h-32zM40,38h20v24h-20zM34,62h32v8h-32zM40,70h20v26h-20z';
const ARROW = 'M50,4L92,50L64,50L64,96L36,96L36,50L8,50Z';
const SUN = circ(50, 50, 22) + Array.from({ length: 8 }, (_, k) => poly([polar(50, 50, 48, k * 45), polar(50, 50, 29, k * 45 - 14), polar(50, 50, 29, k * 45 + 14)])).join('');
const MOON = 'M66,6A44,44 0 0,0 66,94A24,44 0 0,1 66,6Z';
const CLOUD = circ(30, 62, 18) + circ(52, 48, 25) + circ(74, 60, 20) + 'M30,62V80H74V62Z';
const INK = ['#1558b0', '#1b6e2a', '#b3261e', '#1f1f1f', '#b33c00', '#283593', '#37474f'];
const SUIT = ['Circle', 'Bamboo', 'Star'], SUITSYM = [RING, BAMBOO, STAR];
const FACES = [];
for (let s = 0; s < 3; s++) for (let n = 1; n <= 9; n++) FACES.push({ name: `${SUIT[s]} ${n}`, num: String(n), d: SUITSYM[s], k: s, eo: s === 0, box: [13, 42, 34] });
['North', 'East', 'South', 'West'].forEach((w, i) => FACES.push({ name: `${w} arrow`, num: w[0], d: ARROW, rot: i * 90, k: 3, box: [15, 43, 31] }));
FACES.push({ name: 'Sun', d: SUN, k: 4, box: [6, 16, 48] }, { name: 'Moon', d: MOON, k: 5, box: [6, 16, 48] }, { name: 'Cloud', d: CLOUD, k: 6, box: [4, 14, 52] });
const NF = FACES.length; // 34

// ───────────── layouts (half-tile units; x,y step 2 = one tile; z = layer) ─────────────
function rows(z, ys, x0, n, out) { for (const y of ys) for (let i = 0; i < n; i++) out.push([x0 + 2 * i, y, z]); return out; }
const LAYOUTS = {
  gentle: { name: 'Gentle', build() { const P = []; rows(0, [0, 10], 2, 6, P); rows(0, [2, 4, 6, 8], 0, 8, P); rows(1, [2, 4, 6, 8], 1, 7, P); return P; } },          // 72, 2 layers
  classic: { name: 'Classic', build() { const P = []; rows(0, [0, 2, 4, 6, 8, 10], 0, 10, P); rows(1, [2, 4, 6, 8], 2, 8, P); rows(2, [3, 5, 7], 4, 6, P); rows(3, [4, 6], 5, 5, P); return P; } }, // 120, 4 layers
  tower: { name: 'Tower', build() { const P = []; for (let z = 0; z < 6; z++) rows(z, Array.from({ length: 7 - z }, (_, k) => z + 2 * k), z, 6 - z, P); return P; } },          // 112, 6 layers
};
const layoutCache = {};
function layout(id) {
  if (layoutCache[id]) return layoutCache[id];
  const P = LAYOUTS[id].build().map(([x, y, z]) => ({ x, y, z })), n = P.length;
  const ov = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  const above = [], below = [], left = [], right = [];
  for (let i = 0; i < n; i++) {
    above[i] = []; below[i] = []; left[i] = []; right[i] = [];
    for (let j = 0; j < n; j++) if (i !== j) {
      const a = P[i], b = P[j];
      if (b.z > a.z && ov(a, b)) above[i].push(j);
      if (b.z < a.z && ov(a, b)) below[i].push(j);
      if (b.z === a.z && Math.abs(b.y - a.y) < 2) { if (b.x === a.x - 2) left[i].push(j); if (b.x === a.x + 2) right[i].push(j); }
    }
  }
  const xs = P.map(p => p.x), ys = P.map(p => p.y);
  return layoutCache[id] = { id, P, n, above, below, left, right, minX: Math.min(...xs), maxX: Math.max(...xs) + 2, minY: Math.min(...ys), maxY: Math.max(...ys) + 2, maxZ: Math.max(...P.map(p => p.z)) };
}
const none = (L, has, list) => list.every(j => !has[j]);
const isFree = (L, has, i) => has[i] && none(L, has, L.above[i]) && (none(L, has, L.left[i]) || none(L, has, L.right[i]));
/** Reverse play over the positions in `target`: returns pairs in removal order, or null. */
function reversePlay(L, target, r) {
  const want = target.reduce((a, b) => a + b, 0);
  for (let t = 0; t < 200; t++) {
    const has = new Uint8Array(L.n), pairs = []; let placed = 0, ok = true;
    const cands = () => { const c = []; for (let i = 0; i < L.n; i++) if (target[i] && !has[i] && L.below[i].every(j => !target[j] || has[j])) {
      const rowHas = [...L.left[i], ...L.right[i]].some(j => has[j]);
      // keep each row a single unbroken run, so no gap ever gets trapped between two tiles
      let rowEmpty = true; for (let j = 0; j < L.n; j++) if (has[j] && L.P[j].z === L.P[i].z && L.P[j].y === L.P[i].y) { rowEmpty = false; break; }
      if (rowHas || rowEmpty) c.push(i); } return c; };
    while (placed < want) {
      let found = null;
      for (const a of shuffle(cands(), r)) {
        has[a] = 1;
        for (const b of shuffle(cands(), r)) { has[b] = 1; if (isFree(L, has, a) && isFree(L, has, b)) { found = [a, b]; break; } has[b] = 0; }
        if (found) break; has[a] = 0;
      }
      if (!found) { ok = false; break; }
      pairs.push(found); placed += 2;
    }
    if (ok) return pairs.reverse();
  }
  return null;
}
const dealCache = new Map();
function deal(seed, lid) {
  const key = seed + ':' + lid; if (dealCache.has(key)) return dealCache.get(key);
  const L = layout(lid), r = rng(seed ^ 0x711E5), pairs = reversePlay(L, new Uint8Array(L.n).fill(1), r), np = L.n / 2;
  let kinds = [];
  if (lid === 'gentle') { const pick = shuffle([...Array(NF).keys()], r).slice(0, np / 2); kinds = [...pick, ...pick]; }
  else while (kinds.length < np) kinds.push(...shuffle([...Array(NF).keys()], r));
  kinds = shuffle(kinds.slice(0, np), r);
  const F = new Int8Array(L.n).fill(-1);
  pairs.forEach(([a, b], k) => { F[a] = kinds[k]; F[b] = kinds[k]; });
  const out = { F, plan: pairs };
  if (dealCache.size > 8) dealCache.delete(dealCache.keys().next().value);
  dealCache.set(key, out); return out;
}
/** Re-deal the remaining tiles (same faces) onto the same spots by reverse play; keeps the game winnable. */
function redeal(L, F, r) {
  const target = Uint8Array.from(F, f => f >= 0 ? 1 : 0), pairs = reversePlay(L, target, r);
  if (!pairs) return null;
  const byFace = new Map(); for (const f of F) if (f >= 0) byFace.set(f, (byFace.get(f) || 0) + 1);
  const kinds = []; for (const [f, c] of byFace) for (let k = 0; k < c / 2; k++) kinds.push(f);
  shuffle(kinds, r);
  const G = new Int8Array(L.n).fill(-1); pairs.forEach(([a, b], k) => { G[a] = kinds[k]; G[b] = kinds[k]; });
  return { F: G, plan: pairs };
}
/** Independent depth-first solver (used by tests and as a Help fallback). Returns removal pairs or null. */
function solve(L, F0, budget = 100000) {
  const F = Int8Array.from(F0), has = Uint8Array.from(F, f => f >= 0 ? 1 : 0), seen = new Set(), path = []; let left = has.reduce((a, b) => a + b, 0), nodes = 0;
  const cnt = new Int16Array(NF); for (const f of F) if (f >= 0) cnt[f]++;
  const go = () => {
    if (!left) return true; if (++nodes > budget) return false;
    const key = String.fromCharCode(...Array.from({ length: Math.ceil(L.n / 15) }, (_, k) => { let v = 0; for (let b = 0; b < 15; b++) v = v * 2 + (has[k * 15 + b] || 0); return v + 1; }));
    if (seen.has(key)) return false; seen.add(key);
    const free = new Map(); for (let i = 0; i < L.n; i++) if (isFree(L, has, i)) { const f = F[i]; if (!free.has(f)) free.set(f, []); free.get(f).push(i); }
    const moves = [];
    for (const [f, list] of free) {
      if (list.length < 2) continue;
      if (list.length === cnt[f]) { moves.length = 0; moves.push([list[0], list[1]]); break; }    // all of this face free: always safe
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) moves.push([list[a], list[b]]);
    }
    const sc = i => L.P[i].z * 3 + L.below[i].length + L.left[i].length + L.right[i].length;
    moves.sort((m, n) => sc(n[0]) + sc(n[1]) - sc(m[0]) - sc(m[1]));
    for (const [a, b] of moves) {
      const f = F[a]; has[a] = has[b] = 0; left -= 2; cnt[f] -= 2; path.push([a, b]);
      if (go()) return true;
      has[a] = has[b] = 1; left += 2; cnt[f] += 2; path.pop();
    }
    return false;
  };
  return go() ? path : null;
}
const enc = F => Array.from(F, f => f < 0 ? '.' : String.fromCharCode(48 + f)).join('');
const dec = (s, n) => { if (typeof s !== 'string' || s.length !== n || !/^[.0-Q]*$/.test(s)) return null; return Int8Array.from(s, c => c === '.' ? -1 : c.charCodeAt(0) - 48); };

// ───────────── drawing ─────────────
const faceTpl = [];
function faceSVG(f) {
  if (!faceTpl[f]) {
    const F = FACES[f], svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 60 80'); svg.setAttribute('class', 'tm-face'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    if (F.num) { const t = document.createElementNS(SVGNS, 'text'); t.setAttribute('x', '30'); t.setAttribute('y', F.k === 3 ? '36' : '38'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', INK[F.k]); t.setAttribute('class', 'tm-num'); t.textContent = F.num; svg.append(t); }
    const g = document.createElementNS(SVGNS, 'g'), [bx, by, bs] = F.box;
    g.setAttribute('transform', `translate(${bx} ${by}) scale(${bs / 100})`);
    const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', F.d); p.setAttribute('fill', INK[F.k]); p.setAttribute('class', 'f');
    if (F.eo) p.setAttribute('fill-rule', 'evenodd');
    if (F.rot) p.setAttribute('transform', `rotate(${F.rot} 50 50)`);
    g.append(p); svg.append(g); faceTpl[f] = svg;
  }
  return faceTpl[f].cloneNode(true);
}
function drawTile(g, f, x, y, w, h) {
  const e = w * 0.07;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.roundRect(x + e + 2, y + e + 3, w, h, w * 0.12); g.fill();
  g.fillStyle = '#c9b182'; g.beginPath(); g.roundRect(x + e, y + e, w, h, w * 0.12); g.fill();
  g.fillStyle = '#fffaf0'; g.strokeStyle = '#7a6a4f'; g.lineWidth = 2; g.beginPath(); g.roundRect(x, y, w, h, w * 0.12); g.fill(); g.stroke();
  const F = FACES[f]; g.save(); g.translate(x, y); g.scale(w / 60, h / 80); g.fillStyle = INK[F.k];
  if (F.num) { g.font = '700 36px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(F.num, 30, F.k === 3 ? 36 : 38); }
  const [bx, by, bs] = F.box; g.translate(bx, by); g.scale(bs / 100, bs / 100);
  if (F.rot) { g.translate(50, 50); g.rotate(F.rot * Math.PI / 180); g.translate(-50, -50); }
  g.fill(new Path2D(F.d), F.eo ? 'evenodd' : 'nonzero'); g.restore();
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

// ───────────── the game ─────────────
let instances = 0;
class Tiles {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `tm${++instances}`;
    this.sel = -1; this.hint = null; this.hist = []; this.hints = 0; this.shuffles = 0; this._completed = false; this.focusI = -1;
    const root = this.root = document.createElement('div'); root.className = 'tm';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Tile Match table');
    const help = document.createElement('p'); help.className = 'tm-sr'; help.id = `${this.ns}-keys`;
    help.textContent = 'Tile Match. Take away matching pairs of free tiles. A tile is free when nothing lies on it and its left or right side is open. ' +
      'Arrow keys move between free tiles, Enter or Space picks a tile, H helps, U undoes, S shuffles the tiles that are left, Escape puts a tile back.';
    root.setAttribute('aria-describedby', help.id); root.append(help);
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'tm-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); root.append(this.live); }
    this.board = document.createElement('div'); this.board.className = 'tm-board'; root.append(this.board);
    this.msgEl = document.createElement('div'); this.msgEl.className = 'tm-msg'; this.msgEl.setAttribute('aria-hidden', 'true'); root.append(this.msgEl);
    const stuck = this.stuckEl = document.createElement('div'); stuck.className = 'tm-stuck'; stuck.setAttribute('role', 'group'); stuck.setAttribute('aria-label', 'No pairs left');
    const sp = document.createElement('p'); sp.textContent = 'No matching pairs are free right now.';
    const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'tm-btn'; b1.textContent = '🔀 Shuffle the tiles'; b1.addEventListener('click', () => this.shuffle());
    const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'tm-btn'; b2.textContent = '↩️ Undo'; b2.addEventListener('click', () => this.undo());
    stuck.append(sp, b1, b2); this.shuffleBtn = b1; root.append(stuck);
    host.append(root);
    this._bind();
  }
  async load(recipe, { state } = {}) {
    this.recipe = recipe; this.L = layout(recipe.l);
    const D = deal(recipe.s, recipe.l); this.total = this.L.n / 2;
    const st = state ? this._fromState(state, D) : null;
    if (st) { this.F = st.F; this.hist = st.hist; this.hints = st.hints; this.shuffles = st.shuffles; this.plan = null; }
    else { this.F = Int8Array.from(D.F); this.hist = []; this.hints = 0; this.shuffles = 0; this.plan = D.plan; }
    this.root.classList.toggle('hints', recipe.h !== 0);
    this.board.replaceChildren(); this.el = [];
    const order = [...Array(this.L.n).keys()].sort((a, b) => this.L.P[a].y - this.L.P[b].y || this.L.P[a].x - this.L.P[b].x || this.L.P[b].z - this.L.P[a].z);
    for (const i of order) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tm-tile'; b.dataset.i = i; b.tabIndex = -1;
      const p = this.L.P[i]; b.style.zIndex = String(p.z * 1000 + p.y * 30 + p.x + 1);
      this.el[i] = b; this.board.append(b);
    }
    this._completed = this.done; this.sel = -1; this.hint = null;
    this.hooks.onZoomable?.(false);
    this._layout(); this._render();
    this._progress();
  }
  state() { return { v: 1, t: enc(this.F), h: this.hist.slice(-300), hi: this.hints, sh: this.shuffles }; }
  progress() { return { done: this.F ? (this.L.n - this._left()) / 2 : 0, total: this.total || 0 }; }
  get done() { return !!this.F && this._left() === 0; }
  stats() { return { hints: this.hints, shuffles: this.shuffles }; }
  resize() { if (this.F) { this._layout(); this._render(); } }
  destroy() { clearTimeout(this._msgT); clearTimeout(this._sayT); this._unbind?.(); this.root.remove(); }
  _left() { let n = 0; for (const f of this.F) if (f >= 0) n++; return n; }
  _fromState(st, D) {
    try {
      if (!st || typeof st !== 'object' || st.v !== 1) return null;
      const F = dec(st.t, this.L.n); if (!F) return null;
      const cnt = new Int16Array(NF), c0 = new Int16Array(NF);
      for (const f of D.F) if (f >= 0) c0[f]++;
      for (let i = 0; i < F.length; i++) if (F[i] >= 0) { if (F[i] >= NF) return null; cnt[F[i]]++; if (this.L.below[i].some(j => F[j] < 0)) return null; }
      for (let f = 0; f < NF; f++) if (cnt[f] % 2 || cnt[f] > c0[f]) return null;
      const hist = [];
      if (Array.isArray(st.h)) for (const e of st.h.slice(-300)) {
        if (Array.isArray(e) && e.length === 4 && e.every(x => Number.isInteger(x)) && e[0] >= 0 && e[0] < this.L.n && e[1] >= 0 && e[1] < this.L.n && e[0] !== e[1] && e[2] >= 0 && e[2] < NF && e[2] === e[3]) hist.push(e);
        else if (Array.isArray(e) && e.length === 1 && dec(e[0], this.L.n)) hist.push(e);
        else return null;
      }
      const num = x => Number.isInteger(x) && x >= 0 && x < 1e6 ? x : 0;
      return { F, hist, hints: num(st.hi), shuffles: num(st.sh) };
    } catch (_) { return null; }
  }

  // ───── layout & drawing ─────
  _layout() {
    const L = this.L, W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    const scale = Math.min(2, Math.max(1, parseFloat(getComputedStyle(this.host).getPropertyValue('--card-scale')) || 1));
    const m = 6, D = 0.12, E = 0.07, R = 1.3, sx = (L.maxX - L.minX) / 2, sy = (L.maxY - L.minY) / 2;
    const w = Math.max(20, Math.min((W - 2 * m) / (sx + L.maxZ * D + E), (H - 2 * m - 10) / (sy * R + L.maxZ * D + E), 110 * scale));
    const h = w * R, d = w * D, tw = sx * w + L.maxZ * d + w * E, th = sy * h + L.maxZ * d + w * E;
    const x0 = (W - tw) / 2, y0 = Math.max(m + 8, (H - th) / 2);
    this.G = { w, h, d };
    const st = this.root.style; st.setProperty('--tw', (w - 2) + 'px'); st.setProperty('--th', (h - 2) + 'px'); st.setProperty('--e', (w * E).toFixed(1) + 'px');
    this.pos = L.P.map(p => [x0 + (p.x - L.minX) * w / 2 + (L.maxZ - p.z) * d + 1, y0 + (p.y - L.minY) * h / 2 + (L.maxZ - p.z) * d + 1]);
    for (let i = 0; i < L.n; i++) { this.el[i].style.left = this.pos[i][0] + 'px'; this.el[i].style.top = this.pos[i][1] + 'px'; }
  }
  _has() { return Uint8Array.from(this.F, f => f >= 0 ? 1 : 0); }
  _status(has, i) { if (!has[i]) return 'gone'; if (!none(this.L, has, this.L.above[i])) return 'covered'; return isFree(this.L, has, i) ? 'free' : 'sides'; }
  _render(gone = []) {
    const has = this._has(), anim = !reducedMotion();
    if (this.focusI < 0 || !isFree(this.L, has, this.focusI)) this.focusI = this._nearestFree(this.focusI);
    for (let i = 0; i < this.L.n; i++) {
      const el = this.el[i], f = this.F[i], s = this._status(has, i);
      if (f < 0) {
        if (gone.includes(i) && anim) { el.classList.add('gone'); setTimeout(() => { if (this.F[i] < 0) el.classList.add('off'); }, 380); }
        else el.classList.add('gone', 'off');
        el.tabIndex = -1; el.setAttribute('aria-hidden', 'true'); continue;
      }
      el.classList.remove('gone', 'off'); el.removeAttribute('aria-hidden');
      if (el._f !== f) { el.replaceChildren(faceSVG(f)); el._f = f; }
      el.classList.toggle('free', s === 'free'); el.classList.toggle('blocked', s !== 'free');
      el.classList.toggle('sel', i === this.sel); el.classList.toggle('hint', !!this.hint && this.hint.includes(i));
      el.setAttribute('aria-label', `${FACES[f].name}, ${s === 'free' ? 'free' : s === 'covered' ? 'covered' : 'blocked on both sides'}${i === this.sel ? ', selected' : ''}`);
      if (s === 'free') el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled', 'true');
      el.tabIndex = i === this.focusI ? 0 : -1;
    }
    const stuck = this._left() > 0 && !this._freePair(has);
    this.stuckEl.classList.toggle('show', stuck);
    return stuck;
  }
  _nearestFree(from) {
    const has = this._has(); let best = -1, bd = Infinity;
    const c = from >= 0 && this.pos ? this.pos[from] : [0, 0];
    for (let i = 0; i < this.L.n; i++) if (isFree(this.L, has, i)) { const d = Math.hypot(this.pos[i][0] - c[0], this.pos[i][1] - c[1]); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  _freePair(has) {
    const seen = new Map();
    for (let i = 0; i < this.L.n; i++) if (isFree(this.L, has, i)) { const f = this.F[i]; if (seen.has(f)) return [seen.get(f), i]; seen.set(f, i); }
    return null;
  }
  _progress() { const { done, total } = this.progress(); this.hooks.onProgress?.(done, total); }
  _say(text, visual = false) {
    if (visual) { this.msgEl.textContent = text; this.msgEl.classList.add('show'); clearTimeout(this._msgT); this._msgT = setTimeout(() => this.msgEl.classList.remove('show'), 4000); }
    if (this.hooks.announce) { this.hooks.announce(text); return; }
    const r = this.live; r.textContent = ''; clearTimeout(this._sayT); this._sayT = setTimeout(() => { r.textContent = text; }, 40);
  }
  _shake(i) { const el = this.el[i]; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 500); }
  _focus(i) { if (i < 0) return; this.focusI = i; for (const el of this.el) el.tabIndex = -1; this.el[i].tabIndex = 0; this.el[i].focus({ preventScroll: true }); }

  // ───── moves ─────
  _tap(i) {
    if (this.done || this.F[i] < 0) return;
    this.hooks.onTouch?.();
    const has = this._has(), s = this._status(has, i), name = FACES[this.F[i]].name;
    this.hint = null;
    if (s !== 'free') { this._shake(i); this._say(s === 'covered' ? 'That tile is covered.' : 'That tile is covered on both sides. Pick a tile with an open left or right side.', true); this._render(); return; }
    this.focusI = i;
    if (this.sel < 0) { this.sel = i; this._render(); this._say(`${name} picked. Now tap the same tile somewhere free.`); return; }
    if (this.sel === i) { this.sel = -1; this._render(); this._say('Put back.'); return; }
    if (this.F[this.sel] === this.F[i]) { this._remove(this.sel, i); return; }
    const prev = FACES[this.F[this.sel]].name; this.sel = i; this._render();
    this._say(`${prev} and ${name} don't match. Now holding ${name}.`);
  }
  _remove(a, b, how) {
    const f = this.F[a]; this.hist.push([a, b, f, this.F[b]]); this.F[a] = this.F[b] = -1; this.sel = -1; this.hint = null;
    const hadFocus = this.root.contains(document.activeElement);
    if (this.plan && !this.plan.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) this.plan = null;
    const stuck = this._render([a, b]);
    if (hadFocus && this.focusI >= 0) this.el[this.focusI].focus({ preventScroll: true });
    const won = this.done; this.hooks.onPlace?.(won); this._progress(); this.hooks.onChange?.();
    const left = this._left() / 2;
    if (won) { this._say(`You did it! All ${this.total} pairs matched.`, true); if (!this._completed) { this._completed = true; this.hooks.onComplete?.(); } return; }
    if (stuck) { this._say(`Matched two ${FACES[f].name} tiles. No more pairs are free now. Press Shuffle, or S, to mix up the tiles that are left, or Undo.`, true); if (hadFocus) this.shuffleBtn.focus({ preventScroll: true }); return; }
    this._say(`${how === 'help' ? 'Done for you: ' : ''}Matched two ${FACES[f].name} tiles. ${left} pair${left === 1 ? '' : 's'} to go.`);
  }
  undo() {
    if (this.done || !this.hist.length) { if (!this.hist.length) this._say('Nothing to undo.'); return; }
    const e = this.hist.pop(); this.sel = -1; this.hint = null; this.plan = null;
    if (e.length === 1) { this.F = dec(e[0], this.L.n); this._render(); this._say('Undone. The tiles are back where they were.'); }
    else {
      const [a, b, fa, fb] = e;
      if (this.F[a] >= 0 || this.F[b] >= 0) { this.hist = []; this._say('Nothing more to undo.'); return; }
      this.F[a] = fa; this.F[b] = fb; this._render(); this._say(`Undone. The two ${FACES[fa].name} tiles are back.`);
    }
    this._progress(); this.hooks.onChange?.();
  }
  help() {
    if (this.done) return; this.hooks.onTouch?.();
    const has = this._has();
    if (this.hint && this.hint.every(i => isFree(this.L, has, i))) { const [a, b] = this.hint; this._remove(a, b, 'help'); return; }
    const pair = this._helpPair(has);
    if (!pair) { this.shuffle(); return; }
    this.hints++; this.hint = pair; this.sel = -1; this._render(); this.hooks.onChange?.();
    this._say(`These two match: ${FACES[this.F[pair[0]]].name} and ${FACES[this.F[pair[1]]].name}. Press Help again and I'll take them away.`, true);
  }
  _planOk(has) {
    if (!this.plan) return false; const sim = Uint8Array.from(has);
    for (const [a, b] of this.plan) { if (!sim[a] && !sim[b]) continue; if (!sim[a] || !sim[b] || this.F[a] !== this.F[b] || !isFree(this.L, sim, a) || !isFree(this.L, sim, b)) return false; sim[a] = sim[b] = 0; }
    return sim.every(x => !x);
  }
  _helpPair(has) {
    if (!this._planOk(has)) this.plan = solve(this.L, this.F, 30000);
    if (this.plan) for (const [a, b] of this.plan) if (has[a] && has[b]) return [a, b];
    return this._freePair(has);
  }
  shuffle() {
    if (this.done) return;
    const r = rng(derive(this.recipe.s, 77 + this.shuffles * 31 + this.hist.length));
    const R = redeal(this.L, this.F, r);
    if (!R) { this._say("These last tiles can't be freed by shuffling. Try Undo to go back a few pairs.", true); return; }
    this.hist.push([enc(this.F)]); this.F = R.F; this.plan = R.plan; this.shuffles++; this.sel = -1; this.hint = null;
    this.root.classList.add('shuf'); setTimeout(() => this.root.classList.remove('shuf'), 450);
    const hadFocus = this.root.contains(document.activeElement);
    this._render(); if (hadFocus && this.focusI >= 0) this.el[this.focusI].focus({ preventScroll: true });
    this.hooks.onChange?.();
    this._say('I mixed up the tiles that are left. There are matching pairs to find again.', true);
  }
  snapshot() {
    const W = 1200, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), L = this.L || layout('gentle'), F = deal(this.recipe?.s || 0, L.id).F;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2c5649'); bg.addColorStop(1, '#1c3a31'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const sx = (L.maxX - L.minX) / 2, sy = (L.maxY - L.minY) / 2, w = Math.min(1080 / (sx + L.maxZ * 0.12 + 0.07), 780 / (sy * 1.3 + L.maxZ * 0.12 + 0.07)), h = w * 1.3, d = w * 0.12;
    const x0 = (W - sx * w - L.maxZ * d) / 2, y0 = (H - sy * h - L.maxZ * d) / 2;
    const order = [...Array(L.n).keys()].sort((a, b) => L.P[a].z - L.P[b].z || L.P[a].y - L.P[b].y || L.P[a].x - L.P[b].x);
    for (const i of order) { const p = L.P[i]; drawTile(g, F[i], x0 + (p.x - L.minX) * w / 2 + (L.maxZ - p.z) * d, y0 + (p.y - L.minY) * h / 2 + (L.maxZ - p.z) * d, w - 3, h - 3); }
    return cv;
  }

  // ───── input ─────
  _bind() {
    let down = null, suppress = 0;
    const pd = e => { const t = e.target.closest?.('.tm-tile'); if (!t) return; down = { i: +t.dataset.i, x: e.clientX, y: e.clientY }; this.hooks.onTouch?.(); };
    const pu = e => { if (!down) return; const d = down; down = null; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 16) return; suppress = performance.now(); this._tap(d.i); };
    const pc = () => { down = null; };
    const click = e => { const t = e.target.closest?.('.tm-tile'); if (!t || performance.now() - suppress < 600) return; this._tap(+t.dataset.i); };
    const key = e => {
      if (e.altKey || e.metaKey) return;
      const k = e.key, onTile = e.target.closest?.('.tm-tile');
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.ctrlKey) { if (k === 'z' || k === 'Z') { stop(); this.undo(); } return; }
      if (k === 'u' || k === 'U') { stop(); this.undo(); return; }
      if (k === 'h' || k === 'H') { stop(); this.help(); return; }
      if (k === 's' || k === 'S') { stop(); this.shuffle(); return; }
      if (k === 'Escape' && this.sel >= 0) { stop(); this.sel = -1; this._render(); this._say('Put back.'); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir) {
        stop(); const cur = onTile ? +onTile.dataset.i : this.focusI; if (cur < 0) { this._focus(this._nearestFree(-1)); return; }
        const has = this._has(), [cx, cy] = this.pos[cur]; let best = -1, bs = Infinity;
        for (let i = 0; i < this.L.n; i++) if (i !== cur && isFree(this.L, has, i)) {
          const dx = this.pos[i][0] - cx, dy = this.pos[i][1] - cy, along = dx * dir[0] + dy * dir[1], perp = Math.abs(dx * dir[1] - dy * dir[0]);
          if (along > 4) { const sc = along + 2.5 * perp; if (sc < bs) { bs = sc; best = i; } }
        }
        if (best >= 0) this._focus(best); else this._say('No more free tiles that way.');
        return;
      }
      if ((k === 'Enter' || k === ' ') && onTile) { stop(); suppress = performance.now(); this._tap(+onTile.dataset.i); }
    };
    const r = this.board;
    r.addEventListener('pointerdown', pd); r.addEventListener('pointerup', pu); r.addEventListener('pointercancel', pc); r.addEventListener('click', click);
    this.root.addEventListener('keydown', key);
    this._unbind = () => { r.removeEventListener('pointerdown', pd); r.removeEventListener('pointerup', pu); r.removeEventListener('pointercancel', pc); r.removeEventListener('click', click); this.root.removeEventListener('keydown', key); };
  }
}

const LAYOUT_IDS = Object.keys(LAYOUTS);
const tiles = {
  id: 'tiles', name: 'Tile Match', emoji: '🀄',
  blurb: 'Match pairs of free tiles until the table is clear',
  usesPicture: false, zoomable: false, noun: 'tile puzzle', unit: 'pairs',
  tip: 'Tap two matching tiles that are free: nothing on top, and an open left or right side.',
  options: [
    { key: 'layout', label: 'Layout', choices: [['gentle', 'Gentle (72 tiles)'], ['classic', 'Classic (120 tiles)'], ['tower', 'Tower (112 tiles)']], default: 'gentle' },
    { key: 'hints', label: 'Free tiles', choices: [[1, 'Highlight free tiles'], [0, 'Don’t highlight']], default: 1 },
  ],
  newRecipe(seed, opts = {}) {
    const s = (Number(seed) >>> 0) & 0x7fffffff, l = LAYOUTS[opts.layout] ? opts.layout : 'gentle', h = opts.hints === 0 ? 0 : 1;
    deal(s, l); return { g: 'tiles', s, l, h };
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'tiles') return null;
    const { s, l } = r, h = r.h === undefined ? 1 : r.h;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
    if (typeof l !== 'string' || !LAYOUT_IDS.includes(l)) return null;
    if (h !== 0 && h !== 1) return null;
    return { g: 'tiles', s, l, h };
  },
  title(r) { return `Tile Match · ${LAYOUTS[r.l]?.name || 'Gentle'} ${1000 + (r.s % 9000)}`; },
  progressLabel(done, total) { return `${done} of ${total} pairs`; },
  describe(r) { return `${LAYOUTS[r.l]?.name || 'Gentle'} layout, ${layout(r.l).n} tiles${r.h === 0 ? '' : ', free tiles highlighted'}`; },
  finishText(r, seconds, stats = {}) {
    const mins = Math.max(1, Math.round((seconds || 0) / 60)), hi = stats.hints || 0;
    return `You cleared the table in about ${mins} minute${mins === 1 ? '' : 's'}${hi ? `, with ${hi} hint${hi === 1 ? '' : 's'}` : ''}!`;
  },
  create(host, hooks) { return new Tiles(host, hooks); },
  _internal: { layout, deal, solve, redeal, isFree, FACES, LAYOUT_IDS },
};
export default tiles;
