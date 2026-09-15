import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, Scene, Vector3,
  RepeatWrapping, SRGBColorSpace, DataTexture, RGBAFormat, FloatType, NearestFilter, InstancedBufferAttribute, type Texture,
} from 'three';
import { curved } from './bend';
import { NEAR } from './road';
import { ROAD_WIDTH, drawNeon, facade, glow, streak } from './textures';

const SLICE = 13;                 // metres between building slots
// event windows: texture rows are building slots, columns are windows (floors x windows across)
const WIN_ACROSS = 8, WIN_FLOORS = 64;
const WIN_COLS = WIN_ACROSS * WIN_FLOORS, WIN_ROWS = 256;
const WINDOW_W = 18 / 10, WINDOW_H = 50 / 26;
const NEON = ['#ff3fb4', '#3ff0ff', '#ffb040', '#b56bff', '#5cff9c', '#ff5a5a'];
const NEON_COLORS = NEON.map((c) => new Color(c).multiplyScalar(2.2));
const SIGN_WORDS = ['NITRO', 'GARAGE 24', 'RAMEN', 'TURBO', 'MOTEL', 'ARCADE', 'BODY SHOP', 'KARAOKE', 'DRIFT',
  'PARTS', 'CAFE', 'HOTEL', 'CLUB', 'TIRES', 'NOODLE BAR', 'WASH', 'DINER', 'LOUNGE'];

interface Slot {
  z: number;
  side: -1 | 1;
  kind: number;           // facade variant
  w: number; d: number; h: number; x: number;
  roofNeon: number;       // colour index, -1 = none
  lamp: boolean;
  idx: number;            // stable index (its row of event windows)
  sign: Sign | null;
}

interface Sign {
  group: Group;
  tex: CanvasTexture;
  mat: MeshBasicMaterial;
  ctx: CanvasRenderingContext2D;
  color: string;
  heat: number;           // eased brightness boost after a DNS takeover
  target: number;
  owner: Slot | null;
}

const m4 = new Matrix4(), q = new Quaternion(), v = new Vector3(), s = new Vector3(), dummy = new Object3D();

/**
 * The city on both sides of the road: facade blocks (instanced per facade),
 * rooftop neon, street lights with warm pools and wet-road reflection streaks,
 * and neon signs that DNS lookups take over. Everything scrolls toward the
 * camera and wraps back to the horizon with fresh random values.
 */
export class City {
  private slots: Slot[] = [];
  private blocks: InstancedMesh[] = [];
  private roofs: InstancedMesh;
  private poles: InstancedMesh;
  private heads: InstancedMesh;
  private pools: InstancedMesh;
  private streaks: InstancedMesh;
  private streakMat: MeshBasicMaterial;
  private poolMat: MeshBasicMaterial;
  private headMat: MeshBasicMaterial;
  private signs: Sign[] = [];
  private far: number;
  private lampDim = 1;          // brownout multiplier (eased)
  private brownout = 0;
  private wave = 0;             // travelling brownout front (m)
  private glowTex: Texture;
  private pendingText: Array<{ text: string; color: string }> = [];
  // event windows
  private winData: Float32Array;
  private winTex: DataTexture;
  private winTime = { value: 0 };
  private winDirty = 0;
  private slotAttrs: InstancedBufferAttribute[] = [];

  constructor(private scene: Scene, far: number) {
    this.far = far;
    this.glowTex = glow();
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const maxSlots = Math.ceil((1200 + NEAR) / SLICE) * 2;
    // event windows: one texel per window of every building slot (row = slot, column = window)
    this.winData = new Float32Array(WIN_COLS * WIN_ROWS * 4);
    for (let i = 3; i < this.winData.length; i += 4) this.winData[i] = -1e6;
    this.winTex = new DataTexture(this.winData, WIN_COLS, WIN_ROWS, RGBAFormat, FloatType);
    this.winTex.minFilter = NearestFilter; this.winTex.magFilter = NearestFilter;
    this.winTex.needsUpdate = true;
    const winUniforms = { uWin: { value: this.winTex }, uWinTime: this.winTime };
    for (let k = 0; k < 4; k++) {
      const tex = facade(k + 1);
      tex.wrapS = RepeatWrapping; tex.wrapT = RepeatWrapping;
      const mat = curved(new MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: new Color(0.95, 0.9, 0.85).multiplyScalar(0.72), color: 0x2e3242, roughness: 0.7, metalness: 0.1, envMapIntensity: 0.12,
      }), 'facade', (vs) => vs
        .replace('#include <common>', '#include <common>\nattribute float aSlot;\nvarying float vSlot;\nvarying float vRoadFace;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        vSlot = aSlot;
        vRoadFace = step(0.5, abs(normal.x));        // only the faces along the road
        #ifdef USE_INSTANCING
          // windows keep their real size whatever the building's size: one tile = 18 m x 50 m
          vec2 facadeScale = vec2(length(instanceMatrix[2].xyz), length(instanceMatrix[1].xyz)) / vec2(18.0, 50.0);
          vMapUv *= facadeScale;
          vEmissiveMapUv *= facadeScale;
        #endif`),
      (fs) => fs
        .replace('#include <common>', '#include <common>\nuniform sampler2D uWin;\nuniform float uWinTime;\nvarying float vSlot;\nvarying float vRoadFace;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // which window this pixel belongs to (the facade tile is 10 x 26 windows), and whether it's inside the glass
          vec2 cell = vMapUv * vec2(10.0, 26.0);
          vec2 id = floor(cell), f = fract(cell);
          float glass = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          float col = mod(id.y, ${WIN_FLOORS}.0) * ${WIN_ACROSS}.0 + mod(id.x, ${WIN_ACROSS}.0);
          vec4 w = texture2D(uWin, vec2((col + 0.5) / ${WIN_COLS}.0, (vSlot + 0.5) / ${WIN_ROWS}.0));
          // the light eases on, holds a moment, and fades slowly: never a blink
          float age = uWinTime - w.a;
          float k = step(0.0, age) * smoothstep(0.0, 0.9, age) * exp(-max(0.0, age - 1.5) / 11.0);
          totalEmissiveRadiance = mix(totalEmissiveRadiance, w.rgb * 2.6, k * glass * vRoadFace);
        }`), winUniforms);
      const geo = box.clone();
      const slotAttr = new InstancedBufferAttribute(new Float32Array(maxSlots), 1);
      slotAttr.setUsage(DynamicDrawUsage);
      geo.setAttribute('aSlot', slotAttr);
      this.slotAttrs.push(slotAttr);
      const mesh = new InstancedMesh(geo, mat, maxSlots);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.blocks.push(mesh);
      scene.add(mesh);
    }
    const neonMat = curved(new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.roofs = new InstancedMesh(new BoxGeometry(1, 0.35, 0.35), neonMat, maxSlots);
    this.roofs.frustumCulled = false;
    scene.add(this.roofs);

    const poleMat = curved(new MeshStandardMaterial({ color: 0x22222a, metalness: 0.7, roughness: 0.4 }));
    this.poles = new InstancedMesh(new CylinderGeometry(0.1, 0.14, 9, 8).translate(0, 4.5, 0), poleMat, maxSlots);
    this.poles.frustumCulled = false;
    this.headMat = curved(new MeshBasicMaterial({ color: new Color(4, 2.6, 1.3), toneMapped: false }));
    this.heads = new InstancedMesh(new BoxGeometry(2.2, 0.18, 0.5), this.headMat, maxSlots);
    this.heads.frustumCulled = false;
    this.poolMat = curved(new MeshBasicMaterial({
      map: this.glowTex, color: new Color(1.0, 0.62, 0.3), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.pools = new InstancedMesh(new PlaneGeometry(9, 12).rotateX(-Math.PI / 2), this.poolMat, maxSlots);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 1;
    this.streakMat = curved(new MeshBasicMaterial({
      map: streak(), color: new Color(1.4, 0.9, 0.5), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.streaks = new InstancedMesh(new PlaneGeometry(1.2, 22).rotateX(-Math.PI / 2), this.streakMat, maxSlots);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 1;
    scene.add(this.poles, this.heads, this.pools, this.streaks);

    for (let i = 0; i < 26; i++) this.signs.push(this.makeSign());
    this.layout();
  }

  private makeSign(): Sign {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d')!;
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const mat = curved(new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    const group = new Group();
    const back = new Mesh(new BoxGeometry(0.3, 2.6, 9.4), curved(new MeshStandardMaterial({ color: 0x08080c, roughness: 0.5 })));
    const face = new Mesh(new PlaneGeometry(9, 2.25), mat);
    face.position.x = 0.17;
    face.rotation.y = Math.PI / 2;
    group.add(back, face);
    const sign: Sign = { group, tex, mat, ctx, color: NEON[0], heat: 0, target: 0, owner: null };
    this.paint(sign, SIGN_WORDS[(Math.random() * SIGN_WORDS.length) | 0], NEON[(Math.random() * NEON.length) | 0]);
    return sign;
  }

  private paint(sign: Sign, text: string, color: string): void {
    sign.color = color;
    drawNeon(sign.ctx, text.toUpperCase(), color, 512, 128);
    sign.tex.needsUpdate = true;
  }

  setFar(far: number): void {
    if (Math.abs(far - this.far) < 1) return;
    this.far = far;
    this.layout();
  }

  private layout(): void {
    for (const sg of this.signs) { sg.owner = null; sg.group.removeFromParent(); }
    this.slots = [];
    for (let z = NEAR; z > -this.far; z -= SLICE) {
      for (const side of [-1, 1] as const) {
        const slot = { z, side, idx: this.slots.length % WIN_ROWS } as Slot;
        this.reroll(slot);
        this.slots.push(slot);
      }
    }
  }

  private reroll(slot: Slot): void {
    // a new building: its windows start dark
    const row = slot.idx * WIN_COLS * 4;
    for (let i = 3; i < WIN_COLS * 4; i += 4) this.winData[row + i] = -1e6;
    this.winDirty = Math.max(this.winDirty, 1);
    slot.kind = (Math.random() * 4) | 0;
    slot.w = SLICE * (0.72 + Math.random() * 0.24);
    slot.d = 10 + Math.random() * 18;
    const tall = Math.random();
    slot.h = tall < 0.15 ? 60 + Math.random() * 70 : 10 + Math.random() * 38;
    slot.x = slot.side * (ROAD_WIDTH / 2 + 6.5 + slot.d / 2 + Math.random() * 3);
    slot.roofNeon = Math.random() < 0.45 ? (Math.random() * NEON.length) | 0 : -1;
    slot.lamp = Math.round(slot.z / SLICE) % 2 === 0;
    if (slot.sign) { slot.sign.owner = null; slot.sign.group.removeFromParent(); slot.sign = null; }
    if (Math.random() < 0.3) {
      const sg = this.signs.find((x) => !x.owner);
      if (sg) {
        sg.owner = slot;
        slot.sign = sg;
        const custom = this.pendingText.shift();
        if (custom) { this.paint(sg, custom.text, custom.color); sg.heat = 1.4; }
        else if (Math.random() < 0.5) this.paint(sg, SIGN_WORDS[(Math.random() * SIGN_WORDS.length) | 0], NEON[(Math.random() * NEON.length) | 0]);
        this.scene.add(sg.group);
      }
    }
  }

  /** Street-light poles between two distances, as [x, z]: the only thing on the sidewalk our driver has to miss. */
  lampPosts(zMin: number, zMax: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const s of this.slots) if (s.lamp && s.z > zMin && s.z < zMax) out.push([s.side * (ROAD_WIDTH / 2 + 1.2), s.z]);
    return out;
  }

  /**
   * One event, one window: a window on a building up ahead lights in the event's
   * colour, eases on, and fades over about fifteen seconds.
   */
  lightWindow(color: Color): void {
    const ahead = this.slots.filter((sl) => sl.z < -40 && sl.z > -this.far * 0.9);
    if (!ahead.length) return;
    const sl = ahead[(Math.random() * ahead.length) | 0];
    const across = Math.max(1, Math.min(WIN_ACROSS, Math.floor(sl.w / WINDOW_W)));
    const floors = Math.max(2, Math.min(WIN_FLOORS, Math.floor(sl.h / WINDOW_H)));
    const col = (1 + ((Math.random() * (floors - 1)) | 0)) * WIN_ACROSS + ((Math.random() * across) | 0);
    const i = (sl.idx * WIN_COLS + col) * 4;
    this.winData[i] = color.r; this.winData[i + 1] = color.g; this.winData[i + 2] = color.b;
    this.winData[i + 3] = this.winTime.value;
    this.winDirty = Math.max(this.winDirty, 1);
  }

  /** A DNS lookup: the next sign to come over the horizon shows the domain, in DNS blue. */
  takeover(domain: string): void {
    if (this.pendingText.length > 4) this.pendingText.shift();
    this.pendingText.push({ text: domain.replace(/^www\./, '').slice(0, 22), color: '#55b5ff' });
  }

  /** A system event: the street lights brown out in a wave rolling away from the car. */
  brownOut(): void { this.brownout = 1; this.wave = 0; }

  update(dt: number, speed: number, wet: number): void {
    const dz = speed * dt;
    this.winTime.value += dt;
    // new window lights go up to the GPU a few times a second (the shader does the easing)
    if (this.winDirty > 0) {
      this.winDirty += dt;
      if (this.winDirty > 1.1) { this.winTex.needsUpdate = true; this.winDirty = 0; }
    }
    this.brownout = Math.max(0, this.brownout - dt * 0.35);
    this.wave += dt * 180;
    const counts = [0, 0, 0, 0];
    let roofs = 0, lamps = 0;
    for (const slot of this.slots) {
      slot.z += dz;
      if (slot.z > NEAR) { slot.z -= this.far + NEAR; this.reroll(slot); }

      // building
      const mesh = this.blocks[slot.kind];
      dummy.position.set(slot.x, 0, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(slot.d, slot.h, slot.w);
      dummy.updateMatrix();
      this.slotAttrs[slot.kind].setX(counts[slot.kind], slot.idx);
      mesh.setMatrixAt(counts[slot.kind]++, dummy.matrix);

      if (slot.roofNeon >= 0) {
        v.set(slot.x - slot.side * slot.d / 2, slot.h, slot.z);
        s.set(0.35, 1, slot.w);
        m4.compose(v, q.identity(), s);
        this.roofs.setMatrixAt(roofs, m4);
        this.roofs.setColorAt(roofs, NEON_COLORS[slot.roofNeon]);
        roofs++;
      }

      if (slot.lamp) {
        const lx = slot.side * (ROAD_WIDTH / 2 + 1.2);
        // brownout: lamps near the travelling front dip, then recover
        const front = Math.abs(-slot.z - this.wave);
        const dip = this.brownout * Math.exp(-front / 60);
        const level = 1 - dip * 0.85;
        v.set(lx, 0.25, slot.z); m4.compose(v, q.identity(), s.set(1, 1, 1));
        this.poles.setMatrixAt(lamps, m4);
        v.set(lx - slot.side * 1.0, 9, slot.z); m4.compose(v, q.identity(), s.set(level, 1, 1));
        this.heads.setMatrixAt(lamps, m4);
        v.set(lx - slot.side * 3.2, 0.03, slot.z); m4.compose(v, q.identity(), s.set(level, 1, level));
        this.pools.setMatrixAt(lamps, m4);
        v.set(lx - slot.side * 2.4, 0.04, slot.z + 11); m4.compose(v, q.identity(), s.set(level, 1, 0.4 + wet * 0.8));
        this.streaks.setMatrixAt(lamps, m4);
        lamps++;
      }

      if (slot.sign) {
        const sg = slot.sign;
        sg.group.position.set(slot.x - slot.side * (slot.d / 2 + 0.2), 6 + (slot.h > 20 ? 4 : 0), slot.z);
        // angled to face the oncoming car, not just the road
        sg.group.rotation.y = slot.side > 0 ? Math.PI + 1.0 : -1.0;
        sg.heat = Math.max(0, sg.heat - dt * 0.25);
        const b = 0.85 + sg.heat * 0.6;
        sg.mat.color.setScalar(b);
      }
    }
    counts.forEach((n, k) => { this.blocks[k].count = n; this.blocks[k].instanceMatrix.needsUpdate = true; this.slotAttrs[k].needsUpdate = true; });
    this.roofs.count = roofs;
    this.roofs.instanceMatrix.needsUpdate = true;
    if (this.roofs.instanceColor) this.roofs.instanceColor.needsUpdate = true;
    for (const im of [this.poles, this.heads, this.pools, this.streaks]) { im.count = lamps; im.instanceMatrix.needsUpdate = true; }
    this.streakMat.opacity = 0.25 + wet * 0.75;
    this.poolMat.opacity = 0.45 + wet * 0.35;
  }
}
