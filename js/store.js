// Everything stays on this device: small settings in localStorage, pictures in IndexedDB.

const LS = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v==null ? d : JSON.parse(v); }catch(_){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} },
  del(k){ try{ localStorage.removeItem(k); }catch(_){} },
};
export { LS };

export const settings = {
  get(){ return { name:'', pieces:12, sounds:true, ...LS.get('jig.settings', {}) }; },
  set(patch){ LS.set('jig.settings', { ...settings.get(), ...patch }); },
};

// ---------- tiny IndexedDB wrapper ----------
let dbp;
function db(){
  dbp ||= new Promise((ok, fail) => {
    const r = indexedDB.open('family-jigsaw', 1);
    r.onupgradeneeded = () => { const d = r.result;
      d.createObjectStore('images'); d.createObjectStore('album', { keyPath:'id' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn){
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), req = fn(s);
    t.oncomplete = () => ok(req && req.result); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error || new Error('aborted'));   // e.g. storage full
  });
}

// ---------- games in progress: one save per game ----------
// recipe: what the game is (shareable); state: game-specific; image: Blob of the picture (picture games).
// Older versions kept a single save under 'jig.current'; it moves into its game's slot automatically.
const SAVES = 'jig.saves';
function saves(){
  const all = LS.get(SAVES, {}) || {};
  const old = LS.get('jig.current', null);
  if(old && old.recipe){ const g = old.recipe.g || 'jigsaw'; if(!all[g]) all[g] = { ...old, g, legacyImg: true }; LS.set(SAVES, all); LS.del('jig.current'); }
  return all;
}
const imgKey = (id, e) => e && e.legacyImg ? 'current' : 'current.' + id;
export const current = {
  async save({recipe, state, seconds, progress, image, daily}){
    const g = recipe.g || 'jigsaw', all = saves();
    all[g] = { g, recipe, state, seconds, progress: progress || null, daily: daily || null, sv: 2, at: Date.now() };
    LS.set(SAVES, all);
    if(image) await tx('images','readwrite', s => s.put(image, 'current.' + g)).catch(()=>{});
  },
  saveState(id, state, seconds, progress){ const all = saves(), c = all[id]; if(!c) return;
    c.state = state; c.seconds = seconds; if(progress) c.progress = progress; c.sv = 2; c.at = Date.now(); LS.set(SAVES, all); },
  get(id){ return saves()[id] || null; },
  /** All saved games, most recently played first. */
  all(){ return Object.values(saves()).filter(e => e && e.recipe).sort((a,b) => (b.at||0) - (a.at||0)); },
  async image(id){ const e = saves()[id]; try{ return await tx('images','readonly', s => s.get(imgKey(id, e))); }catch(_){ return null; } },
  clear(id){ const all = saves(), e = all[id]; delete all[id]; LS.set(SAVES, all);
    tx('images','readwrite', s => s.delete(imgKey(id, e))).catch(()=>{}); },
};

// ---------- finished puzzles ----------
export const album = {
  async add(entry){ try{ await tx('album','readwrite', s => s.put(entry)); }catch(_){} },
  async all(){ try{ const a = await tx('album','readonly', s => s.getAll()); return (a||[]).sort((x,y)=>y.id-x.id); }catch(_){ return []; } },
  async remove(id){ try{ await tx('album','readwrite', s => s.delete(id)); }catch(_){} },
};

// ---------- daily puzzle streak ----------
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function makeStreak(key){ return {
  get(){
    const s = LS.get(key, { last:null, count:0, best:0, total:0 });
    if(s.last && s.last !== today() && s.last !== yesterday()) s.count = 0;      // missed a day
    return s;
  },
  doneToday(){ return LS.get(key, {}).last === today(); },
  /** Credit the day the puzzle belongs to (a puzzle started before midnight still counts). */
  complete(day = today()){
    const s = this.get(); if(s.last && s.last >= day) return s;
    s.count = s.last === dayBefore(day) ? s.count + 1 : 1;
    s.best = Math.max(s.best, s.count); s.total = (s.total||0) + 1; s.last = day;
    LS.set(key, s); return s;
  },
}; }
export const streak = makeStreak('jig.streak');
export const dealStreak = makeStreak('jig.streak.deal');
const streaks = { solitaire: dealStreak };
/** One streak per daily game (Solitaire keeps its original key). */
export const gameStreak = id => streaks[id] ||= makeStreak('jig.streak.' + id);
function dayBefore(day){ const [y,m,d] = day.split('-').map(Number), t = new Date(y, m-1, d-1);
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
export { dayBefore };
function yesterday(){ const d = new Date(); d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
