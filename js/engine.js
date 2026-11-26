// Jigsaw engine: procedural piece shapes, layout, rendering and touch/mouse interaction.
// Knows nothing about menus, storage or sharing — main.js wires those up.

export function rng(a){ return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/** Pick rows × cols close to n pieces with cells as square as possible. */
export function gridFor(n, aspect){
  let best = null;
  for(let c=2;c<=12;c++) for(let r=2;r<=12;r++){
    const s = Math.abs(r*c-n)*3 + Math.abs(Math.log((aspect*r)/c))*4;
    if(!best || s < best.s) best = {rows:r, cols:c, s};
  }
  return {rows:best.rows, cols:best.cols};
}

const BAR = 0;              // canvas is positioned by CSS; coordinates are canvas-local
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Puzzle {
  constructor(canvas, hooks = {}){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.hooks = hooks; this.pieces = []; this.board = null; this.peek = false;
    this.sel = null; this.drag = null; this.done = false; this.avoid = null;
    this._bind();
  }

  /** image: canvas/img; opts: {rows, cols, shapeSeed, state?:{id:[fx,fy,placed]}} */
  load(image, {rows, cols, shapeSeed, state}){
    this.img = image; this.rows = rows; this.cols = cols; this.shapeSeed = shapeSeed;
    this.done = false; this.sel = null; this.drag = null; this.peek = false;
    const R = rng(shapeSeed);
    const H = [...Array(rows-1)].map(()=>[...Array(cols)].map(()=>R()<.5?1:-1));
    const V = [...Array(rows)].map(()=>[...Array(cols-1)].map(()=>R()<.5?1:-1));
    this.pieces = [];
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) this.pieces.push({
      id:r*cols+c, r, c, placed:false, glow:0,
      shape:{ t:r>0?-H[r-1][c]:0, b:r<rows-1?H[r][c]:0, l:c>0?-V[r][c-1]:0, r:c<cols-1?V[r][c]:0 },
      edge:(r===0)+(c===0)+(r===rows-1)+(c===cols-1),
    });
    this._size(); this._fit(); this._renderAll();
    if(state){
      for(const pc of this.pieces){ const s = state[pc.id]; if(!s) continue;
        pc.placed = !!s[2];
        if(pc.placed) [pc.x,pc.y] = this.target(pc); else { pc.x = s[0]*this.W; pc.y = s[1]*this.H; } }
      this._clampLoose();
    } else this.tidy(true);
    this.pieces.sort((a,b)=>b.placed-a.placed);
    this.done = this.pieces.every(p=>p.placed);
    this._progress(); this.draw();
  }

  state(){ const s = {}; for(const pc of this.pieces) s[pc.id] = [+(pc.x/this.W).toFixed(4), +(pc.y/this.H).toFixed(4), pc.placed?1:0]; return s; }
  get placedCount(){ return this.pieces.filter(p=>p.placed).length; }

  // ---------- geometry ----------
  _size(){
    const r = this.cv.getBoundingClientRect();
    this.DPR = Math.min(2.5, devicePixelRatio || 1); this.W = r.width; this.H = r.height;
    this.cv.width = Math.round(this.W*this.DPR); this.cv.height = Math.round(this.H*this.DPR);
  }
  _layout(f = 1){
    const {W,H} = this, portrait = H > W*1.1, ar = this.img.width/this.img.height;
    const aw = W*(portrait?0.92:0.44)*f, ah = H*(portrait?0.44:0.66)*f;
    let bw = aw, bh = aw/ar; if(bh > ah){ bh = ah; bw = ah*ar; }
    const x = (W-bw)/2, y = portrait ? Math.max(12, H*0.03) : (H-bh)/2;
    this.board = {x, y, w:bw, h:bh, cw:bw/this.cols, ch:bh/this.rows};
    this.board.pad = Math.ceil(Math.min(this.board.cw, this.board.ch)*0.36);
  }
  /** Shrink the board (to 60% at most) until every loose piece gets its own spot in the tray. */
  _fit(){
    const n = this.pieces.filter(p=>!p.placed).length;
    for(const f of [1, .92, .84, .76, .68, .6]){ this._layout(f); if(this._slots(n).length >= n) return; }
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
  // Each piece is pre-rendered once (picture + bevel + resting shadow) so dragging stays smooth on old tablets.
  _renderAll(){
    const {cw,ch,pad,w,h} = this.board, D = this.DPR;
    for(const pc of this.pieces){
      pc.path = this._path(pc.shape);
      const mk = () => { const c = document.createElement('canvas');
        c.width = Math.ceil((cw+2*pad)*D); c.height = Math.ceil((ch+2*pad)*D);
        const g = c.getContext('2d'); g.scale(D,D); g.translate(pad,pad); return [c,g]; };
      const [flat, g] = mk();
      g.save(); g.clip(pc.path); g.drawImage(this.img, -pc.c*cw, -pc.r*ch, w, h);
      // soft bevel: light top-left, dark bottom-right
      g.lineWidth = Math.max(2, cw*0.03); g.strokeStyle = 'rgba(255,255,255,.35)'; g.translate(-1,-1); g.stroke(pc.path);
      g.strokeStyle = 'rgba(0,0,0,.30)'; g.translate(2,2); g.stroke(pc.path); g.restore();
      g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(pc.path);
      pc.flat = flat;
      const [lifted, g2] = mk();
      g2.shadowColor = 'rgba(0,0,0,.45)'; g2.shadowBlur = 6*D; g2.shadowOffsetY = 3*D;
      g2.drawImage(flat, -pad, -pad, cw+2*pad, ch+2*pad);
      pc.loose = lifted;
    }
  }

  /** Spread loose pieces in a neat grid around the board, edge pieces first. */
  tidy(shuffle=false){
    const list = this.pieces.filter(p=>!p.placed);
    if(shuffle){ for(let i=list.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [list[i],list[j]]=[list[j],list[i]]; } }
    else list.sort((a,b)=>b.edge-a.edge);
    const {cw,ch,pad} = this.board, {W,H} = this;
    const slots = this._slots(list.length);
    list.forEach((pc,i)=>{
      if(slots.length){ const [x,y] = slots[i % slots.length], k = Math.floor(i/slots.length); pc.x = x+k*pad*.5; pc.y = y+k*pad*.5; }
      else { pc.x = Math.random()*(W-cw); pc.y = Math.random()*(H-ch); }
    });
    // draw order: pieces later in the list on top
    this.pieces = [...this.pieces.filter(p=>p.placed), ...list.slice().reverse()];
    this.sel = null; this.draw();
  }
  _slots(want){
    const {cw,ch,pad,x:bx,y:by,w:bw,h:bh} = this.board, {W,H} = this, av = this.avoid ? this.avoid() : null;
    // Free space around the board, each side laid out on its own centred grid, filled in turn so both sides balance.
    const regions = [ {x:0, y:0, w:bx, h:H}, {x:bx+bw, y:0, w:W-bx-bw, h:H},
                      {x:bx, y:0, w:bw, h:by}, {x:bx, y:by+bh, w:bw, h:H-by-bh} ];
    let slots = [];
    for(const gap of [1.6,1.2,0.8,0.5,0.2,0]){
      const sx = cw+pad*gap, sy = ch+pad*gap, per = [];
      for(const R of regions){
        const nc = Math.floor((R.w - 1.5*pad + gap*pad)/sx), nr = Math.floor((R.h - 1.5*pad + gap*pad)/sy), out = [];
        if(nc < 1 || nr < 1){ per.push(out); continue; }
        const x0 = R.x + (R.w - (nc*sx - gap*pad))/2, y0 = R.y + (R.h - (nr*sy - gap*pad))/2;
        for(let r=0;r<nr;r++) for(let c=0;c<nc;c++){
          const x = x0 + c*sx, y = y0 + r*sy;
          if(av && x+cw+pad*.5>av.x && y+ch+pad*.5>av.y && x-pad*.5<av.x+av.w && y-pad*.5<av.y+av.h) continue;
          out.push([x,y]);
        }
        per.push(out);
      }
      slots = []; for(let i=0; per.some(o=>i<o.length); i++) for(const o of per) if(i<o.length) slots.push(o[i]);
      if(slots.length >= want) break;
    }
    return slots;
  }
  _clampLoose(){ const {cw,ch} = this.board;
    for(const pc of this.pieces) if(!pc.placed){ pc.x = Math.min(this.W-cw*.6, Math.max(-cw*.4, pc.x)); pc.y = Math.min(this.H-ch*.6, Math.max(-ch*.4, pc.y)); } }

  resize(){
    if(!this.img) return;
    const before = [this.W, this.H];
    this._size(); this._fit(); this._renderAll();
    for(const pc of this.pieces) if(pc.placed) [pc.x,pc.y] = this.target(pc);
    if(before[0] !== this.W || before[1] !== this.H) this.tidy();      // fresh, tidy tray after rotate/resize
    this.draw();
  }

  // ---------- drawing ----------
  draw(){
    const {ctx,W,H,board:b} = this; if(!b) return;
    ctx.setTransform(this.DPR,0,0,this.DPR,0,0); ctx.clearRect(0,0,W,H);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(b.x,b.y,b.w,b.h);
    if(this.peek){ ctx.globalAlpha = .35; ctx.drawImage(this.img,b.x,b.y,b.w,b.h); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.strokeRect(b.x-1.5,b.y-1.5,b.w+3,b.h+3);
    if(this.done){ ctx.drawImage(this.img,b.x,b.y,b.w,b.h); return; }
    const {cw,ch,pad} = b;
    for(const pc of this.pieces){
      const live = pc===this.drag || pc===this.sel || pc.glow>0;
      if(live){
        ctx.shadowColor = pc.glow>0 ? `rgba(255,236,140,${pc.glow})` : pc===this.sel ? '#ffd54f' : 'rgba(0,0,0,.5)';
        ctx.shadowBlur = pc===this.drag ? 20 : 22; ctx.shadowOffsetY = pc===this.drag ? 10 : 0;
      }
      const lift = pc===this.drag ? 1.04 : 1, ex = (cw+2*pad)*(lift-1)/2, ey = (ch+2*pad)*(lift-1)/2;
      ctx.drawImage(pc.placed || live ? pc.flat : pc.loose, pc.x-pad-ex, pc.y-pad-ey, (cw+2*pad)*lift, (ch+2*pad)*lift);
      if(live){ ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; }
    }
  }
  _raf(){ if(!this._q){ this._q = true; requestAnimationFrame(()=>{ this._q = false; this.draw(); }); } }

  // ---------- interaction: drag, or tap-a-piece-then-tap-a-spot ----------
  _pt(e){ const r = this.cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
  _pick(x,y){
    const {ctx} = this; ctx.setTransform(1,0,0,1,0,0);
    for(let i=this.pieces.length-1;i>=0;i--){ const pc = this.pieces[i];
      if(!pc.placed && ctx.isPointInPath(pc.path, x-pc.x, y-pc.y)) return pc; }
    let best = null, bd = Math.min(this.board.cw, this.board.ch)*0.7;      // forgiving near-miss
    for(const pc of this.pieces){ if(pc.placed) continue;
      const d = Math.hypot(x-(pc.x+this.board.cw/2), y-(pc.y+this.board.ch/2)); if(d<bd){ bd=d; best=pc; } }
    return best;
  }
  _toTop(pc){ this.pieces.splice(this.pieces.indexOf(pc),1); this.pieces.push(pc); }
  _near(pc){ const [tx,ty] = this.target(pc); return Math.hypot(pc.x-tx, pc.y-ty) < Math.min(this.board.cw,this.board.ch)*0.45; }
  _bind(){
    const cv = this.cv; let down = null, moved = false;
    cv.addEventListener('pointerdown', e => {
      if(!this.board || this.done || this._busy) return;
      const [x,y] = this._pt(e), pc = this._pick(x,y); down = [x,y]; moved = false;
      this.hooks.onTouch?.();
      if(!pc) return;
      this.drag = pc; pc.dx = x-pc.x; pc.dy = y-pc.y; this._toTop(pc);
      cv.setPointerCapture(e.pointerId); this._raf();
    });
    cv.addEventListener('pointermove', e => {
      if(!this.drag) return; const [x,y] = this._pt(e);
      if(!moved && Math.hypot(x-down[0], y-down[1]) > 8){ moved = true; this.sel = null; }
      if(!moved) return;
      const {cw,ch} = this.board;
      this.drag.x = Math.min(this.W-cw*.5, Math.max(-cw*.5, x-this.drag.dx));
      this.drag.y = Math.min(this.H-ch*.5, Math.max(-ch*.5, y-this.drag.dy));
      this._raf();
    });
    const up = e => {
      if(!down) return; const [x,y] = this._pt(e), pc = this.drag; this.drag = null; down = null;
      if(pc && moved){ if(this._near(pc)) this._lock(pc); else this._changed(); return; }
      if(pc){ this.sel = this.sel===pc ? null : pc; this.draw(); return; }
      if(this.sel){ const p = this.sel; this.sel = null;
        this._glide(p, x-this.board.cw/2, y-this.board.ch/2, 240, () => this._near(p) ? this._lock(p) : this._changed()); }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { this.drag = null; down = null; this.draw(); });
  }
  _glide(pc, tx, ty, ms, then){
    if(reduceMotion) ms = 1;
    const sx = pc.x, sy = pc.y, t0 = performance.now();
    const step = t => { const k = Math.min(1,(t-t0)/ms), e = 1-(1-k)**3;
      pc.x = sx+(tx-sx)*e; pc.y = sy+(ty-sy)*e; this.draw();
      if(k<1) requestAnimationFrame(step); else then && then(); };
    requestAnimationFrame(step);
  }
  _lock(pc){
    const [tx,ty] = this.target(pc);
    pc.placed = true; if(this.sel===pc) this.sel = null;
    this.pieces.splice(this.pieces.indexOf(pc),1); this.pieces.unshift(pc);
    const last = this.pieces.every(p=>p.placed);
    this.hooks.onPlace?.(last);
    this._glide(pc, tx, ty, 160, () => {
      pc.glow = 1; const f = () => { pc.glow -= .04; this.draw(); if(pc.glow>0) requestAnimationFrame(f); }; f();
      if(last && !this.done){ this.done = true; this.sel = null; this.draw(); this.hooks.onComplete?.(); }
      this._changed();
    });
  }
  _changed(){ this._progress(); this.draw(); this.hooks.onChange?.(); }
  _progress(){ this.hooks.onProgress?.(this.placedCount, this.pieces.length); }

  /** Glide one piece (the selected one, else an edge piece) into place. */
  help(){
    if(this.done || this._busy) return;
    const loose = this.pieces.filter(p=>!p.placed); if(!loose.length) return;
    const pc = (this.sel && !this.sel.placed) ? this.sel : loose.sort((a,b)=>b.edge-a.edge || a.r-b.r || a.c-b.c)[0];
    this._toTop(pc); this._busy = true;
    const [tx,ty] = this.target(pc);
    this._glide(pc, tx, ty, 650, () => { this._busy = false; this._lock(pc); });
  }
  setPeek(on){ this.peek = on; this.draw(); }
}
