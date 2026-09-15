import {
  AdditiveBlending, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SpotLight,
  SphereGeometry, Vector3, type Object3D,
} from 'three';
import { Car, Figure, sample, sampleLinear, type Key, type Kit, type Pose, type Script, type Tracked, type Vignette } from './site';

/**
 * The eight things the eye of god catches people doing. Each is a short
 * scripted scene on keyframes: people walk, crouch, climb and hand things
 * over; cars pull in and pull away. Script time 0 is when the enhance starts,
 * and the action peaks while the dossier types itself out.
 */

/** 0..1 inside [a, b], easing over `f` seconds at each edge. */
const win = (t: number, a: number, b: number, f = 0.35) =>
  Math.max(0, Math.min(1, (t - a) / f, (b - t) / f));

interface Actor { fig: Figure; keys: Key[]; show: [number, number]; pose?: (t: number) => Pose; face?: (t: number) => number | undefined; linear?: boolean; }
interface Drive { car: Car; keys: Key[]; face?: (t: number) => number | undefined; }

const tmp: number[] = [];

function runner(k: Kit, actors: Actor[], cars: Drive[], focusKeys: Key[], extra?: (t: number, dt: number) => void): { update: Script['update']; focus: Vector3 } {
  const focus = new Vector3();
  return {
    focus,
    update(t, dt) {
      for (const c of cars) {
        sampleLinear(c.keys, t, tmp);
        c.car.set(tmp[0], tmp[1], dt, c.face?.(t));
      }
      for (const a of actors) {
        a.fig.visible = t >= a.show[0] && t < a.show[1];
        (a.linear ? sampleLinear : sample)(a.keys, t, tmp);
        a.fig.set(tmp[0], tmp[1], tmp[2], dt, a.pose?.(t) ?? {}, a.face?.(t));
      }
      sample(focusKeys, t, tmp);
      focus.set(tmp[0], tmp[1], tmp[2]);
      extra?.(t, dt);
      void k;
    },
  };
}

function prop(k: Kit, w: number, h: number, d: number, color: number, heat: number): Mesh {
  const m = k.mesh(new BoxGeometry(w, h, d), k.mat(color, 0.6), heat);
  return m;
}

function hold(obj: Object3D, hand: Object3D, x = 0, y = -0.12, z = 0.06): void {
  hand.add(obj);
  obj.position.set(x, y, z);
  obj.rotation.set(0, 0, 0);
}

const COATS = [0x1c1f26, 0x2b2320, 0x3a3f46, 0x232b22, 0x4a3b2c, 0x15161a, 0x3d2a2a];

// ── 1. briefcase swap in an empty car park ─────────────────────────────────
const swap: Vignette = {
  id: 'swap', activity: 'COVERT EXCHANGE · PACKAGE HANDOFF', nightOnly: false, tilt: 0.34, yaw: 0.25, height: 21,
  build(k) {
    k.fill('#3d4634', 0.25);
    k.road('x', 27, -64, 64, 9, 2.5);
    k.rect(-27, -19, 27, 19, '#2e3032', 0.1);
    k.rect(-22, 19, -15, 23, '#2e3032', 0.3); k.rect(15, 19, 22, 23, '#2e3032', 0.3);
    for (let x = -24; x <= 24; x += 3) { k.line(x, -19, x, -13, '#bfbcb2', 0.1); k.line(x, 13, x, 19, '#bfbcb2', 0.1); }
    k.line(-24, -13, 24, -13, '#bfbcb2', 0.1); k.line(-24, 13, 24, 13, '#bfbcb2', 0.1);
    for (let i = 0; i < 6; i++) k.blot(-24 + k.random() * 48, -16 + k.random() * 32, 0.6 + k.random(), 'rgba(0,0,0,0.25)');
    k.finishGround(0x39402f);
    k.building(0, -33, 52, 22, 9, { windows: 0.15 });
    k.building(-50, 10, 30, 36, 14); k.building(52, 6, 30, 40, 11);
    for (let x = -26; x <= 26; x += 6.5) k.tree(x, 22, 1.8 + k.random());
    for (const [x, z] of [[-13, 0], [13, 0], [-13, -16], [13, 16]]) k.lamp(x, z);
    const parked = [[-19.5, -16, 0x5a5f66], [-4.5, -16, 0x2a3d57], [16.5, -16, 0x6b6b6b], [7.5, 16, 0x3b3b3b]] as const;
    for (const [x, z, c] of parked) { const car = new Car(k, c); car.set(x, z, 0, z < 0 ? Math.PI : 0); car.set(x, z, 0.1, z < 0 ? Math.PI : 0); car.root.rotation.y = z < 0 ? Math.PI : 0; }
    const carA = new Car(k, 0x16181d, { lights: k.night }), carB = new Car(k, 0x5b1d1d, { lights: k.night });
    const a = new Figure(k, COATS[0]), b = new Figure(k, COATS[4]);
    const briefcase = prop(k, 0.45, 0.32, 0.1, 0x3a2a1c, 0.35);
    const envelope = prop(k, 0.3, 0.02, 0.22, 0xd8d2c2, 0.3);
    hold(briefcase, a.hand, 0, -0.15, 0);
    hold(envelope, b.hand, 0, -0.05, 0.08);
    const r = runner(k, [
      { fig: a, show: [9.4, 15.2], keys: [[9.4, -0.8, 0, -0.35], [10.6, -0.35, 0, -0.1], [13.8, -0.35, 0, -0.1], [15, -0.9, 0, -0.35]],
        pose: (t) => ({ reach: win(t, 11.2, 12.5) }), face: (t) => (t > 10.4 && t < 14 ? Math.PI / 2 : undefined) },
      { fig: b, show: [9.8, 15.4], keys: [[9.8, 0.9, 0, 0.35], [11, 0.35, 0, 0.1], [14, 0.35, 0, 0.1], [15.2, 0.9, 0, 0.35]],
        pose: (t) => ({ reach: win(t, 12.3, 13.6) }), face: (t) => (t > 10.6 && t < 14.2 ? -Math.PI / 2 : undefined) },
    ], [
      { car: carA, keys: [[0, -75, 29], [4, -18.5, 29], [5.6, -18.5, 17], [7, -12, -1.4], [9, -1, -1.4], [15.6, -1, -1.4], [17.2, 11, -1.4], [18.8, 18.5, 9], [20, 18.5, 21], [21, 24, 25], [25, 85, 25]] },
      { car: carB, keys: [[0.4, 75, 25], [4.4, 18.5, 25], [6, 18.5, 14], [7.2, 12, 1.4], [9.2, 1, 1.4], [15.8, 1, 1.4], [17.4, -11, 1.4], [19, -18.5, -8], [20.4, -18.5, 21], [21.4, -24, 29], [25.4, -85, 29]] },
    ], [[0, -12, 0, 12], [8.5, 0, 0, 0], [19, 0, 0, 2], [24, 4, 0, 10]], (t) => {
      if (t > 12.1 && briefcase.parent !== b.hand) hold(briefcase, b.hand, 0, -0.15, 0);
      if (t > 13.1 && envelope.parent !== a.hand) hold(envelope, a.hand, 0, -0.05, 0.08);
    });
    const tracked: Tracked[] = [
      { label: 'SUBJECT A', kind: 'subject', obj: a.root, from: 9.6 },
      { label: 'SUBJECT B', kind: 'subject', obj: b.root, from: 10 },
      { label: 'PACKAGE', kind: 'object', obj: briefcase, from: 10.2 },
      { label: 'VEHICLE 1', kind: 'vehicle', obj: carA.root, from: 0.5 },
      { label: 'VEHICLE 2', kind: 'vehicle', obj: carB.root, from: 1.5 },
    ];
    return { ...r, tracked };
  },
};

// ── 2. out the bedroom window and down the drainpipe ───────────────────────
const window_: Vignette = {
  id: 'window', activity: 'UNAUTHORIZED EXIT · SUBJECT EVADING HOUSEHOLD', nightOnly: true, tilt: 0.6, yaw: 0, height: 17,
  build(k) {
    k.fill('#34422b', 0.3);
    k.road('x', 16, -64, 64, 8, 2.2);
    k.rect(-7, -1.5, -3, 11.8, '#55524d', 0.2);                      // driveway
    k.rect(-40, -1.5, -24, 11.8, '#324028', 0.2); k.rect(24, -1.5, 40, 11.8, '#324028', 0.2);
    k.finishGround(0x2f3a27);
    k.building(0, -7, 16, 11, 7, { windows: 0 });
    k.building(-30, -8, 14, 12, 7, { windows: 0.2 }); k.building(30, -7, 14, 11, 7, { windows: 0.3 });
    // the lit bedroom window and a dark one
    const lit = k.mesh(new PlaneGeometry(1.4, 1.3), k.glowMat(0xffd49a, 1.3), 0.55);
    lit.position.set(2, 4.3, -1.47);
    lit.rotation.y = Math.PI;
    lit.rotation.y = 0;
    const dark = k.mesh(new PlaneGeometry(1.4, 1.3), k.mat(0x14181d, 0.2), 0.3);
    dark.position.set(-3, 4.3, -1.47);
    const door = k.mesh(new PlaneGeometry(1.1, 2.2), k.mat(0x3a2c22, 0.7), 0.3);
    door.position.set(-5, 1.1, -1.47);
    k.scene.add(lit, dark, door);
    const spill = new Mesh(new PlaneGeometry(4, 6), new MeshBasicMaterial({ map: k.glow, color: 0xffc27a, transparent: true, opacity: 0.3, blending: AdditiveBlending, depthWrite: false }));
    spill.rotation.x = -Math.PI / 2; spill.position.set(2, 0.05, 1.2); spill.userData.heat = -1;
    k.scene.add(spill);
    const pipe = k.mesh(new CylinderGeometry(0.06, 0.06, 7, 8), k.mat(0x8a8d90, 0.5, 0.4), 0.25);
    pipe.position.set(4.2, 3.5, -1.4);
    k.scene.add(pipe);
    for (let x = -12; x < 8; x += 1.2) k.box(x + 0.6, 0, 5.6, 1.25, 1.3 + k.random() * 0.2, 1.1, 0x253a22, 0.22);
    k.box(0, 0, 10, 28, 0.9, 0.12, 0x6b5a48, 0.2);
    k.tree(-11, 1, 2.2); k.tree(14, 3, 2.6);
    k.lamp(-18, 11.6, 0.6); k.lamp(18, 11.6, 0.6);
    const car = new Car(k, 0x2a2e36, { lights: false });
    const kid = new Figure(k, 0x4a2f5a, 0xd0a488, 0x2d3440);
    const r = runner(k, [
      { fig: kid, show: [0, 17], keys: [[0, 2, 3.3, -1.12], [1.5, 2, 3.3, -1.1], [3.5, 3.95, 3.3, -1.12], [4, 4.02, 3.2, -1.14], [7, 4.02, 0.05, -1.14], [7.6, 4, 0, -0.5], [9.5, 5.5, 0, 2.6], [12, 9.6, 0, 4.6], [13.2, 10.6, 0, 7.4], [14.1, 10.6, 0.55, 10], [14.8, 10.7, 0, 10.9], [16.6, 11.5, 0, 12.6]],
        pose: (t) => ({ crouch: t < 3.4 ? 0.75 : win(t, 7.5, 12.3) * 0.6, climb: win(t, 3.6, 7.2) }),
        face: (t) => (t < 7.3 ? Math.PI : undefined) },
    ], [
      { car, keys: [[0, 12, 13.3], [18.2, 12, 13.3], [20, 0, 13.3], [25, -75, 13.3]], face: (t) => (t < 18.2 ? -Math.PI / 2 : undefined) },
    ], [[0, 2.5, 2.5, -1], [7, 4, 0.5, 1], [12, 8, 0, 5], [17, 11, 0, 10.5], [23, -6, 0, 12]]);
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: kid.root, from: 0.5 },
      { label: 'VEHICLE', kind: 'vehicle', obj: car.root, from: 12 },
    ] };
  },
};

// ── 3. hiding behind the dumpsters while a patrol sweeps the alley ─────────
const alley: Vignette = {
  id: 'alley', activity: 'EVASION · SUBJECT CONCEALED FROM PATROL', nightOnly: true, tilt: 0.36, yaw: 0, height: 22,
  build(k) {
    k.fill('#2b2c2e', 0.3);
    k.rect(-4, -64, 4, 10, '#252628', 0.45);
    for (let i = 0; i < 9; i++) k.blot(-3 + k.random() * 6, -50 + k.random() * 55, 0.8 + k.random() * 1.4, 'rgba(90,110,130,0.18)');
    k.road('x', 15, -64, 64, 9, 2.5);
    k.finishGround(0x2a2b2d);
    k.building(-18, -26, 28, 60, 16, { windows: 0.2 });
    k.building(18, -26, 28, 60, 22, { windows: 0.25 });
    k.building(-22, 40, 36, 20, 12); k.building(22, 40, 36, 20, 14);
    const hideout = k.dumpster(2.6, -3, 0);
    k.dumpster(-2.7, -18, 0, 0x2a3f5a);
    for (let i = 0; i < 6; i++) k.box(-3.2 + k.random() * 1.2, 0, -30 + k.random() * 20, 0.6, 0.5, 0.6, 0x222326, 0.25);
    k.lamp(-5.2, 9.2, 0);
    const patrol = new Car(k, 0x121418, { patrol: true, lights: true });
    const runnerFig = new Figure(k, COATS[5]);
    // the searchlight: a real spot plus a visible wash on the ground
    const spot = new SpotLight(0xeef4ff, 0, 75, 0.2, 0.55, 1.4);
    k.scene.add(spot, spot.target);
    const wash = new Mesh(new PlaneGeometry(7, 26), new MeshBasicMaterial({ map: k.beamTex, color: 0xe6f0ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
    wash.rotation.x = -Math.PI / 2; wash.userData.heat = -1;
    const washPivot = new Group();
    washPivot.add(wash);
    wash.position.z = -13;
    k.scene.add(washPivot);
    const r = runner(k, [
      { fig: runnerFig, show: [0, 22], linear: true, keys: [[0, 0.4, 0, -46], [3, 1.2, 0, -8.5], [3.8, 2.6, 0, -4.55], [14.4, 2.6, 0, -4.55], [15.2, 2.2, 0, -5.3], [16.2, 1, 0, -9], [21, -0.5, 0, -46]],
        pose: (t) => ({ crouch: win(t, 3.6, 14.6, 0.4), lookAt: t > 14.5 && t < 16 ? Math.sin(t * 3) * 0.8 : 0 }),
        face: (t) => (t > 3.8 && t < 15.2 ? 0 : undefined) },
    ], [
      { car: patrol, keys: [[1.5, -80, 13], [6.5, -1.5, 13], [12, -1.5, 13], [13.6, 6, 13], [18, 80, 13]] },
    ], [[0, 0, 0, -22], [4, 0, 0, -5], [7, 0, 0, 5], [12, 0, 0, 3], [16, 0, 0, -7], [21, 0, 0, -22]], (t) => {
      const on = win(t, 6.4, 12.6, 0.8);
      const sweep = Math.sin((t - 6.4) * 0.9) * 0.32;
      const p = patrol.root.position;
      spot.position.set(p.x - 0.7, 1.9, p.z - 0.6);
      spot.target.position.set(p.x + Math.sin(sweep) * 22, 0, p.z - Math.cos(sweep) * 22);
      spot.intensity = on * 1600;
      washPivot.position.set(p.x - 0.7, 0.06, p.z - 0.6);
      washPivot.rotation.y = Math.PI - sweep;
      (wash.material as MeshBasicMaterial).opacity = on * 0.4;
      void hideout;
    });
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: runnerFig.root, from: 0.5 },
      { label: 'PATROL', kind: 'vehicle', obj: patrol.root, from: 4 },
    ] };
  },
};

// ── 4. a rooftop meet and an envelope ──────────────────────────────────────
const rooftop: Vignette = {
  id: 'rooftop', activity: 'CLANDESTINE MEETING · DOCUMENT TRANSFER', nightOnly: false, tilt: 0.38, yaw: 0.5, height: 16,
  build(k) {
    k.fill('#313234', 0.25);
    k.road('x', -32, -64, 64, 9); k.road('z', 34, -64, 64, 9);
    k.finishGround(0x303133);
    const roofY = 18;
    k.building(0, 0, 44, 32, roofY, { windows: 0.3, ac: 0 });
    k.building(-42, 0, 30, 30, 10, { windows: 0.3 }); k.building(-2, -58, 40, 30, 14, { windows: 0.2 }); k.building(-2, 44, 44, 26, 12, { windows: 0.3 });
    k.box(-15, roofY, -8, 3, 3, 4, 0x6a655e, 0.3); k.box(15, roofY, 8, 3, 3, 4, 0x6a655e, 0.3);
    for (const [x, z, w, d] of [[-6, 10, 3, 2.2], [6, -11, 2.4, 2.4], [-17, 9, 2, 3], [17, -9, 2.6, 2]]) k.box(x, roofY, z, w, 1.2, d, 0x9a9da0, 0.45, 0.5);
    const tank = k.mesh(new CylinderGeometry(1.8, 1.8, 3, 18), k.mat(0x6f5a44, 0.8), 0.25);
    tank.position.set(12, roofY + 2.8, -9);
    k.scene.add(tank);
    for (let y = 1; y < roofY; y += 6) k.box(22.6, y, -6, 1.4, 0.12, 2.6, 0x2a2b2d, 0.25, 0.5);
    k.box(22.25, 0, -6.9, 0.08, roofY + 1, 0.08, 0x2a2b2d, 0.25);
    k.box(22.25, 0, -5.1, 0.08, roofY + 1, 0.08, 0x2a2b2d, 0.25);
    if (k.night) { k.lamp(26, -30); k.lamp(-26, -30); }
    const a = new Figure(k, COATS[2]), b = new Figure(k, COATS[6]);
    const envelope = prop(k, 0.32, 0.02, 0.24, 0xd9d0b8, 0.3);
    hold(envelope, b.hand, 0, -0.05, 0.08);
    const face = (me: Figure, other: Figure) => Math.atan2(other.root.position.x - me.root.position.x, other.root.position.z - me.root.position.z);
    const r = runner(k, [
      { fig: a, show: [0.8, 30], keys: [[0.8, -13.3, roofY, -7.5], [7, -1.2, roofY, -0.6], [12, -1.2, roofY, -0.6], [16, 20.9, roofY, -6], [17, 22.2, roofY, -6], [17.5, 22.45, roofY - 0.8, -6], [24, 22.45, 5, -6]],
        pose: (t) => ({ reach: win(t, 9.4, 10.6), climb: t > 17.2 ? 1 : 0, lookAt: t > 7.2 && t < 9 ? Math.sin(t * 2.5) * 0.9 : 0 }),
        face: (t) => (t > 7 && t < 12 ? face(a, b) : t > 17 ? -Math.PI / 2 : undefined) },
      { fig: b, show: [2.4, 17.2], keys: [[2.4, 13.4, roofY, 8], [8.2, 0.9, roofY, 0.5], [12.5, 0.9, roofY, 0.5], [17, 13.4, roofY, 8]],
        pose: (t) => ({ reach: win(t, 9.2, 10.4) }), face: (t) => (t > 8.2 && t < 12.5 ? face(b, a) : undefined) },
    ], [], [[0, -8, roofY, -4], [8, 0, roofY, 0], [13, 5, roofY, -2], [18, 16, roofY - 2, -5], [23, 18, 10, -5]], (t) => {
      if (t > 10 && envelope.parent !== a.hand) hold(envelope, a.hand, 0, -0.05, 0.08);
    });
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: a.root, from: 1.2 },
      { label: 'SUBJECT B', kind: 'subject', obj: b.root, from: 2.8 },
      { label: 'DOCUMENTS', kind: 'object', obj: envelope, from: 8.5 },
    ] };
  },
};

// ── 5. a bag off the end of the pier ───────────────────────────────────────
const pier: Vignette = {
  id: 'pier', activity: 'EVIDENCE DISPOSAL · OBJECT DISCARDED', nightOnly: false, tilt: 0.32, yaw: -0.45, height: 20,
  build(k) {
    k.fill('#3c3e3a', 0.25);
    k.rect(-64, 11, 64, 16, '#57534a', 0.5);
    k.road('x', 31, -64, 64, 8);
    k.rect(-10, 17, 14, 25.5, '#2f3032', 0.3);
    for (let x = -9; x <= 13; x += 2.8) k.line(x, 17, x, 22, '#bdb9ae', 0.1);
    k.finishGround(0x3a3c38, false);
    k.water(0, -58, 320, 146);
    for (let x = -60; x <= 60; x += 20) if (Math.abs(x) > 10) k.building(x, 44, 16, 14, 6 + k.random() * 8, { windows: 0.3 });
    const deckY = 1.0;
    for (let z = 15; z > -31; z -= 1.2) {
      k.box(0, deckY, z, 3.6, 0.13, 1.12, [0x6b5541, 0x5f4b3a, 0x735c47][Math.floor(k.random() * 3)], 0.22, 0.95);
    }
    for (let z = 14; z > -31; z -= 5) for (const x of [-1.9, 1.9]) {
      const p = k.mesh(new CylinderGeometry(0.16, 0.16, 2.4, 8), k.mat(0x3b3026), 0.2);
      p.position.set(x, 0.2, z);
      k.scene.add(p);
    }
    k.lamp(2.2, -8); k.lamp(2.2, -24); k.lamp(-8, 16);
    const car = new Car(k, 0x3e4a3c, { lights: false });
    car.set(4, 21, 0, Math.PI); car.root.rotation.y = Math.PI; car.heading = Math.PI;
    const man = new Figure(k, COATS[1]);
    const bag = k.mesh(new SphereGeometry(0.28, 12, 8), k.mat(0x151515, 0.5), 0.35);
    bag.scale.set(1, 0.8, 1.2);
    hold(bag, man.hand, 0, -0.25, 0);
    const land = new Vector3(-2.5, 0, -38);
    k.splash(land.x, land.z, 14.7);
    const start = new Vector3();
    const r = runner(k, [
      { fig: man, show: [0, 24.3], keys: [[0, 3, 0, 20.5], [2, 1, 0, 16.5], [2.6, 0.4, deckY + 0.13, 14.5], [11, 0.2, deckY + 0.13, -28], [14.2, 0.2, deckY + 0.13, -28.4], [21.8, 0.4, deckY + 0.13, 14.5], [22.4, 1, 0, 16.5], [24, 3.2, 0, 20]],
        pose: (t) => ({ throwArm: win(t, 13.2, 14.1, 0.25), lookAt: t > 11.3 && t < 13 ? Math.sin((t - 11.3) * 3.6) * 1.1 : 0 }),
        face: (t) => (t > 11 && t < 14.2 ? Math.PI : undefined) },
    ], [], [[0, 2, 0, 14], [6, 1, 1, -6], [12, 0, 1, -27], [15.5, -1, 1, -32], [20, 0.5, 1, -8], [24, 2, 0, 15]], (t) => {
      if (t >= 13.8 && t < 14.7) {
        if (bag.parent !== k.scene) { bag.getWorldPosition(start); k.scene.add(bag); }
        const u = (t - 13.8) / 0.9;
        bag.position.set(start.x + (land.x - start.x) * u, start.y + (land.y - start.y) * u + Math.sin(u * Math.PI) * 3.5, start.z + (land.z - start.z) * u);
        bag.visible = true;
      } else if (t >= 14.7) bag.visible = false;
    });
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: man.root, from: 0.5 },
      { label: 'OBJECT', kind: 'object', obj: bag, from: 6 },
      { label: 'VEHICLE', kind: 'vehicle', obj: car.root, from: 0.5 },
    ] };
  },
};

// ── 6. a crate out of the warehouse into a van ─────────────────────────────
const dock: Vignette = {
  id: 'dock', activity: 'ILLICIT TRANSFER · CARGO LOADED', nightOnly: false, tilt: 0.42, yaw: 0.35, height: 19,
  build(k) {
    k.fill('#56565a', 0.3);
    k.road('x', 26, -64, 64, 9);
    for (const x of [-9, -3, 9, 15]) k.line(x, -2, x, 10, '#d8c35a', 0.14);
    for (let i = 0; i < 10; i++) k.blot(-20 + k.random() * 40, -1 + k.random() * 16, 0.8 + k.random() * 1.5, 'rgba(0,0,0,0.25)');
    k.finishGround(0x4f4f53);
    k.building(0, -18, 46, 26, 10, { windows: 0.1 });
    k.building(-48, -10, 30, 40, 12); k.building(50, -14, 30, 34, 9);
    k.box(3, 0, -3.5, 24, 1.2, 3, 0x6d6c69, 0.3);
    for (const x of [-5, 3, 11]) {
      const d = k.mesh(new PlaneGeometry(3.4, 3.2), x === 3 ? k.glowMat(0x6a4a26, k.night ? 1.4 : 0.2) : k.mat(0x6f7478, 0.6, 0.4), x === 3 ? 0.45 : 0.3);
      d.position.set(x, 1.2 + 1.6, -4.98);
      k.scene.add(d);
    }
    for (const [x, z] of [[-16, 4], [16, 12], [-18, 18]]) k.lamp(x, z);
    k.box(-15, 0, 8, 1.2, 1.3, 1.2, 0x6b5436, 0.25); k.box(-13.6, 0, 8.4, 1.2, 0.9, 1.2, 0x6b5436, 0.25);
    const van = new Car(k, 0xd9d9d6, { van: true, lights: k.night });
    const a = new Figure(k, COATS[3]), b = new Figure(k, COATS[0]);
    const crate = k.mesh(new BoxGeometry(1.3, 0.8, 0.8), k.mat(0x7a6040, 0.9), 0.3);
    k.scene.add(crate);
    const r = runner(k, [
      { fig: a, show: [9.4, 15.9], keys: [[9.4, 2.35, 1.2, -5.5], [12.6, 2.35, 1.2, -2.5], [13.8, 2.35, 1.2, -2.5], [15.8, 2.2, 1.2, -5.2]], pose: (t) => ({ carry: win(t, 9.4, 13.7) }), face: (t) => (t < 14 ? 0 : undefined) },
      { fig: b, show: [9.4, 15.9], keys: [[9.4, 3.65, 1.2, -5.5], [12.6, 3.65, 1.2, -2.5], [13.8, 3.65, 1.2, -2.5], [15.8, 3.8, 1.2, -5.2]], pose: (t) => ({ carry: win(t, 9.4, 13.7) }), face: (t) => (t < 14 ? 0 : undefined) },
    ], [
      { car: van, keys: [[0, 75, 28], [4, 14, 28], [5.6, 8, 13], [8.5, 3, 0.8], [17, 3, 0.8], [19, 5, 10], [21, 12, 26], [25, 80, 28]],
        face: (t) => (t > 5.4 && t < 17 ? 0 : undefined) },
    ], [[0, 20, 0, 22], [5, 8, 0, 8], [9, 3, 0, 0], [14, 3, 1, -1], [19, 6, 0, 10], [24, 20, 0, 22]], (t) => {
      const open = win(t, 8.9, 16.3, 0.9);
      van.doors.forEach((d, i) => { d.rotation.y = (i === 0 ? -1 : 1) * open * 1.9; });
      if (t < 9.4) crate.visible = false;
      else if (t < 13.8) {
        crate.visible = true;
        crate.position.set((a.root.position.x + b.root.position.x) / 2, 1.2 + 0.78, (a.root.position.z + b.root.position.z) / 2 + 0.42);
      } else if (t < 14.6) {
        const u = (t - 13.8) / 0.8;
        crate.position.set(3, 1.98 - u * 0.2, -2.1 + u * 2.6);
      } else crate.visible = false;
    });
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: a.root, from: 9.7 },
      { label: 'SUBJECT B', kind: 'subject', obj: b.root, from: 9.9 },
      { label: 'CARGO', kind: 'object', obj: crate, from: 10.2 },
      { label: 'VEHICLE', kind: 'vehicle', obj: van.root, from: 0.5 },
    ] };
  },
};

// ── 7. papers into a burn barrel ───────────────────────────────────────────
const burn: Vignette = {
  id: 'burn', activity: 'DOCUMENT DESTRUCTION · HEAT SIGNATURE', nightOnly: true, tilt: 0.3, yaw: -0.3, height: 14,
  build(k) {
    k.fill('#48443e', 0.45);
    k.rect(-20, -8, 20, -4, '#5a5955', 0.2);
    for (let i = 0; i < 16; i++) k.blot(-16 + k.random() * 32, -3 + k.random() * 18, 0.6 + k.random() * 1.6, 'rgba(20,16,12,0.35)');
    k.line(-18, 8, 18, 12, 'rgba(30,28,25,0.5)', 0.35);
    k.finishGround(0x3d3a35);
    k.building(0, -18, 40, 20, 8, { windows: 0.12 });
    k.building(-44, -6, 30, 30, 11); k.building(44, 4, 30, 34, 14);
    const door = k.mesh(new PlaneGeometry(1.2, 2.2), k.mat(0x2b2724, 0.8), 0.3);
    door.position.set(-6, 1.1, -7.97);
    k.scene.add(door);
    k.lamp(-9, -7, 0.5);
    for (let x = -18; x <= 18; x += 2.5) { k.box(x, 0, 16, 0.08, 2, 0.08, 0x77797c, 0.25, 0.5); }
    for (let z = -4; z <= 16; z += 2.5) { k.box(-18, 0, z, 0.08, 2, 0.08, 0x77797c, 0.25, 0.5); k.box(18, 0, z, 0.08, 2, 0.08, 0x77797c, 0.25, 0.5); }
    k.box(0, 1.9, 16, 36, 0.05, 0.05, 0x77797c, 0.2, 0.5);
    k.dumpster(10, -5.4);
    for (let i = 0; i < 4; i++) k.box(-14 + i * 0.3, i * 0.15, 4 + i * 0.1, 1.2, 0.14, 1, 0x6d5a3e, 0.22);
    k.box(-11, 0, 9, 4.4, 1.2, 1.9, 0x4a2f24, 0.2);
    const barrel = k.mesh(new CylinderGeometry(0.34, 0.32, 0.9, 14), k.mat(0x5a3a26, 0.8, 0.3), 0.85);
    barrel.position.set(3, 0.45, 3);
    k.scene.add(barrel);
    const fire = k.fire(3, 0.9, 3);
    const man = new Figure(k, COATS[1]);
    const box = k.mesh(new BoxGeometry(0.5, 0.35, 0.4), k.mat(0x9a7a52, 0.9), 0.3);
    man.root.add(box);
    box.position.set(0, 1.05, 0.38);
    const papers = Array.from({ length: 10 }, () => {
      const p = k.mesh(new PlaneGeometry(0.22, 0.3), k.mat(0xe8e2d4, 0.9), 0.55);
      p.visible = false;
      k.scene.add(p);
      return p;
    });
    const from = new Vector3();
    const r = runner(k, [
      { fig: man, show: [1, 20.2], keys: [[1, -6, 0, -7.2], [5, 2.1, 0, 2.15], [15.4, 2.1, 0, 2.15], [20, -6, 0, -7.3]],
        pose: (t) => ({ carry: t < 5.5 ? 1 : 0, reach: t > 6 && t < 13.2 ? 0.55 + 0.45 * Math.sin(t * 3) : 0, lookAt: t > 13.8 && t < 15.3 ? Math.sin((t - 13.8) * 4) * 1 : 0 }),
        face: (t) => (t > 5 && t < 15.4 ? Math.atan2(3 - 2.1, 3 - 2.15) : undefined) },
    ], [], [[0, -4, 0, -5], [5, 1, 0, 1], [14, 2, 0, 2], [20, -3, 0, -4]], (t, dt) => {
      box.visible = t < 13.6;
      fire.boost = Math.max(0, fire.boost - dt * 0.5);
      papers.forEach((p, i) => {
        const at = 6.2 + i * 0.7, u = (t - at) / 0.6;
        if (u < 0 || u > 1) { p.visible = false; return; }
        if (!p.visible) { box.getWorldPosition(from); fire.boost = Math.min(1.2, fire.boost + 0.5); }
        p.visible = true;
        p.position.set(from.x + (3 - from.x) * u, from.y + Math.sin(u * Math.PI) * 0.5 + (1.0 - from.y) * u, from.z + (3 - from.z) * u);
        p.rotation.set(u * 4, u * 3, 0);
      });
    });
    return { ...r, tracked: [
      { label: 'SUBJECT A', kind: 'subject', obj: man.root, from: 1.4 },
      { label: 'HEAT SOURCE', kind: 'object', obj: barrel, from: 2 },
    ] };
  },
};

// ── 8. a lookout on the corner signals a car ───────────────────────────────
const lookout: Vignette = {
  id: 'lookout', activity: 'COUNTER-SURVEILLANCE · LOOKOUT SIGNAL', nightOnly: false, tilt: 0.45, yaw: 0.8, height: 22,
  build(k) {
    k.fill('#6a6864', 0.2);
    k.road('x', 0, -64, 64, 8, 0); k.road('z', 0, -64, 64, 8, 0);
    k.rect(-4, -4, 4, 4, '#2e2f31', 0.25);
    for (const [x0, z0, x1, z1] of [[-4, -7, 4, -4.4], [-4, 4.4, 4, 7], [-7, -4, -4.4, 4], [4.4, -4, 7, 4]]) {
      const vertical = x1 - x0 < 4;
      for (let i = 0; i < 7; i++) {
        if (vertical) k.rect(x0, -3.6 + i * 1.1, x1, -3.6 + i * 1.1 + 0.55, '#d6d2c6');
        else k.rect(-3.6 + i * 1.1, z0, -3.6 + i * 1.1 + 0.55, z1, '#d6d2c6');
      }
    }
    k.finishGround(0x5e5c58);
    k.building(-26, -26, 30, 30, 9, { windows: 0.35 }); k.building(26, -26, 30, 30, 7, { windows: 0.3 });
    k.building(-26, 26, 30, 30, 6, { windows: 0.3 }); k.building(26, 28, 30, 32, 8, { windows: 0.25 });
    for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6]]) k.lamp(x, z);
    for (const [x, z, h, c] of [[-20, 2.5, 0, 0x4a4f57], [22, -2.5, Math.PI, 0x6b2020], [2.5, -22, Math.PI / 2, 0x33363a]] as const) {
      const car = new Car(k, c); car.root.position.set(x, 0, z); car.root.rotation.y = h + Math.PI / 2;
    }
    const car = new Car(k, 0x101216, { lights: k.night });
    const watcher = new Figure(k, COATS[3]), dealer = new Figure(k, COATS[6]);
    const r = runner(k, [
      { fig: watcher, show: [0, 30], keys: [[0, 6.2, 0, 6.2], [5, 6.6, 0, 5.8], [9, 6.2, 0, 6.2], [15.5, 6.2, 0, 6.2], [16.5, 5, 0, 5.6], [24, -30, 0, 5.6]],
        pose: (t) => ({ armUp: win(t, 8.1, 9.7), lookAt: t < 8 ? Math.sin(t * 1.4) * 1.1 : 0 }),
        face: (t) => (t < 9.8 ? -Math.PI / 2 : undefined) },
      { fig: dealer, show: [10.4, 30], keys: [[10.4, 14, 0, 12.2], [13.2, 9.4, 0, 3.7], [15.4, 9.4, 0, 3.7], [17, 14, 0, 5.6], [24, 40, 0, 5.6]],
        pose: (t) => ({ reach: win(t, 13.4, 15) }), face: (t) => (t > 13 && t < 15.3 ? Math.PI : undefined) },
    ], [
      { car, keys: [[2, -75, 2], [8, -14, 2], [10, -2, 2], [11.6, 6.8, 2], [12.2, 7.8, 2], [15.2, 7.8, 2], [16.4, 16, 2], [19.5, 80, 2]] },
    ], [[0, -8, 0, 4], [9, 2, 0, 3], [14, 8, 0, 3], [18, 6, 0, 5], [24, 0, 0, 6]]);
    return { ...r, tracked: [
      { label: 'LOOKOUT', kind: 'subject', obj: watcher.root, from: 0.5 },
      { label: 'SUBJECT B', kind: 'subject', obj: dealer.root, from: 10.8 },
      { label: 'VEHICLE', kind: 'vehicle', obj: car.root, from: 3.5 },
    ] };
  },
};

export const VIGNETTES: Vignette[] = [swap, window_, alley, rooftop, pier, dock, burn, lookout];
