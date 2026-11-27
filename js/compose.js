// compose.js — gentle background music composed on the device, no samples, no network.
// Deterministic: the same (seed, mood) always gives the same song (own seeded RNG; no Math.random).
//
//   composeSong(seed, mood)  -> plain data: { title, mood, seed, bpm, meter, length, events[] }
//   createSongPlayer(ctx, out) -> plays a never-repeating series of songs (seed, seed+1, …) with
//                                 crossfades, a look-ahead scheduler and short-lived synth voices.
//
// Musical rules that keep it pleasant for hours: curated chord progressions per mood, AABA / ABAC
// forms built from a short motif (repeat → sequence → develop → cadence), voice-led chords,
// humanised timing and velocity, gentle phrase dynamics, soft synth voices with no raw saw waves,
// a generated reverb, and a soft mastering chain (high frequencies rolled off; limiter).

export const MOODS = [
  { id: 'calm',   name: 'Calm',         emoji: '🌙', blurb: 'Slow, soft piano over a gentle hum' },
  { id: 'warm',   name: 'Warm',         emoji: '☕', blurb: 'Easy-going electric piano with a little swing' },
  { id: 'bubbly', name: 'Bubbly',       emoji: '🫧', blurb: 'Playful marimba with a skip in its step' },
  { id: 'parlor', name: 'Parlor Waltz', emoji: '🎠', blurb: 'Music-box waltzes with a touch of accordion' },
];
const moodOk = m => MOODS.some(x => x.id === m) ? m : 'calm';

// ------------------------------------------------------------------ randomness
function rng(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function songSeed(seed, n) { return (Math.imul((seed >>> 0) ^ 0x5bd1e995, 2654435761) + Math.imul(n + 1, 0x9E3779B1)) >>> 0; }

// ------------------------------------------------------------------ titles
const WORDS = {
  calm:   [['Quiet', 'Evening', 'Lamplight', 'Still', 'Moonlit', 'Slow', 'Soft', 'Drifting', 'Velvet', 'Silver'],
           ['Harbour', 'Garden', 'Window', 'Meadow', 'River', 'Lantern', 'Snowfall', 'Pillow', 'Lake', 'Twilight']],
  warm:   [['Sunday', 'Cinnamon', 'Front Porch', 'Golden', 'Kitchen', 'Easy', 'Hometown', 'Honey', 'Rainy-Day', 'Old Friends'],
           ['Shuffle', 'Stroll', 'Afternoon', 'Ramble', 'Serenade', 'Blues', 'Song', 'Jaunt', 'Kettle', 'Visit']],
  bubbly: [['Lemonade', 'Puddle', 'Jelly-Bean', 'Bicycle', 'Polka-Dot', 'Button', 'Popcorn', 'Pinwheel', 'Butterfly', 'Pocket'],
           ['Hop', 'Parade', 'Skip', 'Picnic', 'Twirl', 'Bounce', 'Romp', 'Caper', 'Tickle', 'Dance']],
  parlor: [['Lace Curtain', 'Tea at Four', 'Grandmother\'s', 'Bandstand', 'Velvet Chair', 'Carousel', 'Promenade', 'Sweetheart', 'Rose Garden', 'Ballroom'],
           ['Waltz', 'Waltz', 'Waltz', 'Valse', 'Waltz', 'Reverie', 'Waltz', 'Memories', 'Waltz', 'Minuet']],
};
export function songTitle(seed, mood) {
  const r = rng(songSeed(seed, -7) ^ hashStr(moodOk(mood))), w = WORDS[moodOk(mood)];
  return `${w[0][Math.floor(r() * w[0].length)]} ${w[1][Math.floor(r() * w[1].length)]}`;
}

// ------------------------------------------------------------------ harmony
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], penta: [0, 2, 4, 7, 9] };
const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
  six: [0, 4, 7, 9], add9: [0, 4, 7, 14], sus2: [0, 2, 7], sus4: [0, 5, 7] };
const MAJ = SCALES.major;

const CFG = {
  calm: {
    bpm: [60, 72], meter: 4, scale: 'penta', swing: 0, rest: 0.25, target: 150,
    rhythms: [[4], [2, 2], [3, 1], [2, 1, 1], [1, 1, 2], [2, 2], [1.5, 0.5, 2]],
    progs: [[[0, 'add9'], [5, 'min'], [3, 'maj7'], [0, 'maj']], [[0, 'maj'], [3, 'maj7'], [5, 'm7'], [4, 'sus4']],
            [[3, 'maj7'], [0, 'add9'], [3, 'maj7'], [4, 'sus2']], [[0, 'maj'], [2, 'min'], [3, 'maj'], [0, 'maj']],
            [[5, 'm7'], [3, 'maj7'], [0, 'add9'], [4, 'sus4']]],
    steps: [-2, -1, -1, 1, 1, 2], arch: [0, 1, 3, 0],
    reverb: 0.42, delay: 0, trim: 0.94,
  },
  warm: {
    bpm: [80, 96], meter: 4, scale: 'major', swing: 0.16, rest: 0.12, target: 150,
    rhythms: [[1, 1, 1, 1], [1.5, 0.5, 2], [0.5, 1, 0.5, 2], [1, 0.5, 0.5, 2], [2, 1, 1], [0.5, 0.5, 1, 2], [1, 1, 2]],
    progs: [[[0, 'maj7'], [5, 'm7'], [1, 'm7'], [4, 'dom7']], [[3, 'maj7'], [2, 'm7'], [1, 'm7'], [0, 'maj7']],
            [[0, 'six'], [5, 'm7'], [1, 'm7'], [4, 'dom7']], [[0, 'maj7'], [3, 'maj7'], [2, 'm7'], [5, 'm7']],
            [[3, 'maj7'], [4, 'dom7'], [2, 'm7'], [5, 'm7']]],
    steps: [-2, -1, -1, 1, 1, 2, 3], arch: [0, 2, 3, 0],
    reverb: 0.26, delay: 0.08, trim: 1.0,
  },
  bubbly: {
    bpm: [100, 120], meter: 4, scale: 'lydian', swing: 0, rest: 0.1, target: 150,
    rhythms: [[0.5, 0.5, 1, 0.5, 1.5], [1, 0.5, 0.5, 0.5, 0.5, 1], [0.5, 1, 0.5, 2], [0.75, 0.75, 0.5, 2],
              [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 0.5, 1.5]],
    progs: [[[0, 'maj'], [1, 'maj'], [0, 'maj'], [1, 'maj']], [[0, 'maj'], [4, 'maj'], [5, 'min'], [3, 'maj']],
            [[3, 'maj'], [4, 'maj'], [2, 'min'], [5, 'min']], [[0, 'add9'], [1, 'maj'], [3, 'maj7'], [0, 'maj']]],
    steps: [-3, -2, -1, 1, 2, 2, 3], arch: [0, 2, 4, 1],
    reverb: 0.22, delay: 0.22, trim: 1.17,
  },
  parlor: {
    bpm: [96, 112], meter: 3, scale: 'major', swing: 0, rest: 0.08, target: 150,
    rhythms: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [1, 0.5, 0.5, 1], [3], [0.5, 0.5, 0.5, 0.5, 1], [2, 1]],
    progs: [[[0, 'maj'], [0, 'maj'], [4, 'dom7'], [4, 'dom7']], [[4, 'dom7'], [4, 'dom7'], [0, 'maj'], [0, 'maj']],
            [[0, 'maj'], [3, 'maj'], [4, 'dom7'], [0, 'maj']], [[0, 'maj'], [5, 'min'], [1, 'min'], [4, 'dom7']],
            [[3, 'maj'], [0, 'maj'], [1, 'dom7'], [4, 'dom7']]],
    steps: [-2, -1, 1, 2, 2, 3, -3], arch: [0, 2, 5, 1],
    reverb: 0.3, delay: 0, trim: 1.24,
  },
};

function chordTones(key, [deg, q]) { const root = key + MAJ[deg]; return QUAL[q].map(i => root + i); }
const pcs = notes => [...new Set(notes.map(n => ((n % 12) + 12) % 12))];
function inRange(pcList, lo, hi) { const out = []; for (let m = lo; m <= hi; m++) if (pcList.includes(m % 12)) out.push(m); return out; }
function nearest(list, target) { let b = list[0]; for (const m of list) if (Math.abs(m - target) < Math.abs(b - target)) b = m; return b; }
function voiceLead(prev, chord, lo, hi) {             // move each voice as little as possible
  const center = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : (lo + hi) / 2;
  const tones = pcs(chord), out = [];
  for (const pc of tones) { const c = inRange([pc], lo, hi); if (c.length) out.push(nearest(c, center + (out.length - tones.length / 2) * 3)); }
  const v = [...new Set(out)].sort((a, b) => a - b);
  while (v.length < 3) v.push(v[0] + 12);
  return v;
}

// ------------------------------------------------------------------ composition
export function composeSong(seed, moodIn) {
  const mood = moodOk(moodIn), C = CFG[mood], R = rng((seed >>> 0) ^ hashStr(mood));
  const pick = a => a[Math.floor(R() * a.length)];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  const bpm = Math.round(C.bpm[0] + R() * (C.bpm[1] - C.bpm[0])), beat = 60 / bpm, M = C.meter;
  const key = 48 + pick([0, 2, 3, 5, 7, -2]);           // tonic of the chord register (C3, D3, Eb3, F3, G3, Bb2)
  const scale = SCALES[C.scale].map(i => i % 12);
  const melLo = key + 12, melHi = key + 28;
  const melScale = inRange(scale.map(i => (i + key) % 12), melLo - 5, melHi + 5);
  const events = [];
  const ev = (beatPos, voice, midi, vel, durBeats, pan = 0, fx = 0, role = 'acc') => {
    let b = beatPos;
    if (C.swing && Math.abs(b % 1 - 0.5) < 1e-6) b += C.swing;           // swung off-beats
    events.push({ t: Math.max(0, b * beat + gauss() * 0.007), v: voice, m: midi, vel: Math.max(0.05, Math.min(1, vel * (1 + gauss() * 0.08))), d: durBeats * beat, p: pan, fx, r: role });
  };

  // ---- harmony plan: sections of 8 bars (two 4-bar phrases)
  const progs = C.progs.slice(); for (let i = progs.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [progs[i], progs[j]] = [progs[j], progs[i]]; }
  const tonic = [0, mood === 'warm' ? 'maj7' : (mood === 'calm' ? 'add9' : 'maj')];
  const dom = mood === 'calm' ? [4, 'sus4'] : [4, 'dom7'];
  const sectionChords = (p, end) => {                    // end: 'open' (half cadence) | 'close' (back home)
    const a = p.slice(), b = p.slice();
    if (end === 'close') { b[3] = tonic; if (b[2][0] !== 4 && b[2][0] !== 1) b[2] = dom; }
    else { b[3] = dom; }
    return a.concat(b);
  };
  const form = R() < 0.5 ? 'AABA' : 'ABAC';
  const sec = {
    A: sectionChords(progs[0], 'close'), A1: sectionChords(progs[0], 'open'),
    B: sectionChords(progs[1 % progs.length], 'open'), C: sectionChords(progs[2 % progs.length], 'close'),
  };

  // ---- melody: motif → repeat/sequence → develop → cadence
  const makeMotif = () => {
    const rhythm = pick(C.rhythms);
    const contour = rhythm.map((_, i) => i === 0 ? 0 : pick(C.steps));
    return { rhythm, contour, arch: R() < 0.7 ? C.arch : C.arch.map(x => -x), rests: rhythm.map((d, i) => i > 0 && R() < C.rest) };
  };
  const cadenceRhythm = M === 3 ? pick([[3], [2, 1], [1, 2]]) : pick([[4], [3, 1], [2, 2], [1, 3]]);
  const writePhrase = (chords, motif, dev, startMidi, final) => {   // returns [{beat, dur, midi, vel}] for 4 bars
    const out = []; let prev = startMidi;
    for (let bar = 0; bar < 4; bar++) {
      const tones = inRange(pcs(chordTones(key, chords[bar])), melLo, melHi);
      const isCad = bar === 3, cell = isCad ? cadenceRhythm : bar === 2 ? dev.rhythm : motif.rhythm;
      const contour = isCad ? cell.map(() => 0) : bar === 2 ? dev.contour : motif.contour;
      let pos = 0;
      cell.forEach((d, i) => {
        const strong = pos === 0 || (M === 4 && pos === 2);
        let target;
        if (i === 0) { const base = melScale.indexOf(nearest(melScale, startMidi)); target = melScale[Math.max(0, Math.min(melScale.length - 1, base + motif.arch[bar]))]; }
        else { let idx = melScale.indexOf(nearest(melScale, prev)) + contour[i]; idx = Math.max(0, Math.min(melScale.length - 1, idx)); target = melScale[idx]; }
        if (target > melHi) target -= 12; if (target < melLo) target += 12;
        let m = (strong || d >= 1.5 || isCad) ? nearest(tones, target) : nearest(melScale, target);
        if (isCad && i === cell.length - 1 && final) { const home = inRange(pcs(chordTones(key, chords[bar])).slice(0, 2), melLo, melHi); m = nearest(home, prev); }
        const rest = !isCad && (bar < 2 ? motif.rests[i] : dev.rests[i]);
        if (!rest) out.push({ beat: bar * M + pos, dur: d, midi: m, vel: [0.92, 1, 1.06, 0.9][bar] * (strong ? 1 : 0.86) });
        prev = m; pos += d;
      });
    }
    return out;
  };
  const sectionMelody = (chords, motif, start, closing) => {
    const dev = { rhythm: pick(C.rhythms), contour: motif.contour.map(x => -x), rests: motif.rests };
    if (dev.contour.length !== dev.rhythm.length) dev.contour = dev.rhythm.map((_, i) => i === 0 ? 0 : pick(C.steps));
    if (dev.rests.length !== dev.rhythm.length) dev.rests = dev.rhythm.map(() => false);
    const p1 = writePhrase(chords.slice(0, 4), motif, dev, start, false);
    const p2 = writePhrase(chords.slice(4, 8), motif, dev, start, closing).map(n => ({ ...n, beat: n.beat + 4 * M }));
    return p1.concat(p2);
  };
  const centre = nearest(melScale, key + 19);
  const motifs = { A: makeMotif(), B: makeMotif(), C: makeMotif() };
  const mel = {
    A: sectionMelody(sec.A, motifs.A, centre, true), A1: sectionMelody(sec.A1, motifs.A, centre, false),
    B: sectionMelody(sec.B, motifs.B, nearest(melScale, centre + 3), false), C: sectionMelody(sec.C, motifs.C, nearest(melScale, centre - 2), true),
  };
  const order = form === 'AABA' ? ['A1', 'A', 'B', 'A'] : ['A1', 'B', 'A1', 'C'];

  // ---- arrangement
  const barSec = M * beat, passBars = 32;
  const passes = Math.max(1, Math.min(3, Math.round((C.target - 4 * barSec) / (passBars * barSec))));
  let bar0 = 0, voicing = null, lastBass = null;
  const accompany = (chord, barIdx, dyn, pass, nextChord) => {
    const b = barIdx * M, tones = chordTones(key, chord);
    voicing = voiceLead(voicing, tones, key + 3, key + 19);
    const rootPc = (key + MAJ[chord[0]]) % 12, bassRoot = inRange([rootPc], key - 10, key + 1)[0];
    const fifth = bassRoot + 7;
    if (mood === 'calm') {
      voicing.forEach((m, i) => ev(b, 'pad', m, 0.5 * dyn, M + 0.6, i % 2 ? 0.35 : -0.35));
      ev(b, 'bass', bassRoot, 0.55 * dyn, M, 0, 0, 'bass');
      const arp = [0, 1.5, 2, 3].filter(() => R() < 0.55);
      arp.forEach((p, i) => ev(b + p, 'felt', voicing[(i + (barIdx % 2)) % voicing.length] + 12 * (R() < 0.3), 0.32 * dyn, 1.5, 0.25));
    } else if (mood === 'warm') {
      ev(b, 'bass', bassRoot, 0.6 * dyn, 1.5); ev(b + 2, 'bass', R() < 0.7 ? fifth : bassRoot + 12, 0.5 * dyn, 1.4);
      if (nextChord && R() < 0.45) { const nr = inRange([(key + MAJ[nextChord[0]]) % 12], key - 10, key + 1)[0]; ev(b + 3.5, 'bass', nr + pick([-1, 1]), 0.42 * dyn, 0.45); }
      const comp = pick([[1, 2.5], [0, 1.5], [1, 3], [1.5, 3]]);
      comp.forEach(p => voicing.forEach(m => ev(b + p, 'epiano', m, 0.3 * dyn, 0.9, -0.3)));
      if (pass > 0) voicing.forEach(m => ev(b, 'pad', m + 12, 0.18 * dyn, M, 0.3));
    } else if (mood === 'bubbly') {
      ev(b, 'bass', bassRoot, 0.6 * dyn, 0.45); ev(b + 1.5, 'bass', bassRoot, 0.45 * dyn, 0.4); ev(b + 2.5, 'bass', fifth, 0.5 * dyn, 0.45);
      const up = voicing.concat(voicing.map(m => m + 12)), patt = pick([[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 5], [0, 1, 2, 1, 3, 2, 4, 2]]);
      patt.forEach((ix, i) => { if (i % 2 === 1 && R() < 0.25) return; ev(b + i * 0.5, 'pluck', up[ix % up.length], (i % 2 ? 0.26 : 0.34) * dyn, 0.45, 0.35, 0.5); });
    } else {                                                // parlor waltz: oom-pah-pah
      const low = barIdx % 2 ? fifth - 12 + 12 * (fifth - 12 < key - 14) : bassRoot;
      ev(b, 'bass', low, 0.55 * dyn, 1);
      const upper = voicing.slice(-3);
      [1, 2].forEach(p => upper.forEach(m => ev(b + p, 'reed', m, 0.26 * dyn, 0.75, -0.25)));
    }
    lastBass = bassRoot;
  };
  const melVoice = { calm: 'felt', warm: 'epiano', bubbly: 'marimba', parlor: 'celesta' }[mood];
  const playMelody = (notes, barOffset, pass, dyn, label) => {
    for (const n of notes) {
      const up = (mood === 'parlor' || mood === 'bubbly') && pass === 1 && label === 'B' && n.midi + 12 <= melHi + 7 ? 12 : 0;
      ev(barOffset * M + n.beat, melVoice, n.midi + up, (mood === 'calm' ? 0.55 : 0.62) * n.vel * dyn, mood === 'calm' ? n.dur * 1.15 : n.dur, 0.05, 1, 'mel');
      if (mood === 'parlor' && pass >= 1 && label !== 'B') ev(barOffset * M + n.beat, 'reed', n.midi - 12, 0.2 * n.vel * dyn, n.dur * 0.95, 0.2);
      if (mood === 'calm' && pass >= 1 && R() < 0.3 && n.dur >= 1) ev(barOffset * M + n.beat + 0.02, 'felt', n.midi - 12, 0.25 * n.vel * dyn, n.dur, -0.2);
    }
  };
  // intro: two bars on the tonic (and the first chord)
  accompany(tonic, 0, 0.75, 0, sec[order[0]][0]); accompany(sec[order[0]][0], 1, 0.82, 0, sec[order[0]][1]);
  bar0 = 2;
  for (let pass = 0; pass < passes; pass++) {
    const passDyn = passes === 1 ? 1 : [0.9, 1.0, 0.94][pass];
    order.forEach((label, si) => {
      const chords = sec[label], key2 = label.replace('1', '');
      const dyn = passDyn * (key2 === 'B' ? 1.05 : 1) * (si === order.length - 1 && pass === passes - 1 ? 0.95 : 1);
      chords.forEach((ch, i) => accompany(ch, bar0 + i, dyn * (i % 4 === 3 ? 0.94 : 1), pass, chords[i + 1] || sec[order[(si + 1) % order.length]][0]));
      playMelody(mel[label], bar0, pass, dyn, key2);
      bar0 += 8;
    });
  }
  // ending: let the home chord ring, with a soft rising arpeggio
  voicing = voiceLead(voicing, chordTones(key, tonic), key + 3, key + 19);
  const endB = bar0 * M;
  voicing.forEach((m, i) => ev(endB + i * 0.5, melVoice === 'celesta' ? 'celesta' : (mood === 'bubbly' ? 'marimba' : melVoice), m + 12, 0.38, M * 2 - i * 0.5, (i - 1) * 0.2));
  ev(endB, 'bass', inRange([(key) % 12], key - 10, key + 1)[0], 0.5, M * 2);
  if (mood !== 'bubbly') voicing.forEach(m => ev(endB, 'pad', m, 0.32, M * 2, 0));
  events.sort((a, b) => a.t - b.t);
  const length = (bar0 + 2) * barSec + 1.5;
  return { title: songTitle(seed, mood), mood, seed: seed >>> 0, bpm, meter: M, key, form, passes, length, events };
}

// ------------------------------------------------------------------ sound
const irCache = new WeakMap();
function reverbIR(ctx) {                                 // generated stereo room: early taps + darkening tail
  if (irCache.has(ctx)) return irCache.get(ctx);
  const secs = 2.6, n = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(2, n, ctx.sampleRate), R = rng(1878);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate, a = 0.55 - 0.5 * Math.min(1, t / secs);     // tail gets darker
      y += a * ((R() * 2 - 1) - y);
      d[i] = y * Math.exp(-t * 6.9 / secs * 1.15) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (const [tt, g] of [[0.011, 0.5], [0.019, 0.35], [0.027 + ch * 0.004, 0.3], [0.041 - ch * 0.003, 0.22]]) d[Math.floor(tt * ctx.sampleRate)] += g;
  }
  irCache.set(ctx, buf); return buf;
}
const waveCache = new WeakMap();
function soft(ctx, name) {                               // gentle periodic waves (no harsh upper harmonics)
  let c = waveCache.get(ctx); if (!c) { c = {}; waveCache.set(ctx, c); }
  if (c[name]) return c[name];
  const H = name === 'reed' ? [0, 1, 0.55, 0.42, 0.22, 0.16, 0.08, 0.05, 0.03] : [0, 1, 0.32, 0.12, 0.05, 0.02];
  const re = new Float32Array(H.length), im = Float32Array.from(H);
  return (c[name] = ctx.createPeriodicWave(re, im));
}
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

// One note = a few short-lived nodes, freed when the last oscillator ends.
function playNote(ctx, bus, fxBus, e, at, cleanup = true) {
  const t = at, f = hz(e.m), vel = e.vel, d = Math.max(0.05, e.d);
  const out = ctx.createGain(); let tail = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (tail) { tail.pan.value = Math.max(-1, Math.min(1, e.p || 0)); out.connect(tail).connect(bus); if (fxBus && e.fx) tail.connect(fxBus); }
  else { out.connect(bus); if (fxBus && e.fx) out.connect(fxBus); }
  const nodes = [out, tail]; let endT = t + d;
  const osc = (type, freq, wave) => { const o = ctx.createOscillator(); if (wave) o.setPeriodicWave(wave); else o.type = type; o.frequency.value = freq; nodes.push(o); return o; };
  const amp = (g0) => { const g = ctx.createGain(); g.gain.value = 0; nodes.push(g); return g; };
  const env = (g, peak, a, decayTc, sustain, rel) => {     // attack, exponential decay toward sustain, release at note end
    const p = g.gain; p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * sustain, t + a, decayTc); p.setTargetAtTime(0, t + d, rel); return t + d + rel * 5;
  };
  switch (e.v) {
    case 'felt': {                                       // muffled felt piano
      const o1 = osc('sine', f), o2 = osc('triangle', f * 1.001), o3 = osc('sine', f * 2), g1 = amp(), g2 = amp(), g3 = amp();
      endT = env(g1, 0.32 * vel, 0.008, 0.9, 0.0, 0.25); env(g2, 0.1 * vel, 0.008, 0.6, 0, 0.2); env(g3, 0.06 * vel, 0.006, 0.25, 0, 0.15);
      o1.connect(g1).connect(out); o2.connect(g2).connect(out); o3.connect(g3).connect(out); break;
    }
    case 'epiano': {                                     // FM electric piano: soft bell attack, round body
      const car = osc('sine', f), mod = osc('sine', f), mg = amp(), g = amp(), bell = osc('sine', f * 4), bg = amp();
      mg.gain.setValueAtTime(f * 1.6 * (0.6 + vel), t); mg.gain.setTargetAtTime(f * 0.25, t, 0.25);
      mod.connect(mg).connect(car.frequency);
      endT = env(g, 0.26 * vel, 0.005, 1.1, 0.15, 0.3); env(bg, 0.03 * vel, 0.003, 0.08, 0, 0.05);
      car.connect(g).connect(out); bell.connect(bg).connect(out); break;
    }
    case 'bass': {
      const o1 = osc('sine', f), o2 = osc('triangle', f), lp = ctx.createBiquadFilter(), g = amp(); nodes.push(lp);
      lp.type = 'lowpass'; lp.frequency.value = 700; const g2 = amp(); g2.gain.value = 0.35;
      endT = env(g, 0.42 * vel, 0.012, 0.6, 0.55, 0.12);
      o1.connect(g); o2.connect(g2).connect(g); g.connect(lp).connect(out); break;
    }
    case 'marimba': case 'pluck': {                       // wooden bar: fundamental + quick 4th partial
      const o1 = osc('sine', f), o2 = osc('sine', f * 3.98), g1 = amp(), g2 = amp();
      const decay = e.v === 'pluck' ? 0.16 : 0.32;
      endT = env(g1, (e.v === 'pluck' ? 0.2 : 0.34) * vel, 0.003, decay, 0, 0.08); env(g2, 0.07 * vel, 0.001, 0.03, 0, 0.02);
      o1.connect(g1).connect(out); o2.connect(g2).connect(out); endT = Math.max(endT, t + decay * 6); break;
    }
    case 'celesta': {                                    // music-box tine
      const hold = t + Math.max(1.0, Math.min(2.4, d * 1.6)); endT = hold + 0.45;      // ring, then a quick soft damp (no click at stop)
      [[1, 1, 0.9], [2, 0.28, 0.45], [3.01, 0.07, 0.2]].forEach(([mul, lvl, tc]) => {
        const o = osc('sine', f * mul), a = amp(); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(lvl * 0.3 * vel, t + 0.004);
        a.gain.setTargetAtTime(0, t + 0.004, tc * Math.max(0.6, Math.min(1.4, d))); a.gain.setTargetAtTime(0, hold, 0.06); o.connect(a).connect(out);
      }); break;
    }
    case 'reed': {                                       // accordion-ish: two slightly detuned soft reeds
      const o1 = osc(null, f * 1.004, soft(ctx, 'reed')), o2 = osc(null, f * 0.996, soft(ctx, 'reed')), lp = ctx.createBiquadFilter(), g = amp(); nodes.push(lp);
      lp.type = 'lowpass'; lp.frequency.value = 1800; endT = env(g, 0.09 * vel, 0.05, 0.4, 0.75, 0.08);
      o1.connect(g); o2.connect(g); g.connect(lp).connect(out); break;
    }
    default: {                                           // pad: slow, warm, detuned
      const o1 = osc(null, f * 1.003, soft(ctx, 'pad')), o2 = osc(null, f * 0.997, soft(ctx, 'pad')), lp = ctx.createBiquadFilter(), g = amp(); nodes.push(lp);
      lp.type = 'lowpass'; lp.frequency.value = 1300; endT = t + d + 2.2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * vel, t + Math.min(1.4, d * 0.4)); g.gain.setTargetAtTime(0, t + d, 0.45);
      o1.connect(g); o2.connect(g); g.connect(lp).connect(out);
    }
  }
  const oscs = nodes.filter(n => n && n.start);
  oscs.forEach(o => { o.start(t); o.stop(endT); });
  if (oscs.length && cleanup) oscs[oscs.length - 1].onended = () => { for (const n of nodes) if (n) try { n.disconnect(); } catch (_) {} };
}

function createMaster(ctx) {                             // soft mastering: no harsh highs, gentle glue, safety limiter
  const input = ctx.createGain(), shelf = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor(), lim = ctx.createDynamicsCompressor(), output = ctx.createGain();
  shelf.type = 'highshelf'; shelf.frequency.value = 4500; shelf.gain.value = -4;
  lp.type = 'lowpass'; lp.frequency.value = 7500; lp.Q.value = 0.5;
  comp.threshold.value = -20; comp.ratio.value = 2.5; comp.knee.value = 12; comp.attack.value = 0.02; comp.release.value = 0.3;
  lim.threshold.value = -4; lim.ratio.value = 12; lim.knee.value = 2; lim.attack.value = 0.003; lim.release.value = 0.2;
  output.gain.value = 1.0;
  input.connect(shelf).connect(lp).connect(comp).connect(lim).connect(output);
  return { input, output };
}

// ------------------------------------------------------------------ player
const LOOKAHEAD = 2.5, TICK = 200;

export function createSongPlayer(ctx, out, { offline = false, reverb = true } = {}) {
  const master = createMaster(ctx); master.output.connect(out);
  const conv = reverb ? ctx.createConvolver() : ctx.createGain(); if (reverb) conv.buffer = reverbIR(ctx); if (reverb) conv.connect(master.input);
  let active = [], timer = null, series = null, gen = 0;

  function startSong(song, at, fadeIn) {
    const C = CFG[song.mood];
    const bus = ctx.createGain(), send = ctx.createGain(), fade = ctx.createGain();
    bus.gain.value = 0.55 * C.trim; send.gain.value = C.reverb;
    fade.gain.setValueAtTime(fadeIn ? 0 : 1, at); if (fadeIn) fade.gain.linearRampToValueAtTime(1, at + fadeIn);
    bus.connect(fade); fade.connect(master.input); fade.connect(send).connect(conv);
    let fx = null;
    if (C.delay) {                                       // soft echo on the melody (darker each repeat)
      const dl = ctx.createDelay(2), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
      dl.delayTime.value = Math.min(1.9, 60 / song.bpm * 0.75); fb.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 2600; wet.gain.value = C.delay;
      fx = ctx.createGain(); fx.connect(dl); dl.connect(lp).connect(fb).connect(dl); lp.connect(wet).connect(bus);
    }
    const s = { song, t0: at, i: 0, bus, fade, fx, nodes: [bus, send, fade, fx] };
    active.push(s); pump(); return s;
  }
  function pump(horizon) {
    const now = ctx.currentTime, until = horizon != null ? horizon : now + LOOKAHEAD;
    for (const s of active) {
      const ev = s.song.events;
      while (s.i < ev.length && s.t0 + ev[s.i].t < until) {
        const e = ev[s.i++], at = s.t0 + e.t;
        if (at >= now - 0.05 || offline) playNote(ctx, s.bus, s.fx, e, Math.max(at, now), !offline);   // offline: no async clean-up → bit-exact renders
      }
    }
    if (series && !offline) {                            // queue the next song before this one ends
      const cur = series.cur;
      if (cur && !series.queued && now > cur.t0 + cur.song.length - 6) {
        series.queued = true; series.n++;
        const song = composeSong(songSeed(series.seed, series.n), series.mood);
        const at = Math.max(now + 0.2, cur.t0 + cur.song.length - 1.5);
        const s = startSong(song, at, 2.5); series.cur = s; series.queued = false;
        const delay = Math.max(0, (at - now) * 1000); const myGen = gen;
        setTimeout(() => { if (myGen === gen && series && series.onSong) series.onSong(song, series.n); }, delay);
      }
    }
    for (const s of active.slice()) if (now > s.t0 + s.song.length + 6 || s.dead && now > s.deadAt) {
      for (const n of s.nodes) if (n) try { n.disconnect(); } catch (_) {}
      active = active.filter(x => x !== s);
    }
  }
  function fadeOut(s, secs) {
    const n = ctx.currentTime, g = s.fade.gain; g.cancelScheduledValues(n); g.setValueAtTime(g.value, n); g.linearRampToValueAtTime(0, n + secs);
    s.dead = true; s.deadAt = n + secs + 3; s.i = s.song.events.length;      // no new notes
  }
  return {
    // Play songs seed, seed+1, … in a mood. Crossfades from whatever is playing now.
    playSeries({ seed, mood, n = 0, fade = 2.5, onSong } = {}) {
      gen++; for (const s of active) if (!s.dead) fadeOut(s, fade);
      series = { seed: seed >>> 0, mood: moodOk(mood), n, onSong, queued: false };
      const song = composeSong(songSeed(series.seed, n), series.mood);
      series.cur = startSong(song, ctx.currentTime + 0.12, fade);
      if (onSong) onSong(song, n);
      if (!timer && !offline) timer = setInterval(() => pump(), TICK);
      return song;
    },
    // Play exactly one song (e.g. from a playlist), then call onEnd(song) shortly before it finishes.
    playOne({ seed, mood, fade = 2.5, onEnd } = {}) {
      gen++; for (const s of active) if (!s.dead) fadeOut(s, fade);
      series = null;
      const song = composeSong(seed >>> 0, mood);
      startSong(song, ctx.currentTime + 0.12, fade);
      if (!timer && !offline) timer = setInterval(() => pump(), TICK);
      const myGen = gen;
      if (onEnd) setTimeout(() => { if (myGen === gen) onEnd(song); }, Math.max(1000, (song.length - 1.5) * 1000));
      return song;
    },
    stop(fade = 1.5) { gen++; series = null; for (const s of active) if (!s.dead) fadeOut(s, fade); },
    renderAll(song, at = 0, horizon = Infinity) { startSong(song, at, 0); pump(horizon); },     // offline rendering / tests
    dispose() { clearInterval(timer); timer = null; for (const s of active) for (const n of s.nodes) if (n) try { n.disconnect(); } catch (_) {} active = []; try { master.output.disconnect(); } catch (_) {} },
    get current() { return series && series.cur ? series.cur.song : null; },
    get series() { return series ? { seed: series.seed, mood: series.mood, n: series.n } : null; },
    get voices() { return active.length; },
  };
}
