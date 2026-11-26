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

export const STATIONS = [
  { id: 'parlor',   name: 'Parlor Songs',    emoji: '🎙️', blurb: 'Sing-along songs of 1900–1925',
    q: '(subject:"Popular Music" OR subject:Vocal OR subject:Ballad OR subject:Song)' },
  { id: 'dance',    name: 'Ballroom',        emoji: '💃', blurb: 'Waltzes, fox trots and tangos',
    q: '(subject:Waltz OR subject:"Fox Trot" OR subject:"Fox-Trot" OR subject:Tango OR subject:Polka)' },
  { id: 'concert',  name: 'Concert Hall',    emoji: '🎻', blurb: 'Violins, orchestras and instrumentals',
    q: '(subject:Classical OR subject:Orchestral OR subject:Instrumental)' },
  { id: 'hawaiian', name: 'Hawaiian Breeze', emoji: '🌺', blurb: 'Steel guitars and island songs',
    q: 'subject:Hawaiian' },
  { id: 'musicbox', name: 'Music Box',       emoji: '🎶', blurb: 'Gentle made-up tunes — works without internet' },
];

function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (_) {}
  return { on: false, station: 'parlor', volume: 0.5 };
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

// ------------------------------------------------------------------ public player
export function createMusic({ onTrack = () => {}, onState = () => {} } = {}) {
  const settings = loadSettings();
  if (!STATIONS.some(s => s.id === settings.station)) settings.station = 'parlor';
  let volume = Math.min(1, Math.max(0, Number(settings.volume ?? 0.5)));
  let playing = false, state = 'paused', fallback = false, failures = 0, gen = 0, retryAfter = 0;
  let ctx = null, boxGain = null;
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

  function fade(audio, to, ms, then) {
    const from = audio.volume, t0 = performance.now();
    clearInterval(audio._fade);
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
    el._unlocking = false; clearInterval(el._fade); el.pause();
    el._owner = t; el.volume = 0; el.src = t.src; el.load();
  }
  function killAudio(t) {              // stop a track but keep the element for re-use
    if (!t || t.el._owner !== t) return;
    clearInterval(t.el._fade); t.el.pause(); t.el.removeAttribute('src'); t.el.load(); t.el._owner = null;
  }

  async function prepare(myGen) {      // fetch a track and preload it on the idle element
    const st = station();
    const r = await archive.nextTrack(st);
    if (myGen !== gen) return null;
    const el = idleEl();
    if (nxt && nxt.el === el) nxt = null;            // replaced by this one
    const t = { el, src: r.src, info: r.info, prefetch: false, out: false };
    load(el, t);
    return t;
  }

  async function startLive(myGen) {
    setState('loading');
    let t;
    try { if (nxt && cur && nxt.el === cur.el) nxt = null; t = nxt || await prepare(myGen); nxt = null; }
    catch (_) { if (myGen === gen) goOffline(myGen); return; }
    if (!t || myGen !== gen || t.el._owner !== t) return;
    const old = cur; cur = t;
    if (old && old !== t) fade(old.el, 0, FADE_MS, () => killAudio(old));
    const a = t.el;
    a.onplaying = () => { if (cur === t) { failures = 0; setState('playing'); } };
    a.onerror = () => { if (cur !== t || a._owner !== t) return; failures++; if (failures >= 3) goOffline(myGen); else startLive(myGen); };
    a.onloadedmetadata = () => { if (cur === t && Number.isFinite(a.duration) && (a.duration < MIN_SEC || a.duration > MAX_SEC + 30)) startLive(myGen); };
    a.onended = () => { if (cur === t) startLive(myGen); };
    a.ontimeupdate = () => {           // preload the next record half-way through; fade out at the very end
      if (cur !== t || !Number.isFinite(a.duration)) return;
      if (!nxt && !t.prefetch && a.currentTime > a.duration / 2) {
        t.prefetch = true;
        prepare(myGen).then(n => { if (n && myGen === gen && cur === t && n.el !== t.el) nxt = n; else if (n && n !== cur) killAudio(n); }).catch(() => {});
      }
      if (!t.out && a.duration - a.currentTime < FADE_MS / 1000) { t.out = true; fade(a, 0, FADE_MS); }
    };
    onTrack(t.info);
    try { await a.play(); if (cur === t) fade(a, volume, FADE_MS); }
    catch (e) {
      if (cur !== t || myGen !== gen) return;
      if (e && e.name === 'NotAllowedError') {         // browser wants a fresh tap: not a network failure
        gen++; playing = false; setState('paused');      // settings.on stays true, so the next tap retries
        return;
      }
      if (e && e.name === 'AbortError') return;          // src was swapped on purpose
      failures++; failures >= 3 ? goOffline(myGen) : startLive(myGen);
    }
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

  function start() {
    const myGen = ++gen; failures = 0; fallback = false;
    box.stop(); boxFade(0, 300);
    if (station().id === 'musicbox') {
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
      gen++; playing = false; settings.on = false; saveSettings(settings);
      box.stop(); boxFade(0, 400);
      for (const t of [cur, nxt]) if (t) { const x = t; fade(x.el, 0, 600, () => killAudio(x)); }
      cur = null; nxt = null; setState('paused');
    },
    next() { if (playing) { unlock(); start(); } },
    toggle() { return playing ? api.stop() : api.play(); },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, Number(v) || 0)); settings.volume = volume; saveSettings(settings);
      if (cur && !cur.out) { clearInterval(cur.el._fade); try { cur.el.volume = volume; } catch (_) {} }
      if (ctx && (station().id === 'musicbox' || fallback) && playing) boxFade(volume * 0.9, 150);
    },
    get volume() { return volume; },
    get playing() { return playing; },
    get station() { return settings.station; },
    get enabled() { return !!settings.on; },        // extra: was music left on last time? (still needs a tap to start)
    get state() { return state; },                   // extra
  };
  return api;
}
