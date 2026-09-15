import {
  BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshDepthMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RGBADepthPacking, Vector2, type Scene, type Texture,
} from 'three';
import { lerpProfile, type SpeciesDef } from './species';
import { EYE_SLOT, PEC_SLOT, paintSkin, tu, tv } from './skins';
import { underwater, type Patch } from './water';

/**
 * A species as two instanced meshes that move together: the solid body (with
 * eyes, and spines for the puffer) and its see-through fins. Both bend in the
 * vertex shader: a wave runs down the body toward the tail, growing as it
 * goes; the body bends into turns; pectoral fins scull; a puffer inflates.
 * Per fish that's one vec4 (wave phase, amplitude, turn bend, puff).
 */
const SWIM_GLSL = /* glsl */`
  attribute float aKind;     // 0 body, 1 fin, 2 pectoral fin, 3 spine
  attribute float aFlex;     // pectoral: 0 at the root … 1 at the tip
  attribute vec3 aBase;      // spine: where it sits on the skin
  attribute vec4 aSwim;      // phase, amplitude, bend, puff
  uniform float uWaveK;
  vec3 swim(vec3 p) {
    float puff = aSwim.w;
    if (aKind > 2.5) p = mix(aBase, p, smoothstep(0.2, 0.95, puff));
    float bx = clamp(p.x, 0.0, 1.0);
    p.yz *= 1.0 + puff * 0.8 * pow(sin(3.14159 * bx), 0.6);
    if (aKind > 1.5 && aKind < 2.5) {
      float scull = sin(uTime * (5.0 + puff * 6.0) + aSwim.x * 0.15);
      p.z += aFlex * aFlex * sign(p.z) * 0.05 * scull;
      p.y += aFlex * 0.02 * scull;
    }
    float along = 1.0 - p.x;
    float amp = aSwim.y * (0.12 + along * along * 0.88);
    p.z += amp * sin(p.x * uWaveK + aSwim.x) + aSwim.z * along * along;
    return p;
  }
  float swimSlope(vec3 p) {
    float along = 1.0 - p.x;
    float amp = aSwim.y * (0.12 + along * along * 0.88);
    float dAmp = -aSwim.y * 1.76 * along;
    return amp * uWaveK * cos(p.x * uWaveK + aSwim.x) + dAmp * sin(p.x * uWaveK + aSwim.x) - 2.0 * aSwim.z * along;
  }
`;

function swimPatch(waveK: number, withNormal: boolean): Patch {
  return {
    vertexHead: SWIM_GLSL,
    uniforms: { uWaveK: { value: waveK } },
    begin: 'vec3 transformed = swim(position);',
    normal: withNormal
      ? '{ float sl = swimSlope(position); objectNormal = normalize(vec3(objectNormal.x - sl * objectNormal.z, objectNormal.y, objectNormal.z + sl * objectNormal.x)); }'
      : undefined,
  };
}

class Builder {
  pos: number[] = []; uv: number[] = []; kind: number[] = []; flex: number[] = []; base: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, kind: number, flex = 0, b: [number, number, number] = [x, y, z]): number {
    this.pos.push(x, y, z); this.uv.push(u, v); this.kind.push(kind); this.flex.push(flex); this.base.push(...b);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, a, c, d); }
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aKind', new Float32BufferAttribute(this.kind, 1));
    g.setAttribute('aFlex', new Float32BufferAttribute(this.flex, 1));
    g.setAttribute('aBase', new Float32BufferAttribute(this.base, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** A grid in the fish's side plane between two edges, textured by where it sits. */
function sideGrid(b: Builder, x0: number, x1: number, lo: (x: number) => number, hi: (x: number) => number, nx: number, ny: number, kind: number): void {
  const start = b.pos.length / 3;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * (i / nx);
    const y = lo(x) + (hi(x) - lo(x)) * (j / ny);
    b.vert(x, y, 0, tu(x), tv(y), kind);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = start + j * (nx + 1) + i;
    b.quad(a, a + 1, a + nx + 2, a + nx + 1);
  }
}

export function bodyGeometry(d: SpeciesDef): BufferGeometry {
  const b = new Builder();
  const top = (x: number) => lerpProfile(d.top, x), bot = (x: number) => lerpProfile(d.bottom, x), wid = (x: number) => lerpProfile(d.width, x);
  const NU = 40, NV = 22;
  const ring = (x: number, t: number): [number, number, number] => {
    const s = Math.sin(t), c = Math.cos(t);
    // slightly boxy cross-section: fish are flattened side to side
    const sy = s, cz = Math.sign(c) * Math.pow(Math.abs(c), 0.8);
    return [x, s >= 0 ? sy * top(x) : sy * bot(x), cz * wid(x)];
  };
  for (let i = 0; i <= NU; i++) {
    const k = i / NU;
    const x = 1 - Math.pow(1 - k, 1.3);     // denser toward the tail root, where it bends most
    for (let j = 0; j < NV; j++) {
      const [px, py, pz] = ring(x, (j / NV) * Math.PI * 2);
      b.vert(px, py, pz, tu(px), tv(py), 0);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * NV + j, a2 = i * NV + ((j + 1) % NV);
    b.quad(a, a + NV, a2 + NV, a2);
  }
  // cap the tail root
  const tailC = b.vert(0, (top(0) - bot(0)) / 2, 0, tu(0), tv(0), 0);
  for (let j = 0; j < NV; j++) b.idx.push(tailC, (j + 1) % NV, j, tailC, j, (j + 1) % NV);

  // eyes: little domes on each side, mapped onto the painted eye
  const er = d.eye.r;
  for (const side of [1, -1]) {
    const ez = wid(d.eye.x) * 0.78 * side;
    const start = b.pos.length / 3;
    const NA = 10, NB = 6;
    for (let j = 0; j <= NB; j++) for (let i = 0; i <= NA; i++) {
      const th = (i / NA) * Math.PI * 2, ph = (j / NB) * Math.PI * 0.5;
      const rx = Math.cos(th) * Math.sin(ph) * er, ry = Math.sin(th) * Math.sin(ph) * er, rz = Math.cos(ph) * er * 0.7;
      b.vert(d.eye.x + rx, d.eye.y + ry, ez + rz * side, tu(EYE_SLOT.x + (rx / er) * EYE_SLOT.r), tv(EYE_SLOT.y + (ry / er) * EYE_SLOT.r), 0);
    }
    for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) {
      const a = start + j * (NA + 1) + i;
      if (side > 0) b.quad(a, a + 1, a + NA + 2, a + NA + 1); else b.quad(a, a + NA + 1, a + NA + 2, a + 1);
    }
  }

  // a puffer's spines: folded flat into the skin until it inflates
  if (d.spikes) {
    const R = mulberry(17);
    for (let n = 0; n < 150; n++) {
      const x = 0.12 + R() * 0.8, t = R() * Math.PI * 2;
      const [px, py, pz] = ring(x, t);
      const ny = Math.sin(t) * 1, nz = Math.cos(t) * 1;
      const len = 0.05 + R() * 0.04, w = 0.008;
      const base: [number, number, number] = [px, py, pz];
      const tip = b.vert(px - len * 0.3, py + ny * len, pz + nz * len, tu(0.5), tv(0.3), 3, 0, base);
      const s0 = b.vert(px - w, py, pz, tu(0.5), tv(0.1), 3, 0, base);
      const s1 = b.vert(px + w, py + nz * w * 0.3, pz - ny * w * 0.3, tu(0.5), tv(0.1), 3, 0, base);
      b.idx.push(tip, s0, s1, tip, s1, s0);
    }
  }
  return b.geometry();
}

export function finGeometry(d: SpeciesDef): BufferGeometry {
  const b = new Builder();
  const top = (x: number) => lerpProfile(d.top, Math.max(0, x)), bot = (x: number) => lerpProfile(d.bottom, Math.max(0, x)), wid = (x: number) => lerpProfile(d.width, x);
  sideGrid(b, -d.tail.len - 0.02, 0.08, () => -d.tail.span - 0.06, () => d.tail.span + 0.06, 8, 6, 1);
  sideGrid(b, d.dorsal.x0, d.dorsal.x1, (x) => top(x) * 0.75, (x) => top(x) * 0.75 + d.dorsal.h + 0.1, 10, 3, 1);
  sideGrid(b, d.anal.x0, d.anal.x1, (x) => -bot(x) * 0.75 - d.anal.h - 0.1, (x) => -bot(x) * 0.75, 8, 3, 1);
  // pectorals: angled back and out from just behind the gill, sampling the corner slot
  const { x, y, len } = d.pectoral;
  for (const side of [1, -1]) {
    const start = b.pos.length / 3;
    const NX = 4, NY = 2;
    const root = wid(x) * 0.9 * side;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const a = i / NX, h = (j / NY - 0.5);
      const px = x - a * len, py = y + h * len * 0.55 - a * len * 0.25, pz = root + side * a * len * 0.45;
      b.vert(px, py, pz, tu(PEC_SLOT.x1 - a * (PEC_SLOT.x1 - PEC_SLOT.x0)), tv(PEC_SLOT.y0 + (j / NY) * (PEC_SLOT.y1 - PEC_SLOT.y0)), 2, a);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = start + j * (NX + 1) + i;
      b.quad(a, a + 1, a + NX + 2, a + NX + 1);
    }
  }
  return b.geometry();
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One species' instanced meshes and the per-fish swim data. */
export class FishMesh {
  readonly body: InstancedMesh;
  readonly fins: InstancedMesh;
  readonly swim: InstancedBufferAttribute;
  readonly max: number;

  constructor(readonly def: SpeciesDef, max: number, scene: Scene, scales: Texture) {
    this.max = max;
    const skin = paintSkin((p) => def.paint.call(def, p), { iris: def.iris });
    const bodyGeo = bodyGeometry(def), finGeo = finGeometry(def);
    this.swim = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.swim.setUsage(DynamicDrawUsage);
    bodyGeo.setAttribute('aSwim', this.swim);
    finGeo.setAttribute('aSwim', this.swim);

    const normalMap = scales.clone();
    normalMap.repeat.set(def.look.scaleRepeat[0], def.look.scaleRepeat[1]);
    normalMap.needsUpdate = true;
    const bodyMat = underwater(new MeshPhysicalMaterial({
      map: skin, normalMap, normalScale: new Vector2(def.look.scaleStrength, def.look.scaleStrength),
      roughness: def.look.rough, metalness: 0, clearcoat: def.look.clearcoat * 0.5, clearcoatRoughness: 0.45,
      iridescence: def.look.iridescence ?? 0, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 500],
    }), `fish-${def.id}`, swimPatch(def.swim.waveK, true));
    this.body = new InstancedMesh(bodyGeo, bodyMat, max);
    this.body.customDepthMaterial = underwater(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), `fish-depth-${def.id}`, swimPatch(def.swim.waveK, false));
    this.body.castShadow = true;
    this.body.receiveShadow = true;

    const finMat = underwater(new MeshStandardMaterial({
      map: skin, roughness: 0.55, metalness: 0, side: DoubleSide, transparent: true, depthWrite: false,
      emissiveMap: skin, emissive: new Color(1, 1, 1).multiplyScalar(def.look.finGlow ?? 0.25),   // light glowing through the thin fin
    }), `fins-${def.id}`, swimPatch(def.swim.waveK, false));
    this.fins = new InstancedMesh(finGeo, finMat, max);
    this.fins.instanceMatrix = this.body.instanceMatrix;
    this.body.instanceMatrix.setUsage(DynamicDrawUsage);
    for (const m of [this.body, this.fins]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
  }

  set(i: number, matrix: Matrix4, phase: number, amp: number, bend: number, puff: number): void {
    this.body.setMatrixAt(i, matrix);
    const a = this.swim.array as Float32Array;
    a[i * 4] = phase; a[i * 4 + 1] = amp; a[i * 4 + 2] = bend; a[i * 4 + 3] = puff;
  }

  commit(count: number): void {
    this.body.count = this.fins.count = count;
    this.body.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
  }
}
