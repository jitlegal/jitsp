// Backups: move your scrapbook and the puzzle in progress to another device, as small as possible.
//
//  * Painted pictures carry NO pixels: (scene id, seed) repaints them exactly.
//  * Piece positions are bit-packed: 1 bit per piece for "placed", plus 16-bit x/y for loose pieces only.
//  * The description ("manifest") is deflated with the browser's own CompressionStream.
//  * Photos are stored once as raw WebP/JPEG bytes (never base64 inside the file).
//
// File layout (.jigsaw):  "JIG2" | u32 manifest length | deflated manifest | photo bytes...
// Save code (no photos): "JIG2." + base64url(deflated manifest) — short enough for a QR code.

const MAGIC = 'JIG2';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = bytes => { let s = ''; for(let i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));

// Read the (de)compressed stream with a hard cap, so a tiny hostile link can't inflate into gigabytes.
async function pipe(bytes, stream, cap = 8e6){
  const rd = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = []; let n = 0;
  for(;;){ const { done, value } = await rd.read(); if(done) break; n += value.length;
    if(n > cap){ rd.cancel().catch(()=>{}); throw new Error('too large'); } parts.push(value); }
  return concat(parts);
}
// flag byte: 1 = deflated, 0 = raw (very old browsers without CompressionStream)
async function pack(obj){
  const raw = enc.encode(JSON.stringify(obj));
  if(typeof CompressionStream === 'function'){ const z = await pipe(raw, new CompressionStream('deflate-raw')); return concat([Uint8Array.of(1), z]); }
  return concat([Uint8Array.of(0), raw]);
}
async function unpack(bytes){
  const body = bytes.subarray(1);
  const raw = bytes[0] === 1 ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
  return JSON.parse(dec.decode(raw));
}
function concat(parts){ const n = parts.reduce((a,p)=>a+p.length,0), o = new Uint8Array(n); let i = 0; for(const p of parts){ o.set(p,i); i += p.length; } return o; }

// ---------- bit-packed piece positions ----------
const LO = -6, SPAN = 13, Q = 65535, BITS = 16;         // board-relative positions, 16 bits each (< 1% of a piece)
export function packState(state, n){
  const bits = []; const put = (v, w) => { for(let i=w-1;i>=0;i--) bits.push((v>>i)&1); };
  for(let id=0; id<n; id++) put(state[id]?.[2] ? 1 : 0, 1);
  for(let id=0; id<n; id++){ const s = state[id]; if(!s || s[2]) continue;
    put(Math.round(Math.min(1,Math.max(0,(s[0]-LO)/SPAN))*Q), BITS); put(Math.round(Math.min(1,Math.max(0,(s[1]-LO)/SPAN))*Q), BITS); }
  const bytes = new Uint8Array(Math.ceil(bits.length/8)); bits.forEach((b,i) => { if(b) bytes[i>>3] |= 0x80 >> (i&7); });
  return b64u(bytes);
}
export function unpackState(code, n){
  const bytes = unb64u(code); let p = 0; const get = w => { let v = 0; for(let i=0;i<w;i++,p++) v = (v<<1) | ((bytes[p>>3] >> (7-(p&7))) & 1); return v; };
  const placed = Array.from({length:n}, () => get(1)), state = {};
  for(let id=0; id<n; id++) state[id] = placed[id] ? [0,0,1] : [ +(LO + get(BITS)/Q*SPAN).toFixed(4), +(LO + get(BITS)/Q*SPAN).toFixed(4), 0 ];
  return state;
}

// ---------- images ----------
const regenerable = r => !!(r && r.src && r.src.t === 'scene');   // painted pictures repaint exactly from their seed
const webpOK = (() => { try{ return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); }catch(_){ return false; } })();
async function compact(blob){
  // re-encode as WebP when the browser can (usually 30-50% smaller than JPEG at the same look)
  if(!webpOK) return new Uint8Array(await blob.arrayBuffer());
  const bmp = await createImageBitmap(blob), c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
  const w = await new Promise(ok => c.toBlob(ok, 'image/webp', 0.8));
  const smaller = w && w.size < blob.size ? w : blob;
  return new Uint8Array(await smaller.arrayBuffer());
}

/**
 * Build a backup. Returns {bytes, code|null, summary}.
 * data: {album:[...], current:{recipe,state,seconds}|null, currentImage:Blob|null, streak, settings}
 */
export async function exportBackup({ album, current, currentImage, streak, settings, playlists }){
  const blobs = [], add = async b => { const u = await compact(b); blobs.push(u); return blobs.length-1; };
  const m = { v:2, at: Date.now(), streak, settings, album: [], ...(playlists ? { pl: playlists } : {}) };
  for(const it of album){
    const e = { id: it.id, d: it.date, t: it.title, r: it.recipe, s: it.seconds };
    if(!regenerable(it.recipe) && it.full) e.i = await add(it.full);
    m.album.push(e);
  }
  if(current){
    const st = current.state || {}, isJigsaw = (current.recipe?.g || 'jigsaw') === 'jigsaw';
    m.cur = { r: current.recipe, s: current.seconds|0 };
    if(isJigsaw && st.p){ const n = Object.keys(st.p).length; m.cur.n = n; m.cur.v = st.v === 2 ? 2 : 1; m.cur.p = packState(st.p, n); }
    else m.cur.j = st;                                   // other games: small JSON state, deflated with the rest
    if(!regenerable(current.recipe) && currentImage) m.cur.i = await add(currentImage);
  }
  m.sizes = blobs.map(b => b.length);
  const head = await pack(m);
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
  const bytes = concat([enc.encode(MAGIC), len, head, ...blobs]);
  return { bytes, code: blobs.length ? null : `${MAGIC}.${b64u(head)}`,
    summary: { finished: m.album.length, inProgress: !!m.cur, photos: blobs.length, size: bytes.length } };
}

/** Read a backup from file bytes or a pasted save code. Returns {album:[...], current, streak, settings}. */
export async function importBackup(input){
  let head, blobArea = null;
  if(typeof input === 'string'){
    const s = input.trim().replace(/\s+/g,'');
    const code = s.includes('#b=') ? s.split('#b=')[1] : s;
    if(!code.startsWith(MAGIC + '.')) throw new Error('not a save code');
    head = unb64u(code.slice(MAGIC.length+1));
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if(dec.decode(bytes.subarray(0,4)) !== MAGIC) throw new Error('not a backup');
    const len = new DataView(bytes.buffer, bytes.byteOffset+4, 4).getUint32(0);
    head = bytes.subarray(8, 8+len); blobArea = bytes.subarray(8+len);
  }
  const m = await unpack(head);
  if(m.v !== 2) throw new Error('unsupported backup version');
  const blobs = []; let off = 0;
  for(const sz of m.sizes || []){ if(!blobArea || off+sz > blobArea.length) throw new Error('damaged'); blobs.push(new Blob([blobArea.subarray(off, off+sz)])); off += sz; }
  return {
    streak: m.streak, settings: m.settings, playlists: m.pl && typeof m.pl === 'object' ? m.pl : null,
    album: (Array.isArray(m.album) ? m.album : []).map(e => ({ id: e.id, date: e.d, title: e.t, recipe: e.r, seconds: e.s, image: Number.isInteger(e.i) ? blobs[e.i] || null : null })),
    current: m.cur ? { recipe: m.cur.r, seconds: m.cur.s,
      state: typeof m.cur.p === 'string' && Number.isInteger(m.cur.n) && m.cur.n > 0 && m.cur.n <= 1000 ? { v: m.cur.v === 2 ? 2 : 1, p: unpackState(m.cur.p, m.cur.n) } : (m.cur.j && typeof m.cur.j === 'object' ? m.cur.j : undefined),
      image: Number.isInteger(m.cur.i) ? blobs[m.cur.i] || null : null } : null,
  };
}
