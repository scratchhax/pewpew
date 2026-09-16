import { Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { hash } from '../../sound/conductor';
import { Groove } from '../../sound/groove';
import { GIBSON_BUDGETS, GIBSON_CONTROLS, GIBSON_DEFAULTS, GIBSON_HUD } from './settings';
import { createWorld } from './world';
import { TextAtlas } from './textatlas';
import { Towers } from './towers';
import { Ground } from './ground';
import { Billboards } from './billboards';
import { gibsonScore } from './score';
import './hud.css';

/**
 * The Gibson: the storage wall from the movie, drifting past in the dark.
 * Towers of scrolling listings are your data; allowed traffic sends a pulse
 * of light climbing a face, a denial burns one red and floats an ACCESS
 * DENIED sign over the tops, a DHCP lease writes a brand-new tower that
 * rises out of the floor, and DNS lookups join the listings. When an IDS
 * threat lands, the camera swings around to lock onto a red file and rides
 * it until it passes — intruder traced. Rendered with three.js.
 */
export const gibson: Theme<typeof GIBSON_DEFAULTS> = {
  id: 'gibson',
  title: 'THE GIBSON',
  hud: GIBSON_HUD,
  accentHue: 232,
  defaults: GIBSON_DEFAULTS,
  budgets: GIBSON_BUDGETS,
  controls: GIBSON_CONTROLS,
  score: gibsonScore,
  create,
};
export default gibson;

async function create(host: ThemeHost<typeof GIBSON_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.antialias, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution, settings.gSmooth);
  const atlas = new TextAtlas();
  const towers = new Towers(world.scene, atlas);
  const ground = new Ground(world.scene);
  const billboards = new Billboards(world.scene, towers.rows);
  const groove = new Groove();

  const overlay = document.createElement('div');
  overlay.id = 'gib-overlay';
  overlay.innerHTML = '<div class="gb-lock"><div class="gb-reticle"><i></i><i></i><i></i><i></i></div><div class="gb-track">TRACKING</div></div><div class="gb-stamp">INTRUSION TRACED</div>';
  document.body.appendChild(overlay);
  const lockBox = overlay.querySelector('.gb-lock') as HTMLElement;
  const trackEl = overlay.querySelector('.gb-track') as HTMLElement;
  const stampEl = overlay.querySelector('.gb-stamp') as HTMLElement;
  const reticle = overlay.querySelector('.gb-reticle') as HTMLElement;

  const rebuildTimer = window.setInterval(() => atlas.rebuild(), 4000);

  // ── target lock ──
  // The lock grabs where the flagged file is at lock-on time and holds the
  // gaze on it, timer-driven: a quality rebuild of the tower grid mid-lock
  // can't strand it.
  const uOf = (s?: string | null) => (s ? (hash(s) % 1000) / 1000 : Math.random());
  const lockTarget = new Vector3();
  let lockOn = false;
  let lockUntil = 0;
  const look = new Vector3(0, 1.0, -30);
  const lookWant = new Vector3(0, 1.0, -30);

  function startLock(ip: string | null): boolean {
    if (lockOn) return false;
    const pick = towers.pickLock();
    if (!pick) return false;
    lockTarget.set(pick.x, pick.y, pick.z);
    lockOn = true;
    lockUntil = performance.now() + 5200;
    trackEl.textContent = `TRACKING · ${(ip ?? 'UNKNOWN').toUpperCase()}`;
    lockBox.classList.add('on');
    audio.sfx('lock');
    return true;
  }
  function endLock(): void {
    lockOn = false;
    lockBox.classList.remove('on');
    stampEl.classList.add('on');
    audio.sfx('found');
    window.setTimeout(() => stampEl.classList.remove('on'), 2600);
  }

  function applyBudgets(): void {
    if (towers.cols !== settings.gGridW || towers.rows !== settings.gRows) {
      towers.build(world.scene, settings.gGridW, settings.gRows);
    }
  }
  applyBudgets();
  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));

  // the film's signs are rare, punctuation not wallpaper: minutes apart
  let nextDeny = 0, nextGrant = 0;
  const banner = (text: string, color: string, nextRef: 'deny' | 'grant', everySec: number, jitterSec: number) => {
    const now = performance.now();
    if (!settings.gBanners || now < (nextRef === 'deny' ? nextDeny : nextGrant)) return;
    if (nextRef === 'deny') nextDeny = now + (everySec + Math.random() * jitterSec) * 1000;
    else nextGrant = now + (everySec + Math.random() * jitterSec) * 1000;
    billboards.spawn(text, color);
  };

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    const who = ev.src_ip ?? ev.dst_ip ?? null;
    if (se.kind === 'allow' || se.kind === 'block' || se.kind === 'threat') atlas.addWord(who);
    if (replay) return;
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', who ?? undefined);
        if (!settings.gPulses || !throttle.allow(`gb|alw|${ev.src_ip}|${ev.dst_ip}`, 0.4)) break;
        towers.pulse(uOf(who));
        audio.sfx('pulse', { pan: (Math.random() - 0.5) * 1.2 });
        break;
      }
      case 'block': {
        audio.cueSong('block', who ?? undefined);
        if (!throttle.allow(`gb|blk|${ev.src_ip}|${ev.dst_port}`, 1.0)) break;
        towers.flag(uOf(who), 3);
        audio.sfx('denied', { pan: (Math.random() - 0.5) * 1.2 });
        banner('ACCESS DENIED', '#ff5050', 'deny', 45, 45);
        break;
      }
      case 'threat': {
        audio.cueSong('threat', who ?? undefined);
        atlas.addWord(who);
        towers.flag(uOf(who), 8);
        if (settings.gLock && throttle.allow(`gb|thr|${who}`, 12)) startLock(who);
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.gLookups || !ev.dns_query || !throttle.allow(`gb|dns|${ev.dns_query}`, 3)) break;
        atlas.addWord(ev.dns_query);
        towers.pulse(uOf(ev.dns_query));
        break;
      }
      case 'dhcp': {
        if (!throttle.allow(`gb|dhcp|${ev.syslog_host}|${ev.hostname}`, 2)) break;
        audio.cueSong('dhcp');
        const name = ev.hostname || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'device');
        atlas.addWord(name);
        if (settings.gWrites) towers.raise(uOf(name));
        audio.sfx('write', { pan: (Math.random() - 0.5) });
        break;
      }
      case 'wifi': {
        if (!throttle.allow(`gb|wifi|${ev.syslog_host}|${ev.wifi_event}`, 3)) break;
        audio.cueSong('wifi');
        if (se.wifi === 'joined') {
          audio.sfx('granted');
          banner('PASSWORD ACCEPTED', '#dff2ff', 'grant', 70, 50);
          towers.pulse(uOf(ev.mac_address ?? ev.src_ip));
        } else if (se.wifi === 'bad') {
          audio.sfx('denied', { pan: 0.3 });
          towers.flag(uOf(ev.mac_address), 4);
        }
        break;
      }
      case 'system': {
        if (throttle.allow(`gb|sys|${ev.syslog_host}`, 6)) audio.cueSong('system');
        break;
      }
    }
  }

  // ── frame ──
  let heat = 0;

  function frame(f: FrameInfo): void {
    const { dt, dtReal } = f;
    groove.update(dtReal, settings.gMusicVisuals ? audio.pulse() : null);
    const w = state.weather;
    heat += ((w === 'hurricane' ? 1 : w === 'storm' ? 0.4 : 0) - heat) * Math.min(1, dtReal * 0.25);
    const pulse = settings.gMusicVisuals && groove.style ? 0.85 + groove.downbeat * 0.25 + groove.energy * 0.15 : 1;

    // the lock: slow the wall, swing the camera onto the red file, ride it past
    if (lockOn) {
      if (performance.now() > lockUntil) endLock();
      else lookWant.copy(lockTarget);
    }
    if (!lockOn) lookWant.set(f.wanderX * 0.01, 1.0, -30);
    look.lerp(lookWant, Math.min(1, dtReal * 1.2));
    if (lockOn) {
      const sp = lockTarget.clone().project(world.camera);
      reticle.style.left = `${(sp.x * 0.5 + 0.5) * 100}%`;
      reticle.style.top = `${(-sp.y * 0.5 + 0.5) * 100}%`;
    }

    const rate = state.rate30s / 30;
    const speed = (2.0 + Math.min(6, rate * 0.15) + heat * 2.2) * settings.gScrollSpeed * (lockOn ? 0.3 : 1);
    const camX = (lockOn ? lockTarget.x : 0) * 0.25 + f.wanderX * 0.0015;
    world.camera.position.x += (camX - world.camera.position.x) * Math.min(1, dtReal * 1.4);
    world.camera.position.y = 8 + f.wanderY * 0.0006;
    world.camera.lookAt(look);

    const fog = 0.044 + heat * 0.005;
    towers.update(dt, speed, world.camera.position);
    ground.update(dt, speed, pulse, fog, world.camera.position);
    billboards.update(dt, speed);
    (towers.material.uniforms.uPulse.value as number) = pulse;
    world.lens.uniforms.uTime.value += dtReal;
    audio.sfx('scroll', { count: speed * 10 });
    audio.setThreatActive(lockOn || towers.redCount() > 0);
    world.render(settings.gBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles, towers: towers.cols * towers.rows, red: towers.redCount(), lock: lockOn ? 'ON' : 'off', signs: billboards.count }),
    diag: () => ({
      renderer: world.renderer, scene: world.scene, camera: world.camera, atlas, towers, ground, billboards, audio,
      banner: (t?: string) => billboards.spawn(t ?? 'ACCESS GRANTED', '#9fd8ff'),
      lock: (ip?: string) => startLock(ip ?? '10.0.0.666'),
      stopRebuild: () => window.clearInterval(rebuildTimer),
    }),
  };
}
