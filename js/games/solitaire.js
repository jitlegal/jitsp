// Klondike Solitaire — a game plug-in for the family games shell (see GAMES.md).
//
// Grandparent-first: big four-colour cards, tap a card and it goes to the best place, drag also works,
// unlimited Undo, Help shows (then does) a good move, cards fly home by themselves at the end, and every
// deal is checked by a built-in solver so it can always be won.
//
// Accessible: every pile is a focusable, labelled group and every face-up card a labelled button inside
// it, so screen readers (VoiceOver, NVDA) read the table in order. Full keyboard play: Tab / arrows move,
// Enter = smart move, Space = pick up / drop, Esc = cancel, U undo, H help, D deal. Every result is
// announced in words — suits are always spelled out, never shown by colour alone.
//
// Model (pure data, shared by the game and the solver):
//   card c = suit*13 + rank   (suit 0 ♠ 1 ♥ 2 ♦ 3 ♣, rank 0 = ace … 12 = king)
//   M = { t:[{c:[cards], d:faceDownCount}×7], f:[count per suit ×4], s:[stock, top = end], w:[waste, top = end], draw:1|3 }
//   piles: 0–6 columns · 7 waste · 8–11 foundations (by suit) · 12 stock

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
const pileName = p => p < 7 ? `column ${p + 1}` : p === 7 ? 'the waste' : p === 12 ? 'the stock' : `the ${SUIT_NAME[p - 8]} foundation`;

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ───────────────────────────── rules ─────────────────────────────
function dealModel(seed, draw) {
  const r = rng(seed), d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = (r() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  const t = []; let k = 0;
  for (let i = 0; i < 7; i++) { const c = []; for (let j = 0; j <= i; j++) c.push(d[k++]); t.push({ c, d: i }); }
  return { t, f: [0, 0, 0, 0], s: d.slice(k), w: [], draw };
}
const canFound = (M, c) => rankOf(c) === M.f[suitOf(c)];
function canTab(M, c, col) {
  const C = M.t[col].c; if (!C.length) return rankOf(c) === 12;
  const top = C[C.length - 1]; return rankOf(top) === rankOf(c) + 1 && isRed(top) !== isRed(c);
}
/** Safe to send home: nothing still in play could ever need it as a resting place. */
function safeHome(M, c) {
  const r = rankOf(c); if (r <= 1) return true;
  const [a, b] = isRed(c) ? [0, 3] : [1, 2]; return M.f[a] >= r && M.f[b] >= r;
}
const won = M => M.f[0] + M.f[1] + M.f[2] + M.f[3] === 52;
function cloneModel(M) { return { t: M.t.map(C => ({ c: C.c.slice(), d: C.d })), f: M.f.slice(), s: M.s.slice(), w: M.w.slice(), draw: M.draw }; }

/** Apply a move; returns a compact record that revert() can undo. mv: {k:0} deal · {k:2, from, i, to} */
function apply(M, mv) {
  if (mv.k === 0) {
    if (M.s.length) { const n = Math.min(M.draw, M.s.length); for (let i = 0; i < n; i++) M.w.push(M.s.pop()); return [0, n]; }
    const n = M.w.length; M.s = M.w.reverse(); M.w = []; return [1, n];
  }
  let cards;
  if (mv.from < 7) cards = M.t[mv.from].c.splice(mv.i);
  else if (mv.from === 7) cards = [M.w.pop()];
  else { const s = mv.from - 8; M.f[s]--; cards = [s * 13 + M.f[s]]; }
  if (mv.to < 7) M.t[mv.to].c.push(...cards); else M.f[mv.to - 8]++;
  let flip = 0;
  if (mv.from < 7) { const C = M.t[mv.from]; if (C.c.length && C.c.length === C.d) { C.d--; flip = 1; } }
  return [2, mv.from, mv.from < 7 ? mv.i : -1, mv.to, flip, cards.length];
}
/** Undo a record. Returns false (and changes nothing) if the record doesn't fit the model. */
function revert(M, r) {
  if (!Array.isArray(r)) return false;
  if (r[0] === 0) { if (M.w.length < r[1]) return false; for (let i = 0; i < r[1]; i++) M.s.push(M.w.pop()); return true; }
  if (r[0] === 1) { if (M.w.length) return false; M.w = M.s.reverse(); M.s = []; return true; }
  const [, from, , to, flip, n] = r;
  let cards;
  if (to < 7) { const C = M.t[to].c; if (C.length < n) return false; cards = C.splice(C.length - n); }
  else { const s = to - 8; if (!M.f[s]) return false; M.f[s]--; cards = [s * 13 + M.f[s]]; }
  if (from < 7) { const C = M.t[from]; if (flip) C.d++; C.c.push(...cards); }
  else if (from === 7) M.w.push(cards[0]);
  else M.f[from - 8]++;
  return true;
}

/** Candidate moves, most promising first. A safe move home is forced (the only option). */
function gen(M) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const C = M.t[i].c; if (!C.length) continue; const c = C[C.length - 1];
    if (canFound(M, c)) { const mv = { k: 2, from: i, i: C.length - 1, to: 8 + suitOf(c) }; if (safeHome(M, c)) return [mv]; out.push(mv); }
  }
  if (M.w.length) {
    const c = M.w[M.w.length - 1];
    if (canFound(M, c)) { const mv = { k: 2, from: 7, i: -1, to: 8 + suitOf(c) }; if (safeHome(M, c)) return [mv]; out.push(mv); }
  }
  let empty = -1; for (let j = 0; j < 7; j++) if (!M.t[j].c.length) { empty = j; break; }
  for (let a = 0; a < 7; a++) {
    const A = M.t[a], L = A.c.length; if (!L) continue;
    for (let i = A.d; i < L; i++) {
      const c = A.c[i], whole = i === A.d;
      if (!whole && !canFound(M, A.c[i - 1])) continue;          // split a run only to free a card for home
      if (whole && A.d === 0 && rankOf(c) === 12) continue;       // a king already at the bottom
      for (let b = 0; b < 7; b++) {
        if (b === a) continue; const B = M.t[b];
        if (!B.c.length) { if (b !== empty || rankOf(c) !== 12) continue; } else if (!canTab(M, c, b)) continue;
        out.push({ k: 2, from: a, i, to: b });
      }
    }
  }
  if (M.w.length) {
    const c = M.w[M.w.length - 1];
    for (let b = 0; b < 7; b++) {
      const B = M.t[b]; if (!B.c.length) { if (b !== empty || rankOf(c) !== 12) continue; } else if (!canTab(M, c, b)) continue;
      out.push({ k: 2, from: 7, i: -1, to: b });
    }
  }
  if (M.s.length || M.w.length) out.push({ k: 0 });
  for (let s = 0; s < 4; s++) {
    if (M.f[s] < 2) continue; const c = s * 13 + M.f[s] - 1;
    for (let b = 0; b < 7; b++) if (M.t[b].c.length && canTab(M, c, b)) out.push({ k: 2, from: 8 + s, i: -1, to: b });
  }
  return out;
}

/** Bounded depth-first solver with memoised positions. Returns {ok, path, nodes}; ok=null when the cap was hit. */
function solve(M0, cap = 20000) {
  const M = cloneModel(M0), seen = new Set(), path = []; let nodes = 0, aborted = false;
  const key = () => {
    let k = '';
    const cols = M.t.map(C => C.d + ':' + C.c.join(',')); cols.sort();
    k = cols.join('|') + '#' + M.f.join(',') + '#' + M.s.join(',') + '#' + M.w.join(',');
    return k;
  };
  const rec = () => {
    if (won(M)) return true;
    if (++nodes > cap) { aborted = true; return false; }
    const k = key(); if (seen.has(k)) return false; seen.add(k);
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
const derive = (seed, i) => i ? (Math.imul((seed ^ Math.imul(i, 0x9E3779B1)) >>> 0, 0x85EBCA6B) >>> 1) : seed;

// ───────────────────────────── state (resume) ─────────────────────────────
function fromState(st, draw) {
  try {
    if (!st || st.v !== 1 || !Array.isArray(st.t) || st.t.length !== 7 || !Array.isArray(st.f) || st.f.length !== 4) return null;
    const seen = new Set();
    const take = x => { if (!Number.isInteger(x) || x < 0 || x > 51 || seen.has(x)) throw 0; seen.add(x); return x; };
    const t = st.t.map(a => {
      if (!Array.isArray(a) || a.length < 1 || a.length > 53) throw 0;
      const d = a[0], c = a.slice(1).map(take);
      if (!Number.isInteger(d) || d < 0 || d > c.length || (c.length && d === c.length)) throw 0;
      return { c, d };
    });
    const f = st.f.map((n, s) => { if (!Number.isInteger(n) || n < 0 || n > 13) throw 0; for (let r = 0; r < n; r++) take(s * 13 + r); return n; });
    if (!Array.isArray(st.s) || !Array.isArray(st.w)) return null;
    const s = st.s.map(take), w = st.w.map(take);
    if (seen.size !== 52) return null;
    const M = { t, f, s, w, draw };
    const moves = Number.isInteger(st.m) && st.m >= 0 && st.m < 1e6 ? st.m : 0;
    const hist = Array.isArray(st.h) ? st.h.slice(-200).filter(r => Array.isArray(r) && r.every(Number.isInteger) &&
      ((r[0] === 0 && r.length === 2 && r[1] >= 1 && r[1] <= 3) || (r[0] === 1 && r.length === 2) ||
       (r[0] === 2 && r.length === 6 && r[1] >= 0 && r[1] <= 11 && r[3] >= 0 && r[3] <= 11 && (r[4] === 0 || r[4] === 1) && r[5] >= 1 && r[5] <= 13))) : [];
    return { M, moves, hist };
  } catch (_) { return null; }
}

// ───────────────────────────── the game on screen ─────────────────────────────
let instances = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
const TOP_ROW = [12, 7, 8, 9, 10, 11], ORDER = [12, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

class Solitaire {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `sol${++instances}`;
    this.M = null; this.hist = []; this.moves = 0; this._done = false; this.busy = false;
    this.picked = null; this.hint = null; this.loc = new Array(52);
    const root = this.root = document.createElement('div');
    root.className = 'sol';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Solitaire table');
    // static, trusted markup only (suit shapes); nothing dynamic ever goes through innerHTML
    const defs = document.createElementNS(SVGNS, 'svg'); defs.setAttribute('aria-hidden', 'true'); defs.setAttribute('class', 'sol-defs');
    defs.innerHTML = SUIT_PATH.map((d, s) => `<symbol id="${this.ns}-s${s}" viewBox="0 0 100 100"><path d="${d}"/></symbol>`).join('');
    const help = document.createElement('p'); help.className = 'sol-sr'; help.id = `${this.ns}-keys`;
    help.textContent = 'Solitaire. Tab or the arrow keys move between piles. Up and Down move through the face-up cards in a column. ' +
      'Enter moves a card to the best place. Space picks a card up, and Space on another pile drops it there; Escape cancels. ' +
      'U undoes, H gives a hint, D deals from the stock.';
    root.setAttribute('aria-describedby', help.id);
    this.live = null;
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'sol-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); }
    root.append(defs, help); if (this.live) root.append(this.live);
    // piles, in reading / tab order
    this.pileEl = [];
    for (const p of ORDER) {
      const el = document.createElement('div');
      el.className = 'sol-pile ' + (p < 7 ? 'sol-col' : p === 7 ? 'sol-waste' : p === 12 ? 'sol-stock' : 'sol-found');
      el.dataset.p = p; el.tabIndex = 0; el.setAttribute('role', 'group');
      const mark = document.createElement('div'); mark.className = 'sol-mark'; mark.setAttribute('aria-hidden', 'true');
      if (p >= 8 && p <= 11) mark.append(this._icon(p - 8, 'sol-mark-suit'));
      else if (p === 12) { mark.textContent = '↻'; }
      else if (p < 7) { mark.textContent = 'K'; }
      el.append(mark);
      this.pileEl[p] = el; root.append(el);
    }
    // 52 cards
    this.cardEl = [];
    for (let c = 0; c < 52; c++) this.cardEl[c] = this._makeCard(c);
    this.msgEl = document.createElement('div'); this.msgEl.className = 'sol-msg'; this.msgEl.setAttribute('aria-hidden', 'true');
    root.append(this.msgEl);
    host.append(root);
    this._bind();
  }

  _icon(s, cls) {
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVGNS, 'use'); use.setAttribute('href', `#${this.ns}-s${s}`); svg.append(use); return svg;
  }
  _makeCard(c) {
    const el = document.createElement('div'), r = rankOf(c), s = suitOf(c);
    el.className = `sol-card s${s} down`; el.dataset.c = c; el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    const front = document.createElement('div'); front.className = 'sol-front'; front.setAttribute('aria-hidden', 'true');
    const corner = document.createElement('div'); corner.className = 'sol-corner';
    // figures are drawn by CSS (::before), so the card's only text is its spoken name, e.g. "10 of clubs"
    const rk = document.createElement('span'); rk.className = 'sol-rank'; rk.dataset.r = RANK_TXT[r];
    corner.append(rk, this._icon(s, 'sol-pip'));
    const corner2 = corner.cloneNode(true); corner2.className = 'sol-corner sol-corner2';
    const mid = document.createElement('div'); mid.className = 'sol-mid';
    if (r >= 10) { const f = document.createElement('span'); f.className = 'sol-facecard'; f.dataset.r = RANK_TXT[r]; mid.append(f); }
    mid.append(this._icon(s, r >= 10 ? 'sol-big sol-small' : 'sol-big'));
    front.append(corner, mid, corner2);
    const back = document.createElement('div'); back.className = 'sol-back'; back.setAttribute('aria-hidden', 'true');
    el.append(front, back);
    return el;
  }

  // ───── public interface ─────
  async load(recipe, { state } = {}) {
    this.recipe = recipe;
    const restored = state ? fromState(state, recipe.d) : null;
    if (restored) { this.M = restored.M; this.moves = restored.moves; this.hist = restored.hist; }
    else { this.M = dealModel(recipe.s, recipe.d); this.moves = 0; this.hist = []; }
    this._done = won(this.M); this._completed = this._done; this.busy = false; this.picked = null; this._clearHint();
    this.root.classList.toggle('c4', recipe.c !== 2);
    this.root.classList.toggle('draw3', recipe.d === 3);
    this.hooks.onZoomable?.(false);
    this._layout(); this._render(true);
    this._progress();
    if (!this._done) this._maybeAutoFinish();
  }
  state() {
    const M = this.M;
    return { v: 1, t: M.t.map(C => [C.d, ...C.c]), f: M.f.slice(), s: M.s.slice(), w: M.w.slice(), m: this.moves, h: this.hist.slice(-200) };
  }
  progress() { const M = this.M; return { done: M ? M.f[0] + M.f[1] + M.f[2] + M.f[3] : 0, total: 52 }; }
  get done() { return this._done; }
  stats() { return { moves: this.moves }; }
  resize() { if (!this.M) return; this._layout(); this._render(true); }
  destroy() {
    clearTimeout(this._autoT); clearTimeout(this._msgT); clearTimeout(this._hintT); clearTimeout(this._zT); clearTimeout(this._sayT);
    this._unbind?.(); this.root.remove();
  }

  undo() {
    if (this.busy || !this.hist.length || this._done) return;
    const r = this.hist[this.hist.length - 1], before = this._describeUndo(r);
    if (!revert(this.M, r)) { this.hist = []; this._say('Nothing more to undo.'); return; }
    this.hist.pop(); this.moves = Math.max(0, this.moves - 1); this._cancelPick(true); this._clearHint();
    this._render(); this._progress(); this.hooks.onChange?.();
    this._say(`Undone. ${before}`);
  }

  help() {
    if (this.busy || this._done) return;
    if (this.hint && performance.now() < this.hint.until) {               // second press: do it
      const mv = this.hint.mv; this._clearHint(); this._do(mv, 'help'); return;
    }
    const mv = this._findHint();
    if (!mv) { this._say('No more moves here. Try Undo to go back a few steps.', true); return; }
    this._showHint(mv);
  }

  snapshot() {
    const W = 1200, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), ink = this.recipe?.c === 2 ? INK2 : INK4;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2c5649'); bg.addColorStop(1, '#1c3a31');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const cw = 200, ch = 280, top = 70, step = (H - top - ch - 40) / 12;
    for (let s = 0; s < 4; s++) {
      const x = 80 + s * (cw + 80);
      for (let r = 0; r < 13; r++) drawCanvasCard(g, s * 13 + r, x, top + r * step, cw, ch, ink);
    }
    return cv;
  }

  // ───── layout & drawing ─────
  _layout() {
    const W = Math.max(1, this.host.clientWidth), H = Math.max(1, this.host.clientHeight);
    const scale = Math.min(2, Math.max(1, parseFloat(getComputedStyle(this.host).getPropertyValue('--card-scale')) || 1));
    const gapR = 0.12, m = 8;
    const byW = (W - 2 * m) / (7 + 6 * gapR);
    const byH = (H - 2 * m) / (1.4 + 0.3 + 1.4 + 6 * 0.32);
    const cw = Math.max(30, Math.min(byW, byH, 170 * scale));
    const ch = cw * 1.4, gap = cw * gapR, total = 7 * cw + 6 * gap;
    const rankR = Math.min(0.46, 0.34 * Math.min(1.35, scale));       // larger print enlarges the corner figures
    const x0 = Math.max(m, (W - total) / 2), y0 = m + Math.min(10, cw * 0.08);
    this.G = { W, H, cw, ch, gap, x0, y0, tabY: y0 + ch + cw * 0.3, rankR,
      upOff: cw * (rankR + 0.1), downOff: cw * 0.18, fan: cw * 0.3 };
    const st = this.root.style;
    st.setProperty('--cw', cw + 'px'); st.setProperty('--ch', ch + 'px');
    st.setProperty('--rk', Math.round(cw * rankR) + 'px'); st.setProperty('--pip', Math.round(cw * rankR * 0.72) + 'px');
  }
  _colX(i) { return this.G.x0 + i * (this.G.cw + this.G.gap); }
  _pilePos(p) {
    const G = this.G;
    if (p === 12) return [this._colX(0), G.y0];
    if (p === 7) return [this._colX(1), G.y0];
    if (p >= 8) return [this._colX(3 + p - 8), G.y0];
    return [this._colX(p), G.tabY];
  }
  /** Vertical offsets for a column, squeezed to fit the screen (never below a readable sliver). */
  _colOffsets(C) {
    const G = this.G, n = C.c.length, d = C.d, up = n - d;
    let dOff = G.downOff, uOff = G.upOff;
    const avail = G.H - G.tabY - 8 - G.ch;
    const need = d * dOff + Math.max(0, up - 1) * uOff;
    if (need > avail && n > 1) {
      dOff = Math.max(G.cw * 0.08, Math.min(dOff, (avail - Math.max(0, up - 1) * uOff) / Math.max(1, d)));
      const rest = avail - d * dOff;
      if (up > 1) uOff = Math.max(Math.max(24, G.cw * 0.24), Math.min(uOff, rest / (up - 1)));
    }
    const ys = []; let y = 0;
    for (let i = 0; i < n; i++) { ys.push(y); y += i < d ? dOff : uOff; }
    return ys;
  }
  _cardsOf(p) {
    const M = this.M;
    if (p < 7) return M.t[p].c; if (p === 7) return M.w; if (p === 12) return M.s;
    const s = p - 8, out = []; for (let r = 0; r < M.f[s]; r++) out.push(s * 13 + r); return out;
  }

  _render(instant = false) {
    const M = this.M, G = this.G, anim = !instant && !reducedMotion();
    const active = document.activeElement, activeCard = active?.classList?.contains('sol-card') ? +active.dataset.c : -1;
    const flips = [], moved = [];
    for (const p of ORDER) {
      const pel = this.pileEl[p], [px, py] = this._pilePos(p), cards = this._cardsOf(p);
      let ys = null; if (p < 7) ys = this._colOffsets(M.t[p]);
      const h = p < 7 && cards.length ? ys[ys.length - 1] + G.ch : G.ch;
      const w = p === 7 && M.draw === 3 ? G.cw + 2 * G.fan : G.cw;
      Object.assign(pel.style, { left: px + 'px', top: py + 'px', width: (p === 7 ? G.cw : w) + 'px', height: h + 'px' });
      pel.classList.toggle('empty', !cards.length);
      pel.classList.toggle('can-recycle', p === 12 && !M.s.length && M.w.length > 0);
      pel.setAttribute('aria-label', this._pileLabel(p));
      // keep the DOM order = stacking order (bottom → top), so screen readers read top-down correctly
      const kids = [...pel.querySelectorAll(':scope > .sol-card')].map(e => +e.dataset.c);
      const same = kids.length === cards.length && kids.every((c, i) => c === cards[i]);
      cards.forEach((c, i) => {
        const el = this.cardEl[c];
        let lx = 0, ly = 0, up = true, access = false;
        if (p < 7) { ly = ys[i]; up = i >= M.t[p].d; access = up; }
        else if (p === 12) { up = false; }
        else if (p === 7) { const k = cards.length - 1 - i; if (M.draw === 3 && k < 3) lx = (Math.min(3, cards.length) - 1 - k) * G.fan; access = i === cards.length - 1; }
        else access = i === cards.length - 1;
        this.loc[c] = { p, i };
        el.classList.toggle('down', !up);
        // only the top card of a stacked pile casts a shadow (24 stacked shadows make a dark smudge)
        el.classList.toggle('stacked', p >= 7 && i < cards.length - (p === 7 && M.draw === 3 ? 3 : 1));
        if (access) { el.removeAttribute('aria-hidden'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', cap(cardName(c)) + (this._isPicked(c) ? ', picked up' : '')); }
        else { el.setAttribute('aria-hidden', 'true'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
        const z = (p === 12 ? 100 : p === 7 ? 200 : p >= 8 ? 300 : 400) + i;
        const rx = px + lx, ry = py + ly, parentChanged = el.parentNode !== pel;
        if (!same) pel.append(el);                       // re-append in order (moves the node; position handled below)
        if (anim && parentChanged && el._rx != null && (el._rx !== rx || el._ry !== ry)) {
          el.style.transition = 'none'; el.style.transform = `translate(${el._rx - px}px,${el._ry - py}px)`; flips.push([el, lx, ly]);
        } else el.style.transform = `translate(${lx}px,${ly}px)`;
        if (el._rx !== rx || el._ry !== ry) moved.push(el);
        el._rx = rx; el._ry = ry; el._z = z;
        el.style.zIndex = z;
      });
    }
    if (flips.length) { void this.root.offsetWidth; for (const [el, lx, ly] of flips) { el.style.transition = ''; el.style.transform = `translate(${lx}px,${ly}px)`; } }
    if (anim && moved.length) {                       // moving cards fly above everything, then settle
      for (const el of moved) el.style.zIndex = 2000 + el._z;
      clearTimeout(this._zT); this._zT = setTimeout(() => { for (const el of moved) el.style.zIndex = el._z; }, 330);
    }
    this.root.classList.toggle('instant', instant);
    if (instant) requestAnimationFrame(() => this.root.classList.remove('instant'));
    if (activeCard >= 0 && document.activeElement !== this.cardEl[activeCard]) {       // re-appending blurred it
      const el = this.cardEl[activeCard]; if (el.getAttribute('role') === 'button') el.focus({ preventScroll: true });
      else this.pileEl[this.loc[activeCard].p]?.focus({ preventScroll: true });
    }
  }
  _pileLabel(p) {
    const M = this.M;
    if (p === 12) return M.s.length ? `Stock, ${M.s.length} card${M.s.length === 1 ? '' : 's'}. Press Enter to deal.`
      : M.w.length ? 'Stock, empty. Press Enter to turn the waste back over.' : 'Stock, empty.';
    if (p === 7) return M.w.length ? `Waste, ${M.w.length} card${M.w.length === 1 ? '' : 's'}, top: ${cardName(M.w[M.w.length - 1])}` : 'Waste, empty';
    if (p >= 8) { const s = p - 8; return M.f[s] ? `${SUIT_TITLE[s]} foundation, ${M.f[s]} of 13, top: ${cardName(s * 13 + M.f[s] - 1)}` : `${SUIT_TITLE[s]} foundation, empty`; }
    const C = M.t[p];
    if (!C.c.length) return `Column ${p + 1}, empty. A king can go here.`;
    const up = C.c.length - C.d;
    return `Column ${p + 1}, ${C.d ? `${C.d} face-down, ` : ''}${up} face-up, top: ${cardName(C.c[C.c.length - 1])}`;
  }
  _progress() { const { done, total } = this.progress(); this.hooks.onProgress?.(done, total); }

  // ───── announcements & on-table messages ─────
  _say(text, visual = false) {
    if (visual) { this.msgEl.textContent = text; this.msgEl.classList.add('show'); clearTimeout(this._msgT); this._msgT = setTimeout(() => this.msgEl.classList.remove('show'), 4200); }
    if (this.hooks.announce) { this.hooks.announce(text); return; }
    const r = this.live; r.textContent = ''; clearTimeout(this._sayT); this._sayT = setTimeout(() => { r.textContent = text; }, 40);
  }

  // ───── moves ─────
  _run(from, i) {
    const M = this.M;
    if (from < 7) { const C = M.t[from]; if (i < C.d || i >= C.c.length) return null; return C.c.slice(i); }
    if (from === 7) return M.w.length ? [M.w[M.w.length - 1]] : null;
    if (from >= 8 && from <= 11) { const s = from - 8; return M.f[s] ? [s * 13 + M.f[s] - 1] : null; }
    return null;
  }
  _legal(mv) {
    const M = this.M;
    if (mv.k === 0) return M.s.length > 0 || M.w.length > 0;
    const run = this._run(mv.from, mv.i); if (!run) return false;
    if (mv.to === mv.from) return false;
    if (mv.to >= 8 && mv.to <= 11) return run.length === 1 && mv.to === 8 + suitOf(run[0]) && canFound(M, run[0]);
    if (mv.to < 7) return canTab(M, run[0], mv.to);
    return false;
  }
  _why(run, to) {
    const M = this.M, c = run[0], name = cap(cardName(c));
    if (to === 7 || to === 12) return "Cards can't be put there.";
    if (to >= 8) {
      if (run.length > 1) return 'Only one card at a time can go home.';
      const s = to - 8;
      if (suitOf(c) !== s) return `${name} belongs on the ${SUIT_NAME[suitOf(c)]} foundation.`;
      return M.f[s] ? `The ${SUIT_NAME[s]} foundation needs the ${RANK_NAME[M.f[s]]} next.` : `The ${SUIT_NAME[s]} foundation starts with the ace.`;
    }
    if (!M.t[to].c.length) return 'Only a king can go in an empty column.';
    if (rankOf(c) === 12) return 'A king can only go in an empty column.';
    // Name the suits, not colours: in the four-colour deck diamonds are blue and clubs green,
    // so "red" or "black" would point at the wrong-looking cards.
    const want = isRed(c) ? 'club or spade' : 'heart or diamond', rank = RANK_NAME[rankOf(c) + 1];
    return this.recipe?.c === 2 ? `${name} needs a ${isRed(c) ? 'black' : 'red'} ${rank} (${want}) to sit on.` : `${name} needs a ${want} ${rank} to sit on.`;
  }
  /** The best single move for a card (tap / Enter): home when safe, else a helpful column, else home. */
  _best(from, i) {
    const M = this.M, run = this._run(from, i); if (!run) return null;
    const c = run[0];
    const home = run.length === 1 && from < 8 && canFound(M, c) ? { k: 2, from, i, to: 8 + suitOf(c) } : null;
    if (home && safeHome(M, c)) return home;
    let best = null, score = -1;
    for (let b = 0; b < 7; b++) {
      if (b === from) continue; const B = M.t[b];
      if (!B.c.length) { if (rankOf(c) !== 12 || (from < 7 && i === 0)) continue; }
      else if (!canTab(M, c, b)) continue;
      const sc = (B.c.length ? 2 : 0) + (from < 7 && i === M.t[from].d && M.t[from].d > 0 ? 3 : 0) + (from === 7 ? 1 : 0);
      if (sc > score) { score = sc; best = { k: 2, from, i, to: b }; }
    }
    return best || home;
  }
  _do(mv, how) {
    if (!this._legal(mv)) return false;
    const run = mv.k === 2 ? this._run(mv.from, mv.i) : null;
    const r = apply(this.M, mv);
    this.hist.push(r); this.moves++; this._cancelPick(true); this._clearHint();
    this._render();
    this._say(this._describe(r, run));
    if (mv.k === 2 && mv.to >= 8) this.hooks.onPlace?.(won(this.M));
    this._progress(); this.hooks.onChange?.();
    if (how === 'key' && mv.k === 2) this.pileEl[mv.from]?.focus({ preventScroll: true });
    if (won(this.M)) this._finish(); else this._maybeAutoFinish();
    return true;
  }
  _describe(r, run) {
    const M = this.M;
    if (r[0] === 0) {
      const top = M.w[M.w.length - 1], left = `${M.s.length} left in the stock.`;
      return r[1] === 1 ? `Dealt ${cardName(top)}. ${left}` : `Dealt ${r[1]} cards, ${cardName(top)} on top. ${left}`;
    }
    if (r[0] === 1) return `Turned the waste over. ${M.s.length} cards back in the stock.`;
    const [, from, , to, flip] = r, n = run.length;
    let t = n > 1 ? `${n} cards, ${cardName(run[0])} to ${cardName(run[n - 1])}, moved to ${pileName(to)}.` : `${cap(cardName(run[0]))} moved to ${pileName(to)}.`;
    if (to >= 8) t += ` ${this.progress().done} of 52 cards home.`;
    if (flip) { const C = M.t[from].c; t += ` Revealed ${cardName(C[C.length - 1])} in column ${from + 1}.`; }
    else if (from < 7 && !M.t[from].c.length) t += ` Column ${from + 1} is now empty.`;
    return t;
  }
  _describeUndo(r) {
    if (r[0] === 0) return `${r[1] === 1 ? 'The card goes' : `${r[1]} cards go`} back on the stock.`;
    if (r[0] === 1) return 'The waste is back.';
    const [, from, , to, , n] = r, cards = to < 7 ? this.M.t[to].c.slice(-n) : [(to - 8) * 13 + this.M.f[to - 8] - 1];
    return `${cap(cardName(cards[0]))}${n > 1 ? ` and ${n - 1} more` : ''} back to ${pileName(from)}.`;
  }
  _finish() {
    this._done = true; this.busy = false; clearTimeout(this._autoT);
    this._say(`You won! All 52 cards are home in ${this.moves} moves.`, true);
    if (!this._completed) { this._completed = true; this.hooks.onComplete?.(); }
  }
  /** Everything face up and nothing left to deal → cards go home by themselves. */
  _maybeAutoFinish() {
    const M = this.M;
    if (this._done || this.busy || M.s.length || M.w.length || M.t.some(C => C.d > 0)) return;
    this.busy = true; this._cancelPick(true); this._clearHint();
    this._say('All cards are face up. Putting them home for you.', true);
    let n = 0;
    const step = () => {
      if (won(M)) { this.busy = false; this._finish(); return; }
      let pick = -1, low = 99;
      for (let i = 0; i < 7; i++) { const C = M.t[i].c; if (C.length && canFound(M, C[C.length - 1]) && rankOf(C[C.length - 1]) < low) { low = rankOf(C[C.length - 1]); pick = i; } }
      if (pick < 0) { this.busy = false; return; }                      // shouldn't happen; hand control back
      const C = M.t[pick].c, c = C[C.length - 1];
      const r = apply(M, { k: 2, from: pick, i: C.length - 1, to: 8 + suitOf(c) });
      this.hist.push(r); this.moves++; this._render(); this._progress();
      if (++n % 4 === 0 || won(M)) this.hooks.onPlace?.(won(M));
      this._autoT = setTimeout(step, reducedMotion() ? 30 : 140);
    };
    this._autoT = setTimeout(step, reducedMotion() ? 30 : 500);
    this.hooks.onChange?.();
  }

  // ───── hints ─────
  _findHint() {
    const res = solve(this.M, 8000);
    if (res.ok && res.path.length) return res.path[0];
    const moves = gen(this.M);
    // skip pure shuffling: moving a whole, fully face-up column to another column reveals nothing
    for (const mv of moves) {
      if (mv.k === 0) continue;
      if (mv.from < 7 && mv.to < 7 && mv.i === 0 && this.M.t[mv.from].d === 0) continue;
      return mv;
    }
    return moves.find(mv => mv.k === 0) || null;
  }
  _showHint(mv) {
    this._clearHint();
    const els = [];
    let text;
    if (mv.k === 0) {
      els.push(this.M.s.length ? this.cardEl[this.M.s[this.M.s.length - 1]] : this.pileEl[12]);
      text = this.M.s.length ? 'Hint: turn over a card from the stock.' : 'Hint: turn the waste back over to go through the stock again.';
    } else {
      const run = this._run(mv.from, mv.i); for (const c of run) els.push(this.cardEl[c]);
      const T = mv.to < 7 ? this.M.t[mv.to].c : null;
      els.push(T && T.length ? this.cardEl[T[T.length - 1]] : this.pileEl[mv.to]);
      text = `Hint: move ${cardName(run[0])}${run.length > 1 ? ` and the ${run.length - 1} card${run.length > 2 ? 's' : ''} on it` : ''} from ${pileName(mv.from)} to ${pileName(mv.to)}.`;
    }
    for (const el of els) el.classList.add('hint');
    this.hint = { mv, els, until: performance.now() + 6000 };
    this._say(`${text} Press Help again and I'll do it.`, true);
    clearTimeout(this._hintT); this._hintT = setTimeout(() => this._clearHint(), 6000);
  }
  _clearHint() { if (this.hint) { for (const el of this.hint.els) el.classList.remove('hint'); this.hint = null; } clearTimeout(this._hintT); }

  // ───── picking up (keyboard / screen reader two-step move) ─────
  _isPicked(c) { if (!this.picked) return false; const run = this._run(this.picked.p, this.picked.i); return !!run && run.includes(c); }
  _pick(p, i) {
    const run = this._run(p, i);
    if (!run) { this._say('There is no card to pick up here.'); return; }
    this._cancelPick(true);
    this.picked = { p, i };
    for (const c of run) this.cardEl[c].classList.add('picked');
    this._render(true);
    this._say(`Picked up ${cardName(run[0])}${run.length > 1 ? ` and ${run.length - 1} more` : ''}. Move to a pile and press Space to drop it there, or Escape to cancel.`);
  }
  _cancelPick(quiet) {
    if (!this.picked) return;
    for (const el of this.cardEl) el.classList.remove('picked');
    this.picked = null;
    if (!quiet) { this._render(true); this._say('Put back.'); }
  }
  _drop(to) {
    const { p, i } = this.picked, run = this._run(p, i);
    if (!run) { this._cancelPick(true); return; }
    if (to === p) { this._cancelPick(); return; }
    const mv = { k: 2, from: p, i, to: to >= 8 && to <= 11 ? 8 + suitOf(run[0]) : to };
    if (to >= 8 && to <= 11 && to !== mv.to) { this._say(`${this._why(run, to)} Still holding it.`); return; }
    if (!this._do(mv, 'key')) this._say(`Can't go there. ${this._why(run, to)} Still holding it.`);
  }

  // ───── input ─────
  _bind() {
    const root = this.root;
    let press = null, suppressClick = 0;
    const pt = e => { const r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = e => {
      if (!this.M || this.busy || this._done || (e.button && e.button !== 0)) return;
      this.hooks.onTouch?.();
      const [x, y] = pt(e), cardEl = e.target.closest?.('.sol-card'), pileEl = e.target.closest?.('.sol-pile');
      press = { id: e.pointerId, x, y, slop: e.pointerType === 'mouse' ? 6 : 16, kind: 'none', drag: false };
      if (cardEl) {
        const c = +cardEl.dataset.c, L = this.loc[c];
        if (L.p === 12) press.kind = 'stock';
        else if (L.p < 7 && L.i >= this.M.t[L.p].d) Object.assign(press, { kind: 'run', from: L.p, i: L.i });
        else if (L.p === 7 && L.i === this.M.w.length - 1) Object.assign(press, { kind: 'run', from: 7, i: -1 });
        else if (L.p >= 8 && L.p <= 11 && L.i === this.M.f[L.p - 8] - 1) Object.assign(press, { kind: 'run', from: L.p, i: -1 });
      } else if (pileEl) press.kind = +pileEl.dataset.p === 12 ? 'stock' : 'pile', press.pile = +pileEl.dataset.p;
      if (press.kind === 'run') {
        const run = this._run(press.from, press.i), lead = this.cardEl[run[0]];
        press.run = run; press.gx = x - lead._rx; press.gy = y - lead._ry;
      }
      try { root.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const move = e => {
      if (!press || e.pointerId !== press.id || press.kind !== 'run') return;
      const [x, y] = pt(e);
      if (!press.drag) {
        if (Math.hypot(x - press.x, y - press.y) <= press.slop) return;
        press.drag = true; this._cancelPick(true); this._clearHint();
        for (const c of press.run) { const el = this.cardEl[c]; el.classList.add('drag'); }
      }
      const [px, py] = this._pilePos(press.from), G = this.G;
      press.run.forEach((c, k) => {
        const el = this.cardEl[c];
        el.style.transform = `translate(${x - press.gx - px}px,${y - press.gy - py + k * G.upOff}px)`;
        el.style.zIndex = 3000 + k;
      });
      press.lx = x - press.gx; press.ly = y - press.gy;
    };
    const up = e => {
      if (!press || e.pointerId !== press.id) return;
      const P = press; press = null;
      if (P.drag) {
        for (const c of P.run) this.cardEl[c].classList.remove('drag');
        const to = this._dropTarget(P.lx + this.G.cw / 2, P.ly + this.G.ch / 2, P);
        const mv = to == null ? null : { k: 2, from: P.from, i: P.i, to };
        if (!mv || !this._do(mv, 'drag')) {
          this._render();                                           // glide back, gently
          if (to != null) this._say(`Can't go there. ${this._why(P.run, to)}`, true);
        }
        suppressClick = performance.now(); return;
      }
      if (P.kind === 'none') return;
      suppressClick = performance.now();
      this._activate(P);
    };
    const cancel = e => { if (press && e.pointerId === press.id) { const P = press; press = null; if (P.drag) { for (const c of P.run) this.cardEl[c].classList.remove('drag'); this._render(); } } };
    // clicks that didn't come through pointer events (e.g. VoiceOver double-tap, switch access)
    const click = e => {
      if (performance.now() - suppressClick < 600 || !this.M || this.busy || this._done) return;
      const cardEl = e.target.closest?.('.sol-card'), pileEl = e.target.closest?.('.sol-pile');
      if (cardEl && cardEl.getAttribute('role') === 'button') { const L = this.loc[+cardEl.dataset.c]; this._activate({ kind: 'run', from: L.p, i: L.p < 7 ? L.i : -1 }); }
      else if (pileEl) { const p = +pileEl.dataset.p; this._activatePile(p); }
    };
    const key = e => this._key(e);
    root.addEventListener('pointerdown', down); root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancel);
    root.addEventListener('click', click); root.addEventListener('keydown', key);
    this._unbind = () => {
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('click', click); root.removeEventListener('keydown', key);
    };
  }
  _activate(P) {
    if (P.kind === 'stock') { this._deal(); return; }
    if (P.kind === 'pile') { this._activatePile(P.pile); return; }
    if (P.kind !== 'run') return;
    if (this.picked) { this._drop(P.from); return; }
    const mv = this._best(P.from, P.i);
    if (mv) { this._do(mv, 'tap'); return; }
    const run = this._run(P.from, P.i); if (!run) return;
    for (const c of run) { const el = this.cardEl[c]; el.classList.remove('wiggle'); void el.offsetWidth; el.classList.add('wiggle'); }
    this._say(`No place for ${cardName(run[0])} right now.`);
  }
  _activatePile(p) {
    if (p === 12) { this._deal(); return; }
    if (this.picked) { this._drop(p); return; }
    const cards = this._cardsOf(p);
    if (!cards.length) { this._say(this._pileLabel(p)); return; }
    this._activate({ kind: 'run', from: p, i: p < 7 ? cards.length - 1 : -1 });
  }
  _deal() {
    const M = this.M;
    if (!M.s.length && !M.w.length) { this._say('The stock and waste are both empty.'); return; }
    this._do({ k: 0 }, 'tap');
  }
  _dropTarget(cx, cy, P) {
    const G = this.G, run = P.run, c = run[0];
    if (cy < G.tabY - G.ch * 0.15) {                                   // anywhere in the top row → its foundation
      if (run.length === 1 && P.from < 8 && cx > this._colX(2) + G.cw * 0.5) return 8 + suitOf(c);
      return null;
    }
    let best = null, bd = Infinity;
    for (let b = 0; b < 7; b++) {
      const x = this._colX(b); if (b === P.from) continue;
      if (cx < x - G.gap * 0.5 - G.cw * 0.25 || cx > x + G.cw + G.gap * 0.5 + G.cw * 0.25) continue;
      const d = Math.abs(cx - (x + G.cw / 2)); if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  _focusInfo() {
    const a = document.activeElement; if (!a || !this.root.contains(a)) return null;
    if (a.classList.contains('sol-card')) { const L = this.loc[+a.dataset.c]; return { p: L.p, i: L.i, card: +a.dataset.c }; }
    if (a.classList.contains('sol-pile')) return { p: +a.dataset.p, i: null };
    return null;
  }
  _focusPile(p) { this.pileEl[p]?.focus({ preventScroll: true }); }
  _key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const f = this._focusInfo(), k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'u' || k === 'U') { handled(); this.undo(); return; }
    if (k === 'h' || k === 'H') { handled(); this.help(); return; }
    if (k === 'd' || k === 'D') { handled(); if (!this.busy && !this._done) this._deal(); return; }
    if (k === 'Escape') { if (this.picked) { handled(); this._cancelPick(); return; } if (f && f.i != null && f.p < 7) { handled(); this._focusPile(f.p); } return; }
    if (!f) return;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      handled();
      const row = f.p < 7 ? [0, 1, 2, 3, 4, 5, 6] : TOP_ROW, idx = row.indexOf(f.p);
      const n = row[Math.max(0, Math.min(row.length - 1, idx + (k === 'ArrowRight' ? 1 : -1)))];
      this._focusPile(n); return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      handled();
      if (f.p >= 7) {                                                  // top row → column below
        if (k === 'ArrowDown') this._focusPile(f.p === 12 ? 0 : f.p === 7 ? 1 : 3 + (f.p - 8));
        return;
      }
      const C = this.M.t[f.p];
      if (k === 'ArrowUp') {
        if (f.i == null) { this._focusPile(f.p === 0 ? 12 : f.p <= 2 ? 7 : 8 + (f.p - 3)); return; }
        if (f.i - 1 >= C.d) this.cardEl[C.c[f.i - 1]].focus({ preventScroll: true }); else this._focusPile(f.p);
        return;
      }
      if (!C.c.length) return;
      if (f.i == null) { this.cardEl[C.c[C.d]].focus({ preventScroll: true }); return; }
      if (f.i + 1 < C.c.length) this.cardEl[C.c[f.i + 1]].focus({ preventScroll: true });
      else this._say(`${cap(cardName(C.c[f.i]))} is the top card of column ${f.p + 1}.`);
      return;
    }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      handled();
      if (this.busy || this._done) return;
      if (f.p === 12) { if (this.picked) this._say("Cards can't be put on the stock. Still holding it."); else this._deal(); return; }
      if (k === 'Enter') {
        if (this.picked) { this._drop(f.p); return; }
        if (f.i != null && f.p < 7) { const mv = this._best(f.p, f.i); if (mv) this._do(mv, 'key'); else this._say(`No place for ${cardName(this.M.t[f.p].c[f.i])} right now.`); return; }
        this._activatePileKey(f.p); return;
      }
      // Space: pick up / drop
      if (this.picked) { this._drop(f.p); return; }
      const cards = this._cardsOf(f.p); if (!cards.length) { this._say(this._pileLabel(f.p)); return; }
      if (f.p < 7) this._pick(f.p, f.i != null ? f.i : cards.length - 1);
      else this._pick(f.p, -1);
    }
  }
  _activatePileKey(p) {
    const cards = this._cardsOf(p); if (!cards.length) { this._say(this._pileLabel(p)); return; }
    const mv = this._best(p, p < 7 ? cards.length - 1 : -1);
    if (mv) this._do(mv, 'key'); else this._say(`No place for ${cardName(cards[cards.length - 1])} right now.`);
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
const solitaire = {
  id: 'solitaire', name: 'Solitaire', emoji: '🃏',
  blurb: 'Classic patience — tap a card to move it',
  usesPicture: false, zoomable: false,
  options: [
    { key: 'draw', label: 'Turn over', choices: [[1, 'One card (easier)'], [3, 'Three cards']], default: 1 },
    { key: 'colors', label: 'Card colours', choices: [[4, 'Four colours (easier to see)'], [2, 'Classic red & black']], default: 4 },
  ],
  /** A deal proven winnable by the solver: try the seed, then seeds derived from it, until one solves. */
  newRecipe(seed, opts = {}) {
    const d = opts.draw === 3 ? 3 : 1, c = opts.colors === 2 ? 2 : 4;
    const base = (Number(seed) >>> 0) & 0x7fffffff;
    for (let i = 0; i < 40; i++) {
      const s = derive(base, i) & 0x7fffffff;
      if (solve(dealModel(s, d), 20000).ok) return { g: 'solitaire', s, d, c };
    }
    return { g: 'solitaire', s: base, d, c };                         // very unlikely: fall back unproven
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'solitaire') return null;
    const { s, d, c } = r;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
    if (d !== 1 && d !== 3) return null;
    if (c !== 2 && c !== 4) return null;
    return { g: 'solitaire', s, d, c };
  },
  title(r) { return `Solitaire · deal ${1000 + (r.s % 9000)}`; },
  progressLabel(done, total) { return `${done} of ${total} cards home`; },
  noun: 'cards',
  describe(r) { return `Klondike · turn ${r.d === 3 ? 'three cards' : 'one card'} · ${r.c === 2 ? 'red & black' : 'four-colour'} deck`; },
  finishText(r, seconds, stats) {
    const mins = Math.max(1, Math.round((seconds || 0) / 60)), moves = stats?.moves;
    return `You won${moves ? ` in ${moves} moves` : ''} and ${mins} minute${mins === 1 ? '' : 's'}!`;
  },
  create(host, hooks) { return new Solitaire(host, hooks); },
  // internals, exported for tests only
  _internal: { dealModel, solve, apply, revert, gen, won, cloneModel, cardName, fromState },
};
export default solitaire;
