// Sudoku — a game plug-in for the family games shell (see GAMES.md).
//
// Grandparent-first: one big 9×9 grid, a big number pad (with how many of each number are left),
// pencil-in Notes, gentle mistake hints (colour AND a dashed underline AND words, never colour alone),
// unlimited Undo, and Help that fills in a square for you. Every puzzle has exactly one solution and is
// built from a seed, so the same recipe gives the same puzzle on every device.
//
// Accessible: the grid is an ARIA grid (rows / gridcells) with a roving tab stop. Arrow keys move,
// 1–9 fill, Backspace/Delete/0 erase, N toggles notes, H helps, U (or Ctrl+Z) undoes. Each square has a
// spoken name such as "Row 3, column 5, 7" or "Row 1, column 2, empty, notes 2 and 5".

const LEVELS = [['gentle', 'Gentle', 46], ['easy', 'Easy', 40], ['medium', 'Medium', 34], ['tricky', 'Tricky', 28]];
const LEVEL = Object.fromEntries(LEVELS.map(([id, name, givens]) => [id, { name, givens }]));
const ALL = 0x3FE;                                     // bits 1..9

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shuffle = (arr, r) => { for (let i = arr.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const rowOf = i => (i / 9) | 0, colOf = i => i % 9, boxOf = i => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
const popcount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const PEERS = Array.from({ length: 81 }, (_, i) => {
  const s = new Set();
  for (let k = 0; k < 9; k++) { s.add(rowOf(i) * 9 + k); s.add(k * 9 + colOf(i)); }
  const br = rowOf(i) - rowOf(i) % 3, bc = colOf(i) - colOf(i) % 3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s.add((br + r) * 9 + bc + c);
  s.delete(i); return [...s];
});
const UNIT_CELLS = (kind, n) => Array.from({ length: 9 }, (_, k) => kind === 'row' ? n * 9 + k : kind === 'col' ? k * 9 + n : (((n / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (n % 3) * 3 + k % 3);

// ───────────────────────────── generator & solver ─────────────────────────────
/** Count solutions of grid g (0 = empty), stopping at `limit`. Bitmask search, fewest-candidates first. */
function countSolutions(g, limit = 2) {
  const R = new Int32Array(9), C = new Int32Array(9), B = new Int32Array(9), a = Int8Array.from(g);
  for (let i = 0; i < 81; i++) if (a[i]) { const b = 1 << a[i]; if ((R[rowOf(i)] | C[colOf(i)] | B[boxOf(i)]) & b) return 0; R[rowOf(i)] |= b; C[colOf(i)] |= b; B[boxOf(i)] |= b; }
  let count = 0;
  (function go() {
    let best = -1, bestMask = 0, bestN = 10;
    for (let i = 0; i < 81; i++) if (!a[i]) {
      const m = ALL & ~(R[rowOf(i)] | C[colOf(i)] | B[boxOf(i)]), n = popcount(m);
      if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; return; }
    if (!bestMask) return;
    const r = rowOf(best), c = colOf(best), bx = boxOf(best);
    for (let d = 1; d <= 9 && count < limit; d++) if (bestMask & (1 << d)) {
      const b = 1 << d; a[best] = d; R[r] |= b; C[c] |= b; B[bx] |= b;
      go();
      a[best] = 0; R[r] &= ~b; C[c] &= ~b; B[bx] &= ~b;
    }
  })();
  return count;
}
/** A complete valid grid from the seed (randomised backtracking). */
function fullGrid(r) {
  const a = new Int8Array(81), R = new Int32Array(9), C = new Int32Array(9), B = new Int32Array(9);
  const fill = i => {
    if (i === 81) return true;
    const m = ALL & ~(R[rowOf(i)] | C[colOf(i)] | B[boxOf(i)]);
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], r)) if (m & (1 << d)) {
      const b = 1 << d; a[i] = d; R[rowOf(i)] |= b; C[colOf(i)] |= b; B[boxOf(i)] |= b;
      if (fill(i + 1)) return true;
      a[i] = 0; R[rowOf(i)] &= ~b; C[colOf(i)] &= ~b; B[boxOf(i)] &= ~b;
    }
    return false;
  };
  fill(0); return a;
}
const cache = new Map();
/** The puzzle for a recipe: { givens, solution } — always the same for the same (seed, level). */
function generate(seed, level) {
  const key = `${seed}:${level}`; if (cache.has(key)) return cache.get(key);
  const r = rng(seed ^ 0x5D0C0DE), sol = fullGrid(r), puz = Int8Array.from(sol), target = LEVEL[level].givens;
  let givens = 81;
  // remove in symmetric pairs (looks tidy, like a printed puzzle), keeping exactly one solution
  const order = shuffle([...Array(41).keys()], r);
  for (const i of order) {
    if (givens <= target) break;
    const j = 80 - i, a = puz[i], b = puz[j];
    puz[i] = 0; puz[j] = 0;
    if (countSolutions(puz, 2) !== 1) { puz[i] = a; puz[j] = b; continue; }
    givens -= i === j ? 1 : 2;
  }
  const out = { givens: puz, solution: sol };
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  cache.set(key, out); return out;
}

// ───────────────────────────── saved state ─────────────────────────────
function fromState(st, P) {
  try {
    if (!st || typeof st !== 'object' || st.v !== 1 || typeof st.p !== 'string' || !/^[0-9]{81}$/.test(st.p)) return null;
    const vals = Int8Array.from(st.p, ch => +ch);
    for (let i = 0; i < 81; i++) if (P.givens[i] && vals[i] !== P.givens[i]) return null;
    const notes = new Int16Array(81);
    if (st.n != null) {
      if (!Array.isArray(st.n) || st.n.length !== 81) return null;
      for (let i = 0; i < 81; i++) { const n = st.n[i]; if (!Number.isInteger(n) || n < 0 || n > ALL || (n & 1)) return null; notes[i] = vals[i] ? 0 : n; }
    }
    const hist = [];
    if (Array.isArray(st.h)) for (const e of st.h.slice(-300)) {
      if (!Array.isArray(e) || e.length < 3 || e.length > 3 + 2 * 20 || e.some(x => !Number.isInteger(x))) return null;
      const [i, v, n] = e; if (i < 0 || i > 80 || v < 0 || v > 9 || n < 0 || n > ALL || P.givens[i]) return null;
      for (let k = 3; k < e.length; k += 2) if (e[k] < 0 || e[k] > 80 || e[k + 1] < 0 || e[k + 1] > ALL) return null;
      hist.push(e);
    }
    const num = x => Number.isInteger(x) && x >= 0 && x < 1e6 ? x : 0;
    return { vals, notes, hist, mistakes: num(st.mi), hints: num(st.hi) };
  } catch (_) { return null; }
}

// ───────────────────────────── the game ─────────────────────────────
let instances = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
class Sudoku {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `sdk${++instances}`;
    this.sel = 40; this.notesMode = false; this.hist = []; this.mistakes = 0; this.hints = 0; this._completed = false;
    const root = this.root = document.createElement('div');
    root.className = 'sdk'; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Sudoku');
    const help = document.createElement('p'); help.className = 'sdk-sr'; help.id = `${this.ns}-keys`;
    help.textContent = 'Sudoku. Fill every row, column and 3 by 3 box with the numbers 1 to 9. Arrow keys move between squares. ' +
      'Type a number to fill the square, Backspace erases, N turns notes on or off, H fills in a square for you, U undoes.';
    this.live = null;
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'sdk-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); }
    // grid
    const grid = this.grid = document.createElement('div');
    grid.className = 'sdk-grid'; grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', 'Sudoku grid, 9 rows by 9 columns');
    grid.setAttribute('aria-describedby', help.id); grid.setAttribute('aria-rowcount', '9'); grid.setAttribute('aria-colcount', '9');
    this.cells = [];
    for (let r = 0; r < 9; r++) {
      const row = document.createElement('div'); row.className = 'sdk-row'; row.setAttribute('role', 'row'); row.setAttribute('aria-rowindex', String(r + 1));
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c, cell = document.createElement('div');
        cell.className = `sdk-cell r${r} c${c}`; cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-colindex', String(c + 1));
        cell.tabIndex = -1; cell.dataset.i = i;
        const v = document.createElement('span'); v.className = 'sdk-v'; v.setAttribute('aria-hidden', 'true');
        const notes = document.createElement('span'); notes.className = 'sdk-notes'; notes.setAttribute('aria-hidden', 'true');
        for (let d = 1; d <= 9; d++) { const n = document.createElement('span'); n.className = 'sdk-n'; n.textContent = String(d); notes.append(n); }
        cell.append(v, notes); row.append(cell); this.cells.push(cell);
      }
      grid.append(row);
    }
    // number pad
    const pad = this.pad = document.createElement('div');
    pad.className = 'sdk-pad'; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', 'Number pad');
    this.digitBtn = [];
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sdk-key'; b.dataset.d = d;
      const big = document.createElement('span'); big.className = 'sdk-key-d'; big.textContent = String(d); big.setAttribute('aria-hidden', 'true');
      const left = document.createElement('span'); left.className = 'sdk-key-left'; left.setAttribute('aria-hidden', 'true');
      b.append(big, left); pad.append(b); this.digitBtn[d] = b;
    }
    const notesBtn = this.notesBtn = document.createElement('button'); notesBtn.type = 'button'; notesBtn.className = 'sdk-key sdk-notes-btn';
    notesBtn.setAttribute('aria-pressed', 'false'); notesBtn.setAttribute('aria-label', 'Notes: pencil in possible numbers');
    notesBtn.append(Object.assign(document.createElement('span'), { className: 'sdk-key-ico', textContent: '✏️' }), Object.assign(document.createElement('span'), { className: 'sdk-key-txt', textContent: 'Notes' }));
    notesBtn.firstChild.setAttribute('aria-hidden', 'true'); notesBtn.lastChild.setAttribute('aria-hidden', 'true');
    const erase = this.eraseBtn = document.createElement('button'); erase.type = 'button'; erase.className = 'sdk-key sdk-erase'; erase.setAttribute('aria-label', 'Erase the square');
    erase.append(Object.assign(document.createElement('span'), { className: 'sdk-key-ico', textContent: '⌫' }), Object.assign(document.createElement('span'), { className: 'sdk-key-txt', textContent: 'Erase' }));
    erase.firstChild.setAttribute('aria-hidden', 'true'); erase.lastChild.setAttribute('aria-hidden', 'true');
    pad.append(erase, notesBtn);
    root.append(help, grid, pad); if (this.live) root.append(this.live);
    host.append(root);
    this._bind();
  }

  // ───── public interface ─────
  async load(recipe, { state } = {}) {
    this.recipe = recipe; this.P = generate(recipe.s, recipe.l);
    const restored = state ? fromState(state, this.P) : null;
    if (restored) Object.assign(this, { vals: restored.vals, notes: restored.notes, hist: restored.hist, mistakes: restored.mistakes, hints: restored.hints });
    else { this.vals = Int8Array.from(this.P.givens); this.notes = new Int16Array(81); this.hist = []; this.mistakes = 0; this.hints = 0; }
    this.showMistakes = recipe.m !== 0;
    this._completed = this._won(); this.root.classList.toggle('solved', this._completed);
    this.sel = this._firstEmpty(); this.notesMode = false;
    this.hooks.onZoomable?.(false);
    this._layout(); this._render(); this._progress();
  }
  state() {
    return { v: 1, p: Array.from(this.vals).join(''), n: Array.from(this.notes), h: this.hist.slice(-300), mi: this.mistakes, hi: this.hints };
  }
  progress() {
    let done = 0, total = 0;
    for (let i = 0; i < 81; i++) if (!this.P.givens[i]) { total++; if (this.vals[i] === this.P.solution[i]) done++; }
    return { done, total };
  }
  get done() { return this._completed; }
  stats() { return { mistakes: this.mistakes, hints: this.hints }; }
  resize() { this._layout(); }
  destroy() { this.root.remove(); }
  undo() {
    const e = this.hist.pop(); if (!e) { this._say('Nothing to undo.'); return; }
    const [i, v, n] = e; this.vals[i] = v; this.notes[i] = n;
    for (let k = 3; k < e.length; k += 2) this.notes[e[k]] = e[k + 1];
    this.sel = i; this._completed = this._won(); this.root.classList.toggle('solved', this._completed);
    this._render(); this._focusSel(); this._progress(); this.hooks.onChange?.();
    this._say(`Undone. Row ${rowOf(i) + 1}, column ${colOf(i) + 1} is ${v ? v : 'empty'} again.`);
  }
  help() {
    if (this._completed) return;
    const S = this.P.solution, wrong = i => this.vals[i] && this.vals[i] !== S[i];
    let i = this.sel;
    if (this.P.givens[i] || (this.vals[i] && !wrong(i))) {
      // the empty square with the fewest possibilities (the easiest next step)
      let best = -1, bestN = 10;
      for (let k = 0; k < 81; k++) if (!this.vals[k] || wrong(k)) {
        let used = 0; for (const p of PEERS[k]) if (this.vals[p] && !wrong(p)) used |= 1 << this.vals[p];
        const n = popcount(ALL & ~used); if (n < bestN) { best = k; bestN = n; }
      }
      if (best < 0) return; i = best;
    }
    this.hints++; this.sel = i;
    this._set(i, S[i], true);
    const cell = this.cells[i]; cell.classList.remove('glow'); void cell.offsetWidth; cell.classList.add('glow');
    setTimeout(() => cell.classList.remove('glow'), 1800);
    this._say(`Here’s a ${S[i]} for row ${rowOf(i) + 1}, column ${colOf(i) + 1}.`, true);
  }
  snapshot() {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const g = c.getContext('2d'), N = 9, size = 780, x0 = (1200 - size) / 2, y0 = 70, cs = size / N;
    g.fillStyle = '#fbf4e6'; g.fillRect(0, 0, 1200, 900);
    g.fillStyle = '#fff'; g.fillRect(x0, y0, size, size);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 81; i++) {
      const x = x0 + colOf(i) * cs + cs / 2, y = y0 + rowOf(i) * cs + cs / 2, given = !!this.P.givens[i];
      g.fillStyle = given ? '#1b1b1b' : '#1558b0'; g.font = `${given ? 700 : 400} ${Math.round(cs * 0.6)}px 'Atkinson Hyperlegible', system-ui, sans-serif`;
      const v = this.vals[i] || this.P.solution[i]; g.fillText(String(v), x, y + 2);
    }
    for (let k = 0; k <= N; k++) {
      g.strokeStyle = k % 3 ? '#a89f8c' : '#2b2118'; g.lineWidth = k % 3 ? 2 : 6;
      g.beginPath(); g.moveTo(x0 + k * cs, y0); g.lineTo(x0 + k * cs, y0 + size); g.stroke();
      g.beginPath(); g.moveTo(x0, y0 + k * cs); g.lineTo(x0 + size, y0 + k * cs); g.stroke();
    }
    g.fillStyle = '#2b2118'; g.font = "600 40px Georgia, serif"; g.fillText(`Sudoku · ${LEVEL[this.recipe.l].name}`, 600, 870);
    return c;
  }

  // ───── rules ─────
  _won() { for (let i = 0; i < 81; i++) if (this.vals[i] !== this.P.solution[i]) return false; return true; }
  _firstEmpty() { for (let i = 0; i < 81; i++) if (!this.vals[i]) return i; return 40; }
  /** Put d in square i (or erase with d = 0), recording what changed for Undo. */
  _set(i, d, fromHelp = false) {
    const e = [i, this.vals[i], this.notes[i]];
    this.vals[i] = d; this.notes[i] = 0;
    if (d) for (const p of PEERS[i]) if (!this.vals[p] && (this.notes[p] & (1 << d))) { e.push(p, this.notes[p]); this.notes[p] &= ~(1 << d); }
    this.hist.push(e); if (this.hist.length > 300) this.hist.shift();
    const S = this.P.solution, ok = d && d === S[i];
    if (d && !ok) this.mistakes++;
    // a completed row / column / box is a small celebration
    let units = [];
    if (ok) for (const [kind, n] of [['row', rowOf(i)], ['col', colOf(i)], ['box', boxOf(i)]])
      if (UNIT_CELLS(kind, n).every(k => this.vals[k] === S[k])) units.push([kind, n]);
    const won = this._won();
    this._render();
    if (units.length && !won) {
      for (const [kind, n] of units) for (const k of UNIT_CELLS(kind, n)) { const c = this.cells[k]; c.classList.remove('wave'); void c.offsetWidth; c.classList.add('wave'); }
      setTimeout(() => this.cells.forEach(c => c.classList.remove('wave')), 1300);
      this.hooks.onPlace?.(false);
    }
    this._progress(); this.hooks.onChange?.();
    if (!fromHelp) {
      const where = `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
      if (!d) this._say(`Erased ${where}.`);
      else if (!ok && this.showMistakes) this._say(`That ${d} doesn’t fit here. Try another number, or press Help.`, true);
      else this._say(units.length ? `${d} placed. ${units.map(([k, n]) => k === 'box' ? 'Box' : k === 'row' ? `Row ${n + 1}` : `Column ${n + 1}`).join(' and ')} complete!` : `${d} placed in ${where}.`);
    }
    if (won && !this._completed) {
      this._completed = true; this.root.classList.add('solved');
      this._say('You solved the puzzle! Wonderful!', true);
      this.hooks.onPlace?.(true);
      setTimeout(() => this.hooks.onComplete?.(), 900);
    }
  }
  _toggleNote(i, d) {
    if (this.vals[i]) { this._say('Notes go in empty squares. Erase the number first.'); return; }
    const e = [i, 0, this.notes[i]]; this.notes[i] ^= 1 << d;
    this.hist.push(e); if (this.hist.length > 300) this.hist.shift();
    this._render(); this.hooks.onChange?.();
    this._say(`Note ${d} ${this.notes[i] & (1 << d) ? 'added' : 'removed'}.`);
  }
  _input(d) {
    if (this._completed) return;
    const i = this.sel;
    if (this.P.givens[i]) { this._say(`That ${this.P.givens[i]} was printed in the puzzle, so it can’t change. Pick an empty square.`); this._nope(i); return; }
    if (d === 0) { if (this.vals[i]) this._set(i, 0); else if (this.notes[i]) { this.hist.push([i, 0, this.notes[i]]); this.notes[i] = 0; this._render(); this.hooks.onChange?.(); this._say('Notes cleared.'); } return; }
    if (this.notesMode) { this._toggleNote(i, d); return; }
    if (this.vals[i] === d) { this._set(i, 0); return; }          // tapping the same number again takes it back out
    this._set(i, d);
  }

  // ───── drawing ─────
  _layout() {
    const r = this.host.getBoundingClientRect(), W = Math.max(200, r.width), H = Math.max(200, r.height), m = 10, gap = 14;
    const portrait = H >= W * 0.9;
    let cell, btn;
    if (portrait) {
      btn = Math.min(84, Math.max(48, (W - 2 * m - 5 * 6) / 6));
      const board = Math.min(W - 2 * m, H - 2 * m - gap - (btn * 2 + 6));
      cell = Math.floor((board - 10) / 9);
    } else {
      const boardMax = H - 2 * m;
      btn = Math.min(96, Math.max(56, Math.min((W - 2 * m - gap - boardMax * 0.6) / 3 - 8, (boardMax - 24) / 4)));
      const board = Math.min(boardMax, W - 2 * m - gap - (btn * 3 + 16));
      cell = Math.floor((board - 10) / 9);
    }
    cell = Math.max(26, cell);
    this.root.classList.toggle('portrait', portrait); this.root.classList.toggle('landscape', !portrait);
    this.root.style.setProperty('--cell', cell + 'px'); this.root.style.setProperty('--btn', Math.floor(btn) + 'px');
  }
  _render() {
    const S = this.P.solution, sel = this.sel, sv = this.vals[sel];
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) { const v = this.vals[i]; if (v && (!this.showMistakes || v === S[i])) counts[v]++; }
    for (let i = 0; i < 81; i++) {
      const c = this.cells[i], v = this.vals[i], given = !!this.P.givens[i], wrong = v && v !== S[i] && this.showMistakes;
      c.firstChild.textContent = v ? String(v) : '';
      const notes = this.notes[i];
      c.classList.toggle('has-notes', !v && !!notes);
      if (!v && notes) { const kids = c.lastChild.children; for (let d = 1; d <= 9; d++) kids[d - 1].classList.toggle('on', !!(notes & (1 << d))); }
      c.classList.toggle('given', given); c.classList.toggle('user', !!v && !given); c.classList.toggle('wrong', !!wrong);
      c.classList.toggle('sel', i === sel);
      c.classList.toggle('peer', i !== sel && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel)));
      c.classList.toggle('same', i !== sel && !!sv && v === sv);
      c.tabIndex = i === sel ? 0 : -1;
      c.setAttribute('aria-selected', String(i === sel));
      if (given) c.setAttribute('aria-readonly', 'true'); else c.removeAttribute('aria-readonly');
      const noteList = []; for (let d = 1; d <= 9; d++) if (notes & (1 << d)) noteList.push(d);
      const label = `Row ${rowOf(i) + 1}, column ${colOf(i) + 1}, ` + (given ? `given ${v}` : v ? `${v}${wrong ? ', doesn’t fit' : ''}` :
        `empty${noteList.length ? `, notes ${noteList.length > 1 ? noteList.slice(0, -1).join(', ') + ' and ' + noteList.at(-1) : noteList[0]}` : ''}`);
      c.setAttribute('aria-label', label);
    }
    for (let d = 1; d <= 9; d++) {
      const b = this.digitBtn[d], left = Math.max(0, 9 - counts[d]);
      b.lastChild.textContent = left ? `${left} left` : '✓';
      b.setAttribute('aria-label', `${d}, ${left ? `${left} left` : 'all placed'}`);
      b.disabled = !left && !this.notesMode; b.classList.toggle('done', !left);
    }
    this.notesBtn.setAttribute('aria-pressed', String(this.notesMode));
    this.root.classList.toggle('notes-mode', this.notesMode);
  }
  _progress() { const { done, total } = this.progress(); this.hooks.onProgress?.(done, total); }
  _focusSel() { const c = this.cells[this.sel]; if (c && this.root.contains(document.activeElement)) c.focus({ preventScroll: true }); }
  _say(text, assertive) {
    if (this.hooks.announce) { this.hooks.announce(text); return; }
    if (this.live) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = text; }, 40); }
  }
  /** A printed square can't change: give it a gentle shake instead of covering the grid with a message. */
  _nope(i) { const c = this.cells[i]; c.classList.remove('nope'); void c.offsetWidth; c.classList.add('nope'); setTimeout(() => c.classList.remove('nope'), 600); }
  _select(i, focus) {
    this.sel = i; this._render(); if (focus) this.cells[i].focus({ preventScroll: true });
  }

  // ───── input ─────
  _bind() {
    let down = null;
    this.grid.addEventListener('pointerdown', e => {
      const cell = e.target.closest('.sdk-cell'); if (!cell) return;
      down = { i: +cell.dataset.i, x: e.clientX, y: e.clientY }; this.hooks.onTouch?.();
    });
    this.grid.addEventListener('pointerup', e => {
      if (!down) return; const d = down; down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 16) return;      // wobbly taps (≤ 16 px) still count
      this._select(d.i, true);
    });
    this.grid.addEventListener('pointercancel', () => { down = null; });
    this.pad.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; this.hooks.onTouch?.();
      if (b === this.notesBtn) { this.notesMode = !this.notesMode; this._render(); this._say(this.notesMode ? 'Notes on: numbers you tap are pencilled in.' : 'Notes off.'); return; }
      if (b === this.eraseBtn) { this._input(0); return; }
      this._input(+b.dataset.d);
    });
    this.root.addEventListener('keydown', e => {
      if (e.altKey || e.metaKey) return;
      const k = e.key, onGrid = !!e.target.closest?.('.sdk-grid');
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (moves[k] && onGrid) {
        e.preventDefault(); const [dr, dc] = moves[k], r = (rowOf(this.sel) + dr + 9) % 9, c = (colOf(this.sel) + dc + 9) % 9;
        this._select(r * 9 + c, true); return;
      }
      if (k === 'Home' && onGrid) { e.preventDefault(); this._select(rowOf(this.sel) * 9, true); return; }
      if (k === 'End' && onGrid) { e.preventDefault(); this._select(rowOf(this.sel) * 9 + 8, true); return; }
      if (e.ctrlKey && (k === 'z' || k === 'Z')) { e.preventDefault(); this.undo(); return; }
      if (e.ctrlKey) return;
      if (/^[1-9]$/.test(k)) { e.preventDefault(); this._input(+k); return; }
      if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); this._input(0); return; }
      if (k === 'n' || k === 'N') { e.preventDefault(); this.notesBtn.click(); return; }
      if (k === 'h' || k === 'H') { e.preventDefault(); this.help(); return; }
      if (k === 'u' || k === 'U') { e.preventDefault(); this.undo(); }
    });
  }
}

const sudoku = {
  id: 'sudoku', name: 'Sudoku', emoji: '🔢',
  blurb: 'Fill the grid with 1 to 9 — gentle hints, big numbers',
  usesPicture: false, zoomable: false, noun: 'Sudoku puzzle', unit: 'squares',
  tip: 'Tap a square, then tap a number. ✏️ Notes lets you pencil in ideas.',
  options: [
    { key: 'level', label: 'How hard?', choices: LEVELS.map(([id, name]) => [id, name]), default: 'gentle' },
    { key: 'mistakes', label: 'Mistakes', choices: [[1, 'Gently show mistakes'], [0, 'Don’t show mistakes']], default: 1 },
  ],
  newRecipe(seed, opts = {}) {
    const s = (Number(seed) >>> 0) & 0x7fffffff, l = LEVEL[opts.level] ? opts.level : 'gentle', m = opts.mistakes === 0 ? 0 : 1;
    generate(s, l);                                         // warm the cache so the game opens instantly
    return { g: 'sudoku', s, l, m };
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'sudoku') return null;
    const { s, l, m } = r;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
    if (typeof l !== 'string' || !LEVEL[l]) return null;
    if (m !== 0 && m !== 1) return null;
    return { g: 'sudoku', s, l, m };
  },
  title(r) { return `Sudoku · ${LEVEL[r.l]?.name || 'Gentle'} ${1000 + (r.s % 9000)}`; },
  progressLabel(done, total) { return `${done} of ${total} filled`; },
  describe(r) { return `${LEVEL[r.l]?.name || 'Gentle'} puzzle${r.m === 0 ? ', no mistake hints' : ''}`; },
  finishText(r, seconds, stats = {}) {
    const mins = Math.max(1, Math.round((seconds || 0) / 60)), hints = stats.hints || 0;
    return `You solved it in about ${mins} minute${mins === 1 ? '' : 's'}${hints ? `, with ${hints} hint${hints === 1 ? '' : 's'}` : ' without any hints'}!`;
  },
  create(host, hooks) { return new Sudoku(host, hooks); },
  // internals, exported for tests only
  _internal: { generate, countSolutions, fromState, LEVELS, PEERS },
};
export default sudoku;
