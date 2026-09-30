import type { Track } from './track';
import type { SceneEvent } from '../../events';
import { characterFor, DRIVERS, KART_L, KART_W, VEH_W, type Character } from './sprites';

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
export type ItemKind = 'mushroom' | 'banana' | 'shell' | 'red' | 'star';

/**
 * The item table, weighted the way a kart racer weights it: plenty of the
 * cheap stuff, and the good stuff turns up often enough to matter. The old
 * code rolled a flat three-way between mushroom, banana and green shell, and
 * only twice a minute at that.
 */
const ITEM_TABLE: ItemKind[] = [
  'mushroom', 'mushroom', 'mushroom',
  'banana', 'banana', 'banana',
  'shell', 'shell', 'shell', 'shell',
  'red', 'red',
  'star',
];

export interface Racer {
  seat: number;
  ip: string; name: string; hue: number; char: Character;
  s: number;                // arc position along the lap
  lat: number;              // lateral offset from the racing line
  latV: number;             // lateral velocity - steering is integrated, so a
                            // shove from body contact stays resolved instead of
                            // being overwritten by next frame's steering
  line: number;             // the lane this driver likes to sit in
  pace: number;             // per-driver ability, so the grid is not a clone army
  draft: number;            // slipstream gain right now, 0..1
  seed: number;
  speed: number;
  surge: number;            // traffic draft, decaying
  boost: number;            // pad/sprint/mushroom kick, decaying faster
  spin: number;             // spin-out timer
  star: number;             // invincible, and everything bounces off
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

/** Half-extents of a kart on the board, straight from the drawn sprite. */
const halfW = (r: Racer): number => KART_W * 0.5 * VEH_W[r.char.veh];
const halfL = (r: Racer): number => KART_L * 0.5 * VEH_W[r.char.veh];

/** Slipstream window: arc gap to the kart ahead, and how far off-line it works. */
const DRAFT_NEAR = 3.5, DRAFT_FAR = 26, DRAFT_WIDE = 5.5;

/**
 * A driver's pace, from its character, so a host always races the same way.
 * The spread has to be wide enough to actually shuffle the order over a lap -
 * the first version drew from the same clustered hash as everything else and
 * the whole grid came out within one speed unit of each other.
 */
const paceFor = (ch: Character): number => 0.90 + ((ch.num * 37 + ch.drv * 11) % 21) / 100;

export interface Hazard { x: number; y: number; life: number; cool: number; kind: 'oil' | 'banana' }
/**
 * A shell on the board. A red one hunts its target; a green one is fired down
 * the road and bounces off the edges until its life runs out or it hits
 * somebody, which is the difference between an item and a guided missile.
 */
export interface Shell {
  s: number; lat: number; life: number;
  kind: 'red' | 'green';
  target: number;            // red only: the seat it is hunting
  latV: number;              // green only: sideways drift, flipped by a bounce
  from: number;              // the seat that fired it, immune for a moment
  armed: number;             // seconds until it can hit its own firer
  prevS: number;             // last frame's position, so the hit test can sweep
}
/**
 * A row of item boxes across the road, the way the game lays them out. Each
 * box has its own respawn: a shared one meant the first kart through took the
 * whole row and the other seven found it empty.
 */
export interface Gantry { s: number; respawn: number; lanes: number[]; taken: number[] }

export interface RaceHooks {
  onLap(seat: number): void;
  onShellHit(seat: number, kind: 'red' | 'green'): void;
  onShellFire(seat: number, kind: 'red' | 'green'): void;
  onPadHit(seat: number): void;
  onSpin(seat: number): void;
  onPickup(seat: number, kind: ItemKind): void;
  onUse(seat: number, kind: ItemKind): void;
}

/** Starting lane for a seat: eight cars spread across the racing line. */
const lineFor = (i: number, width: number): number =>
  (i - (SEATS - 1) / 2) * (width * 0.42 / SEATS);

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
        const hw = halfW(a) + halfW(b), hl = halfL(a) + halfL(b);
        const dl = a.lat - b.lat;
        if (Math.abs(ds) >= hl || Math.abs(dl) >= hw) continue;
        const pen = Math.min(hw - Math.abs(dl), hl - Math.abs(ds));
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
        seat: i, ip: '', name: DRIVERS[characterFor(`seat${i}`).drv % DRIVERS.length].name,
        hue: (i * 47 + 20) % 360, char: characterFor(`seat${i}`),
        s: -i * 7, lat: lineFor(i, track.width), latV: 0, line: lineFor(i, track.width),
        pace: paceFor(characterFor(`seat${i}`)), draft: 0, seed: i * 137.31,
        speed: 0, surge: 0, boost: 0, spin: 0, star: 0, glow: 0, flash: 0,
        // one of the cast, racing properly - a ghost is a host that has gone
        // quiet, not "nobody has connected yet"
        ghost: false, laps: 0, dist: -i * 7, act: 0, lastSeen: t0, item: null, itemT: 0,
      });
    }
    this.padLight = track.pads.map(() => 0);
    // five rows a lap, five boxes across: eight karts pass a row every few
    // seconds, so somebody always has something
    const LANES = 5;
    this.gantries = [0.14, 0.32, 0.5, 0.68, 0.86].map((f) => ({
      s: track.total * f,
      respawn: 0,
      lanes: Array.from({ length: LANES }, (_, k) =>
        (k - (LANES - 1) / 2) * (track.width * 0.62 / LANES)),
      taken: new Array(LANES).fill(0),
    }));
    this.order = this.racers.map((r) => r.seat);
  }

  private seatOf(ip: string, se: SceneEvent, t: number): Racer | null {
    if (!ip) return null;
    let idx = this.ipSeat.get(ip);
    if (idx === undefined) {
      // an empty seat first (a ghost nobody claimed) …
      idx = this.racers.findIndex((r) => !r.ip);
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
      r.pace = paceFor(r.char);          // a new driver brings its own pace
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
          this.shells.push({ s: leader.s - this.track.total * 0.06, lat: 0, life: 16, kind: 'red',
            target: this.leaderIdx, latV: 0, from: -1, armed: 0, prevS: leader.s - this.track.total * 0.06 });
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
    // about ten kart widths: wide enough for two abreast and a dive up the
    // inside, narrow enough that the field is always in each other's way
    const latLim = tr.width * 0.26;

    for (let oi = this.hazards.length - 1; oi >= 0; oi--) {
      this.hazards[oi].life -= dt;
      this.hazards[oi].cool = Math.max(0, this.hazards[oi].cool - dt);
      if (this.hazards[oi].life <= 0) this.hazards.splice(oi, 1);
    }
    for (let i = 0; i < this.padLight.length; i++) this.padLight[i] = Math.max(0, this.padLight[i] - dt);
    for (const g of this.gantries) {
      g.respawn = Math.max(0, g.respawn - dt);
      for (let k = 0; k < g.taken.length; k++) g.taken[k] = Math.max(0, g.taken[k] - dt);
    }

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
      const ghostMul = r.ghost ? 0.88 : 1;
      // The slipstream this scene is named after. Sit in the hole the kart
      // ahead punches in the air and you gain on it; the effect falls off with
      // the gap and with how far off its line you are, so you have to pull out
      // to complete the pass. Without this every racer converged on the same
      // target and all eight sat at exactly speed 31, nobody ever passing.
      let draft = 0;
      for (const o of this.racers) {
        if (o === r) continue;
        let ds = (o.s - r.s) % tr.total;
        if (ds > tr.total / 2) ds -= tr.total;
        if (ds < -tr.total / 2) ds += tr.total;
        if (ds <= DRAFT_NEAR || ds >= DRAFT_FAR) continue;
        const off = Math.abs(o.lat - r.lat);
        if (off >= DRAFT_WIDE) continue;
        const along = 1 - (ds - DRAFT_NEAR) / (DRAFT_FAR - DRAFT_NEAR);
        draft = Math.max(draft, along * (1 - off / DRAFT_WIDE));
      }
      r.draft += (draft - r.draft) * Math.min(1, dt * 4);
      let target = base * rubber * r.pace * ghostMul * yellow * (1 + 0.18 * r.draft)
        + r.surge + r.boost;
      // Closing on the kart ahead: brake to its pace rather than drive into it.
      // Shoving `s` apart after the fact cannot win, because the speed model
      // just drives them back together next frame - 24% of frames still had two
      // karts inside each other. Queueing up behind a slower kart, and having to
      // pull out of the tow to pass, is also what makes a pack read as a pack.
      const gapStop = halfL(r) * 2.1;
      for (const o of this.racers) {
        if (o === r) continue;
        let ds = (o.s - r.s) % tr.total;
        if (ds > tr.total / 2) ds -= tr.total;
        if (ds < -tr.total / 2) ds += tr.total;
        if (ds <= 0 || ds > gapStop) continue;
        if (Math.abs(o.lat - r.lat) > halfW(r) + halfW(o)) continue;
        const close = 1 - ds / gapStop;                 // 0 at the edge, 1 on the bumper
        target = Math.min(target, o.speed + (1 - close) * 14);
      }
      r.speed += (Math.max(2, target) - r.speed) * Math.min(1, dt * 1.4);
      if (r.spin > 0) {
        r.spin -= dt;
        r.speed *= Math.exp(-dt * 3.4);   // frame-rate independent, and recoverable
      }
      const prev = r.s;
      r.s += r.speed * dt;
      r.dist += r.speed * dt;
      // Lateral position is integrated, never assigned. It used to be
      //   r.lat = sin(t*0.25 + seed) * width*0.18 + bias + r.avoid
      // which put every kart on a rail: the solver shoved a pair apart into
      // `avoid`, `avoid` decayed, and the sine pulled them straight back
      // together, so 76% of frames had two karts inside one another. Now the
      // driver steers toward the line it wants and a shove moves the kart.
      const wander = Math.sin(t * 0.21 + r.seed) * tr.width * 0.055;
      // in the tow and running out of road ahead: pull out and have a go
      const pull = r.draft > 0.5 ? (r.line >= 0 ? 1 : -1) * tr.width * 0.11 * (r.draft - 0.5) / 0.5 : 0;
      const want = Math.max(-latLim, Math.min(latLim, r.line + wander + pull));
      r.latV += (want - r.lat) * 3.0 * dt;
      r.latV *= Math.exp(-dt * 2.6);
      r.lat += r.latV * dt;
      if (r.lat > latLim) { r.lat = latLim; r.latV = Math.min(0, r.latV); }
      if (r.lat < -latLim) { r.lat = -latLim; r.latV = Math.max(0, r.latV); }
      r.surge *= Math.exp(-dt / 2.6);
      r.boost *= Math.exp(-dt / 1.6);
      r.act *= Math.exp(-dt / 40);
      r.star = Math.max(0, r.star - dt);
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
        if (r.item) break;
        if (!crossed(prev, r.s, g.s, tr.total)) continue;
        // the nearest box in the row that is still standing
        let lane = -1, bd = 4.2;
        for (let k = 0; k < g.lanes.length; k++) {
          if (g.taken[k] > 0) continue;
          const d = Math.abs(g.lanes[k] - r.lat);
          if (d < bd) { bd = d; lane = k; }
        }
        if (lane < 0) continue;
        r.item = ITEM_TABLE[(Math.random() * ITEM_TABLE.length) | 0];
        r.itemT = 0.6 + Math.random() * 1.2;
        g.taken[lane] = 2.5;
        this.pickedUp++;
        this.hooks.onPickup(r.seat, r.item);
      }
      // …and use it shortly after, so the pack is never polite for long
      if (r.item) {
        r.itemT -= dt;
        if (r.itemT <= 0 && r.spin <= 0) {
          const kind = r.item;
          r.item = null;
          this.used++;
          if (kind === 'mushroom') r.boost = Math.max(r.boost, 15);
          if (kind === 'star') { r.star = 7; r.boost = Math.max(r.boost, 9); }
          if (kind === 'banana') {
            const p = tr.offset(r.s - 9, r.lat);
            this.hazards.push({ x: p.x, y: p.y, life: 45, cool: 0, kind: 'banana' });
          }
          if (kind === 'shell') {
            // fired down the road, not at anybody: it bounces off the edges
            // until it finds a kart or runs out of life
            this.shells.push({
              s: r.s + 3, lat: r.lat, life: 9, kind: 'green', target: -1,
              latV: (Math.random() - 0.5) * 5, from: r.seat, armed: 1.1, prevS: r.s + 3,
            });
            this.hooks.onShellFire(r.seat, 'green');
          }
          if (kind === 'red') {
            const ahead = this.order.map((k) => this.racers[k]).find((x) => x.seat !== r.seat && x.dist > r.dist);
            if (ahead) {
              this.shells.push({
                s: r.s + 3, lat: r.lat, life: 11, kind: 'red', target: ahead.seat,
                latV: 0, from: r.seat, armed: 0.6, prevS: r.s + 3,
              });
              this.hooks.onShellFire(r.seat, 'red');
            } else {
              r.boost = Math.max(r.boost, 15);   // leading: it becomes a mushroom
            }
          }
          this.hooks.onUse(r.seat, kind);
        }
      }
      // hazards: roll over one and spin (with a mercy window)
      // no global cooldown: each hazard has its own, which is the one that
      // matters. A shared timer meant the whole field could only spin once
      // every 1.6s between them however many bananas were lying about.
      if (r.spin <= 0 && r.star <= 0) {
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
    // Karts are solid boxes the size the art draws them. Separate each pair
    // along whichever axis it penetrates least, writing the correction into
    // position rather than into a decaying accumulator, and iterate - one pass
    // through a tight pack only shuffles the overlap along the row.
    const solveLim = tr.width * 0.46;
    for (let pass = 0; pass < 6; pass++) {
      let touched = false;
      for (let i = 0; i < this.racers.length; i++) {
        for (let j = i + 1; j < this.racers.length; j++) {
          const a = this.racers[i], b = this.racers[j];
          let ds = (b.s - a.s) % tr.total;
          if (ds > tr.total / 2) ds -= tr.total;
          if (ds < -tr.total / 2) ds += tr.total;
          const hw = halfW(a) + halfW(b), hl = halfL(a) + halfL(b);
          const dl = b.lat - a.lat;
          if (Math.abs(ds) >= hl || Math.abs(dl) >= hw) continue;
          touched = true;
          const penLat = hw - Math.abs(dl);
          const penLon = hl - Math.abs(ds);
          // side to side is the axis the player reads, so prefer it unless the
          // nose overlap is clearly the shallower one
          if (penLat * 0.62 <= penLon) {
            const dir = dl > 0 ? 1 : dl < 0 ? -1 : (a.seat < b.seat ? -1 : 1);
            const push = penLat * 0.5 + 0.004;
            b.lat += dir * push; a.lat -= dir * push;
            b.latV += dir * push * 2.2; a.latV -= dir * push * 2.2;
            b.lat = Math.max(-solveLim, Math.min(solveLim, b.lat));
            a.lat = Math.max(-solveLim, Math.min(solveLim, a.lat));
          } else {
            const dirS = ds >= 0 ? 1 : -1;          // b sits ahead
            const push = penLon * 0.5 + 0.004;
            b.s += dirS * push; b.dist += dirS * push;
            a.s -= dirS * push; a.dist -= dirS * push;
            const rear = ds >= 0 ? a : b;           // the one behind bogs down
            rear.speed *= Math.max(0, 1 - 1.8 * dt);
          }
        }
      }
      if (!touched) break;
    }

    this.jamAfter = this.jamScan(tr);

    // shells: red ones hunt, green ones fly and bounce
    const edge = tr.width * 0.30;         // a shell bounces off the racing line's edges
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.life -= dt;
      sh.armed = Math.max(0, sh.armed - dt);
      sh.prevS = sh.s;
      sh.s += base * (sh.kind === 'red' ? 2.6 : 2.1) * dt;
      if (sh.kind === 'red') {
        const mark = this.racers[sh.target];
        sh.lat += (mark.lat - sh.lat) * Math.min(1, dt * 2);
      } else {
        // a green leans toward whoever is closest ahead: on a road this wide a
        // shell fired dead straight just finds empty asphalt
        let bestLat = null, bestDs = 70;
        for (const k of this.racers) {
          if (k.seat === sh.from && sh.armed > 0) continue;
          let ds = (k.s - sh.s) % tr.total;
          if (ds > tr.total / 2) ds -= tr.total;
          if (ds < -tr.total / 2) ds += tr.total;
          if (ds <= 0 || ds > bestDs) continue;
          bestDs = ds; bestLat = k.lat;
        }
        if (bestLat !== null) sh.latV += (bestLat - sh.lat) * 1.6 * dt;
        sh.lat += sh.latV * dt;
        if (sh.lat > edge) { sh.lat = edge; sh.latV = -Math.abs(sh.latV); }
        if (sh.lat < -edge) { sh.lat = -edge; sh.latV = Math.abs(sh.latV); }
      }
      // Anything it catches, not just the one it was aimed at - and tested
      // across the whole step, not at a point. A shell covers about 1.4 units
      // a frame against a window barely two units wide, so a point test walked
      // straight through karts: measured, ten shells in a minute, every one
      // living out its full life without ever landing.
      let hitSeat = -1;
      const travelled = sh.s - sh.prevS;
      for (const k of this.racers) {
        if (k.seat === sh.from && sh.armed > 0) continue;
        if (k.spin > 0 || k.star > 0) continue;
        let ds = (k.s - sh.s) % tr.total;
        if (ds > tr.total / 2) ds -= tr.total;
        if (ds < -tr.total / 2) ds += tr.total;
        // the kart is on the segment the shell just swept, plus its own length
        const reach = halfL(k) + Math.max(0, travelled);
        if (ds > halfL(k) || ds < -reach) continue;
        if (Math.abs(k.lat - sh.lat) > halfW(k) + 2.4) continue;
        hitSeat = k.seat; break;
      }
      if (hitSeat >= 0) {
        const mark = this.racers[hitSeat];
        if (mark.spin <= 0) {
          mark.spin = 1.5;
          this.hooks.onShellHit(mark.seat, sh.kind);
        }
        this.shells.splice(i, 1);
      } else if (sh.life <= 0) this.shells.splice(i, 1);
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
