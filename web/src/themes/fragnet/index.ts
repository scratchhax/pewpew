import { Groove } from '../../sound/groove';
import type { SceneEvent } from '../../events';
import type { RendererInit, Theme, ThemeHost, ThemeInstance, FrameInfo } from '../../theme';
import { FRAGNET_BUDGETS, FRAGNET_CONTROLS, FRAGNET_DEFAULTS, FRAGNET_HUD } from './settings';
import { fragnetScore } from './score';
import { SoftRenderer } from './raycast';
import { Actors, type Demon } from './sprites';
import { Gun2D } from './gun';
import { Wad, extractTable, packToTable, type PackJSON, type TexTable } from './wad';
import { buildFallbackTable, sprGlow, canvasToRgba } from './art';
import { CS, EYE, genLevel, findPath, cellsNear, isFloor, type Level } from './levelgen';
import { drawFace } from './art';
import './hud.css';

/**
 * FRAGNET: your network is Hell. A first-person patrol through a
 * procedural maze in the classic corridor-shooter look - the corridors are
 * cast column by column out of a WAD's textures and colour maps, the
 * marine's shotgun kicks at the bottom of the screen, and imps lean round
 * corners. The marine is the network stack with a shotgun: allowed traffic
 * feeds his ammo, an IDS threat tears a demon into the corridor and he
 * tracks it down and frags it on the spot (FRAGGED), blocks slam blast doors
 * red, DHCP opens a secret wall with the device's name on it, DNS domains
 * light up on plates, and Wi-Fi joins spin teleporters up. Five traces and
 * the exit elevator opens: E1M2, E1M3, deeper into the maze.
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

  // ── the art source: uploaded WAD > bundled Freedoom pack > procedural ──
  const canvas = document.createElement('canvas');
  host.mount.appendChild(canvas);
  const renderer = new SoftRenderer(canvas);
  const actors = new Actors({ onDamage, onPickup, onAggro });
  const gun = new Gun2D();
  let artSource = 'code';

  function applyTable(table: TexTable): void {
    renderer.setTable(table);
    actors.load(table);
    gun.load(table.sprites.gun ?? null, table.palette);
  }

  async function loadArt(): Promise<void> {
    try {
      const r = await fetch('/api/wads', { cache: 'no-store' });
      if (r.ok) {
        const info = await r.json() as { active?: string | null };
        if (info.active) {
          const w = await fetch(`/wads/${encodeURIComponent(info.active)}`);
          if (w.ok) {
            const table = extractTable(new Wad(await w.arrayBuffer()));
            applyTable(table);
            artSource = info.active;
            if (wadStatus) wadStatus.textContent = info.active;
            return;
          }
        }
      }
    } catch { /* relay not there (static demo): try the pack */ }
    try {
      const r = await fetch('pack.json', { cache: 'no-store' });
      if (r.ok) {
        applyTable(packToTable(await r.json() as PackJSON));
        artSource = 'freedoom';
        if (wadStatus) wadStatus.textContent = 'freedoom';
        return;
      }
    } catch { /* no pack either: last resort */ }
    applyTable(buildFallbackTable());
    artSource = 'code';
    if (wadStatus) wadStatus.textContent = 'drawn in code';
  }

  // ── DOM: status bar, stamps, wipes ──
  const overlay = document.createElement('div');
  overlay.id = 'frg-overlay';
  overlay.innerHTML = `
    <div class="frg-hurt"></div><div class="frg-flash"></div><div class="frg-wipe"></div>
    <div class="frg-title">E1M1: YOUR NETWORK</div>
    <div class="frg-stamp">FRAGGED</div>
    <div class="frg-wad"><label><input type="file" accept=".wad">WAD art</label><span>loading…</span></div>
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
  const faceCvs = overlay.querySelector('.frg-face canvas') as HTMLCanvasElement;
  const wadStatus = overlay.querySelector('.frg-wad span') as HTMLElement;
  const wadInput = overlay.querySelector('.frg-wad input') as HTMLInputElement;
  let faceMood = -1;

  wadInput.addEventListener('change', async () => {
    const file = wadInput.files?.[0];
    if (!file) return;
    wadStatus.textContent = 'uploading…';
    try {
      const body = new FormData();
      body.append('file', file);
      const up = await fetch('/api/wads', { method: 'POST', body });
      if (!up.ok) throw new Error(`relay said ${up.status}`);
      const { name } = await up.json() as { name: string };
      await fetch('/api/wads-active', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      wadStatus.textContent = 'swapping…';
      const w = await fetch(`/wads/${encodeURIComponent(name)}`);
      const table = extractTable(new Wad(await w.arrayBuffer()));
      applyTable(table);
      artSource = name;
      wadStatus.textContent = name;
    } catch (err) {
      wadStatus.textContent = 'upload failed';
      void err;
    }
  });
  void loadArt();

  // lamp and exit glows, built once
  const lampGlow = canvasToRgba(sprGlow('#ffcf9a', 32));
  const exitGlow = canvasToRgba(sprGlow('#ffd27a', 32));

  // ── the world and the marine ──
  let level: Level = genLevel(settings.dMapSize);
  renderer.setLevel(level);
  let camX = 0, camZ = 0, heading = 0;
  let health = 100, ammo = 23, frags = 0, fragsLevel = 0, levelNo = 1;
  let lastWord = 'YOUR NETWORK';
  type Phase = 'walk' | 'look' | 'engage' | 'exit';
  let phase: Phase = 'walk';
  let path: Array<[number, number]> | null = null, pathI = 0;
  let lookT = 0, lookBase = 0;
  let engage: Demon | null = null, fireT = 0, engageT = 0;
  let exitT = 0, exitShown = false;
  let bobPhase = 0, hurt = 0, flash = 0, muzzle = 0, faceHurtT = 0;
  let growlT = 3;

  function seedDemons(): void {
    const near = cellsNear(level, level.spawn[0], level.spawn[1], 5, 9);
    for (let k = 0; k < Math.min(3, near.length); k++) {
      const [x, y] = near[(Math.random() * near.length) | 0];
      actors.spawnDemon(x * CS + CS / 2, y * CS + CS / 2, false);
    }
  }
  seedDemons();

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
    renderer.setLevel(level);
    actors.clear();
    seedDemons();
    placeAtSpawn();
    fragsLevel = 0; exitShown = false;
    showTitle();
  }

  // ── event-driven reactions ──
  function onDamage(n: number): void {
    health = Math.max(6, health - n);
    hurt = 1;
    faceHurtT = 1.1;
    if (throttle.allow('fr|claw', 0.45)) audio.sfx('claw');
  }
  function onPickup(kind: 'health' | 'ammo'): void {
    if (kind === 'health') health = Math.min(100, health + 25);
    else ammo += 8;
    audio.sfx('pickup');
  }
  function onAggro(): void {
    if (throttle.allow('fr|growl', 1.2)) audio.sfx('growl');
  }

  /** Spend one shell; false when the gun runs dry until traffic feeds it. */
  function fireShot(): boolean {
    if (ammo <= 0) return false;
    ammo--;
    gun.fire();
    muzzle = 1;
    audio.sfx('shot', { pan: (Math.random() - 0.5) * 0.4 });
    return true;
  }

  /** A demon is shootable when it's alive, close, in the firing cone and in sight. */
  function canShoot(d: Demon): boolean {
    if (d.state === 'die' || d.state === 'corpse') return false;
    const dx = d.x - camX, dz = d.z - camZ;
    if (Math.hypot(dx, dz) > 11) return false;
    if (Math.abs(wrap(Math.atan2(dx, dz) - heading)) > 0.18) return false;
    return renderer.los(camX, camZ, d.x, d.z);
  }

  /** The nearest hostile demon the marine can currently see. */
  function pickTarget(): Demon | null {
    let best: Demon | null = null, bd = 12;
    for (const d of actors.demons) {
      if (!d.hostle || d.state === 'die' || d.state === 'corpse') continue;
      const dist = Math.hypot(d.x - camX, d.z - camZ);
      if (dist < bd && renderer.los(camX, camZ, d.x, d.z)) { bd = dist; best = d; }
    }
    return best;
  }

  /** Creep along the current heading, wall-clipped; negative backs off. */
  function advance(v: number, d: number): void {
    const step = v * d;
    const nx = camX + Math.sin(heading) * step, nz = camZ + Math.cos(heading) * step;
    if (isFloor(level, (nx / CS) | 0, (camZ / CS) | 0)) camX = nx;
    if (isFloor(level, (camX / CS) | 0, (nz / CS) | 0)) camZ = nz;
  }

  function spawnDemonAhead(): Demon | null {
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
    if (!best) return null;
    const d = actors.spawnDemon(best[0] * CS + CS / 2, best[1] * CS + CS / 2);
    d.aggro = true;
    return d;
  }

  function sealDoor(): void {
    const doors = level.doors.filter((d) => d.sealed <= 0);
    if (!doors.length) return;
    doors[(Math.random() * doors.length) | 0].sealed = 4;
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
      level.grid[(cy + dy) * level.w + (cx + dx)] = 1;   // the wall was never there
      renderer.setLevel(level);
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
        // traffic is the ammo supply, not the trigger: the gun only speaks
        // when there's a demon down the barrel
        if (!settings.dShots) break;
        ammo = Math.min(999, ammo + 1);
        if (Math.random() < 0.14 && throttle.allow('fr|pick', 4)) {
          const near = cellsNear(level, (camX / CS) | 0, (camZ / CS) | 0, 2, 6);
          if (near.length) {
            const [x, y] = near[(Math.random() * near.length) | 0];
            actors.spawnPickup(x * CS + CS / 2, y * CS + CS / 2, Math.random() < 0.55 ? 'health' : 'ammo');
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
        if (actors.demonCount < 8 && throttle.allow(`fr|dem|${ev.src_ip}`, 6)) {
          const d = spawnDemonAhead();
          if (d) { engage = d; phase = 'engage'; engageT = 0; fireT = 0.55; }
        }
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
    if (heat > 0.5 && (growlT -= dtReal) <= 0) { growlT = 4 + Math.random() * 6; audio.sfx('growl', { pan: (Math.random() - 0.5) * 1.6 }); }

    // sealed doors cool off
    for (const d of level.doors) if (d.sealed > 0) d.sealed = Math.max(0, d.sealed - dtReal);

    const speed = 1.7 * settings.dWalkSpeed * (phase === 'engage' ? 0 : 1);

    // patrol interrupted: a hostile demon in sight drops everything
    if (phase === 'walk' || phase === 'look') {
      const t = pickTarget();
      if (t) { engage = t; phase = 'engage'; engageT = 0; fireT = 0.4; }
    }

    if (phase === 'engage' && engage) {
      // track it, creep into range, and fire only when it's down the barrel
      const dx = engage.x - camX, dz = engage.z - camZ;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      heading += wrap(want - heading) * Math.min(1, dtReal * 7);
      engageT += dtReal;
      fireT -= dtReal;
      const inSight = renderer.los(camX, camZ, engage.x, engage.z);
      if (inSight && dist > 2.2) advance(0.9 * settings.dWalkSpeed, dtReal);
      else if (dist < 1.6) advance(-1.1, dtReal);
      if (fireT <= 0) {
        if (canShoot(engage) && fireShot()) { actors.hit(engage); fireT = 0.6; }
        else fireT = 0.15;
      }
      const dead = !actors.demons.includes(engage) || engage.state === 'die' || engage.state === 'corpse';
      if (dead) {
        frags++; fragsLevel++;
        if (settings.dGore) actors.burst(engage.x, engage.z);
        audio.sfx('fragged');
        stampEl.classList.add('on');
        window.setTimeout(() => stampEl.classList.remove('on'), 2200);
        engage = pickTarget();
        if (engage) { engageT = 0; fireT = 0.4; }
        else phase = fragsLevel >= settings.dFrags ? 'exit' : 'walk';
        path = null;
      } else if (engageT > 12) {
        engage = null; phase = 'walk'; path = null;
      }
    } else if (phase === 'exit') {
      // the elevator's open: walk to it and ride out
      if (!path) {
        path = findPath(level, (camX / CS) | 0, (camZ / CS) | 0, level.exit[0], level.exit[1]);
        pathI = 0;
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
    muzzle = Math.max(0, muzzle - dtReal * 7);
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

    // the corridor: cast, paste sprites, paint the gun over it all
    const bob = moving ? Math.sin(bobPhase) : 0;
    renderer.bobPx = bob * 4;
    const sprites = actors.collect();
    for (const [lx, ly] of level.lamps) {
      sprites.push({ x: lx * CS + CS / 2, z: ly * CS + CS / 2, rgba: lampGlow, scale: 0.55, zBase: 3.55, add: true, alpha: 0.75 });
    }
    if (fragsLevel >= settings.dFrags && !exitShown) { exitShown = true; }
    if (exitShown) {
      sprites.push({ x: level.exit[0] * CS + CS / 2, z: level.exit[1] * CS + CS / 2, rgba: exitGlow, scale: 0.9, zBase: 0.1, add: true, alpha: 0.7 + 0.25 * Math.sin(f.t * 4) });
    }
    renderer.render(camX, camZ, heading, sprites, f.t, heat, flash * 0.5 + muzzle * 0.7);
    gun.draw(renderer.context, renderer.width, renderer.height);

    actors.update(dt, level, camX, camZ, (ax, az, bx, bz) => renderer.los(ax, az, bx, bz));
    gun.update(dt, bobPhase, moving, settings.dWeapon);
    audio.setThreatActive(actors.demonCount > 0);
  }

  function wrap(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function applyBudgets(): void {
    renderer.setPixRes(settings.dPixRes);
    if (level.w !== settings.dMapSize) {
      level = genLevel(settings.dMapSize);
      renderer.setLevel(level);
      actors.clear();
      seedDemons();
      placeAtSpawn();
    }
  }
  applyBudgets();
  window.addEventListener('resize', () => renderer.setPixRes(settings.dPixRes));

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged() { applyBudgets(); },
    setResolution(scale) { renderer.setPixRes(settings.dPixRes * scale); },
    stats: () => ({ level: `E1M${levelNo}`, frags, health: Math.round(health), ammo, demons: actors.demonCount, art: artSource }),
    diag: () => ({
      renderer, level, actors, gun,
      phase: () => phase,
      demon: () => { const d = spawnDemonAhead(); engage = d; if (d) { phase = 'engage'; engageT = 0; fireT = 0.55; } },
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
