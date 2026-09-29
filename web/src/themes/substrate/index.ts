import { Application } from 'pixi.js';
import type { Theme, ThemeHost, RendererInit, ThemeInstance, FrameInfo } from '../../theme';
import type { SceneEvent } from '../../events';
import { hash01, isInternalIp } from '../../state';
import { SUBSTRATE_DEFAULTS, SUBSTRATE_BUDGETS, SUBSTRATE_CONTROLS, SUBSTRATE_HUD } from './settings';
import { Plate, type CrackKind, type Seed } from './crack';
import { View, paperLook } from './view';
import { BASE_PIGMENT, STUDIES, castPigments, type Study } from './palette';
import { substrateScore } from './score';
import './hud.css';

/**
 * Substrate: your network draws a picture, and then throws it away.
 *
 * Tarbell's *Substrate* grew a city out of nothing but cracks that leave each
 * other at right angles. Here the network decides everything about that city.
 * Each host holds a seed cell whose position is a hash of its IP, so the plan
 * is a portrait of your LAN: the same devices always lay the plate out the
 * same way, and a chatty device visibly builds out its own quarter. Every
 * crack is one real event and carries that event's colour, the side it turns
 * to, how restless it is and how much pigment it lays down. Nothing moves on
 * a silent network.
 *
 * Over a couple of minutes it fills. Then it holds still long enough to be
 * looked at, washes gently back to bare paper, and starts a different picture
 * of the same network.
 */
export const substrate: Theme<typeof SUBSTRATE_DEFAULTS> = {
  id: 'substrate',
  title: 'SUBSTRATE',
  hud: SUBSTRATE_HUD,
  accentHue: 28,
  defaults: SUBSTRATE_DEFAULTS,
  budgets: SUBSTRATE_BUDGETS,
  controls: SUBSTRATE_CONTROLS,
  score: substrateScore,
  create,
};
export default substrate;

/** The colour law, shared by every scene: this is not ours to reinterpret. */
const LAW: Record<CrackKind | 'dns' | 'dhcp', number> = {
  allow: 0x5ce6a4,
  block: 0xff6b6b,
  threat: 0xff9a45,
  dns: 0x55b5ff,
  dhcp: 0xffd84d,
  wifi: 0xc08cff,
  system: 0x7d99b3,
};

/** Pigment ranges and the per-picture studies live in ./palette. */
type PigmentKind = keyof typeof BASE_PIGMENT;

/** Ports that carry the bulk of ordinary traffic, and so draw boulevards. */
const ARTERIAL = new Set([53, 80, 123, 443, 853, 8443]);

/** How long the finished picture is held, and how long the wash takes. */
const HOLD_S = 7;
const FADE_S = 5;

async function create(host: ThemeHost<typeof SUBSTRATE_DEFAULTS>,
                      init: RendererInit): Promise<ThemeInstance> {
  const { settings, state, throttle, audio } = host;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#f4efe3',
    antialias: init.antialias,
    powerPreference: init.powerPref === 'default' ? undefined : init.powerPref,
    resolution: init.resolution,
    autoDensity: true,
    autoStart: false,
    sharedTicker: false,
  });
  host.mount.appendChild(app.canvas);

  const plate = new Plate();
  const view = new View(app);
  app.stage.addChild(view.stage);
  plate.onSand = view.sand;
  plate.onLine = view.line;
  view.setLaw({
    allow: LAW.allow, block: LAW.block, threat: LAW.threat,
    wifi: LAW.wifi, system: LAW.system,
  });

  // one small overlay, for the name of the district doing the most talking
  const overlay = document.createElement('div');
  overlay.id = 'sub-host';
  document.body.appendChild(overlay);
  const label = document.createElement('div');
  label.className = 'sub-label';
  overlay.appendChild(label);

  // ── the cycle ─────────────────────────────────────────────────────────────
  type Phase = 'grow' | 'hold' | 'fade';
  let phase: Phase = 'grow';
  let phaseT = 0;
  let pictures = 0;
  /** Carries the fractional part of the growth rate between frames. */
  let stepAcc = 0;
  /** Seconds until the next live-crack report to the score. */
  let drawAt = 0;

  function restart(): void {
    // The study has already been chosen, at the start of the wash, and the
    // background has been easing toward its paper all the way through it — so
    // by the time we get here the sheet on screen is already the right colour
    // and clearing the plate to it changes nothing visible.
    applyPaper();
    plate.clear();
    view.clearPlate();
    view.setPictureAlpha(1);
    phase = 'grow';
    phaseT = 0;
    pictures++;
    audio.sfx('fresh');
  }

  function resize(): void {
    const sw = app.screen.width;
    const sh = app.screen.height;
    // the lattice is its own resolution, so quality can trade cells for speed
    const gw = Math.max(64, Math.round(sw * settings.cGridScale));
    const gh = Math.max(64, Math.round(sh * settings.cGridScale));
    plate.resize(gw, gh);
    view.resize(sw, sh, gw, gh);
    view.setGrainSize(2.2 * Math.max(0.7, settings.cGridScale));
    restart();
  }
  // ── the sheet ─────────────────────────────────────────────────────────────
  // Start somewhere random in the rotation so two screens side by side, or the
  // same screen after a reload, are not drawing the same study in step.
  let studyIdx = (Math.random() * STUDIES.length) | 0;
  let study: Study = STUDIES[studyIdx];
  let pigment = castPigments(study);
  /** The paper actually on screen, and the two ends of the wash cross-fade. */
  let paperNow = study.paper;
  let washFrom = paperNow;
  let washTo = paperNow;

  /** The paper the current sheet calls for, rotation on or off. */
  function sheetPaper(): number {
    return settings.cRotate ? study.paper : paperLook(settings.cPaper).paper;
  }

  /**
   * Put the current sheet on: paper, ink, and the HUD, which follows via a body
   * attribute the theme CSS reads. With rotation off this is the Plate darkness
   * knob instead, so the manual control still means something.
   */
  function applyPaper(): void {
    if (settings.cRotate) {
      view.setLook({
        paper: study.paper, line: study.ink,
        lineAlpha: study.inkAlpha, additive: study.additive,
      });
      document.body.dataset.subPaper = study.dark ? 'dark' : 'light';
    } else {
      const look = paperLook(settings.cPaper);
      view.setLook(look);
      document.body.dataset.subPaper = settings.cPaper < 0.5 ? 'light' : 'dark';
    }
    paperNow = sheetPaper();
  }

  /** Blend two packed colours, for easing the sheet from one study to the next. */
  function mixRgb(a: number, b: number, k: number): number {
    const q = (s: number, e: number): number => ((s + (e - s) * k) | 0) & 0xff;
    return (q((a >> 16) & 0xff, (b >> 16) & 0xff) << 16)
         | (q((a >> 8) & 0xff, (b >> 8) & 0xff) << 8)
         | q(a & 0xff, b & 0xff);
  }

  /** The next sheet in the rotation, chosen as a picture ends. */
  function nextStudy(): void {
    if (!settings.cRotate) return;
    studyIdx = (studyIdx + 1) % STUDIES.length;
    study = STUDIES[studyIdx];
    pigment = castPigments(study);
  }

  applyPaper();
  resize();
  app.renderer.on('resize', () => resize());

  function applyBudgets(): void {
    plate.density = settings.cDensity;
    plate.grains = settings.cGrains;
    plate.ink = settings.cInk;
    plate.sand = settings.cSand;
    plate.hairline = settings.cHairline;
  }
  applyBudgets();

  // ── the event law ─────────────────────────────────────────────────────────

  /** Rolling colour of the network, for the cracks that fill in quiet moments. */
  let moodKind: PigmentKind = 'allow';
  let threatUntil = 0;
  let simT = 0;

  /**
   * A related shade of a law colour. Every host and every domain gets its own
   * tone of the same hue, so the picture has depth without ever lying about
   * what an event was.
   */
  function tone(kind: PigmentKind, k: number): number {
    const [lo, hi] = pigment[kind];
    const t = k < 0 ? 0 : k > 1 ? 1 : k;
    const q = (s: number, e: number): number => ((s + (e - s) * t) | 0) & 0xff;
    return (q((lo >> 16) & 0xff, (hi >> 16) & 0xff) << 16)
         | (q((lo >> 8) & 0xff, (hi >> 8) & 0xff) << 8)
         | q(lo & 0xff, hi & 0xff);
  }

  function seedFor(ip: string | null | undefined, label?: string): Seed | null {
    if (!ip || !isInternalIp(ip)) return null;
    return plate.host(ip, label);
  }

  /** The seed a syslog source (a gateway or an AP) draws from. */
  function sourceSeed(hostName: string | undefined): Seed {
    return plate.host(hostName ?? 'gateway');
  }

  /**
   * Which way a crack turns off the cell it is born on. Inbound and outbound
   * traffic turn opposite ways, so the grain of the finished picture shows you
   * which direction your network mostly talks in.
   */
  function turnFor(se: SceneEvent): number {
    if (se.scope === 'inbound') return -1;
    if (se.scope === 'outbound') return 1;
    return hash01(`turn|${se.ev.dst_ip ?? se.ev.src_ip ?? ''}`) < 0.5 ? -1 : 1;
  }

  /**
   * How restless a crack is, in degrees per step.
   *
   * These numbers are small on purpose. Tarbell's piece runs dead straight by
   * default and tops out around 0.01 even when curving is switched on, and
   * that is the whole reason the result reads as a city: straight runs meeting
   * at right angles. Anything above about 0.02 and the lattice dissolves into
   * sweeping arcs that never close a block.
   */
  function curveFor(se: SceneEvent): number {
    const port = se.ev.dst_port ?? 0;
    // the ports that carry everything draw boulevards: effectively straight
    if (ARTERIAL.has(port)) return hash01(`c|${port}`) * 0.0015;
    return 0.001 + hash01(`c|${port}|${se.ev.protocol ?? ''}`) * 0.011;
  }

  /** Lattice point for a host, nudged so repeat events do not stack. */
  function nearSeed(s: Seed, key: string, spread: number): { x: number; y: number } {
    const a = hash01(`a|${key}`) * Math.PI * 2;
    const d = hash01(`d|${key}`) * spread;
    return {
      x: Math.max(1, Math.min(plate.w - 2, s.x + Math.cos(a) * d)),
      y: Math.max(1, Math.min(plate.h - 2, s.y + Math.sin(a) * d)),
    };
  }

  function growing(): boolean {
    return phase === 'grow';
  }

  /**
   * Event sounds, but only while the plate is actually being drawn.
   *
   * Through the hold and the wash the room is supposed to go quiet — that
   * silence is the ending. Cueing the score straight from the feed kept the
   * plucks and music-box notes coming over a finished picture and flattened
   * the whole arc; the HUD still logs everything either way.
   */
  function say(kind: Parameters<typeof audio.cueSong>[0], ip?: string): void {
    if (growing()) audio.cueSong(kind, ip);
  }

  function event(se: SceneEvent, replay: boolean): void {
    const ev = se.ev;
    // a host is worth knowing about even on replay: the plan should be right
    // from the first frame, without any of the pigment a live event would lay
    const src = seedFor(ev.src_ip, ev.hostname ?? undefined);
    const dst = seedFor(ev.dst_ip);
    if (replay) return;

    const unit = Math.min(plate.w, plate.h);

    switch (se.kind) {
      case 'allow': {
        say('allow', ev.src_ip ?? undefined);
        moodKind = 'allow';
        if (!settings.cAllowCracks || !growing()) break;
        const from = src ?? dst;
        if (!from) break;
        if (!throttle.allow(`a|${ev.src_ip}|${ev.dst_port}`, 0.28)) break;
        plate.spawn({
          kind: 'allow',
          color: tone('allow', hash01(`h|${ev.dst_ip ?? ''}`)),
          near: from,
          sign: turnFor(se),
          curvature: curveFor(se),
          ink: 1,
        });
        break;
      }

      case 'block': {
        say('block', ev.src_ip ?? undefined);
        moodKind = 'block';
        if (!settings.cBlockScars || !growing()) break;
        const from = src ?? dst;
        if (!from) break;
        if (!throttle.allow(`b|${ev.src_ip}|${ev.dst_ip}|${ev.dst_port}`, 1.4)) break;
        // a denied flow is agitated and short-lived, and it leaves a wall
        // behind that later cracks will die against
        const c = plate.spawn({
          kind: 'block',
          color: tone('block', hash01(`h|${ev.src_ip ?? ''}`) * 0.5),
          near: from,
          sign: turnFor(se),
          curvature: 0.014 + hash01(`b|${ev.dst_port}`) * 0.026,
          maxAge: 90 + ((hash01(`l|${ev.dst_ip ?? ''}`) * 150) | 0),
          ink: 1.15,
        });
        if (c) plate.barrier(c.x, c.y, c.t + 90, 10 + ((unit * 0.02) | 0));
        break;
      }

      case 'threat': {
        say('threat', ev.src_ip ?? undefined);
        moodKind = 'threat';
        threatUntil = simT + 9;
        if (!settings.cThreatFracture || !growing()) break;
        // A fracture: no curvature at all, so it runs clean across whatever
        // the plate has already built. Threats usually carry no internal
        // address, so each one is placed by a hash of what it hit — falling
        // back to the busiest district instead sent every fracture out of the
        // same point and drew a starburst over the middle of the picture.
        const key = `${ev.dst_ip ?? ''}|${ev.rule_desc ?? ''}`;
        for (let i = 0; i < 2; i++) {
          plate.spawn({
            kind: 'threat',
            color: tone('threat', 0.25 + i * 0.3),
            near: src ?? dst ?? plate.seedAt(hash01(`${key}|${i}`)),
            curvature: 0,
            ink: 1.2,
          });
        }
        break;
      }

      case 'dns': {
        say('dns', ev.src_ip ?? undefined);
        moodKind = 'dns';
        const domain = ev.dns_query ?? '';
        if (!settings.cBlooms || !growing() || !domain) break;
        const from = src ?? sourceSeed(ev.syslog_host ?? undefined);
        if (!throttle.allow(`d|${ev.src_ip}|${domain}`, 1.6)) break;
        const p = nearSeed(from, `${domain}|${from.ip}`, unit * 0.1);
        // a blocked lookup pools grey-violet instead of blue: the law again
        const col = ev.dns_blocked === true
          ? tone('wifi', 0.25 + hash01(`p|${domain}`) * 0.3)
          : tone('dns', hash01(`p|${domain}`));
        plate.bloom(p.x, p.y, col,
                    unit * (0.012 + hash01(`r|${domain}`) * 0.02),
                    Math.max(8, settings.cGrains * 3));
        from.hits++;
        break;
      }

      case 'dhcp': {
        say('dhcp');
        moodKind = 'dhcp';
        if (!growing()) break;
        const name = ev.hostname
          || (ev.mac_address ? `dev-${ev.mac_address.replace(/:/g, '').slice(-4).toUpperCase()}` : undefined);
        // a lease is a new origin: the device plants a seed the lattice grows from
        const s = seedFor(ev.src_ip, name);
        if (!s || !settings.cSprouts) break;
        plate.bloom(s.x, s.y, tone('dhcp', 0.55), unit * 0.02,
                    Math.max(10, settings.cGrains * 4));
        s.hits += 2;
        break;
      }

      case 'wifi': {
        say('wifi');
        moodKind = 'wifi';
        if (!settings.cSpores || !growing()) break;
        const ap = sourceSeed(ev.syslog_host ?? undefined);
        if (!throttle.allow(`w|${ev.syslog_host}|${se.wifi}`, 0.9)) break;
        const bad = se.wifi === 'bad';
        plate.drift(ap.x, ap.y, tone('wifi', bad ? 0.2 : 0.7),
                    Math.max(6, settings.cGrains), unit * (bad ? 0.02 : 0.045),
                    bad ? 1.3 : 0.8);
        break;
      }

      case 'system': {
        say('system');
        if (!growing()) break;
        const s = sourceSeed(ev.syslog_host ?? undefined);
        if (!throttle.allow(`s|${ev.syslog_host}`, 2.5)) break;
        plate.drift(s.x, s.y, tone('system', 0.5),
                    Math.max(4, settings.cGrains >> 1), unit * 0.03, 0.7);
        break;
      }
    }
  }

  /**
   * Keep a floor of live cracks so the plate always makes progress, in
   * whatever colour the network has been lately. Without this a quiet LAN
   * draws almost nothing, which is honest but makes a poor kiosk.
   */
  function topUp(): void {
    const floor = Math.max(4, (plate.density * 0.12) | 0);
    let live = 0;
    for (const c of plate.cracks) if (c.alive) live++;
    if (live >= floor) return;
    const seeds = [...plate.seeds.values()];
    const near = seeds.length ? seeds[(Math.random() * seeds.length) | 0] : null;
    plate.spawn({
      kind: 'allow',
      color: tone(moodKind, 0.3 + Math.random() * 0.5),
      near,
      curvature: Math.random() * 0.006,
      ink: 0.8,
    });
  }

  // ── frame ─────────────────────────────────────────────────────────────────
  function frame(f: FrameInfo): void {
    simT = f.t;
    phaseT += f.dtReal;

    // the plate gets more restless the more the network is under pressure
    plate.curveScale = settings.cCurve * (1 + state.threat * 1.6);
    // both halves of the frame have to be reset together: the plate counts the
    // grain budget, the view owns the buffers they are written into
    plate.beginFrame(settings.cMaxGrains);
    view.beginFrame(settings.cMaxGrains);
    audio.setThreatActive(f.t < threatUntil);

    if (phase === 'grow') {
      /*
       * Let the population climb through the cycle instead of jumping to the
       * full count in the first second. Tarbell opens with three cracks and
       * only reaches his density as they die and are replaced, and that ramp
       * is what gives the finished plate its range of shapes: the few early
       * cracks cut the big quarters, and the crowd that arrives later fills
       * them in. Starting at full density subdivides everything at once and
       * the result is an even mosaic with no large forms in it at all.
       */
      const prog = Math.min(1, phaseT / Math.max(1, settings.cCycleSec));
      plate.density = Math.max(8, Math.round(settings.cDensity * (0.04 + 0.96 * prog * prog)));
      topUp();
      // Busier networks draw faster. The rate is fractional and carried in an
      // accumulator, so a tier that grows at 0.35 of a step per frame really
      // does advance every third frame rather than rounding up to one.
      // Growth is per SECOND, not per frame. The cycle is wall-clock, so a
      // frame-based rate hands a slow screen a half-finished picture at the
      // end of its two minutes: the Pi kiosk draws at a third of a gaming
      // PC's rate and was getting a third of the drawing. `cSteps` is
      // calibrated per 1/60s and scaled by real elapsed time, so every device
      // finishes the same picture in the same two minutes and only the
      // smoothness differs.
      stepAcc += settings.cSteps * (f.dtReal * 60) * (0.7 + state.energy * 0.6);
      const steps = stepAcc | 0;
      if (steps > 0) {
        stepAcc -= steps;
        plate.advance(Math.min(steps, 8));
      }
      // the score follows the drawing: its nib rate is how many cracks are
      // actually growing, reported about once a second rather than per frame
      drawAt -= f.dtReal;
      if (drawAt <= 0) {
        drawAt = 1;
        let live = 0;
        for (const c of plate.cracks) if (c.alive) live++;
        audio.sfx('draw', { count: live });
      }
      if (phaseT >= settings.cCycleSec) {
        phase = 'hold';
        phaseT = 0;
        audio.sfx('finish');
      }
    } else if (phase === 'hold') {
      // finished: the picture sits still so it can actually be looked at
      if (phaseT >= HOLD_S) {
        phase = 'fade';
        phaseT = 0;
        audio.sfx('wash');
        // choose the next sheet now, so the wash can ease onto its paper
        // rather than the colour changing at the moment the plate clears
        washFrom = paperNow;
        nextStudy();
        washTo = sheetPaper();
      }
    } else {
      // and washes away — eased both ends, never a cut or a flash
      const k = Math.min(1, phaseT / FADE_S);
      const e = k * k * (3 - 2 * k);
      view.setPictureAlpha(1 - e);
      view.setBg(mixRgb(washFrom, washTo, e));
      if (k >= 1) restart();
    }

    view.setWander(f.wanderX, f.wanderY);
    view.flush();

    // the busiest district gets named, gently and not very often
    if (settings.cLabels) {
      const b = plate.busiest();
      if (b) {
        const sw = app.screen.width, sh = app.screen.height;
        label.textContent = b.label;
        label.style.transform = `translate(${
          (b.x / plate.w) * sw * 1.04 - sw * 0.02 + f.wanderX
        }px, ${(b.y / plate.h) * sh * 1.04 - sh * 0.02 + f.wanderY}px)`;
        label.style.opacity = phase === 'grow' ? '0.5' : '0.2';
      } else {
        label.style.opacity = '0';
      }
    } else {
      label.style.opacity = '0';
    }

    app.render();
  }

  return {
    event,
    frame,
    applyBudgets,
    settingsChanged(key) {
      applyBudgets();
      if (key === 'cPaper' || key === undefined) applyPaper();
      // the lattice resolution IS the picture, so changing it starts a new one
      if (key === 'cGridScale') resize();
    },
    setResolution(scale) {
      if (app.renderer.resolution !== scale) app.renderer.resolution = scale;
    },
    stats: () => {
      let live = 0;
      for (const c of plate.cracks) if (c.alive) live++;
      return {
        study: settings.cRotate ? study.name : 'fixed',
        cracks: `${live}/${plate.cracks.length}`,
        seeds: plate.seeds.size,
        grains: view.lastGrains,
        lattice: `${plate.w}x${plate.h}`,
        phase: phase === 'grow'
          ? `${Math.max(0, settings.cCycleSec - phaseT) | 0}s`
          : phase,
        pictures,
      };
    },
    diag: () => ({
      app, plate, view,
      restart,
      finish: () => { phaseT = settings.cCycleSec; },
      seed: (ip?: string, name?: string) =>
        plate.host(ip ?? `10.0.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`, name),
    }),
  };
}
