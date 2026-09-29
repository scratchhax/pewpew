import type { SceneEvent } from '../../events';
import type { FrameInfo, RendererInit, Theme, ThemeHost, ThemeInstance } from '../../theme';
import { SLIP_BUDGETS, SLIP_CONTROLS, SLIP_DEFAULTS, SLIP_HUD } from './settings';
import { slipScore, engineSpeed } from './score';
import { Mode7 } from './mode7';
import { buildTrack, type Track } from './track';
import { Race, SEATS } from './race';
import { board as boardSprite, ghost, kartFront, kartRear, kartSide, oil, shell } from './sprites';
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
    <div id="slip-map"><canvas width="118" height="118"></canvas><div class="cap">CIRCUIT</div></div>
    <div id="slip-caution">CAUTION — PACK EASING</div>
    <div id="slip-flash"></div>`;
  host.mount.appendChild(hud);
  const q = (s: string): HTMLElement => hud.querySelector(s) as HTMLElement;
  const countEl = q('#slip-count'), posEl = q('#slip-order .pos'), whoEl = q('#slip-order .who');
  const kmhEl = q('#slip-kmh b'), mapEl = q('#slip-map'), mapCv = q('#slip-map canvas') as HTMLCanvasElement;
  const cautionEl = q('#slip-caution'), flashEl = q('#slip-flash');
  const mapCtx = mapCv.getContext('2d')!;

  let race: Race;
  const hooks = {
    onLap: (seat: number) => { if (seat === race.heroIdx && throttle.allow('lap', 2)) audio.sfx('lap', {}); },
    onShellHit: () => audio.sfx('shellhit', {}),
    onPadHit: (seat: number) => { if (seat === race.heroIdx) audio.sfx('boost', { pan: 0 }); else audio.sfx('pad', { pan: (seat - 3.5) * 0.2 }); },
    onSpin: (seat: number) => { if (seat === race.heroIdx || throttle.allow('spinother', 1.5)) audio.sfx('spin', { pan: (seat - 3.5) * 0.2 }); },
  };
  race = new Race(track, 0, hooks);

  // ── sprites ──
  const shellSpr = shell();
  const oilSpr = oil();
  const sprCache = new Map<string, { rear: HTMLCanvasElement; front: HTMLCanvasElement; side: HTMLCanvasElement }>();
  const karts = (hue: number): { rear: HTMLCanvasElement; front: HTMLCanvasElement; side: HTMLCanvasElement } => {
    const key = `${hue}`;
    let e = sprCache.get(key);
    if (!e) {
      e = { rear: kartRear(hue), front: kartFront(hue), side: kartSide(hue) };
      if (sprCache.size > 40) sprCache.clear();
      sprCache.set(key, e);
    }
    return e;
  };
  const ghostCache = new Map<string, HTMLCanvasElement>();
  const ghostRear = (hue: number): HTMLCanvasElement => {
    const key = `${hue}`;
    let g = ghostCache.get(key);
    if (!g) { g = ghost(kartRear(hue)); ghostCache.set(key, g); }
    return g;
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

    // ── the lights ──
    if (!go) {
      countdown -= dtr;
      if (countdown > 0.6) {
        const label = String(Math.max(1, Math.min(3, Math.ceil(countdown - 0.6))));
        if (label !== lastLabel) {
          lastLabel = label;
          countEl.textContent = label;
          countEl.classList.add('on');
          countEl.classList.remove('go');
          audio.sfx('count', {});
        }
      } else if (countdown > -1.1) {
        go = true;
        countEl.textContent = 'GO!';
        countEl.classList.add('on', 'go');
        audio.sfx('go', {});
      }
      if (countdown <= -1.1) countEl.classList.remove('on');
    }

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
    for (const o of race.oils) {
      const p = m7.project(o.x, o.y, cam);
      if (p) draws.push({ depth: p.depth, run: () => m7.drawSprite(oilSpr, o.x, o.y, cam, 3.4, Math.min(1, o.life / 2)) });
    }
    const bpos = track.offset(track.boardS, -(track.width / 2 + 34));
    if (m7.project(bpos.x, bpos.y, cam)) {
      draws.push({ depth: m7.project(bpos.x, bpos.y, cam)!.depth, run: () => m7.drawSprite(boardSpr, bpos.x, bpos.y, cam, 8.4, 1, 1.4) });
    }
    for (const r of race.racers) {
      if (r.seat === heroIdx) continue;
      const p = race.kartPos(r.seat);
      const pr = m7.project(p.x, p.y, cam);
      if (!pr) continue;
      const toR = Math.atan2(p.y - camY, p.x - camX);
      const relAng = Math.atan2(Math.sin(toR - camHeading), Math.cos(toR - camHeading));
      const side = Math.abs(relAng) > 1.1;
      const facingBack = Math.cos(p.heading - camHeading) < -0.2;
      const spr = r.ghost ? ghostRear(r.hue) : side ? karts(r.hue).side : facingBack ? karts(r.hue).front : karts(r.hue).rear;
      const alpha = r.ghost ? 0.42 : r.flash > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(r.flash * 20)) : 1;
      const lift = r.spin > 0 ? Math.abs(Math.sin(r.spin * 9)) * 0.25 : 0;
      draws.push({ depth: pr.depth, run: () => m7.drawSprite(spr, p.x, p.y, cam, 3.4, alpha, lift) });
      if (r.glow > 0 && pr.depth < 240) {
        draws.push({ depth: pr.depth - 0.01, run: () => m7.drawSprite(glowSpr(), p.x, p.y, cam, 4.8, 0.4 * Math.min(1, r.glow)) });
      }
    }
    if (race.shell) {
      const sp = track.offset(race.shell.s, race.shell.lat);
      const pr = m7.project(sp.x, sp.y, cam);
      if (pr) {
        draws.push({ depth: pr.depth, run: () => m7.drawSprite(shellSpr, sp.x, sp.y, cam, 2.4, 1, 0.35) });
        if (pr.depth < 26 && throttle.allow('shellwhoosh', 1.1)) {
          audio.sfx('shell', { pan: pr.sx > m7.W / 2 ? 0.6 : -0.6 });
        }
      }
    }
    draws.sort((a, b) => b.depth - a.depth);
    for (const d of draws) d.run();

    // ── your kart: the fixed anchor at the bottom of the board ──
    const kartSpr = hero.ghost ? ghostRear(hero.hue) : karts(hero.hue).rear;
    const kw = Math.max(28, Math.round(m7.W * (0.068 + speedFrac * 0.012)));
    const kh = Math.round(kw * (kartSpr.height / kartSpr.width));
    const steer = Math.max(-1, Math.min(1, dh * 2.2)) * kw * 0.22;
    const bounce = speedFrac * 1.2 * Math.sin(f.t * 24);
    ctx.drawImage(kartSpr, Math.round(m7.W / 2 - kw / 2 + steer), Math.round(m7.H - kh - 2 + bounce), kw, kh);

    const chev = settings.kChevrons ? Math.min(0.75, Math.max(0, (state.rate30s - 8) / 34) * 0.7 + speedFrac * 0.3) : 0;
    m7.drawChevrons(chev, f.t);
    engineSpeed(Math.min(1, speedFrac));

    // ── HUD ──
    const rank = race.order.indexOf(heroIdx) + 1;
    posEl.innerHTML = `<b>P${rank}</b><i>/${SEATS}</i>`;
    whoEl.textContent = `${hero.name}${hero.laps > 0 ? `  ·  LAP ${hero.laps}` : ''}`;
    whoEl.classList.toggle('ghost', hero.ghost);
    kmhEl.textContent = String(Math.round(hero.speed * 2.05));
    cautionEl.classList.toggle('on', race.caution > 0);
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
      W: m7.W, H: m7.H, rows: settings.kRows,
      hero: race.heroIdx, leader: race.leaderIdx,
      racers: race.racers.map((r) => ({ n: r.name, g: r.ghost ? 1 : 0, s: Math.round(r.s), sp: Math.round(r.speed), a: +r.act.toFixed(1) })),
      shell: !!race.shell, caution: +race.caution.toFixed(1),
      cam: { x: +camX.toFixed(1), y: +camY.toFixed(1), h: +camHeading.toFixed(2) },
      camOffTrack: +Math.hypot(camX - track.xs[track.nearest(camX, camY)], camY - track.ys[track.nearest(camX, camY)]).toFixed(1),
      go,
    }),
  };
  return instance;
}
