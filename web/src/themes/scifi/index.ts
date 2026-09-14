import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import type { NetEvent } from '../../types';
import { ipAngle, hash01 } from '../../state';
import { buildTextures } from './textures';
import { pathColorFor } from './palette';
import { SCIFI_DEFAULTS, SCIFI_BUDGETS, SCIFI_CONTROLS } from './settings';
import { Starfield } from './scenes/starfield';
import { Dust } from './scenes/dust';
import { Station } from './scenes/station';
import { Rings } from './scenes/rings';
import { Fx } from './scenes/fx';
import { Crystals } from './scenes/crystals';
import { Asteroids } from './scenes/asteroids';
import { Threats } from './scenes/threats';
import { ApCores } from './scenes/apcores';
import { EventStars } from './scenes/eventstars';
import { Planets } from './scenes/planets';
import { Constellation } from './scenes/constellation';
import { AmbientShips } from './scenes/ambientships';

/**
 * Event colors — single source of truth shared with the terminal log
 * (see .log-* classes in styles.css). Whatever hue a line is in the
 * log is the hue its particle effect paints on screen.
 */
const COLORS = {
  allow: 0x5ce6a4,    // firewall pass  (#5ce6a4)
  block: 0xff6b6b,    // firewall block (#ff6b6b)
  dns:   0x55b5ff,    // dns            (#55b5ff)
  dhcp:  0xffd84d,    // dhcp           (#ffd84d)
  wifi:  0xc08cff,    // wifi           (#c08cff)
  system: 0x7d99b3,   // system         (#7d99b3)
  threat: 0xff9a45,   // IDS/IPS attack (#ff9a45)
};

/** Sub-hues for wifi event stars (around AP cores), matched in order. */
const WIFI_STAR: Array<[RegExp, number]> = [
  [/roam|reassoc/,            0x55b5ff],  // blue: travelling between APs
  [/fail|kick|reject|disallow|status [1-9]/, 0xffb86b],  // orange: trouble, not an attack
  [/deauth|disassoc|left|leave/, 0xff8ab8], // pink: client gone
  [/handshake|wpa|auth/,      0x8f7bff],  // indigo: 4-way handshake
];
/** Planet hues — per-device deterministic; yellow is just one of them. */
const PLANET_HUES = [0xffd84d, 0xffb347, 0xff9d5c, 0x7de3ff, 0x9d8cff, 0x8affc1];

function wifiStarColor(ev: NetEvent): number {
  const e = `${ev.wifi_event ?? ''} ${ev.wifi_reason ?? ''}`.toLowerCase();
  for (const [re, c] of WIFI_STAR) if (re.test(e)) return c;
  return COLORS.wifi;                            // plain join/assoc → wifi purple
}

// settings whose change means the starfield/nebula sprites must be rebuilt
const STARFIELD_KEYS = new Set(['starfield', 'nebula', 'hueShift', 'colorSat',
  'starDensity', 'nebulaCount', 'quality']);

/** Orbital Command: the network as a space battle around a command station. */
export const sciFi: Theme<typeof SCIFI_DEFAULTS> = {
  id: 'scifi',
  title: 'ORBITAL COMMAND',
  defaults: SCIFI_DEFAULTS,
  budgets: SCIFI_BUDGETS,
  controls: SCIFI_CONTROLS,
  create,
};

async function create(host: ThemeHost<typeof SCIFI_DEFAULTS>,
                      init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#02040a',
    antialias: init.antialias,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,        // CSS size stays the window; scale only changes pixels
    autoStart: false,         // the core frame loop drives rendering
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  let w = app.screen.width, h = app.screen.height;
  const textures = buildTextures();

  // ── layers ──
  const bgLayer = new Container(); bgLayer.label = 'bgLayer';
  const world = new Container(); world.label = 'world';
  const shipLayer = new Container(); shipLayer.label = 'shipLayer';
  const dustLayer = new Container(); dustLayer.label = 'dustLayer';
  const constellationLayer = new Container(); constellationLayer.label = 'constellationLayer';
  const ringsLayer = new Container(); ringsLayer.label = 'ringsLayer';
  const apLayer = new Container(); apLayer.label = 'apLayer';
  const eventStarLayer = new Container(); eventStarLayer.label = 'eventStarLayer';
  const fxLayer = new Container(); fxLayer.label = 'fxLayer';
  const stationLayer = new Container(); stationLayer.label = 'stationLayer';
  const planetLayer = new Container(); planetLayer.label = 'planetLayer';
  world.addChild(shipLayer, dustLayer, eventStarLayer, constellationLayer,
    ringsLayer, planetLayer, apLayer, fxLayer, stationLayer);
  app.stage.addChild(bgLayer, world);

  const setCamera = (zoom: number, dx: number, dy: number): void => {
    world.pivot.set(w / 2, h / 2);
    world.position.set(w / 2 + dx, h / 2 + dy);
    world.scale.set(zoom);
  };

  // ── systems ──
  const fx = new Fx(fxLayer, textures.glow, settings.maxParticles, textures.asteroids);
  const starfield = new Starfield(bgLayer, textures.glow, textures.dot,
    textures.clouds, w, h, settings);
  const dust = new Dust(dustLayer, textures.glow, w, h, settings.dustCount);
  const ambient = new AmbientShips(shipLayer, [...textures.icons, ...textures.ships], w, h);
  const station = new Station(stationLayer, textures.glow, w, h);
  const rings = new Rings(ringsLayer, textures.dot, textures.glow, w, h);
  const crystals = new Crystals(fxLayer, textures.crystal, textures.glow, fx);
  const asteroids = new Asteroids(fxLayer, textures.asteroids, fx);
  const threats = new Threats(fxLayer, textures.rocket, textures.glow, fx);
  const apCores = new ApCores(apLayer, textures.glow, fx, w, h);
  const eventStars = new EventStars(eventStarLayer, textures.dot, textures.glow);
  const planets = new Planets(planetLayer, textures.planets, w, h);
  const constellation = new Constellation(constellationLayer, textures.dot, textures.glow, w, h);
  rings.setObjects(settings.ringObjects);

  function applyBudgets(): void {
    fx.setMax(settings.maxParticles);
    dust.setCount(settings.dustCount);
    station.setDetail(settings.fxDetail);
    crystals.setDetail(settings.fxDetail);
    constellation.setMax(settings.maxIpStars);
    eventStars.setMax(settings.maxEventStars);
  }
  applyBudgets();

  function clearConstellation(): void {
    for (const child of [...constellationLayer.children]) {
      if (child instanceof Container) child.destroy({ children: true });
    }
  }

  // The renderer's own resize event: PixiJS applies window resizes on the next
  // animation frame, so a window 'resize' listener would read the old size.
  app.renderer.on('resize', (width: number, height: number) => {
    w = width; h = height;
    starfield.resize(w, h);
    dust.resize(w, h);
    station.resize(w, h);
    rings.resize(w, h);
    constellation.resize(w, h);
    apCores.resize(w, h);
    planets.resize(w, h);
    ambient.resize(w, h);
    fx.resize();
  });

  // ── camera state ──
  let shake = 0;
  let punch = 0;
  let zoom = 1;

  // Every line drawn on screen connects two VISIBLE objects:
  //   station core ↔ IP star, station core ↔ AP core, station ↔ asteroid.
  // Effects are gated per flow by the core throttle and capped on screen.
  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const cx = station.center.x, cy = station.center.y;
    const dir = se.scope;

    switch (se.kind) {
      case 'threat': {
        // IDS/IPS threats: always malicious. Fly a looping attack into the core
        // (shot down like a block asteroid); never render as a benign allow.
        if (replay) break;
        audio.cueSong('threat', ev.src_ip ?? undefined);
        const target = ev.dst_ip ?? ev.mac_address ?? '';
        if (throttle.allow(`thr|${target}|${ev.rule_desc ?? ev.rule_name ?? ''}`, 2.2)) {
          if (settings.threatMissiles && threats.count() < 8) {
            threats.spawn(cx, cy, w, h, ipAngle(target || '0.0.0.0'), COLORS.threat);
          } else {
            fx.shockwave(cx, cy, COLORS.threat, 90, 2.5);
            station.flash(0.25);
          }
        }
        break;
      }

      case 'block': {
        if (replay) break;
        if (settings.asteroids && asteroids.count() < 12 &&
            throttle.allow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 3)) {
          const ext = dir === 'internal' ? `${ev.src_ip}|${ev.dst_ip}`
            : dir === 'inbound' ? ev.src_ip : ev.dst_ip;
          asteroids.spawn(cx, cy, w, h, ipAngle(ext ?? '0.0.0.0'), COLORS.block);
          station.eventCloud(COLORS.block, 0.6, 0.4);
          if (settings.screenShake) shake = Math.min(14, shake + 4);
          audio.cueSong('block');
        }
        break;
      }

      case 'allow': {
        rings.activate('general', performance.now() / 1000);
        if (!replay) station.eventCloud(COLORS.allow, 1.2, 0.22);
        if (!replay) {
          // internal (LAN↔LAN) permits are housekeeping — constellation
          // lines only. Crystals + arrival bursts at fixed hot internal
          // stars turned inter-VLAN chatter into a permanent green blob.
          if (dir !== 'internal' && settings.crystals &&
              throttle.allow(`alw|${ev.dst_ip}`, 1.8)) {
            // a permitted connection = energy pulse from src star to dst star
            const a = ev.src_ip && settings.constellations
              ? constellation.starPosition(ev.src_ip) : null;
            const b = ev.dst_ip && settings.constellations
              ? constellation.starPosition(ev.dst_ip) : null;
            if (a && b) {
              const hue = pathColorFor(`${ev.src_ip}>${ev.dst_ip}`, settings);
              crystals.spawnToward(a.x, a.y, b.x, b.y, hue,
                () => { station.flash(0.15); fx.burst(b.x, b.y, hue, 10); });
            } else {
              const ext = dir === 'inbound' ? ev.src_ip : ev.dst_ip;
              const hue = pathColorFor(`${ext}`, settings);
              crystals.spawn(cx, cy, w, h, ipAngle(ext ?? '0.0.0.0'),
                dir === 'inbound', hue,
                (x, y) => { station.flash(0.35); fx.burst(x, y, hue, 12); });
            }
            audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
          }
          if (settings.constellations && ev.src_ip && ev.dst_ip &&
              throttle.allow(`con|${ev.src_ip}|${ev.dst_ip}`, 10)) {
            constellation.connect(ev.src_ip, ev.dst_ip,
              pathColorFor(`${ev.src_ip}>${ev.dst_ip}`, settings));
          }
        }
        if (!replay) station.flash(0.15);
        break;
      }

      case 'dns': {
        rings.activate('dns', performance.now() / 1000);
        if (replay) break;
        station.eventCloud(COLORS.dns, 0.9, 0.34);
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!throttle.allow(`dns|${ev.src_ip}|${ev.dns_query}`, 2)) break;
        // client star → station (it IS the resolver): anchored both ends
        if (ev.src_ip && settings.constellations &&
            throttle.allow(`dnsl|${ev.src_ip}`, 2.5)) {
          const st = constellation.starPosition(ev.src_ip);
          fx.laser(st.x, st.y, cx, cy, COLORS.dns, 1.6);
          fx.emit(st.x, st.y, COLORS.dns, 3, 35, 0.16, 0.5);
        }
        fx.emit(cx, cy, COLORS.dns, 4, 45, 0.15, 0.45);
        break;
      }

      case 'dhcp': {
        rings.activate('dhcp', performance.now() / 1000);
        if (replay) break;
        station.eventCloud(COLORS.dhcp, 1.2, 0.34);
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        // DHCP leases drift across the screen as labelled planets
        const name = ev.hostname ||
          (ev.mac_address
            ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}`
            : ev.src_ip ?? 'unknown');
        if (settings.planets) {
          planets.spawn(PLANET_HUES[(hash01(name) * PLANET_HUES.length) | 0], name);
        }
        audio.cueSong('dhcp');
        if (ev.syslog_host && settings.apCores) {
          apCores.event(ev.syslog_host, 'info', COLORS.dhcp);
        }
        break;
      }

      case 'wifi': {
        const bad = se.wifi === 'bad';
        const joined = se.wifi === 'joined';
        if (replay) break;
        rings.activate('wifi', performance.now() / 1000);
        station.eventCloud(COLORS.wifi, 0.9, 0.34);
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.mac_address}|${ev.wifi_event}`, 3)) break;
        // background marker: faint star at a random map spot, hue = event type
        audio.cueSong('wifi');
        if (settings.eventStars) {
          eventStars.spawn(
            40 + Math.random() * Math.max(100, w - 80),
            40 + Math.random() * Math.max(100, h - 80),
            wifiStarColor(ev));
        }
        if (settings.apCores && ev.syslog_host) {
          apCores.event(ev.syslog_host, bad ? 'bad' : 'good', COLORS.wifi);
          const pos = apCores.positionOf(ev.syslog_host);
          if (pos && settings.crystals) {
            // join: AP → station ; leave: station → AP (purple either way)
            if (joined) crystals.spawnToward(pos.x, pos.y, cx, cy, COLORS.wifi,
              () => { station.flash(0.2); fx.burst(cx, cy, COLORS.wifi, 10); });
            else if (bad) fx.laser(cx, cy, pos.x, pos.y, COLORS.wifi, 1.6);
          }
        }
        break;
      }

      case 'system': {
        if (!replay && throttle.allow(`sys|${ev.syslog_host}`, 4)) {
          fx.shockwave(cx, cy, COLORS.system, 90, 1.5);
          if (ev.syslog_host && settings.apCores) {
            apCores.event(ev.syslog_host, 'info', COLORS.system);
          }
        }
        break;
      }
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;

    starfield.update(dt, state);
    if (settings.dust) dust.update(dt, state.weather === 'hurricane' ? 2.2 : 1);
    if (settings.ambientShips) ambient.update(dt, state.weather === 'hurricane' ? 2 : 1);
    rings.update(dt, station.center.x, station.center.y);
    crystals.update(dt);

    const hits = asteroids.update(dt, station.center.x, station.center.y);
    const th = threats.update(dt, station.center.x, station.center.y);
    const underAttack = threats.count() > 0;
    station.setAlarm(underAttack);
    audio.setThreatActive(underAttack);
    if (hits.impacts.length > 0 || th.impacts.length > 0) {
      state.slowmo(0.25, 0.55);
      punch += 0.06;
      shake = Math.min(22, shake + 10);
    } else if (hits.intercepts.length > 0 || th.intercepts.length > 0) {
      punch += 0.015;
    }

    apCores.update(dt);
    if (settings.eventStars) eventStars.update(dt);
    if (settings.planets) planets.update(dt);
    if (settings.constellations) constellation.update(dt);
    fx.update(dt);
    station.update(dt, state);

    // camera: core anti burn-in wander + a little drift, shake and impact punch
    shake = Math.max(0, shake - dt * 16);
    punch = Math.max(0, punch - dt * 0.25);
    const driftX = f.wanderX + Math.sin(t * 0.05) * 6 + (Math.random() - 0.5) * shake;
    const driftY = f.wanderY + Math.cos(t * 0.04) * 4 + (Math.random() - 0.5) * shake;
    const targetZoom = (1 + punch) * (1 + Math.sin(t * 0.031) * 0.004);
    zoom += (targetZoom - zoom) * Math.min(1, dtReal * 5);
    setCamera(zoom, driftX, driftY);

    app.render();
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged(key) {
      if (key === undefined || STARFIELD_KEYS.has(key)) starfield.rebuild();
      if (!settings.constellations) clearConstellation();
      rings.setObjects(settings.ringObjects);
    },
    setResolution(scale) {
      if (app.renderer.resolution !== scale) app.renderer.resolution = scale;
    },
    stats: () => ({ nodes: countNodes(app.stage) }),
    diag: () => ({ app }),
  };
}

/** Display objects in the scene graph (debug overlay). */
function countNodes(c: Container): number {
  let n = c.children.length;
  for (const child of c.children) n += countNodes(child as Container);
  return n;
}
