// FreeCell — a game plug-in for the family games shell (see GAMES.md). Same look and controls as Solitaire:
// big four-colour cards, tap = best move, drag, unlimited Undo, Help shows then does a solver move,
// full keyboard / screen-reader play (piles are labelled groups; Enter smart move, Space pick/drop, U, H).
// card c = suit*13 + rank (suit 0 spades 1 hearts 2 diamonds 3 clubs). Styles: css/cards2.css (.cx-*).

const SUIT_NAME = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_TITLE = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
const RANK_NAME = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
const RANK_TXT = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// suit shapes on a 0–100 grid (used by the cards and by the canvas snapshot)
const SUIT_PATH = [
  'M50,4C62,22 96,40 94,62C92,80 72,84 58,74C60,86 64,93 72,98L28,98C36,93 40,86 42,74C28,84 8,80 6,62C4,40 38,22 50,4Z',
  'M50,92C34,78 4,58 4,32C4,16 16,6 29,6C39,6 46,12 50,20C54,12 61,6 71,6C84,6 96,16 96,32C96,58 66,78 50,92Z',
  'M50,2L90,50L50,98L10,50Z',
  'M29,30a21,21 0 1,0 42,0a21,21 0 1,0 -42,0M7,60a21,21 0 1,0 42,0a21,21 0 1,0 -42,0M51,60a21,21 0 1,0 42,0a21,21 0 1,0 -42,0M46,62C46,80 40,92 30,98L70,98C60,92 54,80 54,62Z',
];
const INK4 = ['#111111', '#c62828', '#1558b0', '#1b6e2a'];   // ♠ black · ♥ red · ♦ blue · ♣ green (all ≥ 5:1 on white)
const INK2 = ['#111111', '#c62828', '#c62828', '#111111'];

const rankOf = c => c % 13, suitOf = c => (c / 13) | 0;
const isRed = c => { const s = suitOf(c); return s === 1 || s === 2; };
const cardName = c => `${RANK_NAME[rankOf(c)]} of ${SUIT_NAME[suitOf(c)]}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
// piles: 0–7 columns · 8–11 free cells · 12–15 foundations (by suit)
const pileName = p => p < 8 ? `column ${p + 1}` : p < 12 ? `free cell ${p - 7}` : `the ${SUIT_NAME[p - 12]} foundation`;

// ───────────────────────────── rules ─────────────────────────────
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const derive = (seed, i) => i ? (Math.imul((seed ^ Math.imul(i, 0x9E3779B1)) >>> 0, 0x85EBCA6B) >>> 1) : seed;
/** Our own seeded deal: Fisher–Yates shuffle, then dealt row by row into 8 columns. */
function dealModel(seed) {
  const r = rng(seed), d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = (r() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  const t = [[], [], [], [], [], [], [], []];
  d.forEach((c, i) => t[i % 8].push(c));
  return { t, fc: [-1, -1, -1, -1], f: [0, 0, 0, 0] };
}
const canFound = (M, c) => rankOf(c) === M.f[suitOf(c)];
const fits = (c, top) => rankOf(top) === rankOf(c) + 1 && isRed(top) !== isRed(c);
function safeHome(M, c) {
  const r = rankOf(c); if (r <= 1) return true;
  const [a, b] = isRed(c) ? [0, 3] : [1, 2]; return M.f[a] >= r && M.f[b] >= r;
}
const won = M => M.f[0] + M.f[1] + M.f[2] + M.f[3] === 52;
const cloneModel = M => ({ t: M.t.map(C => C.slice()), fc: M.fc.slice(), f: M.f.slice() });
/** How many cards may move together (the "supermove"): (free cells + 1) × 2^(empty columns). */
function maxMove(M, to) {
  const free = M.fc.filter(x => x < 0).length;
  let e = 0; for (let j = 0; j < 8; j++) if (!M.t[j].length && j !== to) e++;
  return (free + 1) * 2 ** e;
}
/** Index where the ordered run at the top of a column starts. */
function runStart(C) { let i = C.length - 1; while (i > 0 && fits(C[i], C[i - 1])) i--; return i; }

/** mv {from, i, to}. Record [from, i, to, n]. */
function apply(M, mv) {
  let cards;
  if (mv.from < 8) cards = M.t[mv.from].splice(mv.i);
  else if (mv.from < 12) { cards = [M.fc[mv.from - 8]]; M.fc[mv.from - 8] = -1; }
  else { const s = mv.from - 12; M.f[s]--; cards = [s * 13 + M.f[s]]; }
  if (mv.to < 8) M.t[mv.to].push(...cards); else if (mv.to < 12) M.fc[mv.to - 8] = cards[0]; else M.f[mv.to - 12]++;
  return [mv.from, mv.from < 8 ? mv.i : -1, mv.to, cards.length];
}
function revert(M, r) {
  if (!Array.isArray(r) || r.length !== 4) return false;
  const [from, , to, n] = r; let cards;
  if (to < 8) { const C = M.t[to]; if (C.length < n) return false; cards = C.splice(C.length - n); }
  else if (to < 12) { if (n !== 1 || M.fc[to - 8] < 0) return false; cards = [M.fc[to - 8]]; M.fc[to - 8] = -1; }
  else { const s = to - 12; if (n !== 1 || !M.f[s]) return false; M.f[s]--; cards = [s * 13 + M.f[s]]; }
  if (from < 8) M.t[from].push(...cards);
  else if (from < 12) { if (M.fc[from - 8] >= 0) return false; M.fc[from - 8] = cards[0]; }
  else M.f[from - 12]++;
  return true;
}
/** Next safe card to send home, or null. */
function autoMove(M) {
  for (let i = 0; i < 8; i++) { const C = M.t[i]; if (C.length) { const c = C[C.length - 1]; if (canFound(M, c) && safeHome(M, c)) return { from: i, i: C.length - 1, to: 12 + suitOf(c) }; } }
  for (let k = 0; k < 4; k++) { const c = M.fc[k]; if (c >= 0 && canFound(M, c) && safeHome(M, c)) return { from: 8 + k, i: -1, to: 12 + suitOf(c) }; }
  return null;
}
/** Candidate moves, most promising first. A safe move home is forced. */
function gen(M) {
  const safe = autoMove(M); if (safe) return [safe];
  const out = [], emptyCell = M.fc.indexOf(-1);
  let empty = -1; for (let j = 0; j < 8; j++) if (!M.t[j].length) { empty = j; break; }
  for (let i = 0; i < 8; i++) { const C = M.t[i]; if (C.length && canFound(M, C[C.length - 1])) out.push({ from: i, i: C.length - 1, to: 12 + suitOf(C[C.length - 1]) }); }
  for (let k = 0; k < 4; k++) { const c = M.fc[k]; if (c >= 0 && canFound(M, c)) out.push({ from: 8 + k, i: -1, to: 12 + suitOf(c) }); }
  for (let a = 0; a < 8; a++) {
    const A = M.t[a]; if (!A.length) continue; const rs = runStart(A);
    for (let b = 0; b < 8; b++) {
      if (b === a || !M.t[b].length) continue; const top = M.t[b][M.t[b].length - 1];
      for (let i = rs; i < A.length; i++) if (fits(A[i], top)) { if (A.length - i <= maxMove(M, b)) out.push({ from: a, i, to: b }); break; }
    }
  }
  for (let k = 0; k < 4; k++) {
    const c = M.fc[k]; if (c < 0) continue;
    for (let b = 0; b < 8; b++) if (M.t[b].length && fits(c, M.t[b][M.t[b].length - 1])) out.push({ from: 8 + k, i: -1, to: b });
  }
  if (empty >= 0) {
    for (let a = 0; a < 8; a++) {
      const A = M.t[a]; if (!A.length) continue; const rs = runStart(A);
      const i = Math.max(rs, A.length - maxMove(M, empty)); if (i > 0) out.push({ from: a, i, to: empty });
    }
    for (let k = 0; k < 4; k++) if (M.fc[k] >= 0) out.push({ from: 8 + k, i: -1, to: empty });
  }
  if (emptyCell >= 0) for (let a = 0; a < 8; a++) { const A = M.t[a]; if (A.length) out.push({ from: a, i: A.length - 1, to: 8 + emptyCell }); }
  return out;
}
const keyOf = M => M.t.map(C => String.fromCharCode(...C.map(c => c + 48))).sort().join('|') + '#' + M.fc.slice().sort((a, b) => a - b).join(',');
/** Bounded depth-first solver with memoised positions. {ok, path, nodes}; ok=null when the cap was hit. */
function solve(M0, cap = 30000) {
  const M = cloneModel(M0), seen = new Set(), path = []; let nodes = 0, aborted = false;
  const rec = () => {
    if (won(M)) return true;
    if (++nodes > cap || path.length > 1500) { if (nodes > cap) aborted = true; return false; }
    const k = keyOf(M); if (seen.has(k)) return false; seen.add(k);
    for (const mv of gen(M)) {
      const r = apply(M, mv); path.push(mv);
      if (rec()) return true;
      path.pop(); revert(M, r);
      if (aborted) return false;
    }
    return false;
  };
  const ok = rec();
  return { ok: ok ? true : aborted ? null : false, path: ok ? path : null, nodes };
}

// ───────────────────────────── state (resume) ─────────────────────────────
function fromState(st) {
  try {
    if (!st || st.v !== 1 || !Array.isArray(st.t) || st.t.length !== 8 || !Array.isArray(st.fc) || st.fc.length !== 4 || !Array.isArray(st.f) || st.f.length !== 4) return null;
    const seen = new Set();
    const take = x => { if (!Number.isInteger(x) || x < 0 || x > 51 || seen.has(x)) throw 0; seen.add(x); return x; };
    const t = st.t.map(a => { if (!Array.isArray(a) || a.length > 52) throw 0; return a.map(take); });
    const fc = st.fc.map(x => x === -1 ? -1 : take(x));
    const f = st.f.map((n, s) => { if (!Number.isInteger(n) || n < 0 || n > 13) throw 0; for (let r = 0; r < n; r++) take(s * 13 + r); return n; });
    if (seen.size !== 52) return null;
    const moves = Number.isInteger(st.m) && st.m >= 0 && st.m < 1e6 ? st.m : 0;
    const hints = Number.isInteger(st.n) && st.n >= 0 && st.n < 1e6 ? st.n : 0;
    const okRec = r => Array.isArray(r) && r.length === 4 && r.every(Number.isInteger) && r[0] >= 0 && r[0] <= 15 && r[2] >= 0 && r[2] <= 15 && r[3] >= 1 && r[3] <= 13;
    const hist = Array.isArray(st.h) ? st.h.slice(-200).filter(g => Array.isArray(g) && g.length >= 1 && g.length <= 60 && g.every(okRec)) : [];
    return { M: { t, fc, f }, moves, hints, hist };
  } catch (_) { return null; }
}

// ───────────────────────────── the game on screen ─────────────────────────────
let instances = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
const TOP_ROW = [8, 9, 10, 11, 12, 13, 14, 15], COLS = [0, 1, 2, 3, 4, 5, 6, 7], ORDER = [...TOP_ROW, ...COLS];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

class FreeCell {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `fc${++instances}`;
    this.M = null; this.hist = []; this.moves = 0; this.hints = 0; this._done = false; this.busy = false;
    this.picked = null; this.hint = null; this.loc = new Array(52);
    const root = this.root = document.createElement('div');
    root.className = 'cx fc'; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'FreeCell table');
    const defs = document.createElementNS(SVGNS, 'svg'); defs.setAttribute('aria-hidden', 'true'); defs.setAttribute('class', 'cx-defs');
    defs.innerHTML = SUIT_PATH.map((d, s) => `<symbol id="${this.ns}-s${s}" viewBox="0 0 100 100"><path d="${d}"/></symbol>`).join('');   // static shapes only
    const help = document.createElement('p'); help.className = 'cx-sr'; help.id = `${this.ns}-keys`;
    help.textContent = 'FreeCell. Tab or the arrow keys move between piles. Up and Down move through the cards in a column. ' +
      'Enter moves a card to the best place. Space picks a card up, and Space on another pile drops it there; Escape cancels. U undoes, H gives a hint.';
    root.setAttribute('aria-describedby', help.id);
    this.live = null;
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'cx-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); }
    root.append(defs, help); if (this.live) root.append(this.live);
    this.pileEl = [];
    for (const p of ORDER) {
      const el = document.createElement('div');
      el.className = 'cx-pile ' + (p < 8 ? 'cx-col' : p < 12 ? 'cx-cell' : 'cx-found');
      el.dataset.p = p; el.tabIndex = 0; el.setAttribute('role', 'group');
      const mark = document.createElement('div'); mark.className = 'cx-mark'; mark.setAttribute('aria-hidden', 'true');
      if (p >= 12) mark.append(this._icon(p - 12, 'cx-mark-suit')); else if (p >= 8) mark.textContent = 'FREE';
      el.append(mark); this.pileEl[p] = el; root.append(el);
    }
    this.cardEl = []; for (let c = 0; c < 52; c++) this.cardEl[c] = this._makeCard(c);
    this.msgEl = document.createElement('div'); this.msgEl.className = 'cx-msg'; this.msgEl.setAttribute('aria-hidden', 'true');
    root.append(this.msgEl); host.append(root); this._bind();
  }
  _icon(s, cls) {
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVGNS, 'use'); use.setAttribute('href', `#${this.ns}-s${s}`); svg.append(use); return svg;
  }
  _makeCard(c) {
    const el = document.createElement('div'), r = rankOf(c), s = suitOf(c);
    el.className = `cx-card s${s}`; el.dataset.c = c; el.tabIndex = -1; el.setAttribute('aria-hidden', 'true');
    const front = document.createElement('div'); front.className = 'cx-front'; front.setAttribute('aria-hidden', 'true');
    const corner = document.createElement('div'); corner.className = 'cx-corner';
    const rk = document.createElement('span'); rk.className = 'cx-rank'; rk.dataset.r = RANK_TXT[r];
    corner.append(rk, this._icon(s, 'cx-pip'));
    const corner2 = corner.cloneNode(true); corner2.className = 'cx-corner cx-corner2';
    const mid = document.createElement('div'); mid.className = 'cx-mid';
    if (r >= 10) { const f = document.createElement('span'); f.className = 'cx-facecard'; f.dataset.r = RANK_TXT[r]; mid.append(f); }
    mid.append(this._icon(s, r >= 10 ? 'cx-big cx-small' : 'cx-big'));
    front.append(corner, mid, corner2); el.append(front);
    return el;
  }

  // ───── public interface ─────
  async load(recipe, { state } = {}) {
    this.recipe = recipe;
    const restored = state ? fromState(state) : null;
    if (restored) Object.assign(this, restored);
    else { this.M = dealModel(recipe.s); this.moves = 0; this.hints = 0; this.hist = []; }
    this._done = won(this.M); this._completed = this._done; this.busy = false; this.picked = null; this.plan = null; this._clearHint();
    this.root.classList.toggle('c4', recipe.c !== 2);
    this.hooks.onZoomable?.(false);
    this._layout(); this._render(true); this._progress();
    if (!this._done && !restored) this._after(true);
  }
  state() { const M = this.M; return { v: 1, t: M.t.map(C => C.slice()), fc: M.fc.slice(), f: M.f.slice(), m: this.moves, n: this.hints, h: this.hist.slice(-200) }; }
  progress() { const M = this.M; return { done: M ? M.f[0] + M.f[1] + M.f[2] + M.f[3] : 0, total: 52 }; }
  get done() { return this._done; }
  stats() { return { moves: this.moves, hints: this.hints }; }
  resize() { if (!this.M) return; this._layout(); this._render(true); }
  destroy() { for (const t of ['_autoT', '_msgT', '_hintT', '_zT', '_sayT']) clearTimeout(this[t]); this._unbind?.(); this.root.remove(); }

  undo() {
    if (this.busy || !this.hist.length || this._done) return;
    const g = this.hist[this.hist.length - 1], first = g[0], save = cloneModel(this.M);
    for (let k = g.length - 1; k >= 0; k--) if (!revert(this.M, g[k])) { this.M = save; this.hist = []; this._say('Nothing more to undo.'); return; }
    this.hist.pop(); this.moves = Math.max(0, this.moves - 1); this._cancelPick(true); this._clearHint();
    const C = first[0] < 8 ? this.M.t[first[0]] : null, c = C ? C[C.length - first[3]] : first[0] < 12 ? this.M.fc[first[0] - 8] : -1;
    this._render(); this._progress(); this.hooks.onChange?.();
    this._say(`Undone. ${c >= 0 ? `${cap(cardName(c))}${first[3] > 1 ? ` and ${first[3] - 1} more` : ''} back to ${pileName(first[0])}.` : ''}${g.length > 1 ? ' The cards that went home by themselves are back too.' : ''}`);
  }
  help() {
    if (this.busy || this._done) return;
    if (this.hint && performance.now() < this.hint.until) { const mv = this.hint.mv; this._clearHint(); this._do(mv, 'help'); return; }
    const mv = this._findHint();
    if (!mv) { this._say('No more moves here. Try Undo to go back a few steps.', true); return; }
    this.hints++; this._showHint(mv); this.hooks.onChange?.();
  }
  snapshot() {
    const W = 1200, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), ink = this.recipe?.c === 2 ? INK2 : INK4;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2c5649'); bg.addColorStop(1, '#1c3a31');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const cw = 200, ch = 280, top = 70, step = (H - top - ch - 40) / 12;
    for (let s = 0; s < 4; s++) { const x = 80 + s * (cw + 80); for (let r = 0; r < this.M.f[s]; r++) drawCanvasCard(g, s * 13 + r, x, top + r * step, cw, ch, ink); }
    return cv;
  }

  // ───── layout & drawing ─────
  _layout() {
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    const scale = Math.min(2, Math.max(1, parseFloat(getComputedStyle(this.host).getPropertyValue('--card-scale')) || 1));
    const gapR = 0.1, m = 6, longest = Math.max(8, ...this.M.t.map(C => C.length));
    const byW = (W - 2 * m) / (8 + 7 * gapR);
    const byH = (H - 2 * m) / (1.4 + 0.25 + 1.4 + 7 * 0.42);            // eight cards at the roomy spacing
    let cw = Math.max(30, Math.min(byW, byH, 160 * scale));
    const rkFor = w => Math.max(16, Math.min(w * 0.46, w * 0.34 * Math.min(1.35, scale)));
    // long columns: shrink the cards (not the gaps between them) so every rank stays readable
    for (let k = 0; k < 40; k++) { const minOff = rkFor(cw) * 0.95 + 4; if (2.65 * cw + 2 * m + (longest - 1) * minOff <= H || cw <= 30) break; cw *= 0.96; }
    const ch = cw * 1.4, gap = cw * gapR, total = 8 * cw + 7 * gap, rk = rkFor(cw);
    const x0 = Math.max(m, (W - total) / 2), y0 = m;
    this.G = { W, H, cw, ch, gap, x0, y0, tabY: y0 + ch + cw * 0.25, upOff: Math.max(rk * 1.25 + 6, cw * 0.42), minOff: rk * 0.95 + 4, longest };
    const st = this.root.style;
    st.setProperty('--cw', cw + 'px'); st.setProperty('--ch', ch + 'px');
    st.setProperty('--rk', Math.round(rk) + 'px'); st.setProperty('--pip', Math.round(rk * 0.72) + 'px');
    this.root.classList.toggle('compact', cw < 60);
  }
  _colX(i) { return this.G.x0 + i * (this.G.cw + this.G.gap); }
  _pilePos(p) { return p < 8 ? [this._colX(p), this.G.tabY] : [this._colX(p - 8), this.G.y0]; }
  _colOffsets(C) {
    const G = this.G, n = C.length, avail = G.H - G.tabY - 6 - G.ch;
    const off = n > 1 ? Math.max(G.minOff, Math.min(G.upOff, avail / (n - 1))) : 0;
    return C.map((_, i) => i * off);
  }
  _cardsOf(p) { const M = this.M; if (p < 8) return M.t[p]; if (p < 12) return M.fc[p - 8] >= 0 ? [M.fc[p - 8]] : []; const s = p - 12, out = []; for (let r = 0; r < M.f[s]; r++) out.push(s * 13 + r); return out; }
  _render(instant = false) {
    const M = this.M;
    if (Math.max(8, ...M.t.map(C => C.length)) !== this.G.longest) this._layout();
    const G = this.G, anim = !instant && !reducedMotion();
    const active = document.activeElement, activeCard = active?.classList?.contains('cx-card') ? +active.dataset.c : -1;
    const flips = [], moved = [];
    for (const p of ORDER) {
      const pel = this.pileEl[p], [px, py] = this._pilePos(p), cards = this._cardsOf(p);
      const ys = p < 8 ? this._colOffsets(cards) : null;
      Object.assign(pel.style, { left: px + 'px', top: py + 'px', width: G.cw + 'px', height: (ys && cards.length ? ys[ys.length - 1] + G.ch : G.ch) + 'px' });
      pel.classList.toggle('empty', !cards.length);
      pel.setAttribute('aria-label', this._pileLabel(p));
      const kids = [...pel.querySelectorAll(':scope > .cx-card')].map(e => +e.dataset.c);
      const same = kids.length === cards.length && kids.every((c, i) => c === cards[i]);
      cards.forEach((c, i) => {
        const el = this.cardEl[c], ly = ys ? ys[i] : 0, access = p < 8 || i === cards.length - 1;
        this.loc[c] = { p, i };
        el.classList.toggle('stacked', p >= 12 && i < cards.length - 1);
        if (access) { el.removeAttribute('aria-hidden'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', cap(cardName(c)) + (this._isPicked(c) ? ', picked up' : '')); }
        else { el.setAttribute('aria-hidden', 'true'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
        const z = (p >= 8 ? 100 : 400) + i, rx = px, ry = py + ly, parentChanged = el.parentNode !== pel;
        if (!same) pel.append(el);
        if (anim && parentChanged && el._rx != null && (el._rx !== rx || el._ry !== ry)) {
          el.style.transition = 'none'; el.style.transform = `translate(${el._rx - px}px,${el._ry - py}px)`; flips.push([el, ly]);
        } else el.style.transform = `translate(0px,${ly}px)`;
        if (el._rx !== rx || el._ry !== ry) moved.push(el);
        el._rx = rx; el._ry = ry; el._ly = ly; el._z = z; el.style.zIndex = z;
      });
    }
    if (flips.length) { void this.root.offsetWidth; for (const [el, ly] of flips) { el.style.transition = ''; el.style.transform = `translate(0px,${ly}px)`; } }
    if (anim && moved.length) { for (const el of moved) el.style.zIndex = 2000 + el._z; clearTimeout(this._zT); this._zT = setTimeout(() => { for (const el of moved) el.style.zIndex = el._z; }, 330); }
    this.root.classList.toggle('instant', instant);
    if (instant) requestAnimationFrame(() => this.root.classList.remove('instant'));
    if (activeCard >= 0 && document.activeElement !== this.cardEl[activeCard]) {
      const el = this.cardEl[activeCard]; if (el.getAttribute('role') === 'button') el.focus({ preventScroll: true }); else this.pileEl[this.loc[activeCard].p]?.focus({ preventScroll: true });
    }
  }
  _pileLabel(p) {
    const M = this.M;
    if (p >= 12) { const s = p - 12; return M.f[s] ? `${SUIT_TITLE[s]} foundation, ${M.f[s]} of 13, top: ${cardName(s * 13 + M.f[s] - 1)}` : `${SUIT_TITLE[s]} foundation, empty`; }
    if (p >= 8) return M.fc[p - 8] >= 0 ? `Free cell ${p - 7}: ${cardName(M.fc[p - 8])}` : `Free cell ${p - 7}, empty. Any one card can wait here.`;
    const C = M.t[p];
    if (!C.length) return `Column ${p + 1}, empty. Any card can go here.`;
    const rs = runStart(C);
    return `Column ${p + 1}, ${C.length} card${C.length === 1 ? '' : 's'}, top: ${cardName(C[C.length - 1])}${C.length - rs > 1 ? `, ${C.length - rs} in order` : ''}`;
  }
  _progress() { const { done, total } = this.progress(); this.hooks.onProgress?.(done, total); }
  _say(text, visual = false) {
    if (visual) { this.msgEl.textContent = text; this.msgEl.classList.add('show'); clearTimeout(this._msgT); this._msgT = setTimeout(() => this.msgEl.classList.remove('show'), 4200); }
    if (this.hooks.announce) { this.hooks.announce(text); return; }
    const r = this.live; r.textContent = ''; clearTimeout(this._sayT); this._sayT = setTimeout(() => { r.textContent = text; }, 40);
  }

  // ───── moves ─────
  _run(from, i) {
    const M = this.M;
    if (from < 8) { const C = M.t[from]; if (i < 0 || i >= C.length || i < runStart(C)) return null; return C.slice(i); }
    if (from < 12) return M.fc[from - 8] >= 0 ? [M.fc[from - 8]] : null;
    return null;                                                    // cards at home stay home (Undo brings them back)
  }
  _legal(mv) {
    const M = this.M, run = this._run(mv.from, mv.i); if (!run || mv.to === mv.from) return false;
    if (mv.to >= 12) return run.length === 1 && mv.to === 12 + suitOf(run[0]) && canFound(M, run[0]);
    if (mv.to >= 8) return run.length === 1 && M.fc[mv.to - 8] < 0;
    const T = M.t[mv.to];
    if (run.length > maxMove(M, mv.to)) return false;
    return !T.length || fits(run[0], T[T.length - 1]);
  }
  _why(run, to) {
    const M = this.M, c = run[0], name = cap(cardName(c));
    if (to >= 12) {
      if (run.length > 1) return 'Only one card at a time can go home.';
      const s = to - 12;
      if (suitOf(c) !== s) return `${name} belongs on the ${SUIT_NAME[suitOf(c)]} foundation.`;
      return M.f[s] ? `The ${SUIT_NAME[s]} foundation needs the ${RANK_NAME[M.f[s]]} next.` : `The ${SUIT_NAME[s]} foundation starts with the ace.`;
    }
    if (to >= 8) return run.length > 1 ? 'Only one card fits in a free cell.' : 'That free cell already has a card.';
    const mx = maxMove(M, to);
    if (run.length > mx) return `You can move ${mx} card${mx === 1 ? '' : 's'} at once right now. Empty a free cell or a column to move more.`;
    if (rankOf(c) === 12) return 'A king can only go in an empty column or a free cell.';
    const want = isRed(c) ? 'club or spade' : 'heart or diamond', rank = RANK_NAME[rankOf(c) + 1];
    return this.recipe?.c === 2 ? `${name} needs a ${isRed(c) ? 'black' : 'red'} ${rank} (${want}) to sit on.` : `${name} needs a ${want} ${rank} to sit on.`;
  }
  /** Tap / Enter: home when safe, else a column, else home, else a free cell, else an empty column. */
  _best(from, i) {
    const M = this.M, run = this._run(from, i); if (!run) return null;
    const c = run[0], one = run.length === 1;
    const home = one && canFound(M, c) ? { from, i, to: 12 + suitOf(c) } : null;
    if (home && safeHome(M, c)) return home;
    for (let b = 0; b < 8; b++) if (b !== from && M.t[b].length && this._legal({ from, i, to: b })) return { from, i, to: b };
    if (home) return home;
    if (one && from < 8) { const k = M.fc.indexOf(-1); if (k >= 0) return { from, i, to: 8 + k }; }
    if (!(from < 8 && i === 0)) for (let b = 0; b < 8; b++) if (!M.t[b].length && this._legal({ from, i, to: b })) return { from, i, to: b };
    return null;
  }
  _do(mv, how) {
    if (this.busy || !this._legal(mv)) return false;
    const run = this._run(mv.from, mv.i), r = apply(this.M, mv);
    this.hist.push([r]); this.moves++; this._cancelPick(true); this._clearHint();
    this._render();
    let t = run.length > 1 ? `${run.length} cards, ${cardName(run[0])} to ${cardName(run[run.length - 1])}, moved to ${pileName(mv.to)}.` : `${cap(cardName(run[0]))} moved to ${pileName(mv.to)}.`;
    if (mv.to >= 12) t += ` ${this.progress().done} of 52 cards home.`;
    if (mv.from < 8 && !this.M.t[mv.from].length) t += ` Column ${mv.from + 1} is now empty.`;
    this._say(t);
    if (mv.to >= 12) this.hooks.onPlace?.(won(this.M));
    this._progress(); this.hooks.onChange?.();
    if (how === 'key') this.pileEl[mv.from]?.focus({ preventScroll: true });
    this._after();
    return true;
  }
  /** After a move: safe cards fly home (option), and once nothing is out of order everything goes home. */
  _after(first) {
    const M = this.M;
    if (won(M)) { this._finish(); return; }
    const tidy = M.t.every(C => C.every((c, k) => !k || rankOf(c) <= rankOf(C[k - 1])));
    const pick = () => {
      if (tidy) {
        let best = null;
        for (let i = 0; i < 8; i++) { const C = M.t[i]; if (C.length && canFound(M, C[C.length - 1]) && (!best || rankOf(C[C.length - 1]) < best.r)) best = { from: i, i: C.length - 1, to: 12 + suitOf(C[C.length - 1]), r: rankOf(C[C.length - 1]) }; }
        for (let k = 0; k < 4; k++) { const c = M.fc[k]; if (c >= 0 && canFound(M, c) && (!best || rankOf(c) < best.r)) best = { from: 8 + k, i: -1, to: 12 + suitOf(c), r: rankOf(c) }; }
        if (best) return best;
      }
      return this.recipe.a ? autoMove(M) : null;
    };
    if (!pick()) return;
    this.busy = true; let n = 0;
    if (first && !this.hist.length) this.hist.push([]);
    const step = () => {
      const mv = pick();
      if (!mv) { this.busy = false; if (this.hist.length && !this.hist[this.hist.length - 1].length) this.hist.pop(); this.hooks.onChange?.(); if (won(M)) this._finish(); else this._say(`${this.progress().done} of 52 cards home.`); return; }
      const r = apply(M, mv);
      if (!this.hist.length) this.hist.push([]);
      this.hist[this.hist.length - 1].push(r);
      this._render(); this._progress();
      if (++n % 4 === 0 || won(M)) this.hooks.onPlace?.(won(M));
      this._autoT = setTimeout(step, reducedMotion() ? 20 : 150);
    };
    this._autoT = setTimeout(step, reducedMotion() ? 20 : 260);
  }
  _finish() {
    this._done = true; this.busy = false; clearTimeout(this._autoT);
    this._say(`You won! All 52 cards are home in ${this.moves} moves.`, true);
    if (!this._completed) { this._completed = true; this.hooks.onComplete?.(); }
  }

  // ───── hints ─────
  _findHint() {
    const k = keyOf(this.M);
    if (this.plan) { const j = this.plan.keys.indexOf(k); if (j >= 0 && j < this.plan.path.length) return this.plan.path[j]; }
    const res = solve(this.M, 20000);
    if (res.ok && res.path.length) {
      const M = cloneModel(this.M), keys = [k];
      for (const mv of res.path) { apply(M, mv); keys.push(keyOf(M)); }
      this.plan = { path: res.path, keys }; return res.path[0];
    }
    return gen(this.M).find(mv => !(mv.from < 8 && mv.to >= 8 && mv.to < 12)) || gen(this.M)[0] || null;
  }
  _showHint(mv) {
    this._clearHint();
    const run = this._run(mv.from, mv.i), els = run.map(c => this.cardEl[c]);
    const T = mv.to < 8 ? this.M.t[mv.to] : null;
    els.push(T && T.length ? this.cardEl[T[T.length - 1]] : this.pileEl[mv.to]);
    for (const el of els) el.classList.add('hint');
    this.hint = { mv, els, until: performance.now() + 6000 };
    this._say(`Hint: move ${cardName(run[0])}${run.length > 1 ? ` and the ${run.length - 1} card${run.length > 2 ? 's' : ''} on it` : ''} from ${pileName(mv.from)} to ${pileName(mv.to)}. Press Help again and I'll do it.`, true);
    clearTimeout(this._hintT); this._hintT = setTimeout(() => this._clearHint(), 6000);
  }
  _clearHint() { if (this.hint) { for (const el of this.hint.els) el.classList.remove('hint'); this.hint = null; } clearTimeout(this._hintT); }

  // ───── picking up (keyboard / screen reader two-step move) ─────
  _isPicked(c) { if (!this.picked) return false; const run = this._run(this.picked.p, this.picked.i); return !!run && run.includes(c); }
  _pick(p, i) {
    const run = this._run(p, i);
    if (!run) { this._say(this._cantLift(p, i)); return; }
    this._cancelPick(true); this.picked = { p, i };
    for (const c of run) this.cardEl[c].classList.add('picked');
    this._render(true);
    this._say(`Picked up ${cardName(run[0])}${run.length > 1 ? ` and ${run.length - 1} more` : ''}. Move to a pile and press Space to drop it there, or Escape to cancel.`);
  }
  _cancelPick(quiet) { if (!this.picked) return; for (const el of this.cardEl) el.classList.remove('picked'); this.picked = null; if (!quiet) { this._render(true); this._say('Put back.'); } }
  _drop(to) {
    const { p, i } = this.picked, run = this._run(p, i);
    if (!run) { this._cancelPick(true); return; }
    if (to === p) { this._cancelPick(); return; }
    let t = to;
    if (to >= 8 && to < 12 && this.M.fc[to - 8] >= 0 && run.length === 1) { const k = this.M.fc.indexOf(-1); if (k >= 0) t = 8 + k; }
    if (!this._do({ from: p, i, to: t }, 'key')) this._say(`Can't go there. ${this._why(run, to)} Still holding it.`);
  }
  _cantLift(p, i) {
    if (p >= 12) return 'Cards at home stay there. Undo can bring one back.';
    const C = p < 8 ? this.M.t[p] : null;
    if (C && i >= 0 && i < C.length) return `The cards on the ${cardName(C[i])} are not in order, so they can't move together. Move the top card first.`;
    return 'There is no card to pick up here.';
  }

  // ───── input ─────
  _bind() {
    const root = this.root; let press = null, suppressClick = 0;
    const pt = e => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = e => {
      if (!this.M || this.busy || this._done || (e.button && e.button !== 0)) return;
      this.hooks.onTouch?.();
      const [x, y] = pt(e), cardEl = e.target.closest?.('.cx-card'), pileEl = e.target.closest?.('.cx-pile');
      press = { id: e.pointerId, x, y, slop: e.pointerType === 'mouse' ? 6 : 16, kind: 'none', drag: false };
      if (cardEl) { const L = this.loc[+cardEl.dataset.c]; Object.assign(press, { kind: 'run', from: L.p, i: L.p < 8 ? L.i : -1 }); }
      else if (pileEl) Object.assign(press, { kind: 'pile', pile: +pileEl.dataset.p });
      if (press.kind === 'run') { const run = this._run(press.from, press.i); if (run) { const lead = this.cardEl[run[0]]; press.run = run; press.gx = x - lead._rx; press.gy = y - lead._ry; } }
      try { root.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const move = e => {
      if (!press || e.pointerId !== press.id || !press.run) return;
      const [x, y] = pt(e);
      if (!press.drag) { if (Math.hypot(x - press.x, y - press.y) <= press.slop) return; press.drag = true; this._cancelPick(true); this._clearHint(); for (const c of press.run) this.cardEl[c].classList.add('drag'); }
      const [px, py] = this._pilePos(press.from), lead = this.cardEl[press.run[0]];
      press.run.forEach((c, k) => { const el = this.cardEl[c]; el.style.transform = `translate(${x - press.gx - px}px,${y - press.gy - py + (el._ly - lead._ly)}px)`; el.style.zIndex = 3000 + k; });
      press.lx = x - press.gx; press.ly = y - press.gy;
    };
    const up = e => {
      if (!press || e.pointerId !== press.id) return;
      const P = press; press = null;
      if (P.drag) {
        for (const c of P.run) this.cardEl[c].classList.remove('drag');
        const to = this._dropTarget(P.lx + this.G.cw / 2, P.ly + this.G.ch / 2, P);
        if (to == null || !this._do({ from: P.from, i: P.i, to }, 'drag')) { this._render(); if (to != null) this._say(`Can't go there. ${this._why(P.run, to)}`, true); }
        suppressClick = performance.now(); return;
      }
      if (P.kind === 'none') return;
      suppressClick = performance.now(); this._activate(P);
    };
    const cancel = e => { if (press && e.pointerId === press.id) { const P = press; press = null; if (P.drag) { for (const c of P.run) this.cardEl[c].classList.remove('drag'); this._render(); } } };
    const click = e => {
      if (performance.now() - suppressClick < 600 || !this.M || this.busy || this._done) return;
      const cardEl = e.target.closest?.('.cx-card'), pileEl = e.target.closest?.('.cx-pile');
      if (cardEl && cardEl.getAttribute('role') === 'button') { const L = this.loc[+cardEl.dataset.c]; this._activate({ kind: 'run', from: L.p, i: L.p < 8 ? L.i : -1 }); }
      else if (pileEl) this._activate({ kind: 'pile', pile: +pileEl.dataset.p });
    };
    const key = e => this._key(e);
    const ev = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancel], ['click', click], ['keydown', key]];
    for (const [n, f] of ev) root.addEventListener(n, f);
    this._unbind = () => { for (const [n, f] of ev) root.removeEventListener(n, f); };
  }
  _activate(P) {
    if (P.kind === 'pile') {
      if (this.picked) { this._drop(P.pile); return; }
      const cards = this._cardsOf(P.pile); if (!cards.length) { this._say(this._pileLabel(P.pile)); return; }
      P = { kind: 'run', from: P.pile, i: P.pile < 8 ? cards.length - 1 : -1 };
    }
    if (this.picked) { this._drop(P.from); return; }
    const mv = this._best(P.from, P.i);
    if (mv) { this._do(mv, 'tap'); return; }
    const run = this._run(P.from, P.i), cards = run || (P.from < 8 ? this.M.t[P.from].slice(P.i) : this._cardsOf(P.from).slice(-1));
    for (const c of cards) { const el = this.cardEl[c]; el.classList.remove('wiggle'); void el.offsetWidth; el.classList.add('wiggle'); }
    this._say(run ? `No place for ${cardName(run[0])} right now.` : this._cantLift(P.from, P.i), true);
  }
  _dropTarget(cx, cy, P) {
    const G = this.G; let best = null, bd = Infinity;
    const top = cy < G.tabY - G.ch * 0.15;
    for (let b = 0; b < 8; b++) {
      const x = this._colX(b), d = Math.abs(cx - (x + G.cw / 2));
      if (d < G.cw * 0.75 && d < bd) { bd = d; best = b; }
    }
    if (best == null) return null;
    if (!top) return best === P.from ? null : best;
    if (best >= 4) return P.run.length === 1 ? 12 + suitOf(P.run[0]) : 12 + best - 4;
    const p = 8 + best; if (this.M.fc[best] >= 0 && P.run.length === 1) { const k = this.M.fc.indexOf(-1); if (k >= 0) return 8 + k; }
    return p === P.from ? null : p;
  }
  _focusInfo() {
    const a = document.activeElement; if (!a || !this.root.contains(a)) return null;
    if (a.classList.contains('cx-card')) { const L = this.loc[+a.dataset.c]; return { p: L.p, i: L.i }; }
    if (a.classList.contains('cx-pile')) return { p: +a.dataset.p, i: null };
    return null;
  }
  _focusPile(p) { this.pileEl[p]?.focus({ preventScroll: true }); }
  _key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const f = this._focusInfo(), k = e.key, handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'u' || k === 'U') { handled(); this.undo(); return; }
    if (k === 'h' || k === 'H') { handled(); this.help(); return; }
    if (k === 'Escape') { if (this.picked) { handled(); this._cancelPick(); return; } if (f && f.i != null && f.p < 8) { handled(); this._focusPile(f.p); } return; }
    if (!f) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      handled(); const row = f.p < 8 ? COLS : TOP_ROW, idx = row.indexOf(f.p);
      this._focusPile(row[Math.max(0, Math.min(row.length - 1, idx + (k === 'ArrowRight' ? 1 : -1)))]); return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      handled();
      if (f.p >= 8) { if (k === 'ArrowDown') this._focusPile(f.p - 8 - (f.p >= 12 ? 0 : 0)); return; }
      const C = this.M.t[f.p];
      if (k === 'ArrowUp') { if (f.i == null) this._focusPile(8 + f.p); else if (f.i > 0) this.cardEl[C[f.i - 1]].focus({ preventScroll: true }); else this._focusPile(f.p); return; }
      if (!C.length) return;
      if (f.i == null) { this.cardEl[C[0]].focus({ preventScroll: true }); return; }
      if (f.i + 1 < C.length) this.cardEl[C[f.i + 1]].focus({ preventScroll: true }); else this._say(`${cap(cardName(C[f.i]))} is the top card of column ${f.p + 1}.`);
      return;
    }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      handled(); if (this.busy || this._done) return;
      if (this.picked) { this._drop(f.p); return; }
      const cards = this._cardsOf(f.p); if (!cards.length) { this._say(this._pileLabel(f.p)); return; }
      const i = f.p < 8 ? (f.i != null ? f.i : cards.length - 1) : -1;
      if (k === 'Enter') this._activate({ kind: 'run', from: f.p, i }); else this._pick(f.p, i);
    }
  }
}

/** Draw one card on a canvas (used by snapshot). */
function drawCanvasCard(g, c, x, y, w, h, ink) {
  const r = w * 0.08, s = suitOf(c), rk = rankOf(c);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
  g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fillStyle = '#fff'; g.fill();
  g.shadowColor = 'transparent'; g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  g.fillStyle = ink[s];
  g.font = `700 ${Math.round(w * 0.24)}px "Atkinson Hyperlegible", system-ui, sans-serif`; g.textBaseline = 'top';
  g.fillText(RANK_TXT[rk], x + w * 0.07, y + w * 0.06);
  const pip = new Path2D(SUIT_PATH[s]), tw = g.measureText(RANK_TXT[rk]).width;
  g.save(); g.translate(x + w * 0.09 + tw, y + w * 0.08); g.scale(w * 0.0018, w * 0.0018); g.fill(pip); g.restore();
  g.save(); g.translate(x + w * 0.3, y + h * 0.36); g.scale(w * 0.004, w * 0.004); g.fill(pip); g.restore();
  g.restore();
}

// ───────────────────────────── the plug-in ─────────────────────────────
const freecell = {
  id: 'freecell', name: 'FreeCell', emoji: '🂡',
  blurb: 'Every card face up — plan ahead, use the four free cells',
  usesPicture: false, zoomable: false, noun: 'FreeCell deal',
  options: [
    { key: 'colors', label: 'Card colours', choices: [[4, 'Four colours (easier to see)'], [2, 'Classic red & black']], default: 4 },
    { key: 'auto', label: 'Safe cards go home by themselves', choices: [[1, 'Yes'], [0, "No, I'll move them"]], default: 1 },
  ],
  /** A deal proven winnable by the solver: try the seed, then seeds derived from it, until one solves. */
  newRecipe(seed, opts = {}) {
    const c = opts.colors === 2 ? 2 : 4, a = opts.auto === 0 ? 0 : 1, base = (Number(seed) >>> 0) & 0x7fffffff;
    for (let i = 0; i < 30; i++) { const s = derive(base, i) & 0x7fffffff; if (solve(dealModel(s), 30000).ok) return { g: 'freecell', s, c, a }; }
    return { g: 'freecell', s: base, c, a };
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'freecell') return null;
    const { s, c, a } = r;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
    if (c !== 2 && c !== 4) return null;
    return { g: 'freecell', s, c, a: a === 0 ? 0 : 1 };
  },
  title(r) { return `FreeCell · deal ${1000 + (r.s % 9000)}`; },
  progressLabel(done, total) { return `${done} of ${total} cards home`; },
  describe(r) { return `${r.c === 2 ? 'red & black' : 'four-colour'} deck · ${r.a ? 'safe cards go home by themselves' : 'you move every card'}`; },
  finishText(r, seconds, stats) {
    const mins = Math.max(1, Math.round((seconds || 0) / 60)), moves = stats?.moves;
    return `You won${moves ? ` in ${moves} moves` : ''} and ${mins} minute${mins === 1 ? '' : 's'}!`;
  },
  create(host, hooks) { return new FreeCell(host, hooks); },
  _internal: { dealModel, solve, apply, revert, gen, won, cloneModel, cardName, fromState, maxMove, autoMove },
};
export default freecell;
