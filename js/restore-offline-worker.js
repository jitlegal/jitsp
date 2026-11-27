// Ahead-of-time restoration for old 78 rpm records (runs in a Web Worker, off the main thread).
//
// The live chain (restore-worklet.js) only sees a few milliseconds of audio, so it must be cautious.
// With the whole recording in hand we can do what restoration studios do:
//   1. learn the record's own noise from its quiet run-in groove (or its quietest second),
//   2. find clicks with an autoregressive (LPC) model of the music: anything the model can't predict
//      far beyond the usual error is a click — much more sensitive than a level threshold,
//   3. repair them by least-squares AR interpolation (Godsill & Rayner): the most likely waveform
//      given the music on both sides,
//   4. a second, finer pass for small crackle,
//   5. spectral noise reduction from the noise print (decision-directed Wiener gains, smoothed),
//   6. a gentle tone touch-up and loudness levelling.
//
// Message in:  { id, pcm: Float32Array (mono), sr }        (pcm buffer is transferred)
// Messages out: { type:'progress', id, stage, p } … { type:'done', id, pcm, stats } | { type:'error', id, message }

const isWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
if (isWorker) {
  self.onmessage = e => {
    const { id, pcm, sr } = e.data || {};
    try {
      if (!(pcm instanceof Float32Array) || !(sr >= 8000 && sr <= 192000) || pcm.length > sr * 60 * 8) throw new Error('bad input');
      const out = restore(pcm, sr, (stage, p) => self.postMessage({ type: 'progress', id, stage, p }));
      self.postMessage({ type: 'done', id, pcm: out.pcm, stats: out.stats }, [out.pcm.buffer]);
    } catch (err) { self.postMessage({ type: 'error', id, message: String((err && err.message) || err) }); }
  };
}

/** Clean a mono recording. Returns { pcm: Float32Array, stats }. Pure function (also used by the tests). */
export function restore(input, sr, progress = () => {}, stages = {}) {
  const on = k => stages[k] !== false;           // test switches: declick, denoise, tone, level
  const t0 = now(), x = Float64Array.from(input), stats = { sr, seconds: +(x.length / sr).toFixed(1), ms: {} };
  const mark = name => { stats.ms[name] = Math.round(now() - (mark.t || t0)); mark.t = now(); };
  const p = 24;
  // 1–4: clicks. Coarse pass (bigger clicks, gaps up to ~8 ms), then a fine pass for crackle (≤ 2 ms).
  if (on('declick')) stats.clicks1 = declick(x, sr, p, 4.5, Math.round(sr * 0.008), true, stats); progress('declick', 0.35); mark('declick1');
  if (on('declick') && on('fine')) stats.clicks2 = declick(x, sr, p, 3.5, Math.round(sr * 0.002), false, stats); progress('declick', 0.5); mark('declick2');
  // 5: noise reduction from the record's own noise print
  const print = noisePrint(x, sr); stats.noisePrint = print ? print.from : 'none';
  if (print && on('denoise')) denoise(x, print.psd, (q) => progress('denoise', 0.5 + q * 0.4));
  mark('denoise');
  // 6: tone + level
  if (on('tone')) tone(x, sr); const g = on('level') ? level(x, sr) : 1; stats.levelGain_dB = +(20 * Math.log10(g)).toFixed(1);
  mark('tone');
  const out = new Float32Array(x.length); for (let i = 0; i < x.length; i++) out[i] = x[i];
  stats.ms.total = Math.round(now() - t0);
  progress('done', 1);
  return { pcm: out, stats };
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ LPC (autocorrelation + Levinson–Durbin)
function levinson(r, p) {                  // r[0..p] → prediction-error filter b[0..p] with b[0] = 1, or null
  const a = new Float64Array(p + 1), tmp = new Float64Array(p + 1);
  if (!(r[0] > 0)) return null;
  a[0] = 1; let err = r[0] * (1 + 1e-9);   // tiny white-noise floor keeps it stable
  for (let i = 1; i <= p; i++) {
    let acc = r[i]; for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err; if (!Number.isFinite(k) || Math.abs(k) >= 1) return i > 1 ? a.slice(0, p + 1) : null;
    tmp.set(a); for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j]; a[i] = k;
    err *= 1 - k * k;
  }
  return a;
}
let WBUF = new Float64Array(4096);
function autocorr(x, from, to, p, r = new Float64Array(p + 1)) {   // Hann-windowed segment, autocorrelation added into r
  const n = to - from; if (n <= p) return r;
  if (WBUF.length < n) WBUF = new Float64Array(n);
  const w = WBUF, k = 2 * Math.PI / n;
  for (let i = 0; i < n; i++) w[i] = x[from + i] * (0.5 - 0.5 * Math.cos(k * (i + 0.5)));
  for (let lag = 0; lag <= p; lag++) { let s = 0; for (let i = lag; i < n; i++) s += w[i] * w[i - lag]; r[lag] += s; }
  return r;
}

// ------------------------------------------------------------------ click detection + repair
function declick(x, sr, p, k, maxGap, coarse, stats) {
  const n = x.length, B = 1024, widen = Math.max(2, Math.round(sr * 0.0003)), flag = new Uint8Array(n), e = new Float64Array(B), mag = new Float64Array(B);
  let blocksSkipped = 0;
  for (let s = p + B; s + B <= n; s += B) {
    // fit on the block plus some history, residual over the block
    const r = autocorr(x, s - Math.min(s, B), s + B, p);
    const b = levinson(r, p); if (!b) continue;
    for (let i = 0; i < B; i++) { const t = s + i; let v = x[t]; for (let j = 1; j <= p; j++) v += b[j] * x[t - j]; e[i] = v; mag[i] = Math.abs(v); }
    let ms = 0; for (let i = 0; i < B; i++) ms += x[s + i] * x[s + i];
    const sigma = 1.4826 * median(mag) + 1e-9, thr = Math.max(k * sigma, 0.03 * Math.sqrt(ms / B), 1e-3);   // never flag what nobody could hear
    let cnt = 0; for (let i = 0; i < B; i++) if (mag[i] > thr) cnt++;
    if (cnt > B * 0.2) { blocksSkipped++; continue; }    // too much "surprise": noisy music (cymbals, sibilants), not clicks
    for (let i = 0; i < B; i++) if (mag[i] > thr) { const a = Math.max(0, s + i - widen), z = Math.min(n, s + i + widen + 1); for (let q = a; q < z; q++) flag[q] = 1; }
  }
  // flagged runs → gaps (merge runs closer than 8 samples)
  const gaps = []; let i = 0;
  while (i < n) {
    if (!flag[i]) { i++; continue; }
    let j = i; while (j < n && (flag[j] || (j + 8 < n && flag.subarray(j, j + 8).some(v => v)))) j++;
    gaps.push([i, j]); i = j;
  }
  let repaired = 0, attenuated = 0, skipped = 0;
  for (const [g0, g1] of gaps) {
    const m = g1 - g0;
    if (m <= maxGap) { if (lsar(x, g0, g1, m > 120 ? 32 : p)) repaired++; else skipped++; }
    else if (coarse && m <= sr * 0.04) { duck(x, g0, g1, sr); attenuated++; }
    else skipped++;
  }
  if (stats) stats[coarse ? 'skippedBlocks1' : 'skippedBlocks2'] = blocksSkipped;
  return { gaps: gaps.length, repaired, attenuated, skipped };
}
function median(a) {                       // a is scratch (Float64Array); quickselect on a copy
  const c = Float64Array.from(a), mid = c.length >> 1; let lo = 0, hi = c.length - 1;
  while (lo < hi) {
    const piv = c[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (c[i] < piv) i++; while (c[j] > piv) j--; if (i <= j) { const t = c[i]; c[i] = c[j]; c[j] = t; i++; j--; } }
    if (mid <= j) hi = j; else if (mid >= i) lo = i; else break;
  }
  return c[mid];
}
/** Least-squares AR interpolation of x[g0..g1) from the music on both sides (banded Cholesky, O(m·p²)). */
function lsar(x, g0, g1, p) {
  const n = x.length, m = g1 - g0, L = 1024;
  if (g0 < p + 32 || g1 + p + 32 > n) return false;
  const r = new Float64Array(p + 1);
  autocorr(x, Math.max(p, g0 - L), g0, p, r); autocorr(x, g1 + p, Math.min(n, g1 + p + L), p, r);
  const b = levinson(r, p); if (!b) return false;
  // e0: prediction error with the gap set to zero, over every row that touches the gap
  const save = x.slice(g0, g1); x.fill(0, g0, g1);
  const R0 = g0, R1 = g1 + p, e0 = new Float64Array(R1 - R0);
  for (let t = R0; t < R1; t++) { let v = 0; for (let q = 0; q <= p; q++) v += b[q] * x[t - q]; e0[t - R0] = v; }
  // normal equations M u = rhs, M Toeplitz banded with c(l) = Σ b_k b_{k+l}
  const c = new Float64Array(p + 1); for (let l = 0; l <= p; l++) { let s = 0; for (let q = 0; q + l <= p; q++) s += b[q] * b[q + l]; c[l] = s; }
  const rhs = new Float64Array(m);
  for (let ii = 0; ii < m; ii++) { let s = 0; for (let q = 0; q <= p; q++) s += b[q] * e0[ii + q]; rhs[ii] = -s; }
  const W = p + 1, Lc = new Float64Array(m * W), reg = c[0] * 1e-9;   // banded Cholesky: Lc[i*W + (i-j)] = L_ij
  for (let ii = 0; ii < m; ii++) {
    for (let jj = Math.max(0, ii - p); jj <= ii; jj++) {
      let s = ii === jj ? c[0] + reg : c[ii - jj];
      for (let kk = Math.max(0, ii - p); kk < jj; kk++) s -= Lc[ii * W + (ii - kk)] * Lc[jj * W + (jj - kk)];
      if (ii === jj) { if (!(s > 0)) { x.set(save, g0); return false; } Lc[ii * W] = Math.sqrt(s); }
      else Lc[ii * W + (ii - jj)] = s / Lc[jj * W];
    }
  }
  const y = new Float64Array(m);            // forward then backward substitution
  for (let ii = 0; ii < m; ii++) { let s = rhs[ii]; for (let kk = Math.max(0, ii - p); kk < ii; kk++) s -= Lc[ii * W + (ii - kk)] * y[kk]; y[ii] = s / Lc[ii * W]; }
  for (let ii = m - 1; ii >= 0; ii--) { let s = y[ii]; for (let kk = ii + 1; kk <= Math.min(m - 1, ii + p); kk++) s -= Lc[kk * W + (kk - ii)] * y[kk]; y[ii] = s / Lc[ii * W]; }
  let ok = true; for (let ii = 0; ii < m; ii++) if (!Number.isFinite(y[ii])) { ok = false; break; }
  if (!ok) { x.set(save, g0); return false; }
  for (let ii = 0; ii < m; ii++) x[g0 + ii] = y[ii];
  return true;
}
function duck(x, g0, g1, sr) {             // long disturbance: soften it instead of inventing music
  const f = Math.max(8, Math.round(sr * 0.001));
  for (let t = Math.max(0, g0 - f); t < Math.min(x.length, g1 + f); t++) {
    const into = Math.min(1, (t - (g0 - f)) / f, ((g1 + f) - t) / f);
    x[t] *= 1 - 0.75 * Math.max(0, Math.min(1, into));
  }
}

// ------------------------------------------------------------------ FFT + spectral noise reduction
const N = 2048, HOP = 512;
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const REV = (() => { const r = new Uint32Array(N), bits = Math.log2(N); for (let i = 0; i < N; i++) { let v = 0; for (let b = 0; b < bits; b++) v |= ((i >> b) & 1) << (bits - 1 - b); r[i] = v; } return r; })();
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / N)), SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / N));
function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inverse ? -1 : 1;
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1, step = N / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < half; k++) {
      const wr = COS[k * step], wi = sg * SIN[k * step], a = i + k, b = a + half;
      const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
    }
  }
}
function noisePrint(x, sr) {
  const F = N, H = 1024, frames = [];
  for (let s = 0; s + F <= x.length; s += H) { let e = 0; for (let i = 0; i < F; i++) e += x[s + i] * x[s + i]; frames.push([s, Math.sqrt(e / F)]); }
  const valid = frames.filter(f => f[1] > 1e-5);                 // digital silence is not groove noise
  if (valid.length < 8) return null;
  const sorted = valid.map(f => f[1]).sort((a, b) => a - b), q10 = sorted[Math.floor(sorted.length * 0.1)];
  let onset = valid.findIndex(f => f[1] > 3 * q10), chosen, from;
  const second = Math.max(4, Math.round(sr / H));
  if (onset >= 10) { chosen = valid.slice(Math.max(0, onset - second), onset - 2); from = 'run-in groove'; }
  else { chosen = valid.slice().sort((a, b) => a[1] - b[1]).slice(0, second); from = 'quietest second'; }
  if (!chosen.length) return null;
  const psd = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N);
  for (const [s] of chosen) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * HANN[i]; im[i] = 0; }
    fft(re, im, false); for (let kk = 0; kk <= N / 2; kk++) psd[kk] += re[kk] * re[kk] + im[kk] * im[kk];
  }
  for (let kk = 0; kk <= N / 2; kk++) psd[kk] /= chosen.length;
  return { psd, from };
}
function denoise(x, noise, progress) {
  const n = x.length, out = new Float64Array(n + N), re = new Float64Array(N), im = new Float64Array(N);
  const K = N / 2 + 1, Gprev = new Float64Array(K).fill(1), gPrev = new Float64Array(K).fill(1), G = new Float64Array(K), Gs = new Float64Array(K);
  const alpha = 0.98, over = 1.25, floor = Math.pow(10, -16 / 20), total = Math.ceil(n / HOP);
  const lam = Float64Array.from(noise, v => v * over + 1e-20);
  for (let s = -N + HOP, f = 0; s < n; s += HOP, f++) {
    for (let i = 0; i < N; i++) { const t = s + i; re[i] = (t >= 0 && t < n ? x[t] : 0) * HANN[i]; im[i] = 0; }
    fft(re, im, false);
    for (let kk = 0; kk < K; kk++) {
      const P = re[kk] * re[kk] + im[kk] * im[kk], gamma = P / lam[kk];
      const xi = alpha * Gprev[kk] * Gprev[kk] * gPrev[kk] + (1 - alpha) * Math.max(gamma - 1, 0);   // decision-directed a priori SNR
      G[kk] = Math.max(floor, xi / (1 + xi)); gPrev[kk] = gamma;
    }
    for (let kk = 0; kk < K; kk++) Gs[kk] = 0.25 * G[Math.max(0, kk - 1)] + 0.5 * G[kk] + 0.25 * G[Math.min(K - 1, kk + 1)];   // smooth across frequency: no "musical noise"
    for (let kk = 0; kk < K; kk++) { Gprev[kk] = G[kk]; const g = Gs[kk]; re[kk] *= g; im[kk] *= g; if (kk > 0 && kk < N / 2) { re[N - kk] = re[kk]; im[N - kk] = -im[kk]; } }
    fft(re, im, true);
    for (let i = 0; i < N; i++) { const t = s + i; if (t >= 0 && t < n) out[t] += re[i] / N * HANN[i] / 1.5; }   // hann² at 75% overlap sums to 1.5
    if ((f & 1023) === 0) progress(f / total);
  }
  for (let i = 0; i < n; i++) x[i] = out[i];
}

// ------------------------------------------------------------------ tone + level
function biquad(x, b0, b1, b2, a1, a2) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; } }
function rbj(type, f, sr, q = Math.SQRT1_2, dB = 0) {
  const w = 2 * Math.PI * f / sr, c = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, dB / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
  else { const sq = 2 * Math.sqrt(A) * (sn / 2) * Math.SQRT2;   // low shelf, slope 1
    b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq);
    a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
// Offline we can filter forwards and then backwards ("zero-phase"): the same tone change with no time smear.
function filtfilt(x, c) { biquad(x, ...c); x.reverse(); biquad(x, ...c); x.reverse(); }
function tone(x, sr) {
  filtfilt(x, rbj('hp', 70, sr));                                         // rumble and hum (≈ 4th order once both ways)
  filtfilt(x, rbj('lp', Math.min(8500, sr * 0.45), sr, 0.6));             // soft top: no hiss, no harshness
  filtfilt(x, rbj('shelf', 200, sr, 0, 0.75));                            // a little warmth (0.75 dB each way = 1.5 dB)
}
function level(x, sr) {                    // ≈ −16 LUFS (ungated K-weighting skipped), peak ≤ −1 dBFS
  const B = Math.round(sr * 0.4), ms = [];
  for (let s = 0; s + B <= x.length; s += B) { let e = 0; for (let i = s; i < s + B; i++) e += x[i] * x[i]; ms.push(e / B); }
  const abs = ms.filter(v => v > 1e-5); if (!abs.length) return 1;
  const mean0 = abs.reduce((a, b) => a + b, 0) / abs.length, gated = abs.filter(v => v > mean0 * 0.1);
  const L = 10 * Math.log10(gated.reduce((a, b) => a + b, 0) / gated.length) - 0.691;
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  let g = Math.pow(10, (-16 - L) / 20); if (peak * g > 0.891) g = 0.891 / peak;
  g = Math.min(g, 8);
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return g;
}
