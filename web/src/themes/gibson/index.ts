import { Vector3 } from 'three';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { hash } from '../../sound/conductor';
import { Groove } from '../../sound/groove';
import { GIBSON_BUDGETS, GIBSON_CONTROLS, GIBSON_DEFAULTS, GIBSON_HUD } from './settings';
import { createWorld } from './world';
import { TextAtlas } from './textatlas';
import { CITY_P, TURN_R, Towers } from './towers';
import { Ground } from './ground';
import { Billboards } from './billboards';
import { gibsonScore } from './score';
import './hud.css';

/**
 * The Gibson: the storage wall as a computer city, flown slowly through in
 * the dark. Translucent towers of scrolling listings stand in a fixed lattice
 * of blocks; the flight patrols its streets, gliding straight down most
 * blocks and swinging a full ninety degrees at the odd intersection, banking
 * like a patrol car. Allowed traffic sends a pulse of light climbing a face,
 * a denial burns one red and hangs an ACCESS DENIED sign on it, a DHCP lease
 * rewrites a far tower, and DNS lookups join the listings. When an IDS
 * threat lands, the gaze swings onto a red file and rides it until it
 * passes - intruder traced. Rendered with three.js.
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
  const billboards = new Billboards(world.scene);
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
  // gaze on it, timer-driven: a lattice wrap mid-lock can't strand it.
  const uOf = (s?: string | null) => (s ? (hash(s) % 1000) / 1000 : Math.random());
  const lockTarget = new Vector3();
  let lockOn = false;
  let lockUntil = 0;

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
  let nextDeny = 0, nextGrant = 0, flyT = Math.random() * 100;

  // ── the flight ──
  // The city stands still; the camera flies it. Headings are the four street
  // directions (k = 0..3, forward = (sin, cos)(k·pi/2)); flight rides the
  // street lattice lines. At each intersection it goes straight about half
  // the time, and otherwise carves a quarter arc of radius TURN_R - which
  // fits inside the street width, so the flight can't clip a tower or leave
  // the city - landing exactly on the crossing street's line. Straights ease
  // their speed down through a turn; nothing ever stops.
  let cx = 0, cz = 40;
  let kHead = 2; // down the street x = 0, heading -z
  let decidedFor = -1;
  let arc: null | { cX: number; cZ: number; p: number; d: number; k0: number; axis: 'x' | 'z'; nLine: number } = null;
  let roll = 0;
  const fOf = (k: number): [number, number] => [[0, 1], [1, 0], [0, -1], [-1, 0]][k] as [number, number];
  const look = new Vector3(0, 1.5, 10);
  const lookWant = new Vector3(0, 1.5, 10);

  /** the next street line ahead, as (lattice index, distance along heading) */
  function nextLine(): [number, number] {
    if (kHead === 0) { const n = Math.floor(cz / CITY_P) + 1; return [n, n * CITY_P - cz]; }
    if (kHead === 2) { const n = Math.floor(cz / CITY_P); return [n, cz - n * CITY_P]; }
    if (kHead === 1) { const n = Math.floor(cx / CITY_P) + 1; return [n, n * CITY_P - cx]; }
    const n = Math.floor(cx / CITY_P); return [n, cx - n * CITY_P];
  }

  function fly(dtReal: number, v: number): void {
    if (arc) {
      arc.p = Math.min(arc.p + (v * dtReal) / TURN_R, Math.PI / 2);
      // position on the arc: center + radius vector, sweeping a quarter turn
      const a = arc.k0 * (Math.PI / 2) - arc.d * (Math.PI / 2 - arc.p);
      cx = arc.cX + TURN_R * Math.sin(a);
      cz = arc.cZ + TURN_R * Math.cos(a);
      if (arc.p >= Math.PI / 2) {
        // land exactly on the crossing street, then straighten out
        if (arc.axis === 'z') cz = arc.nLine * CITY_P; else cx = arc.nLine * CITY_P;
        kHead = (arc.k0 + arc.d + 4) % 4;
        arc = null;
      }
      return;
    }
    const [fx, fz] = fOf(kHead);
    cx += fx * v * dtReal;
    cz += fz * v * dtReal;
    if (lockOn) return;
    const [n, dist] = nextLine();
    if (dist <= TURN_R && n !== decidedFor) {
      decidedFor = n;
      const r = Math.random();
      if (r < 0.5) return; // patrol car goes straight through
      const d = r < 0.75 ? 1 : -1;
      // snap onto the arc's start: exactly TURN_R before the intersection
      const line = n * CITY_P;
      const sx = kHead === 1 ? line - TURN_R : kHead === 3 ? line + TURN_R : cx;
      const sz = kHead === 0 ? line - TURN_R : kHead === 2 ? line + TURN_R : cz;
      const phi0 = kHead * (Math.PI / 2);
      // arc center sits TURN_R to the turn side of the start point
      arc = {
        cX: sx + d * TURN_R * Math.cos(phi0),
        cZ: sz - d * TURN_R * Math.sin(phi0),
        p: 0, d, k0: kHead, axis: kHead % 2 === 0 ? 'z' : 'x', nLine: line / CITY_P,
      };
    }
  }

  const banner = (text: string, color: string, nextRef: 'deny' | 'grant', everySec: number, jitterSec: number) => {
    const now = performance.now();
    if (!settings.gBanners || now < (nextRef === 'deny' ? nextDeny : nextGrant)) return;
    if (nextRef === 'deny') nextDeny = now + (everySec + Math.random() * jitterSec) * 1000;
    else nextGrant = now + (everySec + Math.random() * jitterSec) * 1000;
    billboards.spawn(text, color, towers.pickFace());
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

    // the lock: slow the flight, swing the gaze onto the red file, ride past
    if (lockOn && performance.now() > lockUntil) endLock();
    flyT += dtReal;
    const rate = state.rate30s / 30;
    const v = (0.9 + Math.min(2.5, rate * 0.06) + heat * 0.9) * settings.gScrollSpeed * (lockOn ? 0.3 : arc ? 0.7 : 1);
    fly(dtReal, v);

    const camY = lockOn ? 3.0 : 2.4 + Math.sin(flyT * 0.067) * 0.35 + f.wanderY * 0.0004;
    if (lockOn) {
      lookWant.copy(lockTarget);
      const sp = lockTarget.clone().project(world.camera);
      reticle.style.left = `${(sp.x * 0.5 + 0.5) * 100}%`;
      reticle.style.top = `${(-sp.y * 0.5 + 0.5) * 100}%`;
    } else {
      // gaze down the street we're on; mid-arc the heading rotates with the
      // flight, so the look leads it naturally into and out of the turn
      const a = arc ? arc.k0 * (Math.PI / 2) + arc.d * arc.p : kHead * (Math.PI / 2);
      lookWant.set(cx + Math.sin(a) * 20 + f.wanderX * 0.0012, 1.5 + Math.sin(flyT * 0.055) * 0.3, cz + Math.cos(a) * 20);
    }
    look.lerp(lookWant, Math.min(1, dtReal * 2.2));

    world.camera.position.set(cx + f.wanderX * 0.001, camY, cz);
    world.camera.lookAt(look);
    // bank through the arc, easing in and out like a patrol car
    const rollWant = arc && !lockOn ? -arc.d * Math.sin((arc.p / (Math.PI / 2)) * Math.PI) * 0.07 : 0;
    roll += (rollWant - roll) * Math.min(1, dtReal * 4);
    if (roll !== 0) world.camera.rotateZ(roll);

    const fog = 0.044 + heat * 0.005;
    const [fx, fz] = fOf(kHead);
    towers.update(dt, cx, cz, kHead);
    ground.update(dt, pulse, fog, cx, cz);
    billboards.update(dt, cx, cz, fx, fz);
    (towers.material.uniforms.uPulse.value as number) = pulse;
    world.lens.uniforms.uTime.value += dtReal;
    audio.sfx('scroll', { count: v * 10 });
    audio.setThreatActive(lockOn || towers.redCount() > 0);
    world.render(settings.gBloom);
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ calls: world.renderer.info.render.calls, tris: world.renderer.info.render.triangles, towers: towers.count, red: towers.redCount(), lock: lockOn ? 'ON' : 'off', signs: billboards.count }),
    diag: () => ({
      renderer: world.renderer, scene: world.scene, camera: world.camera, atlas, towers, ground, billboards, audio,
      banner: (t?: string) => billboards.spawn(t ?? 'ACCESS GRANTED', '#9fd8ff', towers.pickFace()),
      lock: (ip?: string) => startLock(ip ?? '10.0.0.666'),
      stopRebuild: () => window.clearInterval(rebuildTimer),
    }),
  };
}
