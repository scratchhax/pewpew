import type { SceneEvent } from '../../events';
import type { FrameInfo, RendererInit, Theme, ThemeHost, ThemeInstance } from '../../theme';
import { SLIP_BUDGETS, SLIP_CONTROLS, SLIP_DEFAULTS, SLIP_HUD } from './settings';
import { slipScore, engineSpeed } from './score';
import { Mode7 } from './mode7';
import { buildTrack, type Track } from './track';
import { Race, SEATS } from './race';
import * as Sprites from './sprites';
import { KART_H } from './sprites';

/**
 * How tall each thing stands on the board, in board units, measured against a
 * kart. Every drawSprite call sizes itself from here, so the whole scene can be
 * checked against one number instead of a scattering of magic widths.
 */
const H_SHADOW = KART_H * 0.43;    // a flat smudge as wide as the tyres
const H_BOX = KART_H * 0.72;       // item box: chest high on a driver
const H_SHELL = KART_H * 0.34;     // a shell is a thing you trip over
const H_BANANA = KART_H * 0.20;
const H_HAZARD = KART_H * 0.24;
const H_FLAME = KART_H * 0.5;
const H_LABEL = KART_H * 0.17;     // the name tag floating over the helmet
const H_GLOW = KART_H * 1.15;
const H_BOARD = KART_H * 2.6;      // the trackside flip board
import { board as boardSprite, banana, flame, ghost, itemBox, kartFront, kartRear, kartSide, label, mushroom, oil, shadow, shell, VEH_W, type Character } from './sprites';
import type { ItemKind } from './race';
import './hud.css';

/**
 * SLIPSTREAM: an eight-kart grand prix in the 16-bit Mode 7 look — the whole
 * circuit is one bitmap the board spins and scales under your kart. Your
 * network fields the grid: every seat is a host (never an event), traffic is
 * the draft that pushes its racer forward, DNS sprints it, DHCP hands the
 * quiet karts to new drivers, blocks leave oil, Wi-Fi joins light the boost
 * pads, system logs throw a yellow — and when the IDS barks, a red shell
 * screams off the back of the pack for the leader. The camera rides the
 * busiest host on the grid, or the leader if you would rather watch the race
 * than your own traffic.
 */
export const slipstream: Theme<typeof SLIP_DEFAULTS> = {
  id: 'slipstream',
  title: 'Slipstream',
  hud: SLIP_HUD,
  accentHue: 50,
  defaults: SLIP_DEFAULTS,
  budgets: SLIP_BUDGETS,
  controls: SLIP_CONTROLS,
  score: slipScore,
  create,
};
export default slipstream;

async function create(host: ThemeHost<typeof SLIP_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  void init;

  const canvas = document.createElement('canvas');
  host.mount.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const m7 = new Mode7(canvas, ctx);
  const sky = m7.bakeSky();
  let track: Track = buildTrack(settings.kTrack, location.hostname);

  // ── HUD furniture ──
  const hud = document.createElement('div');
  hud.innerHTML = `
    <div id="slip-count"></div>
    <div id="slip-order"><div class="pos"><b>P1</b><i>/8</i></div><div class="who">—</div></div>
    <div id="slip-kmh"><b>0</b> <span>km/h</span></div>
    <div id="slip-item"><canvas width="34" height="34"></canvas></div>
    <div id="slip-map"><canvas width="118" height="118"></canvas><div class="cap">CIRCUIT</div></div>
    <div id="slip-caution">CAUTION — PACK EASING</div>
    <div id="slip-flash"></div>`;
  host.mount.appendChild(hud);
  const q = (s: string): HTMLElement => hud.querySelector(s) as HTMLElement;
  const countEl = q('#slip-count'), posEl = q('#slip-order .pos'), whoEl = q('#slip-order .who');
  const kmhEl = q('#slip-kmh b'), mapEl = q('#slip-map'), mapCv = q('#slip-map canvas') as HTMLCanvasElement;
  const itemCv = q('#slip-item canvas') as HTMLCanvasElement, itemEl = q('#slip-item');
  const cautionEl = q('#slip-caution'), flashEl = q('#slip-flash');
  const mapCtx = mapCv.getContext('2d')!;
  const itemCtx = itemCv.getContext('2d')!;

  let race: Race;
  const hooks = {
    onLap: (seat: number) => { if (seat === race.heroIdx && throttle.allow('lap', 2)) audio.sfx('lap', {}); },
    onShellHit: (_seat: number, kind: 'red' | 'green') => { audio.sfx(kind === 'red' ? 'shellhit' : 'spin', { pan: (_seat - 3.5) * 0.2 }); },
    onShellFire: (seat: number, kind: 'red' | 'green') => { if (seat === race.heroIdx || throttle.allow('shellfire', 1.2)) audio.sfx('shell', { pan: kind === 'red' ? 0 : (seat - 3.5) * 0.2 }); },
    onPadHit: (seat: number) => { if (seat === race.heroIdx) audio.sfx('boost', { pan: 0 }); else audio.sfx('pad', { pan: (seat - 3.5) * 0.2 }); },
    onSpin: (seat: number) => { if (seat === race.heroIdx || throttle.allow('spinother', 1.5)) audio.sfx('spin', { pan: (seat - 3.5) * 0.2 }); },
    onPickup: (seat: number) => { if (seat === race.heroIdx) audio.sfx('pickup', {}); },
    onUse: (seat: number, kind: ItemKind) => {
      if (seat === race.heroIdx) audio.sfx(kind === 'mushroom' ? 'boost' : kind === 'shell' ? 'shell' : 'pit', { pan: 0 });
    },
  };
  race = new Race(track, 0, hooks);

  // ── sprites ──
  const shellRed = shell('#d0262c', '#7a1216');
  const shellGreen = shell('#2ea043', '#14532d');
  const boxSpr = itemBox();
  const bananaSpr = banana();
  const mushroomSpr = mushroom();
  const oilSpr = oil();
  const flameSpr = flame();
  const shadowSpr = shadow();
  const ksprCache = new Map<string, { rear: HTMLCanvasElement; front: HTMLCanvasElement; side: HTMLCanvasElement }>();
  const karts = (hue: number, ch: Character, wf = 0): { rear: HTMLCanvasElement; front: HTMLCanvasElement; side: HTMLCanvasElement } => {
    const key = `${hue}|${ch.num}|${ch.pat}|${ch.acc}|${ch.veh}|${wf}`;
    let e = ksprCache.get(key);
    if (!e) {
      e = { rear: kartRear(hue, ch, wf), front: kartFront(hue, ch), side: kartSide(hue, ch) };
      if (ksprCache.size > 128) ksprCache.clear();
      ksprCache.set(key, e);
    }
    return e;
  };
  const ghostCache = new Map<string, HTMLCanvasElement>();
  const ghostRear = (hue: number, ch: Character): HTMLCanvasElement => {
    const key = `${hue}|${ch.num}|${ch.pat}|${ch.acc}|${ch.veh}`;
    let g = ghostCache.get(key);
    if (!g) { g = ghost(kartRear(hue, ch)); ghostCache.set(key, g); }
    return g;
  };
  const labelCache = new Map<string, HTMLCanvasElement>();
  const nameLabel = (name: string, rank: number, hue: number): HTMLCanvasElement => {
    const key = `${name}|${rank}|${hue}`;
    let l = labelCache.get(key);
    if (!l) {
      l = label(name, rank, hue);
      if (labelCache.size > 120) labelCache.clear();
      labelCache.set(key, l);
    }
    return l;
  };
  let boardSpr = boardSprite('PEWPEW LAN', 50);
  let boardDomain = '';

  // ── camera state ──
  const start = track.atS(0);
  let camX = start.x, camY = start.y, camHeading = Math.atan2(start.ty, start.tx);
  let lastHero = -1;
  let countdown = 4.6;          // 3 … 2 … 1 … GO!
  let lastLabel = '';
  let go = false;

  let clock = 0;
  let mapT: { sc: number; ox: number; oy: number } | null = null;
  let mapPath: Path2D | null = null;

  function rebuildTrack(): void {
    track = buildTrack(settings.kTrack, location.hostname);
    race = new Race(track, clock, hooks);
    mapT = null;
  }

  const resize = (): void => {
    m7.resize(window.innerWidth, window.innerHeight, Math.max(120, settings.kRows * (init.resolution || 1)));
    mapT = null;
  };
  window.addEventListener('resize', resize);
  resize();

  const flags = (replay: boolean) => ({
    kDraft: settings.kDraft, kBoard: settings.kBoard, kPit: settings.kPit,
    kOil: settings.kOil && !replay, kShell: settings.kShell && !replay,
    kPads: settings.kPads && !replay, kCaution: settings.kCaution && !replay,
  });

  function drawMap(): void {
    const S = 118;
    mapCtx.clearRect(0, 0, S, S);
    if (!mapT || !mapPath) {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let i = 0; i < track.xs.length; i++) {
        minX = Math.min(minX, track.xs[i]); maxX = Math.max(maxX, track.xs[i]);
        minY = Math.min(minY, track.ys[i]); maxY = Math.max(maxY, track.ys[i]);
      }
      const sc = (S - 16) / Math.max(maxX - minX, maxY - minY);
      mapT = {
        sc,
        ox: 8 + ((S - 16) - (maxX - minX) * sc) / 2 - minX * sc,
        oy: 8 + ((S - 16) - (maxY - minY) * sc) / 2 - minY * sc,
      };
      mapPath = new Path2D();
      for (let i = 0; i <= track.xs.length; i++) {
        const j = i % track.xs.length;
        const x = track.xs[j] * sc + mapT.ox, y = track.ys[j] * sc + mapT.oy;
        if (i === 0) mapPath.moveTo(x, y); else mapPath.lineTo(x, y);
      }
    }
    mapCtx.strokeStyle = 'rgba(220, 216, 200, 0.45)';
    mapCtx.lineWidth = Math.max(2, track.width * 0.55 * mapT.sc);
    mapCtx.lineJoin = 'round';
    mapCtx.stroke(mapPath);
    for (const r of race.racers) {
      const pos = track.offset(r.s, r.lat);
      mapCtx.fillStyle = r.ghost ? 'rgba(150, 156, 170, 0.5)' : `hsl(${r.hue}, 80%, 62%)`;
      mapCtx.beginPath();
      mapCtx.arc(pos.x * mapT.sc + mapT.ox, pos.y * mapT.sc + mapT.oy, r.seat === race.heroIdx ? 3.6 : 2.3, 0, Math.PI * 2);
      mapCtx.fill();
      if (r.seat === race.heroIdx) {
        mapCtx.strokeStyle = '#fff';
        mapCtx.lineWidth = 1;
        mapCtx.stroke();
      }
    }
  }

  function frame(f: FrameInfo): void {
    clock = f.t;
    const dt = f.dt, dtr = f.dtReal;

    // ── the lights (countdown keeps ticking after GO so it can clear itself) ──
    countdown -= dtr;
    if (!go && countdown > 0.6) {
      const label3 = String(Math.max(1, Math.min(3, Math.ceil(countdown - 0.6))));
      if (label3 !== lastLabel) {
        lastLabel = label3;
        countEl.textContent = label3;
        countEl.classList.add('on');
        countEl.classList.remove('go');
        audio.sfx('count', {});
      }
    } else if (!go && countdown <= 0.6) {
      go = true;
      countEl.textContent = 'GO!';
      countEl.classList.add('on', 'go');
      audio.sfx('go', {});
    }
    if (go && countdown <= -1.1 && countEl.classList.contains('on')) countEl.classList.remove('on');

    if (go) race.step(dt, f.t, state.rate30s, settings.kPace);

    const heroIdx = race.pickHero(settings.kCam, f.t);
    const hero = race.racers[heroIdx];
    if (lastHero >= 0 && heroIdx !== lastHero) {
      flashEl.classList.add('on');
      setTimeout(() => flashEl.classList.remove('on'), 50);
    }
    lastHero = heroIdx;

    // ── camera: behind the hero, looking a car-length ahead ──
    const hp = race.kartPos(heroIdx);
    const back = 9 + hero.speed * 0.035;
    const behind = track.offset(hp.s - back, hero.lat * 0.55);
    const aim = track.atS(hero.s + 7);
    camX += (behind.x - camX) * Math.min(1, dtr * 3.6);
    camY += (behind.y - camY) * Math.min(1, dtr * 3.6);
    const wobble = settings.kWobble && go ? Math.sin(f.t * 1.35) * 0.045 * Math.min(1.4, hero.speed / 52) : 0;
    let dh = Math.atan2(aim.ty, aim.tx) + wobble - camHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    camHeading += dh * Math.min(1, dtr * 2.9);

    const speedFrac = Math.min(1.4, hero.speed / 52);
    const cam = {
      x: camX + f.wanderX * 0.04, y: camY, heading: camHeading, speedFrac,
      bob: Math.sin(f.t * 0.8) * 1.5 + f.wanderY * 0.02,
    };
    m7.renderGround(cam, track.px, sky);

    // ── sprites, back to front ──
    const draws: Array<{ depth: number; run: () => void }> = [];
    for (const hz of race.hazards) {
      const p = m7.project(hz.x, hz.y, cam);
      if (!p) continue;
      const spr = hz.kind === 'oil' ? oilSpr : bananaSpr;
      const ww = hz.kind === 'oil' ? H_HAZARD * 0.7 : H_BANANA;
      draws.push({ depth: p.depth, run: () => m7.drawSprite(spr, hz.x, hz.y, cam, ww, Math.min(1, hz.life / 2)) });
    }
    for (const g of race.gantries) {
      if (g.respawn > 0) continue;
      const gp = track.offset(g.s, 0);
      const p = m7.project(gp.x, gp.y, cam);
      if (p) draws.push({ depth: p.depth, run: () => m7.drawSprite(boxSpr, gp.x, gp.y, cam, H_BOX, 1, KART_H * 0.5 + Math.sin(f.t * 3) * 0.12) });
    }
    const bpos = track.offset(track.boardS, -(track.width / 2 + 34));
    const bpp = m7.project(bpos.x, bpos.y, cam);
    if (bpp) draws.push({ depth: bpp.depth, run: () => m7.drawSprite(boardSpr, bpos.x, bpos.y, cam, H_BOARD, 1, 1.4) });
    for (const r of race.racers) {
      if (r.seat === heroIdx) continue;
      const p = race.kartPos(r.seat);
      const pr = m7.project(p.x, p.y, cam);
      if (!pr) continue;
      const toR = Math.atan2(p.y - camY, p.x - camX);
      const relAng = Math.atan2(Math.sin(toR - camHeading), Math.cos(toR - camHeading));
      const side = Math.abs(relAng) > 1.1;
      const facingBack = Math.cos(p.heading - camHeading) < -0.2;
      const wf = r.ghost ? 0 : ((f.t * (16 + r.speed * 0.38)) | 0) % 4;
      const spr = r.ghost ? ghostRear(r.hue, r.char) : side ? karts(r.hue, r.char).side : facingBack ? karts(r.hue, r.char).front : karts(r.hue, r.char, wf).rear;
      const alpha = r.ghost ? 0.42 : r.flash > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(r.flash * 20)) : 1;
      const lift = r.spin > 0 ? Math.abs(Math.sin(r.spin * 9)) * 0.25 : 0;
      draws.push({ depth: pr.depth + 0.02, run: () => m7.drawSprite(shadowSpr, p.x, p.y, cam, H_SHADOW * VEH_W[r.char.veh], r.ghost ? 0.3 : 1) });
      if (r.boost > 1 && !r.ghost && pr.depth < 280) {
        const fl = H_FLAME * VEH_W[r.char.veh] * (((f.t * 26 + r.seat * 7) | 0) % 2 ? 1 : 0.8);
        const bx = p.x - Math.cos(p.heading) * 1.9, by = p.y - Math.sin(p.heading) * 1.9;
        draws.push({ depth: pr.depth + 0.01, run: () => m7.drawSprite(flameSpr, bx, by, cam, fl, 0.9, 0.1) });
      }
      draws.push({ depth: pr.depth, run: () => m7.drawSprite(spr, p.x, p.y, cam, KART_H * VEH_W[r.char.veh], alpha, lift) });
      // name + position tag floating over the helmet
      if (pr.depth < 320) {
        const rank = race.order.indexOf(r.seat) + 1;
        const lbl = nameLabel(r.name, rank, r.hue);
        // fixed height, width follows the text - the old rule scaled the tag's
        // world size with its character count, so a long name was a billboard
        // wider than the kart carrying it
        draws.push({ depth: pr.depth - 0.02, run: () => m7.drawSprite(lbl, p.x, p.y, cam, H_LABEL, r.ghost ? 0.5 : 0.92, KART_H * 1.02) });
      }
      if (r.glow > 0 && pr.depth < 240) {
        draws.push({ depth: pr.depth - 0.03, run: () => m7.drawSprite(glowSpr(), p.x, p.y, cam, H_GLOW, 0.4 * Math.min(1, r.glow)) });
      }
    }
    for (const sh of race.shells) {
      const sp = track.offset(sh.s, sh.lat);
      const pr = m7.project(sp.x, sp.y, cam);
      if (!pr) continue;
      draws.push({ depth: pr.depth, run: () => m7.drawSprite(sh.kind === 'red' ? shellRed : shellGreen, sp.x, sp.y, cam, H_SHELL, 1, 0.2) });
      if (pr.depth < 26 && throttle.allow('shellwhoosh', 1.1)) {
        audio.sfx('shell', { pan: pr.sx > m7.W / 2 ? 0.6 : -0.6 });
      }
    }
    draws.sort((a, b) => b.depth - a.depth);
    for (const d of draws) d.run();

    // ── your kart: the fixed anchor above the bottom of the board ──
    const heroWf = ((f.t * (14 + speedFrac * 34)) | 0) % 4;
    const kartSpr = hero.ghost ? ghostRear(hero.hue, hero.char) : karts(hero.hue, hero.char, heroWf).rear;
    // sized by height, like every other sprite, so the hero kart is the same
    // machine as the ones it is racing rather than a differently scaled one
    const kh = Math.round(m7.H * (0.20 + speedFrac * 0.018)) * VEH_W[hero.char.veh];
    const kw = Math.round(kh * (kartSpr.width / kartSpr.height));
    const steer = Math.max(-1, Math.min(1, dh * 2.2)) * kw * 0.22;
    const bounce = speedFrac * 1.2 * Math.sin(f.t * 24);
    const kartY = Math.round(m7.H - kh - Math.max(7, Math.round(m7.H * 0.08)) + bounce);
    if (hero.boost > 0.5) {
      const flick = ((f.t * 24) | 0) % 2 ? 1 : 0.82;
      const fw = kw * 0.62 * flick, fh = fw * (flameSpr.height / flameSpr.width);
      ctx.drawImage(flameSpr, Math.round(m7.W / 2 - fw / 2 + steer), Math.round(kartY + kh - fh * 0.45), fw, fh);
    }
    ctx.drawImage(kartSpr, Math.round(m7.W / 2 - kw / 2 + steer), kartY, kw, kh);

    // always running, sharpening with pace, and a kick on top under a boost
    const chev = settings.kChevrons
      ? Math.min(0.95, 0.10 + speedFrac * 0.42 + Math.max(0, hero.boost - 3.5) / 14)
      : 0;
    m7.drawChevrons(chev, f.t);
    engineSpeed(Math.min(1, speedFrac));

    // ── HUD ──
    const rank = race.order.indexOf(heroIdx) + 1;
    posEl.innerHTML = `<b>P${rank}</b><i>/${SEATS}</i>`;
    whoEl.textContent = `${hero.name}${hero.laps > 0 ? `  ·  LAP ${hero.laps}` : ''}`;
    whoEl.classList.toggle('ghost', hero.ghost);
    kmhEl.textContent = String(Math.round(hero.speed * 2.05));
    cautionEl.classList.toggle('on', race.caution > 0);
    // item slot: what the hero is holding
    itemCtx.clearRect(0, 0, 34, 34);
    if (hero.item) {
      const spr = hero.item === 'mushroom' ? mushroomSpr : hero.item === 'banana' ? bananaSpr : shellGreen;
      itemCtx.imageSmoothingEnabled = false;
      itemCtx.drawImage(spr, 3, 3, 28, 28);
      itemEl.classList.add('lit');
    } else {
      itemCtx.strokeStyle = 'rgba(200, 196, 180, 0.25)';
      itemCtx.lineWidth = 2;
      itemCtx.strokeRect(3, 3, 28, 28);
      itemCtx.fillStyle = 'rgba(200, 196, 180, 0.25)';
      itemCtx.font = 'bold 16px monospace';
      itemCtx.textAlign = 'center';
      itemCtx.textBaseline = 'middle';
      itemCtx.fillText('?', 17, 18);
      itemEl.classList.remove('lit');
    }
    mapEl.style.display = settings.kMinimap ? '' : 'none';
    if (settings.kMinimap && Math.round(f.t * 4) % 2 === 0) drawMap();
    if (race.lastDomain && race.lastDomain !== boardDomain) {
      boardDomain = race.lastDomain;
      boardSpr = boardSprite(boardDomain.toUpperCase(), 50);
    }
  }

  let glowCache: HTMLCanvasElement | null = null;
  const glowSpr = (): HTMLCanvasElement => {
    if (!glowCache) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 16;
      const c = cv.getContext('2d')!;
      const g = c.createRadialGradient(8, 8, 1, 8, 8, 8);
      g.addColorStop(0, 'rgba(255, 90, 60, 0.9)');
      g.addColorStop(1, 'rgba(255, 60, 40, 0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 16, 16);
      glowCache = cv;
    }
    return glowCache;
  };

  function event(se: SceneEvent, replay: boolean): void {
    race.event(se, clock, flags(replay));
    if (!replay) audio.cueSong(se.kind, se.ev.src_ip ?? undefined);
  }

  const instance: ThemeInstance = {
    event,
    frame,
    settingsChanged: (key?: string) => {
      if (!key || key === 'kTrack') rebuildTrack();
      if (!key || key === 'kRows') resize();
    },
    applyBudgets: () => resize(),
    setResolution: (scale: number) => { init.resolution = scale; m7.resize(window.innerWidth, window.innerHeight, Math.max(120, settings.kRows * scale)); },
    stats: () => ({
      TRACK: track.name,
      POS: `P${race.order.indexOf(race.heroIdx) + 1}/${SEATS}`,
      LAP: race.racers[race.heroIdx].laps,
      HERO: race.racers[race.heroIdx].name,
      LEADER: race.racers[race.leaderIdx].name,
    }),
    diag: () => ({
      m7, race, track, sprites: Sprites,
      W: m7.W, H: m7.H, trackTotal: Math.round(track.total), rows: settings.kRows,
      hero: race.heroIdx, leader: race.leaderIdx,
      racers: race.racers.map((r) => ({ n: r.name, g: r.ghost ? 1 : 0, s: Math.round(r.s), lat: +r.lat.toFixed(1), v: r.char.veh, sp: Math.round(r.speed), a: +r.act.toFixed(1) })),
      caution: +race.caution.toFixed(1),
      cam: { x: +camX.toFixed(1), y: +camY.toFixed(1), h: +camHeading.toFixed(2) },
      camOffTrack: +Math.hypot(camX - track.xs[track.nearest(camX, camY)], camY - track.ys[track.nearest(camX, camY)]).toFixed(1),
      shells: race.shells.map((s) => s.kind), hazards: race.hazards.length,
      pickedUp: race.pickedUp, used: race.used,
      spreadLaps: +((race.racers[race.order[0]].dist - race.racers[race.order[race.order.length - 1]].dist) / track.total).toFixed(2),
      jamBefore: +race.jamBefore.toFixed(2), jamAfter: +race.jamAfter.toFixed(2), jamPair: race.jamPair,
      go,
    }),
  };
  return instance;
}
