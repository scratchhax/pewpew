import type { Track } from './track';
import type { SceneEvent } from '../../events';
import { characterFor, VEH_W, type Character } from './sprites';

/**
 * The race. Exactly eight karts, always: a seat belongs to a host, never to
 * an event. Traffic pushes its racer forward, DNS gives it a sprint, blocks
 * leave oil under it, threats fire a red shell at the leader, Wi-Fi joins
 * light the boost pads, and system logs throw a yellow caution over the lot.
 * Two item gantries deal out mushrooms, bananas and green shells so the pack
 * never rides politely, and the rubber-band is the Mario Kart kind: whoever
 * is furthest behind gets the strongest wind, so the leader never rides away.
 * A host that goes quiet becomes a ghost and holds its seat until a new
 * driver (DHCP, or any first sight of it in traffic) takes it over.
 */

export const SEATS = 8;
export type ItemKind = 'mushroom' | 'banana' | 'shell';

export interface Racer {
  seat: number;
  ip: string; name: string; hue: number; char: Character;
  s: number;                // arc position along the lap
  lat: number;              // lateral offset from the racing line
  avoid: number;            // persistent shove from body contact
  seed: number;
  speed: number;
  surge: number;            // traffic draft, decaying
  boost: number;            // pad/sprint/mushroom kick, decaying faster
  spin: number;             // spin-out timer
  glow: number;             // red chase glow after a threat
  flash: number;            // takeover flash
  ghost: boolean;
  laps: number;
  dist: number;
  act: number;              // exponentially weighted activity (hero pick)
  lastSeen: number;
  item: ItemKind | null;    // held item, auto-used shortly after pickup
  itemT: number;
}

export interface Hazard { x: number; y: number; life: number; cool: number; kind: 'oil' | 'banana' }
export interface Shell { s: number; lat: number; life: number; kind: 'red' | 'green'; target: number }
export interface Gantry { s: number; respawn: number }

export interface RaceHooks {
  onLap(seat: number): void;
  onShellHit(seat: number, kind: 'red' | 'green'): void;
  onShellFire(seat: number, kind: 'red' | 'green'): void;
  onPadHit(seat: number): void;
  onSpin(seat: number): void;
  onPickup(seat: number, kind: ItemKind): void;
  onUse(seat: number, kind: ItemKind): void;
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

/** Did a racer sweep past arc position `pos` between prev and s (lap-aware)? */
function crossed(prev: number, s: number, pos: number, total: number): boolean {
  const a = ((prev % total) + total) % total;
  const b = ((s % total) + total) % total;
  return a < b ? (a <= pos && pos < b) : (a <= pos || pos < b);
}

export class Race {
  racers: Racer[] = [];
  order: number[] = [];                   // seat indices, P1 first
  heroIdx = 0;
  leaderIdx = 0;
  caution = 0;
  shells: Shell[] = [];
  hazards: Hazard[] = [];
  jamBefore = 0; jamAfter = 0; jamPair: [number, number] | null = null;

  private jamScan(tr: Track): number {
    let worst = 0;
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        let ds = (b.s - a.s) % tr.total;
        if (ds > tr.total / 2) ds -= tr.total;
        if (ds < -tr.total / 2) ds += tr.total;
        const hw = 1.98 * (VEH_W[a.char.veh] + VEH_W[b.char.veh]);
        const dl = a.lat - b.lat;
        if (Math.abs(ds) >= hw * 0.95 || Math.abs(dl) >= hw) continue;
        const pen = Math.min(hw - Math.abs(dl), hw * 0.95 - Math.abs(ds));
        if (pen > worst) { worst = pen; this.jamPair = [a.seat, b.seat]; }
      }
    }
    return worst;
  }
  gantries: Gantry[];
  padLight: number[];
  lastDomain = '';
  pickedUp = 0;
  used = 0;
  private ipSeat = new Map<string, number>();
  private lastHeroSwitch = 0;
  private lastTakeover = -99;
  private lastSpin = -99;
  private lastShell = -99;
  private lastCaution = -99;

  constructor(readonly track: Track, t0: number, private hooks: RaceHooks) {
    for (let i = 0; i < SEATS; i++) {
      this.racers.push({
        seat: i, ip: '', name: 'NO DRIVER', hue: (i * 47 + 20) % 360, char: characterFor(`seat${i}`),
        s: -i * 7, lat: (i % 2 ? 1 : -1) * track.width * 0.16, avoid: 0, seed: i * 137.31,
        speed: 0, surge: 0, boost: 0, spin: 0, glow: 0, flash: 0,
        ghost: true, laps: 0, dist: -i * 7, act: 0, lastSeen: t0, item: null, itemT: 0,
      });
    }
    this.padLight = track.pads.map(() => 0);
    this.gantries = [{ s: track.total * 0.28, respawn: 0 }, { s: track.total * 0.72, respawn: 0 }];
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
      r.ip = ip; r.name = shortName(se, ip); r.hue = hueFor(ip); r.char = characterFor(ip);
      r.s = back - 14; r.dist = back - 14; r.laps = 0;   // counted from the moment they join
      r.item = null; r.spin = 0; r.surge = 0; r.boost = 0;
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
        // draft spam buys a nudge, not immunity
        if (r) r.surge = Math.min(6, r.surge + 1.6 + Math.random() * 1.6);
        break;
      }
      case 'dns': {
        const r = this.seatOf(ip, se, t);
        if (r) { r.surge = Math.min(8, r.surge + 3.5); r.boost = Math.max(r.boost, 6); }
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
          this.hazards.push({ x: p.x, y: p.y, life: 9, cool: 0, kind: 'oil' });
          this.hooks.onSpin(r.seat);
        }
        break;
      }
      case 'threat': {
        if (settings.kShell && !this.shells.some((s) => s.kind === 'red') && t - this.lastShell > 8) {
          this.lastShell = t;
          const leader = this.racers[this.leaderIdx];
          this.shells.push({ s: leader.s - this.track.total * 0.06, lat: 0, life: 16, kind: 'red', target: this.leaderIdx });
          this.hooks.onShellFire(-1, 'red');
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

    for (let oi = this.hazards.length - 1; oi >= 0; oi--) {
      this.hazards[oi].life -= dt;
      this.hazards[oi].cool = Math.max(0, this.hazards[oi].cool - dt);
      if (this.hazards[oi].life <= 0) this.hazards.splice(oi, 1);
    }
    for (let i = 0; i < this.padLight.length; i++) this.padLight[i] = Math.max(0, this.padLight[i] - dt);
    for (const g of this.gantries) g.respawn = Math.max(0, g.respawn - dt);

    // positions first: the rubber-band reads the running order
    this.order = this.racers.map((r) => r.seat).sort((a, b) => this.racers[b].dist - this.racers[a].dist);
    this.leaderIdx = this.order[0];
    const leaderDist = this.racers[this.leaderIdx].dist;

    for (const r of this.racers) {
      const rank = this.order.indexOf(r.seat);
      // Mario Kart law: catch-up strength scales with the gap, not the rank;
      // and the leader eases off the throttle, so nobody rides away
      const gap = Math.max(0, leaderDist - r.dist);
      const rubber = Math.min(1.38, 1 + gap / (tr.total * 0.7)) * (rank === 0 ? 0.9 : 1);
      const ghostMul = r.ghost ? 0.8 : 1;
      const target = base * rubber * ghostMul * yellow + r.surge + r.boost;
      r.speed += (Math.max(2, target) - r.speed) * Math.min(1, dt * 0.9);
      if (r.spin > 0) {
        r.spin -= dt;
        r.speed *= Math.exp(-dt * 3.4);   // frame-rate independent, and recoverable
      }
      const prev = r.s;
      r.s += r.speed * dt;
      r.dist += r.speed * dt;
      r.lat = Math.sin(t * 0.25 + r.seed) * tr.width * 0.18 + (r.seat % 2 ? 1 : -1) * tr.width * 0.07 + r.avoid;
      r.avoid *= Math.exp(-dt / 4.5);
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
        if (crossed(prev, r.s, tr.pads[p], tr.total)) {
          r.boost = Math.max(r.boost, 11);
          this.padLight[p] = 0;
          this.hooks.onPadHit(r.seat);
        }
      }
      // item gantries: roll under the box, take what's inside
      for (const g of this.gantries) {
        if (g.respawn > 0 || r.item) continue;
        if (crossed(prev, r.s, g.s, tr.total)) {
          const kinds: ItemKind[] = ['mushroom', 'banana', 'shell'];
          r.item = kinds[(Math.random() * 3) | 0];
          r.itemT = 1.5 + Math.random() * 1.8;
          g.respawn = 6;
          this.pickedUp++;
          this.hooks.onPickup(r.seat, r.item);
        }
      }
      // …and use it shortly after, so the pack is never polite for long
      if (r.item) {
        r.itemT -= dt;
        if (r.itemT <= 0 && r.spin <= 0) {
          const kind = r.item;
          r.item = null;
          this.used++;
          if (kind === 'mushroom') r.boost = Math.max(r.boost, 15);
          if (kind === 'banana') {
            const p = tr.offset(r.s - 9, r.lat);
            this.hazards.push({ x: p.x, y: p.y, life: 45, cool: 0, kind: 'banana' });
          }
          if (kind === 'shell') {
            const ahead = this.order.map((s) => this.racers[s]).find((x) => x.seat !== r.seat && x.dist > r.dist);
            if (ahead) {
              this.shells.push({ s: r.s + 2, lat: r.lat, life: 12, kind: 'green', target: ahead.seat });
              this.hooks.onShellFire(r.seat, 'green');
            } else {
              r.boost = Math.max(r.boost, 15);   // leading from the front: the shell becomes a mushroom
            }
          }
          this.hooks.onUse(r.seat, kind);
        }
      }
      // hazards: roll over one and spin (with a mercy window)
      if (r.spin <= 0 && t - this.lastSpin > 1.6) {
        const p = this.kartPos(r.seat);
        for (const h of this.hazards) {
          if (h.cool <= 0 && (h.x - p.x) ** 2 + (h.y - p.y) ** 2 < 9) {
            this.lastSpin = t;
            h.cool = 3;   // one kart spins per slip, not every frame it lingers
            r.spin = 0.8 + Math.random() * 0.4;
            this.hooks.onSpin(r.seat);
            break;
          }
        }
      }
    }

    this.jamBefore = this.jamScan(tr);
    // karts are solid boxes on the board, not ghosts: resolve every pair
    // along whichever axis penetrates least — shove side by side, or shove
    // apart nose-to-tail so a tailgate never slides through a rear wing
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        let ds = (b.s - a.s) % tr.total;
        if (ds > tr.total / 2) ds -= tr.total;
        if (ds < -tr.total / 2) ds += tr.total;
        const hwA = 1.98 * VEH_W[a.char.veh], hwB = 1.98 * VEH_W[b.char.veh];
        const hw = hwA + hwB;                       // full widths, no discount
        const hl = hw * 0.95;                       // billboards spread their width in depth too
        const dl = a.lat - b.lat;
        if (Math.abs(ds) >= hl || Math.abs(dl) >= hw) continue;
        const penLat = hw - Math.abs(dl);
        const penLon = hl - Math.abs(ds);
        // always separate side to side — that is the axis the player sees…
        const push = penLat * 0.5 + 0.02;
        const dir = dl > 0 ? 1 : dl < 0 ? -1 : (a.seat < b.seat ? -1 : 1);
        a.avoid += dir * push; b.avoid -= dir * push;
        const lim = tr.width * 0.42;
        a.avoid = Math.max(-lim, Math.min(lim, a.avoid));
        b.avoid = Math.max(-lim, Math.min(lim, b.avoid));
        // …and when it was more a nose bump than a side swipe, separate
        // along the track too, so nobody's front end sits in a rear wing
        if (penLon > 0.12 && Math.abs(dl) < hw * 0.7) {
          const dirS = ds >= 0 ? 1 : -1;            // b sits ahead
          b.s += dirS * penLon * 0.5; a.s -= dirS * penLon * 0.5;
          if (ds >= 0) a.speed *= 1 - 0.9 * dt; else b.speed *= 1 - 0.9 * dt;   // rear kart bogs down
        }
      }
    }

    this.jamAfter = this.jamScan(tr);

    // shells close on their mark
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      const mark = this.racers[sh.target];
      sh.s += base * 2.6 * dt;
      sh.lat += (mark.lat - sh.lat) * Math.min(1, dt * 2);
      sh.life -= dt;
      const gap = mark.s - sh.s;
      if (gap < 2.5 && gap > -2) {
        if (mark.spin <= 0) {
          mark.spin = 1.5;
          this.hooks.onShellHit(mark.seat, sh.kind);
        }
        this.shells.splice(i, 1);
      } else if (sh.life <= 0 || (sh.kind === 'red' && gap > tr.total * 0.5)) this.shells.splice(i, 1);
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
