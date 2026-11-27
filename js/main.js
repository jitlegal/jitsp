import { Puzzle, gridFor } from './engine.js';
import { settings, current, album, streak, today, LS } from './store.js';
import { makeLink, readLink, photoForLink, qrCanvas, shareLink, shareImage, copy, smsHref, mailHref, postcard, QR_MAX } from './share.js';
import { SCENES, paintScene, sceneName, pickScene } from './scenes.js';
import { createMusic, STATIONS } from './music.js';
import { exportBackup, importBackup } from './backup.js';

const $ = s => document.querySelector(s);
/** Build DOM safely: text is always set as text, never parsed as HTML. */
const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag);
  for(const [k,v] of Object.entries(props)){ if(k==='class') e.className = v; else if(k.startsWith('on')) e.addEventListener(k.slice(2), v); else if(k in e) e[k] = v; else e.setAttribute(k, v); }
  e.append(...kids.flat().filter(x => x!=null && x!==false)); return e; };
const randSeed = () => (Math.random()*2**31)|0;
const SIZES = [[6,'Easy'],[12,'Relaxed'],[24,'Challenge'],[48,'Expert']];
/** Bigger puzzles need a sharper picture so pieces stay crisp when zoomed in. */
const picSize = n => n > 300 ? 3200 : n > 100 ? 2600 : n > 48 ? 2000 : 1600;

// ---------------- screens, dialogs, toasts ----------------
function show(id){
  for(const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  if(id === 'play' && !history.state?.play) history.pushState({play:1}, '');
  if(id === 'home') refreshHome();
}
addEventListener('popstate', () => { if(!$('#play').classList.contains('hidden')) show('home'); });

let onDlgClose = null;
function dialog(...nodes){ const b = $('#dlgBody'); b.replaceChildren(...nodes.flat().filter(n => n != null && n !== false)); $('#dlg').classList.remove('hidden'); $('#dlg .sheet').focus(); }
function closeDialog(){ $('#dlg').classList.add('hidden'); const f = onDlgClose; onDlgClose = null; f && f(); }
$('#dlgClose').onclick = closeDialog;
$('#dlg').addEventListener('click', e => { if(e.target.id === 'dlg') closeDialog(); });
addEventListener('keydown', e => { if(e.key === 'Escape' && !$('#dlg').classList.contains('hidden')) closeDialog(); });
let toastT;
function toast(text, ms = 4000){ const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(()=>t.classList.add('hidden'), ms); }

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

// ---------------- pictures ----------------
function toCanvas(src, max = 1600){
  const s = Math.min(1, max/Math.max(src.width, src.height)), c = document.createElement('canvas');
  c.width = Math.round(src.width*s); c.height = Math.round(src.height*s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c;
}
const loadImg = (url, cors) => new Promise((ok, fail) => { const i = new Image(); if(cors) i.crossOrigin = 'anonymous';
  i.onload = () => ok(i); i.onerror = () => fail(new Error('image')); i.src = url; });
async function fromBlob(blob){ const u = URL.createObjectURL(blob); try{ return await loadImg(u); } finally{ URL.revokeObjectURL(u); } }
const toBlob = (c, q = .85, max) => new Promise(ok => (max ? toCanvas(c, max) : c).toBlob(ok, 'image/jpeg', q));
const safePath = u => typeof u === 'string' && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u);    // family-album paths must stay on this site

function titleOf(r){
  const s = r.src;
  if(s.t === 'scene') return sceneName(s.id);
  if(s.t === 'pic') return s.a ? `Photo by ${s.a}` : 'A surprise photo';
  if(s.t === 'album') return s.c || 'From the family album';
  return r.f ? `A photo from ${r.f}` : 'A family photo';
}
async function imageFor(r, embed){
  const s = r.src;
  const W = picSize(r.n), H = Math.round(W*0.75);
  if(s.t === 'scene') return paintScene(String(s.id), s.s|0, W, H);
  if(s.t === 'pic') return loadImg(`https://picsum.photos/id/${s.id|0}/${W}/${H}`, true);
  if(s.t === 'album' && safePath(s.u)) return loadImg(s.u);
  if(s.t === 'img' && typeof embed === 'string' && embed.startsWith('data:image/')) return loadImg(embed);
  throw new Error('picture');
}

// ---------------- the game ----------------
let game = null, thumbURL = null;
const puzzle = new Puzzle($('#cv'), {
  onProgress: (n, t) => { $('#count').textContent = `${n} of ${t}`; },
  onPlace: last => { chime(last); navigator.vibrate?.(25); hideTip(); },
  onChange: () => game && current.saveState(puzzle.state(), game.seconds),
  onComplete: () => finished(),
  onTouch: () => hideTip(),
  onZoomable: z => { for(const b of document.querySelectorAll('.bar .zoom')) b.classList.toggle('hidden', !z); },
});
puzzle.avoid = () => { const t = $('#thumb').getBoundingClientRect(), c = $('#cv').getBoundingClientRect();
  return t.width ? { x:t.left-c.left-10, y:t.top-c.top-10, w:t.width+20, h:t.height+20 } : null; };

async function startPuzzle(recipe, { source, embed, resume } = {}){
  toast('Getting your puzzle ready…', 20000);
  let img;
  try{ img = toCanvas(source || await imageFor(recipe, embed), picSize(recipe.n)); }
  catch(_){
    if(recipe.src.t === 'pic'){ toast("Couldn't fetch a photo just now — here's a painted picture instead.", 5000);
      recipe = { ...recipe, src:{ t:'scene', id:pickScene(randSeed()), s:randSeed() } }; img = paintScene(recipe.src.id, recipe.src.s, picSize(recipe.n), Math.round(picSize(recipe.n)*.75)); }
    else { toast("Sorry — that picture couldn't be opened.", 5000); return; }
  }
  const { rows, cols } = gridFor(recipe.n, img.width/img.height);
  game = { recipe, img, title: titleOf(recipe), seconds: resume?.seconds || 0, embed: recipe.src.t === 'img' ? embed : null };
  show('play');
  const blob = await toBlob(img, .85);
  if(thumbURL) URL.revokeObjectURL(thumbURL);
  thumbURL = URL.createObjectURL(blob); $('#thumb').src = thumbURL;
  await $('#thumb').decode().catch(()=>{});          // the tray must know where the preview sits
  await new Promise(r => requestAnimationFrame(r));
  puzzle.load(img, { rows, cols, shapeSeed: recipe.k, state: resume?.state, legacy: !!resume && resume.sv !== 2 });
  $('#peekBtn').setAttribute('aria-pressed', 'false');
  if(!resume) await current.save({ recipe, state: puzzle.state(), seconds: 0, image: blob });
  $('#toast').classList.add('hidden');
  if(!resume && !LS.get('jig.tipSeen')) showTip();
  if(location.hash.startsWith('#p=')) history.replaceState(history.state, '', location.pathname + location.search);
}

let tipT;
function showTip(){ $('#tip').classList.remove('hidden'); clearTimeout(tipT); tipT = setTimeout(hideTip, 9000); }
function hideTip(){ if(!$('#tip').classList.contains('hidden')){ $('#tip').classList.add('hidden'); LS.set('jig.tipSeen', 1); } }

// gentle clock: only counts while the puzzle is on screen
setInterval(() => {
  if(!game || puzzle.done || document.hidden || $('#play').classList.contains('hidden')) return;
  game.seconds++; if(game.seconds % 10 === 0) current.saveState(puzzle.state(), game.seconds);
}, 1000);

// ---------------- play bar ----------------
$('#homeBtn').onclick = () => { if(history.state?.play) history.back(); else show('home'); };
$('#peekBtn').onclick = () => { const on = !puzzle.peek; puzzle.setPeek(on); $('#peekBtn').setAttribute('aria-pressed', String(on)); };
$('#thumb').onclick = () => $('#peekBtn').click();
$('#tidyBtn').onclick = () => { puzzle.tidy(); current.saveState(puzzle.state(), game?.seconds||0); };
$('#helpBtn').onclick = () => puzzle.help();
$('#zoomIn').onclick = () => puzzle.zoomIn();
$('#zoomOut').onclick = () => puzzle.zoomOut();
$('#seeAll').onclick = () => puzzle.showAll();
$('#shareNow').onclick = () => game && shareDialog(game, false);
addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if(!$('#play').classList.contains('hidden')) puzzle.resize(); }, 150); });

// ---------------- finishing ----------------
async function finished(){
  const g = game; if(!g) return;
  const name = settings.get().name, isDaily = g.recipe.d === today();
  const st = isDaily ? streak.complete() : null;
  current.clear();
  album.add({ id: Date.now(), date: today(), title: g.title, recipe: g.recipe, seconds: g.seconds,
    thumb: await toBlob(g.img, .8, 480), full: await toBlob(g.img, .85, g.recipe.n > 100 ? 2600 : 1400), embed: g.embed || null });
  const mins = Math.max(1, Math.round(g.seconds/60));
  setTimeout(() => {
    dialog(
      h('h2', {}, name ? `Wonderful, ${name}!` : 'Wonderful!'),
      h('img', { class:'win-pic', src: thumbURL, alt: g.title }),
      h('p', { class:'big' }, `You finished all ${g.recipe.n} pieces in about ${mins} minute${mins===1?'':'s'}.`),
      st ? h('p', {}, st.count > 1 ? `🔥 That's ${st.count} days in a row!` : '🔥 Today’s puzzle is done. See you tomorrow for a new one!') : null,
      h('div', { class:'stack' },
        h('button', { class:'primary', onclick: () => shareDialog(g, true) }, '💌 Share with family'),
        h('button', { class:'secondary', onclick: () => { closeDialog(); show('home'); } }, '🧩 Another puzzle'),
        h('button', { class:'secondary', onclick: closeDialog }, '🖼️ Look at the picture')));
    chime(true);
  }, 650);
}

// ---------------- sharing ----------------
function shareDialog(g, done){
  const s = settings.get();
  let embed = g.recipe.src.t === 'img' ? (g.embed || photoForLink(g.img)) : null;
  if(g.recipe.src.t === 'img') g.embed = embed;
  if(g.recipe.src.t === 'img' && !embed){ dialog(h('h2', {}, 'Sorry'), h('p', {}, "That photo is too detailed to fit in a link. Try a painted picture or a different photo.")); return; }
  const nameIn = h('input', { type:'text', value: s.name, placeholder:'e.g. Grandma Jo', autocomplete:'name', maxLength: 40 });
  const noteIn = h('input', { type:'text', placeholder:'e.g. Thinking of you!', maxLength: 120 });
  const qrSlot = h('div'), sms = h('a', {}, '💬 Text message'), mail = h('a', {}, '✉️ Email');
  let link = '';
  const update = () => {
    const name = nameIn.value.trim(), note = noteIn.value.trim();
    const r = { src: g.recipe.src, n: g.recipe.n, k: g.recipe.k, ...(g.recipe.d ? { d: g.recipe.d } : {}), ...(name ? { f:name } : {}), ...(note ? { m:note } : {}) };
    link = makeLink(r, embed);
    const msg = `${name || 'Someone'} sent you a jigsaw puzzle${note ? ` — “${note}”` : ''}. Tap to play: ${link}`;
    sms.href = smsHref(msg); mail.href = mailHref(`${name || 'Someone'} sent you a jigsaw puzzle 🧩`, msg);
    const qr = qrCanvas(link, 360);
    qrSlot.replaceChildren(qr
      ? h('div', { class:'qrbox' }, qr, h('p', {}, h('b', {}, 'In the same room?'), ' They can point their phone camera at this square to open the puzzle.'))
      : h('p', { class:'muted' }, link.length > QR_MAX ? '📷 Your photo travels inside the link itself — nothing is uploaded anywhere. It’s too big for a scan code, so send it by message or email.' : ''));
  };
  nameIn.oninput = () => { settings.set({ name: nameIn.value.trim() }); update(); };
  noteIn.oninput = update; update();
  const text = () => `${nameIn.value.trim() || 'Someone'} sent you a jigsaw puzzle 🧩`;
  dialog(
    h('h2', {}, 'Send this puzzle to family'),
    h('p', { class:'muted' }, `They’ll get the very same puzzle: “${g.title}”, ${g.recipe.n} pieces.`),
    h('label', { class:'field' }, 'Your name', nameIn),
    h('label', { class:'field' }, 'A little note (optional)', noteIn),
    qrSlot,
    h('div', { class:'share-btns' },
      navigator.share ? h('button', { class:'primary', onclick: async () => { const r = await shareLink({ title:'Jigsaw puzzle', text: text(), url: link }); if(r==='copied') toast('Link copied — paste it into a message.'); } }, '📤 Send…') : null,
      sms, mail,
      h('button', { onclick: async () => toast(await copy(link) ? 'Link copied! Paste it into a message or email.' : 'Couldn’t copy — try Text message or Email.') }, '📋 Copy link'),
      done ? h('button', { onclick: async () => {
        const blob = await postcard({ image: g.img, name: nameIn.value.trim(), pieces: g.recipe.n, seconds: g.seconds, title: g.title, link: link.length <= QR_MAX ? link : null });
        const r = await shareImage(blob, 'finished-puzzle.jpg', text());
        if(r === 'saved') toast('Postcard saved to your downloads.'); } }, '🖼️ Postcard') : null));
}

// ---------------- receiving a shared puzzle ----------------
function checkIncoming(){
  const got = readLink(); if(!got) return;
  const { recipe, img } = got, from = recipe.f ? String(recipe.f).slice(0,40) : 'Someone';
  dialog(
    h('h2', {}, `💌 ${from} sent you a puzzle!`),
    recipe.m ? h('p', { class:'big' }, `“${String(recipe.m).slice(0,120)}”`) : null,
    h('p', {}, `${titleOf(recipe)} · ${recipe.n} pieces`),
    h('div', { class:'stack' },
      h('button', { class:'primary', onclick: () => { closeDialog(); startPuzzle(recipe, { embed: img }); } }, 'Start the puzzle'),
      h('button', { class:'secondary', onclick: () => { closeDialog(); history.replaceState(null, '', location.pathname + location.search); } }, 'Maybe later')));
}
addEventListener('hashchange', () => checkBackupLink() || checkIncoming());

// ---------------- choosing a puzzle ----------------
function chooseSize(then){
  const cur = settings.get().pieces;
  const pick = n => { settings.set({ pieces:n }); closeDialog(); then(n); };
  // granular 100–1000 for a real challenge, with big ± buttons because sliders are fiddly for shaky hands
  let big = cur >= 100 ? cur : 250;
  const num = h('div', { class:'count' }), mood = h('div', { class:'muted' });
  const range = h('input', { type:'range', min:100, max:1000, step:10, value:big, 'aria-label':'Number of pieces',
    oninput: e => { big = +e.target.value; paint(); } });
  const go = h('button', { class:'primary', style:'width:100%', onclick: () => pick(big) });
  const nudge = d => () => { big = Math.min(1000, Math.max(100, big + d)); range.value = big; paint(); };
  function paint(){
    num.textContent = `${big} pieces`;
    mood.textContent = big <= 200 ? 'A relaxing afternoon' : big <= 500 ? 'A cosy weekend project' : 'A real classic — take your time';
    go.textContent = `Start with ${big} pieces`;
  }
  paint();
  dialog(h('h2', {}, 'How many pieces?'),
    h('p', { class:'muted' }, innerWidth < 600 ? 'Fewer pieces means bigger pieces. On a phone, 6 or 12 is most comfortable.' : 'Fewer pieces means bigger pieces.'),
    h('div', { class:'sizes' }, SIZES.map(([n, label]) =>
      h('button', { class: n===cur ? 'on' : '', onclick: () => pick(n) }, String(n), h('small', {}, label)))),
    h('div', { class:'big-size' },
      h('h3', {}, 'A bigger challenge'),
      num, mood,
      h('div', { class:'row' }, h('button', { onclick: nudge(-50), 'aria-label':'50 fewer pieces' }, '−'), range, h('button', { onclick: nudge(50), 'aria-label':'50 more pieces' }, '+')),
      h('p', { class:'muted' }, 'Big puzzles use a larger table: pinch or use ➕ ➖ to zoom, and drag the empty table to look around. Best on a tablet or computer.'),
      go));
}
const today$ = () => { const seed = [...today()].reduce((a,c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 1;
  return { src:{ t:'scene', id: pickScene(seed), s: seed }, n: settings.get().pieces, k: seed ^ 0x2545F491, d: today() }; };

$('#todayBtn').onclick = () => startPuzzle(today$());
$('#photoBtn').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  let img; try{ img = await fromBlob(f); }catch(_){ toast("Sorry — that photo couldn't be opened."); return; }
  chooseSize(n => startPuzzle({ src:{ t:'img' }, n, k: randSeed() }, { source: img }));
};
$('#paintBtn').onclick = () => {
  const grid = h('div', { class:'pics' });
  for(const sc of SCENES){
    const seed = randSeed(), c = paintScene(sc.id, seed, 320, 240);
    grid.append(h('button', { onclick: () => chooseSize(n => startPuzzle({ src:{ t:'scene', id: sc.id, s: seed }, n, k: randSeed() })) },
      c, h('span', {}, `${sc.emoji} ${sc.name}`)));
  }
  dialog(h('h2', {}, 'Painted pictures'), h('p', { class:'muted' }, 'Each one is freshly painted — no two are ever the same.'), grid);
};
$('#surpriseBtn').onclick = async () => {
  toast('Finding a lovely photo…', 15000);
  let pick = null;
  try{
    const r = await fetch(`https://picsum.photos/v2/list?page=${1 + (Math.random()*10|0)}&limit=100`);
    const list = (await r.json()).filter(p => p.width >= p.height);
    pick = list[(Math.random()*list.length)|0];
  }catch(_){}
  $('#toast').classList.add('hidden');
  const src = pick ? { t:'pic', id: +pick.id, a: String(pick.author).slice(0,40) } : { t:'scene', id: pickScene(randSeed()), s: randSeed() };
  if(!pick) toast("No internet photo right now — here's a painted picture instead.", 5000);
  chooseSize(n => startPuzzle({ src, n, k: randSeed() }));
};
let family = [];
fetch('photos.json').then(r => r.ok ? r.json() : []).then(l => { family = (Array.isArray(l) ? l : []).map(x => typeof x === 'string' ? { src:x } : x).filter(x => safePath(x.src)); $('#familyBtn').classList.toggle('hidden', !family.length); }).catch(()=>{});
$('#familyBtn').onclick = () => dialog(h('h2', {}, 'Family album'), h('div', { class:'pics' }, family.map(p =>
  h('button', { onclick: () => chooseSize(n => startPuzzle({ src:{ t:'album', u: p.src, ...(p.title ? { c: String(p.title).slice(0,60) } : {}) }, n, k: randSeed() })) },
    h('img', { src: p.src, alt: p.title || '', loading:'lazy' }), p.title ? h('span', {}, p.title) : null))));

$('#albumBtn').onclick = async () => {
  const items = await album.all();
  if(!items.length){ dialog(h('h2', {}, 'My finished puzzles'), h('p', { class:'big' }, 'Puzzles you finish will be kept here, like a scrapbook.')); return; }
  const urls = [];
  onDlgClose = () => urls.forEach(u => URL.revokeObjectURL(u));
  dialog(h('h2', {}, 'My finished puzzles'), h('p', { class:'muted' }, `${items.length} finished so far. Tap one to play it again or share it.`),
    h('div', { class:'pics' }, items.map(it => { const u = URL.createObjectURL(it.thumb); urls.push(u);
      return h('button', { onclick: () => albumItem(it) }, h('img', { src:u, alt: it.title }),
        h('span', {}, it.title), h('span', { class:'meta' }, `${new Date(it.id).toLocaleDateString()} · ${it.recipe.n} pieces`)); })));
};
async function albumItem(it){
  const img = toCanvas(await fromBlob(it.full), picSize(it.recipe.n));
  const g = { recipe: it.recipe, img, title: it.title, seconds: it.seconds, embed: it.embed };
  dialog(h('h2', {}, it.title), h('img', { class:'win-pic', src: img.toDataURL('image/jpeg', .7), alt: it.title }),
    h('div', { class:'stack' },
      h('button', { class:'primary', onclick: () => { closeDialog(); startPuzzle({ ...it.recipe, k: randSeed(), d: undefined }, { source: img }); } }, '🧩 Play it again'),
      h('button', { class:'secondary', onclick: () => shareDialog(g, true) }, '💌 Share with family'),
      h('button', { class:'secondary', onclick: async () => { await album.remove(it.id); closeDialog(); toast('Removed from your scrapbook.'); } }, '🗑️ Remove')));
}

$('#continueBtn').onclick = async () => {
  const c = current.get(), blob = await current.image();
  if(!c || !blob){ current.clear(); refreshHome(); return; }
  startPuzzle(c.recipe, { source: await fromBlob(blob), resume: c });
};

// ---------------- music ----------------
let nowPlaying = null, musicState = 'paused', musicPanelOpen = false;
const music = createMusic({
  onTrack: t => { nowPlaying = t; if(musicPanelOpen) musicDialog(); else if(t && musicState === 'playing') toast(`🎵 ${t.title}${t.artist ? ' — ' + t.artist : ''}${t.year ? ` (${t.year})` : ''}`, 5000); },
  onState: s => { musicState = s; for(const b of [$('#homeMusic'), $('#playMusic')]) b.classList.toggle('on', s === 'playing' || s === 'loading');
    if(musicPanelOpen) musicDialog(); },
});
function musicDialog(){
  musicPanelOpen = true; onDlgClose = () => { musicPanelOpen = false; };
  const on = music.playing || musicState === 'loading';
  const vol = h('input', { type:'range', min:0, max:1, step:.05, value: music.volume, 'aria-label':'Volume', oninput: e => music.setVolume(+e.target.value) });
  dialog(h('h2', {}, '🎵 Music'),
    h('div', { class:'switch' }, h('span', {}, on ? 'Music is on' : 'Music is off'),
      h('button', { class: on ? 'on' : '', onclick: () => on ? music.stop() : music.play() }, on ? 'Turn off' : 'Turn on')),
    h('div', { class:'stations' }, STATIONS.map(st => h('button', { class: st.id === music.station ? 'on' : '', onclick: () => music.play(st.id) },
      h('b', {}, `${st.emoji} ${st.name}`), h('small', {}, st.blurb)))),
    musicState === 'offline' ? h('p', { class:'muted' }, '📻 The old records can’t be reached right now, so the music box is playing. It will try again soon.') : null,
    nowPlaying && on ? h('div', { class:'now record' },
      nowPlaying.image ? h('img', { src: nowPlaying.image, alt:'The original record label', loading:'lazy', onerror: e => e.target.remove() }) : null,
      h('div', {}, h('small', { class:'muted' }, musicState === 'loading' ? 'Finding a record…' : 'Now playing'),
        h('b', {}, nowPlaying.title), h('span', {}, [nowPlaying.artist, nowPlaying.year].filter(Boolean).join(' · ')),
        nowPlaying.url ? h('div', {}, h('a', { href: nowPlaying.url, target:'_blank', rel:'noopener' }, 'About this record')) : null)) : null,
    on ? h('button', { class:'secondary', style:'margin-top:10px;width:100%', onclick: () => music.next() }, '⏭️ Next song') : null,
    typeof music.setRestore === 'function' ? h('div', { class:'switch' },
      h('span', {}, 'Smooth out old-record crackle', h('small', { class:'muted', style:'display:block;font-weight:400' },
        music.cleanMode === 'plain' ? 'Not available for these records — playing them as they are.' : 'Softens pops, hiss and rumble from the 100-year-old records.')),
      h('button', { class: music.restore ? 'on' : '', onclick: () => { music.setRestore(!music.restore); musicDialog(); } }, music.restore ? 'On' : 'Off')) : null,
    h('label', { class:'field' }, 'Volume', vol),
    h('p', { class:'muted' }, 'Old records from 1900–1925 (public domain), streamed live from the Internet Archive’s Great 78 Project. With no internet, a gentle music box plays instead.'));
}
$('#homeMusic').onclick = musicDialog;
$('#playMusic').onclick = musicDialog;
// Browsers only allow sound after a tap: resume music on the first tap if it was on last time.
if(music.enabled) addEventListener('pointerdown', function once(){ removeEventListener('pointerdown', once, true); if(!music.playing) music.play(); }, true);

// ---------------- settings ----------------
$('#openSettings').onclick = () => {
  const s = settings.get();
  const nameIn = h('input', { type:'text', value: s.name, placeholder:'e.g. Grandma Jo', maxLength: 40, oninput: e => { settings.set({ name: e.target.value.trim() }); } });
  const snd = h('button', { class: s.sounds ? 'on' : '', onclick: () => { const v = !settings.get().sounds; settings.set({ sounds: v }); snd.className = v ? 'on' : ''; snd.textContent = v ? 'On' : 'Off'; } }, s.sounds ? 'On' : 'Off');
  onDlgClose = refreshHome;
  dialog(h('h2', {}, 'Settings'),
    h('label', { class:'field' }, 'Your name (shown on puzzles you send)', nameIn),
    h('div', { class:'switch' }, h('span', {}, 'Click sounds when a piece fits'), snd),
    h('div', { class:'switch' }, h('span', {}, 'Music'), h('button', { onclick: musicDialog }, 'Choose…')),
    h('div', { class:'switch' }, h('span', {}, 'Back up or move my puzzles'), h('button', { onclick: backupDialog }, 'Open…')),
    h('p', { class:'muted', style:'margin-top:18px' }, 'Your puzzles and photos stay on this device. Shared photos travel inside the link itself. Surprise photos come from Lorem Picsum (Unsplash photographers); music from the Internet Archive.'));
};

// ---------------- backup & restore ----------------
const kb = n => n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n/1024).toFixed(n<10240?1:0)} KB` : `${(n/1048576).toFixed(1)} MB`;
async function backupDialog(){
  const items = await album.all(), cur = current.get();
  const res = await exportBackup({ album: items, current: cur, currentImage: cur ? await current.image() : null,
    streak: LS.get('jig.streak', null), settings: settings.get() });
  const { finished, inProgress, photos, size } = res.summary;
  const what = [`${finished} finished puzzle${finished===1?'':'s'}`, inProgress ? '1 in progress' : null].filter(Boolean).join(' and ');
  const link = res.code ? location.href.split('#')[0] + '#b=' + res.code : null;
  const qr = link && qrCanvas(link, 360);
  const fileIn = h('input', { type:'file', accept:'.jigsaw,application/octet-stream', hidden:true, onchange: async e => {
    const f = e.target.files[0]; e.target.value = ''; if(f) restore(new Uint8Array(await f.arrayBuffer())); } });
  const codeIn = h('input', { type:'text', placeholder:'Paste a save code here', autocomplete:'off' });
  dialog(h('h2', {}, 'Back up & move puzzles'),
    h('p', {}, `Your backup holds ${what || 'your settings'}${photos ? `, including ${photos} photo${photos===1?'':'s'}` : ''} — just `, h('b', {}, kb(size)), '.'),
    qr ? h('div', { class:'qrbox' }, qr, h('p', {}, h('b', {}, 'Moving to a new tablet or phone?'), ' Point its camera at this square to copy everything over.')) : null,
    h('div', { class:'share-btns' },
      h('button', { class:'primary', onclick: async () => {
        const r = await shareImage(new Blob([res.bytes], { type:'application/octet-stream' }), `family-jigsaw-${today()}.jigsaw`, 'My jigsaw puzzles backup');
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
  catch(_){ dialog(h('h2', {}, 'Hmm'), h('p', { class:'big' }, 'That doesn’t look like a puzzle backup, or it got cut off. Please try again.')); return; }
  toast('Restoring your puzzles…', 20000);
  const have = new Set((await album.all()).map(a => a.id)); let added = 0;
  const imgOf = async (recipe, blob) => blob ? toCanvas(await fromBlob(blob), picSize(recipe.n)) : paintScene(recipe.src.id, recipe.src.s, picSize(recipe.n), Math.round(picSize(recipe.n)*.75));
  for(const it of data.album){
    if(have.has(it.id)) continue;
    try{ const img = await imgOf(it.recipe, it.image);
      await album.add({ id: it.id, date: it.date, title: it.title, recipe: it.recipe, seconds: it.seconds, thumb: await toBlob(img, .8, 480), full: await toBlob(img, .85, it.recipe.n > 100 ? 2600 : 1400), embed: null });
      added++; }catch(_){}
  }
  let curNote = '';
  if(data.current){
    if(current.get()) curNote = ' Your own puzzle in progress was kept.';
    else { try{ const img = await imgOf(data.current.recipe, data.current.image);
      await current.save({ recipe: data.current.recipe, state: data.current.state, seconds: data.current.seconds, image: await toBlob(img, .85) });
      curNote = ' Your puzzle in progress is ready to continue.'; }catch(_){} }
  }
  const mine = LS.get('jig.streak', null);
  if(data.streak && (!mine || (data.streak.total||0) > (mine.total||0))) LS.set('jig.streak', data.streak);
  if(data.settings && !settings.get().name && data.settings.name) settings.set({ name: data.settings.name });
  if(location.hash.startsWith('#b=')) history.replaceState(null, '', location.pathname + location.search);
  $('#toast').classList.add('hidden');
  dialog(h('h2', {}, 'All restored! 🎉'), h('p', { class:'big' }, `${added} finished puzzle${added===1?'':'s'} added to your scrapbook.${curNote}`),
    h('button', { class:'primary', style:'width:100%', onclick: () => { closeDialog(); show('home'); } }, 'Lovely'));
  refreshHome();
}
function checkBackupLink(){
  if(!location.hash.startsWith('#b=')) return false;
  dialog(h('h2', {}, 'Copy puzzles to this device?'), h('p', { class:'big' }, 'This will add the scrapbook and puzzle from your other device.'),
    h('div', { class:'stack' }, h('button', { class:'primary', onclick: () => restore(location.hash) }, 'Yes, copy them over'),
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
  const st = streak.get(), done = streak.doneToday();
  $('#streakText').textContent = done ? `✓ Done today${st.count > 1 ? ` — 🔥 ${st.count} days in a row` : ''}. A new one arrives tomorrow.`
    : st.count > 0 ? `🔥 ${st.count} day${st.count>1?'s':''} in a row — keep it going!` : 'A new painted picture every day.';
  $('#todayBtn').textContent = done ? 'Play it again' : 'Start today’s puzzle';
  const c = current.get();
  $('#continueCard').classList.toggle('hidden', !c);
  if(c){
    const placed = Object.values(c.state || {}).filter(v => v[2]).length;
    $('#continueText').textContent = `${titleOf(c.recipe)} — ${placed} of ${c.recipe.n === Object.keys(c.state||{}).length ? c.recipe.n : Object.keys(c.state||{}).length} pieces done`;
    const blob = await current.image();
    if(blob){ const u = URL.createObjectURL(blob); $('#continueThumb').onload = () => URL.revokeObjectURL(u); $('#continueThumb').src = u; }
  }
}

// ---------------- start-up ----------------
show('home');
if(!checkBackupLink()) checkIncoming();
if('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
window.__jig = { puzzle, get game(){ return game; }, makeLink, readLink };     // for automated tests
