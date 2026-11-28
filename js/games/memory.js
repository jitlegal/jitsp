// Memory — a game plug-in for the family games shell (see GAMES.md).
//
// Turn over two cards; if they match they stay face up. No timers: a mismatched pair stays visible for
// 1.5 s (3 s with reduced motion) or until the next tap. Each face is a small painted scene with a big
// emoji and a printed name, so pairs are easy to tell apart without fine detail.
//
// Accessible: the cards are an ARIA grid with a roving tab stop; arrow keys move, Enter/Space turns a card,
// H asks for help. Every card has a spoken name ("Row 2, column 3, face down" / "Teapot, matched").
// Deterministic: { g:'memory', s:seed, p:pairs } deals the same cards on every device.
import { paintScene, SCENES } from '../scenes.js';

const FACES = [
  ['Sun', '☀️', '#ffe08a'], ['Moon', '🌙', '#c9d6ff'], ['Star', '⭐', '#fff1a8'], ['Apple', '🍎', '#ffc9c2'],
  ['Cat', '🐱', '#ffe2c2'], ['Dog', '🐶', '#e8d7c3'], ['Bird', '🐦', '#cde9ff'], ['Boat', '⛵', '#bfe6f5'],
  ['House', '🏠', '#ffd9b3'], ['Tree', '🌳', '#cdeec0'], ['Heart', '❤️', '#ffd0dc'], ['Cake', '🎂', '#f8d9f0'],
  ['Fish', '🐟', '#c6ecf0'], ['Butterfly', '🦋', '#dcd3ff'], ['Umbrella', '☂️', '#e3d3f5'], ['Bicycle', '🚲', '#d9ecd0'],
  ['Strawberry', '🍓', '#ffd3d3'], ['Sunflower', '🌻', '#fff0b0'], ['Rainbow', '🌈', '#e0f0ff'], ['Owl', '🦉', '#ead9c6'],
  ['Train', '🚂', '#dcdcdc'], ['Balloon', '🎈', '#ffd6d0'], ['Snowman', '⛄', '#e6f4ff'], ['Teacup', '☕', '#f1e0cc'],
].map(([name, emoji, bg], i) => ({ name, emoji, bg, scene: SCENES[i % SCENES.length].id }));
const PAIRS = [6, 10, 15];

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Deal for a recipe: deck[i] = face index (each appears twice). Pure + deterministic. */
function deal(s, p) {
  const r = rng(s ^ 0x3E3071);
  const faces = shuffle([...FACES.keys()], r).slice(0, p);
  return shuffle([...faces, ...faces], r);
}
const motionReduced = () => document.documentElement.dataset.motion === 'reduce' || matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let instances = 0;

class Memory {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `mem${++instances}`;
    this.timer = 0; this.peekTimer = 0; this.sel = 0;
    const root = this.root = document.createElement('div'); root.className = 'mem';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Memory game');
    const keys = document.createElement('p'); keys.className = 'mem-sr'; keys.id = `${this.ns}-keys`;
    keys.textContent = 'Find the matching pairs. Arrow keys move between cards. Enter or Space turns a card over. H shows where a pair is.';
    this.live = null;
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'mem-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); }
    this.grid = document.createElement('div'); this.grid.className = 'mem-grid';
    this.grid.setAttribute('role', 'grid'); this.grid.setAttribute('aria-describedby', keys.id);
    root.append(keys, this.grid); if (this.live) root.append(this.live);
    host.append(root);
    this._bind();
  }

  // ───── shell API ─────
  async load(recipe, { state } = {}) {
    this.recipe = recipe; this.deck = deal(recipe.s, recipe.p);
    this.matched = new Set(); this.up = []; this.turns = 0; this.hints = 0;
    if (state && typeof state === 'object' && state.v === 1) {
      const n = this.deck.length;
      if (Array.isArray(state.m)) for (const f of state.m.slice(0, 30)) if (Number.isInteger(f) && this.deck.includes(f)) this.matched.add(f);
      if (Number.isInteger(state.u) && state.u >= 0 && state.u < n && !this.matched.has(this.deck[state.u])) this.up = [state.u];
      const num = x => Number.isInteger(x) && x >= 0 && x < 1e6 ? x : 0;
      this.turns = num(state.t); this.hints = num(state.h);
    }
    this._done = this.matched.size === this.recipe.p;
    this._build(); this.resize(); this._paint(); this._progress();
  }
  state() { return { v: 1, m: [...this.matched], u: this.up.length === 1 ? this.up[0] : -1, t: this.turns, h: this.hints }; }
  progress() { return { done: this.matched.size, total: this.recipe ? this.recipe.p : 0 }; }
  get done() { return this._done; }
  stats() { return { turns: this.turns, hints: this.hints }; }
  destroy() { clearTimeout(this.timer); clearTimeout(this.peekTimer); this.root.remove(); }

  help() {
    if (this._done) return;
    this._settle();
    let f;
    if (this.up.length === 1) f = this.deck[this.up[0]];
    else f = this.deck.find(x => !this.matched.has(x));
    const where = this.deck.map((x, i) => x === f ? i : -1).filter(i => i >= 0 && !this.up.includes(i));
    this.hints++;
    for (const i of where) this.cards[i].classList.add('mem-peek');
    this._paint();
    clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => { for (const c of this.cards) c.classList.remove('mem-peek'); this._paint(); }, motionReduced() ? 3500 : 2000);
    this._say(`Have a peek: ${where.length === 1 ? 'its partner, the' : 'the two'} ${FACES[f].name} card${where.length === 1 ? ' is' : 's are'} at ${where.map(i => this._pos(i)).join(' and ')}.`);
    this.hooks.onChange?.();
  }

  snapshot() {
    const W = 1200, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fbf4e6'; g.fillRect(0, 0, W, H);
    const n = this.deck.length, [cols, rows] = this._shape(W, H - 80, n), gap = 14;
    const cw = Math.min((W - gap * (cols + 1)) / cols, ((H - 80 - gap * (rows + 1)) / rows) * 0.8), ch = cw * 1.25;
    const ox = (W - cols * cw - (cols - 1) * gap) / 2, oy = 20 + (H - 80 - rows * ch - (rows - 1) * gap) / 2;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    this.deck.forEach((f, i) => {
      const x = ox + (i % cols) * (cw + gap), y = oy + ((i / cols) | 0) * (ch + gap), F = FACES[f];
      g.fillStyle = F.bg; g.fillRect(x, y, cw, ch);
      g.drawImage(this._art(f), x, y, cw, ch * 0.62);
      g.font = `${Math.round(cw * 0.42)}px "Noto Color Emoji", system-ui`; g.fillText(F.emoji, x + cw / 2, y + ch * 0.36);
      g.fillStyle = '#2b2118'; g.font = `700 ${Math.round(cw * 0.15)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
      g.fillText(F.name, x + cw / 2, y + ch * 0.82);
      g.strokeStyle = '#2b2118'; g.lineWidth = 3; g.strokeRect(x, y, cw, ch);
    });
    g.fillStyle = '#2b2118'; g.font = '600 40px Georgia, serif';
    g.fillText(`Memory · ${this.recipe.p} pairs in ${this.turns} turns`, W / 2, H - 40);
    return c;
  }

  resize() {
    if (!this.deck) return;
    const W = Math.max(200, this.host.clientWidth || innerWidth), H = Math.max(200, this.host.clientHeight || innerHeight), pad = 12, gap = 10;
    const n = this.deck.length, [cols, rows] = this._shape(W - 2 * pad, H - 2 * pad, n);
    let cw = (W - 2 * pad - gap * (cols - 1)) / cols, ch = (H - 2 * pad - gap * (rows - 1)) / rows;
    ch = Math.min(ch, cw * 1.4); cw = Math.min(cw, ch * 1.1);
    cw = Math.max(56, Math.floor(cw)); ch = Math.max(56, Math.floor(ch));
    this.root.style.setProperty('--cw', cw + 'px'); this.root.style.setProperty('--ch', ch + 'px');
    this.grid.style.gridTemplateColumns = `repeat(${cols}, var(--cw))`;
    if (this.cols !== cols) { this.cols = cols; this._rows(); }
  }

  // ───── layout & drawing ─────
  /** Columns × rows that give the biggest cards for this space (cards are a little taller than wide). */
  _shape(W, H, n) {
    let best = null;
    for (let cols = 2; cols <= n; cols++) {
      const rows = Math.ceil(n / cols); if (cols * rows - n >= cols) continue;
      const s = Math.min(W / cols, (H / rows) / 1.25);
      if (!best || s > best[2] + 0.5) best = [cols, rows, s];
    }
    return best;
  }
  _art(f) {
    this.artCache ??= new Map();
    if (!this.artCache.has(f)) this.artCache.set(f, paintScene(FACES[f].scene, (this.recipe.s ^ (f * 7919)) >>> 0, 200, 150));
    return this.artCache.get(f);
  }
  _build() {
    this.cards = this.deck.map((f, i) => {
      const F = FACES[f], el = document.createElement('div'); el.className = 'mem-card'; el.setAttribute('role', 'gridcell');
      el.tabIndex = -1; el.dataset.i = i;
      const inner = document.createElement('div'); inner.className = 'mem-inner'; inner.setAttribute('aria-hidden', 'true');
      const back = document.createElement('div'); back.className = 'mem-back';
      const q = document.createElement('span'); q.className = 'mem-q'; q.textContent = '?'; back.append(q);
      const face = document.createElement('div'); face.className = 'mem-face'; face.style.setProperty('--bg', F.bg); face.style.setProperty('--len', String(Math.max(6, F.name.length + 2)));
      const art = document.createElement('canvas'); art.className = 'mem-art'; art.width = 200; art.height = 150;
      art.getContext('2d').drawImage(this._art(f), 0, 0);
      const emo = document.createElement('span'); emo.className = 'mem-emoji'; emo.textContent = F.emoji;
      const name = document.createElement('span'); name.className = 'mem-name'; name.textContent = F.name;
      face.append(art, emo, name); inner.append(back, face); el.append(inner);
      return el;
    });
    this.cols = 0;
  }
  _rows() {
    const rows = [];
    for (let i = 0; i < this.cards.length; i += this.cols) {
      const row = document.createElement('div'); row.className = 'mem-row'; row.setAttribute('role', 'row');
      row.append(...this.cards.slice(i, i + this.cols)); rows.push(row);
    }
    this.grid.replaceChildren(...rows);
    this.grid.setAttribute('aria-label', `Cards, ${rows.length} rows by ${this.cols} columns`);
  }
  _pos(i) { return `row ${((i / this.cols) | 0) + 1}, column ${(i % this.cols) + 1}`; }
  _paint() {
    this.cards.forEach((el, i) => {
      const f = this.deck[i], m = this.matched.has(f), up = m || this.up.includes(i), peek = el.classList.contains('mem-peek');
      el.classList.toggle('up', up || peek); el.classList.toggle('matched', m);
      el.tabIndex = i === this.sel ? 0 : -1;
      el.setAttribute('aria-label', `${this._pos(i)}, ${m ? `${FACES[f].name}, matched` : up ? `${FACES[f].name}, face up` : peek ? `${FACES[f].name}, peeking` : 'face down'}`);
      if (m) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
    });
    this.root.classList.toggle('mem-won', this._done);
  }
  _say(t) { if (this.hooks.announce) this.hooks.announce(t); else if (this.live) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = t; }, 50); } }
  _progress() { const p = this.progress(); this.hooks.onProgress?.(p.done, p.total); }

  // ───── rules ─────
  /** A mismatched pair waiting to turn back: turn it back now. */
  _settle() { if (this.up.length === 2) { clearTimeout(this.timer); this.up = []; this._paint(); } }
  _turn(i) {
    if (this._done) return;
    const f = this.deck[i];
    if (this.matched.has(f)) { this._say(`${FACES[f].name} is already matched.`); return; }
    if (this.up.length === 2) this._settle();
    if (this.up.includes(i)) { this._say(`${FACES[f].name} is already face up. Pick another card.`); return; }
    this.up.push(i);
    if (this.up.length === 1) { this._paint(); this._say(`${FACES[f].name}. Now find its partner.`); this.hooks.onChange?.(); return; }
    this.turns++;
    const [a, b] = this.up;
    if (this.deck[a] === this.deck[b]) {
      this.matched.add(f); this.up = [];
      this._done = this.matched.size === this.recipe.p;
      this._paint(); this.hooks.onPlace?.(this._done); this._progress(); this.hooks.onChange?.();
      const left = this.recipe.p - this.matched.size;
      this._say(this._done ? `A pair of ${FACES[f].name}s! That's every pair — well done!` : `A pair of ${FACES[f].name}s! ${left} pair${left === 1 ? '' : 's'} to go.`);
      if (this._done) this.hooks.onComplete?.();
    } else {
      this._paint(); this.hooks.onChange?.();
      this._say(`${FACES[this.deck[b]].name}. Not a match with ${FACES[this.deck[a]].name} — they will turn back over.`);
      this.timer = setTimeout(() => this._settle(), motionReduced() ? 3000 : 1500);
    }
  }
  _focus(i) { this.sel = i; this._paint(); this.cards[i].focus({ preventScroll: true }); }
  _bind() {
    let down = null;
    this.grid.addEventListener('pointerdown', e => { const c = e.target.closest('.mem-card'); if (!c) return; down = { i: +c.dataset.i, x: e.clientX, y: e.clientY }; this.hooks.onTouch?.(); });
    this.grid.addEventListener('pointerup', e => {
      if (!down) return; const d = down; down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 16) return;
      this.sel = d.i; this.cards[d.i].focus({ preventScroll: true }); this._turn(d.i);
    });
    this.grid.addEventListener('pointercancel', () => { down = null; });
    this.grid.addEventListener('keydown', e => {
      if (!this.deck || e.altKey || e.ctrlKey || e.metaKey) return;
      const n = this.deck.length, c = this.cols, i = this.sel, k = e.key;
      const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -c, ArrowDown: c }[k];
      if (mv) { e.preventDefault(); const j = i + mv; if (j >= 0 && j < n) this._focus(j); return; }
      if (k === 'Home') { e.preventDefault(); this._focus(i - (i % c)); return; }
      if (k === 'End') { e.preventDefault(); this._focus(Math.min(n - 1, i - (i % c) + c - 1)); return; }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); this._turn(i); return; }
      if (k === 'h' || k === 'H') { e.preventDefault(); this.help(); }
    });
    this.grid.addEventListener('focusin', e => { const t = e.target.closest?.('.mem-card'); if (t && +t.dataset.i !== this.sel) { this.sel = +t.dataset.i; this._paint(); } });
  }
}

const memory = {
  id: 'memory', name: 'Memory', emoji: '🧠',
  blurb: 'Turn over two cards to find the matching pairs',
  usesPicture: false, zoomable: false, noun: 'memory game', unit: 'pairs',
  tip: 'Tap a card to turn it over, then tap another. Matching pairs stay face up.',
  options: [{ key: 'pairs', label: 'How many cards?', choices: [[6, '6 pairs (gentle)'], [10, '10 pairs'], [15, '15 pairs']], default: 6 }],
  newRecipe(seed, opts = {}) {
    const p = PAIRS.includes(Number(opts.pairs)) ? Number(opts.pairs) : 6;
    return { g: 'memory', s: (Number(seed) >>> 0) & 0x7fffffff, p };
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'memory') return null;
    const { s, p } = r;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff || !PAIRS.includes(p)) return null;
    return { g: 'memory', s, p };
  },
  title(r) { return `Memory · ${r.p} pairs`; },
  progressLabel(done, total) { return `${done} of ${total} pairs found`; },
  describe(r) { return `${r.p} pairs, ${r.p * 2} cards`; },
  finishText(r, seconds, stats = {}) {
    const t = stats.turns || 0, h = stats.hints || 0;
    return `You found all ${r.p} pairs in ${t} turn${t === 1 ? '' : 's'}${h ? ` (with ${h} peek${h === 1 ? '' : 's'})` : ''}!`;
  },
  create(host, hooks) { return new Memory(host, hooks); },
  _internal: { FACES, deal },
};
export default memory;
