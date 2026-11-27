// music.js — gentle background music for the jigsaw.
//  • Live stations: public-domain 78 rpm records (1900–1925) from the Internet Archive's
//    Great 78 Project. No API key or account: the search and metadata APIs send
//    "Access-Control-Allow-Origin: *", and <audio> can stream from archive.org/download without CORS.
//    US rule used: sound recordings published before 1926 are public domain (as of 2026),
//    and so are the songs themselves (published 1930 or earlier). Other countries may differ.
//  • "Music Box": original tunes made up on the spot with WebAudio — works offline and is the
//    automatic fallback whenever the internet or archive.org is unavailable.

const KEY = 'jig.music';
const BASE = 'collection:georgeblood AND mediatype:audio AND year:[1900 TO 1925]';
const SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
const MIN_SEC = 60, MAX_SEC = 480, FADE_MS = 1500, FETCH_MS = 12000;

import { MOODS, createSongPlayer } from './compose.js';
import { playlists } from './playlists.js';

// Made-up music first (calm, clean, works offline); the real 1900–1925 records are the 'Nostalgia' group.
export const STATIONS = [
  ...MOODS.map(m => ({ id: 'mood-' + m.id, name: m.name, emoji: m.emoji, blurb: m.blurb + ' — made up on this device' })),
  { group: 'nostalgia', id: 'parlor',   name: 'Parlor Songs',    emoji: '🎙️', blurb: 'Sing-along songs of 1900–1925',
    q: '(subject:"Popular Music" OR subject:Vocal OR subject:Ballad OR subject:Song)' },
  { group: 'nostalgia', id: 'dance',    name: 'Ballroom',        emoji: '💃', blurb: 'Waltzes, fox trots and tangos',
    q: '(subject:Waltz OR subject:"Fox Trot" OR subject:"Fox-Trot" OR subject:Tango OR subject:Polka)' },
  { group: 'nostalgia', id: 'concert',  name: 'Concert Hall',    emoji: '🎻', blurb: 'Violins, orchestras and instrumentals',
    q: '(subject:Classical OR subject:Orchestral OR subject:Instrumental)' },
  { group: 'nostalgia', id: 'hawaiian', name: 'Hawaiian Breeze', emoji: '🌺', blurb: 'Steel guitars and island songs',
    q: 'subject:Hawaiian' },
  { id: 'musicbox', name: 'Music Box',       emoji: '🎶', blurb: 'Gentle made-up tunes — works without internet' },
];

function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (_) {}
  return { on: false, station: 'mood-calm', volume: 0.5, restore: true };
}
function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }

async function getJSON(url) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(timer); }
}
function seconds(len) {                    // archive.org gives "02:32" or "151.62"
  if (len == null) return null;
  const s = String(len);
  if (s.includes(':')) return s.split(':').reduce((a, p) => a * 60 + Number(p), 0);
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
const first = v => Array.isArray(v) ? v[0] : v;
const tidy = s => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = s => s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(\-"'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ------------------------------------------------------------------ live archive.org station
class Archive {
  constructor() { this.counts = {}; this.queue = {}; this.seen = new Set(); }
  async candidates(st) {
    const q = encodeURIComponent(`${BASE} AND ${st.q}`);
    if (this.counts[st.id] == null) {
      const d = await getJSON(`https://archive.org/advancedsearch.php?q=${q}&rows=0&output=json`);
      this.counts[st.id] = d.response.numFound;
    }
    const rows = 50, pages = Math.max(1, Math.min(Math.floor(this.counts[st.id] / rows), 180));
    const page = 1 + Math.floor(Math.random() * pages);
    const d = await getJSON(`https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=${rows}&page=${page}&output=json`);
    return shuffle(d.response.docs || []);
  }
  async nextTrack(st) {
    for (let tries = 0; tries < 12; tries++) {
      const q = this.queue[st.id] = (this.queue[st.id] && this.queue[st.id].length) ? this.queue[st.id] : await this.candidates(st);
      const doc = q.shift(); if (!doc) continue;
      const key = tidy(first(doc.title)).toLowerCase();
      if (this.seen.has(doc.identifier) || this.seen.has(key)) continue;
      const t = await this.resolve(doc, st).catch(() => null);
      if (!t) continue;
      this.seen.add(doc.identifier); this.seen.add(key);
      return t;
    }
    throw new Error('no playable tracks');
  }
  async resolve(doc, st) {
    const m = await getJSON(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
    const mp3s = (m.files || []).filter(f => /\.mp3$/i.test(f.name) && !/_78_|_sample/i.test(f.name));
    if (!mp3s.length) return null;
    const f = mp3s.find(f => /vbr/i.test(f.format || '')) || mp3s[0];
    const len = seconds(f.length);
    if (len != null && (len < MIN_SEC || len > MAX_SEC)) return null;
    const md = m.metadata || {};
    return {
      src: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      info: {
        title: titleCase(tidy(first(md.title) || first(doc.title))),
        artist: titleCase(tidy(first(md.creator) || first(doc.creator) || 'Unknown performer')),
        year: Number(first(md.year) || doc.year || String(first(md.date) || '').slice(0, 4)) || null,
        id: doc.identifier,
        url: `https://archive.org/details/${doc.identifier}`,
        image: `https://archive.org/services/img/${doc.identifier}`,
        station: st.id,
      },
    };
  }
}

// ------------------------------------------------------------------ offline music box
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 4, 0], [0, 5, 1, 4], [0, 4, 5, 3], [0, 3, 0, 4]];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const TUNE_NAMES = ['Sunday Afternoon', 'Garden Gate', 'Lavender Lane', 'Porch Swing', 'Teacup Waltz',
  'Meadow Lark', 'Rocking Chair', 'Apple Blossom', 'Lantern Light', 'Harbour Breeze', 'Old Oak Tree', 'Front Parlour'];

class MusicBox {
  constructor(ctxGetter) { this.getCtx = ctxGetter; this.count = 0; this.timer = null; this.bus = null; }
  start(out, onTune) {
    const ctx = this.getCtx();
    this.stop();
    const bus = this.bus = ctx.createGain(); bus.gain.value = 1;
    // a little room: feedback delay through a low-pass filter
    const dry = ctx.createGain(), wet = ctx.createGain(), dl = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    dry.gain.value = 0.8; wet.gain.value = 0.25; dl.delayTime.value = 0.27; fb.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 2500;
    bus.connect(dry).connect(out); bus.connect(dl); dl.connect(lp).connect(fb).connect(dl); lp.connect(wet).connect(out);
    const play = () => {
      if (this.bus !== bus) return;
      const dur = this.tune(ctx, bus, ctx.currentTime + 0.15);
      this.count++;
      onTune({ title: `${TUNE_NAMES[(this.count - 1) % TUNE_NAMES.length]} (music box)`, artist: 'Made up on this device', year: null, url: null, image: null, station: 'musicbox' });
      this.timer = setTimeout(play, (dur + 2.2) * 1000);
    };
    play();
  }
  stop() { clearTimeout(this.timer); if (this.bus) { try { this.bus.disconnect(); } catch (_) {} } this.bus = null; }
  note(ctx, out, midi, t, len, vol) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    for (const [mult, g] of [[1, 1], [2, 0.28], [3.01, 0.08]]) {   // music-box tine: fundamental + soft partials
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mult;
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(vol * g, t + 0.008);
      a.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, len * 2.2) / mult);
      o.connect(a).connect(out); o.start(t); o.stop(t + 2.5);
    }
  }
  tune(ctx, out, t0) {          // a 16-bar music-box waltz in AABA form; returns its length in seconds
    const root = 60 + [0, 2, 5, 7, -3][Math.floor(Math.random() * 5)];
    const beat = 60 / (84 + Math.random() * 20);
    const deg = d => root + MAJOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    const rhythms = [[1, 1, 1], [2, 1], [1, 0.5, 0.5, 1], [1, 2], [0.5, 0.5, 1, 1]];
    const phrase = (endOnRoot) => {             // 4 bars of melody, as [degree, beats]
      const out = []; let d = 7 + [0, 2, 4][Math.floor(Math.random() * 3)];
      for (let bar = 0; bar < 4; bar++) {
        const chord = prog[bar], r = bar === 3 ? [2, 1] : rhythms[Math.floor(Math.random() * rhythms.length)];
        r.forEach((b, i) => {
          if (i === 0) { const tones = [chord, chord + 2, chord + 4].map(x => x + 7); d = tones.reduce((a, c) => Math.abs(c - d) < Math.abs(a - d) ? c : a); }
          else d += [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
          d = Math.max(5, Math.min(14, d));
          out.push([bar === 3 && i === 0 && endOnRoot ? 7 : d, b]);
        });
      }
      return out;
    };
    const A = phrase(false), A2 = A.slice(0, -2).concat(phrase(true).slice(-2)), B = phrase(false);
    const form = [A, A2, B, A2];
    let t = t0;
    form.forEach(ph => {
      let bt = 0;
      for (const [d, b] of ph) { this.note(ctx, out, deg(d), t + bt * beat, b * beat, 0.16); bt += b; }
      for (let bar = 0; bar < 4; bar++) {        // oom-pah-pah accompaniment
        const c = prog[bar], s = t + bar * 3 * beat;
        this.note(ctx, out, deg(c) - 12, s, beat, 0.12);
        this.note(ctx, out, deg(c + 2), s + beat, beat, 0.05); this.note(ctx, out, deg(c + 4), s + beat, beat, 0.05);
        this.note(ctx, out, deg(c + 2), s + 2 * beat, beat, 0.05); this.note(ctx, out, deg(c + 4), s + 2 * beat, beat, 0.05);
      }
      t += 12 * beat;
    });
    this.note(ctx, out, deg(0) - 12, t, 3 * beat, 0.12); this.note(ctx, out, deg(7), t, 3 * beat, 0.14);
    return t - t0 + 3 * beat;
  }
}

// ------------------------------------------------------------------ ahead-of-time cleaned-audio cache
// Only records the person cares about (kept songs / any playlist) are cached: random station plays
// almost never repeat. Stored as mono Int16 at 22.05 kHz (~8 MB per 3 minutes), least-recently-played
// eviction under a total cap, and a pipeline version in every key so a better pipeline replaces old copies.
export const AOT_VERSION = 'aot-1';
const CACHE_SR = 22050;
export function createAudioCache({ name = 'family-audio', version = AOT_VERSION, cap = 150e6,
  estimate = () => (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null)) } = {}) {
  let dbp = null;
  const req = r => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  const done = t => new Promise((ok, fail) => { t.oncomplete = () => ok(); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error || new Error('aborted')); });
  const key = id => `${id}@${version}`;
  function open() {
    dbp ||= new Promise((ok, fail) => {
      if (typeof indexedDB === 'undefined') { fail(new Error('no IndexedDB')); return; }
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('clean')) d.createObjectStore('clean'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); r.onblocked = () => fail(new Error('blocked'));
    }).then(async d => {                                   // drop copies made by an older pipeline
      try { const all = await req(d.transaction('meta').objectStore('meta').getAll());
        const stale = all.filter(m => m.v !== version);
        if (stale.length) { const t = d.transaction(['meta', 'clean'], 'readwrite'); for (const m of stale) { t.objectStore('meta').delete(m.key); t.objectStore('clean').delete(m.key); } await done(t); } } catch (_) {}
      return d;
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  async function metas() { const d = await open(); return (await req(d.transaction('meta').objectStore('meta').getAll())).filter(m => m.v === version); }
  return {
    /** → { pcm: Int16Array, sr } or null. Never throws. */
    async get(id) {
      try {
        const d = await open(), k = key(id), m = await req(d.transaction('meta').objectStore('meta').get(k)); if (!m || m.v !== version) return null;
        const buf = await req(d.transaction('clean').objectStore('clean').get(k)); if (!(buf instanceof ArrayBuffer)) return null;
        const t = d.transaction('meta', 'readwrite'); t.objectStore('meta').put({ ...m, lastPlayed: Date.now() }); done(t).catch(() => {});
        return { pcm: new Int16Array(buf), sr: m.sr };
      } catch (_) { return null; }
    },
    async has(id) { try { const d = await open(); return !!(await req(d.transaction('meta').objectStore('meta').get(key(id)))); } catch (_) { return false; } },
    /** Store a cleaned song. Returns true if saved. Skips quietly when storage is tight or anything fails. */
    async put(id, pcm, sr) {
      try {
        const bytes = pcm.byteLength;
        if (bytes > cap) return false;
        const est = await estimate().catch(() => null);
        if (est && est.quota && est.quota - (est.usage || 0) < bytes + 50e6) return false;     // keep room for everything else
        const d = await open(), list = (await metas()).sort((a, b) => a.lastPlayed - b.lastPlayed);
        let total = list.reduce((a, m) => a + (m.key === key(id) ? 0 : m.bytes), 0);
        const t = d.transaction(['meta', 'clean'], 'readwrite'), M = t.objectStore('meta'), C = t.objectStore('clean');
        for (const m of list) { if (total + bytes <= cap) break; if (m.key === key(id)) continue; M.delete(m.key); C.delete(m.key); total -= m.bytes; }   // least recently played first
        const now = Date.now();
        C.put(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + bytes), key(id));
        M.put({ key: key(id), id, v: version, sr, length: pcm.length, bytes, savedAt: now, lastPlayed: now });
        await done(t); return true;
      } catch (_) { return false; }
    },
    async info() { try { const l = await metas(); return { songs: l.length, bytes: l.reduce((a, m) => a + m.bytes, 0) }; } catch (_) { return { songs: 0, bytes: 0 }; } },
    async clear() { try { const d = await open(), t = d.transaction(['meta', 'clean'], 'readwrite'); t.objectStore('meta').clear(); t.objectStore('clean').clear(); await done(t); return true; } catch (_) { return false; } },
  };
}
const isListed = id => { try { return playlists.all().some(l => (l.songs || []).some(s => s.k === 'r' && s.id === id)); } catch (_) { return false; } };
const weakDevice = () => (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
/** 16-bit mono WAV (cheap for the browser to decode) as a blob: URL for the <audio> elements. */
function wavURL(samples, sr) {
  const n = samples.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), i16 = samples instanceof Int16Array;
  const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
  if (i16) new Int16Array(b, 44).set(samples);
  else { const out = new Int16Array(b, 44); for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); out[i] = x < 0 ? x * 32768 : x * 32767; } }
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// ------------------------------------------------------------------ 78 rpm restoration chain
// input (stereo) → mono sum → rumble high-pass ×2 → [worklet: de-click + dynamic hiss filter]
//   → warmth shelf → presence lift → 8 kHz roll-off → gentle compressor → make-up → wet ┐
// input ─────────────────────────────────────────────────────────────────────── dry ┴→ output
export function createRestoreChain(ctx, { workletUrl = new URL('./restore-worklet.js', import.meta.url), enabled = true, stages = {} } = {}) {
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const bq = (type, f, Q, dB) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (Q != null) b.Q.value = Q; if (dB != null) b.gain.value = dB; return b; };
  const input = gain(1), output = gain(1), wet = gain(enabled ? 1 : 0), dry = gain(enabled ? 0 : 1);
  const mono = gain(1); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers'; // (L+R)/2
  const hp1 = bq('highpass', 70, 0.7071), hp2 = bq('highpass', 70, 0.7071);
  const slotIn = gain(1), slotOut = gain(1);
  const shelf = bq('lowshelf', 200, null, 2), presence = bq('peaking', 2500, 0.9, 1.5);
  const lp = bq('lowpass', 6000, 0.7071);                 // 6 kHz until the worklet (with its own DNR) is running
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 2.5; comp.knee.value = 15; comp.attack.value = 0.01; comp.release.value = 0.3;
  const makeup = gain(1.35);
  input.connect(mono).connect(hp1).connect(hp2).connect(slotIn).connect(slotOut);
  slotOut.connect(shelf).connect(presence).connect(lp).connect(comp).connect(makeup).connect(wet).connect(output);
  input.connect(dry).connect(output);
  let node = null;
  const ready = (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined')
    ? ctx.audioWorklet.addModule(workletUrl).then(() => {
        node = new AudioWorkletNode(ctx, 'restore-78', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: stages });
        slotIn.disconnect(slotOut); slotIn.connect(node).connect(slotOut);
        lp.frequency.value = 8000;                         // dynamic filter handles hiss; keep only a gentle top roll-off
        return node;
      }).catch(() => null)
    : Promise.resolve(null);
  function setEnabled(on, secs = 0.3) {
    const n = ctx.currentTime;
    for (const [g, v] of [[wet, on ? 1 : 0], [dry, on ? 0 : 1]]) {
      g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n);
      if (secs > 0) g.gain.linearRampToValueAtTime(v, n + secs); else g.gain.setValueAtTime(v, n);
    }
  }
  return { input, output, ready, setEnabled, get worklet() { return node; } };
}

async function probeCors(url) {        // can WebAudio read this file? (headers only; the body is never downloaded)
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
  try { const r = await fetch(url, { mode: 'cors', cache: 'no-store', signal: ac.signal }); ac.abort(); return r.ok || r.status === 206; }
  catch (_) { return false; }
  finally { clearTimeout(timer); }
}

// ------------------------------------------------------------------ public player
export function createMusic({ onTrack = () => {}, onState = () => {} } = {}) {
  const settings = loadSettings();
  if (!STATIONS.some(s => s.id === settings.station)) settings.station = 'mood-calm';
  let songs = null, songCtx = { seed: (Math.random() * 2 ** 31) >>> 0 };
  let pl = null, nowRef = null;                       // pl: playlist being played { refs, i, fails }; nowRef: what's playing
  let volume = Math.min(1, Math.max(0, Number(settings.volume ?? 0.5)));
  let playing = false, state = 'paused', fallback = false, failures = 0, gen = 0, retryAfter = 0;
  let ctx = null, boxGain = null;
  if (settings.restore === undefined) settings.restore = true;
  let mode = null, modeP = null, chain = null;   // mode: 'clean' (WebAudio restoration) | 'plain' (as-is)
  const archive = new Archive();
  const box = new MusicBox(() => ensureCtx());
  let cur = null, nxt = null;        // tracks: { el, src, info, prefetch, out }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC(); boxGain = ctx.createGain(); boxGain.gain.value = 0; boxGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const setState = s => { if (s !== state) { state = s; onState(s); } };
  const station = () => STATIONS.find(s => s.id === settings.station) || STATIONS[0];

  function setLevel(el, v) {
    if (el._gain) { const g = el._gain.gain, n = ctx.currentTime; g.cancelScheduledValues(n); g.setValueAtTime(v, n); }
    else { try { el.volume = v; } catch (_) {} }
  }
  function stopFade(el) { clearInterval(el._fade); clearTimeout(el._fadeT); }
  function fade(audio, to, ms, then) {
    stopFade(audio);
    if (audio._gain) {                 // clean mode: sample-accurate ramps (and they work on iOS)
      const g = audio._gain.gain, n = ctx.currentTime;
      g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(to, n + ms / 1000);
      if (then) audio._fadeT = setTimeout(then, ms + 30);
      return;
    }
    const from = audio.volume, t0 = performance.now();
    audio._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      try { audio.volume = from + (to - from) * k; } catch (_) {}
      if (k >= 1) { clearInterval(audio._fade); then && then(); }
    }, 50);
  }
  function boxFade(to, ms) {
    if (!ctx) return; const g = boxGain.gain, n = ctx.currentTime;
    g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(to, n + ms / 1000);
  }
  // Two persistent <audio> elements (A/B for crossfades), created once and unlocked inside a user tap.
  // iOS/iPadOS Safari only lets an element play() after it has been started during a gesture, so we
  // never create new elements later: every track (and every preload) just swaps the src of one of these.
  const els = [];
  function ensureEls() {
    if (els.length) return;
    for (let i = 0; i < 2; i++) { const el = new Audio(); el.preload = 'auto'; el._owner = null; els.push(el); }
  }
  function unlock() {                  // call synchronously inside a tap, before any await
    ensureEls();
    for (const el of els) {
      if (el._owner && !el.paused) continue;          // leave a playing track alone
      if (el._owner) continue;                        // holding a preloaded track: already unlocked earlier
      el._unlocking = true; el.muted = false; el.src = SILENT;
      const p = el.play(); if (p && p.then) p.then(() => { if (el._unlocking) el.pause(); }, () => {});
    }
  }
  const idleEl = () => els.find(e => !cur || e !== cur.el) || els[0];
  function load(el, t) {               // put a track on an element, taking it over completely
    el._unlocking = false; stopFade(el); el.pause();
    if (mode === 'clean') el.crossOrigin = 'anonymous'; else el.removeAttribute('crossorigin');   // before src
    el._owner = t; setLevel(el, 0); el.src = t.src; el.load();
  }
  function killAudio(t) {              // stop a track but keep the element for re-use
    if (!t || t.el._owner !== t) return;
    stopFade(t.el); t.el.pause(); t.el.removeAttribute('src'); t.el.load(); t.el._owner = null;
    if (t.blob) { URL.revokeObjectURL(t.blob); t.blob = null; }
  }

  async function decideMode(url) {      // once per session; elements can only be wired to WebAudio once
    const ok = !!ctx && await probeCors(url);
    if (!ok) { mode = 'plain'; return; }
    try {
      chain = createRestoreChain(ctx, { enabled: settings.restore !== false });
      chain.output.connect(ctx.destination);
      for (const el of els) {
        el.crossOrigin = 'anonymous';
        const src = ctx.createMediaElementSource(el), g = ctx.createGain();
        g.gain.value = 0; src.connect(g).connect(chain.input); el._gain = g;
      }
      try { el0Volume(); } catch (_) {}
      mode = 'clean';
    } catch (_) { mode = 'plain'; for (const el of els) el._gain = null; }
  }
  function el0Volume() { for (const el of els) el.volume = 1; }   // the GainNode does volume from now on
  // An element playing a pre-cleaned copy bypasses the live chain (never clean twice).
  function route(el, pre) {
    if (!el._gain || !chain) return; const want = pre ? 'direct' : 'chain'; if (el._routed === want) return;
    try { el._gain.disconnect(); } catch (_) {} el._gain.connect(pre ? ctx.destination : chain.input); el._routed = want;
  }

  // ---- ahead-of-time restoration (Web Worker) + cache of cleaned favourites ----
  const AOT_MAX_SEC = 360, cache = createAudioCache(), mem = new Map();   // mem: id → { pcm, sr } for the last couple of cleaned records
  let worker = null, aotBroken = false, jobId = 0; const jobs = new Map(); const aotStats = { fresh: 0, cached: 0, fallbacks: 0, last: null };
  const canClean = () => mode === 'clean' && settings.restore !== false && !aotBroken && typeof Worker !== 'undefined' && !weakDevice();
  function getWorker() {
    if (worker || aotBroken) return worker;
    try {
      worker = new Worker(new URL('./restore-offline-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => { const m = e.data || {}, j = jobs.get(m.id); if (!j) return;
        if (m.type === 'done') { jobs.delete(m.id); j.ok(m); } else if (m.type === 'error') { jobs.delete(m.id); j.fail(new Error(m.message)); } };
      worker.onerror = () => { aotBroken = true; for (const j of jobs.values()) j.fail(new Error('worker failed')); jobs.clear(); try { worker.terminate(); } catch (_) {} worker = null; };
    } catch (_) { aotBroken = true; worker = null; }
    return worker;
  }
  async function processRecord(src) {          // fetch → decode → mono → worker → { pcm Float32, sr }
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 90000);
    try {
      const r = await fetch(src, { mode: 'cors', signal: ac.signal }); if (!r.ok) return null;
      const audio = await ensureCtx().decodeAudioData(await r.arrayBuffer());
      if (!(audio.duration > 0) || audio.duration > AOT_MAX_SEC) return null;
      const mono = new Float32Array(audio.length), chs = audio.numberOfChannels;
      for (let c = 0; c < chs; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / chs; }
      const w = getWorker(); if (!w) return null;
      const id = ++jobId, res = await new Promise((ok, fail) => { jobs.set(id, { ok, fail }); w.postMessage({ id, pcm: mono, sr: audio.sampleRate }, [mono.buffer]); });
      aotStats.last = res.stats;
      return { pcm: res.pcm, sr: audio.sampleRate };
    } catch (_) { return null; } finally { clearTimeout(timer); }
  }
  async function toCacheFormat(pcm, sr) {      // resample to 22.05 kHz mono Int16
    const len = Math.ceil(pcm.length * CACHE_SR / sr), off = new OfflineAudioContext(1, len, CACHE_SR), b = off.createBuffer(1, pcm.length, sr);
    b.copyToChannel(pcm, 0); const s = off.createBufferSource(); s.buffer = b; s.connect(off.destination); s.start();
    const y = (await off.startRendering()).getChannelData(0), out = new Int16Array(y.length);
    for (let i = 0; i < y.length; i++) { const x = Math.max(-1, Math.min(1, y[i])); out[i] = x < 0 ? x * 32768 : x * 32767; }
    return out;
  }
  async function storeClean(id, res) { try { const i16 = await toCacheFormat(res.pcm, res.sr); return await cache.put(id, i16, CACHE_SR); } catch (_) { return false; } }
  function remember(id, res) { mem.set(id, res); while (mem.size > 2) mem.delete(mem.keys().next().value); }
  /** A cleaned copy for this record: from the cache (instant), or freshly cleaned. → { url, from } | null */
  async function cleanedURL(id, src, { process = true } = {}) {
    if (settings.restore === false) return null;
    if (id) { const hit = await cache.get(id); if (hit) { aotStats.cached++; return { url: wavURL(hit.pcm, hit.sr), from: 'cache' }; } }
    if (!process || !canClean()) return null;
    const res = await processRecord(src); if (!res) { aotStats.fallbacks++; return null; }
    aotStats.fresh++;
    if (id) { remember(id, res); if (isListed(id)) storeClean(id, res); }
    return { url: wavURL(res.pcm, res.sr), from: 'fresh' };
  }
  /** Save the cleaned copy of a record that has just been kept / added to a playlist (if we still have it). */
  async function cacheIfKept(ref) {
    const id = ref && ref.k === 'r' ? ref.id : null; if (!id || !mem.has(id) || !isListed(id)) return false;
    if (await cache.has(id)) return true; return storeClean(id, mem.get(id));
  }
  function useCleaned(t, res) {                 // swap a not-yet-started track over to its cleaned copy
    if (!res) return;
    if (t.started || t.el._owner !== t || settings.restore === false) { URL.revokeObjectURL(res.url); return; }
    if (t.blob) URL.revokeObjectURL(t.blob);
    t.orig ||= t.src; t.blob = res.url; t.src = res.url; t.aot = res.from; load(t.el, t);
  }

  async function prepare(myGen, ahead = false) {      // fetch a track and preload it on the idle element
    const st = station();
    const r = await archive.nextTrack(st);
    if (myGen !== gen) return null;
    if (!mode) { modeP = modeP || decideMode(r.src); await modeP; if (myGen !== gen) return null; }
    const el = idleEl();
    if (nxt && nxt.el === el) nxt = null;            // replaced by this one
    const t = { el, src: r.src, info: r.info, prefetch: false, out: false };
    load(el, t);
    // the next record has minutes until it plays: clean it ahead of time (or take the saved copy)
    if (ahead) cleanedURL(r.info.id, r.src).then(res => useCleaned(t, res)).catch(() => {});
    return t;
  }

  async function startLive(myGen, given) {
    setState('loading');
    let t;
    try { if (given) t = given; else { if (nxt && cur && nxt.el === cur.el) nxt = null; t = nxt || await prepare(myGen); nxt = null; } }
    catch (_) { if (myGen === gen) goOffline(myGen); return; }
    if (!t || myGen !== gen || t.el._owner !== t) return;
    const old = cur; cur = t;
    if (old && old !== t) fade(old.el, 0, FADE_MS, () => killAudio(old));
    const a = t.el;
    t.started = true; route(a, !!t.aot);
    a.onplaying = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (cur === t) { failures = 0; if (pl) pl.fails = 0; setState('playing'); } };
    a.onerror = () => { if (cur !== t || a._owner !== t) return; if (pl) { pl.fails++; plNext(myGen); return; } failures++; if (failures >= 3) goOffline(myGen); else startLive(myGen); };
    a.onloadedmetadata = () => { if (!pl && cur === t && Number.isFinite(a.duration) && (a.duration < MIN_SEC || a.duration > MAX_SEC + 30)) startLive(myGen); };
    a.onended = () => { if (t.info.id) cacheIfKept({ k: 'r', id: t.info.id }).catch(() => {}); if (cur === t) (pl ? plNext(myGen) : startLive(myGen)); };
    a.ontimeupdate = () => {           // preload the next record half-way through; fade out at the very end
      if (cur !== t || !Number.isFinite(a.duration)) return;
      if (pl && !t.prefetch && a.currentTime > a.duration / 2) { t.prefetch = true; warmNext(myGen); }   // clean the next playlist record ahead
      if (!pl && !nxt && !t.prefetch && a.currentTime > a.duration / 2) {
        t.prefetch = true;
        prepare(myGen, true).then(n => { if (n && myGen === gen && cur === t && n.el !== t.el) nxt = n; else if (n && n !== cur) killAudio(n); }).catch(() => {});
      }
      if (!t.out && a.duration - a.currentTime < FADE_MS / 1000) { t.out = true; fade(a, 0, FADE_MS); }
    };
    nowRef = t.info.id ? { k: 'r', id: t.info.id, title: t.info.title, artist: t.info.artist, year: t.info.year } : null;
    onTrack(t.info);
    try { await a.play(); if (cur === t) fade(a, volume, FADE_MS); }
    catch (e) {
      if (cur !== t || myGen !== gen) return;
      if (e && e.name === 'NotAllowedError') {         // browser wants a fresh tap: not a network failure
        gen++; playing = false; setState('paused');      // settings.on stays true, so the next tap retries
        return;
      }
      if (e && e.name === 'AbortError') return;          // src was swapped on purpose
      if (pl) { pl.fails++; plNext(myGen); return; }
      failures++; failures >= 3 ? goOffline(myGen) : startLive(myGen);
    }
  }

  // ---- playlists: play the list in order, then loop; composed songs by seed+mood, records by identifier ----
  async function plNext(myGen) {
    if (myGen !== gen || !pl) return;
    if (pl.fails >= pl.refs.length) { pl = null; playing = false; nowRef = null; setState('error'); return; }   // nothing in the list can play
    const ref = pl.refs[pl.i % pl.refs.length]; pl.i++;
    if (ref.k === 'c') {
      if (cur) { const c = cur; cur = null; fade(c.el, 0, FADE_MS, () => killAudio(c)); }
      killAudio(nxt); nxt = null; box.stop(); ensureCtx();
      songs ||= createSongPlayer(ctx, boxGain);
      const song = songs.playOne({ seed: ref.seed, mood: ref.mood, onEnd: () => plNext(myGen) });
      nowRef = { k: 'c', seed: song.seed, mood: song.mood, title: song.title };
      onTrack({ title: song.title, artist: 'Composed on this device', year: null, url: null, image: null, station: 'playlist' });
      boxFade(volume * 0.9, FADE_MS); pl.fails = 0; setState('playing');
      return;
    }
    setState('loading');
    try {
      const r = await archive.resolve({ identifier: ref.id, title: ref.title, creator: ref.artist, year: ref.year }, { id: 'playlist' });
      if (!r) throw new Error('unplayable');
      if (!mode) { modeP = modeP || decideMode(r.src); await modeP; }
      if (myGen !== gen || !pl) return;
      songs?.stop(1.5); boxFade(0, 300);
      const el = idleEl(); if (nxt && nxt.el === el) nxt = null;
      const t = { el, src: r.src, info: r.info, prefetch: false, out: false };
      const hit = settings.restore !== false ? await cleanedURL(ref.id, r.src, { process: false }) : null;   // saved cleaned copy?
      if (myGen !== gen || !pl) { if (hit) URL.revokeObjectURL(hit.url); return; }
      if (hit) { t.orig = r.src; t.blob = hit.url; t.src = hit.url; t.aot = 'cache'; }
      load(el, t); startLive(myGen, t);
      if (!hit && canClean() && !mem.has(ref.id)) cleanedURL(ref.id, r.src).then(res => res && URL.revokeObjectURL(res.url)).catch(() => {});   // clean + save for next time
    } catch (_) { if (myGen === gen && pl) { pl.fails++; plNext(myGen); } }
  }

  async function warmNext(myGen) {               // playlist: get the next record's cleaned copy ready (and saved)
    if (!pl || !canClean()) return;
    const ref = pl.refs[pl.i % pl.refs.length]; if (!ref || ref.k !== 'r' || mem.has(ref.id) || await cache.has(ref.id)) return;
    const r = await archive.resolve({ identifier: ref.id, title: ref.title, creator: ref.artist, year: ref.year }, { id: 'playlist' }).catch(() => null);
    if (r && myGen === gen) cleanedURL(ref.id, r.src).then(res => res && URL.revokeObjectURL(res.url)).catch(() => {});
  }
  function goOffline(myGen) {
    if (myGen !== gen) return;
    fallback = true; setState('offline'); retryAfter = box.count + 1;   // play one whole tune before retrying
    if (cur) { const c = cur; cur = null; fade(c.el, 0, 400, () => killAudio(c)); }
    if (nxt) { killAudio(nxt); nxt = null; }
    startBox(true);
  }
  function startBox(isFallback) {
    ensureCtx();
    box.start(boxGain, info => {
      onTrack(info);
      if (!isFallback) setState('playing');
      // while standing in for a live station, quietly retry the internet between tunes
      else if (box.count > retryAfter && navigator.onLine !== false) { const g0 = gen; fallback = false; box.stop(); boxFade(0, 300); startLive(g0); }
    });
    boxFade(volume * 0.9, FADE_MS);
    if (!isFallback) setState('playing');
  }

  function start(advance = false) {           // advance: '⏭ Next song' moves on to the next song of the series
    const myGen = ++gen; failures = 0; fallback = false; pl = null;
    const nextN = advance && songs && songs.series ? songs.series.n + 1 : 0;
    box.stop(); boxFade(0, 300); songs?.stop(1.5);
    if (station().id.startsWith('mood-')) {          // composed songs: same seed → same song, endless variations
      if (cur) { const c = cur; cur = null; fade(c.el, 0, FADE_MS, () => killAudio(c)); }
      killAudio(nxt); nxt = null; ensureCtx();
      songs ||= createSongPlayer(ctx, boxGain);
      const st = station();
      songs.playSeries({ seed: songCtx.seed, mood: st.id.slice(5), n: nextN, onSong: song => { nowRef = { k: 'c', seed: song.seed, mood: song.mood, title: song.title };
        onTrack({ title: song.title, artist: 'Composed on this device', year: null, url: null, image: null, station: st.id }); } });
      boxFade(volume * 0.9, FADE_MS); setState('playing');
    } else if (station().id === 'musicbox') {
      nowRef = null;
      if (cur) { const c = cur; cur = null; fade(c.el, 0, FADE_MS, () => killAudio(c)); }
      killAudio(nxt); nxt = null; startBox(false);
    } else {
      if (nxt && nxt.info.station !== station().id) { killAudio(nxt); nxt = null; }
      startLive(myGen);
    }
  }

  const api = {
    async play(stationId) {
      ensureCtx(); unlock();                         // unlock WebAudio + both <audio> elements inside the tap
      if (stationId && STATIONS.some(s => s.id === stationId)) settings.station = stationId;
      settings.on = true; saveSettings(settings);
      playing = true; start();
    },
    stop() {
      gen++; playing = false; pl = null; nowRef = null; settings.on = false; saveSettings(settings);
      box.stop(); songs?.stop(0.4); boxFade(0, 400);
      for (const t of [cur, nxt]) if (t) { const x = t; fade(x.el, 0, 600, () => killAudio(x)); }
      cur = null; nxt = null; setState('paused');
    },
    next() { if (!playing) return; unlock(); if (pl) { const g = ++gen; songs?.stop(1.2); plNext(g); } else start(station().id.startsWith('mood-')); },
    /** Play a list of song refs ({k:'c',seed,mood} / {k:'r',id,...}) in order from startIndex, looping. Call from a tap. */
    playPlaylist(refs, startIndex = 0) {
      const list = (Array.isArray(refs) ? refs : []).filter(r => r && ((r.k === 'c' && Number.isFinite(r.seed)) || (r.k === 'r' && typeof r.id === 'string')));
      if (!list.length) return false;
      ensureCtx(); unlock();
      settings.on = true; saveSettings(settings); playing = true; failures = 0; fallback = false;
      const myGen = ++gen; box.stop(); songs?.stop(1.5);
      pl = { refs: list, i: Math.max(0, Math.min(list.length - 1, startIndex | 0)), fails: 0 };
      plNext(myGen); return true;
    },
    get nowPlayingRef() { return nowRef ? { ...nowRef } : null; },   // for a '♡ Keep this song' button
    get playlistActive() { return !!pl; },
    toggle() { return playing ? api.stop() : api.play(); },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, Number(v) || 0)); settings.volume = volume; saveSettings(settings);
      if (cur && !cur.out) { stopFade(cur.el); setLevel(cur.el, volume); }
      if (ctx && (station().id === 'musicbox' || station().id.startsWith('mood-') || fallback) && playing) boxFade(volume * 0.9, 150);
    },
    setRestore(on) {
      settings.restore = !!on; saveSettings(settings);
      if (chain) chain.setEnabled(!!on);
      if (!on && nxt && nxt.aot && !nxt.started && nxt.orig) { URL.revokeObjectURL(nxt.blob); nxt.blob = null; nxt.src = nxt.orig; nxt.aot = false; load(nxt.el, nxt); }
    },
    get restore() { return settings.restore !== false; },
    get cleanMode() { return mode; },
    /** Saved cleaned songs (kept / playlist records): { songs, bytes }. */
    cacheInfo: () => cache.info(),
    clearCache: () => cache.clear(),
    /** Call after a song is kept / added to a playlist: saves its cleaned copy if one is in memory. */
    cacheIfKept: ref => cacheIfKept(ref),
    get aotStats() { return { ...aotStats, playing: cur ? (cur.aot || 'live') : null }; },              // 'clean' | 'plain' | null (not decided yet)
    /** Each puzzle gets its own song: the seed comes from the puzzle. */
    setContext({ seed } = {}) { if (Number.isFinite(seed)) songCtx.seed = seed >>> 0; if (playing && !pl && station().id.startsWith('mood-')) start(); },   // never interrupts a playlist
    get volume() { return volume; },
    get playing() { return playing; },
    get station() { return settings.station; },
    get enabled() { return !!settings.on; },        // extra: was music left on last time? (still needs a tap to start)
    get state() { return state; },                   // extra
  };
  return api;
}
