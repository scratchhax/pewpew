import { Groove } from '../../sound/groove';
import type { FogExp2 } from 'three';
import type { SceneEvent } from '../../events';
import type { RendererInit, Theme, ThemeHost, ThemeInstance, FrameInfo } from '../../theme';
import { FRAGNET_BUDGETS, FRAGNET_CONTROLS, FRAGNET_DEFAULTS, FRAGNET_HUD } from './settings';
import { fragnetScore } from './score';
import { createWorld } from './world';
import { Walls } from './walls';
import { Actors, type Demon } from './sprites';
import { Gun } from './gun';
import { CS, EYE, genLevel, findPath, cellsNear, isFloor, type Level } from './levelgen';
import { drawFace } from './art';
import './hud.css';

/**
 * FRAGNET: your network is Hell. A first-person patrol through a
 * procedural maze in the classic corridor-shooter look - chunky pixels,
 * blast doors, ceiling lamps, imps. The marine is the network stack with
 * a shotgun: allowed traffic fires his gun and feeds his ammo, an IDS
 * threat tears a demon into the corridor and he frags it on the spot
 * (FRAGGED), blocks slam blast doors red, DHCP opens a secret wall with
 * the device's name on it, DNS domains light up on plates, and Wi-Fi
 * joins spin teleporters up. Five traces and the exit elevator opens:
 * E1M2, E1M3, deeper into the maze.
 */
export const fragnet: Theme<typeof FRAGNET_DEFAULTS> = {
  id: 'fragnet',
  title: 'FRAGNET',
  hud: FRAGNET_HUD,
  accentHue: 17,
  defaults: FRAGNET_DEFAULTS,
  budgets: FRAGNET_BUDGETS,
  controls: FRAGNET_CONTROLS,
  score: fragnetScore,
  create,
};
export default fragnet;

async function create(host: ThemeHost<typeof FRAGNET_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;
  const world = createWorld(host.mount, init.powerPref === 'default' ? undefined : init.powerPref, init.resolution, settings.dPixRes);
  const walls = new Walls();
  const gun = new Gun(world.gunScene);
  const actors = new Actors(world.scene, { onDamage, onPickup });

  // ── DOM: status bar, stamps, wipes ──
  const overlay = document.createElement('div');
  overlay.id = 'frg-overlay';
  overlay.innerHTML = `
    <div class="frg-hurt"></div><div class="frg-flash"></div><div class="frg-wipe"></div>
    <div class="frg-title">E1M1: YOUR NETWORK</div>
    <div class="frg-stamp">FRAGGED</div>
    <div class="frg-bar">
      <div class="frg-pad"><span class="frg-cap">HEALTH</span><b class="frg-health">100</b><i>%</i></div>
      <div class="frg-face"><canvas width="32" height="32"></canvas></div>
      <div class="frg-pad"><span class="frg-cap">AMMO</span><b class="frg-ammo">23</b></div>
      <div class="frg-pad"><span class="frg-cap">FRAGS</span><b class="frg-frags">0</b></div>
      <div class="frg-pad frg-lvl">E1M1</div>
    </div>`;
  document.body.appendChild(overlay);
  const el = (sel: string): HTMLElement => overlay.querySelector(sel) as HTMLElement;
  const hurtEl = el('.frg-hurt'), flashEl = el('.frg-flash'), wipeEl = el('.frg-wipe');
  const titleEl = el('.frg-title'), stampEl = el('.frg-stamp');
  const healthEl = el('.frg-health'), ammoEl = el('.frg-ammo'), fragsEl = el('.frg-frags'), lvlEl = el('.frg-lvl');
  const faceCvs = overlay.querySelector('canvas') as HTMLCanvasElement;
  let faceMood = -1;

  // ── the world and the marine ──
  let level: Level = genLevel(settings.dMapSize);
  walls.build(world.scene, level);
  let camX = 0, camZ = 0, heading = 0;
  let health = 100, ammo = 23, frags = 0, fragsLevel = 0, levelNo = 1;
  let lastWord = 'YOUR NETWORK';
  type Phase = 'walk' | 'look' | 'engage' | 'exit';
  let phase: Phase = 'walk';
  let path: Array<[number, number]> | null = null, pathI = 0;
  let lookT = 0, lookBase = 0;
  let engage: Demon | null = null, fireT = 0, engageT = 0;
  let exitT = 0;
  let bobPhase = 0, hurt = 0, flash = 0, faceHurtT = 0;
  let growlT = 3;

  function placeAtSpawn(): void {
    camX = level.spawn[0] * CS + CS / 2;
    camZ = level.spawn[1] * CS + CS / 2;
    heading = Math.PI; // face -z into the maze
    path = null; pathI = 0; phase = 'walk';
  }
  placeAtSpawn();

  function showTitle(): void {
    titleEl.textContent = `E1M${levelNo}: ${lastWord}`;
    lvlEl.textContent = `E1M${levelNo}`;
    titleEl.classList.add('on');
    window.setTimeout(() => titleEl.classList.remove('on'), 3200);
  }
  showTitle();

  function nextLevel(): void {
    levelNo++;
    level = genLevel(settings.dMapSize);
    walls.build(world.scene, level);
    actors.clear();
    placeAtSpawn();
    fragsLevel = 0;
    showTitle();
  }

  // ── event-driven reactions ──
  function onDamage(n: number): void {
    health = Math.max(6, health - n);
    hurt = 1;
    faceHurtT = 1.1;
    if (throttle.allow('fr|claw', 0.45)) audio.sfx('claw');
  }
  function onPickup(kind: 'vial' | 'crate'): void {
    if (kind === 'vial') health = Math.min(100, health + 25);
    else ammo += 8;
    audio.sfx('pickup');
  }

  function fireShot(): void {
    gun.fire();
    ammo++;
    audio.sfx('shot', { pan: (Math.random() - 0.5) * 0.4 });
  }

  function spawnDemonAhead(): void {
    const cc: [number, number] = [(camX / CS) | 0, (camZ / CS) | 0];
    const dirX = Math.sin(heading), dirZ = Math.cos(heading);
    const near = cellsNear(level, cc[0], cc[1], 3, 7);
    let best: [number, number] | null = null, bd = -2;
    for (const [x, y] of near) {
      const wx = x * CS + CS / 2 - camX, wz = y * CS + CS / 2 - camZ;
      const len = Math.hypot(wx, wz) || 1;
      const dot = (wx * dirX + wz * dirZ) / len;
      if (dot > bd) { bd = dot; best = [x, y]; }
    }
    if (!best) return;
    engage = actors.spawnDemon(best[0] * CS + CS / 2, best[1] * CS + CS / 2);
    phase = 'engage'; engageT = 0; fireT = 0.55;
    audio.sfx('growl');
  }

  function sealDoor(): void {
    const doors = walls.doors.filter((d) => d.cell.kind === 'normal');
    if (!doors.length) return;
    const d = doors[(Math.random() * doors.length) | 0];
    d.cell.sealed = 4;
    audio.sfx('door');
  }

  function plateDomain(text: string): void {
    const near = cellsNear(level, (camX / CS) | 0, (camZ / CS) | 0, 2, 9);
    if (!near.length) return;
    const [cx, cy] = near[(Math.random() * near.length) | 0];
    const around: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const hit = around.find(([dx, dy]) => !isFloor(level, cx + dx, cy + dy));
    if (!hit) return;
    const [dx, dy] = hit;
    actors.spawnPlate(text, cx * CS + CS / 2, cy * CS + CS / 2, -dx, -dy);
  }

  function openSecret(name: string): void {
    const near = cellsNear(level, (camX / CS) | 0, (camZ / CS) | 0, 3, 10);
    for (let k = 0; k < 12 && near.length; k++) {
      const [cx, cy] = near[(Math.random() * near.length) | 0];
      const around: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const hit = around.find(([dx, dy]) => !isFloor(level, cx + dx, cy + dy));
      if (!hit) continue;
      const [dx, dy] = hit;
      walls.reveal(cx + dx, cy + dy);
      actors.spawnPlate(name, cx * CS + CS / 2, cy * CS + CS / 2, -dx, -dy);
      audio.sfx('secret');
      return;
    }
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    if (replay) return;
    switch (se.kind) {
      case 'allow': {
        audio.cueSong('allow', ev.src_ip ?? undefined);
        if (!settings.dShots) break;
        ammo = Math.min(999, ammo + 1);
        if (phase !== 'engage' && throttle.allow('fr|shot', 0.5)) fireShot();
        if (Math.random() < 0.14 && throttle.allow('fr|pick', 4)) {
          const near = cellsNear(level, (camX / CS) | 0, (camZ / CS) | 0, 2, 6);
          if (near.length) {
            const [x, y] = near[(Math.random() * near.length) | 0];
            actors.spawnPickup(x * CS + CS / 2, y * CS + CS / 2, Math.random() < 0.55 ? 'vial' : 'crate');
          }
        }
        break;
      }
      case 'block': {
        audio.cueSong('block', ev.src_ip ?? undefined);
        if (!throttle.allow('fr|door', 1.2)) break;
        if (settings.dDoors) sealDoor();
        break;
      }
      case 'threat': {
        audio.cueSong('threat', ev.src_ip ?? undefined);
        if (!settings.dDemons) break;
        if (actors.demonCount < 6 && throttle.allow(`fr|dem|${ev.src_ip}`, 6)) spawnDemonAhead();
        break;
      }
      case 'dns': {
        audio.cueSong('dns', ev.src_ip ?? undefined);
        if (!settings.dPlates || !ev.dns_query || !throttle.allow('fr|plate', 2.5)) break;
        lastWord = ev.dns_query.toUpperCase();
        plateDomain(lastWord);
        break;
      }
      case 'dhcp': {
        if (!throttle.allow('fr|sec|' + ev.hostname, 3)) break;
        audio.cueSong('dhcp');
        const name = (ev.hostname || (ev.mac_address ? `DEV-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : ev.src_ip ?? 'DEVICE'));
        lastWord = name.toUpperCase();
        if (settings.dSecrets) openSecret(lastWord);
        break;
      }
      case 'wifi': {
        if (!throttle.allow(`fr|wifi|${ev.syslog_host}|${ev.wifi_event}`, 3)) break;
        if (!settings.dTele) break;
        if (se.wifi === 'joined') {
          const near = cellsNear(level, (camX / CS) | 0, (camZ / CS) | 0, 4, 10);
          if (near.length) {
            const [x, y] = near[(Math.random() * near.length) | 0];
            actors.spawnTele(x * CS + CS / 2, y * CS + CS / 2, true);
            audio.sfx('teleport');
          }
        } else if (se.wifi === 'bad') {
          audio.sfx('zap');
          flash = Math.max(flash, 0.4);
        }
        break;
      }
      case 'system': {
        if (throttle.allow(`fr|sys|${ev.syslog_host}`, 6)) {
          audio.cueSong('system');
          audio.sfx('thunder');
          flash = Math.max(flash, 0.55);
        }
        break;
      }
    }
  }

  // ── frame ──
  const groove = new Groove();
  let heat = 0;

  function frame(f: FrameInfo): void {
    const { dt, dtReal } = f;
    groove.update(dtReal, settings.dMusicVisuals ? audio.pulse() : null);
    const w = state.weather;
    heat += ((w === 'hurricane' ? 1 : w === 'storm' ? 0.45 : 0) - heat) * Math.min(1, dtReal * 0.25);
    const pulse = settings.dMusicVisuals && groove.style ? 0.9 + groove.downbeat * 0.18 + groove.energy * 0.12 : 1;

    // hell weather: the fog itself goes red
    const fog = world.scene.fog as FogExp2;
    fog.density = (0.19 + heat * 0.06) / pulse * 0.96;
    fog.color.setHex(heat > 0.6 ? 0x1e0704 : heat > 0.2 ? 0x160604 : 0x0c0503);
    if (heat > 0.5 && (growlT -= dtReal) <= 0) { growlT = 4 + Math.random() * 6; audio.sfx('growl', { pan: (Math.random() - 0.5) * 1.6 }); }

    const speed = 1.7 * settings.dWalkSpeed * (phase === 'engage' ? 0 : 1);
    const dirX = Math.sin(heading), dirZ = Math.cos(heading);

    if (phase === 'engage' && engage) {
      // stand and fire: turn, pump, until the demon is a stain
      const dx = engage.x - camX, dz = engage.z - camZ;
      const want = Math.atan2(dx, dz);
      heading += wrap(want - heading) * Math.min(1, dtReal * 7);
      engageT += dtReal;
      fireT -= dtReal;
      if (fireT <= 0) { fireT = 0.34; fireShot(); actors.hit(engage); }
      if (!actors.demons.includes(engage)) {
        frags++; fragsLevel++;
        audio.sfx('fragged');
        stampEl.classList.add('on');
        window.setTimeout(() => stampEl.classList.remove('on'), 2200);
        engage = null;
        phase = fragsLevel >= settings.dFrags ? 'exit' : 'walk';
        path = null;
      } else if (engageT > 9) {
        engage = null; phase = 'walk'; path = null;
      }
    } else if (phase === 'exit') {
      // the elevator's open: walk to it and ride out
      if (!path) {
        path = findPath(level, (camX / CS) | 0, (camZ / CS) | 0, level.exit[0], level.exit[1]);
        pathI = 0;
        walls.openExit(true);
        audio.sfx('door');
      }
      if (path && pathI < path.length) {
        walkAlong(speed, dtReal);
      } else {
        exitT += dtReal;
      }
      if (exitT > 1.6) { exitT = 0; nextLevel(); }
      wipeEl.style.opacity = String(Math.min(1, exitT * 0.9));
    } else if (phase === 'look') {
      lookT -= dtReal;
      heading = lookBase + Math.sin((lookT / 3) * Math.PI * 2) * 0.42;
      if (lookT <= 0) { path = null; phase = 'walk'; }
    } else {
      // walk: follow a path, or pick a new destination
      if (!path) {
        const rooms = level.rooms;
        const r = rooms[(Math.random() * rooms.length) | 0];
        path = findPath(level, (camX / CS) | 0, (camZ / CS) | 0, r.cx, r.cy) ?? [];
        pathI = 0;
      }
      if (path && pathI < path.length) {
        walkAlong(speed, dtReal);
      } else {
        phase = 'look'; lookT = 1.6 + Math.random() * 2.4; lookBase = heading;
      }
    }

    function walkAlong(v: number, d: number): void {
      const [tx, ty] = path![pathI];
      const wx = tx * CS + CS / 2, wz = ty * CS + CS / 2;
      const dx = wx - camX, dz = wz - camZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.28) { pathI++; return; }
      const want = Math.atan2(dx, dz);
      heading += wrap(want - heading) * Math.min(1, d * 6.5);
      const h2 = Math.sin(heading), h2z = Math.cos(heading);
      const step = Math.min(v * d, dist);
      // never slide through a wall on a corner's diagonal
      const nx = camX + h2 * step, nz = camZ + h2z * step;
      if (isFloor(level, (nx / CS) | 0, (camZ / CS) | 0)) camX = nx;
      if (isFloor(level, (camX / CS) | 0, (nz / CS) | 0)) camZ = nz;
    }

    // the marine: head bob, health regen, hurt and face
    const moving = (phase === 'walk' || phase === 'exit') && path !== null && pathI < (path?.length ?? 0);
    if (moving) bobPhase += dtReal * 7.4 * settings.dWalkSpeed;
    health = Math.min(100, health + dtReal * 2.2);
    hurt = Math.max(0, hurt - dtReal * 2.2);
    flash = Math.max(0, flash - dtReal * 1.8);
    faceHurtT = Math.max(0, faceHurtT - dtReal);

    const nearDemon = actors.demons.some((d) => d.state === 'walk' && Math.hypot(d.x - camX, d.z - camZ) < 5);
    const mood = faceHurtT > 0 ? 2 : phase === 'engage' ? 1 : nearDemon ? 3 : 0;
    if (mood !== faceMood) {
      faceMood = mood;
      drawFace(faceCvs, mood, Math.random() < 0.5);
    }
    healthEl.textContent = String(Math.round(health));
    ammoEl.textContent = String(ammo);
    fragsEl.textContent = String(frags);

    hurtEl.style.opacity = String(hurt * 0.5);
    flashEl.style.opacity = String(flash * 0.3);

    // camera
    const bob = moving ? Math.sin(bobPhase) : 0;
    world.camera.position.set(
      camX + f.wanderX * 0.0006,
      EYE + bob * 0.055,
      camZ + f.wanderY * 0.0006,
    );
    world.camera.rotation.set(0.02 * (moving ? bob : 0), heading + Math.PI, moving ? bob * 0.012 : 0, 'YXZ');
    world.camera.fov = 75 * (1 + heat * 0.04);
    world.camera.updateProjectionMatrix();

    walls.update(dt, camX, camZ, f.t, 0.5 + heat);
    actors.update(dt, level, camX, camZ);
    gun.setAspect(world.camera.aspect);
    gun.update(dt, bobPhase, moving, settings.dMusicVisuals ? groove.energy : 0);
    gun.setVisible(settings.dWeapon);

    audio.setThreatActive(actors.demonCount > 0);
    world.render();
  }

  function wrap(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function applyBudgets(): void {
    world.setPixRes(settings.dPixRes);
    if ((level.w !== settings.dMapSize)) {
      level = genLevel(settings.dMapSize);
      walls.build(world.scene, level);
      actors.clear();
      placeAtSpawn();
    }
  }
  applyBudgets();
  window.addEventListener('resize', () => world.resize(window.innerWidth, window.innerHeight));
  world.resize(window.innerWidth, window.innerHeight);

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { world.setPixelRatio(scale); },
    stats: () => ({ level: `E1M${levelNo}`, frags, health: Math.round(health), ammo, demons: actors.demonCount }),
    diag: () => ({
      renderer: world.renderer, scene: world.scene, camera: world.camera, gunScene: world.gunScene, gunCamera: world.gunCamera,
      level, walls, actors, gun,
      demon: () => spawnDemonAhead(),
      frag: () => { if (engage) actors.hit(engage); },
      seal: sealDoor,
      plate: (t?: string) => plateDomain(t ?? 'EXAMPLE.COM'),
      secret: (t?: string) => openSecret(t ?? 'IOT-DEVICE'),
      title: (t?: string) => { lastWord = t ?? lastWord; showTitle(); },
      nextLevel,
      shot: () => fireShot(),
    }),
  };
}
