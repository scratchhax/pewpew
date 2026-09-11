import type { Settings } from './settings';
import type { State } from './state';

/**
 * The network plays itself. Events are not beeps — they are band members:
 *   allows  → pentatonic melody line (walked, so it forms phrases)
 *   blocks  → bass pulse (root/fifth alternation)
 *   dns     → high sparkle notes, sparse
 *   wifi    → gliding woeful notes
 *   dhcp    → warm arrival chord
 * Notes are quantized onto a slow grid, so bursts become rolls and runs
 * instead of machine-gun spam. Pentatonic scale ⇒ anything lands in key.
 */
const SCALE = [0, 3, 5, 7, 10];                  // minor pentatonic semitones
const BASE = 110;                                 // A2
const GRID = 0.21;                                // composition clock, seconds

// bass grooves (pentatonic scale degrees, null = rest) — the band plays
// one per current song, so melody rotations change the low end too
const BASS_GROOVES: Array<Array<number | null>> = [
  [0, null, null, 0, 4, null, 3, null],   // lazy sway
  [0, null, 4, null, 0, null, 2, null],   // root & hover
  [0, 0, null, 2, null, 4, null, null],   // stepping stone
  [0, null, null, null, 3, null, 2, null],// half-note drone
  [0, null, 0, 4, null, 3, null, 2],      // gallop
  [0, 0, 0, null, 4, 4, null, null],      // driving thirds
  [7, null, 4, null, 3, null, 2, null],   // descending anchor
  [0, null, 2, 0, null, 4, null, 3],      // shuffle
];

// each song personality gets its own lead timbre
const LEAD_WAVES: OscillatorType[] = ['triangle', 'sine', 'square', 'triangle'];

function degreeToFreq(d: number): number {
  const oct = Math.floor(d / SCALE.length);
  const semi = SCALE[((d % SCALE.length) + SCALE.length) % SCALE.length];
  return BASE * Math.pow(2, oct + semi / 12);
}

type Cue = 'block' | 'allow' | 'dns' | 'dhcp' | 'wifi';

interface HostVoice {
  deg: number; cell: number[]; cellIdx: number;
  ema: number; last: number;
  wave: OscillatorType; pan: number;
}

function ipSeed(ip: string): number {
  let h = 2166136261;
  for (let i = 0; i < ip.length; i++) { h ^= ip.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private pending: Record<Cue, number> = { block: 0, allow: 0, dns: 0, dhcp: 0, wifi: 0 };
  private last = 0;
  private stepAcc = 0;
  private melodyIdx = 12;
  private melodyPan = 0;
  private stepCount = 0;
  private motif: number[] = [];          // scale degrees, 0 = rest
  private motifPos = 0;
  private motifLoop = 0;
  private motifShift = 0;                // whole-motif transposition (scale steps)
  private delay: DelayNode | null = null;
  private reverbIn: GainNode | null = null;
  private tension = 0;
  private tensionPeak = 0;
  private calmT = 0;
  private resolving = false;
  private releaseAt = 0;
  private section: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' = 'intro';
  private sectionT = 0;
  private skipBase = 0.85;
  private allowGain = 0.07;
  private bassDouble = false;
  private bassEvery = false;
  private sectionOct = 0;
  private delayWet: GainNode | null = null;
  private reverbWet: GainNode | null = null;
  private echoLevel: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private hosts = new Map<string, HostVoice>();
  private motifBank: number[][] = [];
  private bankIdx = 0;
  private tuneAge = 0;
  private rotateAfter = 90;
  private motifStyles: number[] = [];
  private lastBuildStyle = 0;
  private leadWave: OscillatorType = 'triangle';
  private songOct = 0;
  private noiseRate = 0;
  private noiseQueue: Cue[] = [];
  private nextSlot = 0;
  private noiseArrivals = 0;
  private noiseRatePerSec = 0;
  private rateWinT = 0;
  private dbgCues = 0;
  private dbgFires = 0;
  private dbgProb = 1;
  private dbgAlive = 0;
  private dbgDropped = 0;
  private timeBuf: Uint8Array | null = null;

  /** Read-and-reset counters + REAL output level for the ?debug=1 readout. */
  dbgStats(): { cues: number; fires: number; rate: number; queue: number;
                alive: number; dropped: number; rms: number } {
    let rms = 0;
    if (this.analyser) {
      const n = this.analyser.fftSize;
      if (!this.timeBuf || this.timeBuf.length !== n) this.timeBuf = new Uint8Array(n);
      this.analyser.getByteTimeDomainData(this.timeBuf as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < n; i++) { const v = (this.timeBuf[i] - 128) / 128; sum += v * v; }
      rms = Math.sqrt(sum / n);
    }
    const out = { cues: this.dbgCues, fires: this.dbgFires,
      rate: this.noiseRatePerSec, queue: this.noiseQueue.length,
      alive: this.dbgAlive, dropped: this.dbgDropped, rms };
    this.dbgCues = 0; this.dbgFires = 0;
    return out;
  }
  private weather: State['weather'] = 'calm';
  private started = false;
  private gestured = false;

  constructor(private settings: Settings) {
    window.addEventListener('pointerdown', () => this.onGesture());
    window.addEventListener('keydown', () => this.onGesture());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.settings.audio) void this.ctx.resume();
    });
  }

  private onGesture(): void {
    this.gestured = true;
    this.maybeStart();
  }

  private maybeStart(): void {
    if (this.started || !this.gestured || !this.settings.audio) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.72;
    ctx.destination; // no compressor — noise mode is a promise

    this.master = ctx.createGain();
    this.master.gain.value = this.settings.volume * 1.1;
    this.master.connect(this.analyser).connect(ctx.destination);

    // ── algorithmic hangar: convolution reverb, IR synthesized here ──
    const ir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2.4), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const env = Math.pow(1 - i / d.length, 2.6);
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;   // darken the tail
        d[i] = lp * env;
      }
      // early reflections give it a room, not just a wash
      for (const [ms, amp] of [[13, 0.5], [27, 0.35], [41, 0.28], [59, 0.2]] as const) {
        const idx = Math.floor(ctx.sampleRate * ms / 1000) + (ch * 97);
        if (idx < d.length) d[idx] += amp;
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const revWet = ctx.createGain();
    revWet.gain.value = this.settings.reverb;
    this.reverbWet = revWet;
    conv.connect(revWet).connect(this.master);
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv);


    // dotted echo for the carry melody — space-rock shimmer
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = GRID * 3;         // dotted feel
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1600;
    this.delay.connect(delayTone).connect(fb).connect(this.delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.delayWet = wet;
    // user echo slider scales the whole delay tail (1.0 at default 0.5)
    this.echoLevel = ctx.createGain();
    this.echoLevel.gain.value = this.settings.echo * 2;
    wet.connect(this.echoLevel).connect(this.master);
    this.delay.connect(wet);

    // ── rhythm kit: shared noise buffer for drums ──
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;

    this.last = ctx.currentTime;
  }

  /** Real FFT of the actual mix for the spectrum panel. */
  spectrumLevels(out: Uint8Array): boolean {
    if (!this.analyser) return false;
    this.analyser.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
    return true;
  }

  /** F1 toggle: silence EVERYTHING (drone, noise, tails) by suspending. */
  setEnabled(on: boolean): void {
    if (!this.ctx) {
      if (on) this.maybeStart();
      return;
    }
    if (on) void this.ctx.resume();
    else void this.ctx.suspend();
  }

  setVolume(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v * 1.1, this.ctx.currentTime, 0.2);
    }
  }

  setReverb(v: number): void {
    if (this.reverbWet && this.ctx) {
      this.reverbWet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
    }
  }

  setEcho(v: number): void {
    if (this.echoLevel && this.ctx) {
      // 0.5 default → 1.0 gain (unchanged feel); 0 = dry, 1 = heavy
      this.echoLevel.gain.setTargetAtTime(v * 2, this.ctx.currentTime, 0.2);
    }
  }

  /** Composition-mode cue (fires after visual gates). */
  cueSong(kind: Cue, srcIp?: string): void {
    if (!this.settings.audio) return;
    this.ingest(kind, srcIp);
  }

  /** Noise-mode cue: fires on EVERY raw event; sampling lives in noiseFire. */
  cueNoise(kind: Cue, srcIp?: string): void {
    const g = this.settings.noiseGate;
    if (!this.settings.audio || g <= 0) return;
    if (g < 1 && Math.random() >= g) return;    // thin the per-event noise stream
    this.noiseFire(kind);
  }

  private ingest(kind: Cue, srcIp?: string): void {
    const cap = kind === 'allow' ? 10 : 4;
    this.pending[kind] = Math.min(cap, this.pending[kind] + 1);
    if (kind === 'block') this.tension = Math.min(1, this.tension + 0.09);
    if ((kind === 'allow' || kind === 'dns') && srcIp) this.hostVoice(srcIp);
  }

  /**
   * Every device is a band member with a fixed identity (pitch, pan, timbre,
   * 3-note cell from its IP hash) — but stage time is the opposite of fame:
   * busy hosts (the gateway!) note-gate hard and fade, quiet ones solo.
   */
  /**
   * NOISE MODE: events ARRIVE in network bursts (the UDM flushes log
   * batches), so we never play at arrival time — that produced walls of
   * 20 simultaneous sounds followed by silence. Everything goes into a
   * FIFO that the scheduler in update() paces evenly: 10 ev/s => one
   * sound every ~100ms, sample-accurately, via WebAudio future scheduling.
   */
  private noiseFire(kind: Cue): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    this.dbgCues++;
    this.noiseArrivals++;
    if (this.noiseQueue.length >= 80) { this.noiseQueue.shift(); this.dbgDropped++; }
    this.noiseQueue.push(kind);
  }

  /** Actually make one noise voice sound, anchored at `when` (audio clock). */
  private gOf(kind: Cue): number {
    return kind === 'block' ? this.settings.gBlock
      : kind === 'allow' ? this.settings.gAllow
      : kind === 'dns' ? this.settings.gDns
      : kind === 'wifi' ? this.settings.gWifi
      : this.settings.gDhcp;
  }

  private playNoiseVoice(kind: Cue, when: number): void {
    if (!this.ctx || !this.master) return;
    this.dbgFires++;
    const pan = (Math.random() - 0.5) * 1.6;
    if (kind === 'block') {
      this.bong(when, this.gOf('block'));
      const f = 90 + Math.random() * 90;
      this.voice(f, 'triangle', 0.3 + Math.random() * 0.15,
        0.13 * this.gOf('block'), pan, f * 0.45, 0, 0.45, when);
      return;
    }
    const soft = Math.random() < 0.7;
    const w: OscillatorType = soft
      ? (Math.random() < 0.5 ? 'sine' : 'triangle')
      : (Math.random() < 0.5 ? 'square' : 'sawtooth');
    let f = degreeToFreq((Math.random() * 22) | 0);
    if (soft) {
      if (Math.random() < 0.25) f *= 2;
    } else {
      while (f > 520) f /= 2;
    }
    const glide = Math.random() < 0.45 ? f * (0.5 + Math.random() * 1.2) : 0;
    this.voice(f, w, 0.14 + Math.random() * 0.35, (soft ? 0.2 : 0.13) * this.gOf(kind),
      pan, glide, Math.random() < 0.3 ? 0.5 : 0, 0.35, when);
  }

  /** Direct 440->880Hz sweep: proves speakers/browser path, bypasses all. */
  testTone(): void {
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 1.05);
  }

  private hostVoice(ip: string): void {
    if (!this.ctx || !this.master || !this.settings.deviceVoices) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    let h = this.hosts.get(ip);
    if (!h) {
      if (this.hosts.size > 100) {
        // evict the quietest when the roster balloons
        let quiet: string | null = null; let low = Infinity;
        for (const [k, v] of this.hosts) if (v.ema < low) { low = v.ema; quiet = k; }
        if (quiet) this.hosts.delete(quiet);
      }
      const seed = ipSeed(ip);
      const deg = 5 + (seed % 8);
      h = {
        deg, cellIdx: 0, ema: 0, last: -99,
        cell: [deg,
          deg + ([1, 2, 4][(seed >>> 8) % 3]) * (Math.random() < 0.5 ? 1 : -1),
          deg + ((seed >>> 12) % 3)],
        wave: ((seed >>> 16) % 3 === 0) ? 'sine' : 'triangle',
        pan: (((seed >>> 20) % 200) - 100) / 100,
      };
      this.hosts.set(ip, h);
    }
    h.ema = Math.min(40, h.ema * 0.96 + 1);
    const minGap = Math.min(8, 0.6 + h.ema * 0.22);
    if (now - h.last < minGap) return;
    if (Math.random() > Math.min(1, 3 / (1 + h.ema * 0.55))) return;
    h.last = now;

    const d = h.cell[h.cellIdx % h.cell.length] + this.motifShift;
    h.cellIdx++;
    const gain = 0.085 * this.settings.deviceMix
      * Math.max(0.22, 1 / (1 + h.ema / 12));
    this.voice(degreeToFreq(d), h.wave, 0.42, gain, h.pan, 0, 0.3, 0.55);
  }

  /** Main-loop tick: drives the composition clock. */
  update(state: State): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    this.weather = state.weather;

    const t = this.ctx.currentTime;

    const dt = t - this.last;
    this.last = t;
    // tension bleeds away slowly; the tritone pad rides it
    this.tension = Math.max(0, this.tension - dt * 0.028);
    this.tensionPeak = Math.max(this.tensionPeak, this.tension);
    // gated hard: trickle-blocks at idle must never wake the pad —
    // an always-on low sine reads as a fan, not as dread
    // …and resolves when the BLOCK pressure lifts — the network never goes
    // fully quiet (~10 ev/s floor), so calm is measured against the peak:
    // high peak + decayed current = the storm passed, play the landing
    if (!this.resolving && this.tensionPeak > 0.5 && this.tension < 0.25) {
      this.resolving = true;
      this.resolveChord(t);
      this.tension = 0;
      this.tensionPeak = 0;
      this.motifShift = 0;
      this.releaseAt = t + 4;
    }
    if (this.resolving && t > this.releaseAt) this.resolving = false;

    if (dt > 0) {
      const k = Math.exp(-dt * 0.5);
      for (const v of this.hosts.values()) v.ema *= k;
      this.noiseRate *= Math.exp(-dt * 1.2);
      this.rateWinT += dt;
      if (this.rateWinT >= 1) {
        const inst = this.noiseArrivals / this.rateWinT;
        // fast attack, slow release: burst spacing must survive the quiet
        // seconds while the queue still drains
        this.noiseRatePerSec = Math.max(inst, this.noiseRatePerSec * 0.7);
        this.noiseArrivals = 0;
        this.rateWinT = 0;
      }
    }

    // noise pacing scheduler: spacing follows the higher of arrival rate or
    // the backlog (everything queued must clear within ~2s), so a burst
    // plays out crisply instead of trickling at the idle rate
    if (this.ctx && this.ctx.state === 'running' && this.noiseQueue.length) {
      const tNow = this.ctx.currentTime;
      if (this.nextSlot < tNow) this.nextSlot = tNow + 0.05;
      const want = Math.max(0.5, this.noiseRatePerSec, this.noiseQueue.length / 2);
      const spacing = Math.min(0.4, Math.max(0.06, 1 / want));
      const lookahead = Math.max(0.25, spacing * 4);
      let guard = 0;
      while (this.noiseQueue.length && this.nextSlot < tNow + lookahead && guard++ < 16) {
        this.playNoiseVoice(this.noiseQueue.shift()!, this.nextSlot);
        this.nextSlot += spacing;
      }
    }

    this.stepAcc += dt;
    let guard = 0;
    while (this.stepAcc >= GRID && guard++ < 4) {
      this.stepAcc -= GRID;
      this.composingStep();
    }
  }

  private resolveChord(t: number): void {
    if (!this.ctx || !this.master) return;
    void t;
    // A major-ish landing: root, fifth, octave, third-on-top — home again
    for (const [f, g, pan] of [[110, 0.09, -0.3], [164.8, 0.07, 0.2],
                               [220, 0.075, 0], [329.6, 0.05, 0.5]] as const) {
      this.voice(f, 'sine', 3.6, g, pan, 0, 0.4, 1);
    }
  }

  // ── the band ──
  /** Song-form state machine: intro → verse ⇄ chorus → bridge → outro. */
  private arrange(): void {
    const s = this.section;
    let next: typeof s | null = null;
    switch (s) {
      case 'intro':
        if (this.sectionT > 45) next = 'verse';
        break;
      case 'verse':
        if (this.tension > 0.8 && this.sectionT > 12) next = 'bridge';
        else if ((this.weather !== 'calm' || this.tension > 0.5) && this.sectionT > 12) next = 'chorus';
        else if (this.calmT > 25 && this.sectionT > 20) next = 'outro';
        break;
      case 'chorus':
        if (this.tension > 0.85 && this.sectionT > 12) next = 'bridge';
        else if (this.weather === 'calm' && this.tension < 0.35 && this.sectionT > 14) next = 'verse';
        else if (this.calmT > 25 && this.sectionT > 20) next = 'outro';
        break;
      case 'bridge':
        if (this.sectionT > 12 && this.tension > 0.4) next = 'chorus';   // the big return
        else if (this.sectionT > 16) next = 'verse';
        break;
      case 'outro':
        if (this.weather !== 'calm' || this.tension > 0.3) next = 'intro';  // traffic swells: fresh take
        break;
    }
    if (next) {
      this.section = next;
      this.sectionT = 0;
      this.enterSection(next);
    }
  }

  private enterSection(sec: typeof this.section): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (sec) {
      case 'intro':
        this.skipBase = 0.85; this.allowGain = 0.07;
        this.bassDouble = false; this.bassEvery = false; this.sectionOct = 0;
        this.delayWet?.gain.setTargetAtTime(0.5, t, 2);
        break;
      case 'verse':
        this.skipBase = 0.45; this.allowGain = 0.1;
        this.bassDouble = false; this.bassEvery = false; this.sectionOct = 0;
        this.delayWet?.gain.setTargetAtTime(0.4, t, 2);
        break;
      case 'chorus':
        this.skipBase = 0.08; this.allowGain = 0.14;
        this.bassDouble = true; this.bassEvery = false;
        this.sectionOct = Math.random() < 0.4 ? 5 : 0;
        this.delayWet?.gain.setTargetAtTime(0.72, t, 1.5);
        // the lift: soft chord marks the change
        this.voice(220, 'sine', 1.4, 0.05, -0.3, 0, 0.4, 0.9);
        this.voice(329.6, 'sine', 1.6, 0.04, 0.3, 0, 0.4, 0.9);
        break;
      case 'bridge':
        this.skipBase = 0.65; this.allowGain = 0.08;
        this.bassDouble = false; this.bassEvery = true; this.sectionOct = -5;
        this.delayWet?.gain.setTargetAtTime(0.25, t, 1.5);
        this.voice(55, 'sine', 1.2, 0.12, 0);        // the drop
        break;
      case 'outro':
        this.skipBase = 0.92; this.allowGain = 0.08;
        this.bassDouble = false; this.bassEvery = false; this.sectionOct = 0;
        this.delayWet?.gain.setTargetAtTime(0.55, t, 2);
        break;
    }
  }

  private genMotif(): void {
    this.motif = this.buildMotif();
    if (!this.motifBank.length) {
      this.motifBank = [this.motif];
      this.motifStyles = [this.lastBuildStyle];
      for (let i = 0; i < 3; i++) {
        this.motifBank.push(this.buildMotif());
        this.motifStyles.push(this.lastBuildStyle);
      }
    } else {
      this.motifBank[this.bankIdx] = this.motif;
      this.motifStyles[this.bankIdx] = this.lastBuildStyle;
    }
  }

  private buildMotif(): number[] {
    // eight personalities so bank tunes are AUDIBLY different songs
    const style = (Math.random() * 8) | 0;
    this.lastBuildStyle = style;
    const base = 8 + ((Math.random() * 5) | 0);
    const m: number[] = [];
    let d = base;
    for (let i = 0; i < 8; i++) {
      if (style === 0) {
        d = base + [0, 1, 2, 4, 2, 1][i % 6];              // arpeggio swell
      } else if (style === 1) {
        d = base + [0, 0, 2, 0, 3, 2][i % 6];              // riff / stomp
      } else if (style === 2) {
        d = base + 4 - (i % 5);                            // falling cascade
      } else if (style === 3) {
        d += [-2, -1, 1, 1, 2][(Math.random() * 5) | 0];   // wanderer
      } else if (style === 4) {
        d = base + (i % 6);                                // rising ladder
      } else if (style === 5) {
        d = base + [4, 3, 2, 0, 1, 0][i % 6];              // call & response
      } else if (style === 6) {
        d = base + (i % 2 ? 3 : 0);                        // pendulum
      } else {
        d = base + [0, 4, 1, 5, 2, 3][i % 6];              // skips
      }
      d = Math.max(5, Math.min(21, d));
      const restP = style === 1 ? 0.06
        : (style === 4 || style === 6 ? 0.1 : 0.18);
      if (Math.random() < restP) { m.push(0); continue; }
      m.push(d);
    }
    return m;
  }

  /** Bassline + drums: the heartbeat the whole song sits on. */
  private rhythm(): void {
    const step = this.stepCount % 16;
    const sec = this.section;
    if (sec === 'outro' && step % 8 !== 0) return;
    if (sec === 'intro') {
      if (step === 0) this.bass(110, 0.09);
      return;
    }

    // bass groove follows the current song (rotates with the motif bank)
    const pattern = BASS_GROOVES[this.bankIdx % BASS_GROOVES.length];
    const d = pattern[step % 8];
    if (d !== null && (sec !== 'verse' || step % 4 === 0 || Math.random() < 0.6)) {
      const oct = sec === 'chorus' && step % 8 === 6 && Math.random() < 0.3 ? 5 : 0;
      this.bass(degreeToFreq(d + this.motifShift + oct), 0.15);
    }

    // drums
    if (sec === 'bridge') {
      if (step % 4 === 0) this.kick(0.3);                 // four-on-the-floor
      if (step % 8 === 4) this.snare(0.1);
    } else {
      if (step % 8 === 0 || (sec === 'chorus' && step % 16 === 6)) this.kick(sec === 'chorus' ? 0.32 : 0.2);
      if (sec === 'chorus' && (step % 16 === 4 || step % 16 === 12)) this.snare(0.09);
      if (step % 2 === 1 && (sec !== 'verse' || Math.random() < 0.5)) {
        this.hat(0.028 + (sec === 'chorus' ? 0.012 : 0));
      }
    }
  }

  private bass(freq: number, gain: number): void {
    if (!this.ctx || !this.master || !(gain > 0.001)) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + 0.22);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain * this.settings.volume, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(lp).connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  private kick(gain: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.11);
    if (!(gain > 0.001)) return;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(Math.max(0.0001, gain * this.settings.volume), now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** Mid-bass "bong": inharmonic partials, bell-like 1.5s taper. */
  private bong(when = 0, scale = 1): void {
    if (!this.ctx || !this.master) return;
    const base = 200 + Math.random() * 90;
    const pan = (Math.random() - 0.5) * 0.7;
    this.voice(base, 'sine', 1.5, 0.15 * scale, pan, 0, 0.25, 0.55, when);
    this.voice(base * 2.76, 'sine', 0.8, 0.05 * scale, pan, 0, 0.2, 0.7, when);
    this.voice(base * 5.4, 'sine', 0.35, 0.025 * scale, pan, 0, 0.1, 0.7, when);
  }

  private hat(gain: number): void {
    this.noiseHit(gain, 8500, 0.025, 0.012);
  }

  private snare(gain: number): void {
    this.noiseHit(gain, 1900, 0.09, 1);
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 190;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain * 0.5 * this.settings.volume, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  private noiseHit(gain: number, freq: number, dur: number, rev: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf || !(gain > 0.001)) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(Math.max(0.0001, gain * this.settings.volume), now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f).connect(env).connect(this.master);
    if (rev > 0 && this.reverbIn) {
      const g = this.ctx.createGain();
      g.gain.value = rev * 0.12;
      env.connect(g).connect(this.reverbIn);
    }
    src.start(now, Math.random() * 0.05);
    src.stop(now + dur + 0.02);
  }

  /** Music-bed level (1.0 at melodyBal 0.65): scales sustained melody
   *  against the event-triggered hits. */
  private mb(): number { return this.settings.melodyBal / 0.65; }

  /** The carry tune: plays and evolves the motif, frames the rest. */
  private carry(): void {
    if (!this.motif.length) this.genMotif();
    this.tuneAge += GRID;                 // real time, every step
    const note = this.motif[this.motifPos];
    if (note > 0) {
      const skip = this.skipBase;
      if (Math.random() > skip) {
        const oct = this.sectionOct + this.songOct
          + (this.section === 'chorus' && Math.random() < 0.4 ? 5 : 0);
        const pan = (Math.random() - 0.5) * 0.9;
        this.voice(degreeToFreq(note + this.motifShift + oct), this.leadWave,
          GRID * (1.2 + Math.random() * 1.6), 0.075 * this.mb(),
          pan, 0, 0.6, 0.5);
        // traffic pressure adds passing tones between motif notes
        if (this.pending.allow > 2 && Math.random() < 0.4) {
          this.voice(degreeToFreq(note + this.motifShift + oct + 1), 'triangle',
            GRID * 0.6, 0.04 * this.mb(), pan, 0, 0.5, 0.4);
        }
      }
    }
    this.motifPos++;
    if (this.motifPos >= this.motif.length) {
      this.motifPos = 0;
      this.motifLoop++;
      const r = Math.random();
      if (this.tuneAge >= this.rotateAfter) {
        // set list rotation: every 75-165s the band moves to the next song
        this.bankIdx = (this.bankIdx + 1) % this.motifBank.length;
        if (Math.random() < 0.5) {
          const fresh = (this.bankIdx + 1) % this.motifBank.length;
          this.motifBank[fresh] = this.buildMotif();
          this.motifStyles[fresh] = this.lastBuildStyle;
        }
        this.motif = this.motifBank[this.bankIdx];
        const st = this.motifStyles[this.bankIdx] ?? 0;
        this.leadWave = LEAD_WAVES[st % LEAD_WAVES.length];
        this.songOct = st % 2;
        this.tuneAge = 0;
        this.rotateAfter = 75 + Math.random() * 90;
        // a soft high ping marks the change so the ear notices a new song
        this.voice(degreeToFreq(this.motif[0] + this.motifShift + 12),
          'sine', 1.2, 0.05, 0, 0, 0.5, 0.9);
      } else if (r < 0.12) {
        // mutate one note
        const i = (Math.random() * 8) | 0;
        if (this.motif[i] > 0) this.motif[i] = Math.max(7, Math.min(20,
          this.motif[i] + [-2, -1, 1, 2][(Math.random() * 4) | 0]));
      } else if (r < 0.2) {
        // slide the whole phrase up/down a scale step
        this.motifShift = Math.max(-5, Math.min(5,
          this.motifShift + (Math.random() < 0.5 ? -1 : 1)));
      }
    }
  }

  private motifTone(i: number): number {
    const d = this.motif[((i % 8) + 8) % 8] || this.motif[0];
    return degreeToFreq(d + this.motifShift);
  }

  private composingStep(): void {
    const p = this.pending;
    this.stepCount++;
    const busy = this.section === 'chorus' || this.bassEvery;
    this.sectionT += GRID;
    if (this.weather === 'calm' && this.tension < 0.2) this.calmT += GRID;
    else this.calmT = 0;
    const mel = this.settings.melody;              // melody layer (additive)
    const dev = this.settings.deviceVoices;        // gated event sounds
    // per-type gate openness: 1 = every hit passes (default), 0 = choked off
    const gB = this.settings.gateBlock, gA = this.settings.gateAllow;
    const gD = this.settings.gateDns, gW = this.settings.gateWifi;
    const gH = this.settings.gateDhcp;
    if (mel) {
      this.arrange();
      this.rhythm();
      this.carry();
    }

    if (p.block > 0) {                            // impact: kick + bell taper
      if (dev && Math.random() < gB) {
        this.kick(Math.min(0.4, 0.26 + p.block * 0.03) * this.settings.gBlock);
        this.bong(0, this.settings.gBlock);
      }
      p.block = 0;
    } else if (mel && busy && (this.bassEvery || this.stepCount % 4 === 0)) {
      this.voice(55, 'sine', 0.4, this.bassEvery ? 0.2 : 0.12, 0);
    }

    if (p.allow > 0) {                            // allow: data tick + melody
      if (dev) {                                  // gated "data" tick (rate-limited
        const ticks = Math.min(2, p.allow);       // by the step queue, not per-packet
        for (let i = 0; i < ticks; i++) {
          if (Math.random() >= gA) continue;
          const f = degreeToFreq(16 + ((Math.random() * 5) | 0));
          this.voice(f, 'square', 0.08, 0.045 * this.settings.gAllow,
            (Math.random() - 0.5) * 1.1, 0, 0, 0.15);
        }
      }
      if (mel) {
      const n = Math.min(1 + Math.floor(p.allow / 5), 3);
      for (let i = 0; i < n; i++) {
        // 55% of the time: answer the motif (octave above a nearby motif tone);
        // otherwise keep free-walking
        if (Math.random() < 0.55) {
          this.melodyIdx = this.motif[(this.motifPos + ((Math.random() * 3) | 0)) % 8] + 7;
        } else {
          const walk = [-2, -1, -1, 0, 1, 1, 2, 4][(Math.random() * 8) | 0];
          this.melodyIdx += walk;
        }
        if (this.melodyIdx > 24 || this.melodyIdx < 6) {
          this.melodyIdx = 9 + ((Math.random() * 8) | 0);   // rebreathe
        }
        this.melodyPan += (Math.random() - 0.5) * 0.5;
        this.melodyPan = Math.max(-0.8, Math.min(0.8, this.melodyPan));
        const f = degreeToFreq(this.melodyIdx);
        const dur = GRID * (1.5 + Math.random());
        if (Math.random() < 0.22) {               // octave shimmer
          this.voice(f * 2, 'sine', dur * 0.7, 0.05 * this.mb(), this.melodyPan, 0, 0, 0.4);
        }
        this.voice(f, Math.random() < 0.7 ? 'triangle' : 'square', dur,
          this.allowGain * this.settings.gAllow * this.mb(), this.melodyPan, 0, 0.3, 0.3);
      }
      }
      p.allow = 0;
    }

    if (p.dns > 0) {                              // sparkles
      if (dev && Math.random() < 0.5 * gD) {
        const f = degreeToFreq(18 + ((Math.random() * 6) | 0));
        this.voice(f, 'sine', 0.25, 0.05 * this.settings.gDns,
          (Math.random() - 0.5) * 1.2, 0, 0, 0.7);
      }
      p.dns = 0;
    }

    if (p.wifi > 0) {                             // glides
      if (dev && Math.random() < 0.75 * gW) {
        const f = Math.random() < 0.5 && this.motif.length
          ? this.motifTone(this.motifPos - 1) * 0.5
          : degreeToFreq(10 + ((Math.random() * 5) | 0));
        this.voice(f, 'sine', 0.55, 0.09 * this.settings.gWifi,
          (Math.random() - 0.5) * 0.8,
          f * (Math.random() < 0.5 ? 0.75 : 1.33), 0, 0.6);
      }
      p.wifi = 0;
    }

    if (p.dhcp > 0) {                             // arrival chord
      if (dev && Math.random() < gH) {
        const root = Math.random() < 0.5 ? BASE : BASE * 6 / 5;
        for (const mult of [1, 1.2, 1.5]) {
          this.voice(root * mult, 'sine', 1.6, 0.055 * this.settings.gDhcp,
            (Math.random() - 0.5) * 0.6, 0, 0, 0.8);
        }
      }
      p.dhcp = 0;
    }
  }

  /** One note: attack-decay envelope, optional glide target, stereo pan. */
  private voice(freq: number, type: OscillatorType, decay: number,
                gain: number, pan: number, glideTo = 0, echo = 0, rev = 0.22,
                when = 0): void {
    if (!this.ctx || !this.master) return;
    // exponential ramps MUST have a positive target — a slider at 0 would
    // otherwise throw RangeError inside the render loop and freeze the app
    if (!Number.isFinite(gain) || gain <= 0.001) return;
    const ctx = this.ctx;
    const now = when > 0 ? when : ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo > 0) osc.frequency.exponentialRampToValueAtTime(glideTo, now + decay * 0.8);
    osc.detune.value = (Math.random() - 0.5) * 12;

    // raw square/saw alias in WebAudio — band-limit them so they never
    // sound like a busted speaker
    let head: AudioNode = osc;
    if (type === 'sawtooth' || type === 'square') {
      const tame = ctx.createBiquadFilter();
      tame.type = 'lowpass';
      tame.frequency.value = Math.min(9000, freq * 5);
      tame.Q.value = 0.4;
      osc.connect(tame);
      head = tame;
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    head.connect(env).connect(panner).connect(this.master);
    if (echo > 0 && this.delay) {
      const send = ctx.createGain();
      send.gain.value = echo;
      panner.connect(send).connect(this.delay);
    }
    if (rev > 0 && this.reverbIn) {
      const rSend = ctx.createGain();
      rSend.gain.value = rev;
      panner.connect(rSend).connect(this.reverbIn);
    }
    this.dbgAlive++;
    osc.onended = () => { this.dbgAlive--; };
    osc.start(now);
    osc.stop(now + decay + 0.05);
  }
}
