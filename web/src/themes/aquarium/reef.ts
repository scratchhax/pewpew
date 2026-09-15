import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide,
  Group, IcosahedronGeometry, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, PointLight,
  Quaternion, Raycaster, RepeatWrapping, SRGBColorSpace, type Scene, SphereGeometry, Sprite, SpriteMaterial, Vector2, Vector3, type Texture,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, noise3, rng } from './noise';
import { swayPatch, underwater } from './water';

/**
 * The reef: rippled sand that rises into the murk at the back, live rock
 * crusted with coralline algae, branching and brain and table coral, sea fans
 * and tube sponges, an anemone with its clownfish, seagrass and a stand of
 * kelp that sway with the current, an air stone, and a treasure chest that
 * opens for Wi-Fi joins. Everything is built from code at load.
 */

interface Blob { x: number; z: number; rx: number; rz: number; h: number; seed: number; }
const ROCKS: Blob[] = [
  { x: -40, z: -36, rx: 22, rz: 12, h: 17, seed: 1 },
  { x: 16, z: -46, rx: 26, rz: 12, h: 21, seed: 2 },
  { x: -20, z: -12, rx: 9, rz: 6.5, h: 6.5, seed: 3 },
  { x: 40, z: -18, rx: 12, rz: 8, h: 10, seed: 4 },
  { x: -6, z: -78, rx: 55, rz: 14, h: 28, seed: 5 },
  { x: -50, z: 4, rx: 5, rz: 4, h: 4, seed: 6 },
  { x: 64, z: -56, rx: 18, rz: 10, h: 16, seed: 7 },
  { x: -72, z: -60, rx: 16, rz: 10, h: 14, seed: 8 },
];

export function sandY(x: number, z: number): number {
  const dunes = Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.06) * 0.8 + Math.sin(x * 0.11 + z * 0.07) * 0.45 + noise3(x * 0.05, 0, z * 0.05, 9) * 1.2;
  const back = Math.max(0, -40 - z) * 0.12 + Math.max(0, -90 - z) * 0.3;
  const sides = Math.max(0, Math.abs(x) - 70) * 0.15;
  return dunes + back + sides;
}

const tmpM = new Matrix4(), tmpQ = new Quaternion(), tmpV = new Vector3(), tmpS = new Vector3();
const Y = new Vector3(0, 1, 0);

function colorAttr(geo: BufferGeometry, fn: (p: Vector3, i: number) => Color): void {
  const pos = geo.attributes.position as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const c = fn(p, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
}

// ── textures ──
function sandTextures(): { map: Texture; normal: Texture } {
  const N = 512;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#cdb98f'; g.fillRect(0, 0, N, N);
  const img = g.getImageData(0, 0, N, N);
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = (i / N) | 0;
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    const n = (Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * Math.cos(v * 4 + Math.sin(u * 5)) ) * 14 + (Math.random() - 0.5) * 36;
    img.data[i * 4] += n; img.data[i * 4 + 1] += n * 0.95; img.data[i * 4 + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  const R = rng(4);
  for (let i = 0; i < 260; i++) {
    const shade = 150 + R() * 100;
    g.fillStyle = `rgba(${shade + 30},${shade + 15},${shade},${0.5 + R() * 0.5})`;
    g.beginPath(); g.ellipse(R() * N, R() * N, 1 + R() * 3, 0.8 + R() * 2, R() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${90 + R() * 40},${80 + R() * 30},${60 + R() * 20},0.6)`;
    g.beginPath(); g.arc(R() * N, R() * N, 1 + R() * 2.5, 0, Math.PI * 2); g.fill();
  }
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 8;

  // ripple normals
  const nc = document.createElement('canvas'); nc.width = nc.height = N;
  const ng = nc.getContext('2d')!;
  const nimg = ng.createImageData(N, N);
  // integer frequencies only, so the ripples tile without a seam
  const T = Math.PI * 2;
  const h = (x: number, y: number) => { const u = x / N, v = y / N; return Math.sin(T * (5 * u + v) + 1.3 * Math.sin(T * (2 * v - u))) + 0.3 * Math.sin(T * (13 * u + 7 * v) + Math.sin(T * 3 * v)); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h((x + 1) % N, y) - h((x + N - 1) % N, y), dy = h(x, (y + 1) % N) - h(x, (y + N - 1) % N);
    const nx = -dx * 1.2, ny = -dy * 1.2, len = Math.hypot(nx, ny, 1);
    const i = (y * N + x) * 4;
    nimg.data[i] = (nx / len * 0.5 + 0.5) * 255; nimg.data[i + 1] = (ny / len * 0.5 + 0.5) * 255; nimg.data[i + 2] = (1 / len) * 255; nimg.data[i + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  const normal = new CanvasTexture(nc);
  normal.wrapS = normal.wrapT = RepeatWrapping;
  return { map, normal };
}

function fanTexture(seed: number, a: string, b: string): Texture {
  const W = 512, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const R = rng(seed);
  g.lineCap = 'round';
  const twigs: Array<[number, number]> = [];
  const grow = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.strokeStyle = depth > 5 ? a : b; g.lineWidth = Math.max(0.8, w);
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + x2) / 2 + (R() - 0.5) * len * 0.25, (y + y2) / 2, x2, y2); g.stroke();
    twigs.push([x2, y2]);
    if (depth <= 0 || y2 < 8 || x2 < 8 || x2 > W - 8) return;
    const spread = 0.18 + R() * 0.25;
    grow(x2, y2, ang - spread, len * (0.8 + R() * 0.12), w * 0.78, depth - 1);
    grow(x2, y2, ang + spread, len * (0.8 + R() * 0.12), w * 0.78, depth - 1);
  };
  grow(W / 2, H, -Math.PI / 2, 48, 8, 9);
  // fine cross-links between nearby twigs make the fan's mesh
  g.strokeStyle = b; g.lineWidth = 0.7; g.globalAlpha = 0.8;
  for (let i = 0; i < 2600; i++) {
    const p = twigs[Math.floor(R() * twigs.length)], q = twigs[Math.floor(R() * twigs.length)];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > 4 && d < 22) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
  }
  g.globalAlpha = 1;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function woodTexture(): Texture {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const planks = 5;
  const img = g.createImageData(W, H);
  const tone = Array.from({ length: planks }, () => 70 + Math.random() * 20);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = Math.floor((y / H) * planks);
    const n = noise3(x * 0.01, y * 0.25, p, 40) * 0.5 + noise3(x * 0.1, y * 0.6, p, 41) * 0.2;
    const seam = (y % (H / planks)) < 3 ? 0.2 : 1;
    const v = (tone[p] + n * 50) * seam;
    const i = (y * W + x) * 4;
    img.data[i] = v * 0.9; img.data[i + 1] = v * 0.62; img.data[i + 2] = v * 0.38; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // algae bloom and wear
  const R = rng(9);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${60 + R() * 30},${90 + R() * 40},${50},${0.15 + R() * 0.2})`; g.beginPath(); g.arc(R() * W, R() * H, 4 + R() * 22, 0, Math.PI * 2); g.fill(); }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ── builders ──
/** Push each vertex in or out along its radius by a little noise. */
function lump(geo: BufferGeometry, seed: number, amount: number): void {
  const pos = geo.attributes.position as BufferAttribute;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const k = 1 + noise3(p.x * 3, p.y * 1.5, p.z * 3, seed) * amount;
    pos.setXYZ(i, p.x * k, p.y, p.z * k);
  }
  geo.computeVertexNormals();
}

/** A kelp plant: a slender stipe with blades hanging off it all the way up. */
function kelpPlant(seed: number, height: number): BufferGeometry {
  const R = rng(seed);
  const parts: BufferGeometry[] = [];
  const lean = (y: number) => new Vector3(Math.sin(y * 0.05 + seed) * 1.5, y, Math.cos(y * 0.04 + seed) * 1.2);
  const stipe = new PlaneGeometry(0.16, height, 1, 24);
  stipe.translate(0, height / 2, 0);
  const sp = stipe.attributes.position as BufferAttribute;
  for (let i = 0; i < sp.count; i++) { const c = lean(sp.getY(i)); sp.setXYZ(i, sp.getX(i) + c.x, sp.getY(i), c.z); }
  const stipe2 = stipe.clone().rotateY(Math.PI / 2);
  for (const g of [stipe, stipe2]) { colorAttr(g, () => new Color(0x4a3e18)); g.deleteAttribute('uv'); g.computeVertexNormals(); parts.push(g); }
  for (let y = 2 + R() * 2; y < height - 1; y += 1.1 + R() * 0.9) {
    const len = 2.6 + R() * 1.6, w = 0.5 + R() * 0.3;
    const leaf = new PlaneGeometry(w, len, 2, 8);
    leaf.translate(0, len / 2, 0);
    const lp = leaf.attributes.position as BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const v = lp.getY(i) / len;
      // wide in the middle, ruffled at the edges, drooping at the tip
      lp.setX(i, lp.getX(i) * Math.sin(Math.PI * Math.min(1, v * 1.1 + 0.05)) * (1 + Math.sin(v * 22) * 0.08));
      lp.setZ(i, v * v * len * 0.35 + Math.sin(lp.getX(i) * 9 + v * 10) * 0.04);
    }
    const c = lean(y);
    leaf.rotateX(-0.35 - R() * 0.4);
    leaf.rotateY(R() * Math.PI * 2);
    leaf.translate(c.x, y, c.z);
    const tone = new Color(0x6d6420).lerp(new Color(0xa89838), R());
    colorAttr(leaf, (p) => tone.clone().multiplyScalar(0.7 + Math.min(0.3, Math.abs(p.y - y) / len * 0.3)));
    leaf.deleteAttribute('uv');
    leaf.computeVertexNormals();
    parts.push(leaf);
  }
  return mergeGeometries(parts)!;
}
function rockGeometry(b: Blob): BufferGeometry {
  let geo: BufferGeometry = new IcosahedronGeometry(1, 36);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position as BufferAttribute;
  const p = new Vector3();
  const R = rng(b.seed * 31);
  const ox = R() * 100, oz = R() * 100;
  const cols = new Float32Array(pos.count * 3);
  const rockA = new Color(0x958b78), rockB = new Color(0x4a443c), pink = new Color(0xb07a92), purple = new Color(0x7a6488), green = new Color(0x6b7f45), cream = new Color(0xd0c4a8);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const n1 = fbm(p.x * 1.5 + ox, p.y * 1.5, p.z * 1.5 + oz, 5, b.seed);
    const n2 = fbm(p.x * 5 + ox, p.y * 5, p.z * 5 + oz, 3, b.seed + 50);
    const n3 = fbm(p.x * 14 + ox, p.y * 14, p.z * 14 + oz, 2, b.seed + 80);
    // pocked limestone: ridged detail cuts pits into the surface
    const pits = Math.max(0, 0.18 - Math.abs(n3)) * 0.35;
    const r = 1 + n1 * 0.55 + n2 * 0.14 + n3 * 0.035 - pits;
    const ledge = Math.round(p.y * 4) / 4;
    let y = p.y * r * 0.7 + (ledge - p.y) * 0.12;
    y = Math.max(y, -0.15);
    pos.setXYZ(i, p.x * r * b.rx, (y + 0.12) * b.h, p.z * r * b.rz);
    // coralline crust on exposed tops, algae on the flats, dark in the holes
    const crust = fbm(p.x * 3 + 7, p.y * 3, p.z * 3, 3, b.seed + 99) + n3 * 0.25;
    tmp.copy(rockB).lerp(rockA, Math.min(1, Math.max(0, 0.5 + n2 * 2.5)));
    if (crust > 0.1) tmp.lerp(crust > 0.24 ? pink : purple, Math.min(1, (crust - 0.1) * 4) * 0.55);
    if (p.y > 0.45 && n1 > -0.05) tmp.lerp(green, Math.min(0.6, (p.y - 0.45) * 2));
    if (n2 > 0.28) tmp.lerp(cream, 0.4);
    tmp.multiplyScalar((0.6 + Math.min(0.4, Math.max(0, (r - 0.7) * 0.9))) * (1 - pits * 2.2));
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  return geo;
}

function staghorn(seed: number, base: Color, tip: Color, scale: number): BufferGeometry {
  const R = rng(seed);
  const parts: BufferGeometry[] = [];
  const branch = (start: Vector3, dir: Vector3, len: number, rad: number, depth: number) => {
    const cyl = new CylinderGeometry(rad * 0.72, rad, len, 7, 2);
    cyl.translate(0, len / 2, 0);
    tmpQ.setFromUnitVectors(Y, dir);
    cyl.applyMatrix4(tmpM.compose(start, tmpQ, tmpS.set(1, 1, 1)));
    const end = start.clone().addScaledVector(dir, len);
    const k = 1 - depth / 5;
    colorAttr(cyl, (p) => {
      const t = Math.min(1, Math.max(0, (p.distanceTo(start) / len) * 0.25 + k));
      return base.clone().lerp(tip, depth === 0 ? 0.6 + t * 0.4 : t * 0.6);
    });
    cyl.deleteAttribute('uv');
    parts.push(cyl);
    if (depth === 0) {
      const cap = new SphereGeometry(rad * 0.72, 7, 5);
      cap.translate(end.x, end.y, end.z);
      colorAttr(cap, () => tip);
      cap.deleteAttribute('uv');
      parts.push(cap);
      return;
    }
    const kids = depth > 3 ? 3 : 1 + (R() < 0.7 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const d = dir.clone().add(new Vector3((R() - 0.5) * 1.1, 0.35 + R() * 0.4, (R() - 0.5) * 1.1)).normalize();
      branch(end, d, len * (0.72 + R() * 0.2), rad * 0.78, depth - 1);
    }
  };
  for (let t = 0; t < 4; t++) {
    const d = new Vector3((R() - 0.5) * 1.4, 1, (R() - 0.5) * 1.4).normalize();
    branch(new Vector3((R() - 0.5) * 0.6, 0, (R() - 0.5) * 0.6).multiplyScalar(scale), d, 1.3 * scale, 0.28 * scale, 5);
  }
  return mergeGeometries(parts)!;
}

function brainCoral(seed: number): BufferGeometry {
  const geo = new SphereGeometry(1, 160, 80, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const pos = geo.attributes.position as BufferAttribute;
  const p = new Vector3();
  const cols = new Float32Array(pos.count * 3);
  const ridge = new Color(0xc9b877), groove = new Color(0x5d6a3a);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const w = fbm(p.x * 1.8, p.y * 1.8, p.z * 1.8, 3, seed);
    const maze = Math.abs(Math.sin((p.x * 7 + w * 9) + Math.sin(p.z * 6 + w * 7) * 1.4) * Math.cos(p.z * 7 - w * 8 + Math.sin(p.x * 5) * 1.2));
    const g = Math.pow(1 - maze, 3);
    const r = 1 - g * 0.05;
    pos.setXYZ(i, p.x * r, (p.y * r - 0.1) * 0.75, p.z * r);
    tmp.copy(ridge).lerp(groove, g);
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new BufferAttribute(cols, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

function tubeSponge(seed: number, color: Color): BufferGeometry {
  const R = rng(seed);
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3 + Math.floor(R() * 3); i++) {
    const h = 3 + R() * 6, r = 0.5 + R() * 0.35;
    const prof = [new Vector2(r * 0.9, 0), new Vector2(r, h * 0.5), new Vector2(r * 1.15, h), new Vector2(r * 0.95, h + 0.05), new Vector2(r * 0.8, h - 0.4), new Vector2(r * 0.7, h * 0.3)];
    const lathe = new LatheGeometry(prof, 24);
    lump(lathe, seed + i, 0.08);
    const tilt = new Vector3((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize();
    tmpQ.setFromUnitVectors(Y, tilt);
    lathe.applyMatrix4(tmpM.compose(tmpV.set((R() - 0.5) * 2, 0, (R() - 0.5) * 2), tmpQ, tmpS.set(1, 1, 1)));
    colorAttr(lathe, (p) => color.clone().multiplyScalar(0.55 + Math.min(0.45, p.y / h * 0.5) + (R() - 0.5) * 0.05));
    lathe.deleteAttribute('uv');
    parts.push(lathe);
  }
  return mergeGeometries(parts)!;
}

function tableCoral(): BufferGeometry {
  const prof = [new Vector2(0.01, 0), new Vector2(0.6, 0), new Vector2(0.45, 1.2), new Vector2(0.5, 1.7), new Vector2(2.5, 2.1), new Vector2(4.4, 2.4), new Vector2(4.6, 2.55), new Vector2(4.2, 2.62), new Vector2(2, 2.5), new Vector2(0.01, 2.3)];
  const geo = new LatheGeometry(prof, 48);
  const pos = geo.attributes.position as BufferAttribute;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const rr = Math.hypot(p.x, p.z);
    if (rr > 1.5) pos.setY(i, p.y + noise3(p.x * 0.5, 0, p.z * 0.5, 71) * 0.35 + Math.sin(Math.atan2(p.z, p.x) * 5) * rr * 0.03);
  }
  colorAttr(geo, (q) => new Color(0x8a9a6a).lerp(new Color(0xd7c9a0), Math.min(1, Math.hypot(q.x, q.z) / 4.6)));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

export class Reef {
  readonly group = new Group();
  readonly rocks: Mesh[] = [];
  readonly anemone = new Vector3();
  readonly bubbler = new Vector3();
  readonly chestMouth = new Vector3();
  private chestLid = new Group();
  private chestLight!: PointLight;
  private chestGlow!: Sprite;
  private lidAngle = 0;
  private lidTarget = 0;
  private lidSpeed = 1.5;
  private closeAt = 0;
  private swayMats: MeshStandardMaterial[] = [];

  constructor(scene: Scene) {
    scene.add(this.group);
    this.buildSand();
    this.buildRocks();
    this.buildCorals();
    this.buildPlants();
    this.buildChest();
  }

  ground(x: number, z: number): number {
    let y = sandY(x, z);
    for (const b of ROCKS) {
      const d2 = ((x - b.x) / b.rx) ** 2 + ((z - b.z) / b.rz) ** 2;
      if (d2 < 1.2) y = Math.max(y, b.h * 0.9 * Math.pow(Math.max(0, 1 - d2 / 1.2), 0.6));
    }
    return y;
  }

  private buildSand(): void {
    const geo = new PlaneGeometry(460, 300, 230, 150);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -70);
    const pos = geo.attributes.position as BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, sandY(pos.getX(i), pos.getZ(i)));
    colorAttr(geo, (p) => new Color(1, 1, 1).multiplyScalar(0.8 + noise3(p.x * 0.03, 0, p.z * 0.03, 5) * 0.25 - Math.max(0, -p.z - 60) * 0.001));
    geo.computeVertexNormals();
    const uv = geo.attributes.uv as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 14, pos.getZ(i) / 14);
    const { map, normal } = sandTextures();
    const mat = underwater(new MeshStandardMaterial({ map, normalMap: normal, normalScale: new Vector2(0.6, 0.6), roughness: 1, metalness: 0, vertexColors: true }), 'sand');
    const m = new Mesh(geo, mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildRocks(): void {
    const mat = underwater(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 'rock', { detail: { scale: 1.6, bump: 0.35, mottle: 0.22 } });
    for (const b of ROCKS) {
      const m = new Mesh(rockGeometry(b), mat);
      m.position.set(b.x, sandY(b.x, b.z) - b.h * 0.12, b.z);
      m.rotation.y = b.seed * 1.7;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.rocks.push(m);
    }
    for (const r of this.rocks) r.updateMatrixWorld(true);
  }

  private ray = new Raycaster();
  /** The top of the reef (rock or sand) at x, z. */
  surfaceAt(x: number, z: number): Vector3 {
    this.ray.set(tmpV.set(x, 200, z), new Vector3(0, -1, 0));
    const under = this.rocks.filter((_, i) => ((x - ROCKS[i].x) / (ROCKS[i].rx * 1.6)) ** 2 + ((z - ROCKS[i].z) / (ROCKS[i].rz * 1.6)) ** 2 < 1);
    const hit = this.ray.intersectObjects(under, false)[0];
    const y = Math.max(hit ? hit.point.y : -1e9, sandY(x, z));
    return new Vector3(x, y, z);
  }

  private place(geo: BufferGeometry, mat: MeshStandardMaterial, x: number, z: number, scale: number, rotY = Math.random() * 6.28, sink = 0.2): Mesh {
    const m = new Mesh(geo, mat);
    m.position.copy(this.surfaceAt(x, z)).y -= sink * scale;
    m.scale.setScalar(scale);
    m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildCorals(): void {
    const coral = underwater(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }), 'coral');
    const stag = [
      staghorn(11, new Color(0x7a5a86), new Color(0xc8a8ff), 1.6),
      staghorn(12, new Color(0x6e7a50), new Color(0xd8f0a0), 1.4),
      staghorn(13, new Color(0x8a5a40), new Color(0xffc090), 1.5),
      staghorn(14, new Color(0x4a6f8a), new Color(0x9fe8ff), 1.3),
    ];
    const spots: Array<[number, number, number, number]> = [[-44, -34, 0, 1.2], [-32, -38, 1, 1], [8, -44, 2, 1.3], [26, -48, 3, 1.1], [40, -18, 0, 0.8], [-8, -50, 1, 1.4], [60, -52, 2, 1], [-66, -58, 3, 1.2], [18, -40, 0, 0.9]];
    for (const [x, z, k, s] of spots) this.place(stag[k], coral, x, z, s);

    const brain = brainCoral(21);
    this.place(brain, coral, 44, -14, 3.4, 0, 0.1);
    this.place(brain, coral, 6, -6, 2.6, 1, 0.3);
    this.place(brain, coral, -48, -28, 3, 2, 0.1);

    const table = tableCoral();
    this.place(table, coral, 20, -50, 1.3, 0, 0);
    this.place(table, coral, -36, -40, 1, 0, 0);

    for (const [x, z, c, seed] of [[34, -24, 0xe07a2a, 31], [-54, -30, 0x9a4ad0, 32], [52, -44, 0xe0c040, 33], [-12, -46, 0xd05a3a, 34]] as Array<[number, number, number, number]>) {
      this.place(tubeSponge(seed, new Color(c)), coral, x, z, 1, Math.random() * 6, 0.3);
    }

    // sea fans stand across the current at the back of the rocks
    const fanGeo = new PlaneGeometry(1, 1, 6, 10);
    fanGeo.translate(0, 0.5, 0);
    for (const [x, z, s, seed, a, b] of [[-40, -44, 14, 41, '#8a2a6a', '#c0508a'], [22, -54, 17, 42, '#7a2040', '#d05a70'], [58, -26, 9, 43, '#6a3a9a', '#a070d0'], [-14, -56, 12, 44, '#a04a20', '#e08040']] as Array<[number, number, number, number, string, string]>) {
      const mat = underwater(new MeshStandardMaterial({ map: fanTexture(seed, a, b), alphaTest: 0.4, side: DoubleSide, roughness: 0.8 }), `fan-${seed}`, swayPatch(1, 0.5 / s, 0.7));
      this.swayMats.push(mat);
      const m = new Mesh(fanGeo, mat);
      m.position.copy(this.surfaceAt(x, z)).y -= 0.4;
      m.scale.set(s, s, 1);
      m.rotation.y = (Math.random() - 0.5) * 0.6;
      m.castShadow = true;
      this.group.add(m);
    }

    // the anemone on the low rock, with tentacles that sway
    const at = this.surfaceAt(-20, -12);
    this.anemone.copy(at).y += 1;
    const column = new CylinderGeometry(1.5, 1.8, 1.3, 20, 1);
    column.translate(0, 0.4, 0);
    const colMesh = new Mesh(column, underwater(new MeshStandardMaterial({ color: 0x9a5070, roughness: 0.6 }), 'anemone-col'));
    colMesh.position.copy(at);
    this.group.add(colMesh);
    const tent = new CylinderGeometry(0.04, 0.11, 1, 6, 8);
    tent.translate(0, 0.5, 0);
    colorAttr(tent, (p) => new Color(0x9a3a6a).lerp(new Color(0xffd0ea), Math.pow(Math.max(0, p.y), 1.5)));
    const tentMat = underwater(new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, emissive: 0x2a0a1a }), 'anemone', swayPatch(1, 0.35, 1.3));
    const n = 280;
    const tentacles = new InstancedMesh(tent, tentMat, n);
    const o = new Object3D();
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 1.7, a = Math.random() * Math.PI * 2;
      o.position.set(at.x + Math.cos(a) * r, at.y + 1, at.z + Math.sin(a) * r);
      const out = new Vector3(Math.cos(a) * (0.2 + r * 0.45), 1, Math.sin(a) * (0.2 + r * 0.45)).normalize();
      o.quaternion.setFromUnitVectors(Y, out);
      o.scale.set(1, 1.4 + Math.random() * 1.2, 1);
      o.updateMatrix();
      tentacles.setMatrixAt(i, o.matrix);
    }
    tentacles.castShadow = true;
    this.group.add(tentacles);
    this.swayMats.push(tentMat);

    // zoanthid and button polyp colonies crusting the rock
    const polyp = mergeGeometries([
      (() => { const g = new CylinderGeometry(0.16, 0.12, 0.3, 8, 1, true); g.translate(0, 0.15, 0); colorAttr(g, () => new Color(0.45, 0.45, 0.45)); g.deleteAttribute('uv'); return g; })(),
      (() => { const g = new CylinderGeometry(0.3, 0.16, 0.05, 12, 1); g.translate(0, 0.32, 0); colorAttr(g, (p) => new Color(1, 1, 1).multiplyScalar(0.7 + Math.hypot(p.x, p.z) * 1.1)); g.deleteAttribute('uv'); return g; })(),
      (() => { const g = new SphereGeometry(0.07, 6, 4); g.translate(0, 0.36, 0); colorAttr(g, () => new Color(0.25, 0.2, 0.15)); g.deleteAttribute('uv'); return g; })(),
    ])!;
    const polypMat = underwater(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x081208 }), 'polyp');
    const palette = [0x5ad88a, 0xd8883a, 0x48b8a8, 0xd06a90, 0xa8d04a, 0x8a78d0, 0xd8b84a];
    const maxPolyps = 1400;
    const polyps = new InstancedMesh(polyp, polypMat, maxPolyps);
    const po = new Object3D(), pc = new Color(), nrm = new Vector3(), wp = new Vector3();
    let np = 0;
    const R = rng(77);
    for (const rock of this.rocks.slice(0, 4).concat(this.rocks.slice(5, 8))) {
      const pos = rock.geometry.attributes.position as BufferAttribute, nor = rock.geometry.attributes.normal as BufferAttribute;
      for (let c = 0; c < 7 && np < maxPolyps; c++) {
        // pick a colony centre on an upward face, then fill in around it
        let seedI = -1;
        for (let t = 0; t < 40 && seedI < 0; t++) { const i = Math.floor(R() * pos.count); nrm.fromBufferAttribute(nor, i).applyQuaternion(rock.quaternion); if (nrm.y > 0.55) seedI = i; }
        if (seedI < 0) continue;
        const center = new Vector3().fromBufferAttribute(pos, seedI).applyMatrix4(rock.matrixWorld);
        const color = palette[Math.floor(R() * palette.length)];
        const size = 0.3 + R() * 0.3;
        for (let t = 0; t < 900 && np < maxPolyps; t += 1) {
          const i = Math.floor(R() * pos.count);
          wp.fromBufferAttribute(pos, i).applyMatrix4(rock.matrixWorld);
          if (wp.distanceToSquared(center) > 2.2) continue;
          nrm.fromBufferAttribute(nor, i).applyQuaternion(rock.quaternion);
          if (nrm.y < 0.2) continue;
          po.position.copy(wp);
          po.quaternion.setFromUnitVectors(Y, nrm);
          po.scale.setScalar(size * (0.7 + R() * 0.5));
          po.updateMatrix();
          polyps.setMatrixAt(np, po.matrix);
          polyps.setColorAt(np, pc.setHex(color).multiplyScalar(0.75 + R() * 0.35));
          np++;
          if (R() < 0.02) break;
        }
      }
    }
    polyps.count = np;
    this.group.add(polyps);

    // the air stone
    this.bubbler.copy(this.surfaceAt(-4, 12));
    const stone = new Mesh(new SphereGeometry(1, 16, 10), underwater(new MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1 }), 'stone'));
    stone.scale.set(1.2, 0.5, 1.2);
    stone.position.copy(this.bubbler);
    this.group.add(stone);
    this.bubbler.y += 0.5;
  }

  private buildPlants(): void {
    // seagrass: tapered blades in clumps on the sand
    const blade = new PlaneGeometry(0.35, 1, 1, 10);
    blade.translate(0, 0.5, 0);
    const bp = blade.attributes.position as BufferAttribute;
    for (let i = 0; i < bp.count; i++) { const y = bp.getY(i); bp.setX(i, bp.getX(i) * (1 - y * 0.85)); bp.setZ(i, y * y * 0.15); }
    blade.computeVertexNormals();
    colorAttr(blade, (p) => new Color(0x2e4a1c).lerp(new Color(0x9ac860), p.y));
    const grassMat = underwater(new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.7 }), 'grass', swayPatch(1, 0.7, 0.9));
    this.swayMats.push(grassMat);
    const clumps: Array<[number, number, number]> = [[-12, 8, 40], [14, 10, 30], [-40, -6, 36], [50, 0, 30], [-58, -16, 40], [30, -6, 24], [2, -26, 30], [-26, 12, 24], [64, -8, 30]];
    const total = clumps.reduce((s, c) => s + c[2], 0);
    const grass = new InstancedMesh(blade, grassMat, total);
    const o = new Object3D();
    const col = new Color();
    let k = 0;
    for (const [cx, cz, n] of clumps) {
      for (let i = 0; i < n; i++, k++) {
        const r = Math.sqrt(Math.random()) * 3.2, a = Math.random() * Math.PI * 2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        o.position.set(x, sandY(x, z) - 0.1, z);
        o.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
        o.scale.set(0.8 + Math.random() * 0.6, 1.5 + Math.random() * 4 * (1 - r / 4), 1);
        o.updateMatrix();
        grass.setMatrixAt(k, o.matrix);
        grass.setColorAt(k, col.setHSL(0.24 + Math.random() * 0.06, 0.5, 0.45 + Math.random() * 0.2));
      }
    }
    grass.castShadow = true;
    this.group.add(grass);

    // a stand of kelp in the far murk on both sides
    const kelpMat = underwater(new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.65, emissive: 0x0c0a02 }), 'kelp', swayPatch(45, 3.2, 0.45));
    this.swayMats.push(kelpMat);
    for (let v = 0; v < 5; v++) {
      const n = 12;
      const kelp = new InstancedMesh(kelpPlant(90 + v, 30 + v * 5), kelpMat, n);
      for (let i = 0; i < n; i++) {
        const side = (i + v) % 2 ? 1 : -1;
        const x = side * (44 + Math.random() * 46), z = -36 - Math.random() * 56;
        o.position.set(x, sandY(x, z) - 0.2, z);
        o.rotation.set(0, Math.random() * Math.PI * 2, 0);
        o.scale.setScalar(0.85 + Math.random() * 0.3);
        o.updateMatrix();
        kelp.setMatrixAt(i, o.matrix);
      }
      kelp.castShadow = true;
      this.group.add(kelp);
    }
  }

  private buildChest(): void {
    const chest = new Group();
    const at = this.surfaceAt(24, 2);
    chest.position.copy(at).y -= 0.6;
    chest.rotation.set(0.05, -0.45, 0.04);
    const wood = woodTexture();
    const woodMat = underwater(new MeshStandardMaterial({ map: wood, roughness: 0.9 }), 'wood');
    const brass = underwater(new MeshStandardMaterial({ color: 0x9a7a3a, roughness: 0.45, metalness: 0.85 }), 'brass');
    const w = 6, h = 3, d = 3.8;
    const base = new Mesh(new BoxGeometry(w, h, d), woodMat);
    base.position.y = h / 2;
    chest.add(base);
    for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) {
      const band = new Mesh(new BoxGeometry(0.35, h + 0.05, d + 0.08), brass);
      band.position.set(x, h / 2, 0);
      chest.add(band);
    }
    const lock = new Mesh(new BoxGeometry(0.8, 0.9, 0.2), brass);
    lock.position.set(0, h - 0.5, d / 2 + 0.1);
    chest.add(lock);
    // gold heaped inside
    const coinGeo = new CylinderGeometry(0.28, 0.28, 0.06, 12);
    const gold = underwater(new MeshStandardMaterial({ color: 0xffc34a, roughness: 0.25, metalness: 1, emissive: 0x3a2400 }), 'gold');
    const coins = new InstancedMesh(coinGeo, gold, 120);
    const o = new Object3D();
    for (let i = 0; i < 120; i++) {
      const x = (Math.random() - 0.5) * (w - 0.8), z = (Math.random() - 0.5) * (d - 0.8);
      o.position.set(x, h - 0.35 + (1 - Math.abs(x) / w - Math.abs(z) / d) * 0.6 + Math.random() * 0.15, z);
      o.rotation.set((Math.random() - 0.5) * 1.2, Math.random() * 6, (Math.random() - 0.5) * 1.2);
      o.updateMatrix();
      coins.setMatrixAt(i, o.matrix);
    }
    chest.add(coins);
    // the lid hinges at the back edge
    const lidGeo = new CylinderGeometry(d / 2, d / 2, w, 24, 1, false, 0, Math.PI);
    lidGeo.rotateZ(Math.PI / 2);
    lidGeo.translate(0, 0, d / 2);
    const lid = new Mesh(lidGeo, woodMat);
    lid.scale.set(1, 0.55, 1);
    this.chestLid.add(lid);
    // the lid's underside, seen when it opens
    const board = new Mesh(new BoxGeometry(w, 0.12, d), woodMat);
    board.position.set(0, 0.06, d / 2);
    this.chestLid.add(board);
    for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) {
      const band = new Mesh(new CylinderGeometry(d / 2 + 0.05, d / 2 + 0.05, 0.35, 24, 1, true, 0, Math.PI), brass);
      band.geometry.rotateZ(Math.PI / 2); band.geometry.translate(0, 0, d / 2);
      band.scale.set(1, 0.55, 1);
      band.position.x = x;
      this.chestLid.add(band);
    }
    this.chestLid.position.set(0, h, -d / 2);
    chest.add(this.chestLid);
    chest.traverse((m) => { if ((m as Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });

    this.chestLight = new PointLight(0xffb848, 0, 30, 1.6);
    this.chestLight.position.set(0, h + 1, 0);
    chest.add(this.chestLight);
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,220,140,1)'); gr.addColorStop(0.35, 'rgba(255,190,90,0.35)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return new CanvasTexture(c);
    })();
    this.chestGlow = new Sprite(new SpriteMaterial({ map: glowTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.chestGlow.scale.set(9, 6, 1);
    this.chestGlow.position.set(0, h + 0.8, 0);
    chest.add(this.chestGlow);
    this.group.add(chest);
    chest.updateMatrixWorld(true);
    this.chestMouth.set(0, h + 0.4, 0).applyMatrix4(chest.matrixWorld);
  }

  /** Wi-Fi: a join opens the chest (and closes it again later); a failure slams it. */
  chest(joined: boolean, now: number): void {
    if (joined) {
      this.lidTarget = -1.55; this.lidSpeed = 1.4; this.closeAt = now + 4500;
    } else {
      // pop the lid a little, then slam it shut
      this.lidTarget = -0.5; this.lidSpeed = 3; this.closeAt = now + 450;
    }
  }
  get lidOpen(): number { return Math.min(1, -this.lidAngle / 1.4); }
  get slamming(): boolean { return this.lidTarget === 0 && this.lidSpeed > 3; }

  update(dt: number, now: number): void {
    if (this.closeAt && now > this.closeAt) {
      this.lidTarget = 0;
      this.lidSpeed = this.lidAngle > -0.8 && this.lidSpeed >= 3 ? 7 : 1.1;
      this.closeAt = 0;
    }
    this.lidAngle += (this.lidTarget - this.lidAngle) * Math.min(1, dt * this.lidSpeed);
    this.chestLid.rotation.x = this.lidAngle;
    const glow = this.lidOpen;
    this.chestLight.intensity = glow * 60;
    (this.chestGlow.material as SpriteMaterial).opacity = glow * 0.8;
  }
}
