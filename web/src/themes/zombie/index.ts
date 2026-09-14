import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { edgePoint, hash01, ipAngle } from '../../state';
import { ZOMBIE_DEFAULTS, ZOMBIE_BUDGETS, ZOMBIE_CONTROLS, ZOMBIE_HUD } from './settings';
import { loadTextures } from './textures';
import { makeLayout, Layout, Point } from './layout';
import { Compound, Layers } from './compound';
import { Fx } from './fx';
import { Zombies, Walkers } from './actors';
import { Sky } from './weather';
import './hud.css';

/** The event colour law, shared with the radio log legend. */
const COLORS = {
  allow: 0x5ce6a4,
  block: 0xff6b6b,
  dns: 0x55b5ff,
  dhcp: 0xffd84d,
  wifi: 0xc08cff,
  system: 0x7d99b3,
  threat: 0xff9a45,
};

/**
 * Last Outpost: the network as a walled compound seen from above. Blocked
 * traffic shambles in as zombies and gets shot at the fence, IDS threats are
 * horde breaches, permitted traffic is supply runs, DHCP leases are survivors
 * pitching tents, APs are buildings, and traffic weather is time of day.
 * Sprites: Kenney's Top-down Shooter pack (CC0).
 */
export const zombie: Theme<typeof ZOMBIE_DEFAULTS> = {
  id: 'zombie',
  title: 'LAST OUTPOST',
  hud: ZOMBIE_HUD,
  accentHue: 30,
  defaults: ZOMBIE_DEFAULTS,
  budgets: ZOMBIE_BUDGETS,
  controls: ZOMBIE_CONTROLS,
  create,
};
export default zombie;

async function create(host: ThemeHost<typeof ZOMBIE_DEFAULTS>,
                      init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#2d4a24',
    antialias: init.antialias,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);
  const tex = await loadTextures();

  // world layers move with the camera; the darkness and rain are screen space
  const layers: Layers = {
    ground: new Container(), decals: new Container(), props: new Container(),
    actors: new Container(), walls: new Container(), canopy: new Container(),
    lights: new Container(), labels: new Container(),
  };
  const below = new Container();
  below.addChild(layers.ground, layers.decals, layers.props, layers.actors, layers.walls, layers.canopy);
  const fxLayer = new Container();
  const above = new Container();
  above.addChild(layers.lights, fxLayer, layers.labels);
  const dark = new Container();
  const top = new Container();
  app.stage.addChild(below, dark, above, top);

  const fx = new Fx(fxLayer, layers.decals, tex.glow, tex.splats, tex.bullet);
  const compound = new Compound(app, layers, tex);
  const zombies = new Zombies(layers.actors, layers.lights, tex, compound, fx);
  const walkers = new Walkers(layers.actors, layers.lights, tex);
  const sky = new Sky(dark, top, tex.rain, tex.glow);

  let L: Layout = makeLayout(app.screen.width, app.screen.height);
  compound.layout(L, app.renderer.resolution);
  sky.resize(L.w, L.h);
  app.renderer.on('resize', (width: number, height: number) => {
    L = makeLayout(width, height);
    compound.layout(L, app.renderer.resolution);
    sky.resize(width, height);
  });

  function applyBudgets(): void {
    fx.maxParticles = settings.zMaxParticles;
    fx.maxDecals = settings.zMaxDecals;
    compound.setMaxTents(settings.zMaxTents);
    if (sky.density !== settings.zRainDensity) sky.setDensity(settings.zRainDensity);
  }
  applyBudgets();
  fx.blood = settings.zBlood;
  compound.setBuildingsVisible(settings.zBuildings);

  // ── camera ──
  let shake = 0, punch = 0, zoom = 1, alarm = 0, alarmKick = 0;
  const walkSpeed = () => 70 * L.unit;
  const runSpeed = () => 125 * L.unit;

  /** Route from inside the compound out through the nearest gate to a map edge. */
  function outboundPath(from: Point, angle: number): Point[] {
    const edge = edgePoint(L.cx, L.cy, L.w, L.h, angle, 1.04);
    const gate = L.gates[Math.cos(angle) < 0 ? 0 : 1];
    const path: Point[] = [from, { x: gate.x - gate.side * 34 * L.unit, y: gate.y },
      { x: gate.outX, y: gate.y }];
    // round the corner first so nobody walks over the wall
    if (edge.y < L.y0 - 10) path.push({ x: gate.outX, y: L.y0 - 60 * L.unit });
    else if (edge.y > L.y1 + 10) path.push({ x: gate.outX, y: L.y1 + 60 * L.unit });
    path.push(edge);
    return path;
  }

  function externalAngle(se: SceneEvent): number {
    const ev = se.ev;
    const ext = se.scope === 'internal' ? `${ev.src_ip}|${ev.dst_ip}`
      : se.scope === 'inbound' ? ev.src_ip : ev.dst_ip;
    return ipAngle(ext ?? '0.0.0.0');
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    if (replay) return;             // nothing in this theme needs snapshot backfill
    switch (se.kind) {
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        const target = ev.dst_ip ?? ev.mac_address ?? '';
        if (!throttle.allow(`thr|${target}|${ev.rule_desc ?? ev.rule_name ?? ''}`, 2.2)) break;
        const angle = ipAngle(target || '0.0.0.0') + (Math.random() - 0.5) * 2.5;
        if (settings.zHordes && zombies.hordes() < 2) {
          zombies.spawnHorde(angle, COLORS.threat);
        } else {
          // hordes maxed (or off): raise the alarm briefly instead
          alarmKick = 1;
        }
        break;
      }

      case 'block': {
        if (settings.zZombies && zombies.count() < settings.zMaxZombies &&
            throttle.allow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 3)) {
          zombies.spawn(externalAngle(se), COLORS.block);
          audio.cueSong('block');
        }
        break;
      }

      case 'allow': {
        if (se.scope === 'internal') {
          // LAN ↔ LAN: a survivor strolls from one tent to another
          if (settings.zCouriers && ev.src_ip && ev.dst_ip && walkers.count('courier') < 6 &&
              throttle.allow(`con|${ev.src_ip}|${ev.dst_ip}`, 10)) {
            const a = compound.campSpot(ev.src_ip), b = compound.campSpot(ev.dst_ip);
            if (Math.hypot(a.x - b.x, a.y - b.y) > 20) {
              walkers.walk('courier', [a, b], { speed: walkSpeed(), unit: L.unit });
            }
          }
          break;
        }
        if (!settings.zScavengers || walkers.count('run') >= 10 ||
            !throttle.allow(`alw|${ev.dst_ip}`, 1.8)) break;
        const angle = externalAngle(se);
        if (se.scope === 'inbound') {
          // a supply crate carried in from the wilds
          const dst = compound.campSpot(ev.dst_ip ?? 'lan');
          const path = outboundPath(dst, angle).reverse();
          walkers.walk('run', path, {
            speed: walkSpeed(), carry: true, unit: L.unit,
            onDone: (p) => fx.ring(p.x, p.y, COLORS.allow, 34 * L.unit),
          });
        } else {
          // a scavenger heads out on a supply run
          const src = compound.campSpot(ev.src_ip ?? 'lan');
          walkers.walk('run', outboundPath(src, angle), { speed: runSpeed(), unit: L.unit });
        }
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      }

      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!throttle.allow(`dns|${ev.src_ip}|${ev.dns_query}`, 2)) break;
        if (settings.zRadio && ev.src_ip && throttle.allow(`dnsl|${ev.src_ip}`, 2.5)) {
          // a radio call from the survivor's spot to the mast
          const from = compound.campSpot(ev.src_ip);
          fx.dash(from.x, from.y, L.mast.x, L.mast.y, COLORS.dns);
        }
        // the mast light warms with DNS traffic; no per-query ring (too busy)
        compound.mastPing();
        break;
      }

      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const name = ev.hostname ||
          (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'unknown');
        if (settings.zNewcomers) {
          const gate = L.gates[hash01(name) < 0.5 ? 0 : 1];
          const start = { x: gate.side < 0 ? -30 : L.w + 30, y: gate.y };
          const inside = { x: gate.x - gate.side * 34 * L.unit, y: gate.y };
          const walkPath: Point[] = [start, { x: gate.outX, y: gate.y }, inside];
          const dist = Math.abs(start.x - inside.x);
          if (walkers.count('arrive') < 6) {
            const { pos, isNew } = compound.tent(name, dist / walkSpeed() + 1);
            if (isNew) {
              walkPath.push(pos);
              walkers.walk('arrive', walkPath, {
                speed: walkSpeed(), unit: L.unit,
                onDone: (p) => fx.ring(p.x, p.y, COLORS.dhcp, 30 * L.unit, 2, 0.8),
              });
            } else {
              fx.ring(pos.x, pos.y, COLORS.dhcp, 26 * L.unit, 2, 0.7);
            }
          } else {
            const { pos } = compound.tent(name);
            fx.ring(pos.x, pos.y, COLORS.dhcp, 26 * L.unit, 2, 0.7);
          }
        }
        audio.cueSong('dhcp');
        if (ev.syslog_host && settings.zBuildings) compound.buildingEvent(ev.syslog_host, 'info', COLORS.dhcp);
        break;
      }

      case 'wifi': {
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.mac_address}|${ev.wifi_event}`, 3)) break;
        audio.cueSong('wifi');
        if (!settings.zBuildings || !ev.syslog_host) break;
        const bad = se.wifi === 'bad', joined = se.wifi === 'joined';
        compound.buildingEvent(ev.syslog_host, bad ? 'bad' : 'good', COLORS.wifi);
        const door = compound.door(ev.syslog_host);
        // a real walk between the client's spot in the camp and the door, so the
        // visitor is solidly on screen instead of a brief ghost at the doorway
        const spot = compound.campSpot(ev.mac_address ?? ev.syslog_host);
        const step = { x: door.x, y: door.y + (door.y < L.cy ? 1 : -1) * 30 * L.unit };
        if (joined && walkers.count('visit') < 8) {
          walkers.walk('visit', [spot, step, door], {
            speed: walkSpeed(), unit: L.unit,
            onDone: (p) => fx.ring(p.x, p.y, COLORS.wifi, 28 * L.unit, 2, 0.7),
          });
        } else if (bad && walkers.count('visit') < 8) {
          walkers.walk('visit', [door, step, spot], {
            speed: walkSpeed(), unit: L.unit,
            onDone: (p) => { fx.emit(p.x, p.y, COLORS.wifi, 5, 40, 0.2, 0.8); fx.ring(p.x, p.y, COLORS.wifi, 36 * L.unit, 2.5, 1); },
          });
        } else {
          fx.ring(door.x, door.y, COLORS.wifi, 22 * L.unit, 1.5, 0.6);
        }
        break;
      }

      case 'system': {
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        compound.generatorFlicker();
        fx.ring(L.generator.x, L.generator.y, COLORS.system, 70 * L.unit, 2, 0.9);
        if (ev.syslog_host && settings.zBuildings) compound.buildingEvent(ev.syslog_host, 'info', COLORS.system);
        break;
      }
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;

    const hits = zombies.update(dt, sky.darkness);
    walkers.update(dt, sky.darkness, settings.zNightExtras);
    const attacked = zombies.underAttack();
    audio.setThreatActive(attacked);
    alarmKick = Math.max(0, alarmKick - dt * 0.8);
    const alarmTarget = Math.max(attacked ? 1 : 0, alarmKick);
    // the alarm fades in over ~1s and out over ~2s: a mood, never a strobe
    alarm += (alarmTarget - alarm) * Math.min(1, dt * (alarmTarget > alarm ? 1.2 : 0.6));
    // only a real breach nudges the camera; routine kills don't jolt the screen
    if (hits.breaches.length > 0) {
      state.slowmo(0.35, 0.4);
      punch += 0.012;
      if (settings.zScreenShake) shake = Math.min(6, shake + 3);
    }

    fx.update(dt);
    compound.update(dt, sky.darkness, alarm);
    sky.update(dt, state.weather, settings.zDayNight, settings.zRain, alarm, settings.zNightExtras);

    shake = Math.max(0, shake - dt * 18);
    punch = Math.max(0, punch - dt * 0.25);
    const dx = f.wanderX + (Math.random() - 0.5) * shake;
    const dy = f.wanderY + (Math.random() - 0.5) * shake;
    const targetZoom = (1 + punch) * (1 + Math.sin(t * 0.031) * 0.004);
    zoom += (targetZoom - zoom) * Math.min(1, dtReal * 5);
    for (const c of [below, above]) {
      c.pivot.set(L.w / 2, L.h / 2);
      c.position.set(L.w / 2 + dx, L.h / 2 + dy);
      c.scale.set(zoom);
    }

    app.render();
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged(key) {
      fx.blood = settings.zBlood;
      if (!settings.zBlood) fx.clearDecals();
      compound.setBuildingsVisible(settings.zBuildings);
    },
    setResolution(scale) {
      if (app.renderer.resolution !== scale) {
        app.renderer.resolution = scale;
        compound.rebakeGround(scale);
      }
    },
    stats: () => ({ nodes: countNodes(app.stage) }),
    diag: () => ({ app, compound, zombies, walkers, sky }),
  };
}

function countNodes(c: Container): number {
  let n = c.children.length;
  for (const child of c.children) n += countNodes(child as Container);
  return n;
}
