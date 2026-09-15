import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { RACING_BUDGETS, RACING_CONTROLS, RACING_DEFAULTS, RACING_HUD } from './settings';
import { createWorld } from './world';
import { Road } from './road';
import { City } from './city';
import { Traffic } from './traffic';
import { Fx } from './fx';
import { bend, bendAt } from './bend';
import { glow } from './textures';
import { racingScore } from './score';
import { Groove } from '../../sound/groove';
import { hudLabels } from '../../hud/hud';
import { Dash } from './dash';
import './hud.css';

/** The event colour law, shared with the log legend. */
const COLORS = {
  allow: 0x5ce6a4,
  block: 0xff6b6b,
  dns: 0x55b5ff,
  dhcp: 0xffd84d,
  wifi: 0xc08cff,
  threat: 0xff9a45,
};

/**
 * Midnight Run: the network as a street race through a neon city at night.
 * Permitted traffic is cars on the road, blocks are roadblocks the car smashes
 * or swerves around, IDS threats bring a police chase, DHCP clients pull up as
 * rivals with their hostname on a plate, DNS lookups take over the billboards,
 * Wi-Fi joins raise neon gates over the road, and traffic sets the speed.
 * Rendered with three.js: a curved-world shader bends a straight road into
 * corners and hills, with bloom, wet reflections and a chase camera.
 */
export const racing: Theme<typeof RACING_DEFAULTS> = {
  id: 'racing',
  title: 'MIDNIGHT RUN',
  hud: RACING_HUD,
  accentHue: 318,
  defaults: RACING_DEFAULTS,
  budgets: RACING_BUDGETS,
  controls: RACING_CONTROLS,
  score: racingScore,
  create,
};
export default racing;

async function create(host: ThemeHost<typeof RACING_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.antialias,
    init.powerPref === 'default' ? undefined : init.powerPref, init.resolution);
  const { scene, camera } = world;
  const glowTex = glow();

  let far = settings.rDrawDistance;
  const road = new Road(scene, far);
  const city = new City(scene, far);
  const traffic = new Traffic(scene, glowTex);
  traffic.poles = (zMin, zMax) => city.lampPosts(zMin, zMax);
  const fx = new Fx(scene, traffic.player.group, glowTex);
  const dash = new Dash();
  const weatherNames = hudLabels(RACING_HUD).weather;

  function applyBudgets(): void {
    far = settings.rDrawDistance;
    road.setFar(far);
    city.setFar(far);
    traffic.far = far;
    traffic.maxCars = settings.rMaxCars;
    fx.density = settings.rRain;
    world.lens.enabled = settings.rLens;
  }
  applyBudgets();

  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));

  // ── driving state ──
  let speed = 30, travelled = 0, wet = 0.45, rain = 0, nitro = 0;
  let rateFast = 0, rateSlow = 0, arrivals = 0;
  let camX = 0, camShake = 0, fov = 62, bootT = -1, nitroOn = false, boost = 0, aggression = 0, lastWall = performance.now() / 1000;
  const groove = new Groove();
  const bendTarget = { x: 0, y: 0 };

  function event(se: SceneEvent, replay: boolean): void {
    if (replay) return;
    arrivals++;
    dash.event(se);
    const ev = se.ev;
    switch (se.kind) {
      case 'allow': {
        if (!settings.rTraffic || !throttle.allow(`alw|${ev.dst_ip}`, 1.2)) break;
        traffic.traffic(COLORS.allow, se.scope === 'inbound', speed);
        audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
        break;
      }
      case 'block': {
        if (!settings.rRoadblocks || !throttle.allow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 3)) break;
        traffic.roadblock();
        audio.cueSong('block', ev.src_ip ?? undefined);
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (settings.rPolice && throttle.allow(`thr|${ev.dst_ip ?? ev.mac_address ?? ''}`, 2.2)) traffic.pursuit(speed);
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (settings.rBillboards && ev.dns_query && throttle.allow(`dns|${ev.dns_query}`, 6)) city.takeover(ev.dns_query);
        break;
      }
      case 'dhcp': {
        if (!throttle.allow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
        const name = ev.hostname ||
          (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'rival');
        if (settings.rRivals) traffic.rival(name, COLORS.dhcp, speed);
        audio.cueSong('dhcp');
        break;
      }
      case 'wifi': {
        if (!throttle.allow(`wifi|${ev.syslog_host}|${ev.wifi_event}`, 4)) break;
        audio.cueSong('wifi');
        if (settings.rGates && ev.syslog_host && se.wifi !== 'other') traffic.gate(ev.syslog_host, se.wifi === 'joined');
        break;
      }
      case 'system': {
        if (!throttle.allow(`sys|${ev.syslog_host}`, 4)) break;
        city.brownOut();
        audio.cueSong('system');
        break;
      }
    }
  }

  function frame(f: FrameInfo): void {
    const { dt, dtReal, t } = f;
    if (bootT < 0) bootT = t;

    // traffic sets the pace; a sudden burst lights the nitro
    // measured on the wall clock: frame time is capped, and a slow frame must not look like a traffic spike
    const wall = performance.now() / 1000, wallDt = Math.min(1, Math.max(1e-3, wall - lastWall));
    lastWall = wall;
    rateFast += (arrivals / wallDt - rateFast) * Math.min(1, wallDt * 1.2);
    rateSlow += (rateFast - rateSlow) * Math.min(1, wallDt * 0.08);
    arrivals = 0;
    // only once there's a baseline: the first seconds after load aren't a burst
    const burst = rateSlow > 2 && t - bootT > 20 ? rateFast / rateSlow : 1;
    nitro += ((burst > 2 ? 1 : 0) - nitro) * Math.min(1, dtReal * (burst > 2 ? 2 : 0.7));
    const cruise = 26 + Math.min(34, rateSlow * 1.1);
    // how hard our driver pushes through traffic: polite on a quiet network, a battering ram when it's slammed
    aggression += (Math.min(1, Math.max(0, (rateSlow - 8) / 22) + nitro * 0.35) - aggression) * Math.min(1, dtReal * 0.5);
    // no brakes: when it gets wild the car goes faster, and puts its foot down to make a gap before it closes
    const want = cruise + nitro * 16 + aggression * 8 + boost;
    speed += (want - speed) * Math.min(1, dt * (want < speed ? 6 : 0.9 + aggression * 1.3));
    travelled += speed * dt;

    // the road winds: slow sums of sines steer the curved world
    bendTarget.x = Math.sin(travelled * 0.0011) * 0.00042 + Math.sin(travelled * 0.00041 + 1.3) * 0.00028;
    bendTarget.y = Math.sin(travelled * 0.0007 + 2.1) * 0.000055;
    bend.value.x += (bendTarget.x - bend.value.x) * Math.min(1, dt * 0.8);
    bend.value.y += (bendTarget.y - bend.value.y) * Math.min(1, dt * 0.8);

    // weather: always a damp night; rain comes with storms
    const w = state.weather;
    const rainTarget = settings.rWeather ? (w === 'hurricane' ? 1 : w === 'storm' ? 0.5 : 0) : 0;
    rain += (rainTarget - rain) * Math.min(1, dt * 0.3);
    wet += ((0.5 + rain * 0.5) - wet) * Math.min(1, dt * 0.3);
    const fog = scene.fog as { density: number };
    fog.density = Math.max(0.0035 + rain * 0.0025, 2.6 / far);

    // the soundtrack hears the car; the neon hears the soundtrack
    audio.sfx('drive', { count: speed, variant: String(Math.round(nitro * 100)) });
    if (nitro > 0.5 && !nitroOn) audio.sfx('nitro');
    nitroOn = nitro > 0.5 ? true : nitro < 0.2 ? false : nitroOn;
    groove.update(dtReal, settings.rMusicVisuals ? audio.pulse() : null);
    const beatGlow = settings.rMusicVisuals && groove.style ? 0.8 + groove.downbeat * 0.45 + groove.energy * 0.2 : 1;

    road.update(dt, speed, wet, beatGlow);
    city.update(dt, speed, wet);
    const hits = traffic.update(dt, t, speed, cruise + nitro * 16 + aggression * 8, aggression, camera);
    if (hits.honk) audio.sfx('honk', { pan: Math.max(-1, Math.min(1, traffic.playerX / 8)) });
    boost = hits.boost;
    traffic.player.underglowMat.opacity *= settings.rMusicVisuals && groove.style ? 0.75 + groove.downbeat * 0.35 : 1;
    // collisions: our speed takes the hit, sparks fly where metal met metal, the crash is heard in place
    speed = Math.max(4, speed + hits.playerDv);
    for (const im of hits.impacts) {
      fx.burst(im.x, 0.6, im.z, Math.min(40, 6 + im.strength * 5), 5 + im.strength * 1.5);
      const pan = Math.max(-1, Math.min(1, im.x / 9));
      audio.sfx(im.strength > 3 ? 'smash' : 'bump', { pan, count: im.strength });
      if (im.player && settings.rShake) camShake = Math.min(1, camShake + Math.min(0.7, im.strength * 0.12));
    }
    fx.update(dt, rain, nitro, speed, camera.position.z);
    audio.setThreatActive(traffic.police());
    dash.update(dtReal, { state, speed, nitro, travelled, eps: state.rate30s / 30, map: traffic.mapData(), weather: weatherNames }, traffic.police());

    // chase camera: trails the car's lateral moves, looks down the (bent) road
    camX += (traffic.playerX * 0.65 - camX) * Math.min(1, dtReal * 3);
    camShake = Math.max(0, camShake - dtReal * 1.8);
    const wobble = Math.sin(t * 30) * camShake * 0.12;
    const ahead = bendAt(-45);
    camera.position.set(camX + f.wanderX * 0.003 + wobble, 2.95 + f.wanderY * 0.002, 7.6 + nitro * 0.9);
    camera.lookAt(traffic.playerX * 0.8 + ahead.x * 0.5, 1.0 + ahead.y * 0.5, -16);
    fov += ((60 + nitro * 12 + (speed - 30) * 0.12) - fov) * Math.min(1, dtReal * 2);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    world.skyline.rotation.y = -bend.value.x * 400;

    world.render(settings.rBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles }),
    diag: () => ({ renderer: world.renderer, scene, camera, traffic, city, audio }),
  };
}
