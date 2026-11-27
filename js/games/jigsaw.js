// The jigsaw puzzle as a game plug-in (see GAMES.md). The heavy lifting lives in ../engine.js.
import { Puzzle, gridFor } from '../engine.js';
import { SCENES, sceneName } from '../scenes.js';

const SCENE_IDS = new Set(SCENES.map(s => s.id));
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : undefined;
// Family-album pictures must come from this site's photos/ folder: compare the real resolved origin, not the text.
export const safePath = u => { if(typeof u !== 'string' || u.length > 300) return false;
  try{ const x = new URL(u, location.href); return x.origin === location.origin && x.pathname.includes('/photos/'); }catch(_){ return false; } };

export default {
  id: 'jigsaw', name: 'Jigsaw', emoji: '🧩', blurb: 'Your photos or painted pictures, 6 to 1000 pieces',
  usesPicture: true, noun: 'jigsaw puzzle', unit: 'pieces',
  tip: 'Tap a piece, then tap where it goes — or drag it.',
  options: [],                         // the shell has its own picture + piece-count choosers for jigsaws

  newRecipe(seed, { src, n }){ return { g:'jigsaw', src, n, k: seed|0 }; },

  /** Untrusted (link/backup) → clean recipe or null. */
  normalize(r){
    if(!r || typeof r !== 'object' || (r.g !== undefined && r.g !== 'jigsaw')) return null;
    const s = r.src; if(!s || typeof s !== 'object') return null;
    let src;
    if(s.t === 'scene' && SCENE_IDS.has(s.id) && int(s.s, 0, 2**31)) src = { t:'scene', id:s.id, s:s.s };
    else if(s.t === 'pic' && int(s.id, 0, 5000)) src = { t:'pic', id:s.id, ...(str(s.a,40) ? { a:str(s.a,40) } : {}) };
    else if(s.t === 'album' && safePath(s.u)) src = { t:'album', u:s.u.trim(), ...(str(s.c,60) ? { c:str(s.c,60) } : {}) };
    else if(s.t === 'img') src = { t:'img' };
    else return null;
    const n = Math.round(Number(r.n)); if(!(n >= 4 && n <= 1000)) return null;
    const k = Number.isFinite(Number(r.k)) ? Number(r.k)|0 : 0;
    const d = typeof r.d === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.d) ? r.d : undefined;
    return { g:'jigsaw', src, n, k, ...(d ? { d } : {}) };
  },

  title(r, from){
    const s = r.src;
    if(s.t === 'scene') return sceneName(s.id);
    if(s.t === 'pic') return s.a ? `Photo by ${s.a}` : 'A surprise photo';
    if(s.t === 'album') return s.c || 'From the family album';
    return from ? `A photo from ${from}` : 'A family photo';
  },
  progressLabel: (done, total) => `${done} of ${total}`,
  describe: r => `${r.n} pieces`,
  finishText(r, seconds){ const m = Math.max(1, Math.round(seconds/60)); return `You finished all ${r.n} pieces in about ${m} minute${m===1?'':'s'}.`; },

  create(host, hooks){
    const cv = document.createElement('canvas'); cv.className = 'stage-canvas'; host.appendChild(cv);
    cv.setAttribute('role', 'application');
    cv.setAttribute('aria-roledescription', 'jigsaw puzzle table');
    cv.setAttribute('aria-label', 'Puzzle table. Use the arrow keys to pick and move a piece, Enter to drop it, H for help.');
    const engine = new Puzzle(cv, hooks);
    engine.avoid = hooks.avoidRect || null;
    return {
      engine,
      async load(recipe, { image, state }){
        const { rows, cols } = gridFor(recipe.n, image.width/image.height);
        // saved state: {v:2, p:{id:[bx,by,placed]}} — v1 (older saves) keeps placed pieces, re-lays loose ones
        let p = state && typeof state === 'object' && state.p && typeof state.p === 'object' ? state.p : null;
        if(p){ const clean = {}, n = recipe.n * 1.2 + 10;                      // never trust saved positions blindly
          for(const [id, v] of Object.entries(p)){ if(Object.keys(clean).length > n) break;
            if(Array.isArray(v) && Number.isFinite(+v[0]) && Number.isFinite(+v[1])) clean[id] = [Math.min(7, Math.max(-6, +v[0])), Math.min(7, Math.max(-6, +v[1])), v[2] ? 1 : 0]; }
          p = Object.keys(clean).length ? clean : null; }
        engine.load(image, { rows, cols, shapeSeed: recipe.k, state: p || undefined, legacy: !!p && state.v !== 2 });
      },
      state: () => ({ v:2, p: engine.state() }),
      progress: () => ({ done: engine.placedCount, total: engine.pieces.length }),
      get done(){ return engine.done; },
      help: () => engine.help(),
      tidy: () => engine.tidy(),
      setPeek: on => engine.setPeek(on),
      setFilter: f => engine.setFilter(f), get filter(){ return engine.filter; }, get edgesUseful(){ return engine.pieces.length >= 24; },
      get peek(){ return engine.peek; },
      zoomIn: () => engine.zoomIn(), zoomOut: () => engine.zoomOut(), showAll: () => engine.showAll(),
      resize: () => engine.resize(),
      destroy(){ engine.gen++; cv.remove(); },
    };
  },
};
