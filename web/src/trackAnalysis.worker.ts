/**
 * Tempo, beat phase and key for a background track, off the main thread.
 * Input: mono samples at a known rate. Output: bpm, the time of a beat, and a
 * key (pitch class + minor/major).
 *
 *  - tempo: spectral flux onset envelope, autocorrelated over 70–180 bpm
 *    (with a gentle preference for 90–150 to settle half/double ambiguity)
 *  - phase: fold the envelope on the beat period, take the strongest spot
 *  - key: a chromagram correlated against Krumhansl major/minor profiles
 */

export interface TrackAnalysis { bpm: number; offset: number; root: number; minor: boolean }

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function analyse(samples: Float32Array, rate: number): TrackAnalysis {
  // ── onset envelope (spectral flux, 1024-sample frames, 512 hop) ──
  const N = 1024, HOP = 512;
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP));
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float32Array(N), im = new Float32Array(N);
  let prev = new Float32Array(N / 2);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = samples[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(N / 2);
    let sum = 0;
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.log1p(Math.hypot(re[k], im[k]) * 10);
      const d = mag[k] - prev[k];
      if (d > 0) sum += k < 120 ? d * 1.5 : d;       // lows (kicks, bass) count a bit more
    }
    flux[f] = sum;
    prev = mag;
  }
  // remove the slow trend so only onsets remain
  const env = new Float32Array(frames);
  const W = 16;
  for (let f = 0; f < frames; f++) {
    let m = 0, c = 0;
    for (let k = Math.max(0, f - W); k < Math.min(frames, f + W); k++) { m += flux[k]; c++; }
    env[f] = Math.max(0, flux[f] - m / c);
  }

  // ── tempo: autocorrelation over plausible beat periods ──
  const fps = rate / HOP;
  let bestLag = 0, bestScore = -Infinity;
  const scores = new Map<number, number>();
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    const L = Math.floor(lag), frac = lag - L;
    let s = 0;
    for (let f = 0; f + L + 1 < frames; f++) s += env[f] * (env[f + L] * (1 - frac) + env[f + L + 1] * frac);
    // prefer the middle of the range, where most tracks sit
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.55, 2));
    const score = (s / Math.max(1, frames - L)) * (0.6 + 0.4 * prior);
    scores.set(bpm, score);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // refine: compare onsets four and eight beats apart, where a small tempo error adds up, in 0.05 bpm steps
  const coarse = 60 * fps / bestLag;
  const at = (lagF: number) => {
    const L = Math.floor(lagF), frac = lagF - L;
    let s = 0;
    for (let f = 0; f + L + 1 < frames; f++) s += env[f] * (env[f + L] * (1 - frac) + env[f + L + 1] * frac);
    return s / Math.max(1, frames - L);
  };
  let bpm = coarse, bestFine = -Infinity;
  for (let b = coarse - 1.5; b <= coarse + 1.5; b += 0.05) {
    const beatF = (60 / b) * fps;
    const s = at(beatF * 4) + at(beatF * 8) * 0.7 + at(beatF) * 0.3;
    if (s > bestFine) { bestFine = s; bpm = b; }
  }
  bpm = Math.round(bpm * 10) / 10;
  void scores;

  // ── phase: where in the period onsets pile up ──
  const period = (60 / bpm) * fps;
  const bins = 48, fold = new Float32Array(bins);
  for (let f = 0; f < frames; f++) fold[Math.floor(((f % period) / period) * bins) % bins] += env[f];
  let bestBin = 0;
  for (let b = 1; b < bins; b++) if (fold[b] > fold[bestBin]) bestBin = b;
  const offset = ((bestBin + 0.5) / bins) * period / fps + N / 2 / rate;

  // ── key: chromagram from larger frames ──
  const K = 8192, chroma = new Float64Array(12);
  const kre = new Float32Array(K), kim = new Float32Array(K);
  const kwin = new Float32Array(K).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / K));
  for (let o = 0; o + K < samples.length; o += K * 2) {
    for (let i = 0; i < K; i++) { kre[i] = samples[o + i] * kwin[i]; kim[i] = 0; }
    fft(kre, kim);
    for (let k = 1; k < K / 2; k++) {
      const hz = (k * rate) / K;
      if (hz < 55 || hz > 1760) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += Math.hypot(kre[k], kim[k]);
    }
  }
  const corr = (profile: number[], root: number) => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 12; i++) { xs.push(chroma[(i + root) % 12]); ys.push(profile[i]); }
    const mx = xs.reduce((a, b) => a + b) / 12, my = ys.reduce((a, b) => a + b) / 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return num / Math.sqrt(dx * dy || 1);
  };
  let root = 9, minor = true, bestKey = -Infinity;
  for (let r = 0; r < 12; r++) {
    const a = corr(MAJOR, r), b = corr(MINOR, r);
    if (a > bestKey) { bestKey = a; root = r; minor = false; }
    if (b > bestKey) { bestKey = b; root = r; minor = true; }
  }
  return { bpm, offset, root, minor };
}

self.onmessage = (e: MessageEvent<{ samples: Float32Array; rate: number }>) => {
  try {
    (self as unknown as Worker).postMessage({ ok: true, result: analyse(e.data.samples, e.data.rate) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
