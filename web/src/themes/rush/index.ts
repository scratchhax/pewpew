import { Application, Container, Sprite } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { RUSH_BUDGETS, RUSH_CONTROLS, RUSH_DEFAULTS, RUSH_HUD } from './settings';
import { makeArt, TILE } from './art';
import { Course, CourseView, Backdrop } from './world';
import { Actors } from './actors';
import './hud.css';

/**
 * Packet Rush: the network as a 16-bit auto-runner. A courier bot races right
 * through a course generated just ahead of it; allowed traffic is gems, blocks
 * are baddies to stomp (bursts put up brick walls), DNS lookups are query
 * blocks that pop the domain and a power-up, DHCP leases are rival runners
 * wearing the hostname, Wi-Fi joins raise checkpoint flags, IDS threats send
 * the hunter drone, and traffic weather picks the world: green hills, a neon
 * factory in the rain, a lava castle. Every sprite, tile and letter is drawn
 * in code; nothing flashes.
 */
export const rush: Theme<typeof RUSH_DEFAULTS> = {
  id: 'rush',
  title: 'PACKET RUSH',
  hud: RUSH_HUD,
  accentHue: 205,
  defaults: RUSH_DEFAULTS,
  budgets: RUSH_BUDGETS,
  controls: RUSH_CONTROLS,
  create,
};
export default rush;

async function create(host: ThemeHost<typeof RUSH_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1a1c2c',
    antialias: false,
    roundPixels: true,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);
  app.canvas.style.imageRendering = 'pixelated';

  const art = makeArt();
  const course = new Course();

  // screen space (scaled to chunky pixels): backdrop | world (scrolls) | foreground strip | weather
  const screen = new Container();
  const backdropLayer = new Container();
  const world = new Container();
  const tiles = new Container();
  const back = new Container(), mid = new Container(), front = new Container(), ui = new Container();
  world.addChild(tiles, back, mid, front);
  const foreground = new Container();
  const weatherLayer = new Container();
  const uiWorld = new Container();
  uiWorld.addChild(ui);
  screen.addChild(backdropLayer, world, foreground, weatherLayer, uiWorld);
  app.stage.addChild(screen);

  const view = new CourseView(tiles, art);
  const backdrop = new Backdrop(backdropLayer, foreground, art.worlds);

  // pixel scale: the view is about 250 world pixels tall, at a whole-number scale
  let S = 4, vw = 400, vh = 240;
  function layout(): void {
    const W = app.screen.width, H = app.screen.height;
    S = Math.max(2, Math.round(H / 250));
    vw = Math.ceil(W / S); vh = Math.ceil(H / S);
    course.vh = vh;
    screen.scale.set(S);
  }
  layout();
  app.renderer.on('resize', layout);

  course.ensure(0, 80);
  const actors = new Actors({ back, mid, front, ui }, art, course);

  function applyBudgets(): void {
    actors.maxEnemies = settings.pMaxBaddies;
    actors.maxGems = settings.pMaxGems;
    actors.maxBits = settings.pParticles;
  }
  applyBudgets();

  // weather: rain streaks in the factory, embers rising in the castle
  const drops: Array<{ s: Sprite; x: number; y: number; v: number; kind: number }> = [];
  function weather(dt: number, worldIdx: number): void {
    const kind = settings.pWeather ? (worldIdx === 1 ? 1 : worldIdx === 2 ? 2 : 0) : 0;
    const want = kind ? Math.round(70 * settings.pWeatherDensity * (state.weather === 'hurricane' ? 1.4 : 1)) : 0;
    while (drops.length < want) {
      const s = new Sprite(art.dot);
      weatherLayer.addChild(s);
      drops.push({ s, x: Math.random() * vw, y: Math.random() * vh, v: 0.6 + Math.random() * 0.6, kind });
    }
    while (drops.length > want) drops.pop()!.s.destroy();
    for (const d of drops) {
      if (d.kind !== kind) { d.kind = kind; }
      if (kind === 1) {
        d.y += 260 * d.v * dt; d.x -= (40 + speed * 0.4) * dt;
        d.s.tint = 0x94b0c2; d.s.alpha = 0.55; d.s.scale.set(1, 4);
      } else {
        d.y -= 30 * d.v * dt; d.x -= speed * 0.5 * dt + Math.sin(d.y * 0.05) * 6 * dt;
        d.s.tint = d.v > 0.9 ? 0xffcd75 : 0xef7d57; d.s.alpha = 0.5 + 0.3 * d.v; d.s.scale.set(1);
      }
      if (d.y > vh + 4) { d.y = -4; d.x = Math.random() * (vw + 60); }
      if (d.y < -4) { d.y = vh + 2; d.x = Math.random() * (vw + 60); }
      if (d.x < -4) d.x += vw + 8;
      d.s.position.set(Math.round(d.x), Math.round(d.y));
    }
  }

  // ── pace ──
  let speed = 120, nitro = 0, rateFast = 0, rateSlow = 0, arrivals = 0, bootT = -1, lastWall = performance.now() / 1000;
  let blockBurst = 0, wallCool = 0;

  function event(se: SceneEvent, replay: boolean): void {
    if (replay) return;
    arrivals++;
    const ev = se.ev;
    switch (se.kind) {
      case 'allow':
        if (settings.pGems) actors.gem(se.scope === 'inbound');
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      case 'block':
        blockBurst += 1;
        if (settings.pBaddies && throttle.allow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 2.5)) {
          if (actors.baddie(Math.random() < 0.3)) audio.cueSong('block', ev.src_ip ?? undefined);
        }
        break;
      case 'threat':
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (settings.pDrone) actors.hunt();
        break;
      case 'dns':
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (settings.pQueries && ev.dns_query && throttle.allow(`dns|${ev.dns_query}`, 8)) actors.query(ev.dns_query.replace(/^www\./, ''));
        break;
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4)}` : ev.src_ip ?? 'rival');
        if (settings.pRivals) actors.rival(name);
        audio.cueSong('dhcp');
        break;
      }
      case 'wifi':
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        if (settings.pFlags && ev.syslog_host && se.wifi !== 'other') actors.flag(ev.syslog_host, se.wifi === 'joined');
        break;
      case 'system':
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        backdrop.flicker();
        audio.cueSong('system');
        break;
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;
    if (bootT < 0) bootT = t;

    // traffic sets the pace (wall clock, so a slow frame never looks like a spike)
    const wall = performance.now() / 1000, wallDt = Math.min(1, Math.max(1e-3, wall - lastWall));
    lastWall = wall;
    rateFast += (arrivals / wallDt - rateFast) * Math.min(1, wallDt * 1.2);
    rateSlow += (rateFast - rateSlow) * Math.min(1, wallDt * 0.08);
    arrivals = 0;
    const burst = rateSlow > 2 && t - bootT > 20 ? rateFast / rateSlow : 1;
    nitro += ((burst > 2 ? 1 : 0) - nitro) * Math.min(1, dtReal * (burst > 2 ? 2 : 0.7));
    if (settings.pTurbo && nitro > 0.6) actors.boost(0.4);
    const want = 115 + Math.min(110, rateSlow * 2.6) + actors.heroSpeedBonus;
    speed += (want - speed) * Math.min(1, dt * 1.5);

    // a burst of blocks puts a brick wall across the course
    blockBurst *= Math.exp(-dt * 0.6);
    wallCool = Math.max(0, wallCool - dt);
    if (settings.pBaddies && blockBurst > 5 && wallCool <= 0) { actors.wall(); wallCool = 4; blockBurst = 0; }

    // the world follows the weather; the course ahead is built in it, the backdrop cross-fades
    const worldIdx = state.weather === 'hurricane' ? 2 : state.weather === 'storm' ? 1 : 0;
    course.buildWorld = worldIdx;
    backdrop.target = worldIdx;
    // gaps stay inside what a full jump covers at this speed (with room to spare)
    course.maxGap = Math.max(2, Math.min(5, Math.floor((speed * 0.62) / TILE)));

    const camX = actors.hero.x - vw * 0.36;
    course.ensure(Math.floor(camX / TILE) - 8, Math.ceil((camX + vw) / TILE) + 24);
    actors.update(dt, t, speed, camX, vw);
    const cam = Math.round(actors.hero.x - vw * 0.36);

    view.draw(course, cam, vw, t);
    backdrop.update(dt, cam, vw, vh, t);
    weather(dt, worldIdx);
    world.position.set(-cam, 0);
    uiWorld.position.set(-cam, 0);
    audio.setThreatActive(actors.hunted);

    screen.position.set(Math.round(f.wanderX * 0.2), Math.round(f.wanderY * 0.2));
    app.render();
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { if (app.renderer.resolution !== scale) app.renderer.resolution = scale; },
    stats: () => ({ ...actors.counts(), gems: actors.stats.gems }),
    diag: () => ({ app, course, actors, backdrop, art }),
  };
}
