import { Application, Container } from 'pixi.js';
import { loadSettings } from './settings';
import { State, ipAngle, hash01, isInternalIp } from './state';
import { Feed } from './ws';
import { buildTextures } from './textures';
import { NetEvent } from './types';
import { Starfield } from './scenes/starfield';
import { Dust } from './scenes/dust';
import { Station } from './scenes/station';
import { Rings } from './scenes/rings';
import { Fx } from './scenes/fx';
import { Crystals } from './scenes/crystals';
import { Asteroids } from './scenes/asteroids';
import { ApCores } from './scenes/apcores';
import { EventStars } from './scenes/eventstars';
import { Planets } from './scenes/planets';
import { Constellation } from './scenes/constellation';
import { AmbientShips } from './scenes/ambientships';
import { Hud } from './hud/hud';
import { Audio } from './audio';
import { SettingsPanel } from './hud/settingsPanel';

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

/** Energy pulse hues — picked per pulse for variety. */
const ENERGY_HUES = [0x5ce6a4, 0x7dffb0, 0x4dffd8, 0xa8ff6b, 0x55e0ff, 0x6bffc4];
function energyColor(): number {
  return ENERGY_HUES[(Math.random() * ENERGY_HUES.length) | 0];
}

function wifiStarColor(ev: NetEvent): number {
  const e = `${ev.wifi_event ?? ''} ${ev.wifi_reason ?? ''}`.toLowerCase();
  for (const [re, c] of WIFI_STAR) if (re.test(e)) return c;
  return COLORS.wifi;                            // plain join/assoc → wifi purple
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const state = new State();

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#02040a',
    antialias: false,
    powerPreference: 'low-power',
  });
  document.getElementById('app')!.appendChild(app.canvas);

  let w = app.screen.width, h = app.screen.height;
  const textures = buildTextures();

  // ── layers ──
  const bgLayer = new Container();
  const world = new Container();
  const shipLayer = new Container();
  const dustLayer = new Container();
  const constellationLayer = new Container();
  const ringsLayer = new Container();
  const apLayer = new Container();
  const eventStarLayer = new Container();
  const fxLayer = new Container();
  const stationLayer = new Container();
  const planetLayer = new Container();
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
  const dust = new Dust(dustLayer, textures.glow, w, h);
  const ambient = new AmbientShips(shipLayer, [...textures.icons, ...textures.ships], w, h);
  const station = new Station(stationLayer, textures.glow, w, h);
  const rings = new Rings(ringsLayer, textures.dot, w, h);
  const crystals = new Crystals(fxLayer, textures.crystal, textures.glow, fx);
  const asteroids = new Asteroids(fxLayer, textures.asteroids, fx);
  const apCores = new ApCores(apLayer, textures.glow, fx, w, h);
  const eventStars = new EventStars(eventStarLayer, textures.dot, textures.glow);
  const planets = new Planets(planetLayer, textures.planets, w, h);
  const constellation = new Constellation(constellationLayer, textures.dot, textures.glow, w, h);
  const hud = new Hud(settings);
  const audio = new Audio(settings);
  hud.attachAudio(audio);
  const panel = new SettingsPanel(settings, () => {
    hud.applySettings(settings);
    audio.setVolume(settings.volume);
    audio.setEnabled(settings.audio);
    starfield.rebuild();
    if (!settings.constellations) clearConstellation();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); panel.toggle(); }
  });

  function clearConstellation(): void {
    for (const child of [...constellationLayer.children]) {
      if (child instanceof Container) child.destroy({ children: true });
    }
  }

  window.addEventListener('resize', () => {
    w = app.screen.width; h = app.screen.height;
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
  let wanderSeed = Math.random() * Math.PI * 2;
  let nextAnchorShuffle = performance.now() + 10 * 60_000;
  const hudEl = document.getElementById('hud')!;
  let punch = 0;

  // ── event router ──
  // Every line drawn on screen connects two VISIBLE objects:
  //   station core ↔ IP star, station core ↔ AP core, station ↔ asteroid.
  // Visual flow control: a real UDM stream runs 10-100+ events/sec, so effects
  // must not be 1:1. Terminal + meters always see every event; visuals dedupe
  // per-flow within a window and cap on-screen concurrency.
  const fxSeen = new Map<string, number>();
  function fxAllow(key: string, windowS: number): boolean {
    const now = performance.now() / 1000;
    const last = fxSeen.get(key);
    if (last !== undefined && now - last < windowS) return false;
    fxSeen.set(key, now);
    if (fxSeen.size > 4000) {
      for (const [k, t] of fxSeen) if (now - t > 120) fxSeen.delete(k);
    }
    return true;
  }

  function route(ev: NetEvent, replay = false): void {
    const cx = w / 2, cy = h / 2;
    // RFC1918 both ends = internal traffic: no "border" semantics
    const dir = isInternalIp(ev.src_ip) && isInternalIp(ev.dst_ip)
      ? 'internal' : (ev.direction ?? 'local');

    if (!replay) hud.log(ev);
    if (!replay && settings.noiseMode) {
      // NOISE MODE screams at the raw feed — the visual fxAllow gates are
      // for visuals; every connection must be heard
      const k = ev.log_type === 'firewall'
        ? (ev.rule_action === 'block' ? 'block' : 'allow')
        : ev.log_type === 'dns' ? 'dns'
        : ev.log_type === 'dhcp' ? 'dhcp'
        : ev.log_type === 'wifi' ? 'wifi' : null;
      if (k) audio.cueNoise(k, ev.src_ip ?? undefined);
    }

    switch (ev.log_type) {
      case 'firewall': {
        if (ev.rule_action === 'block') {
          state.onEvent('block');
          if (replay) break;
          if (settings.asteroids && asteroids.count() < 12 &&
              fxAllow(`blk|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 3)) {
            const ext = dir === 'internal' ? `${ev.src_ip}|${ev.dst_ip}`
              : dir === 'inbound' ? ev.src_ip : ev.dst_ip;
            asteroids.spawn(cx, cy, w, h, ipAngle(ext ?? '0.0.0.0'), COLORS.block);
            if (settings.screenShake) shake = Math.min(14, shake + 4);
            audio.cueSong('block');
          }
        } else {
          state.onEvent('allow');
          rings.activate('general');
          if (!replay) {
            if (settings.crystals && fxAllow(`alw|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 2)) {
              // a permitted connection = energy pulse from src star to dst star
              const a = ev.src_ip && settings.constellations
                ? constellation.starPosition(ev.src_ip) : null;
              const b = ev.dst_ip && settings.constellations
                ? constellation.starPosition(ev.dst_ip) : null;
              if (a && b) {
                const hue = energyColor();
                crystals.spawnToward(a.x, a.y, b.x, b.y, hue,
                  () => { station.flash(0.15); fx.burst(b.x, b.y, hue, 10); });
              } else {
                const ext = dir === 'internal' ? `${ev.src_ip}|${ev.dst_ip}`
                  : dir === 'inbound' ? ev.src_ip : ev.dst_ip;
                crystals.spawn(cx, cy, w, h, ipAngle(ext ?? '0.0.0.0'),
                  dir === 'inbound', COLORS.allow,
                  (x, y) => { station.flash(0.35); fx.burst(x, y, COLORS.allow, 12); });
              }
              audio.cueSong('allow', ev.src_ip ?? ev.dst_ip ?? undefined);
            }
            if (settings.constellations && ev.src_ip && ev.dst_ip &&
                fxAllow(`con|${ev.src_ip}|${ev.dst_ip}`, 10)) {
              constellation.connect(ev.src_ip, ev.dst_ip, COLORS.allow);
            }
          }
          if (!replay) station.flash(0.15);
        }
        break;
      }

      case 'dns': {
        state.onEvent('net');
        rings.activate('dns');
        if (replay) break;
        if (!fxAllow(`dns|${ev.src_ip}|${ev.dns_query}`, 2)) break;
        audio.cueSong('dns', ev.src_ip ?? undefined);
        // client star → station (it IS the resolver): anchored both ends
        if (ev.src_ip && settings.constellations) {
          const st = constellation.starPosition(ev.src_ip);
          fx.laser(st.x, st.y, cx, cy, COLORS.dns, 1.6);
          fx.emit(st.x, st.y, COLORS.dns, 3, 35, 0.16, 0.5);
        }
        fx.emit(cx, cy, COLORS.dns, 4, 45, 0.15, 0.45);
        break;
      }

      case 'dhcp': {
        state.onEvent('net');
        rings.activate('dhcp');
        if (replay) break;
        if (!fxAllow(`dhcp|${ev.syslog_host}|${ev.hostname}`, 5)) break;
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
        const e = `${ev.wifi_event ?? ''} ${ev.wifi_reason ?? ''}`.toLowerCase();
        const bad = /deauth|disassoc|left|leave|fail|kick|reject|disallow|status [1-9]/.test(e);
        const joined = e === 'associated' || e === 'authenticated' || e === 'joined';
        state.onEvent(bad ? 'wifi-bad' : joined ? 'wifi-good' : 'net');
        if (replay) break;
        rings.activate('wifi');
        if (!fxAllow(`wifi|${ev.syslog_host}|${ev.mac_address}|${ev.wifi_event}`, 3)) break;
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
        state.onEvent('system');
        if (!replay && fxAllow(`sys|${ev.syslog_host}`, 4)) {
          fx.shockwave(cx, cy, COLORS.system, 90, 1.5);
          if (ev.syslog_host && settings.apCores) {
            apCores.event(ev.syslog_host, 'info', COLORS.system);
          }
        }
        break;
      }
    }
  }

  let routed = 0;
  const feed = new Feed(
    (ev, meta) => { routed++; if (meta?.demo) hud.showDemo(true); route(ev, false); },
    (events, meta) => {
      if (meta?.demo) hud.showDemo(true);
      hud.setConnected(true);
      for (const ev of events) route(ev, true);
    },
  );
  if (feed.demoMode) { hud.setConnected(true); hud.showDemo(true); }

  if (new URLSearchParams(location.search).has('debug')) {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:50%;transform:translateX(-50%);bottom:6px;
      z-index:50;font:11px monospace;color:#7fd4ff;background:rgba(0,0,0,0.65);
      padding:4px 12px;letter-spacing:1px;display:flex;align-items:center;gap:10px;`;
    const txt = document.createElement('span');
    const btn = document.createElement('button');
    btn.textContent = 'TEST';
    btn.style.cssText = `font:10px monospace;background:#08202e;color:#7fd4ff;
      border:1px solid rgba(127,212,255,0.35);cursor:pointer;padding:1px 8px;`;
    btn.addEventListener('click', () => audio.testTone());
    d.appendChild(txt);
    d.appendChild(btn);
    document.body.appendChild(d);
    setInterval(() => {
      const s = audio.dbgStats();
      const sp = Math.min(400, Math.max(60, 1000 / Math.max(0.5, s.rate))).toFixed(0);
      txt.textContent = `routed ${routed}/s | cues ${s.cues} fires ${s.fires}`
        + ` | q ${s.queue} sp ${sp}ms | alive ${s.alive} drop ${s.dropped}`
        + ` | rms ${s.rms.toFixed(3)} | ${__BUILD__}`;
      routed = 0;
    }, 1000);
  }

  // ── main loop ──
  let zoom = 1;

  app.ticker.add((ticker) => {
    const dtReal = Math.min(0.05, ticker.deltaMS / 1000);
    state.update(dtReal);
    const dt = dtReal * settings.speed * state.timeScale;
    const t = ticker.lastTime / 1000;

    starfield.update(dt, state);
    audio.update(state);
    if (settings.dust) dust.update(dt, state.weather === 'hurricane' ? 2.2 : 1);
    if (settings.ambientShips) ambient.update(dt, state.weather === 'hurricane' ? 2 : 1);
    rings.update(dt);
    crystals.update(dt);

    const hits = asteroids.update(dt, w / 2, h / 2);
    if (hits.impacts.length > 0) {
      state.slowmo(0.25, 0.55);
      punch += 0.06;
      shake = Math.min(22, shake + 10);
    } else if (hits.intercepts.length > 0) {
      punch += 0.015;
    }

    apCores.update(dt);
    if (settings.eventStars) eventStars.update(dt);
    if (settings.planets) planets.update(dt);
    if (settings.constellations) constellation.update(dt);
    fx.update(dt);
    station.update(dt, state);

    // camera
    shake = Math.max(0, shake - dt * 16);
    punch = Math.max(0, punch - dt * 0.25);
    // Anti burn-in: very slow ~±2% screen wander (+ occasional anchor reshuffle)
    // so no pixel pattern is ever painted in exactly the same place.
    const wanderX = Math.sin(t * 0.07 + wanderSeed) * w * 0.02;
    const wanderY = Math.cos(t * 0.053 + wanderSeed) * h * 0.02;
    if (performance.now() > nextAnchorShuffle) {
      wanderSeed = Math.random() * Math.PI * 2;
      nextAnchorShuffle = performance.now() + 10 * 60_000;
    }
    const driftX = wanderX + Math.sin(t * 0.05) * 6 + (Math.random() - 0.5) * shake;
    const driftY = wanderY + Math.cos(t * 0.04) * 4 + (Math.random() - 0.5) * shake;
    const targetZoom = (1 + punch) * (1 + Math.sin(t * 0.031) * 0.004);
    zoom += (targetZoom - zoom) * Math.min(1, dtReal * 5);
    setCamera(zoom, driftX, driftY);
    hudEl.style.transform = `translate(${(wanderX * 0.4).toFixed(1)}px, ${(wanderY * 0.4).toFixed(1)}px)`;

    hud.update(dt, state, settings);
  });
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#ff5a5a;padding:2em">${String(e)}</pre>`;
});
