import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { NETFIGHTER_DEFAULTS, NETFIGHTER_BUDGETS, NETFIGHTER_CONTROLS, NETFIGHTER_HUD } from './settings';
import { loadFightTextures } from './assets';
import { Stage, WORLD_W } from './stage';
import { Fighter, ATTACKS } from './fighter';
import { Fx } from './fx';
import { netFighterScore } from './score';

/**
 * Net Fighter: the firewall log as a street fight. Two fighters brawl a
 * night-city block - TRAFFIC, fed by every packet that passes (the vast
 * majority of events, fast jabs and combos), against FIREWALL, fed by
 * everything the network refuses or answers: blocks, lookups, leases,
 * joins. A threat is a super move with lightning; a DNS lookup is a
 * fireball wearing the domain's name; new devices join the crowd on the
 * sidewalk. When one fighter drops, the other poses, the round counter
 * climbs, and the next round starts before the crowd has sat back down.
 */
export const netfighter: Theme<typeof NETFIGHTER_DEFAULTS> = {
  id: 'netfighter',
  title: 'NET FIGHTER',
  hud: NETFIGHTER_HUD,
  accentHue: 42,
  defaults: NETFIGHTER_DEFAULTS,
  budgets: NETFIGHTER_BUDGETS,
  controls: NETFIGHTER_CONTROLS,
  score: netFighterScore,
  create,
};
export default netfighter;

const CENTER = WORLD_W / 2;

async function create(host: ThemeHost<typeof NETFIGHTER_DEFAULTS>, init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#05070f',
    antialias: false,
    preference: 'webgl',
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  const tex = await loadFightTextures();
  const stage = new Stage(tex.back, tex.fore);
  app.stage.addChild(stage.root);
  stage.addProps(null);

  const floor = new Container();
  stage.worldLayer.addChild(floor);
  const fx = new Fx();
  stage.worldLayer.addChild(fx.world);
  app.stage.addChild(fx.screen);

  const girl = new Fighter(
    { idle: tex.anim('girl', 'idle'), walk: tex.anim('girl', 'walk'), jab: tex.anim('girl', 'jab'),
      punch: tex.anim('girl', 'punch'), kick: tex.anim('girl', 'kick'), jumpkick: tex.anim('girl', 'jumpkick'),
      divekick: tex.anim('girl', 'divekick'), hurt: tex.anim('girl', 'hurt') },
    'TRAFFIC',
  );
  const punk = new Fighter(
    { idle: tex.anim('punk', 'idle'), walk: tex.anim('punk', 'walk'), punch: tex.anim('punk', 'punch'),
      hurt: tex.anim('punk', 'hurt') },
    'FIREWALL',
  );
  punk.sheetDir = -1;  // the punk's sheets face left; the girl's face right
  girl.reset(CENTER - 160, 1);
  punk.reset(CENTER + 160, -1);
  floor.addChild(girl.root, punk.root);

  // ── HUD: health bars, names, round, combo ─────────────────────────────────
  const hud = new Container();
  app.stage.addChild(hud);
  const bars = new Graphics();
  const label = (size: number, color: number): Text =>
    new Text({ text: '', style: new TextStyle({
      fontFamily: '"Courier New", monospace', fontSize: size, fontWeight: '900',
      fill: color, stroke: { color: 0x0a0c14, width: size / 4 } }) });
  const p1Name = label(26, 0x52ff7a);
  const p2Name = label(26, 0xff5a4a);
  const roundTxt = label(30, 0xffe14d);
  const comboTxt = label(24, 0xffe14d);
  p1Name.text = 'TRAFFIC';
  p2Name.text = 'FIREWALL';
  hud.addChild(bars, p1Name, p2Name, roundTxt, comboTxt);

  // ── fight state ────────────────────────────────────────────────────────────
  let round = 1;
  let phase: 'intro' | 'fight' | 'ko' = 'intro';
  let phaseT = 0;
  let hitstop = 0;
  let timeScale = 1;
  let combo = 0;
  let comboT = 0;
  let threatT = 0;
  let boltT = 3;
  let ambientT = 1.5;
  const fireballs: { t: Text; x: number; vx: number; foe: Fighter }[] = [];

  function startRound(): void {
    punk.sheetDir = -1;  // the punk's sheets face left; the girl's face right
  girl.reset(CENTER - 160, 1);
    punk.reset(CENTER + 160, -1);
    for (const f of fireballs) f.t.destroy();
    fireballs.length = 0;
    combo = 0;
    phase = 'intro';
    phaseT = 0;
    timeScale = 1;
    fx.banner(`ROUND ${round}`, 0xffe14d, 1.1);
    audio.sfx('round');
  }
  startRound();

  function landHit(att: Fighter, def: Fighter, kind: string): void {
    const a = ATTACKS[kind];
    const dir: 1 | -1 = att.x <= def.x ? 1 : -1;
    def.takeHit(a.dmg, dir, a.knock, kind === 'super');
    const hx = def.x - dir * 30;
    const hy = stage.groundY - 130;
    fx.spark(hx, hy, kind === 'super' ? 0xff7a3c : 0xfff2a8, kind === 'super' || kind === 'kick');
    fx.pow(hx, hy - 40, kind === 'super' || kind === 'divekick');
    fx.damage(def.x + 30, hy - 60, a.dmg);
    stage.shake(kind === 'super' ? 16 : 5 + a.dmg);
    hitstop = kind === 'super' ? 0.12 : 0.06;
    audio.sfx(kind === 'super' || kind === 'divekick' ? 'big' : 'hit', { pan: (def.x / app.screen.width) * 2 - 1 });
    if (att === girl) { combo++; comboT = 2.2; }
    if (def.health <= 0) {
      phase = 'ko';
      phaseT = 0;
      timeScale = 0.35;
      def.ko(dir);
      att.win();
      fx.banner('K.O.!', 0xff4a3c, 1.6);
      stage.shake(22);
      audio.sfx('ko');
    }
  }

  function chooseAttack(f: Fighter): string {
    if (f === girl) return f.charge >= 4 ? 'divekick' : f.charge >= 3 ? 'kick' : f.charge >= 2 ? 'punch' : 'jab';
    return f.charge >= 5 ? 'super' : 'punch';
  }

  // Events alternate 1:1 between the fighters, whatever their type: one log
  // line trains Traffic, the next the FIREWALL, so no traffic mix dominates.
  let turn = 0;

  function event(e: SceneEvent): void {
    audio.cueSong(e.kind, e.ev.src_ip ?? e.ev.dst_ip ?? undefined);
    if (phase !== 'fight') return;
    const me = turn++ % 2 === 0 ? girl : punk;
    const foe = me === girl ? punk : girl;
    const cap = me === girl ? 5 : 6;
    switch (e.kind) {
      case 'allow':
        me.charge = Math.min(cap, me.charge + 1);
        break;
      case 'block':
        me.charge = Math.min(cap, me.charge + 2);
        break;
      case 'threat':
        me.charge = Math.min(cap, me.charge + 5);
        stage.lightning();
        threatT = 6;
        break;
      case 'dns': {
        me.charge = Math.min(cap, me.charge + 1);
        if (fireballs.length >= 2 || Math.random() < 0.7) break;
        const name = (e.ev.dns_query ?? 'query').toUpperCase().slice(0, 18);
        const t = new Text({ text: name, style: new TextStyle({
          fontFamily: '"Courier New", monospace', fontSize: 20, fontWeight: '900',
          fill: me === girl ? 0x52ff7a : 0x7ad4ff, stroke: { color: 0x0a2a3a, width: 5 } }) });
        t.anchor.set(0.5);
        const dir = foe.x >= me.x ? 1 : -1;
        const fb = { t, x: me.x + dir * 60, vx: dir * 520, foe };
        t.x = fb.x;
        t.y = stage.groundY - 96;
        stage.worldLayer.addChild(t);
        fireballs.push(fb);
        break;
      }
      case 'dhcp':
      case 'wifi':
        me.charge = Math.min(cap, me.charge + 1);
        if (stage.crowdCount() < settings.aCrowdMax) stage.addCrowd();
        break;
      default:
        me.charge = Math.min(cap, me.charge + 1);
        break;
    }
  }

  let lastW = 0, lastH = 0;

  function frame(f: FrameInfo): void {
    const w = app.screen.width, h = app.screen.height;
    if (w !== lastW || h !== lastH) {
      stage.resize(w, h);
      floor.y = stage.groundY;
      lastW = w; lastH = h;
    }
    const real = f.dtReal;
    hitstop = Math.max(0, hitstop - real);
    const dt = hitstop > 0 ? 0 : f.dt * timeScale * settings.aSpeed;
    const t = f.t;
    phaseT += real;

    const wet = settings.aWeather
      ? (state.weather === 'hurricane' ? 1 : state.weather === 'storm' ? 0.5 : 0) * settings.aRain
      : 0;

    // ── phases ───────────────────────────────────────────────────────────────
    if (phase === 'intro') {
      if (phaseT > 1.3 && phaseT - real <= 1.3) fx.banner('FIGHT!', 0x52ff7a, 0.8);
      if (phaseT > 2.1) { phase = 'fight'; phaseT = 0; }
    } else if (phase === 'ko') {
      if (phaseT > 2.6) { round++; startRound(); }
    }

    // ── fighters ─────────────────────────────────────────────────────────────
    if (phase === 'fight' && dt > 0) {
      const dist = Math.abs(girl.x - punk.x);
      for (const [me, foe] of [[girl, punk], [punk, girl]] as const) {
        me.charge = Math.max(0, me.charge - dt * 0.12);
        if (!me.busy) me.facing = foe.x >= me.x ? 1 : -1;
        const kind = chooseAttack(me);
        const a = ATTACKS[kind];
        if (me.charge >= 1 && dist <= a.range && !me.busy) {
          me.charge = me === girl ? Math.max(0, me.charge - 1) : 0;
          me.attack(kind, foe.x);
        } else if (dist > a.range * 0.85) {
          me.walkToward(foe.x + Math.sign(me.x - foe.x) * a.range * 0.7, 150, dt);
        } else {
          me.idle();
        }
      }
      // ambient sparring so the street is never quiet
      ambientT -= dt;
      if (ambientT <= 0) {
        ambientT = 1.6 + Math.random() * 2.2;
        const who = Math.random() < 0.5 ? girl : punk;
        if (!who.busy && Math.abs(girl.x - punk.x) < 190) who.attack('jab', (who === girl ? punk : girl).x);
      }
    } else if (phase !== 'fight' && dt > 0) {
      girl.walkToward(CENTER - 160, 200, dt);
      punk.walkToward(CENTER + 160, 200, dt);
      // face the way you travel back to the mark; the fight loop snaps facing
      // to the opponent at FIGHT!
      girl.facing = girl.state === 'walk' ? (girl.x < CENTER - 160 ? 1 : -1) : (punk.x >= girl.x ? 1 : -1);
      punk.facing = punk.state === 'walk' ? (punk.x < CENTER + 160 ? 1 : -1) : (girl.x >= punk.x ? 1 : -1);
    }

    const landedG = girl.update(dt);
    const landedP = punk.update(dt);
    if (landedG && phase === 'fight') {
      const a = landedG;
      if (Math.abs(girl.x - punk.x) <= a.range + 26) landHit(girl, punk, a.anim);
      else if (a.anim === 'jab') audio.sfx('jab', { pan: (girl.x / w) * 2 - 1 });
    }
    if (landedP && phase === 'fight') {
      const a = landedP;
      if (Math.abs(girl.x - punk.x) <= a.range + 26) landHit(punk, girl, a.anim);
    }
    girl.root.x = girl.x;
    punk.root.x = punk.x;

    // ── fireballs ────────────────────────────────────────────────────────────
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const fb = fireballs[i];
      fb.x += fb.vx * dt;
      fb.t.x = fb.x;
      fb.t.rotation += dt * 4 * Math.sign(fb.vx);
      if (Math.abs(fb.x - fb.foe.x) < 60 && phase === 'fight') {
        const tgt = fb.foe;
        const att = tgt === girl ? punk : girl;
        tgt.takeHit(2, Math.sign(fb.vx) as 1 | -1, 60, false, 0.22);
        fx.spark(fb.x, fb.t.y, 0x7ad4ff);
        fx.pow(fb.x, fb.t.y - 40);
        stage.shake(7);
        hitstop = 0.05;
        audio.sfx('hit', { pan: (fb.x / w) * 2 - 1 });
        if (tgt.health <= 0) {
          phase = 'ko';
          phaseT = 0;
          timeScale = 0.35;
          tgt.ko(Math.sign(fb.vx) as 1 | -1);
          att.win();
          fx.banner('K.O.!', 0xff4a3c, 1.6);
          audio.sfx('ko');
        }
        fb.t.destroy();
        fireballs.splice(i, 1);
      } else if (fb.x < 40 || fb.x > WORLD_W - 40) {
        fb.t.destroy();
        fireballs.splice(i, 1);
      }
    }

    // ── weather ──────────────────────────────────────────────────────────────
    if (wet > 0.6) {
      boltT -= real;
      if (boltT <= 0) { boltT = 3 + Math.random() * 6; stage.lightning(); }
    }

    stage.update(real, t, (girl.x + punk.x) / 2, wet);
    fx.update(real, w, h);

    // ── HUD ──────────────────────────────────────────────────────────────────
    comboT = Math.max(0, comboT - real);
    if (comboT === 0) combo = 0;
    threatT = Math.max(0, threatT - real);
    audio.setThreatActive(threatT > 0);
    drawHud(w);

    app.render();
  }

  function drawHud(w: number): void {
    bars.clear();
    const bw = Math.min(430, w * 0.3);
    const y = 26;
    const hgt = 20;
    // frames
    bars.rect(28, y, bw + 6, hgt + 6).fill({ color: 0x0a0c14, alpha: 0.85 });
    bars.rect(w - 34 - bw, y, bw + 6, hgt + 6).fill({ color: 0x0a0c14, alpha: 0.85 });
    // P1 drains right-to-left, P2 mirrors
    bars.rect(31, y + 3, bw * (girl.health / 100), hgt).fill(0x2fbf4f);
    bars.rect(31 + bw * (girl.health / 100), y + 3, bw * (1 - girl.health / 100), hgt).fill(0x123018);
    const p2w = bw * (punk.health / 100);
    bars.rect(w - 34 - p2w, y + 3, p2w, hgt).fill(0xc23a2e);
    bars.rect(w - 34 - bw, y + 3, bw - p2w, hgt).fill(0x301210);
    // super meters
    bars.rect(31, y + hgt + 8, bw * (girl.charge / 5), 6).fill(0xffe14d);
    bars.rect(w - 34 - bw * (punk.charge / 5), y + hgt + 8, bw * (punk.charge / 5), 6).fill(0xff9a3c);

    p1Name.x = 30; p1Name.y = y + hgt + 18;
    p2Name.x = w - 34 - bw; p2Name.y = y + hgt + 18;
    roundTxt.text = `ROUND ${round}`;
    roundTxt.x = w / 2 - roundTxt.width / 2;
    roundTxt.y = y;
    comboTxt.text = combo > 1 ? `${combo} HIT COMBO!` : '';
    comboTxt.x = 34;
    comboTxt.y = y + hgt + 52;
  }

  return {
    event,
    frame,
    applyBudgets() {},
    settingsChanged() {},
    setResolution(scale) {
      if (app.renderer.resolution !== scale) app.renderer.resolution = scale;
    },
    stats: () => ({ round, traffic: Math.round(girl.health), firewall: Math.round(punk.health), combo }),
    diag: () => ({ app, girl, punk, round, phase, phaseT, hitstop, timeScale, audio }),
  };
}
