import type { AudioEngine } from '../audio';

/**
 * A mixer channel: dry, reverb-send and echo-send gains that always move
 * together, so fading a bus also fades its reverb and echo tails. Buses nest
 * (a style's bus feeds the music bus, which feeds the engine).
 */
export class Bus {
  readonly dry: GainNode;
  readonly rev: GainNode;
  readonly echo: GainNode;
  private level: number;

  constructor(ctx: AudioContext, dry: AudioNode, rev: AudioNode, echo: AudioNode, level = 1) {
    this.level = level;
    this.dry = ctx.createGain();
    this.rev = ctx.createGain();
    this.echo = ctx.createGain();
    for (const [g, to] of [[this.dry, dry], [this.rev, rev], [this.echo, echo]] as const) {
      g.gain.value = level;
      g.connect(to);
    }
  }

  static under(ctx: AudioContext, parent: Bus, level = 1): Bus {
    return new Bus(ctx, parent.dry, parent.rev, parent.echo, level);
  }

  /** Glide to a level; `tc` is the time constant (about a third of the fade). */
  set(level: number, t: number, tc = 0.3): void {
    if (Math.abs(level - this.level) < 0.002) return;
    this.level = level;
    for (const g of [this.dry, this.rev, this.echo]) g.gain.setTargetAtTime(level, t, tc);
  }
}

export interface ToneOpts {
  type?: OscillatorType;
  g: number;               // peak gain
  a?: number;              // attack (s)
  h?: number;              // hold (s)
  r: number;               // release (s)
  pan?: number;
  rev?: number;            // reverb send
  echo?: number;           // echo send
  detune?: number;         // > 0: a second oscillator this many cents apart (chorus)
  glide?: number;          // pitch ratio reached by the end
  lp?: number;             // low-pass cutoff
  lpTo?: number;           // cutoff reached by the end of the release
  q?: number;
}

export interface NoiseOpts {
  type: BiquadFilterType;
  f: number;
  q?: number;
  fTo?: number;
  g: number;
  a?: number;
  h?: number;
  r: number;
  pan?: number;
  rev?: number;
  echo?: number;
  rate?: number;
}

/** A sustained source that can be faded and stopped (wind, rain, drones). */
export interface Bed {
  level: GainNode;
  stop(t: number): void;
}

const clampPan = (p: number) => Math.max(-1, Math.min(1, p));

/**
 * Synth building blocks shared by theme scores, on top of the engine's graph.
 * Every note is a handful of short-lived nodes; `budget` caps how many
 * oscillators and noise sources are sounding so a busy night can't choke a Pi.
 */
export class Synth {
  readonly ctx: AudioContext;
  private noiseBuf: AudioBuffer;
  live = 0;
  budget = 110;

  constructor(readonly e: AudioEngine) {
    this.ctx = e.ctx;
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** True when a non-essential note should be skipped. */
  busy(extra = 0): boolean { return this.live + extra > this.budget; }

  // ── primitives ───────────────────────────────────────────────────────────
  gain(v: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  osc(type: OscillatorType, f: number, t: number, end: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    this.run(o, t, end);
    return o;
  }

  noise(t: number, end: number, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(t, Math.random() * 1.8);
    src.stop(end + 0.05);
    this.live++;
    src.onended = () => { this.live--; };
    return src;
  }

  private run(o: OscillatorNode, t: number, end: number): void {
    o.start(t);
    o.stop(end + 0.05);
    this.live++;
    o.onended = () => { this.live--; };
  }

  /** Silent → peak (attack) → hold → exponential release. Null if too quiet to hear. */
  env(t: number, peak: number, a: number, h: number, r: number): GainNode | null {
    if (!(peak > 0.0005)) return null;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    if (a < 0.04) g.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.001, a));
    else g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    return g;
  }

  /** Pan and send a finished voice into a bus. */
  out(node: AudioNode, bus: Bus, pan = 0, rev = 0, echo = 0): void {
    let p = node;
    if (Math.abs(pan) > 0.02) {                      // centred voices skip the panner (cheaper on a Pi)
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = clampPan(pan);
      node.connect(sp);
      p = sp;
    }
    p.connect(bus.dry);
    if (rev > 0) p.connect(this.gain(rev)).connect(bus.rev);
    if (echo > 0) p.connect(this.gain(echo)).connect(bus.echo);
  }

  // ── generic voices ───────────────────────────────────────────────────────
  tone(bus: Bus, t: number, f: number, o: ToneOpts): void {
    const a = o.a ?? 0.005, h = o.h ?? 0, end = t + a + h + o.r;
    const env = this.env(t, o.g, a, h, o.r);
    if (!env || f <= 0) return;
    const type = o.type ?? 'sine';
    const oscs = [this.osc(type, f, t, end)];
    if (o.detune) {
      oscs[0].detune.value = -o.detune / 2;
      oscs.push(this.osc(type, f, t, end, o.detune / 2));
    }
    let head: AudioNode = env;
    if (o.lp || type === 'sawtooth' || type === 'square') {
      const cut = o.lp ?? Math.min(9000, f * 6);
      const lp = this.filter('lowpass', cut, o.q ?? 0.7);
      if (o.lpTo) lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), end);
      lp.connect(env);
      head = lp;
    }
    const mix = oscs.length > 1 ? this.gain(0.6) : null;
    for (const osc of oscs) {
      if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * o.glide), end);
      if (mix) osc.connect(mix); else osc.connect(head);
    }
    if (mix) mix.connect(head);
    this.out(env, bus, o.pan, o.rev, o.echo);
  }

  noiseHit(bus: Bus, t: number, o: NoiseOpts): void {
    const a = o.a ?? 0.002, h = o.h ?? 0, end = t + a + h + o.r;
    const env = this.env(t, o.g, a, h, o.r);
    if (!env) return;
    const src = this.noise(t, end, o.rate ?? 1);
    const f = this.filter(o.type, o.f, o.q ?? 0.8);
    if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, end);
    src.connect(f).connect(env);
    this.out(env, bus, o.pan, o.rev, o.echo);
  }

  // ── instruments ──────────────────────────────────────────────────────────
  /** Fingerpicked nylon-ish string: bright attack that closes quickly. */
  pluck(bus: Bus, t: number, f: number, g: number, pan = 0, rev = 0.3): void {
    this.tone(bus, t, f, { type: 'triangle', g, r: 1.5, lp: 3200, lpTo: 420, q: 1.2, pan, rev });
    this.tone(bus, t, f * 2, { g: g * 0.22, r: 0.5, pan });
    this.noiseHit(bus, t, { type: 'bandpass', f: 2800, q: 1.4, g: g * 0.25, r: 0.025, pan });
  }

  /** Slightly out-of-tune upright piano. */
  piano(bus: Bus, t: number, f: number, g: number, pan = 0, echo = 0.35): void {
    this.tone(bus, t, f, { g, r: 3, detune: 9, pan, rev: 0.45, echo });
    this.tone(bus, t, f * 2, { g: g * 0.32, r: 1.3, pan, rev: 0.3 });
    this.tone(bus, t, f * 3, { type: 'triangle', g: g * 0.08, r: 0.45, pan });
  }

  /** Tinny music box: bright, short, slightly inharmonic. */
  musicBox(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { g, r: 1.8, pan, rev: 0.55, echo: 0.45 });
    this.tone(bus, t, f * 3.02, { g: g * 0.22, r: 0.5, pan });
  }

  /** Cold bell (inharmonic partials). */
  bell(bus: Bus, t: number, f: number, g: number, pan = 0, echo = 0.3): void {
    this.tone(bus, t, f, { g, r: 2.4, pan, rev: 0.55, echo });
    this.tone(bus, t, f * 2.76, { g: g * 0.33, r: 1.1, pan, rev: 0.4 });
    this.tone(bus, t, f * 5.4, { g: g * 0.12, r: 0.45, pan });
  }

  /** Glass harmonica: slow bloom, long ring. */
  glass(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { g, a: 0.35, h: 0.3, r: 3, pan, rev: 0.7, echo: 0.4 });
    this.tone(bus, t, f * 2, { g: g * 0.25, a: 0.4, r: 1.6, pan, rev: 0.5 });
  }

  /** Analog synth pulse for ostinatos: resonant filter snaps shut. */
  arp(bus: Bus, t: number, f: number, g: number, cutoff: number, pan = 0): void {
    this.tone(bus, t, f, { type: 'square', g, r: 0.24, lp: cutoff, lpTo: cutoff * 0.35, q: 6, pan, rev: 0.2, echo: 0.22 });
  }

  bassPulse(bus: Bus, t: number, f: number, g: number): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, r: 0.3, lp: 700, lpTo: 140, q: 2 });
  }

  /** Warm detuned saw pad on a chord. */
  pad(bus: Bus, t: number, freqs: number[], g: number, hold: number, cutoff = 700): void {
    if (this.busy(freqs.length * 2)) return;
    freqs.forEach((f, i) => this.tone(bus, t, f, {
      type: 'sawtooth', g, a: 1.4, h: hold, r: 2.4, detune: 14, lp: cutoff, q: 0.5,
      pan: (i - (freqs.length - 1) / 2) * 0.5, rev: 0.5,
    }));
  }

  /** Wordless "aah" choir: saws through two vowel formants. */
  choir(bus: Bus, t: number, freqs: number[], g: number, hold: number): void {
    if (this.busy(freqs.length * 3)) return;
    freqs.forEach((f, i) => {
      const a = 1.8, r = 2.8, end = t + a + hold + r;
      const env = this.env(t, g, a, hold, r);
      if (!env) return;
      const mix = this.gain(1);
      for (const det of [-12, 12]) this.osc('sawtooth', f, t, end, det).connect(mix);
      const f1 = this.filter('bandpass', 720, 6), f2 = this.filter('bandpass', 1150, 8);
      mix.connect(f1).connect(env);
      mix.connect(f2).connect(this.gain(0.7)).connect(env);
      this.out(env, bus, (i - 1) * 0.6, 0.8);
    });
  }

  /** Low bowed string. */
  cello(bus: Bus, t: number, f: number, g: number, hold: number, pan = 0): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.9, h: hold, r: 1.8, detune: 8, lp: 900, q: 0.8, pan, rev: 0.5 });
  }

  /** Slow distant swell (ambient). */
  swell(bus: Bus, t: number, f: number, g: number, dur: number, pan = 0): void {
    this.tone(bus, t, f, { g, a: dur * 0.45, h: dur * 0.1, r: dur * 0.6, pan, rev: 0.85, echo: 0.3 });
    this.tone(bus, t, f * 2.01, { type: 'triangle', g: g * 0.25, a: dur * 0.5, r: dur * 0.4, pan, rev: 0.8 });
  }

  heart(bus: Bus, t: number, g: number): void {
    this.tone(bus, t, 78, { g, r: 0.24, glide: 0.55 });
    this.tone(bus, t + 0.21, 70, { g: g * 0.62, r: 0.26, glide: 0.55 });
  }

  tom(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { g, r: 0.5, glide: 0.6, pan, rev: 0.4 });
    this.noiseHit(bus, t, { type: 'bandpass', f: f * 4, q: 1, g: g * 0.25, r: 0.06, pan });
  }

  boom(bus: Bus, t: number, g: number): void {
    this.tone(bus, t, 62, { g, a: 0.008, r: 1.7, glide: 0.5, rev: 0.5 });
    this.noiseHit(bus, t, { type: 'lowpass', f: 260, g: g * 0.5, r: 0.9, rev: 0.6 });
  }

  // ── drum machine (80s) ──
  kick(bus: Bus, t: number, g: number): void {
    this.tone(bus, t, 120, { g, a: 0.002, r: 0.32, glide: 0.35 });
    this.noiseHit(bus, t, { type: 'lowpass', f: 900, g: g * 0.15, r: 0.02 });
  }

  /** A big 80s snare: short crack into a huge, abruptly cut reverb. */
  snare(bus: Bus, t: number, g: number, pan = 0): void {
    this.noiseHit(bus, t, { type: 'bandpass', f: 1800, q: 0.7, g, a: 0.001, h: 0.05, r: 0.16, pan, rev: 1 });
    this.tone(bus, t, 185, { type: 'triangle', g: g * 0.5, a: 0.001, r: 0.12, glide: 0.8, pan });
  }

  hat(bus: Bus, t: number, g: number, pan = 0, open = false): void {
    this.noiseHit(bus, t, { type: 'highpass', f: 7500, q: 0.6, g, a: 0.001, r: open ? 0.22 : 0.035, pan });
  }

  /** Brassy detuned saw lead with a slow vibrato. */
  sawLead(bus: Bus, t: number, f: number, g: number, len: number, pan = 0): void {
    if (this.busy(4)) return;
    const a = 0.03, h = len, r = 0.5, end = t + a + h + r;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const lp = this.filter('lowpass', 2600, 1.5);
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(1100, end);
    const vib = this.osc('sine', 5.5, t, end);
    const depth = this.gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(14, t + Math.min(0.6, h));
    vib.connect(depth);
    for (const det of [-10, 10]) {
      const o = this.osc('sawtooth', f, t, end, det);
      depth.connect(o.detune);
      o.connect(this.gain(0.5)).connect(lp);
    }
    lp.connect(env);
    this.out(env, bus, pan, 0.45, 0.3);
  }

  // ── dead west ──
  /** Banjo: very bright pluck with a fast, twangy decay. */
  banjo(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.001, r: 0.45, lp: 5200, lpTo: 700, q: 2.5, pan, rev: 0.3 });
    this.tone(bus, t, f * 2, { type: 'triangle', g: g * 0.3, r: 0.18, pan });
    this.noiseHit(bus, t, { type: 'bandpass', f: 4200, q: 2, g: g * 0.35, r: 0.015, pan });
  }

  /** Bowed fiddle: rosin scrape on the attack, swelling vibrato. */
  fiddle(bus: Bus, t: number, f: number, g: number, len: number, pan = 0): void {
    if (this.busy(4)) return;
    const a = 0.35, h = len, r = 0.8, end = t + a + h + r;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const o = this.osc('sawtooth', f, t, end);
    const vib = this.osc('sine', 5.2, t, end);
    const depth = this.gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(22, t + a + Math.min(0.8, h));
    vib.connect(depth).connect(o.detune);
    const body = this.filter('bandpass', 1200, 1.2), air = this.filter('lowpass', 3800, 0.7);
    o.connect(body).connect(env);
    o.connect(air).connect(this.gain(0.35)).connect(env);
    this.noiseHit(bus, t, { type: 'bandpass', f: 3000, q: 1, g: g * 0.25, a: 0.05, r: 0.25, pan });
    this.out(env, bus, pan, 0.5);
  }

  /** Slide guitar: a note that glides in from below. */
  slide(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f * 0.94, { type: 'triangle', g, a: 0.01, h: 0.15, r: 1.6, glide: 1 / 0.94, lp: 2400, lpTo: 900, pan, rev: 0.5, echo: 0.35 });
    this.tone(bus, t, f * 2 * 0.94, { g: g * 0.2, a: 0.01, r: 0.6, glide: 1 / 0.94, pan });
  }

  /** Boot stomp on a wooden porch. */
  stomp(bus: Bus, t: number, g: number): void {
    this.tone(bus, t, 95, { g, a: 0.002, r: 0.2, glide: 0.5, rev: 0.3 });
    this.noiseHit(bus, t, { type: 'bandpass', f: 600, q: 1, g: g * 0.35, r: 0.07, rev: 0.3 });
  }

  // ── broken lullaby ──
  /** A music-box note on a warped tape: `warp` in cents drifts slowly. */
  warpedBox(bus: Bus, t: number, f: number, g: number, warp: number, pan = 0): void {
    const k = Math.pow(2, warp / 1200);
    this.tone(bus, t, f * k, { g, r: 2.2, glide: Math.pow(2, -8 / 1200), pan, rev: 0.6, echo: 0.4 });
    this.tone(bus, t, f * k * 3.01, { g: g * 0.2, r: 0.6, pan });
    this.tone(bus, t, f * k * 5.9, { g: g * 0.06, r: 0.2, pan });
  }

  /** Breathy whisper swell. */
  whisper(bus: Bus, t: number, g: number, pan = 0): void {
    this.noiseHit(bus, t, { type: 'bandpass', f: 2200, fTo: 1400, q: 4, g, a: 0.8, h: 0.2, r: 1.2, pan, rev: 0.9, rate: 0.8 });
  }

  // ── space ──
  /** Pipe organ: stacked octaves with a slow breath of air on the attack. */
  organ(bus: Bus, t: number, f: number, g: number, hold: number, pan = 0): void {
    if (this.busy(5)) return;
    const a = 0.06, r = 0.45;
    for (const [m, k] of [[0.5, 0.5], [1, 1], [2, 0.55], [4, 0.22], [3, 0.12]] as const) {
      this.tone(bus, t, f * m, { g: g * k, a, h: hold, r, pan, rev: 0.75, echo: 0.1 });
    }
  }

  /** Chiptune square: raw and bright, no filter sweep. */
  chip(bus: Bus, t: number, f: number, g: number, len: number, pan = 0, slide = 0): void {
    this.tone(bus, t, f, { type: 'square', g, a: 0.002, h: len, r: 0.04, lp: 7000, glide: slide || undefined, pan, echo: 0.15 });
  }

  /** Chip noise drum: `snap` short and high (snare/hat), else a thud. */
  chipDrum(bus: Bus, t: number, g: number, snap: boolean): void {
    if (snap) this.noiseHit(bus, t, { type: 'highpass', f: 2500, g, a: 0.001, r: 0.07, rate: 0.5 });
    else this.tone(bus, t, 160, { type: 'square', g: g * 0.8, a: 0.001, r: 0.09, glide: 0.3, lp: 1200 });
  }

  /** Sharp string stab (for ostinatos): detuned saws, quick decay. */
  strings(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.004, r: 0.16, detune: 16, lp: 2600, lpTo: 900, q: 0.8, pan, rev: 0.35 });
  }

  /** A big drum struck with a mallet. */
  taiko(bus: Bus, t: number, g: number, pan = 0): void {
    this.tone(bus, t, 70, { g, a: 0.003, r: 0.7, glide: 0.7, pan, rev: 0.6 });
    this.noiseHit(bus, t, { type: 'lowpass', f: 700, g: g * 0.4, a: 0.002, r: 0.12, pan, rev: 0.6 });
  }

  /** Pulsar ping: a pure tone with a long echo tail. */
  ping(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.tone(bus, t, f, { g, a: 0.003, r: 0.5, pan, rev: 0.6, echo: 0.6 });
  }

  /** Defense laser: a bright tone diving down to the note. */
  zap(bus: Bus, t: number, f: number, g: number, pan: number): void {
    this.tone(bus, t, f * 4, { type: 'square', g: g * 0.6, a: 0.001, r: 0.16, glide: 0.25, lp: 6000, lpTo: 900, pan, rev: 0.25, echo: 0.2 });
    this.tone(bus, t, f * 2, { g, a: 0.001, r: 0.22, glide: 0.5, pan, rev: 0.3 });
  }

  /** Explosion: a noise burst that closes down, a sub thump and a metal ring in key. */
  blast(bus: Bus, t: number, g: number, pan: number, ring: number, big = false): void {
    const len = big ? 1.3 : 0.6;
    this.noiseHit(bus, t, { type: 'lowpass', f: big ? 5000 : 3500, fTo: 180, q: 0.6, g: g * 0.9, a: 0.002, r: len, pan, rev: 0.55 });
    this.tone(bus, t, big ? 90 : 120, { g: g * 0.9, a: 0.002, r: big ? 0.9 : 0.35, glide: 0.35, pan });
    this.tone(bus, t, ring, { type: 'triangle', g: g * 0.08, a: 0.003, r: big ? 1.4 : 0.6, pan, rev: 0.6, echo: 0.2 });
    if (big) this.tone(bus, t, ring * 1.5, { g: g * 0.05, a: 0.003, r: 1.1, pan, rev: 0.6 });
  }

  /** Warp-in whoosh: filtered noise sweeping down onto a soft tone. */
  warp(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    this.noiseHit(bus, t, { type: 'bandpass', f: 4200, fTo: 300, q: 4, g, a: 0.25, r: 0.6, pan, rev: 0.6 });
    this.tone(bus, t + 0.3, f, { g: g * 0.6, a: 0.05, h: 0.2, r: 1.4, pan, rev: 0.6, echo: 0.3 });
  }

  /** Rocket launch: a rising, growling engine. */
  launch(bus: Bus, t: number, f: number, g: number, pan: number): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.3, h: 0.3, r: 0.6, glide: 2, lp: 900, lpTo: 2400, q: 3, pan, rev: 0.4 });
    this.noiseHit(bus, t, { type: 'bandpass', f: 600, fTo: 2200, q: 1.5, g: g * 0.6, a: 0.3, h: 0.3, r: 0.5, pan, rev: 0.4 });
  }

  /** Red alert: two alternating tones, soft-edged. */
  alert(bus: Bus, t: number, f: number, g: number, beat: number): void {
    this.tone(bus, t, f, { type: 'triangle', g, a: 0.03, h: beat * 0.35, r: 0.12, lp: 2200, rev: 0.3 });
    this.tone(bus, t + beat * 0.5, f * 0.84, { type: 'triangle', g: g * 0.9, a: 0.03, h: beat * 0.35, r: 0.12, lp: 2200, rev: 0.3 });
  }

  /** Shockwave: a low tone that sweeps a filter open and shut. */
  shock(bus: Bus, t: number, f: number, g: number): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.01, h: 0.1, r: 1.1, lp: 1800, lpTo: 90, q: 6, rev: 0.6 });
    this.tone(bus, t, f / 2, { g: g * 0.8, a: 0.01, r: 0.9, glide: 0.7 });
  }

  /** Radio static crackle. */
  crackle(bus: Bus, t: number, g: number, pan: number): void {
    this.noiseHit(bus, t, { type: 'highpass', f: 3500, g, a: 0.002, r: 0.04 + Math.random() * 0.06, pan, rate: 0.4 + Math.random() * 0.6 });
  }

  // ── street ──
  private driveCurve: Float32Array | null = null;
  /** A soft-clipping curve for distorted guitars. */
  private drive(): Float32Array {
    if (!this.driveCurve) {
      const n = 2048, k = 40;
      this.driveCurve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        this.driveCurve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
    }
    return this.driveCurve;
  }

  /** Distorted power chord (root + fifth + octave); `mute` palm-mutes it short. */
  guitar(bus: Bus, t: number, f: number, g: number, mute: boolean, pan = 0): void {
    if (this.busy(4)) return;
    const a = 0.004, h = mute ? 0.05 : 0.35, r = mute ? 0.08 : 0.5, end = t + a + h + r;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const pre = this.gain(0.5);
    for (const [m, det] of [[1, -6], [1.498, 5], [2, 0]] as const) this.osc('sawtooth', f * m, t, end, det).connect(pre);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.drive() as Float32Array<ArrayBuffer>;
    shaper.oversample = '2x';
    const cab = this.filter('lowpass', mute ? 1400 : 2600, 0.9);
    const body = this.filter('peaking', 700, 1);
    body.gain.value = 4;
    pre.connect(shaper).connect(body).connect(cab).connect(env);
    this.out(env, bus, pan, 0.2);
  }

  /** Reese bass: two detuned saws breathing through a low-pass. */
  reese(bus: Bus, t: number, f: number, g: number, hold: number): void {
    this.tone(bus, t, f, { type: 'sawtooth', g, a: 0.02, h: hold, r: 0.3, detune: 22, lp: 420, lpTo: 900, q: 2 });
    this.tone(bus, t, f / 2, { g: g * 0.8, a: 0.02, h: hold, r: 0.3 });
  }

  /** 808: a long sine kick that slides down onto the note. */
  eight08(bus: Bus, t: number, f: number, g: number, len: number, slideFrom = 0): void {
    this.tone(bus, t, slideFrom || f * 1.6, { g, a: 0.003, h: len * 0.5, r: len, glide: f / (slideFrom || f * 1.6) });
    this.tone(bus, t, f * 2, { type: 'triangle', g: g * 0.15, a: 0.003, r: 0.12, lp: 900 });
  }

  /** Supersaw stab: five detuned saws. */
  supersaw(bus: Bus, t: number, f: number, g: number, len: number, pan = 0): void {
    if (this.busy(6)) return;
    const a = 0.005, r = 0.25, end = t + a + len + r;
    const env = this.env(t, g, a, len, r);
    if (!env) return;
    const lp = this.filter('lowpass', 5200, 0.6);
    for (const det of [-24, -11, 0, 11, 24]) this.osc('sawtooth', f, t, end, det).connect(this.gain(0.25)).connect(lp);
    lp.connect(env);
    this.out(env, bus, pan, 0.35, 0.25);
  }

  /** Car horn: two square tones a fifth apart. */
  horn(bus: Bus, t: number, f: number, g: number, pan: number): void {
    for (const m of [1, 1.5]) this.tone(bus, t, f * m, { type: 'square', g: g * 0.5, a: 0.01, h: 0.22, r: 0.08, lp: 1800, pan, rev: 0.2 });
  }

  /** Metal crash: a blast plus scattered clangs. */
  crash(bus: Bus, t: number, g: number, pan: number, ring: number): void {
    this.blast(bus, t, g, pan, ring, false);
    for (const [dt, m] of [[0.04, 2.1], [0.11, 3.3], [0.19, 2.7]] as const) {
      this.tone(bus, t + dt, ring * m, { type: 'triangle', g: g * 0.06, a: 0.002, r: 0.35, pan: pan + (Math.random() - 0.5) * 0.6, rev: 0.4 });
    }
    this.noiseHit(bus, t + 0.05, { type: 'highpass', f: 3000, g: g * 0.3, a: 0.002, r: 0.3, pan, rev: 0.4 });
  }

  /** Turbo blow-off: a short hiss that falls away. */
  blowoff(bus: Bus, t: number, g: number): void {
    this.noiseHit(bus, t, { type: 'bandpass', f: 5000, fTo: 1800, q: 1.2, g, a: 0.005, r: 0.35, pan: 0.1, rev: 0.2 });
  }

  /** A car flashing past: an engine note that drops with doppler. */
  passBy(bus: Bus, t: number, f: number, g: number, pan: number): void {
    this.tone(bus, t, f * 1.2, { type: 'sawtooth', g, a: 0.25, h: 0.1, r: 0.7, glide: 0.7, lp: 1400, lpTo: 500, pan, rev: 0.3 });
  }

  // ── tokyo ──
  /** Fat synth-brass stab: detuned saws and a square, a fast filter snap and a pitch scoop up into the note. */
  brass(bus: Bus, t: number, f: number, g: number, len: number, pan = 0): void {
    if (this.busy(5)) return;
    const a = 0.008, r = 0.12, end = t + a + len + r;
    const env = this.env(t, g, a, len, r);
    if (!env) return;
    const lp = this.filter('lowpass', 900, 3);
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(1500, t + len + r);
    const scoop = Math.pow(2, -1.2 / 12);
    for (const [type, det, k] of [['sawtooth', -14, 0.4], ['sawtooth', 14, 0.4], ['square', 0, 0.25]] as const) {
      const o = this.osc(type, f * scoop, t, end, det);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      o.connect(this.gain(k)).connect(lp);
    }
    const drive = this.ctx.createWaveShaper();
    drive.curve = this.drive() as Float32Array<ArrayBuffer>;
    lp.connect(this.gain(0.35)).connect(drive).connect(env);
    this.out(env, bus, pan, 0.3, 0.15);
  }

  /** Koto / shamisen pluck: a hard attack that bends down onto the note and buzzes out. */
  koto(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    const bend = Math.pow(2, 0.6 / 12);
    this.tone(bus, t, f * bend, { type: 'sawtooth', g, a: 0.001, r: 0.9, glide: 1 / bend, lp: 3800, lpTo: 700, q: 3, pan, rev: 0.45, echo: 0.3 });
    this.tone(bus, t, f * 2 * bend, { type: 'triangle', g: g * 0.3, a: 0.001, r: 0.4, glide: 1 / bend, pan });
    this.noiseHit(bus, t, { type: 'bandpass', f: 3000, q: 2, g: g * 0.4, r: 0.02, pan });
  }

  /** Hand clap: three quick noise bursts and a short room tail. */
  clap(bus: Bus, t: number, g: number, pan = 0): void {
    for (const [dt, k] of [[0, 0.7], [0.011, 0.8], [0.023, 1]] as const) {
      this.noiseHit(bus, t + dt, { type: 'bandpass', f: 1400, q: 1.1, g: g * k, a: 0.001, r: dt === 0.023 ? 0.18 : 0.012, pan, rev: 0.5 });
    }
  }

  /** Temple gong: slow inharmonic partials with a shimmer. */
  gong(bus: Bus, t: number, f: number, g: number): void {
    if (this.busy(5)) return;
    for (const [m, k, r] of [[1, 1, 4], [1.47, 0.6, 3], [2.09, 0.45, 2.4], [2.76, 0.3, 1.8], [3.9, 0.18, 1.2]] as const) {
      this.tone(bus, t, f * m, { g: g * k, a: 0.01, r, glide: 0.99, pan: (m - 2) * 0.2, rev: 0.8, echo: 0.2 });
    }
  }

  /** Vinyl scratch: a filtered noise swish pitched back and forth. */
  scratch(bus: Bus, t: number, g: number, len = 0.25, pan = 0): void {
    const env = this.env(t, g, 0.005, len * 0.6, len * 0.4);
    if (!env) return;
    const end = t + len + 0.02;
    const src = this.noise(t, end, 1);
    src.playbackRate.setValueAtTime(0.4, t);
    src.playbackRate.linearRampToValueAtTime(2.2, t + len * 0.35);
    src.playbackRate.linearRampToValueAtTime(0.6, t + len * 0.7);
    src.playbackRate.linearRampToValueAtTime(1.8, t + len);
    const bp = this.filter('bandpass', 1800, 2.5);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(3200, t + len * 0.35);
    bp.frequency.linearRampToValueAtTime(1100, t + len * 0.7);
    bp.frequency.linearRampToValueAtTime(2600, t + len);
    src.connect(bp).connect(env);
    this.out(env, bus, pan, 0.15);
  }

  /** Metal dragged on metal, far away. */
  scrape(bus: Bus, t: number, f: number, g: number, pan = 0): void {
    if (this.busy(4)) return;
    this.noiseHit(bus, t, { type: 'bandpass', f, fTo: f * 1.3, q: 28, g, a: 0.6, h: 0.4, r: 1.8, pan, rev: 0.9, echo: 0.2 });
    for (const [m, k] of [[1, 0.05], [1.51, 0.03], [2.37, 0.02]] as const) {
      this.tone(bus, t + 0.3, f * m * 0.5, { g: g * k * 4, a: 0.5, h: 0.2, r: 1.6, pan, rev: 0.9 });
    }
  }

  /** Filtered noise sweeping up to a downbeat. */
  riser(bus: Bus, t: number, dur: number, g: number): void {
    this.noiseHit(bus, t, { type: 'bandpass', f: 180, fTo: 2600, q: 3, g, a: dur, r: 0.5, rev: 0.4 });
  }

  // ── sound effects (tuned by the caller) ──────────────────────────────────
  /** A rifle shot: sharp crack, chesty body, low thump, plus a ring in key. */
  gunshot(bus: Bus, t: number, g: number, pan: number, ring: number): void {
    if (!(g > 0.001)) return;
    this.noiseHit(bus, t, { type: 'highpass', f: 1300, q: 0.6, g: 0.95 * g, a: 0.001, r: 0.075, pan, rev: 0.35 });
    this.noiseHit(bus, t, { type: 'bandpass', f: 460, fTo: 240, q: 0.9, g: 0.75 * g, a: 0.002, r: 0.2, pan, rev: 0.55 });
    this.tone(bus, t, 150, { g: 0.85 * g, a: 0.002, r: 0.2, glide: 0.33, pan });
    this.tone(bus, t, ring, { type: 'triangle', g: 0.07 * g, a: 0.003, r: 0.4, pan, rev: 0.4, echo: 0.15 });
  }

  /** A zombie groan: a buzzing throat through two moving vowel formants. */
  groan(bus: Bus, t: number, f: number, g: number, pan: number, len: number): void {
    if (this.busy(4) || !(g > 0.001)) return;
    const a = len * 0.25, h = len * 0.25, r = len * 0.5, end = t + len;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const throat = this.osc('sawtooth', f, t, end);
    throat.frequency.linearRampToValueAtTime(f * 1.08, t + len * 0.3);
    throat.frequency.exponentialRampToValueAtTime(f * 0.76, end);
    const vib = this.osc('sine', 4.5 + Math.random() * 2.5, t, end);
    vib.connect(this.gain(22)).connect(throat.detune);
    const mix = this.gain(1);
    const f1 = this.filter('bandpass', 680, 7), f2 = this.filter('bandpass', 1100, 9);
    f1.frequency.linearRampToValueAtTime(420, end);
    f2.frequency.linearRampToValueAtTime(760, end);
    throat.connect(f1).connect(mix);
    throat.connect(f2).connect(this.gain(0.6)).connect(mix);
    const breath = this.noise(t, end, 0.7);
    breath.connect(this.filter('bandpass', 900, 1.5)).connect(this.gain(0.18)).connect(mix);
    mix.connect(env);
    this.out(env, bus, pan, 0.45);
  }

  /** Radio chirp: two short tones and a crackle of static. */
  chirp(bus: Bus, t: number, f: number, f2: number, g: number, pan: number): void {
    this.tone(bus, t, f, { g, a: 0.004, h: 0.035, r: 0.03, pan, rev: 0.2, echo: 0.25 });
    this.tone(bus, t + 0.09, f2, { g: g * 0.8, a: 0.004, h: 0.05, r: 0.04, pan, rev: 0.2, echo: 0.25 });
    this.noiseHit(bus, t, { type: 'highpass', f: 3200, g: g * 0.5, a: 0.01, h: 0.05, r: 0.08, pan, rate: 0.6 });
  }

  /** A door on a rusty hinge. `rise` > 1 swings open, < 1 swings shut. */
  creak(bus: Bus, t: number, f: number, g: number, pan: number, rise: number): void {
    if (this.busy(3)) return;
    const a = 0.08, h = 0.35, r = 0.35, end = t + a + h + r;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const o = this.osc('sawtooth', f, t, end);
    o.frequency.exponentialRampToValueAtTime(f * rise, end);
    const wob = this.osc('sine', 9, t, end);
    wob.frequency.exponentialRampToValueAtTime(3, end);
    wob.connect(this.gain(f * 0.04)).connect(o.frequency);
    o.connect(this.filter('bandpass', f * 2.5, 9)).connect(this.gain(1.2)).connect(env);
    this.out(env, bus, pan, 0.35);
  }

  /** Generator sputter: a low engine that chokes, sags and catches again. */
  sputter(bus: Bus, t: number, f: number, g: number): void {
    if (this.busy(3)) return;
    const a = 0.03, h = 1.1, r = 0.5, end = t + a + h + r;
    const env = this.env(t, g, a, h, r);
    if (!env) return;
    const o = this.osc('sawtooth', f, t, end);
    o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(f, t + 1.5);
    const chop = this.gain(0.55);
    const lfo = this.osc('square', 13, t, end);
    lfo.frequency.linearRampToValueAtTime(6, t + 0.9);
    lfo.frequency.linearRampToValueAtTime(15, t + 1.5);
    lfo.connect(this.gain(0.45)).connect(chop.gain);
    o.connect(this.filter('lowpass', 380, 1.5)).connect(chop).connect(env);
    this.out(env, bus, 0.15, 0.25);
  }

  // ── beds ─────────────────────────────────────────────────────────────────
  /** Gusting wind: slowly wandering band of noise. */
  wind(bus: Bus): Bed {
    const t = this.ctx.currentTime, end = t + 1e6;
    const src = this.noise(t, end, 0.5);
    const bp = this.filter('bandpass', 480, 0.9);
    const sweep = this.osc('sine', 0.055, t, end);
    sweep.connect(this.gain(260)).connect(bp.frequency);
    const level = this.gain(0);
    const gust = this.gain(1);
    const gustLfo = this.osc('sine', 0.11, t, end);
    gustLfo.connect(this.gain(0.45)).connect(gust.gain);
    src.connect(bp).connect(gust).connect(level);
    this.out(level, bus, 0, 0.25);
    return { level, stop: (at) => { for (const n of [src, sweep, gustLfo]) n.stop(at); } };
  }

  /** Steady rain hiss. */
  rain(bus: Bus): Bed {
    const t = this.ctx.currentTime, end = t + 1e6;
    const src = this.noise(t, end, 1);
    const level = this.gain(0);
    src.connect(this.filter('highpass', 1000, 0.5)).connect(this.filter('lowpass', 7000, 0.5)).connect(level);
    this.out(level, bus, 0, 0.1);
    return { level, stop: (at) => src.stop(at) };
  }

  /** A breathing low drone whose voices can glide to new chord tones. */
  drone(bus: Bus, freqs: number[]): Bed & { glide(freqs: number[], t: number): void } {
    const t = this.ctx.currentTime, end = t + 1e6;
    const lp = this.filter('lowpass', 360, 1.2);
    const lfo = this.osc('sine', 0.045, t, end);
    lfo.connect(this.gain(170)).connect(lp.frequency);
    const level = this.gain(0);
    const oscs = freqs.map((f, i) => {
      const o = this.osc(i === 0 ? 'sawtooth' : 'triangle', f, t, end, (i - 1) * 7);
      o.connect(this.gain(i === 0 ? 0.6 : 0.4)).connect(lp);
      return o;
    });
    lp.connect(level);
    this.out(level, bus, 0, 0.6);
    return {
      level,
      stop: (at) => { lfo.stop(at); for (const o of oscs) o.stop(at); },
      glide: (next, at) => oscs.forEach((o, i) => o.frequency.setTargetAtTime(next[i % next.length], at, 1.6)),
    };
  }
}
