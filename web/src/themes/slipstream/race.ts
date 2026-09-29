import type { Track } from './track';
import type { SceneEvent } from '../../events';

/**
 * The race. Exactly eight karts, always: a seat belongs to a host, never to
 * an event. Traffic pushes its racer forward, DNS gives it a sprint, blocks
 * leave oil under it, threats fire a red shell at the leader, Wi-Fi joins
 * light the boost pads, and system logs throw a yellow caution over the lot.
 * A host that goes quiet becomes a ghost and holds its seat until a new
 * driver (DHCP, or any first sight of it in traffic) takes it over.
 */

export const SEATS = 8;

export interface Racer {
  seat: number;
  ip: string; name: string; hue: number;
  s: number;                // arc position along the lap
  lat: number;              // lateral offset from the racing line
  seed: number;
  speed: number;
  surge: number;            // traffic draft, decaying
  boost: number;            // pad/sprint kick, decaying faster
  spin: number;             // spin-out timer
  glow: number;             // red chase glow after a threat
  flash: number;            // takeover flash
  ghost: boolean;
  laps: number;
  dist: number;
  act: number;              // exponentially weighted activity (hero pick)
  lastSeen: number;
}

export interface OilSpot { x: number; y: number; life: number }
export interface Shell { s: number; lat: number; life: number }

export interface RaceHooks {
  onLap(seat: number): void;
  onShellHit(): void;
  onPadHit(seat: number): void;
  onSpin(seat: number): void;
}

const hueFor = (key: string): number => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h % 360;
};

const shortName = (se: SceneEvent, ip: string): string => {
  const e = se.ev;
  const host = e.hostname?.trim();
  if (host) return host.toUpperCase();
  if (e.mac_address) return `DEV ${e.mac_address.split(':').slice(-2).join('').toUpperCase()}`;
  return ip || '—';
};

/** The LAN endpoint of an event: inbound targets us, everything else starts inside. */
const lanIp = (se: SceneEvent): string =>
  (se.scope === 'inbound' ? se.ev.dst_ip : se.ev.src_ip) || se.ev.src_ip || '';

export class Race {
  racers: Racer[] = [];
  order: number[] = [];                   // seat indices, P1 first
  heroIdx = 0;
  leaderIdx = 0;
  caution = 0;
  shell: Shell | null = null;
  oils: OilSpot[] = [];
  padLight: number[];
  lastDomain = '';
  private ipSeat = new Map<string, number>();
  private lastHeroSwitch = 0;
  private lastTakeover = -99;
  private lastSpin = -99;
  private lastShell = -99;
  private lastCaution = -99;

  constructor(readonly track: Track, t0: number, private hooks: RaceHooks) {
    for (let i = 0; i < SEATS; i++) {
      this.racers.push({
        seat: i, ip: '', name: 'NO DRIVER', hue: (i * 47 + 20) % 360,
        s: -i * 7, lat: (i % 2 ? 1 : -1) * track.width * 0.16, seed: i * 137.31,
        speed: 0, surge: 0, boost: 0, spin: 0, glow: 0, flash: 0,
        ghost: true, laps: 0, dist: -i * 7, act: 0, lastSeen: t0,
      });
    }
    this.padLight = track.pads.map(() => 0);
    this.order = this.racers.map((r) => r.seat);
  }

  private seatOf(ip: string, se: SceneEvent, t: number): Racer | null {
    if (!ip) return null;
    let idx = this.ipSeat.get(ip);
    if (idx === undefined) {
      // an empty seat first (a ghost nobody claimed) …
      idx = this.racers.findIndex((r) => r.ghost && !r.ip);
      if (idx < 0) {
        // … otherwise the quietest kart pits and a new driver takes over —
        // but only if it has genuinely gone quiet, and never two handovers
        // in a heartbeat (a chatty relay must not churn the grid)
        let oldest = -1, ot = Infinity;
        for (const r of this.racers) {
          if (r.seat === this.heroIdx) continue;
          if (r.lastSeen < ot) { ot = r.lastSeen; oldest = r.seat; }
        }
        if (oldest < 0 || t - ot < 45 || t - this.lastTakeover < 1.5) return null;
        this.lastTakeover = t;
        this.ipSeat.delete(this.racers[oldest].ip);
        idx = oldest;
      }
      this.ipSeat.set(ip, idx);
      const r = this.racers[idx];
      // a takeover: the new driver joins from the back of the pack
      const back = Math.min(...this.racers.map((x) => x.dist));
      r.ip = ip; r.name = shortName(se, ip); r.hue = hueFor(ip);
      r.s = back - 14; r.dist = back - 14; r.laps = 0;   // counted from the moment they join
      r.ghost = false; r.flash = 1;
    }
    const r = this.racers[idx];
    r.lastSeen = t;
    r.act += 1;
    if (r.ghost) { r.ghost = false; r.flash = 1; }
    return r;
  }

  event(se: SceneEvent, t: number, settings: { kDraft: boolean; kBoard: boolean; kPit: boolean; kOil: boolean; kShell: boolean; kPads: boolean; kCaution: boolean }): void {
    const ip = lanIp(se);
    switch (se.kind) {
      case 'allow': {
        const r = settings.kDraft ? this.seatOf(ip, se, t) : null;
        if (r) r.surge += 2.2 + Math.random() * 2.4;
        break;
      }
      case 'dns': {
        const r = this.seatOf(ip, se, t);
        if (r) { r.surge += 4.5; r.boost = Math.max(r.boost, 7); }
        const q = se.ev.dns_query?.trim();
        if (q) this.lastDomain = q;
        break;
      }
      case 'dhcp': {
        const known = this.ipSeat.has(ip);
        const r = this.seatOf(ip, se, t);
        if (r && !known && settings.kPit) r.boost = Math.max(r.boost, 5);   // fresh out of the pit lane
        break;
      }
      case 'block': {
        const r = settings.kOil ? this.seatOf(ip, se, t) : null;
        if (r && r.spin <= 0 && t - this.lastSpin > 2.5) {
          this.lastSpin = t;
          r.spin = 0.9 + Math.random() * 0.5;
          const p = this.track.offset(r.s, r.lat);
          this.oils.push({ x: p.x, y: p.y, life: 9 });
          this.hooks.onSpin(r.seat);
        }
        break;
      }
      case 'threat': {
        if (settings.kShell && !this.shell && t - this.lastShell > 8) {
          this.lastShell = t;
          const leader = this.racers[this.leaderIdx];
          this.shell = { s: leader.s - this.track.total * 0.06, lat: 0, life: 16 };
        }
        const off = ip ? this.ipSeat.get(ip) : undefined;
        if (off !== undefined) this.racers[off].glow = 5;
        break;
      }
      case 'wifi': {
        if (se.wifi === 'joined' && settings.kPads) {
          const i = (Math.random() * this.padLight.length) | 0;
          this.padLight[i] = 7;
        } else if (se.wifi === 'bad') {
          const r = this.seatOf(ip, se, t);
          if (r) r.boost = -4;   // missed the connection, sputters
        }
        break;
      }
      case 'system': {
        if (settings.kCaution && t - this.lastCaution > 25) {
          this.lastCaution = t;
          this.caution = Math.max(this.caution, 8);
        }
        break;
      }
    }
  }

  step(dt: number, t: number, rate30s: number, pace: number): void {
    const tr = this.track;
    const base = 46 * pace * tr.speed * (0.85 + Math.min(1, rate30s / 40) * 0.55);
    this.caution = Math.max(0, this.caution - dt);
    const yellow = this.caution > 0 ? 0.55 : 1;

    for (let oi = this.oils.length - 1; oi >= 0; oi--) {
      this.oils[oi].life -= dt;
      if (this.oils[oi].life <= 0) this.oils.splice(oi, 1);
    }
    for (let i = 0; i < this.padLight.length; i++) this.padLight[i] = Math.max(0, this.padLight[i] - dt);

    // positions first: rubber-band reads the running order
    this.order = this.racers.map((r) => r.seat).sort((a, b) => this.racers[b].dist - this.racers[a].dist);
    this.leaderIdx = this.order[0];

    for (const r of this.racers) {
      const rank = this.order.indexOf(r.seat);
      const rubber = 1 + (rank - 3.5) * 0.026;
      const ghostMul = r.ghost ? 0.72 : 1;
      const target = base * rubber * ghostMul * yellow + r.surge + r.boost;
      r.speed += (Math.max(2, target) - r.speed) * Math.min(1, dt * 0.9);
      if (r.spin > 0) {
        r.spin -= dt;
        r.speed *= 0.2;
      }
      const prev = r.s;
      r.s += r.speed * dt;
      r.dist += r.speed * dt;
      r.lat = Math.sin(t * 0.25 + r.seed) * tr.width * 0.22 + (r.seat % 2 ? 1 : -1) * tr.width * 0.1;
      r.surge *= Math.exp(-dt / 2.6);
      r.boost *= Math.exp(-dt / 1.6);
      r.act *= Math.exp(-dt / 40);
      r.glow = Math.max(0, r.glow - dt);
      r.flash = Math.max(0, r.flash - dt * 1.4);
      if (r.ip && !r.ghost && t - r.lastSeen > 180) r.ghost = true;   // quiet hosts haunt

      // crossing a lap line
      if (Math.floor(r.s / tr.total) > Math.floor(prev / tr.total)) {
        r.laps++;
        this.hooks.onLap(r.seat);
      }
      // boost pads
      for (let p = 0; p < tr.pads.length; p++) {
        if (this.padLight[p] <= 0) continue;
        const pad = tr.pads[p];
        const a = ((prev % tr.total) + tr.total) % tr.total;
        const b = ((r.s % tr.total) + tr.total) % tr.total;
        const crossed = a < b ? (a <= pad && pad < b) : (a <= pad || pad < b);
        if (crossed) {
          r.boost = Math.max(r.boost, 11);
          this.padLight[p] = 0;
          this.hooks.onPadHit(r.seat);
        }
      }
    }

    // the shell closes on the leader
    if (this.shell) {
      const leader = this.racers[this.leaderIdx];
      this.shell.s += base * 2.6 * dt;
      this.shell.lat += (leader.lat - this.shell.lat) * Math.min(1, dt * 2);
      this.shell.life -= dt;
      const gap = leader.s - this.shell.s;
      if (gap < 2.5 && gap > -2) {
        if (leader.spin <= 0) {
          leader.spin = 1.6;
          this.hooks.onShellHit();
        }
        this.shell = null;
      } else if (this.shell.life <= 0) this.shell = null;
    }
  }

  /** The kart the camera rides: busiest host (hysteresis) or the leader. */
  pickHero(camMode: string, t: number): number {
    if (camMode === 'leader') return this.leaderIdx;
    const cur = this.racers[this.heroIdx];
    let best = this.heroIdx, ba = -1;
    for (const r of this.racers) {
      if (r.ghost) continue;
      if (r.act > ba) { ba = r.act; best = r.seat; }
    }
    if (best === this.heroIdx) return this.heroIdx;
    if (ba > cur.act * 1.5 + 2 && t - this.lastHeroSwitch > 5) {
      this.heroIdx = best;
      this.lastHeroSwitch = t;
      this.racers[best].flash = Math.max(this.racers[best].flash, 0.7);
    }
    return this.heroIdx;
  }

  /** World position of a racer, wobbling on its lane like karts do. */
  kartPos(idx: number): { x: number; y: number; s: number; heading: number } {
    const r = this.racers[idx];
    const p = this.track.offset(r.s, r.lat);
    const ahead = this.track.atS(r.s + 6);
    return { x: p.x, y: p.y, s: r.s, heading: Math.atan2(ahead.ty, ahead.tx) };
  }
}
