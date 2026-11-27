// playlists.js — keep favourite songs and make playlists. Everything stays on this device
// (localStorage 'jig.playlists'), and travels with backups via exportPlaylists()/importPlaylists().
//
// A song is stored as a tiny reference, never as audio:
//   composed on the device: { k:'c', seed, mood, title }      (the same seed + mood always replays the same song)
//   an old record:          { k:'r', id, title, artist, year } (id = Internet Archive identifier)
import { MOODS, songTitle } from './compose.js';

const KEY = 'jig.playlists';
const FAV = 'fav', FAV_NAME = '♡ Kept songs';
const MAX_LISTS = 50, MAX_SONGS = 500;
const MOOD_IDS = new Set(MOODS.map(m => m.id));
const ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

const clean = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '';

/** Untrusted → clean song ref, or null. */
export function cleanRef(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.k === 'c') {
    const seed = Number(r.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF || !MOOD_IDS.has(r.mood)) return null;
    return { k: 'c', seed, mood: r.mood, title: clean(r.title, 80) || songTitle(seed, r.mood) };
  }
  if (r.k === 'r') {
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
    const year = Number(r.year);
    return { k: 'r', id: r.id, title: clean(r.title, 120) || 'An old record', artist: clean(r.artist, 80),
      year: Number.isInteger(year) && year >= 1880 && year <= 1930 ? year : null };
  }
  return null;
}
const refKey = r => r.k === 'c' ? `c:${r.seed}:${r.mood}` : `r:${r.id}`;
const moodName = id => (MOODS.find(m => m.id === id) || {}).name || 'Calm';
export const describeRef = r => r.k === 'c' ? `Composed · ${moodName(r.mood)}` : [r.artist, r.year].filter(Boolean).join(' · ') || 'Old record';

// ---------- storage ----------
function load() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
  const lists = Array.isArray(d && d.lists) ? d.lists : [];
  const out = [], seen = new Set();
  for (const l of lists.slice(0, MAX_LISTS + 1)) {
    if (!l || typeof l.id !== 'string' || !/^[a-z0-9]{1,16}$/.test(l.id) || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ id: l.id, name: l.id === FAV ? FAV_NAME : (clean(l.name, 40) || 'My playlist'),
      songs: (Array.isArray(l.songs) ? l.songs : []).slice(0, MAX_SONGS).map(cleanRef).filter(Boolean) });
  }
  if (!out.some(l => l.id === FAV)) out.unshift({ id: FAV, name: FAV_NAME, songs: [] });
  else out.sort((a, b) => (b.id === FAV) - (a.id === FAV));
  return out;
}
function save(lists) { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, lists })); return true; } catch (_) { return false; } }
const newId = () => (Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)).slice(-12);

// ---------- API ----------
export const playlists = {
  all: () => load(),
  get: id => load().find(l => l.id === id) || null,
  favourites: () => load().find(l => l.id === FAV),
  create(name) {
    const lists = load(); if (lists.length > MAX_LISTS) return null;
    const l = { id: newId(), name: clean(name, 40) || 'My playlist', songs: [] };
    lists.push(l); save(lists); return l;
  },
  rename(id, name) {
    if (id === FAV) return false; const lists = load(), l = lists.find(x => x.id === id);
    if (!l || !clean(name, 40)) return false; l.name = clean(name, 40); return save(lists);
  },
  remove(id) {
    if (id === FAV) return false; const lists = load(), i = lists.findIndex(x => x.id === id);
    if (i < 0) return false; lists.splice(i, 1); return save(lists);
  },
  /** Adds a song (no duplicates within a list). Returns true if added. */
  add(id, ref) {
    const r = cleanRef(ref); if (!r) return false;
    const lists = load(), l = lists.find(x => x.id === id); if (!l || l.songs.length >= MAX_SONGS) return false;
    if (l.songs.some(s => refKey(s) === refKey(r))) return false;
    l.songs.push(r); return save(lists);
  },
  removeSong(id, index) {
    const lists = load(), l = lists.find(x => x.id === id);
    if (!l || !(index >= 0 && index < l.songs.length)) return false; l.songs.splice(index, 1); return save(lists);
  },
  move(id, from, to) {
    const lists = load(), l = lists.find(x => x.id === id);
    if (!l || !(from >= 0 && from < l.songs.length) || !(to >= 0 && to < l.songs.length)) return false;
    const [s] = l.songs.splice(from, 1); l.songs.splice(to, 0, s); return save(lists);
  },
  keep: ref => playlists.add(FAV, ref),
  isKept(ref) { const r = cleanRef(ref); return !!r && playlists.favourites().songs.some(s => refKey(s) === refKey(r)); },
  unkeep(ref) {
    const r = cleanRef(ref); if (!r) return false; const lists = load(), f = lists.find(x => x.id === FAV);
    const i = f.songs.findIndex(s => refKey(s) === refKey(r)); if (i < 0) return false; f.songs.splice(i, 1); return save(lists);
  },
};

/** For backups: a small JSON-safe object. */
export function exportPlaylists() { return { v: 1, lists: load() }; }

/** Merge playlists from a backup (UNTRUSTED). Lists match by name (♡ Kept songs always merges). Returns songs added. */
export function importPlaylists(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.lists)) return 0;
  const lists = load(); let added = 0;
  for (const inc of obj.lists.slice(0, MAX_LISTS)) {
    if (!inc || typeof inc !== 'object') continue;
    const songs = (Array.isArray(inc.songs) ? inc.songs : []).slice(0, MAX_SONGS).map(cleanRef).filter(Boolean);
    const isFav = inc.id === FAV, name = clean(inc.name, 40) || 'My playlist';
    let l = isFav ? lists.find(x => x.id === FAV) : lists.find(x => x.id !== FAV && x.name === name);
    if (!l) { if (lists.length > MAX_LISTS) continue; l = { id: newId() + lists.length.toString(36), name, songs: [] }; lists.push(l); }
    const have = new Set(l.songs.map(refKey));
    for (const s of songs) { if (l.songs.length >= MAX_SONGS) break; if (!have.has(refKey(s))) { l.songs.push(s); have.add(refKey(s)); added++; } }
  }
  save(lists); return added;
}

// ---------- the management dialog (built with the shell's safe h() helper; no innerHTML) ----------
/**
 * openPlaylistsDialog({ dialog, closeDialog, h, toast, announce, music })
 * Shows the playlists screen in the shell's dialog sheet.
 */
export function openPlaylistsDialog(ui) {
  const { dialog, h, toast = () => {}, announce = () => {}, music } = ui;
  const row = (...kids) => h('div', { class: 'switch', style: 'flex-wrap:wrap;gap:8px' }, ...kids);
  const btns = (...kids) => h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, ...kids);
  const small = (label, aria, onclick, extra = {}) => h('button', { 'aria-label': aria, onclick, style: 'min-width:52px', ...extra }, label);
  const now = () => music && music.nowPlayingRef;

  function home() {
    const lists = playlists.all(), cur = now();
    const nameIn = h('input', { type: 'text', placeholder: 'e.g. Sunday favourites', maxLength: 40, 'aria-label': 'Name for the new playlist' });
    dialog(
      h('h2', {}, '🎶 My playlists'),
      cur ? keepRow(cur, home) : h('p', { class: 'muted' }, 'Tip: while music is playing, tap ♡ to keep the song you like.'),
      h('div', { class: 'stack', role: 'list', 'aria-label': 'Playlists' }, lists.map(l => h('div', { role: 'listitem' }, row(
        h('button', { class: 'secondary', style: 'flex:1;text-align:left', 'aria-label': `Open ${l.name}, ${l.songs.length} songs`, onclick: () => open(l.id) },
          h('b', {}, l.name), h('small', { class: 'muted', style: 'display:block;font-weight:400' }, `${l.songs.length} song${l.songs.length === 1 ? '' : 's'}`)),
        l.songs.length ? small('▶', `Play ${l.name}`, () => play(l, 0), { class: 'primary' }) : null)))),
      h('h3', { style: 'margin:18px 0 6px;font:600 20px var(--title)' }, 'Make a new playlist'),
      h('label', { class: 'field' }, 'Name', nameIn),
      h('button', { class: 'primary', style: 'width:100%', onclick: () => {
        const l = playlists.create(nameIn.value);
        if (!l) { toast('You have the most playlists allowed — delete one first.'); return; }
        announce(`Playlist ${l.name} made.`); open(l.id);
      } }, '＋ Make playlist'));
  }

  function keepRow(cur, back) {
    const kept = playlists.isKept(cur);
    return row(h('span', {}, h('small', { class: 'muted', style: 'display:block' }, 'Playing now'), h('b', {}, cur.title)),
      h('button', { class: kept ? 'on' : 'primary', 'aria-pressed': String(kept), onclick: () => {
        if (kept) { playlists.unkeep(cur); announce('Removed from kept songs.'); } else { playlists.keep(cur); announce('Kept! It is in ♡ Kept songs.'); }
        back();
      } }, kept ? '♥ Kept' : '♡ Keep this song'));
  }

  function play(l, i, shuffled = false) {
    if (!music || !music.playPlaylist) return;
    let songs = l.songs;
    if (shuffled) { songs = songs.slice(); for (let k = songs.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [songs[k], songs[j]] = [songs[j], songs[k]]; } }
    if (music.playPlaylist(songs, shuffled ? 0 : i)) { const how = shuffled ? `${l.name}, shuffled` : l.name; toast(`🎶 Playing ${how}`); announce(`Playing ${how}.`); }
  }

  function open(id, focusIndex) {
    const l = playlists.get(id); if (!l) { home(); return; }
    const cur = now(), inList = cur && l.songs.some(s => refKey(s) === refKey(cleanRef(cur) || {}));
    const isFav = id === FAV;
    dialog(
      h('h2', {}, l.name),
      btns(h('button', { class: 'secondary', onclick: home }, '← All playlists'),
        l.songs.length ? h('button', { class: 'primary', onclick: () => play(l, 0) }, '▶ Play all') : null,
        l.songs.length > 1 ? h('button', { class: 'secondary', 'aria-label': `Shuffle ${l.name}`, onclick: () => play(l, 0, true) }, '🔀 Shuffle') : null),
      cur && !inList && !isFav ? h('button', { class: 'secondary', style: 'width:100%;margin-top:10px', onclick: () => {
        if (playlists.add(id, cur)) announce(`Added ${cur.title}.`); open(id);
      } }, `＋ Add “${cur.title}”`) : null,
      l.songs.length ? h('ol', { style: 'list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px', 'aria-label': `Songs in ${l.name}` },
        l.songs.map((s, i) => h('li', {}, row(
          h('span', { style: 'flex:1 1 12em;min-width:0' }, h('b', {}, s.title), h('small', { class: 'muted', style: 'display:block;font-weight:400' }, describeRef(s))),
          btns(
            small('▶', `Play from ${s.title}`, () => play(l, i)),
            small('↑', `Move ${s.title} up`, () => { if (playlists.move(id, i, i - 1)) { announce('Moved up.'); open(id, i - 1); } }, { disabled: i === 0 }),
            small('↓', `Move ${s.title} down`, () => { if (playlists.move(id, i, i + 1)) { announce('Moved down.'); open(id, i + 1); } }, { disabled: i === l.songs.length - 1 }),
            small('✕', `Remove ${s.title}`, () => { playlists.removeSong(id, i); announce(`Removed ${s.title}.`); open(id); }))))))
        : h('p', { class: 'big' }, isFav ? 'Songs you keep with ♡ will appear here.' : 'This playlist is empty. Play some music and add songs you like.'),
      isFav ? null : h('div', { class: 'stack', style: 'margin-top:16px' },
        h('button', { class: 'secondary', onclick: () => rename(id) }, '✏️ Rename playlist'),
        h('button', { class: 'secondary', onclick: () => confirmDelete(id) }, '🗑️ Delete playlist')));
    if (focusIndex != null) { const b = document.querySelectorAll('#dlgBody ol li')[focusIndex]?.querySelector('button'); b && b.focus(); }
  }

  function rename(id) {
    const l = playlists.get(id); if (!l) return home();
    const inp = h('input', { type: 'text', value: l.name, maxLength: 40, 'aria-label': 'New name', autofocus: true });
    dialog(h('h2', {}, 'Rename playlist'), h('label', { class: 'field' }, 'Name', inp),
      h('div', { class: 'stack' },
        h('button', { class: 'primary', onclick: () => { if (playlists.rename(id, inp.value)) announce('Renamed.'); open(id); } }, 'Save'),
        h('button', { class: 'secondary', onclick: () => open(id) }, 'Cancel')));
  }

  function confirmDelete(id) {
    const l = playlists.get(id); if (!l) return home();
    dialog(h('h2', {}, 'Delete this playlist?'), h('p', { class: 'big' }, `“${l.name}” and its ${l.songs.length} song${l.songs.length === 1 ? '' : 's'} will be removed. The music itself isn’t affected.`),
      h('div', { class: 'stack' },
        h('button', { class: 'secondary', autofocus: true, onclick: () => open(id) }, 'No, keep it'),
        h('button', { class: 'primary', onclick: () => { playlists.remove(id); toast('Playlist deleted.'); announce('Playlist deleted.'); home(); } }, 'Yes, delete it')));
  }

  home();
}
