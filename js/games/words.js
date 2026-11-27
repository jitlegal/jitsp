// Word Search — a game plug-in for the family games shell (see GAMES.md).
//
// Grandparent-first: big letters, a short themed word list in large print, tap the first letter then the
// last letter (or slide a finger across), found words stay circled in soft colours AND are crossed out with
// a ✓ in the list (never colour alone). Help points at where a remaining word starts.
//
// Accessible: the letters are a real ARIA grid (roving focus, arrow keys, Enter/Space to mark the start and
// end of a word), the word list says which words are found, and every result is announced in words.
//
// Deterministic: the same recipe { g:'words', s:seed, z:size, t:theme } builds the same grid on every device.
// The word lists are original and embedded — no network.

const THEMES = [
  ['garden', 'Garden', 'SPADE RAKE HOE TROWEL SEEDS SOIL ROSES TULIP DAISY PANSY SHED HEDGE LAWN MOWER HOSE BENCH POND FENCE GATE PATH BULBS LEAVES WEEDS COMPOST BLOOM PETAL STEM ROOTS SPROUT WORMS BEES SUNFLOWER MARIGOLD GNOME POTTING'],
  ['kitchen', 'Kitchen', 'KETTLE TEAPOT OVEN STOVE PANTRY SPOON FORK KNIFE PLATE BOWL SAUCER APRON WHISK LADLE TOASTER SINK JAR FLOUR SUGAR BUTTER BREAD SCONES HONEY CAKE PIE RECIPE COOKER COLANDER BAKING TRAY CUPBOARD FRIDGE NAPKIN'],
  ['seaside', 'Seaside', 'BEACH SAND WAVES SHELLS PIER BOATS YACHT CRAB GULLS TIDE SURF BUCKET CASTLE ROCKPOOL HARBOUR ANCHOR SAILS DUNES PEBBLES ICECREAM DECKCHAIR TOWEL SUNHAT PICNIC KITE FERRY CLIFFS OCEAN SEAWEED BREEZE JETTY STARFISH'],
  ['birds', 'Birds', 'ROBIN WREN SPARROW BLACKBIRD THRUSH FINCH STARLING MAGPIE PIGEON DOVE OWL HAWK EAGLE HERON SWAN GOOSE PUFFIN SWALLOW SWIFT LARK NUTHATCH JAY CROW ROOK KESTREL CHAFFINCH BLUETIT PARROT CANARY PELICAN CUCKOO PLOVER'],
  ['weather', 'Weather', 'SUNNY CLOUDS RAIN SHOWER DRIZZLE STORM THUNDER LIGHTNING SNOW FROST HAIL SLEET FOG MIST BREEZE WIND GUSTY RAINBOW DEW ICE CHILLY WARM SUNSHINE PUDDLE UMBRELLA FORECAST SKY SPRING SUMMER AUTUMN WINTER BALMY CLEAR'],
  ['family', 'Family', 'GRANDMA GRANDPA MOTHER FATHER SISTER BROTHER AUNT UNCLE COUSIN NIECE NEPHEW DAUGHTER SON BABY TWINS WEDDING HUGS LOVE PHOTOS STORIES BIRTHDAY PARTY SUNDAY DINNER VISIT HOLIDAY LAUGHTER KISSES CHILDREN GRANNY FAMILY'],
  ['holidays', 'Holidays', 'CHRISTMAS EASTER SNOWMAN PRESENTS RIBBON CANDLE LANTERN CAROLS FEAST TURKEY PUDDING STOCKING WREATH HOLLY IVY BELLS TINSEL STAR PARADE FIREWORK CARDS GIFTS SLEIGH REINDEER PUMPKIN VALENTINE GARLAND HAMPER CRACKER BUNTING'],
  ['music', 'Music', 'PIANO VIOLIN CELLO GUITAR FLUTE DRUM TRUMPET HARP BANJO ORGAN CHOIR SINGER SONG MELODY RHYTHM TEMPO CHORD NOTES WALTZ POLKA TANGO BALLAD HYMN RECORD RADIO CONCERT BAND OPERA CLARINET TROMBONE HARMONY ENCORE'],
  ['farm', 'Farm', 'BARN TRACTOR COW PIGS SHEEP LAMBS GOATS HENS ROOSTER EGGS MILK HAY STRAW FIELD PLOUGH HARVEST WHEAT BARLEY CORN ORCHARD APPLES PONY HORSE STABLE DONKEY FARMER MEADOW SILO CHEESE PADDOCK CALF DUCKLING'],
  ['trees', 'Trees & Flowers', 'OAK ASH ELM BIRCH BEECH WILLOW MAPLE PINE CEDAR HOLLY CHERRY LILAC POPPY DAISY IRIS LILY ORCHID VIOLET BLUEBELL DAFFODIL PRIMROSE HEATHER CLOVER FOXGLOVE LAVENDER JASMINE MAGNOLIA BLOSSOM ACORN CONKER ROWAN HAZEL'],
  ['house', 'Around the House', 'SOFA CHAIR TABLE LAMP CLOCK MIRROR CURTAINS CARPET CUSHION BLANKET PILLOW STAIRS WINDOW DOOR KEYS BOOKS SHELF VASE FIREPLACE PHOTOS KETTLE RADIO ARMCHAIR SLIPPERS DRAWER LADDER BATHTUB TOWEL DUSTER BROOM DOORMAT ATTIC'],
  ['travel', 'Travel', 'TRAIN TICKET LUGGAGE SUITCASE PASSPORT MAP COMPASS PLANE AIRPORT STATION BUS COACH CRUISE FERRY HOTEL POSTCARD CAMERA JOURNEY ROUTE VILLAGE CITY MUSEUM CASTLE BRIDGE MOUNTAIN LAKE VALLEY GUIDE SUNSET CARAVAN TUNNEL TOURIST'],
].map(([id, name, words]) => ({ id, name, words: words.split(' ').filter(w => /^[A-Z]{3,9}$/.test(w) && w !== [...w].reverse().join('')) }));
const THEME = new Map(THEMES.map(t => [t.id, t]));

// sizes: how many words, and which directions they may run (dr, dc)
const DIRS8 = [[0,1],[1,0],[1,1],[-1,1],[0,-1],[-1,0],[-1,-1],[1,-1]];
const SIZES = {
  8:  { words: 8,  dirs: DIRS8.slice(0, 2), label: 'Gentle' },
  10: { words: 10, dirs: DIRS8.slice(0, 4), label: 'Classic' },
  12: { words: 12, dirs: DIRS8,             label: 'Challenge' },
};
// filler letters weighted like everyday English, so the grid looks natural
const FILL = 'EEEEEEEEEEEETTTTTTTTTAAAAAAAAOOOOOOOOIIIIIIINNNNNNNSSSSSSRRRRRRHHHHHLLLLDDDDCCCUUUMMMWWFFGGYYPPBBVKJXQZ';

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rev = w => [...w].reverse().join('');

/** Count every occurrence of word in the grid, in all eight directions (so nothing is ever found twice). */
function occurrences(G, z, word) {
  let n = 0; const L = word.length;
  for (let r = 0; r < z; r++) for (let c = 0; c < z; c++) {
    if (G[r * z + c] !== word[0]) continue;
    for (const [dr, dc] of DIRS8) {
      const er = r + dr * (L - 1), ec = c + dc * (L - 1);
      if (er < 0 || ec < 0 || er >= z || ec >= z) continue;
      let k = 1; while (k < L && G[(r + dr * k) * z + c + dc * k] === word[k]) k++;
      if (k === L) n++;
    }
  }
  return n;
}

/** Build the puzzle for a recipe: { z, theme, words:[{w, r, c, dr, dc}], grid:string }. Pure + deterministic. */
const cache = new Map();
function build(recipe) {
  const key = `${recipe.s}|${recipe.z}|${recipe.t}`;
  if (cache.has(key)) return cache.get(key);
  const z = recipe.z, S = SIZES[z];
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = rng((recipe.s ^ Math.imul(attempt + 1, 0x9E3779B1)) >>> 0);
    const theme = recipe.t === 'any' ? THEMES[(r() * THEMES.length) | 0] : THEME.get(recipe.t);
    const G = new Array(z * z).fill(''), placed = [];
    const pool = shuffle(theme.words.filter(w => w.length <= z), r);
    for (const w of pool) {
      if (placed.length >= S.words) break;
      // never two list words where one hides inside the other (e.g. DUCK / DUCKS), forwards or backwards
      if (placed.some(p => p.w.includes(w) || w.includes(p.w) || p.w.includes(rev(w)) || w.includes(rev(p.w)))) continue;
      const L = w.length;
      for (let t = 0; t < 120; t++) {
        const [dr, dc] = S.dirs[(r() * S.dirs.length) | 0];
        const r0 = (r() * z) | 0, c0 = (r() * z) | 0, er = r0 + dr * (L - 1), ec = c0 + dc * (L - 1);
        if (er < 0 || ec < 0 || er >= z || ec >= z) continue;
        let ok = true;
        for (let k = 0; k < L && ok; k++) { const ch = G[(r0 + dr * k) * z + c0 + dc * k]; if (ch && ch !== w[k]) ok = false; }
        if (!ok) continue;
        for (let k = 0; k < L; k++) G[(r0 + dr * k) * z + c0 + dc * k] = w[k];
        placed.push({ w, r: r0, c: c0, dr, dc }); break;
      }
    }
    if (placed.length < S.words) continue;
    const free = []; for (let i = 0; i < z * z; i++) if (!G[i]) free.push(i);
    // fill the gaps, re-rolling until every list word appears exactly once
    for (let tries = 0; tries < 40; tries++) {
      for (const i of free) G[i] = FILL[(r() * FILL.length) | 0];
      const grid = G.join('');
      if (placed.every(p => occurrences(grid, z, p.w) === 1)) {
        placed.sort((a, b) => a.w < b.w ? -1 : 1);                   // list shown alphabetically
        const out = { z, theme, words: placed, grid };
        cache.set(key, out); if (cache.size > 40) cache.delete(cache.keys().next().value);
        return out;
      }
    }
  }
  throw new Error('word search could not be built');                   // never seen in testing
}

const cellsOf = p => Array.from({ length: p.w.length }, (_, k) => [p.r + p.dr * k, p.c + p.dc * k]);
const SVGNS = 'http://www.w3.org/2000/svg';
const HUES = ['#f6c445', '#7cc6f2', '#9be08f', '#f4a3c0', '#c3a6f3', '#ffb37a', '#8fe3d6', '#f28b82', '#b5d86b', '#f7d794', '#a7c7ff', '#e6b3ff'];
let instances = 0;

class WordSearch {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `ws${++instances}`;
    this.P = null; this.found = []; this.hints = 0; this._done = false;
    this.start = null; this.focus = [0, 0]; this.press = null; this.hintTimer = 0;
    const root = this.root = document.createElement('div'); root.className = 'ws';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Word search');
    const keys = document.createElement('p'); keys.className = 'ws-sr'; keys.id = `${this.ns}-keys`;
    keys.textContent = 'Find the words in the letter grid. Arrow keys move between letters. Press Enter or Space on the first letter of a word, then on its last letter. Escape cancels. H gives a hint.';
    this.live = null;
    if (!hooks.announce) { this.live = document.createElement('div'); this.live.className = 'ws-sr'; this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); }
    this.board = document.createElement('div'); this.board.className = 'ws-board';
    this.svg = document.createElementNS(SVGNS, 'svg'); this.svg.setAttribute('class', 'ws-caps'); this.svg.setAttribute('aria-hidden', 'true');
    this.gridEl = document.createElement('div'); this.gridEl.className = 'ws-grid';
    this.gridEl.setAttribute('role', 'grid'); this.gridEl.setAttribute('aria-describedby', keys.id);
    this.board.append(this.svg, this.gridEl);
    this.side = document.createElement('div'); this.side.className = 'ws-side';
    this.heading = document.createElement('h2'); this.heading.className = 'ws-title';
    this.list = document.createElement('ul'); this.list.className = 'ws-list'; this.list.setAttribute('aria-label', 'Words to find');
    this.side.append(this.heading, this.list);
    root.append(keys, this.board, this.side); if (this.live) root.append(this.live);
    host.append(root);
    this._bind();
  }

  // ---------- shell API ----------
  async load(recipe, { state } = {}) {
    this.recipe = recipe; this.P = build(recipe);
    this.found = []; this.hints = 0; this._done = false; this.start = null;
    if (state && typeof state === 'object' && Array.isArray(state.f)) {
      const seen = new Set();
      for (const i of state.f) if (Number.isInteger(i) && i >= 0 && i < this.P.words.length && !seen.has(i)) { seen.add(i); this.found.push(i); }
      if (Number.isInteger(state.h) && state.h >= 0 && state.h < 1000) this.hints = state.h;
    }
    this._done = this.found.length === this.P.words.length;
    this._render(); this.resize(); this._progress();
  }
  state() { return { v: 1, f: this.found.slice(), h: this.hints }; }
  progress() { return { done: this.found.length, total: this.P ? this.P.words.length : 0 }; }
  get done() { return this._done; }
  stats() { return { hints: this.hints }; }
  destroy() { clearTimeout(this.hintTimer); this.root.remove(); }

  help() {
    if (this._done || !this.P) return;
    const i = this.P.words.findIndex((_, k) => !this.found.includes(k)); if (i < 0) return;
    const p = this.P.words[i], el = this._cell(p.r, p.c);
    this.hints++;
    for (const c of this.gridEl.querySelectorAll('.ws-hint')) c.classList.remove('ws-hint');
    el.classList.add('ws-hint'); clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('ws-hint'), 2600);
    this._say(`Look for a word starting at row ${p.r + 1}, column ${p.c + 1}. It begins with ${p.w[0]}.`);
    this.hooks.onChange?.();
  }

  snapshot() {
    const P = this.P, W = 1200, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fbf4e6'; g.fillRect(0, 0, W, H);
    const size = 820, cell = size / P.z, ox = 40, oy = 40;
    g.fillStyle = '#fff'; g.fillRect(ox - 10, oy - 10, size + 20, size + 20);
    P.words.forEach((p, k) => {
      if (!this.found.includes(k)) return;
      const e = cellsOf(p).at(-1);
      g.strokeStyle = HUES[k % HUES.length]; g.lineCap = 'round'; g.lineWidth = cell * 0.78;
      g.beginPath(); g.moveTo(ox + (p.c + .5) * cell, oy + (p.r + .5) * cell); g.lineTo(ox + (e[1] + .5) * cell, oy + (e[0] + .5) * cell); g.stroke();
    });
    g.fillStyle = '#2b2118'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(cell * 0.58)}px "Atkinson Hyperlegible", system-ui, sans-serif`;
    for (let r = 0; r < P.z; r++) for (let q = 0; q < P.z; q++) g.fillText(P.grid[r * P.z + q], ox + (q + .5) * cell, oy + (r + .5) * cell + 2);
    g.textAlign = 'left'; g.font = '600 40px Georgia, serif'; g.fillText(P.theme.name, 900, 80);
    g.font = '26px "Atkinson Hyperlegible", system-ui, sans-serif';
    P.words.forEach((p, k) => g.fillText(`✓ ${p.w}`, 900, 140 + k * 42));
    return c;
  }

  resize() {
    if (!this.P) return;
    const W = this.host.clientWidth || innerWidth, H = this.host.clientHeight || innerHeight, pad = 12;
    const portrait = H > W * 0.9;
    this.root.classList.toggle('ws-portrait', portrait);
    let px;
    if (portrait) {                                   // leave exactly enough room for the word list underneath
      this.side.style.width = (W - 2 * pad) + 'px'; this.side.style.maxHeight = 'none';
      const listH = this.side.offsetHeight;
      this.side.style.maxHeight = '';
      px = Math.min(W - 2 * pad, H - 2 * pad - 14 - listH);
      px = Math.max(px, Math.min(W - 2 * pad, 30 * this.P.z));   // never smaller than 30 px letters; scroll instead
    } else px = Math.min(H - 2 * pad, (W - 3 * pad) * 0.64);
    px = Math.max(200, Math.floor(px));
    const cell = px / this.P.z;
    this.board.style.width = this.board.style.height = px + 'px';
    this.gridEl.style.gridTemplateColumns = `repeat(${this.P.z}, 1fr)`;
    this.gridEl.style.fontSize = Math.round(cell * 0.6) + 'px';
    this.svg.setAttribute('viewBox', `0 0 ${this.P.z} ${this.P.z}`);
    this.side.style.width = portrait ? (W - 2 * pad) + 'px' : Math.max(180, W - px - 3 * pad) + 'px';
    this.cellPx = cell; this._drawCaps();
  }

  // ---------- drawing ----------
  _render() {
    const { z, grid, theme, words } = this.P;
    this.gridEl.setAttribute('aria-label', `Letter grid, ${z} by ${z}`);
    this.gridEl.replaceChildren();
    for (let r = 0; r < z; r++) {
      const row = document.createElement('div'); row.setAttribute('role', 'row'); row.className = 'ws-row';
      for (let c = 0; c < z; c++) {
        const el = document.createElement('div'); el.className = 'ws-cell'; el.setAttribute('role', 'gridcell');
        el.dataset.r = r; el.dataset.c = c; el.tabIndex = -1; el.textContent = grid[r * z + c];
        el.setAttribute('aria-label', `${grid[r * z + c]}, row ${r + 1}, column ${c + 1}`);
        row.append(el);
      }
      this.gridEl.append(row);
    }
    this._cell(...this.focus).tabIndex = 0;
    this.heading.textContent = theme.name;
    this.list.replaceChildren(...words.map((p, k) => {
      const li = document.createElement('li'); li.className = 'ws-word'; li.dataset.k = k;
      const mark = document.createElement('span'); mark.className = 'ws-tick'; mark.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span'); txt.className = 'ws-wtext'; txt.textContent = p.w;
      li.append(mark, txt); return li;
    }));
    this._paintList();
  }
  _paintList() {
    for (const li of this.list.children) {
      const k = +li.dataset.k, f = this.found.includes(k), w = this.P.words[k].w;
      li.classList.toggle('found', f); li.firstChild.textContent = f ? '✓' : '';
      li.setAttribute('aria-label', f ? `${w}, found` : `${w}, not found yet`);
      if (f) li.style.setProperty('--hue', HUES[k % HUES.length]); else li.style.removeProperty('--hue');
    }
  }
  _line(a, b, cls, color) {
    const l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', a[1] + .5); l.setAttribute('y1', a[0] + .5); l.setAttribute('x2', b[1] + .5); l.setAttribute('y2', b[0] + .5);
    l.setAttribute('class', cls); if (color) l.style.stroke = color; return l;
  }
  _drawCaps(preview) {
    const items = [];
    this.found.forEach(k => { const p = this.P.words[k], e = cellsOf(p).at(-1), a = [p.r, p.c];
      items.push(this._line(a, e, 'ws-cap-edge'), this._line(a, e, 'ws-cap', HUES[k % HUES.length])); });
    if (preview) items.push(this._line(preview[0], preview[1], 'ws-sel'));
    this.svg.replaceChildren(...items);
  }
  _cell(r, c) { return this.gridEl.children[r]?.children[c]; }
  _say(t) { if (this.hooks.announce) this.hooks.announce(t); else if (this.live) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = t; }, 50); } }
  _progress() { const p = this.progress(); this.hooks.onProgress?.(p.done, p.total); }

  // ---------- rules ----------
  /** a → b must be a straight line (across, down or diagonal). Returns the word index found, or -1. */
  _check(a, b) {
    const dr = b[0] - a[0], dc = b[1] - a[1];
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc)) || (dr === 0 && dc === 0)) return -1;
    return this.P.words.findIndex((p, k) => {
      if (this.found.includes(k)) return false;
      const e = cellsOf(p).at(-1);
      return (p.r === a[0] && p.c === a[1] && e[0] === b[0] && e[1] === b[1]) || (p.r === b[0] && p.c === b[1] && e[0] === a[0] && e[1] === a[1]);
    });
  }
  _select(a, b) {
    this._setStart(null);
    const k = this._check(a, b);
    if (k < 0) { this._drawCaps(); if (a[0] !== b[0] || a[1] !== b[1]) this._say('Not one of the words — have another look.'); return false; }
    this.found.push(k); this._paintList(); this._drawCaps();
    const left = this.P.words.length - this.found.length, last = left === 0;
    this.hooks.onPlace?.(last);
    this._say(last ? `Found ${this.P.words[k].w}! That's every word — well done!` : `Found ${this.P.words[k].w}! ${left} to go.`);
    this._progress(); this.hooks.onChange?.();
    if (last && !this._done) { this._done = true; this.root.classList.add('ws-won'); this.hooks.onComplete?.(); }
    return true;
  }
  _setStart(cell) {
    if (this.start) this._cell(...this.start)?.classList.remove('ws-start'), this._cell(...this.start)?.setAttribute('aria-selected', 'false');
    this.start = cell;
    if (cell){ const el = this._cell(...cell); el.classList.add('ws-start'); el.setAttribute('aria-selected', 'true'); }
  }

  // ---------- input ----------
  _at(x, y) {
    const R = this.gridEl.getBoundingClientRect(), z = this.P.z;
    const c = Math.floor((x - R.left) / (R.width / z)), r = Math.floor((y - R.top) / (R.height / z));
    return [Math.max(0, Math.min(z - 1, r)), Math.max(0, Math.min(z - 1, c))];
  }
  /** Snap a drag to the nearest straight line (8 directions) from the start cell. */
  _snap(a, x, y) {
    const R = this.gridEl.getBoundingClientRect(), cw = R.width / this.P.z;
    const fx = (x - R.left) / cw - (a[1] + .5), fy = (y - R.top) / cw - (a[0] + .5);
    const ang = Math.round(Math.atan2(fy, fx) / (Math.PI / 4)), d = DIRS8.find(([dr, dc]) => Math.round(Math.atan2(dr, dc) / (Math.PI / 4)) === ang || Math.round(Math.atan2(dr, dc) / (Math.PI / 4)) === ang - 8 || Math.round(Math.atan2(dr, dc) / (Math.PI / 4)) === ang + 8);
    let len = Math.round(Math.max(Math.abs(fx), Math.abs(fy))), z = this.P.z;
    while (len > 0 && (a[0] + d[0] * len < 0 || a[0] + d[0] * len >= z || a[1] + d[1] * len < 0 || a[1] + d[1] * len >= z)) len--;
    return [a[0] + d[0] * len, a[1] + d[1] * len];
  }
  _bind() {
    const G = this.gridEl;
    G.addEventListener('pointerdown', e => {
      if (!this.P || this._done || this.press) return;
      this.hooks.onTouch?.();
      try { G.setPointerCapture(e.pointerId); } catch (_) {}
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, cell: this._at(e.clientX, e.clientY), drag: false, end: null };
      e.preventDefault();
    });
    G.addEventListener('pointermove', e => {
      const P = this.press; if (!P || e.pointerId !== P.id) return;
      if (!P.drag && Math.hypot(e.clientX - P.x, e.clientY - P.y) > 16) P.drag = true;   // a wobbly tap is still a tap
      if (!P.drag) return;
      P.end = this._snap(P.cell, e.clientX, e.clientY);
      this._drawCaps([P.cell, P.end]);
    });
    const up = e => {
      const P = this.press; if (!P || e.pointerId !== P.id) return; this.press = null;
      if (P.drag && P.end && (P.end[0] !== P.cell[0] || P.end[1] !== P.cell[1])) { this._select(P.cell, P.end); return; }
      this._tap(P.cell);
    };
    G.addEventListener('pointerup', up);
    G.addEventListener('pointercancel', e => { if (this.press?.id === e.pointerId) { this.press = null; this._drawCaps(); } });
    G.addEventListener('keydown', e => this._key(e));
    G.addEventListener('focusin', e => { const t = e.target.closest?.('.ws-cell'); if (t) this._focus([+t.dataset.r, +t.dataset.c], false); });
  }
  _tap(cell) {
    this._focus(cell, true);
    if (!this.start) { this._setStart(cell); this._say(`Starting at ${this.P.grid[cell[0] * this.P.z + cell[1]]}. Now tap the last letter of the word.`); return; }
    if (this.start[0] === cell[0] && this.start[1] === cell[1]) { this._setStart(null); this._say('Cancelled.'); return; }
    const a = this.start, dr = cell[0] - a[0], dc = cell[1] - a[1];
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) {            // not a straight line: start again here
      this._setStart(cell); this._say(`Words go in straight lines. Starting again at ${this.P.grid[cell[0] * this.P.z + cell[1]]}.`); return;
    }
    this._select(a, cell);
  }
  _focus(cell, move) {
    const old = this._cell(...this.focus); if (old) old.tabIndex = -1;
    this.focus = cell; const el = this._cell(...cell); el.tabIndex = 0;
    if (move && document.activeElement !== el && this.root.contains(document.activeElement)) el.focus();
    if (this.start) this._drawCaps([this.start, cell]);
  }
  _key(e) {
    if (!this.P || this._done) return;
    const z = this.P.z, [r, c] = this.focus, k = e.key;
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (mv) { e.preventDefault(); const n = [Math.max(0, Math.min(z - 1, r + mv[0])), Math.max(0, Math.min(z - 1, c + mv[1]))];
      this._focus(n, false); this._cell(...n).focus(); return; }
    if (k === 'Home' || k === 'End') { e.preventDefault(); const n = [r, k === 'Home' ? 0 : z - 1]; this._focus(n, false); this._cell(...n).focus(); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); this._tap([r, c]); return; }
    if (k === 'Escape' && this.start) { e.preventDefault(); this._setStart(null); this._drawCaps(); this._say('Cancelled.'); return; }
    if (k === 'h' || k === 'H') { e.preventDefault(); this.help(); }
  }
}

// ───────────────────────────── the plug-in ─────────────────────────────
const LEVEL_OF = { 8: 'Gentle', 10: 'Classic', 12: 'Challenge' };
const words = {
  id: 'words', name: 'Word Search', emoji: '🔤',
  blurb: 'Find the hidden words — big letters, friendly themes',
  usesPicture: false, zoomable: false, noun: 'word search', unit: 'words',
  tip: 'Tap the first letter of a word, then its last letter — or slide your finger across it.',
  options: [
    { key: 'size', label: 'How big?', choices: [[8, 'Gentle (8×8, words go across and down)'], [10, 'Classic (10×10, also diagonal)'], [12, 'Challenge (12×12, also backwards)']], default: 8 },
    { key: 'theme', label: 'Theme', choices: [['any', 'Surprise me'], ...THEMES.map(t => [t.id, t.name])], default: 'any' },
  ],
  newRecipe(seed, opts = {}) {
    const z = SIZES[opts.size] ? Number(opts.size) : 8, t = THEME.has(opts.theme) ? opts.theme : 'any';
    const r = { g: 'words', s: (Number(seed) >>> 0) & 0x7fffffff, z, t };
    build(r); return r;                                                  // build once now so the first screen is instant
  },
  normalize(r) {
    if (!r || typeof r !== 'object' || r.g !== 'words') return null;
    const { s, z, t } = r;
    if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
    if (!SIZES[z]) return null;
    if (t !== 'any' && !THEME.has(t)) return null;
    return { g: 'words', s, z, t };
  },
  title(r) { try { return `Word Search · ${build(r).theme.name}`; } catch (_) { return 'Word Search'; } },
  progressLabel(done, total) { return `${done} of ${total} words found`; },
  describe(r) { return `${LEVEL_OF[r.z] || ''} ${r.z}×${r.z} · ${SIZES[r.z]?.words || ''} words`.trim(); },
  finishText(r, seconds, stats) {
    const m = Math.max(1, Math.round((seconds || 0) / 60)), h = stats?.hints || 0;
    return `You found all ${SIZES[r.z]?.words || ''} words${h ? ` (with ${h} hint${h === 1 ? '' : 's'})` : ''} in about ${m} minute${m === 1 ? '' : 's'}!`;
  },
  create(host, hooks) { return new WordSearch(host, hooks); },
  _internal: { THEMES, SIZES, build, occurrences, cellsOf },            // for tests only
};
export default words;
