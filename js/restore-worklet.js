// restore-worklet.js — gentle 78 rpm restoration that runs in the AudioWorklet thread.
// Mono in, mono out. Two stages, sample by sample:
//   1. De-click: a 2nd-difference "click detector" against a robust running envelope flags impulsive
//      samples; flagged runs are repaired by Hermite interpolation (gaps up to ~2.5 ms) or softened
//      (longer bursts). A 256-sample look-ahead (~6 ms) lets clicks straddle 128-sample blocks.
//   2. Spectral noise reduction: STFT (1024-point, 75 % overlap, sqrt-Hann), per-bin noise estimate by
//      minimum statistics over ~2 s, Wiener-style gains capped at −13 dB and smoothed in time and
//      frequency (fast attack, slow release) to avoid "musical noise" warble.
//   3. Dynamic hiss filter (DNR-style): a low-pass whose cutoff glides between ~3.5 kHz (quiet passages,
//      where hiss shows) and ~7 kHz (bright, loud passages that mask it), steered by how far the
//      high band sits above its own tracked noise floor.

class Restore78 extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.k = o.k || 3;                                   // click threshold (× recent peak level)
    this.declick = o.declick !== false;
    this.dnr = o.dnr !== false;
    this.nr = o.nr !== false; this.opt = o;
    this.initNR();
    this.L = 256; this.N = 4096; this.mask = this.N - 1;
    this.buf = new Float32Array(this.N); this.flag = new Uint8Array(this.N);
    this.w = 0; this.flagUntil = -1; this.repairedTo = -1;
    this.x1 = 0; this.x2 = 0; this.env = 1e-3; this.runStart = -1;
    this.decay = Math.exp(-1 / (0.02 * sampleRate));                // ~20 ms peak hold
    this.widen = Math.round(sampleRate * 0.00025) + 2;               // grow each click a little
    this.maxGap = Math.round(sampleRate * (o.maxGapMs || 2.5) / 1000);
    this.clicks = 0; this.skipped = 0;
    // DNR state
    const fc = 4000, x = Math.exp(-2 * Math.PI * fc / sampleRate);
    this.ah = x; this.hpX = 0; this.hpY = 0; this.hiEnv = 0;
    this.aEnv = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.floorDb = null; this.cut = 3500; this.z1 = 0; this.z2 = 0;
    this.dmins = new Float32Array(12).fill(Infinity); this.dmi = 0; this.subMin = Infinity; this.subT = 0;   // minimum statistics, 12 × 0.25 s
    this.setLP(3500);
    this.port.onmessage = e => { if (e.data === 'stats') this.port.postMessage({ clicks: this.clicks, skipped: this.skipped, cutoff: this.cut, floorDb: this.floorDb }); };
  }

  initNR() {
    const FN = this.FN = 1024, H = this.H = 256, K = this.K = FN / 2 + 1;
    this.ring = new Float32Array(FN); this.rw = 0; this.acc = new Float32Array(FN); this.pos = 0;
    this.re = new Float32Array(FN); this.im = new Float32Array(FN);
    this.win = new Float32Array(FN); for (let i = 0; i < FN; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / FN));
    this.rev = new Uint16Array(FN); for (let i = 0, bits = Math.log2(FN); i < FN; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cs = new Float32Array(FN / 2); this.sn = new Float32Array(FN / 2);
    for (let i = 0; i < FN / 2; i++) { this.cs[i] = Math.cos(-2 * Math.PI * i / FN); this.sn[i] = Math.sin(-2 * Math.PI * i / FN); }
    this.S = new Float32Array(K); this.Gs = new Float32Array(K).fill(1); this.g2 = new Float32Array(K);
    this.SUBS = 8; this.SUBLEN = 48;                   // 8 × 48 hops ≈ 2.2 s of history
    this.mins = new Float32Array(this.SUBS * K).fill(Infinity); this.subMinB = new Float32Array(K).fill(Infinity);
    this.frames = 0; this.sub = 0;
    this.gMin = this.opt.gMin || 0.22; this.over = this.opt.over || 2.0; this.bias = 1.6;   // at most −13 dB of reduction
  }
  fft(re, im) {                                         // in-place radix-2, size FN
    const n = this.FN, rev = this.rev;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
        const wr = this.cs[k * step], wi = this.sn[k * step], a = i + k, b = a + half;
        const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
      }
    }
  }
  nrFrame() {
    const { FN, H, K, re, im, win, ring, S, Gs, g2 } = this;
    for (let i = 0; i < FN; i++) { re[i] = ring[(this.rw + i) & (FN - 1)] * win[i]; im[i] = 0; }
    let energy = 0; for (let i = 0; i < FN; i++) energy += re[i] * re[i];
    const silent = energy < FN * 1e-10;                 // digital silence (between tracks / while loading)
    this.fft(re, im);
    if (!silent) this.frames++;                         // …must not teach the noise estimate that "noise = 0"
    const warm = this.frames > 40;
    for (let k = 0; k < K; k++) {
      const P = re[k] * re[k] + im[k] * im[k];
      S[k] = this.frames <= 1 ? P : 0.7 * S[k] + 0.3 * P;
      if (!silent && S[k] < this.subMinB[k]) this.subMinB[k] = S[k];
    }
    if (!silent && this.frames % this.SUBLEN === 0) {
      this.mins.set(this.subMinB, this.sub * K); this.subMinB.fill(Infinity); this.sub = (this.sub + 1) % this.SUBS;
    }
    for (let k = 0; k < K; k++) {
      let nmin = this.subMinB[k];
      for (let j = 0; j < this.SUBS; j++) { const v = this.mins[j * K + k]; if (v < nmin) nmin = v; }
      const noise = nmin * this.bias;
      let G = warm ? 1 - this.over * noise / (S[k] + 1e-12) : 1;
      if (G < this.gMin) G = this.gMin; if (G > 1) G = 1;
      Gs[k] = G > Gs[k] ? G : 0.75 * Gs[k] + 0.25 * G;   // open fast, close slowly
    }
    for (let k = 0; k < K; k++) g2[k] = 0.25 * Gs[k > 0 ? k - 1 : k] + 0.5 * Gs[k] + 0.25 * Gs[k < K - 1 ? k + 1 : k];
    for (let k = 0; k < K; k++) { re[k] *= g2[k]; im[k] *= g2[k]; if (k > 0 && k < FN / 2) { re[FN - k] *= g2[k]; im[FN - k] *= g2[k]; } }
    for (let i = 0; i < FN; i++) im[i] = -im[i];          // inverse FFT via conjugation
    this.fft(re, im);
    const acc = this.acc; acc.copyWithin(0, H); acc.fill(0, FN - H);
    const sc = 0.5 / FN;                                  // sqrt-Hann² = Hann; Hann at hop N/4 sums to 2
    for (let i = 0; i < FN; i++) acc[i] += re[i] * win[i] * sc;
  }

  setLP(f) {                                            // RBJ low-pass, Q = 0.707
    const w0 = 2 * Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate, c = Math.cos(w0), al = Math.sin(w0) / (2 * 0.7071);
    const a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }

  repair(s, e) {                                        // fill buf[s..e] (absolute indices)
    const m = this.mask, b = this.buf, len = e - s + 1;
    const pm = b[(s - 2) & m], p0 = b[(s - 1) & m], p1 = b[(e + 1) & m], pp = b[(e + 2) & m];
    if (len <= this.maxGap) {
      const n = len + 1, m0 = (p0 - pm) * 0.5 * n, m1 = (pp - p1) * 0.5 * n;
      for (let j = 1; j <= len; j++) {
        const t = j / n, t2 = t * t, t3 = t2 * t;
        b[(s + j - 1) & m] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
      }
      this.clicks++;
    } else this.skipped++;                              // too long to be a click: it's music (an attack) — leave it alone
  }

  process(inputs, outputs) {          // never let an error silence the music: fall back to pass-through
    if (!this.broken) {
      try { return this.run(inputs, outputs); }
      catch (e) { this.broken = true; this.port.postMessage({ error: String(e && e.message || e) }); }
    }
    const inp = inputs[0] && inputs[0][0];
    for (const ch of outputs[0]) { if (inp) ch.set(inp); else ch.fill(0); }
    return true;
  }

  run(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0], out = outputs[0][0];
    const n = out.length, m = this.mask, L = this.L;
    for (let k = 0; k < n; k++) {
      const x = inp ? inp[k] : 0, w = this.w, i = w & m;
      this.buf[i] = x; this.flag[i] = w <= this.flagUntil ? 1 : 0;
      // --- detect
      const hp = x - 2 * this.x1 + this.x2, a = Math.abs(hp);
      // A click is a spike far above the loudest spikes of the last ~20 ms. Repeating musical spikes
      // (every cycle of a bright tone) stay inside that peak level, so they are not mistaken for clicks.
      const inClick = w <= this.flagUntil;
      if (this.declick && a > this.k * this.env + 2e-3) {
        if (!inClick) this.runStart = w;
        for (let j = w - 1 - this.widen; j <= w; j++) this.flag[j & m] = 1;
        this.flagUntil = w + this.widen;
      }
      if (!(w <= this.flagUntil) || w - this.runStart > this.maxGap) this.env = Math.max(this.env * this.decay, a);
      else this.env *= this.decay;
      this.x2 = this.x1; this.x1 = x;
      // --- output the sample from L samples ago (repairing it first if it is part of a click)
      const r = w - L; let y = 0;
      if (r >= 2) {
        const ri = r & m;
        if (this.flag[ri] && r > this.repairedTo) {
          let e = r;
          while (e + 3 <= w && this.flag[(e + 1) & m] && e - r < L - 8) e++;
          this.repair(r, e); this.repairedTo = e;
        }
        y = this.buf[ri];
      }
      // --- spectral noise reduction (adds FN samples of delay)
      if (this.nr) {
        this.ring[this.rw] = y; this.rw = (this.rw + 1) & (this.FN - 1);
        y = this.acc[this.pos];
        if (++this.pos === this.H) { this.pos = 0; this.nrFrame(); }
      }
      // --- dynamic hiss filter
      if (this.dnr) {
        this.hpY = this.ah * (this.hpY + y - this.hpX); this.hpX = y;
        this.hiEnv += (this.hpY * this.hpY - this.hiEnv) * this.aEnv;
        const o = this.b0 * y + this.z1;
        this.z1 = this.b1 * y - this.a1 * o + this.z2;
        this.z2 = this.b2 * y - this.a2 * o;
        y = o;
      }
      out[k] = y;
      this.w++;
    }
    if (this.dnr) {                                     // once per block: steer the cutoff
      const dt = n / sampleRate, hiDb = 10 * Math.log10(this.hiEnv + 1e-12);
      // noise floor = quietest the high band has been in the last ~3 s (hiss never goes away; music does)
      if (hiDb > -100) { this.subMin = Math.min(this.subMin, hiDb); this.subT += dt; }   // ignore digital silence
      if (this.subT >= 0.25) { this.dmins[this.dmi] = this.subMin; this.dmi = (this.dmi + 1) % this.dmins.length; this.subMin = Infinity; this.subT = 0; }
      let fl = this.subMin; for (let j = 0; j < this.dmins.length; j++) if (this.dmins[j] < fl) fl = this.dmins[j];
      this.floorDb = fl;
      const open = Math.max(0, Math.min(1, (hiDb - this.floorDb - 4) / 14));
      const target = 3500 * Math.pow(2, open);
      this.cut += (target - this.cut) * Math.min(1, dt / 0.06);
      this.setLP(this.cut);
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('restore-78', Restore78);
