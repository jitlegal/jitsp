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

// ---------- puzzle in progress ----------
// recipe: what the puzzle is (shareable); state: where pieces are; image: Blob of the picture.
export const current = {
  async save({recipe, state, seconds, progress, image, daily}){
    LS.set('jig.current', { g: recipe.g || 'jigsaw', recipe, state, seconds, progress: progress || null, daily: daily || null, sv: 2, at: Date.now() });
    if(image) await tx('images','readwrite', s => s.put(image, 'current')).catch(()=>{});
  },
  saveState(state, seconds, progress){ const c = LS.get('jig.current'); if(c){ c.state = state; c.seconds = seconds; if(progress) c.progress = progress; c.g = c.recipe?.g || 'jigsaw'; c.sv = 2; c.at = Date.now(); LS.set('jig.current', c); } },
  get(){ return LS.get('jig.current', null); },
  async image(){ try{ return await tx('images','readonly', s => s.get('current')); }catch(_){ return null; } },
  clear(){ LS.del('jig.current'); },
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
function dayBefore(day){ const [y,m,d] = day.split('-').map(Number), t = new Date(y, m-1, d-1);
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; }
export { dayBefore };
function yesterday(){ const d = new Date(); d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
