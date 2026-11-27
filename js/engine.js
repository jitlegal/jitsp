// Jigsaw engine: procedural piece shapes, a zoomable table, fast rendering, touch/mouse/pen interaction.
// Scales from 6 to 1000 pieces. Knows nothing about menus, storage or sharing — main.js wires those up.
//
// Coordinates: pieces live in WORLD units (one cell is 100 units wide). A camera {s, ox, oy} maps
// world → screen: screen = world * s + offset. Small puzzles fit the screen exactly (no zooming);
// big ones get a larger table you can pinch/wheel-zoom and pan.
//
// Speed: everything that isn't moving is painted once into an off-screen "layer" and re-used; only the
// piece in your hand (or gliding/glowing) is redrawn per frame. Off-screen pieces are skipped, and tiny
// far-away pieces are drawn with less detail (level of detail).

export function rng(a){ return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/** Pick rows × cols close to n pieces (4–1000) with cells as square as possible. */
export function gridFor(n, aspect){
  let best = null;
  for(let c=2;c<=64;c++) for(const r0 of [Math.floor(n/c), Math.ceil(n/c)]){
    const r = Math.max(2, r0); if(r > 64) continue;
    const s = Math.abs(r*c-n)/n*40 + Math.abs(Math.log((aspect*r)/c))*4;
    if(!best || s < best.s) best = {rows:r, cols:c, s};
  }
  return {rows:best.rows, cols:best.cols};
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ZOOM_FROM = 49;          // puzzles with this many pieces or more get a zoomable table

export class Puzzle {
  constructor(canvas, hooks = {}){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas'); this.lctx = this.layer.getContext('2d');
    this.hooks = hooks; this.pieces = []; this.board = null; this.peek = false;
    this.sel = null; this.drag = null; this.done = false; this.avoid = null;
    this.cam = {s:1, ox:0, oy:0}; this.layerCam = null; this.dirty = true;
    this.sprites = new Map(); this.spriteScale = 0; this.spritePx = 0;   // piece pictures cached at the current zoom
    this.gen = 0;                       // bumps on every load: animations from an older puzzle stop themselves
    this._bind();
  }
  get zoomable(){ return this.pieces.length >= ZOOM_FROM; }
  get placedCount(){ let n = 0; for(const p of this.pieces) if(p.placed) n++; return n; }

  /** image: canvas/img; opts: {rows, cols, shapeSeed, state?:{id:[bx,by,placed]} (board-relative)} */
  load(image, {rows, cols, shapeSeed, state, legacy}){
    this.img = image; this.rows = rows; this.cols = cols; this.shapeSeed = shapeSeed;
    this.done = false; this.sel = null; this.drag = null; this.peek = false; this._busy = false; this.gen++;
    this._resetGesture?.();
    const R = rng(shapeSeed);
    const H = [...Array(rows-1)].map(()=>[...Array(cols)].map(()=>R()<.5?1:-1));
    const V = [...Array(rows)].map(()=>[...Array(cols-1)].map(()=>R()<.5?1:-1));
    // board geometry in world units: cells 100 wide, height keeps the picture's proportions
    const cw = 100, ch = 100 * (image.height/rows) / (image.width/cols);
    this.board = { x:0, y:0, cw, ch, w:cw*cols, h:ch*rows, pad: Math.min(cw,ch)*0.36 };
    this.pieces = [];
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) this.pieces.push({
      id:r*cols+c, r, c, placed:false, glow:0, x:0, y:0,
      shape:{ t:r>0?-H[r-1][c]:0, b:r<rows-1?H[r][c]:0, l:c>0?-V[r][c-1]:0, r:c<cols-1?V[r][c]:0 },
      edge:(r===0)+(c===0)+(r===rows-1)+(c===cols-1),
    });
    for(const pc of this.pieces) pc.path = this._path(pc.shape);
    this._dropSprites();
    if(state) for(const pc of this.pieces){ const s = state[pc.id]; if(s) pc.placed = !!s[2]; }
    this._size(); this._fit();
    if(state){
      for(const pc of this.pieces){ const s = state[pc.id]; if(!s) continue;
        if(pc.placed) [pc.x,pc.y] = this.target(pc);
        else { pc.x = this.board.x + s[0]*this.board.w; pc.y = this.board.y + s[1]*this.board.h; } }
      if(legacy) this.tidy(true);                        // positions from an older save: lay them out afresh
      this._growWorld();
    } else this.tidy(true);
    this.pieces.sort((a,b)=>b.placed-a.placed);
    this.done = this.pieces.every(p=>p.placed);
    this.home(false);
    this._progress(); this.hooks.onZoomable?.(this.zoomable);
  }

  /** Piece positions relative to the board (survive rotation, other screens and other devices). */
  state(){
    const {x,y,w,h} = this.board, s = {};
    for(const pc of this.pieces) s[pc.id] = [+((pc.x-x)/w).toFixed(4), +((pc.y-y)/h).toFixed(4), pc.placed?1:0];
    return s;
  }

  // ---------- table layout ----------
  _size(){
    const r = this.cv.getBoundingClientRect();
    this.DPR = Math.min(2, devicePixelRatio || 1); this.SW = Math.max(1, r.width); this.SH = Math.max(1, r.height);
    for(const c of [this.cv, this.layer]){ c.width = Math.round(this.SW*this.DPR); c.height = Math.round(this.SH*this.DPR); }
    if(this.sprites) this._dropSprites();
    this.dirty = true;
  }
  /** Table = screen-shaped area around the board, k times bigger than the snug fit. */
  _layout(k){
    const {SW,SH} = this, b = this.board, portrait = SH > SW*1.1;
    const base = Math.min(SW*(portrait?0.92:0.44)/b.w, SH*(portrait?0.44:0.66)/b.h);     // px per unit at k=1
    const W = SW/base*k, H = SH/base*k;
    b.x = (W-b.w)/2; b.y = portrait && k === 1 ? H*0.03 : (H-b.h)/2;
    this.world = {x:0, y:0, w:W, h:H}; this.k = k; this.base = base;
  }
  /** Grow the table until every loose piece has its own spot. */
  _fit(){
    const n = this.pieces.filter(p=>!p.placed).length;
    if(!n){ this._layout(1); return; }
    const ks = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.3, 2.6, 3, 3.5, 4, 4.6, 5.3, 6, 7, 8];
    for(const k of ks){ this._layout(k); if(this._slots(n, this._minGap()).length >= n) return; }
  }
  _minGap(){ return this.zoomable || this.k > 1 ? 0.6 : 0; }        // big tables always leave breathing room
  /** Make sure the table includes every piece (e.g. after loading a save made on another screen). */
  _growWorld(){
    const {cw,ch,pad} = this.board, w = this.world;
    let x0 = w.x, y0 = w.y, x1 = w.x+w.w, y1 = w.y+w.h;
    for(const pc of this.pieces){ x0 = Math.min(x0, pc.x-pad*.75); y0 = Math.min(y0, pc.y-pad*.75); x1 = Math.max(x1, pc.x+cw+pad*.75); y1 = Math.max(y1, pc.y+ch+pad*.75); }
    this.world = {x:x0, y:y0, w:x1-x0, h:y1-y0};
  }
  target(pc){ return [this.board.x + pc.c*this.board.cw, this.board.y + pc.r*this.board.ch]; }

  _edge(p, ax, ay, bx, by, s){
    if(!s){ p.lineTo(bx,by); return; }
    const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy), nx=dy/L, ny=-dx/L;
    const S = Math.min(this.board.cw, this.board.ch), k = S/L;
    const m = (x,h) => { const t = 0.5+(x-0.5)*k; return [ax+dx*t+nx*h*S*s, ay+dy*t+ny*h*S*s]; };
    p.lineTo(...m(0.37,0));
    p.bezierCurveTo(...m(0.40,0),   ...m(0.42,0.06), ...m(0.39,0.12));
    p.bezierCurveTo(...m(0.34,0.22),...m(0.40,0.30), ...m(0.50,0.30));
    p.bezierCurveTo(...m(0.60,0.30),...m(0.66,0.22), ...m(0.61,0.12));
    p.bezierCurveTo(...m(0.58,0.06),...m(0.60,0),    ...m(0.63,0));
    p.lineTo(bx,by);
  }
  _path(sh){
    const p = new Path2D(), w = this.board.cw, h = this.board.ch;
    p.moveTo(0,0); this._edge(p,0,0,w,0,sh.t); this._edge(p,w,0,w,h,sh.r);
    this._edge(p,w,h,0,h,sh.b); this._edge(p,0,h,0,0,sh.l); p.closePath(); return p;
  }

  /** Spread loose pieces in neat rows around the board. Tidy puts edge pieces closest to the board. */
  tidy(shuffle=false){
    const list = this.pieces.filter(p=>!p.placed);
    if(shuffle){ for(let i=list.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [list[i],list[j]]=[list[j],list[i]]; } }
    else list.sort((a,b)=>b.edge-a.edge || a.r-b.r || a.c-b.c);
    this._layout(this.k);                                   // fresh table, so repeated tidies don't creep bigger
    const {pad} = this.board, slots = this._slots(list.length, this._minGap());
    if(slots.length < list.length){ this._fit(); slots.splice(0, slots.length, ...this._slots(list.length, this._minGap())); }
    for(const pc of this.pieces) if(pc.placed) [pc.x,pc.y] = this.target(pc);     // the board may have moved
    if(!slots.length) slots.push([this.board.x + this.board.w + pad*2, this.board.y]);
    list.forEach((pc,i)=>{ const [x,y] = slots[i % slots.length], k = Math.floor(i/slots.length); pc.x = x+k*pad*.5; pc.y = y+k*pad*.5; });
    this.pieces = [...this.pieces.filter(p=>p.placed), ...list.slice().reverse()];
    this.sel = null; this._growWorld(); this.dirty = true; this.draw();
  }
  /** Free spots around the board, nearest first. minGap: keep at least this much space (in pads). */
  _slots(want, minGap = 0){
    if(want <= 0) return [];
    const {cw,ch,pad,x:bx,y:by,w:bw,h:bh} = this.board, {w:W,h:H} = this.world;
    const av = !this.zoomable && this.avoid ? this._avoidWorld() : null;
    const regions = [ {x:0, y:0, w:bx, h:H}, {x:bx+bw, y:0, w:W-bx-bw, h:H},
                      {x:bx, y:0, w:bw, h:by}, {x:bx, y:by+bh, w:bw, h:H-by-bh} ];
    let slots = [];
    for(const gap of [1.6,1.2,0.8,0.5,0.2,0].filter(g => g >= minGap)){
      const sx = cw+pad*gap, sy = ch+pad*gap; slots = [];
      for(const R of regions){
        const nc = Math.floor((R.w - 1.5*pad + gap*pad)/sx), nr = Math.floor((R.h - 1.5*pad + gap*pad)/sy);
        if(nc < 1 || nr < 1) continue;
        const x0 = R.x + (R.w - (nc*sx - gap*pad))/2, y0 = R.y + (R.h - (nr*sy - gap*pad))/2;
        for(let r=0;r<nr;r++) for(let c=0;c<nc;c++){
          const x = x0 + c*sx, y = y0 + r*sy;
          if(av && x+cw+pad*.5>av.x && y+ch+pad*.5>av.y && x-pad*.5<av.x+av.w && y-pad*.5<av.y+av.h) continue;
          // distance from the board edge; ties broken by angle so both sides fill evenly
          const dx = Math.max(bx-(x+cw), 0, x-(bx+bw)), dy = Math.max(by-(y+ch), 0, y-(by+bh));
          slots.push([x, y, Math.round(Math.hypot(dx,dy)/(Math.min(cw,ch)*.5)), Math.atan2(y+ch/2-(by+bh/2), x+cw/2-(bx+bw/2))]);
        }
      }
      if(slots.length >= want) break;
    }
    slots.sort((a,b)=> a[2]-b[2] || a[3]-b[3]);
    if(slots.length > want*1.02 && slots.length > 8){        // spread the chosen spots around all sides
      const ring = slots.filter(s => s[2] === slots[Math.min(want, slots.length)-1][2]);
      if(ring.length > 1){ const keep = slots.filter(s => s[2] < ring[0][2]); const need = want - keep.length;
        if(need > 0 && need < ring.length){ const step = ring.length/need; for(let i=0;i<need;i++) keep.push(ring[Math.floor(i*step)]); return keep.map(s=>[s[0],s[1]]); } }
    }
    return slots.map(s=>[s[0],s[1]]);
  }
  _avoidWorld(){
    const a = this.avoid(); if(!a) return null;
    const s = Math.min(this.SW/this.world.w, this.SH/this.world.h), ox = (this.SW-this.world.w*s)/2, oy = (this.SH-this.world.h*s)/2;
    return { x:(a.x-ox)/s, y:(a.y-oy)/s, w:a.w/s, h:a.h/s };
  }

  resize(){
    if(!this.img) return;
    const rel = this.state(), small = !this.zoomable, wasPortrait = this.SH > this.SW*1.1;
    const b0 = this.board, c0 = this.cam;                   // remember the view in board terms
    const view = { x:((this.SW/2-c0.ox)/c0.s - b0.x)/b0.w, y:((this.SH/2-c0.oy)/c0.s - b0.y)/b0.h, z: c0.s/this._fitWorldScale() };
    this._size(); this._fit();
    for(const pc of this.pieces){ const s = rel[pc.id];
      if(pc.placed) [pc.x,pc.y] = this.target(pc); else { pc.x = this.board.x + s[0]*this.board.w; pc.y = this.board.y + s[1]*this.board.h; } }
    const b = this.board, flipped = wasPortrait !== (this.SH > this.SW*1.1);
    const onBoard = this.pieces.some(pc => !pc.placed && pc.x+b.cw > b.x && pc.x < b.x+b.w && pc.y+b.ch > b.y && pc.y < b.y+b.h);
    // small puzzles: fresh tray only after a real rotation (or if pieces would sit on the board); big ones keep your arrangement
    if(small && (flipped || onBoard)) this.tidy(); else this._growWorld();
    if(small) this.home(false);
    else this._camTo(view.z*this._fitWorldScale(), b.x + view.x*b.w, b.y + view.y*b.h, 0);
    this.dirty = true; this.draw();
  }

  // ---------- camera ----------
  _fitWorldScale(){ return Math.min(this.SW/this.world.w, this.SH/this.world.h); }
  _limits(){ const lo = this._fitWorldScale()*0.9, hi = Math.max(lo*1.2, 2.6);   // up to ~260 px per piece
    return [lo, this.zoomable ? hi : this._fitWorldScale()]; }
  _clampCam(){
    const c = this.cam, w = this.world, [lo, hi] = this._limits();
    c.s = Math.min(hi, Math.max(lo, c.s));
    const fit = (o, size, view, start) => size*c.s <= view ? (view - size*c.s)/2 - start*c.s : Math.min(-start*c.s + view*0.25, Math.max(view*0.75 - (start+size)*c.s, o));
    c.ox = fit(c.ox, w.w, this.SW, w.x); c.oy = fit(c.oy, w.h, this.SH, w.y);
  }
  /** Default view: whole table for small puzzles; the board (with pieces around it) for big ones. */
  home(animate = true){
    const b = this.board, w = this.world;
    let s, cx, cy;
    if(!this.zoomable){ s = this._fitWorldScale(); cx = w.x + w.w/2; cy = w.y + w.h/2; }
    else {                                 // big puzzles: open close enough that pieces are comfortably large (≥ ~48 px)
      const fitBoard = Math.min(this.SW*0.62/b.w, this.SH*0.62/b.h), comfy = 48/Math.min(b.cw, b.ch);
      s = Math.max(fitBoard, comfy);
      if(s > fitBoard){ cx = b.x + Math.min(b.w/2, this.SW/s*0.45); cy = b.y + Math.min(b.h/2, this.SH/s*0.45); }   // start at the top-left corner, edge pieces in view
      else { cx = b.x + b.w/2; cy = b.y + b.h/2; }
    }
    this._camTo(s, cx, cy, animate ? 350 : 0);
  }
  zoomBy(f, sx = this.SW/2, sy = this.SH/2){
    const c = this.cam, wx = (sx-c.ox)/c.s, wy = (sy-c.oy)/c.s;
    c.s *= f; this._clampCam(); c.ox = sx - wx*c.s; c.oy = sy - wy*c.s; this._clampCam(); this._camMoved();
  }
  zoomIn(){ this._camTo(this.cam.s*1.6, ...this._center(), 250); }
  zoomOut(){ this._camTo(this.cam.s/1.6, ...this._center(), 250); }
  showAll(){ this._camTo(this._fitWorldScale(), this.world.x+this.world.w/2, this.world.y+this.world.h/2, 300); }
  _center(){ const c = this.cam; return [(this.SW/2-c.ox)/c.s, (this.SH/2-c.oy)/c.s]; }
  _camTo(s, cx, cy, ms, then){
    const c = this.cam, from = {...c};
    const to = { s }; { const [lo,hi] = this._limits(); to.s = Math.min(hi, Math.max(lo, s)); }
    to.ox = this.SW/2 - cx*to.s; to.oy = this.SH/2 - cy*to.s;
    const save = {...c}; Object.assign(c, to); this._clampCam(); Object.assign(to, c); Object.assign(c, save);
    if(!ms || reduceMotion){ Object.assign(c, to); this._camMoved(true); then && then(); return; }
    const t0 = performance.now(), gen = this.gen;
    const step = t => { if(gen !== this.gen) return; const k = Math.min(1,(t-t0)/ms), e = 1-(1-k)**3;
      c.s = from.s*Math.pow(to.s/from.s, e); c.ox = from.ox+(to.ox-from.ox)*e; c.oy = from.oy+(to.oy-from.oy)*e;
      this._camMoved(k >= 1); if(k<1) requestAnimationFrame(step); else then && then(); };
    requestAnimationFrame(step);
  }
  _camMoved(final){ clearTimeout(this._crisp); if(final) this.dirty = true; else this._crisp = setTimeout(()=>{ this.dirty = true; this._raf(); }, 140); this._raf(); }
  /** Keep a piece in view (keyboard play on big tables). */
  _follow(pc){ const {cw,ch} = this.board; if(this.zoomable && !(this._visible(pc.x,pc.y) && this._visible(pc.x+cw,pc.y+ch))) this._camTo(this.cam.s, pc.x+cw/2, pc.y+ch/2, 200); }
  _visible(wx, wy){ const c = this.cam, sx = wx*c.s+c.ox, sy = wy*c.s+c.oy; return sx > 0 && sy > 0 && sx < this.SW && sy < this.SH; }

  // ---------- drawing ----------
  _isLive(pc){ return pc === this.drag || pc === this.sel || pc.anim || pc.glow > 0; }
  /** Draw one piece in world space (caller has applied the camera transform). lod: 0 full, 1 no bevel, 2 square. */
  _drawPiece(g, pc, lod, lifted, s = this.cam.s, local = false){
    const {cw,ch,pad,w:bw} = this.board, img = this.img, k = img.width / bw;
    g.save(); if(!local) g.translate(pc.x, pc.y);
    if(lifted){ g.shadowColor = pc===this.sel ? '#ffd54f' : pc.glow>0 ? `rgba(255,236,140,${pc.glow})` : 'rgba(0,0,0,.5)';
      g.shadowBlur = (pc===this.drag ? 18 : 22)*this.DPR; g.shadowOffsetY = pc===this.drag ? 8*this.DPR : 0;
      g.fillStyle = '#000'; g.fill(pc.path); g.shadowColor = 'transparent'; }
    else if(!pc.placed && lod < 2){ g.fillStyle = 'rgba(0,0,0,.35)'; g.translate(1.5/s, 2.5/s); g.fill(pc.path); g.translate(-1.5/s, -2.5/s); }
    if(lod === 2){                                         // far away: a plain square of picture is enough
      g.drawImage(img, pc.c*cw*k, pc.r*this.board.ch*k, cw*k, ch*k, 0, 0, cw, ch); g.restore(); return; }
    g.clip(pc.path);
    const ix0 = Math.max(0, (pc.c*cw - pad)*k), iy0 = Math.max(0, (pc.r*ch - pad)*k);
    const ix1 = Math.min(img.width, (pc.c*cw + cw + pad)*k), iy1 = Math.min(img.height, (pc.r*ch + ch + pad)*k);
    g.drawImage(img, ix0, iy0, ix1-ix0, iy1-iy0, ix0/k - pc.c*cw, iy0/k - pc.r*ch, (ix1-ix0)/k, (iy1-iy0)/k);
    if(lod === 0){
      g.lineWidth = Math.max(2/s, cw*0.03); g.strokeStyle = 'rgba(255,255,255,.35)'; g.translate(-1/s,-1/s); g.stroke(pc.path);
      g.strokeStyle = 'rgba(0,0,0,.30)'; g.translate(2/s,2/s); g.stroke(pc.path); g.translate(-1/s,-1/s);
    }
    g.restore();
    g.save(); if(!local) g.translate(pc.x, pc.y);
    if(!pc.placed){ g.lineWidth = 2.2/s; g.strokeStyle = 'rgba(255,250,235,.55)'; g.stroke(pc.path); }   // light rim: dark pieces stay visible on the dark table
    g.lineWidth = 1/s; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(pc.path); g.restore();
  }
  /** A piece's picture rendered once at (roughly) the current zoom, then re-used: ~1000 cheap copies instead of
   *  1000 cut-outs with outlines. Zoom levels are bucketed in √2 steps; least-recently-used sprites are dropped. */
  _sprite(pc, lod){
    const {cw,ch,pad} = this.board, bs = Math.pow(2, Math.round(Math.log2(this.cam.s*this.DPR)*2)/2);
    if(bs !== this.spriteScale){ this._dropSprites(); this.spriteScale = bs; }
    const key = pc.id*4 + (pc.placed?2:0) + lod;
    let c = this.sprites.get(key);
    if(c){ this.sprites.delete(key); this.sprites.set(key, c); return c; }
    c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil((cw+2*pad)*bs)); c.height = Math.max(1, Math.ceil((ch+2*pad)*bs));
    const g = c.getContext('2d'); g.setTransform(bs,0,0,bs,pad*bs,pad*bs);
    this._drawPiece(g, pc, lod, false, bs/this.DPR, true);
    this.sprites.set(key, c); this.spritePx += c.width*c.height;
    // memory budget (~24 M pixels ≈ 96 MB) rather than a count, so zoomed-out 1000-piece tables stay fully cached
    while(this.spritePx > 24e6 && this.sprites.size > 1){ const [k0, c0] = this.sprites.entries().next().value; this.sprites.delete(k0); this.spritePx -= c0.width*c0.height; c0.width = c0.height = 0; }
    return c;
  }
  // Safari frees canvas memory late; shrinking a canvas to 0×0 hands its memory back straight away.
  _dropSprites(){ for(const c of this.sprites.values()){ c.width = c.height = 0; } this.sprites.clear(); this.spritePx = 0; }
  _paintLayer(){
    const g = this.lctx, {DPR} = this, c = this.cam, b = this.board, w = this.world;
    g.setTransform(1,0,0,1,0,0); g.clearRect(0,0,this.layer.width,this.layer.height);
    g.setTransform(c.s*DPR,0,0,c.s*DPR,c.ox*DPR,c.oy*DPR);
    if(this.zoomable){ g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(w.x,w.y,w.w,w.h); }
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(b.x,b.y,b.w,b.h);
    if(this.peek){ g.globalAlpha = .35; g.drawImage(this.img,b.x,b.y,b.w,b.h); g.globalAlpha = 1; }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3/c.s; g.strokeRect(b.x-1.5/c.s,b.y-1.5/c.s,b.w+3/c.s,b.h+3/c.s);
    if(this.done){ g.drawImage(this.img,b.x,b.y,b.w,b.h); }
    else {
      const px = Math.min(b.cw, b.ch)*c.s, lod = px < 9 ? 2 : px < 22 ? 1 : 0, pad = b.pad;
      const vx0 = -c.ox/c.s - pad, vy0 = -c.oy/c.s - pad, vx1 = (this.SW-c.ox)/c.s + pad, vy1 = (this.SH-c.oy)/c.s + pad;
      for(const pc of this.pieces){
        if(this._isLive(pc)) continue;
        if(pc.x+b.cw < vx0 || pc.y+b.ch < vy0 || pc.x > vx1 || pc.y > vy1) continue;    // off screen
        const l = pc.placed && lod === 0 ? 1 : lod;
        if(l === 2) this._drawPiece(g, pc, 2, false);
        else g.drawImage(this._sprite(pc, l), pc.x-pad, pc.y-pad, b.cw+2*pad, b.ch+2*pad);
      }
    }
    this.layerCam = {...c}; this.dirty = false;
  }
  draw(){
    if(!this.board) return;
    const {ctx,DPR} = this, c = this.cam;
    if(this.dirty || !this.layerCam) this._paintLayer();
    ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,this.cv.width,this.cv.height);
    const L = this.layerCam;
    if(L.s === c.s && L.ox === c.ox && L.oy === c.oy) ctx.drawImage(this.layer, 0, 0);
    else { const f = c.s/L.s; ctx.setTransform(f,0,0,f,(c.ox - L.ox*f)*DPR,(c.oy - L.oy*f)*DPR); ctx.drawImage(this.layer,0,0); }
    if(this.done) return;
    ctx.setTransform(c.s*DPR,0,0,c.s*DPR,c.ox*DPR,c.oy*DPR);
    for(const pc of this.pieces) if(this._isLive(pc)) this._drawPiece(ctx, pc, 0, true);
  }
  _raf(){ if(!this._q){ this._q = true; requestAnimationFrame(()=>{ this._q = false; this.draw(); }); } }

  // ---------- interaction ----------
  // one finger/mouse: drag a piece, or tap a piece then tap where it goes, or drag empty table to pan
  // two fingers: pinch to zoom and pan · mouse wheel: zoom · trackpad two-finger scroll: pan
  _pt(e){ const r = this.cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
  _w(x,y){ const c = this.cam; return [(x-c.ox)/c.s, (y-c.oy)/c.s]; }
  _pick(x,y){
    const [wx,wy] = this._w(x,y), {cw,ch,pad} = this.board, {ctx} = this; ctx.setTransform(1,0,0,1,0,0);
    for(let i=this.pieces.length-1;i>=0;i--){ const pc = this.pieces[i];
      if(pc.placed || pc.anim || wx < pc.x-pad || wy < pc.y-pad || wx > pc.x+cw+pad || wy > pc.y+ch+pad) continue;
      if(ctx.isPointInPath(pc.path, wx-pc.x, wy-pc.y)) return pc; }
    let best = null, bd = Math.max(Math.min(cw,ch)*0.7, 34/this.cam.s);          // forgiving near-miss for unsteady fingers
    for(const pc of this.pieces){ if(pc.placed || pc.anim) continue;
      const d = Math.hypot(wx-(pc.x+cw/2), wy-(pc.y+ch/2)); if(d<bd){ bd=d; best=pc; } }
    return best;
  }
  _toTop(pc){ const i = this.pieces.indexOf(pc); if(i >= 0){ this.pieces.splice(i,1); this.pieces.push(pc); } }
  _near(pc){ const [tx,ty] = this.target(pc); return Math.hypot(pc.x-tx, pc.y-ty) < Math.max(Math.min(this.board.cw,this.board.ch)*0.45, 28/this.cam.s); }
  _bind(){
    const cv = this.cv, ptrs = new Map(); let g = null;      // g: current gesture (owned by pointer g.id)
    this._resetGesture = () => { ptrs.clear(); g = null; };
    const endDrag = (snap) => { const pc = this.drag; this.drag = null; if(!pc || pc.placed) return;
      if(snap && this._near(pc)) this._lock(pc); else { this.dirty = true; this._changed(); } };
    const stale = pc => pc.placed || pc.anim;                   // the piece changed under the finger
    let lastTap = null;
    cv.addEventListener('pointerdown', e => {
      if(!this.board || this.done || this._busy) return;
      try{ cv.setPointerCapture(e.pointerId); }catch(_){}   // some browsers refuse capture (e.g. after a cancel); carry on
      const p = this._pt(e); ptrs.set(e.pointerId, p); this.hooks.onTouch?.();
      if(ptrs.size === 2 && this.zoomable){                          // second finger: pinch/pan the table
        if(this.drag) endDrag(false);
        const [a,b] = [...ptrs.values()], mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
        g = { type:'pinch', d0: Math.hypot(a[0]-b[0], a[1]-b[1]) || 1, s0: this.cam.s, w: this._w(...mid) };
        return;
      }
      if(ptrs.size > 1) return;                                      // extra fingers on small puzzles are ignored
      const pc = this._pick(...p);
      const slop = e.pointerType === 'mouse' ? 6 : 16;              // a wobbly finger-tap is still a tap
      if(pc){ g = { type:'piece', id:e.pointerId, pc, start:p, moved:false, slop }; const [wx,wy] = this._w(...p); pc.dx = wx-pc.x; pc.dy = wy-pc.y; }
      else g = { type:'table', id:e.pointerId, start:p, cam:{...this.cam}, moved:false, slop };
    });
    cv.addEventListener('pointermove', e => {
      if(!ptrs.has(e.pointerId) || !g) return;
      const p = this._pt(e); ptrs.set(e.pointerId, p);
      if(g.type === 'pinch'){
        if(ptrs.size < 2) return;
        const [a,b] = [...ptrs.values()], mid = [(a[0]+b[0])/2, (a[1]+b[1])/2], d = Math.hypot(a[0]-b[0], a[1]-b[1]);
        const c = this.cam; c.s = g.s0 * d/g.d0; this._clampCam(); c.ox = mid[0] - g.w[0]*c.s; c.oy = mid[1] - g.w[1]*c.s; this._clampCam();
        this._camMoved(); return;
      }
      if(e.pointerId !== g.id) return;                               // only the finger that started it
      const far = Math.hypot(p[0]-g.start[0], p[1]-g.start[1]) > (g.slop || 8);
      if(g.type === 'piece'){
        if(stale(g.pc)){ if(this.drag === g.pc) this.drag = null; g = null; this.dirty = true; this._raf(); return; }
        if(!g.moved && far){ g.moved = true; this.drag = g.pc; this._toTop(g.pc); if(this.sel === g.pc) this.sel = null; this.dirty = true; }
        if(!g.moved) return;
        const [wx,wy] = this._w(...p), {cw,ch} = this.board, w = this.world;
        g.pc.x = Math.min(w.x+w.w-cw*.5, Math.max(w.x-cw*.5, wx-g.pc.dx));
        g.pc.y = Math.min(w.y+w.h-ch*.5, Math.max(w.y-ch*.5, wy-g.pc.dy));
        this._raf();
      } else if(g.type === 'table' && this.zoomable){
        if(!g.moved && far) g.moved = true;
        if(!g.moved) return;
        this.cam.ox = g.cam.ox + p[0]-g.start[0]; this.cam.oy = g.cam.oy + p[1]-g.start[1]; this._clampCam(); this._camMoved();
      }
    });
    const up = e => {
      if(!ptrs.has(e.pointerId)) return;
      const p = this._pt(e); ptrs.delete(e.pointerId);
      if(!g) return;
      if(g.type === 'pinch'){
        if(ptrs.size === 1){ const [id, q] = [...ptrs.entries()][0];      // one finger left: carry on as a pan
          g = { type:'table', id, start:q, cam:{...this.cam}, moved:true }; }
        else if(ptrs.size === 0){ g = null; this._camMoved(true); }
        return;
      }
      if(e.pointerId !== g.id) return;                               // a resting thumb lifting doesn't end the drag
      const was = g; g = null;
      if(was.type === 'piece'){
        if(stale(was.pc)){ if(this.drag === was.pc) this.drag = null; this.dirty = true; this._raf(); return; }
        if(was.moved){ endDrag(true); return; }
        this.sel = this.sel === was.pc ? null : was.pc; this.dirty = true; this._raf(); return;       // tap: pick up / put down
      }
      if(was.type === 'table'){
        if(was.moved){ this._camMoved(true); return; }
        const now = performance.now();
        if(this.zoomable && !this.sel && lastTap && now - lastTap.t < 450 && Math.hypot(p[0]-lastTap.p[0], p[1]-lastTap.p[1]) < 40){
          lastTap = null; const [wx,wy] = this._w(...p); this._camTo(this.cam.s*2, wx, wy, 250); return;   // double-tap: zoom in there
        }
        lastTap = { t: now, p };
        if(this.sel && !stale(this.sel)){ const pc = this.sel, [wx,wy] = this._w(...p); this.sel = null;   // tap a spot: move the chosen piece there
          this._glide(pc, wx-this.board.cw/2, wy-this.board.ch/2, 240, () => this._near(pc) ? this._lock(pc) : this._changed()); }
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => {
      if(!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
      if(!g) return;
      if(g.type === 'pinch'){ if(ptrs.size === 0){ g = null; this._camMoved(true); } return; }
      if(e.pointerId !== g.id) return;
      if(g.type === 'piece' && g.moved) endDrag(false);
      g = null; this._camMoved(true);
    });
    let lastSideways = 0;
    // ---- keyboard play (WCAG 2.1.1): Tab to the table, arrows pick a piece, arrows move it, Enter drops it ----
    cv.tabIndex = 0;
    const say = t => this.hooks.announce?.(t);
    const loose = () => this.pieces.filter(p => !p.placed && !p.anim);
    const pickNext = dir => {
      const L = loose(); if(!L.length) return;
      L.sort((a,b) => a.y - b.y || a.x - b.x);                 // reading order on the table
      const i = this.sel ? L.indexOf(this.sel) : -1, pc = L[(i + dir + L.length) % L.length];
      this.sel = pc; this._toTop(pc); this.dirty = true; this._follow(pc); this._raf();
      say(`Piece selected${pc.edge ? ', an edge piece' : ''}. ${L.length} left. Arrow keys move it, Enter drops it.`);
    };
    cv.addEventListener('keydown', e => {
      if(!this.board || this.done || this._busy) return;
      const k = e.key, {cw,ch} = this.board, step = e.shiftKey ? 0.1 : 0.5;
      const arrows = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
      if(k === 'h' || k === 'H'){ this.help(); e.preventDefault(); return; }
      if(k === '+' || k === '='){ this.zoomIn(); e.preventDefault(); return; }
      if(k === '-' || k === '_'){ this.zoomOut(); e.preventDefault(); return; }
      if(k === 'n' || k === 'N'){ pickNext(1); e.preventDefault(); return; }
      if(k === 'p' || k === 'P'){ pickNext(-1); e.preventDefault(); return; }
      if(k === 'Escape' && this.sel){ this.sel = null; this.dirty = true; this._raf(); say('Piece put down.'); e.preventDefault(); return; }
      if(arrows[k]){
        e.preventDefault();
        if(!this.sel || this.sel.placed){ pickNext(arrows[k][0] + arrows[k][1] >= 0 ? 1 : -1); return; }
        const pc = this.sel, w = this.world;
        pc.x = Math.min(w.x+w.w-cw*.5, Math.max(w.x-cw*.5, pc.x + arrows[k][0]*cw*step));
        pc.y = Math.min(w.y+w.h-ch*.5, Math.max(w.y-ch*.5, pc.y + arrows[k][1]*ch*step));
        this._follow(pc); this._raf(); return;
      }
      if((k === 'Enter' || k === ' ') && this.sel){
        e.preventDefault(); const pc = this.sel;
        if(this._near(pc)){ this._lock(pc); say(`It fits! ${this.placedCount} of ${this.pieces.length} placed.`); }
        else { this.sel = null; this.dirty = true; this._changed(); say('Not quite there. The piece is set down; press N to pick it up again.'); }
      }
    });
    cv.addEventListener('focus', () => { if(!this.done) say('Puzzle table. Press the arrow keys or N to pick a piece, arrows to move it, Enter to drop it, H for help.'); });
    cv.addEventListener('wheel', e => {
      if(!this.board || !this.zoomable) return;
      e.preventDefault();
      if(e.deltaX) lastSideways = performance.now();
      // a mouse wheel moves in whole lines or ±100-ish integer steps; trackpads send small or fractional, often sideways deltas
      const [x,y] = this._pt(e), mouseWheel = e.deltaMode === 1 || (!e.deltaX && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && performance.now() - lastSideways > 400);
      if(e.ctrlKey || mouseWheel) this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018) * (e.deltaMode === 1 ? 33 : 1)), x, y);
      else { this.cam.ox -= e.deltaX; this.cam.oy -= e.deltaY; this._clampCam(); this._camMoved(); }
    }, { passive:false });
  }
  _glide(pc, tx, ty, ms, then){
    if(reduceMotion) ms = 1;
    const sx = pc.x, sy = pc.y, t0 = performance.now(), gen = this.gen, tok = (pc.glideTok = (pc.glideTok||0) + 1);
    pc.anim = true; this.dirty = true; this._toTop(pc);
    const step = t => {
      if(gen !== this.gen || tok !== pc.glideTok) return;            // a newer puzzle or a newer glide took over
      const k = Math.min(1,(t-t0)/ms), e = 1-(1-k)**3;
      pc.x = sx+(tx-sx)*e; pc.y = sy+(ty-sy)*e; this._raf();
      if(k<1) requestAnimationFrame(step); else { pc.anim = false; this.dirty = true; then && then(); } };
    requestAnimationFrame(step);
  }
  _lock(pc){
    if(pc.placed) return;                                            // never place the same piece twice
    const i = this.pieces.indexOf(pc); if(i < 0) return;             // piece from a puzzle that's gone
    const [tx,ty] = this.target(pc), gen = this.gen;
    pc.placed = true; if(this.sel===pc) this.sel = null; if(this.drag===pc) this.drag = null;
    this.pieces.splice(i,1); this.pieces.unshift(pc);
    const last = this.pieces.every(p=>p.placed);
    this.hooks.onPlace?.(last);
    this._glide(pc, tx, ty, 160, () => {
      if(gen !== this.gen) return;
      pc.glow = 1; this.dirty = true;
      const f = () => { if(gen !== this.gen) return; pc.glow -= .04; if(pc.glow <= 0){ pc.glow = 0; this.dirty = true; } this._raf(); if(pc.glow>0) requestAnimationFrame(f); }; f();
      if(last && !this.done){ this.done = true; this.sel = null; this.dirty = true; if(this.zoomable) this.home(); this.draw(); this.hooks.onComplete?.(); }
      this._changed();
    });
  }
  _changed(){ this._progress(); this.draw(); this.hooks.onChange?.(); }
  _progress(){ this.hooks.onProgress?.(this.placedCount, this.pieces.length); }

  /** Glide one piece (the selected one, else an edge piece) into place, moving the view if needed. */
  help(){
    if(this.done || this._busy) return;
    const free = p => !p.placed && !p.anim && p !== this.drag;
    let pc = this.sel && free(this.sel) ? this.sel : null;
    if(!pc){ let best = null; for(const p of this.pieces) if(free(p) && (!best || p.edge > best.edge || (p.edge === best.edge && (p.r < best.r || (p.r === best.r && p.c < best.c))))) best = p; pc = best; }
    if(!pc) return;
    this._busy = true; const gen = this.gen;
    const [tx,ty] = this.target(pc), {cw,ch} = this.board;
    const go = () => { if(gen !== this.gen) return; this._glide(pc, tx, ty, 650, () => { this._busy = false; this._lock(pc); }); };
    if(this.zoomable && !(this._visible(tx,ty) && this._visible(tx+cw,ty+ch))) this._camTo(this.cam.s, tx+cw/2, ty+ch/2, 400, go);
    else go();
  }
  setPeek(on){ this.peek = on; this.dirty = true; this.draw(); }
}
