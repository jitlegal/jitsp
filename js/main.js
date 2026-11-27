// The app shell: home screen, dialogs, settings, music, sharing, saving, scrapbook and backups —
// everything shared by all games. Each game is a plug-in in js/games/ (see GAMES.md).
import { gridFor } from './engine.js';
import { settings, current, album, streak, today, LS } from './store.js';
import { publicBase, makeLink, readLink, photoForLink, qrCanvas, shareLink, shareImage, copy, smsHref, mailHref, postcard, QR_MAX } from './share.js';
import { SCENES, paintScene, sceneName, pickScene } from './scenes.js';
import { createMusic, STATIONS } from './music.js';
import { exportBackup, importBackup } from './backup.js';
import { GAMES, gameOf, getGame } from './games/registry.js';
import { safePath } from './games/jigsaw.js';

const $ = s => document.querySelector(s);
/** Build DOM safely: text is always set as text, never parsed as HTML; only plain props/attributes. */
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag);
  for(const [k,v] of Object.entries(props)){
    if(v == null || v === false) continue;
    if(k === 'class') e.className = v;
    else if(/^on[a-z]+$/.test(k) && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if(k === 'style' || k.startsWith('aria-') || k.startsWith('data-') || k === 'role') e.setAttribute(k, v);
    else if(k in e && !/^(innerHTML|outerHTML|srcdoc)$/.test(k)) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter(x => x != null && x !== false)); return e; };
const randSeed = () => (Math.random()*2**31)|0;
const SIZES = [[6,'Easy'],[12,'Relaxed'],[24,'Challenge'],[48,'Expert']];
const jigsaw = getGame('jigsaw');
/** Bigger puzzles need a sharper picture so pieces stay crisp when zoomed in. */
const picSize = n => n > 300 ? 3200 : n > 100 ? 2600 : n > 48 ? 2000 : 1600;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------- screens, dialogs, toasts, announcements ----------------
function show(id){
  for(const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  if(id === 'play' && !history.state?.play) history.pushState({play:1}, '');
  if(id === 'home') refreshHome();
}
addEventListener('popstate', () => { if(!$('#play').classList.contains('hidden')) show('home'); });

let onDlgClose = null, dlgOpener = null;
function dialog(...nodes){
  const b = $('#dlgBody'), wasOpen = !$('#dlg').classList.contains('hidden');
  if(!wasOpen) dlgOpener = document.activeElement;
  b.replaceChildren(...nodes.flat(Infinity).filter(n => n != null && n !== false));
  const t = b.querySelector('h2'); if(t) t.id = 'dlgTitle';
  $('#dlg').classList.remove('hidden');
  (b.querySelector('[autofocus]') || $('#dlg .sheet')).focus();
}
function closeDialog(){
  $('#dlg').classList.add('hidden'); const f = onDlgClose; onDlgClose = null; f && f();
  if(dlgOpener && document.contains(dlgOpener) && dlgOpener.offsetParent !== null) dlgOpener.focus();   // back to where you were
  dlgOpener = null;
}
$('#dlgClose').onclick = closeDialog;
$('#dlg').addEventListener('click', e => { if(e.target.id === 'dlg') closeDialog(); });
addEventListener('keydown', e => {
  if($('#dlg').classList.contains('hidden')) return;
  if(e.key === 'Escape'){ closeDialog(); return; }
  if(e.key === 'Tab'){                                   // keep keyboard focus inside the open dialog
    const f = [...$('#dlg').querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.disabled && x.offsetParent !== null);
    if(!f.length) return; const first = f[0], last = f[f.length-1];
    if(e.shiftKey && (document.activeElement === first || document.activeElement === $('#dlg .sheet'))){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
});
let toastT;
function toast(text, ms = 4000){ const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.add('hidden'), ms); }
let annT;
/** Tell screen-reader users what just happened (polite, never interrupts). */
function announce(text){ const a = $('#announce'); a.textContent = ''; clearTimeout(annT); annT = setTimeout(() => { a.textContent = text; }, 60); }

// ---------------- look & feel (accessibility) ----------------
function applyLook(){
  const s = settings.get(), d = document.documentElement;
  d.style.setProperty('--ui-zoom', s.textScale || 1);
  d.style.setProperty('--card-scale', s.textScale || 1);
  if(s.contrast === 'high') d.dataset.contrast = 'high'; else delete d.dataset.contrast;
  if(s.table === 'light') d.dataset.table = 'light'; else delete d.dataset.table;
  if(s.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches) d.dataset.motion = 'reduce'; else delete d.dataset.motion;
}

// ---------------- sounds ----------------
let ac;
function chime(big){
  if(!settings.get().sounds) return;
  try{ ac ||= new AudioContext();
    (big ? [523,659,784,1047] : [660,880]).forEach((f,i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i*0.09;
      o.frequency.value = f; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.16,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+0.4);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t+0.45); });
  }catch(_){}
}

// ---------------- pictures (for games that use one) ----------------
function toCanvas(src, max = 1600){
  const s = Math.min(1, max/Math.max(src.width, src.height)), c = document.createElement('canvas');
  c.width = Math.round(src.width*s); c.height = Math.round(src.height*s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}
const loadImg = (url, cors) => new Promise((ok, fail) => { const i = new Image(); if(cors) i.crossOrigin = 'anonymous';
  i.onload = () => ok(i); i.onerror = () => fail(new Error('image')); i.src = url; });
async function fromBlob(blob){ const u = URL.createObjectURL(blob); try{ return await loadImg(u); } finally{ URL.revokeObjectURL(u); } }
const toBlob = (c, q = .85, max) => new Promise(ok => (max ? toCanvas(c, max) : c).toBlob(ok, 'image/jpeg', q));
async function imageFor(r, embed){
  const s = r.src, W = picSize(r.n), H = Math.round(W*0.75);
  if(s.t === 'scene') return paintScene(String(s.id), s.s|0, W, H);
  if(s.t === 'pic') return loadImg(`https://picsum.photos/id/${s.id|0}/${W}/${H}`, true);
  if(s.t === 'album' && safePath(s.u)) return loadImg(s.u);
  if(s.t === 'img' && typeof embed === 'string' && /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(embed)) return loadImg(embed);
  throw new Error('picture');
}
const MOODS = { seaside:'bubbly', balloons:'bubbly', tulips:'bubbly', birds:'bubbly', garden:'warm', autumn:'warm', quilt:'warm', lighthouse:'calm', night:'calm', mountains:'calm' };
const moodFor = r => r.g === 'solitaire' ? 'parlor' : r.src?.t === 'scene' ? (MOODS[r.src.id] || 'warm') : 'warm';

// ---------------- running a game ----------------
let active = null, thumbURL = null, starting = false;
const hooks = {
  onProgress: (n, t) => { if(active) $('#count').textContent = active.game.progressLabel(n, t); },
  onPlace: last => { chime(last); navigator.vibrate?.(25); hideTip(); },
  onChange: () => active && saveProgress(),
  onComplete: () => finished(),
  onTouch: () => hideTip(),
  onZoomable: z => { for(const b of document.querySelectorAll('.bar .zoom')) b.classList.toggle('hidden', !z || !active?.inst.zoomIn); },
  announce,
  avoidRect: () => { const t = $('#thumbBtn').getBoundingClientRect(), c = $('#stage').getBoundingClientRect();
    return t.width ? { x:t.left-c.left-10, y:t.top-c.top-10, w:t.width+20, h:t.height+20 } : null; },
};
function saveProgress(){ if(!active) return; current.saveState(active.inst.state(), active.seconds, active.inst.progress()); }

/** Start (or resume) any game from its recipe. source: a ready picture; embed: a photo from a link. */
async function startGame(recipe, { source, embed, resume } = {}){
  if(starting) return; starting = true;
  try{
    const game = gameOf(recipe); if(!game){ toast('Sorry — that game isn’t available here.'); return; }
    toast(`Getting your ${game.noun || 'game'} ready…`, 20000);
    let img = null;
    if(game.usesPicture){
      try{ img = toCanvas(source || await imageFor(recipe, embed), picSize(recipe.n)); }
      catch(_){
        if(recipe.src?.t === 'pic'){ toast("Couldn't fetch a photo just now — here's a painted picture instead.", 5000);
          recipe = { ...recipe, src:{ t:'scene', id:pickScene(randSeed()), s:randSeed() } }; img = paintScene(recipe.src.id, recipe.src.s, picSize(recipe.n), Math.round(picSize(recipe.n)*.75)); }
        else { toast("Sorry — that picture couldn't be opened.", 5000); return; }
      }
    }
    if(active){ try{ active.inst.destroy(); }catch(_){} }
    $('#stage').replaceChildren();
    show('play');
    // the preview picture (only games that use one)
    let blob = null;
    $('#thumbBtn').classList.toggle('hidden', !img);
    if(img){
      blob = await toBlob(img, .85);
      if(thumbURL) URL.revokeObjectURL(thumbURL);
      thumbURL = URL.createObjectURL(blob); $('#thumb').src = thumbURL;
      await $('#thumb').decode().catch(()=>{});          // the tray must know where the preview sits
    }
    await new Promise(r => requestAnimationFrame(r));
    const inst = game.create($('#stage'), hooks);
    active = { game, inst, recipe, img, title: game.title(recipe, recipe.f), seconds: resume?.seconds || 0, embed: recipe.src?.t === 'img' ? embed : null };
    await inst.load(recipe, { image: img, state: resume?.state });
    // toolbar: only the buttons this game supports
    $('#undoBtn').classList.toggle('hidden', !inst.undo);
    $('#tidyBtn').classList.toggle('hidden', !inst.tidy);
    $('#peekBtn').classList.toggle('hidden', !inst.setPeek); $('#peekBtn').setAttribute('aria-pressed', 'false');
    hooks.onZoomable(game.usesPicture && recipe.n >= 49);
    const p = inst.progress(); hooks.onProgress(p.done, p.total);
    if(!resume) await current.save({ recipe, state: inst.state(), seconds: 0, progress: p, image: blob });
    $('#toast').classList.add('hidden');
    announce(`${active.title}. ${game.describe(recipe)}. ${game.tip || ''}`);
    if(!resume && !LS.get('jig.tipSeen.' + game.id) && game.tip) showTip(game.tip, game.id);
    if(location.hash.startsWith('#p=')) history.replaceState(history.state, '', location.pathname + location.search);
    music.setContext?.({ seed: recipe.k ?? recipe.s ?? 0, mood: moodFor(recipe), title: active.title });
  } finally { starting = false; }
}

let tipT, tipGame = null;
function showTip(text, id){ tipGame = id; $('#tip').textContent = text; $('#tip').classList.remove('hidden'); clearTimeout(tipT); tipT = setTimeout(hideTip, 9000); }
function hideTip(){ if(!$('#tip').classList.contains('hidden')){ $('#tip').classList.add('hidden'); if(tipGame) LS.set('jig.tipSeen.' + tipGame, 1); } }

// gentle clock: only counts while a game is on screen
setInterval(() => {
  if(!active || active.inst.done || document.hidden || $('#play').classList.contains('hidden')) return;
  active.seconds++; if(active.seconds % 10 === 0) saveProgress();
}, 1000);

// ---------------- play bar ----------------
$('#homeBtn').onclick = () => { if(history.state?.play) history.back(); else show('home'); };
$('#peekBtn').onclick = () => { const i = active?.inst; if(!i?.setPeek) return; const on = !i.peek; i.setPeek(on); $('#peekBtn').setAttribute('aria-pressed', String(on)); announce(on ? 'Showing the picture faintly on the board.' : 'Picture hidden.'); };
$('#thumbBtn').onclick = () => $('#peekBtn').click();
$('#tidyBtn').onclick = () => { if(active?.inst.tidy){ active.inst.tidy(); saveProgress(); announce('Pieces tidied, edge pieces closest to the board.'); } };
$('#undoBtn').onclick = () => active?.inst.undo?.();
$('#helpBtn').onclick = () => active?.inst.help();
$('#zoomIn').onclick = () => active?.inst.zoomIn?.();
$('#zoomOut').onclick = () => active?.inst.zoomOut?.();
$('#seeAll').onclick = () => active?.inst.showAll?.();
$('#shareNow').onclick = () => active && shareDialog(active, false);
addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if(active && !$('#play').classList.contains('hidden')) active.inst.resize(); }, 150); });

// ---------------- finishing ----------------
async function finished(){
  const g = active; if(!g || g.finished) return; g.finished = true;
  const name = settings.get().name, isDaily = g.recipe.d === today() && g.game.id === 'jigsaw';
  const st = isDaily ? streak.complete() : null;
  current.clear();
  const pic = g.img || g.inst.snapshot?.() || null;
  if(pic) g.pic = pic;
  album.add({ id: Date.now(), date: today(), title: g.title, recipe: g.recipe, seconds: g.seconds, stats: g.inst.stats?.() || null,
    thumb: pic ? await toBlob(pic, .8, 480) : null, full: pic ? await toBlob(pic, .85, g.recipe.n > 100 ? 2600 : 1400) : null, embed: g.embed || null });
  setTimeout(async () => {
    const picURL = pic ? (g.img ? thumbURL : URL.createObjectURL(await toBlob(pic, .85, 900))) : null;
    dialog(
      h('h2', {}, name ? `Wonderful, ${name}!` : 'Wonderful!'),
      picURL ? h('img', { class:'win-pic', src: picURL, alt: g.title }) : null,
      h('p', { class:'big' }, g.game.finishText(g.recipe, g.seconds, g.inst.stats?.() || {})),
      st ? h('p', {}, st.count > 1 ? `🔥 That's ${st.count} days in a row!` : '🔥 Today’s puzzle is done. See you tomorrow for a new one!') : null,
      h('div', { class:'stack' },
        h('button', { class:'primary', autofocus:true, onclick: () => shareDialog(g, true) }, '💌 Share with family'),
        h('button', { class:'secondary', onclick: () => { closeDialog(); show('home'); } }, g.game.id === 'jigsaw' ? '🧩 Another puzzle' : `${g.game.emoji} Another game`),
        h('button', { class:'secondary', onclick: closeDialog }, g.game.usesPicture ? '🖼️ Look at the picture' : '👀 Look at the table')));
    announce(`Finished! ${g.game.finishText(g.recipe, g.seconds, g.inst.stats?.() || {})}`);
    chime(true);
  }, 650);
}

// ---------------- sharing ----------------
function shareDialog(g, done){
  const s = settings.get(), isPhoto = g.recipe.src?.t === 'img';
  let embed = isPhoto ? (g.embed || (g.img && photoForLink(g.img))) : null;
  if(isPhoto) g.embed = embed;
  if(isPhoto && !embed){ dialog(h('h2', {}, 'Sorry'), h('p', {}, "That photo is too detailed to fit in a link. Try a painted picture or a different photo.")); return; }
  const noun = g.game.noun || 'game';
  const nameIn = h('input', { type:'text', value: s.name, placeholder:'e.g. Grandma Jo', autocomplete:'name', maxLength: 40 });
  const noteIn = h('input', { type:'text', placeholder:'e.g. Thinking of you!', maxLength: 120 });
  const qrSlot = h('div'), sms = h('a', {}, '💬 Text message'), mail = h('a', {}, '✉️ Email');
  let link = '';
  if(!publicBase()) toast('Sharing works from the app’s web address, not from this computer’s test copy.', 6000);
  const update = () => {
    const name = nameIn.value.trim(), note = noteIn.value.trim();
    const { f, m, ...base } = g.recipe;
    link = makeLink({ ...base, ...(name ? { f:name } : {}), ...(note ? { m:note } : {}) }, embed);
    const msg = `${name || 'Someone'} sent you a ${noun}${note ? ` — “${note}”` : ''}. Tap to play: ${link}`;
    sms.href = smsHref(msg); mail.href = mailHref(`${name || 'Someone'} sent you a ${noun}`, msg);
    const qr = qrCanvas(link, 360);
    if(qr){ qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', 'Scan code that opens this game on another phone'); }
    qrSlot.replaceChildren(qr
      ? h('div', { class:'qrbox' }, qr, h('p', {}, h('b', {}, 'In the same room?'), ' They can point their phone camera at this square to open it.'))
      : h('p', { class:'muted' }, link.length > QR_MAX ? '📷 Your photo travels inside the link itself — nothing is uploaded anywhere. It’s too big for a scan code, so send it by message or email.' : ''));
  };
  nameIn.oninput = () => { settings.set({ name: nameIn.value.trim() }); update(); };
  noteIn.oninput = update; update();
  const text = () => `${nameIn.value.trim() || 'Someone'} sent you a ${noun}`;
  dialog(
    h('h2', {}, `Send this ${noun} to family`),
    h('p', { class:'muted' }, `They’ll get the very same ${noun}: “${g.title}”, ${g.game.describe(g.recipe)}.`),
    h('label', { class:'field' }, 'Your name', nameIn),
    h('label', { class:'field' }, 'A little note (optional)', noteIn),
    qrSlot,
    h('div', { class:'share-btns' },
      navigator.share ? h('button', { class:'primary', onclick: async () => { const r = await shareLink({ title: g.game.name, text: text(), url: link }); if(r==='copied') toast('Link copied — paste it into a message.'); } }, '📤 Send…') : null,
      sms, mail,
      h('button', { onclick: async () => toast(await copy(link) ? 'Link copied! Paste it into a message or email.' : 'Couldn’t copy — try Text message or Email.') }, '📋 Copy link'),
      done && (g.img || g.pic) ? h('button', { onclick: async () => {
        const blob = await postcard({ image: g.img || g.pic, name: nameIn.value.trim(), pieces: g.recipe.n, seconds: g.seconds, title: g.title, link: link.length <= QR_MAX ? link : null,
          line: g.game.finishText(g.recipe, g.seconds, g.stats || g.inst?.stats?.() || {}) });
        const r = await shareImage(blob, 'finished.jpg', text());
        if(r === 'saved') toast('Postcard saved to your downloads.'); } }, '🖼️ Postcard') : null));
}

// ---------------- receiving a shared game ----------------
const cleanText = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '';
function checkIncoming(){
  const got = readLink(); if(!got) return;
  const game = gameOf(got.raw), recipe = game && game.normalize(got.raw);
  if(!recipe){ toast('That link doesn’t open a game this app knows.'); history.replaceState(null, '', location.pathname + location.search); return; }
  const from = cleanText(got.raw.f, 40), note = cleanText(got.raw.m, 120);
  if(from) recipe.f = from;
  dialog(
    h('h2', {}, `💌 ${from || 'Someone'} sent you a ${game.noun}!`),
    note ? h('p', { class:'big' }, `“${note}”`) : null,
    h('p', {}, `${game.title(recipe, from)} · ${game.describe(recipe)}`),
    h('div', { class:'stack' },
      h('button', { class:'primary', autofocus:true, onclick: () => { closeDialog(); startGame(recipe, { embed: got.img }); } }, 'Start playing'),
      h('button', { class:'secondary', onclick: () => { closeDialog(); history.replaceState(null, '', location.pathname + location.search); } }, 'Maybe later')));
}
addEventListener('hashchange', () => checkBackupLink() || checkIncoming());

// ---------------- choosing a jigsaw ----------------
function chooseSize(then){
  const cur = settings.get().pieces;
  const pick = n => { settings.set({ pieces:n }); closeDialog(); then(n); };
  // granular 100–1000 for a real challenge, with big ± buttons because sliders are fiddly for shaky hands
  let big = cur >= 100 ? cur : 250;
  const num = h('div', { class:'count', 'aria-hidden':'true' }), mood = h('div', { class:'muted' });
  const range = h('input', { type:'range', min:100, max:1000, step:10, value:big, 'aria-label':'Number of pieces',
    oninput: e => { big = +e.target.value; paint(); } });
  const go = h('button', { class:'primary', style:'width:100%', onclick: () => pick(big) });
  const nudge = d => () => { big = Math.min(1000, Math.max(100, big + d)); range.value = big; paint(); announce(`${big} pieces`); };
  function paint(){
    num.textContent = `${big} pieces`; range.setAttribute('aria-valuetext', `${big} pieces`);
    mood.textContent = big <= 200 ? 'A relaxing afternoon' : big <= 500 ? 'A cosy weekend project' : 'A real classic — take your time';
    go.textContent = `Start with ${big} pieces`;
  }
  paint();
  dialog(h('h2', {}, 'How many pieces?'),
    h('p', { class:'muted' }, innerWidth < 600 ? 'Fewer pieces means bigger pieces. On a phone, 6 or 12 is most comfortable.' : 'Fewer pieces means bigger pieces.'),
    h('div', { class:'sizes', role:'group', 'aria-label':'Quick choices' }, SIZES.map(([n, label]) =>
      h('button', { class: n===cur ? 'on' : '', 'aria-pressed': String(n===cur), onclick: () => pick(n) }, String(n), h('small', {}, label)))),
    h('div', { class:'big-size', role:'group', 'aria-label':'A bigger challenge, 100 to 1000 pieces' },
      h('h3', {}, 'A bigger challenge'),
      num, mood,
      h('div', { class:'row' }, h('button', { onclick: nudge(-50), 'aria-label':'50 fewer pieces' }, '−'), range, h('button', { onclick: nudge(50), 'aria-label':'50 more pieces' }, '+')),
      h('p', { class:'muted' }, 'Big puzzles use a larger table: pinch or use ➕ ➖ to zoom, and drag the empty table to look around. Best on a tablet or computer.'),
      go));
}
const today$ = () => { const seed = [...today()].reduce((a,c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 1;
  return { g:'jigsaw', src:{ t:'scene', id: pickScene(seed), s: seed }, n: settings.get().pieces, k: seed ^ 0x2545F491, d: today() }; };
const newJigsaw = (src, n) => jigsaw.newRecipe(randSeed(), { src, n });

// Never silently replace a game in progress (playtest: grandparents lost their place this way).
function guardNew(go){
  const c = current.get(); if(!c || !gameOf(c.recipe)) return go();
  dialog(h('h2', {}, 'Start something new?'), h('p', { class:'big' }, 'You have a game in progress. Starting a new one will replace it.'),
    h('div', { class:'stack' }, h('button', { class:'primary', autofocus:true, onclick: () => { closeDialog(); $('#continueBtn').click(); } }, 'Keep going with my game'),
      h('button', { class:'secondary', onclick: () => { closeDialog(); go(); } }, 'Start the new one')));
}
$('#todayBtn').onclick = () => guardNew(() => startGame(today$()));
$('#photoBtn').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  if(f.size > 40e6){ toast('That photo is too large to open.'); return; }
  let img; try{ img = await fromBlob(f); }catch(_){ toast("Sorry — that photo couldn't be opened."); return; }
  chooseSize(n => guardNew(() => startGame(newJigsaw({ t:'img' }, n), { source: img })));
};
$('#paintBtn').onclick = () => {
  const grid = h('div', { class:'pics' });
  for(const sc of SCENES){
    const seed = randSeed(), c = paintScene(sc.id, seed, 320, 240);
    c.setAttribute('aria-hidden', 'true');
    grid.append(h('button', { onclick: () => chooseSize(n => guardNew(() => startGame(newJigsaw({ t:'scene', id: sc.id, s: seed }, n)))) },
      c, h('span', {}, h('span', { 'aria-hidden':'true' }, sc.emoji + ' '), sc.name)));
  }
  dialog(h('h2', {}, 'Painted pictures'), h('p', { class:'muted' }, 'Each one is freshly painted — no two are ever the same.'), grid);
};
$('#surpriseBtn').onclick = async () => {
  toast('Finding a lovely photo…', 15000);
  let pick = null;
  try{
    const r = await fetch(`https://picsum.photos/v2/list?page=${1 + (Math.random()*10|0)}&limit=100`);
    const list = (await r.json()).filter(p => p && Number.isFinite(+p.id) && p.width >= p.height);
    pick = list[(Math.random()*list.length)|0];
  }catch(_){}
  $('#toast').classList.add('hidden');
  const src = pick ? { t:'pic', id: +pick.id, a: cleanText(String(pick.author), 40) } : { t:'scene', id: pickScene(randSeed()), s: randSeed() };
  if(!pick) toast("No internet photo right now — here's a painted picture instead.", 5000);
  chooseSize(n => guardNew(() => startGame(newJigsaw(src, n))));
};
let family = [];
fetch('photos.json').then(r => r.ok ? r.json() : []).then(l => { family = (Array.isArray(l) ? l : []).map(x => typeof x === 'string' ? { src:x } : x).filter(x => x && safePath(x.src)); $('#familyBtn').classList.toggle('hidden', !family.length); }).catch(()=>{});
$('#familyBtn').onclick = () => dialog(h('h2', {}, 'Family album'), h('div', { class:'pics' }, family.map(p =>
  h('button', { onclick: () => chooseSize(n => startGame(newJigsaw({ t:'album', u: p.src, ...(p.title ? { c: cleanText(String(p.title), 60) } : {}) }, n))) },
    h('img', { src: p.src, alt: '', loading:'lazy' }), h('span', {}, cleanText(String(p.title || 'Family photo'), 60))))));

// ---------------- other games: tiles + options from the registry ----------------
function gameOptions(game){
  const chosen = { ...(settings.get()['opts_' + game.id] || {}) };
  const groups = (game.options || []).map(o => {
    if(!(o.key in chosen)) chosen[o.key] = o.default;
    const btns = o.choices.map(([v, label]) => h('button', { 'aria-pressed': String(chosen[o.key] === v),
      onclick: e => { chosen[o.key] = v; for(const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, label));
    return h('div', { class:'opt-group', role:'group', 'aria-label': o.label }, h('h3', {}, o.label), h('div', { class:'stack' }, btns));
  });
  dialog(h('h2', {}, `${game.name}`), h('p', { class:'muted' }, game.blurb), groups,
    h('button', { class:'primary', style:'width:100%;margin-top:16px', autofocus:true, onclick: async () => {
      settings.set({ ['opts_' + game.id]: chosen }); closeDialog();
      toast(`Shuffling…`, 8000); await new Promise(r => setTimeout(r, 30));
      const recipe = game.newRecipe(randSeed(), chosen);
      guardNew(() => startGame(recipe));
    } }, `Start ${game.name}`));
}
function renderGameTiles(){
  $('#gameTiles').prepend(...GAMES.filter(g => g.id !== 'jigsaw').map(g =>
    h('button', { class:'tile', onclick: () => gameOptions(g) }, h('span', { 'aria-hidden':'true' }, g.emoji), g.name)));
}

// ---------------- scrapbook ----------------
$('#albumBtn').onclick = async () => {
  const items = (await album.all()).filter(it => gameOf(it.recipe));
  if(!items.length){ dialog(h('h2', {}, 'My scrapbook'), h('p', { class:'big' }, 'Puzzles and games you finish will be kept here.')); return; }
  const urls = [];
  onDlgClose = () => urls.forEach(u => URL.revokeObjectURL(u));
  dialog(h('h2', {}, 'My scrapbook'), h('p', { class:'muted' }, `${items.length} finished so far. Tap one to play it again or share it.`),
    h('div', { class:'pics' }, items.map(it => { const game = gameOf(it.recipe), u = it.thumb ? URL.createObjectURL(it.thumb) : null; if(u) urls.push(u);
      return h('button', { onclick: () => albumItem(it) },
        u ? h('img', { src:u, alt:'' }) : h('div', { class:'continue-pic', style:'width:100%;height:auto;aspect-ratio:4/3', 'aria-hidden':'true' }, game.emoji),
        h('span', {}, it.title), h('span', { class:'meta' }, `${new Date(it.id).toLocaleDateString()} · ${game.describe(it.recipe)}`)); })));
};
async function albumItem(it){
  const game = gameOf(it.recipe);
  const img = it.full ? toCanvas(await fromBlob(it.full), game.usesPicture ? picSize(it.recipe.n) : 1400) : null;
  const g = { game, recipe: it.recipe, img: game.usesPicture ? img : null, pic: img, title: it.title, seconds: it.seconds, stats: it.stats, embed: it.embed };
  dialog(h('h2', {}, it.title), img ? h('img', { class:'win-pic', src: img.toDataURL('image/jpeg', .7), alt: it.title }) : null,
    h('div', { class:'stack' },
      h('button', { class:'primary', onclick: () => { closeDialog(); const { d, f, m, ...r } = it.recipe;
        startGame(game.usesPicture ? { ...r, k: randSeed() } : r, game.usesPicture ? { source: img } : {}); } }, `${game.emoji} Play it again`),
      h('button', { class:'secondary', onclick: () => shareDialog(g, true) }, '💌 Share with family'),
      h('button', { class:'secondary', onclick: async () => { await album.remove(it.id); closeDialog(); toast('Removed from your scrapbook.'); } }, '🗑️ Remove')));
}

$('#continueBtn').onclick = async () => {
  const c = current.get(); if(!c){ refreshHome(); return; }
  const game = gameOf(c.recipe); const recipe = game && game.normalize(c.recipe);
  if(!recipe){ current.clear(); refreshHome(); return; }
  if(c.recipe.f) recipe.f = cleanText(c.recipe.f, 40);
  let source;
  if(game.usesPicture){ const blob = await current.image(); if(!blob){ current.clear(); refreshHome(); return; } source = await fromBlob(blob); }
  // saves from before games existed stored the jigsaw map directly
  const state = c.g || (c.state && c.state.v) ? c.state : { v: c.sv === 2 ? 2 : 1, p: c.state };
  startGame(recipe, { source, resume: { ...c, state } });
};

// ---------------- music ----------------
let nowPlaying = null, musicState = 'paused', musicPanelOpen = false;
const music = createMusic({
  onTrack: t => { nowPlaying = t; if(musicPanelOpen) musicDialog(); else if(t && musicState === 'playing') toast(`🎵 ${t.title}${t.artist ? ' — ' + t.artist : ''}${t.year ? ` (${t.year})` : ''}`, 5000); },
  onState: s => { musicState = s; for(const b of [$('#homeMusic'), $('#playMusic')]){ b.classList.toggle('on', s === 'playing' || s === 'loading'); b.setAttribute('aria-label', s === 'playing' ? 'Music (playing)' : 'Music'); }
    if(musicPanelOpen) musicDialog(); },
});
function musicDialog(){
  musicPanelOpen = true; onDlgClose = () => { musicPanelOpen = false; };
  const on = music.playing || musicState === 'loading';
  const vol = h('input', { type:'range', min:0, max:1, step:.05, value: music.volume, 'aria-label':'Volume', 'aria-valuetext': `${Math.round(music.volume*100)} percent`,
    oninput: e => { music.setVolume(+e.target.value); e.target.setAttribute('aria-valuetext', `${Math.round(+e.target.value*100)} percent`); } });
  const groups = [['', STATIONS.filter(s => s.group !== 'nostalgia')], ['Nostalgia: real records from 1900–1925', STATIONS.filter(s => s.group === 'nostalgia')]].filter(([,l]) => l.length);
  dialog(h('h2', {}, '🎵 Music'),
    h('div', { class:'switch' }, h('span', {}, on ? 'Music is on' : 'Music is off'),
      h('button', { class: on ? 'on' : '', 'aria-pressed': String(on), onclick: () => on ? music.stop() : music.play() }, on ? 'Turn off' : 'Turn on')),
    groups.map(([label, list]) => [label ? h('h3', { style:'margin:16px 0 0;font:600 20px var(--title)' }, label) : null,
      h('div', { class:'stations', role:'group', 'aria-label': label || 'Music stations' }, list.map(st => h('button', { class: st.id === music.station ? 'on' : '', 'aria-pressed': String(st.id === music.station), onclick: () => music.play(st.id) },
        h('b', {}, h('span', { 'aria-hidden':'true' }, `${st.emoji} `), st.name), h('small', {}, st.blurb))))]),
    musicState === 'offline' ? h('p', { class:'muted' }, '📻 The old records can’t be reached right now, so gentle made-up music is playing instead. It will try again soon.') : null,
    nowPlaying && on ? h('div', { class:'now record' },
      nowPlaying.image && /^https:\/\/archive\.org\//.test(nowPlaying.image) ? h('img', { src: nowPlaying.image, alt:'The original record label', loading:'lazy', onerror: e => e.target.remove() }) : null,
      h('div', {}, h('small', { class:'muted' }, musicState === 'loading' ? 'Finding a record…' : 'Now playing'),
        h('b', {}, nowPlaying.title), h('span', {}, [nowPlaying.artist, nowPlaying.year].filter(Boolean).join(' · ')),
        nowPlaying.url && /^https:\/\/archive\.org\//.test(nowPlaying.url) ? h('div', {}, h('a', { href: nowPlaying.url, target:'_blank', rel:'noopener noreferrer' }, 'About this record')) : null)) : null,
    on ? h('button', { class:'secondary', style:'margin-top:10px;width:100%', onclick: () => music.next() }, '⏭️ Next song') : null,
    typeof music.setRestore === 'function' ? h('div', { class:'switch' },
      h('span', {}, 'Smooth out old-record crackle', h('small', { class:'muted', style:'display:block;font-weight:400' },
        music.cleanMode === 'plain' ? 'Not available for these records — playing them as they are.' : 'Softens pops, hiss and rumble from the 100-year-old records.')),
      h('button', { class: music.restore ? 'on' : '', 'aria-pressed': String(!!music.restore), onclick: () => { music.setRestore(!music.restore); musicDialog(); } }, music.restore ? 'On' : 'Off')) : null,
    h('label', { class:'field' }, 'Volume', vol));
}
$('#homeMusic').onclick = musicDialog;
$('#playMusic').onclick = musicDialog;
// Browsers only allow sound after a tap: resume music on the first tap if it was on last time.
if(music.enabled) addEventListener('pointerdown', function once(){ removeEventListener('pointerdown', once, true); if(!music.playing) music.play(); }, true);

// ---------------- settings (incl. accessibility) ----------------
$('#openSettings').onclick = () => {
  const s = settings.get();
  const nameIn = h('input', { type:'text', value: s.name, placeholder:'e.g. Grandma Jo', maxLength: 40, oninput: e => { settings.set({ name: e.target.value.trim() }); } });
  const toggle = (key, onVal, offVal, label, help) => {
    const btn = h('button', {}); const paint = () => { const on = settings.get()[key] === onVal; btn.className = on ? 'on' : ''; btn.textContent = on ? 'On' : 'Off'; btn.setAttribute('aria-pressed', String(on)); };
    btn.onclick = () => { settings.set({ [key]: settings.get()[key] === onVal ? offVal : onVal }); paint(); applyLook(); }; paint();
    return h('div', { class:'switch' }, h('span', {}, label, help ? h('small', { class:'muted', style:'display:block;font-weight:400' }, help) : null), btn);
  };
  const sizeBtns = [[1,'Normal'],[1.25,'Large'],[1.5,'Largest']].map(([v, label]) => h('button', { 'aria-pressed': String((s.textScale||1) === v),
    onclick: e => { settings.set({ textScale: v }); applyLook(); for(const b of e.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, label));
  onDlgClose = refreshHome;
  dialog(h('h2', {}, 'Settings'),
    h('label', { class:'field' }, 'Your name (shown on games you send)', nameIn),
    h('div', { class:'opt-group', role:'group', 'aria-label':'Text and button size' }, h('h3', {}, 'Text and button size'), h('div', { class:'seg' }, sizeBtns)),
    toggle('contrast', 'high', 'normal', 'High contrast', 'Black and white, with thick outlines'),
    toggle('motion', 'reduce', 'normal', 'Less movement', 'Pieces and cards jump instead of gliding'),
    toggle('table', 'light', 'dark', 'Light table', 'A pale table makes dark puzzle pieces easier to see'),
    toggle('sounds', true, false, 'Click sounds when something fits'),
    h('div', { class:'switch' }, h('span', {}, 'Music'), h('button', { onclick: musicDialog }, 'Choose…')),
    h('div', { class:'switch' }, h('span', {}, 'Back up or move my games'), h('button', { onclick: backupDialog }, 'Open…')),
    h('details', { style:'margin-top:16px' }, h('summary', { style:'font-weight:700;cursor:pointer;min-height:44px' }, 'Accessibility'),
      h('p', {}, 'Made to work with screen readers (VoiceOver, TalkBack, NVDA), a keyboard alone, browser zoom up to 400%, and the larger-text, high-contrast and less-movement choices above. Solitaire can be played fully by keyboard or screen reader. Jigsaw puzzles are a picture game, so they need sight, but every control has a spoken name and pieces can be moved with the arrow keys.')),
    h('p', { class:'muted', style:'margin-top:18px' }, 'Your games and photos stay on this device. Shared photos travel inside the link itself. Surprise photos come from Lorem Picsum (Unsplash photographers); music from the Internet Archive.'));
};

// ---------------- backup & restore ----------------
const kb = n => n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n/1024).toFixed(n<10240?1:0)} KB` : `${(n/1048576).toFixed(1)} MB`;
async function backupDialog(){
  const items = await album.all(), cur = current.get();
  const res = await exportBackup({ album: items, current: cur ? { ...cur, state: (cur.g || cur.state?.v) ? cur.state : { v: cur.sv === 2 ? 2 : 1, p: cur.state } } : null,
    currentImage: cur ? await current.image() : null, streak: LS.get('jig.streak', null), settings: settings.get() });
  const { finished, inProgress, photos, size } = res.summary;
  const what = [plural(finished, 'finished game'), inProgress ? '1 in progress' : null].filter(Boolean).join(' and ');
  const link = res.code ? location.href.split('#')[0] + '#b=' + res.code : null;
  const qr = link && qrCanvas(link, 360);
  if(qr){ qr.setAttribute('role', 'img'); qr.setAttribute('aria-label', 'Scan code that copies your games to another device'); }
  const fileIn = h('input', { type:'file', accept:'.jigsaw,application/octet-stream', hidden:true, onchange: async e => {
    const f = e.target.files[0]; e.target.value = ''; if(!f) return;
    if(f.size > 200e6){ dialog(h('h2', {}, 'Hmm'), h('p', { class:'big' }, 'That file is too large to be a backup.')); return; }
    restore(new Uint8Array(await f.arrayBuffer())); } });
  const codeIn = h('input', { type:'text', placeholder:'Paste a save code here', autocomplete:'off', 'aria-label':'Save code' });
  dialog(h('h2', {}, 'Back up & move games'),
    h('p', {}, `Your backup holds ${what || 'your settings'}${photos ? `, including ${plural(photos, 'photo')}` : ''} — just `, h('b', {}, kb(size)), '.'),
    qr ? h('div', { class:'qrbox' }, qr, h('p', {}, h('b', {}, 'Moving to a new tablet or phone?'), ' Point its camera at this square to copy everything over.')) : null,
    h('div', { class:'share-btns' },
      h('button', { class:'primary', onclick: async () => {
        const r = await shareImage(new Blob([res.bytes], { type:'application/octet-stream' }), `family-puzzles-${today()}.jigsaw`, 'My games backup');
        if(r === 'saved') toast('Backup saved to your downloads.'); } }, '💾 Save backup file'),
      res.code ? h('button', { onclick: async () => toast(await copy(link) ? 'Save code copied — paste it into an email to yourself.' : 'Couldn’t copy.') }, '📋 Copy save code') : null),
    h('h2', { style:'margin-top:22px;font-size:24px' }, 'Restore'),
    h('div', { class:'share-btns' }, h('button', { onclick: () => fileIn.click() }, '📂 Open a backup file'), fileIn),
    h('label', { class:'field' }, 'Or paste a save code', codeIn),
    h('button', { class:'secondary', style:'width:100%', onclick: () => codeIn.value.trim() && restore(codeIn.value) }, 'Restore from code'));
}
async function restore(input){
  let data;
  try{ data = await importBackup(input); }
  catch(_){ dialog(h('h2', {}, 'Hmm'), h('p', { class:'big' }, 'That doesn’t look like a backup, or it got cut off. Please try again.')); return; }
  toast('Restoring your games…', 20000);
  const have = new Set((await album.all()).map(a => a.id)); let added = 0;
  const imgOf = async (recipe, blob) => blob ? toCanvas(await fromBlob(blob), recipe.n ? picSize(recipe.n) : 1400)
    : recipe.src?.t === 'scene' ? paintScene(recipe.src.id, recipe.src.s, picSize(recipe.n), Math.round(picSize(recipe.n)*.75)) : null;
  for(const it of data.album.slice(0, 200)){
    const game = gameOf(it.recipe), recipe = game && game.normalize(it.recipe);
    if(!recipe || !Number.isFinite(it.id) || have.has(it.id)) continue;
    try{ const img = await imgOf(recipe, it.image);
      await album.add({ id: it.id, date: cleanText(it.date, 10), title: cleanText(it.title, 80) || game.title(recipe), recipe, seconds: Math.max(0, it.seconds|0), stats: null,
        thumb: img ? await toBlob(img, .8, 480) : null, full: img ? await toBlob(img, .85, recipe.n > 100 ? 2600 : 1400) : null, embed: null });
      have.add(it.id); added++; }catch(_){}
  }
  let curNote = '';
  if(data.current){
    const game = gameOf(data.current.recipe), recipe = game && game.normalize(data.current.recipe);
    if(current.get()) curNote = ' Your own game in progress was kept.';
    else if(recipe){ try{ const img = game.usesPicture ? await imgOf(recipe, data.current.image) : null;
      if(game.usesPicture && !img) throw 0;
      await current.save({ recipe, state: data.current.state, seconds: Math.max(0, data.current.seconds|0), progress: null, image: img ? await toBlob(img, .85) : null });
      curNote = ' Your game in progress is ready to continue.'; }catch(_){} }
  }
  const mine = LS.get('jig.streak', null), st = data.streak;
  if(st && typeof st === 'object' && Number.isFinite(st.total) && (!mine || st.total > (mine.total||0)))
    LS.set('jig.streak', { last: cleanText(st.last, 10) || null, count: Math.max(0, st.count|0), best: Math.max(0, st.best|0), total: Math.max(0, st.total|0) });
  if(data.settings && !settings.get().name && typeof data.settings.name === 'string') settings.set({ name: cleanText(data.settings.name, 40) });
  if(location.hash.startsWith('#b=')) history.replaceState(null, '', location.pathname + location.search);
  $('#toast').classList.add('hidden');
  dialog(h('h2', {}, 'All restored! 🎉'), h('p', { class:'big' }, `${plural(added, 'finished game')} added to your scrapbook.${curNote}`),
    h('button', { class:'primary', style:'width:100%', autofocus:true, onclick: () => { closeDialog(); show('home'); } }, 'Lovely'));
  refreshHome();
}
function checkBackupLink(){
  if(!location.hash.startsWith('#b=')) return false;
  dialog(h('h2', {}, 'Copy games to this device?'), h('p', { class:'big' }, 'This will add the scrapbook and game in progress from your other device. Nothing here will be deleted.'),
    h('div', { class:'stack' }, h('button', { class:'primary', autofocus:true, onclick: () => restore(location.hash) }, 'Yes, copy them over'),
      h('button', { class:'secondary', onclick: () => { closeDialog(); history.replaceState(null, '', location.pathname + location.search); } }, 'No thanks')));
  return true;
}

// ---------------- home ----------------
async function refreshHome(){
  const { name } = settings.get(), hr = new Date().getHours();
  $('#greet').textContent = `${hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}${name ? ', ' + name : ''}!`;
  const t = today$(), cv = $('#todayPic');
  if(cv.dataset.day !== t.d){ const p = paintScene(t.src.id, t.src.s, 480, 360); cv.getContext('2d').drawImage(p, 0, 0, 480, 360); cv.dataset.day = t.d; }
  $('#todayName').textContent = sceneName(t.src.id);
  cv.setAttribute('aria-label', `Preview of today's painted picture: ${sceneName(t.src.id)}`);
  const st = streak.get(), done = streak.doneToday();
  $('#streakText').textContent = done ? `✓ Done today${st.count > 1 ? ` — 🔥 ${st.count} days in a row` : ''}. A new one arrives tomorrow.`
    : st.count > 0 ? `🔥 ${st.count} day${st.count>1?'s':''} in a row — keep it going!` : 'A new painted picture every day.';
  $('#todayBtn').textContent = done ? 'Play it again' : 'Start today’s puzzle';
  const c = current.get(), game = c && gameOf(c.recipe);
  $('#continueCard').classList.toggle('hidden', !game);
  if(game){
    let prog = c.progress;
    if(!prog && game.id === 'jigsaw'){ const vals = Object.values(c.state?.p || c.state || {}); prog = { done: vals.filter(v => v && v[2]).length, total: vals.length }; }
    $('#continueText').textContent = `${game.title(c.recipe, c.recipe.f)}${prog ? ` — ${game.progressLabel(prog.done, prog.total)}` : ''}`;
    $('#continueBtn').setAttribute('aria-label', `Keep going with ${game.title(c.recipe, c.recipe.f)}`);
    $('#continueEmoji').textContent = game.usesPicture ? '' : game.emoji;
    const ti = $('#continueThumb'); ti.removeAttribute('src');
    if(game.usesPicture){ const blob = await current.image();
      if(blob){ const u = URL.createObjectURL(blob); ti.onload = () => URL.revokeObjectURL(u); ti.src = u; } }
  }
}

// ---------------- start-up ----------------
applyLook();
renderGameTiles();
show('home');
if(!checkBackupLink()) checkIncoming();
if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
// for automated tests
window.__jig = { get puzzle(){ return active?.inst.engine; }, get game(){ return active; }, makeLink, readLink };
