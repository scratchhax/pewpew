import { Application, Container } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import type { NetEvent } from '../../types';
import { edgePoint, hash01, ipAngle } from '../../state';
import { HOLDOUT_DEFAULTS, HOLDOUT_BUDGETS, HOLDOUT_CONTROLS, HOLDOUT_HUD } from './settings';
import { loadTextures } from './textures';
import { makeLayout, Layout, Point } from './layout';
import { Compound, Layers } from './compound';
import { Fx } from './fx';
import { Zombies, Walkers } from './actors';
import { Sky } from './weather';
import { holdoutScore } from './score';
import { Groove } from '../../sound/groove';
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
 * The Holdout: the network as a walled compound seen from above. Blocked
 * traffic shambles in as zombies and gets shot at the fence, IDS threats are
 * horde breaches, permitted traffic is supply runs, DHCP leases are survivors
 * pitching tents, APs are buildings, and traffic weather is time of day.
 * Sprites: Kenney's Top-down Shooter pack (CC0).
 */
export const holdout: Theme<typeof HOLDOUT_DEFAULTS> = {
  id: 'holdout',
  title: 'THE HOLDOUT',
  hud: HOLDOUT_HUD,
  accentHue: 40,
  defaults: HOLDOUT_DEFAULTS,
  budgets: HOLDOUT_BUDGETS,
  score: holdoutScore,
  controls: HOLDOUT_CONTROLS,
  create,
};
export default holdout;

async function create(host: ThemeHost<typeof HOLDOUT_DEFAULTS>,
                      init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1d2119',
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
  zombies.onShot = (x, rounds) => audio.sfx('shot', { pan: ((x / L.w) * 2 - 1) * 0.8, count: rounds });
  zombies.onBang = (x, y) => {
    if (settings.hScreenShake) shake = Math.min(5, shake + 2.5);
    audio.sfx('breach', { pan: (x / L.w - 0.5) * 0.6 });
  };
  const walkers = new Walkers(layers.actors, layers.lights, tex, fx);
  zombies.onWalkIntercept = (x, y) => walkers.killNearestVulnerable(x, y);
  walkers.onWalkedKilled = (x, y) => {
    fx.ring(x, y, 0x661111, 20 * L.unit, 1.5, 0.5);
    audio.sfx('groan', { pan: (x / L.w - 0.5) * 0.5 });
  };
  const sky = new Sky(dark, top, tex.rain, tex.glow);
  const groove = new Groove();

  let L: Layout = makeLayout(app.screen.width, app.screen.height);
  compound.layout(L, app.renderer.resolution);
  sky.resize(L.w, L.h);
  app.renderer.on('resize', (width: number, height: number) => {
    L = makeLayout(width, height);
    compound.layout(L, app.renderer.resolution);
    sky.resize(width, height);
  });

  // 3-beat horde state
  interface HordeState { active: boolean; angle: number; beat: number; beatT: number; warnAngle: number }
  const horde: HordeState = { active: false, angle: 0, beat: 0, beatT: 0, warnAngle: 0 };
  // supply drop parachutes
  interface Parachute { x: number; y: number; vy: number; targetY: number; landed: boolean; landedT: number; crate: { x: number; y: number } | null }
  const parachutes: Parachute[] = [];

  function applyBudgets(): void {
    fx.maxParticles = settings.hMaxParticles;
    fx.maxDecals = settings.hMaxDecals;
    compound.setMaxTents(settings.hMaxTents);
    if (sky.density !== settings.hRainDensity) sky.setDensity(settings.hRainDensity);
  }
  applyBudgets();
  fx.blood = settings.hBlood;
  compound.setBuildingsVisible(settings.hBuildings);

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

  /** Dispatch a visual action by name. Returns true if the action consumed the event. */
  function doVisual(visual: string, angle: number, color: number, ev: NetEvent, se: SceneEvent): boolean {
    switch (visual) {
      case 'zombie':
        if (zombies.count() >= settings.hMaxZombies) return false;
        if (Math.random() < 0.12) zombies.spawnSprinter(angle, color);
        else zombies.spawn(angle, color);
        return true;
      case 'sprinter':
        if (zombies.count() >= settings.hMaxZombies) return false;
        zombies.spawnSprinter(angle, color);
        return true;
      case 'horde':
        if (zombies.hordes() >= 2 || horde.active) { alarmKick = 0.5; return false; }
        horde.active = true; horde.angle = angle; horde.beat = 1; horde.beatT = 0; horde.warnAngle = angle;
        alarmKick = 0.5;
        return true;
      case 'scavenger': {
        if (walkers.count('run') >= 10) return false;
        const dst = compound.campSpot(ev.dst_ip ?? 'lan');
        const path = outboundPath(dst, angle).reverse();
        walkers.walk('run', path, { speed: walkSpeed(), carry: true, unit: L.unit, vulnerable: true, onDone: (p) => fx.ring(p.x, p.y, color, 34 * L.unit) });
        return true;
      }
      case 'parachute': {
        if (parachutes.length >= 2) return false;
        const dst = compound.campSpot(ev.dst_ip ?? 'lan');
        const px = L.cx + (dst.x - L.cx) * 0.3;
        const py = L.y0 - 40 * L.unit;
        parachutes.push({ x: px, y: py, vy: 25 * L.unit, targetY: dst.y, landed: false, landedT: 0, crate: null });
        return true;
      }
      case 'radio': {
        const from = compound.campSpot(ev.src_ip ?? 'lan');
        fx.dash(from.x, from.y, L.mast.x, L.mast.y, color);
        compound.mastPing();
        return true;
      }
      case 'arrival': {
        if (walkers.count('arrive') >= 6) return false;
        const name = ev.hostname || ev.syslog_host || ev.src_ip || 'unknown';
        const gate = L.gates[hash01(name) < 0.5 ? 0 : 1];
        const start = { x: gate.side < 0 ? -30 : L.w + 30, y: gate.y };
        const inside = { x: gate.x - gate.side * 34 * L.unit, y: gate.y };
        const walkPath: Point[] = [start, { x: gate.outX, y: gate.y }, inside];
        const dist = Math.abs(start.x - inside.x);
        const { pos, isNew } = compound.tent(name, dist / walkSpeed() + 1);
        if (isNew) { walkPath.push(pos); walkers.walk('arrive', walkPath, { speed: walkSpeed(), unit: L.unit, onDone: (p) => fx.ring(p.x, p.y, color, 30 * L.unit, 2, 0.8) }); }
        else fx.ring(pos.x, pos.y, color, 26 * L.unit, 2, 0.7);
        return true;
      }
      case 'visit': {
        if (walkers.count('visit') >= 8) return false;
        const host = ev.syslog_host ?? 'lan';
        const door = compound.door(host);
        const spot = compound.campSpot(ev.mac_address ?? ev.src_ip ?? host);
        const step = { x: door.x, y: door.y + (door.y < L.cy ? 1 : -1) * 30 * L.unit };
        walkers.walk('visit', [spot, step, door], { speed: walkSpeed(), unit: L.unit, onDone: (p) => fx.ring(p.x, p.y, color, 28 * L.unit, 2, 0.7) });
        return true;
      }
      case 'brownout':
        compound.generatorFlicker();
        fx.ring(L.generator.x, L.generator.y, color, 70 * L.unit, 2, 0.9);
        return true;
      case 'alarm':
        alarmKick = 1;
        return true;
      case 'none':
        return false;
      default:
        return false;
    }
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    if (replay) return;
    switch (se.kind) {
      case 'threat': {
        const visual = settings.hThreat;
        if (visual === 'none') break;
        audio.cueSong('threat', ev.src_ip ?? undefined);
        const target = ev.dst_ip ?? ev.mac_address ?? '';
        if (!throttle.allow(`thr|${target}|${ev.rule_desc ?? ev.rule_name ?? ''}`, 2.2)) break;
        const angle = ipAngle(target || '0.0.0.0') + (Math.random() - 0.5) * 2.5;
        doVisual(visual, angle, COLORS.threat, ev, se);
        break;
      }

      case 'block': {
        const visual = settings.hBlock;
        if (visual === 'none') break;
        if (!throttle.allow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 3)) break;
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.block, ev, se);
        audio.cueSong('block', ev.src_ip ?? undefined);
        break;
      }

      case 'allow': {
        const visual = settings.hAllow;
        if (visual === 'none') break;
        if (!throttle.allow(`alw|${ev.dst_ip}`, 1.8)) break;
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.allow, ev, se);
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      }

      case 'dns': {
        const visual = settings.hDns;
        if (visual === 'none') break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!throttle.allow(`dns|${ev.src_ip}|${ev.dns_query}`, 2)) break;
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.dns, ev, se);
        break;
      }

      case 'dhcp': {
        const visual = settings.hDhcp;
        if (visual === 'none') break;
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.dhcp, ev, se);
        audio.cueSong('dhcp');
        if (ev.syslog_host && settings.hBuildings) compound.buildingEvent(ev.syslog_host, 'info', COLORS.dhcp);
        break;
      }

      case 'wifi': {
        const visual = settings.hWifi;
        if (visual === 'none') break;
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.mac_address}|${ev.wifi_event}`, 3)) break;
        audio.cueSong('wifi');
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.wifi, ev, se);
        break;
      }

      case 'system': {
        const visual = settings.hSystem;
        if (visual === 'none') break;
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        const angle = externalAngle(se);
        doVisual(visual, angle, COLORS.system, ev, se);
        audio.cueSong('system');
        if (ev.syslog_host && settings.hBuildings) compound.buildingEvent(ev.syslog_host, 'info', COLORS.system);
        break;
      }
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;

    groove.update(dtReal, settings.hMusicVisuals ? audio.pulse() : null);

    // 3-beat horde progression
    if (horde.active) {
      horde.beatT += dt;
      if (horde.beat === 1 && horde.beatT > 2) {
        // Beat 2: spawn the horde
        horde.beat = 2;
        horde.beatT = 0;
        zombies.spawnHorde(horde.angle, COLORS.threat);
        alarmKick = 0.7;
      } else if (horde.beat === 2) {
        // Beat 3: watch for breach (handled by hits below)
        if (zombies.hordes() === 0) {
          horde.active = false;
          horde.beat = 0;
        }
      }
    }

    const hits = zombies.update(dt, sky.darkness, walkers.positions(), groove.beat, walkers.vulnerablePositions());
    walkers.update(dt, sky.darkness, settings.hNightExtras, zombies.positions());
    const attacked = zombies.underAttack();
    audio.setThreatActive(attacked);
    alarmKick = Math.max(0, alarmKick - dt * 0.8);
    const alarmTarget = Math.max(attacked ? 1 : 0, alarmKick);
    alarm += (alarmTarget - alarm) * Math.min(1, dt * (alarmTarget > alarm ? 1.2 : 0.6));

    // breach impact: debris, crack, shake, sound
    for (const b of hits.breaches) {
      audio.sfx('breach', { pan: (b.x / L.w) * 2 - 1 });
      fx.debris(b.x, b.y, 14);
      fx.emit(b.x, b.y, 0xff4422, 8, 100, 0.3, 0.5);
      compound.addWallCrack(b.x, b.y);
      state.slowmo(0.35, 0.4);
      punch += 0.012;
      if (settings.hScreenShake) shake = Math.min(6, shake + 4);
    }
    // horde cleared
    if (horde.active && horde.beat === 2 && zombies.hordes() === 0 && hits.breaches.length === 0) {
      horde.active = false;
      horde.beat = 0;
    }

    // muzzle flash + smoke on tower fire
    if (hits.kills.length > 0) {
      for (const k of hits.kills) {
        const near = compound.towersNear(k);
        if (near.length > 0) {
          const muzzle = compound.aim(near[0].i, k);
          fx.muzzleFlash(muzzle.x, muzzle.y);
          fx.smokePuff(muzzle.x, muzzle.y);
        }
      }
    }

    // parachutes descend
    for (let i = parachutes.length - 1; i >= 0; i--) {
      const p = parachutes[i];
      if (!p.landed) {
        p.y += p.vy * dt;
        p.x += Math.sin(t * 1.5 + i * 2) * 8 * dt;
        if (p.y >= p.targetY) {
          p.y = p.targetY;
          p.landed = true;
          p.crate = { x: p.x, y: p.y };
          fx.ring(p.x, p.y, COLORS.allow, 30 * L.unit, 2, 0.8);
          fx.emit(p.x, p.y, 0xaaaaaa, 6, 40, 0.2, 0.5);
          audio.sfx('breach', { count: 1, pan: (p.x / L.w - 0.5) * 0.4 });
        }
      } else {
        p.landedT += dt;
        if (p.landedT > 5) {
          if (p.crate) fx.ring(p.crate.x, p.crate.y, COLORS.allow, 20 * L.unit, 1, 0.4);
          parachutes.splice(i, 1);
        }
      }
    }

    // perimeter lights track zombies
    compound.updatePerimeter(zombies.positions(), dt);

    // pressure to score
    const pressure = Math.min(1, (zombies.count() / Math.max(1, settings.hMaxZombies)) * 0.5 + (attacked ? 0.4 : 0) + (alarm * 0.3));
    (audio as unknown as { setPressure?: (p: number) => void }).setPressure?.(pressure);

    // corpses age out
    zombies.updateCorpses(dt);

    // birds during calm
    fx.birdEnabled = state.weather === 'calm' && settings.hNightExtras;
    fx.updateBirds(dt, L.w, L.h);

    // tiny shake on tower volleys (3+ kills in one frame)
    if (hits.kills.length >= 3 && settings.hScreenShake) shake = Math.min(3, shake + 1.5);

    fx.update(dt);
    compound.update(dt, sky.darkness, alarm, groove);
    sky.update(dt, state.weather, settings.hDayNight, settings.hRain, alarm, settings.hNightExtras,
      settings.hMusicVisuals && groove.style ? groove.heart : null);

    // draw parachutes (canopy + lines + crate)
    const paraG = fx.parachuteG;
    paraG.clear();
    for (const p of parachutes) {
      if (!p.landed) {
        const cy = p.y - 12 * L.unit;
        const canopyR = 7 * L.unit;
        // canopy: filled half-circle (umbrella seen from below)
        paraG.moveTo(p.x - canopyR, cy)
          .arc(p.x, cy, canopyR, Math.PI, 0, true)
          .closePath()
          .fill({ color: 0xf0f0f0, alpha: 0.85 });
        // suspension lines
        paraG.moveTo(p.x - canopyR * 0.8, cy)
          .lineTo(p.x, p.y + 4 * L.unit)
          .stroke({ width: 1, color: 0xbbbbbb, alpha: 0.6 });
        paraG.moveTo(p.x + canopyR * 0.8, cy)
          .lineTo(p.x, p.y + 4 * L.unit)
          .stroke({ width: 1, color: 0xbbbbbb, alpha: 0.6 });
        // crate
        paraG.rect(p.x - 3 * L.unit, p.y + 3 * L.unit, 6 * L.unit, 5 * L.unit)
          .fill({ color: 0x8a7a5a, alpha: 0.9 });
      } else if (p.crate) {
        const a = Math.max(0, 1 - (p.landedT - 3) / 2);
        if (a > 0) paraG.rect(p.crate.x - 3 * L.unit, p.crate.y - 3 * L.unit, 6 * L.unit, 5 * L.unit).fill({ color: 0x8a7a5a, alpha: a });
      }
    }

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
      fx.blood = settings.hBlood;
      if (!settings.hBlood) fx.clearDecals();
      compound.setBuildingsVisible(settings.hBuildings);
    },
    setResolution(scale) {
      if (app.renderer.resolution !== scale) {
        app.renderer.resolution = scale;
        compound.rebakeGround(scale);
      }
    },
    stats: () => ({ nodes: countNodes(app.stage) }),
    diag: () => ({ app, compound, zombies, walkers, sky, groove, audio }),
  };
}

function countNodes(c: Container): number {
  let n = c.children.length;
  for (const child of c.children) n += countNodes(child as Container);
  return n;
}
