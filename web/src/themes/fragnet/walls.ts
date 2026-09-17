import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PlaneGeometry, Sprite, SpriteMaterial, Texture, Vector3, type Scene,
} from 'three';
import { sprGlow, texBrick, texCeil, texFloor, texHell, texTech, tex, FR } from './art';
import { CS, WALL_H, type DoorCell, type Level } from './levelgen';

/**
 * The maze itself: wall blocks instanced per material (panels, brick, hell
 * rock), floor and ceiling flats, ceiling lamps whose light is baked into
 * per-instance wall colors and flickers a little, and blast doors that grind
 * open when the marine walks up to them - or seal red when the firewall says
 * no. Secrets are wall instances that simply collapse when revealed.
 */

interface DoorMesh { cell: DoorCell; mesh: Mesh; cur: number; jitter: number }

const EXPOSED = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Walls {
  private meshes: InstancedMesh[] = [];
  private geos: BufferGeometry[] = [];
  private mats: MeshBasicMaterial[] = [];
  private doorMeshes: DoorMesh[] = [];
  private lamps: Array<{ spr: Sprite; phase: number }> = [];
  private extras: Array<Sprite | Mesh> = [];
  private cellInst = new Map<number, { m: number; i: number }>();
  private baseColor = new Map<number, number>();
  private floorMat!: MeshBasicMaterial;
  private ceilMat!: MeshBasicMaterial;
  private level: Level | null = null;
  private tmp = new Matrix4();
  private col = new Color();

  /** Materials are built once; the level's geometry is rebuilt freely. */
  private texes: Record<string, Texture>;
  constructor() {
    this.texes = {
      tech: tex(texTech(), true), brick: tex(texBrick(), true), hell: tex(texHell(), true),
      floor: tex(texFloor(), true), ceil: tex(texCeil(), true),
    };
  }

  build(scene: Scene, level: Level): void {
    // tear down the last level
    for (const m of this.meshes) scene.remove(m);
    for (const g of this.geos) g.dispose();
    for (const d of this.doorMeshes) scene.remove(d.mesh);
    for (const l of this.lamps) scene.remove(l.spr);
    for (const e of this.extras) scene.remove(e);
    this.meshes = []; this.geos = []; this.doorMeshes = []; this.lamps = []; this.extras = [];
    this.cellInst.clear(); this.baseColor.clear();
    this.level = level;
    const { w, h, grid } = level;

    // collect exposed wall cells (any neighbour is walkable)
    const wall = (x: number, y: number): boolean => x < 0 || y < 0 || x >= w || y >= h || grid[y * w + x] === 0;
    const exposed = (x: number, y: number): boolean =>
      grid[y * w + x] === 0 && EXPOSED.some(([dx, dy]) => !wall(x + dx, y + dy));
    const kinds = [0, 0, 0]; // tech, brick, hell
    const cells: Array<[number, number, number]> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!exposed(x, y)) continue;
        const t = (x * 7349 + y * 9151) % 100;
        const kind = t < 46 ? 0 : t < 82 ? 1 : 2;
        kinds[kind]++;
        cells.push([x, y, kind]);
      }
    }

    const names = ['tech', 'brick', 'hell'] as const;
    const geo = new BoxGeometry(CS, WALL_H, CS);
    this.geos.push(geo);
    for (let k = 0; k < 3; k++) {
      const mat = new MeshBasicMaterial({ map: this.texes[names[k]] });
      this.mats.push(mat);
      const im = new InstancedMesh(geo, mat, Math.max(1, kinds[k]));
      im.instanceColor = null;
      im.frustumCulled = false;
      scene.add(im);
      this.meshes.push(im);
    }
    const fill = [0, 0, 0];
    const lampDist = (x: number, y: number): number => {
      let best = 999;
      for (const [lx, ly] of level.lamps) best = Math.min(best, Math.hypot(x - lx, y - ly));
      return best;
    };
    for (const [x, y, kind] of cells) {
      const i = fill[kind]++;
      this.tmp.makeScale(1, 1, 1);
      this.tmp.setPosition(x * CS + CS / 2, WALL_H / 2, y * CS + CS / 2);
      const im = this.meshes[kind];
      im.setMatrixAt(i, this.tmp);
      // light baked in: bright near a lamp, cold dark in between
      const d = lampDist(x, y);
      const b = Math.max(0.16, 1 - d / 7.5);
      this.col.setRGB(b, b * (0.92 + 0.06 * (1 - Math.min(1, d / 5))), b * 0.84);
      im.setColorAt(i, this.col);
      this.baseColor.set(y * w + x, im.instanceColor ? b : 1);
      this.cellInst.set(y * w + x, { m: kind, i });
    }
    for (let k = 0; k < 3; k++) {
      this.meshes[k].count = fill[k];
      this.meshes[k].instanceMatrix.needsUpdate = true;
      const ic = this.meshes[k].instanceColor;
      if (ic) ic.needsUpdate = true;
    }

    // floor and ceiling flats
    const plane = new PlaneGeometry(w * CS, h * CS);
    this.geos.push(plane);
    this.floorMat = new MeshBasicMaterial({ map: this.makeRepeat(this.texes.floor, w, h) });
    const floor = new Mesh(plane, this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w * CS / 2, 0, h * CS / 2);
    scene.add(floor);
    this.extras.push(floor);
    this.ceilMat = new MeshBasicMaterial({ map: this.makeRepeat(this.texes.ceil, w, h) });
    const ceil = new Mesh(plane, this.ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(w * CS / 2, WALL_H, h * CS / 2);
    scene.add(ceil);
    this.extras.push(ceil);

    // lamps: a hot sprite under the ceiling; wall color already knows about it
    const glow = tex(sprGlow('#ffc27a'));
    for (const [lx, ly] of level.lamps) {
      const spr = new Sprite(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      spr.scale.set(1.5, 1.5, 1);
      spr.position.set(lx * CS + CS / 2, WALL_H - 0.42, ly * CS + CS / 2);
      scene.add(spr);
      this.lamps.push({ spr, phase: Math.random() * 6.28 });
    }

    // blast doors
    const doorGeo = new BoxGeometry(CS * 0.96, WALL_H * 0.98, 0.24);
    this.geos.push(doorGeo);
    for (const d of level.doors) {
      const mat = new MeshBasicMaterial({ color: d.kind === 'exit' ? FR.brass : 0x5a6068 });
      const mesh = new Mesh(doorGeo, mat);
      const tb = grid[(d.y - 1) * w + d.x] === 0 && grid[(d.y + 1) * w + d.x] === 0
        && grid[d.y * w + d.x - 1] !== 0 && grid[d.y * w + d.x + 1] !== 0;
      mesh.rotation.y = tb ? Math.PI / 2 : 0;
      mesh.position.set(d.x * CS + CS / 2, WALL_H / 2, d.y * CS + CS / 2);
      scene.add(mesh);
      this.doorMeshes.push({ cell: d, mesh, cur: d.open, jitter: Math.random() * 6 });
    }
    // the exit is always an elevator-grade brass door standing in the exit room
    if (!level.doors.some((d) => d.kind === 'exit')) {
      const cell: DoorCell = { x: level.exit[0], y: level.exit[1], open: 0, kind: 'exit', sealed: 0 };
      const mesh = new Mesh(doorGeo, new MeshBasicMaterial({ color: FR.brass }));
      mesh.position.set(cell.x * CS + CS / 2, WALL_H / 2, cell.y * CS + CS / 2);
      scene.add(mesh);
      this.doorMeshes.push({ cell, mesh, cur: 0, jitter: 0 });
    }
  }

  private makeRepeat(t: Texture, rx: number, ry: number): Texture {
    const c = t.clone();
    c.needsUpdate = true;
    c.repeat.set(rx, ry);
    return c;
  }

  get doors(): DoorMesh[] { return this.doorMeshes; }

  /** Force the exit door open (frags earned): it grinds up and stays up. */
  openExit(open: boolean): void {
    for (const d of this.doorMeshes) {
      if (d.cell.kind !== 'exit') continue;
      d.cell.open = open ? 1 : 0;
      if (!open) continue;
      // once open, park it raised so the marine can ride out
      d.mesh.position.y = WALL_H / 2 + WALL_H * 0.97;
      d.cur = 1;
    }
  }

  /** Collapse a wall block to reveal a secret. */
  reveal(x: number, y: number): void {
    if (!this.level) return;
    const key = y * this.level.w + x;
    const at = this.cellInst.get(key);
    if (!at) return;
    const im = this.meshes[at.m];
    this.tmp.makeScale(1, 0.001, 1);
    this.tmp.setPosition(x * CS + CS / 2, 0.001, y * CS + CS / 2);
    im.setMatrixAt(at.i, this.tmp);
    im.instanceMatrix.needsUpdate = true;
    this.cellInst.delete(key);
  }

  update(dt: number, camX: number, camZ: number, t: number, flicker: number): void {
    for (const d of this.doorMeshes) {
      const near = Math.hypot(d.mesh.position.x - camX, d.mesh.position.z - camZ) < CS * 1.6;
      const want = d.cell.sealed > 0 ? 0 : d.cell.open > 0 || near ? 1 : 0;
      d.cur += (want - d.cur) * Math.min(1, dt * 2.2);
      d.mesh.position.y = WALL_H / 2 + d.cur * WALL_H * 0.97;
      const mat = d.mesh.material as MeshBasicMaterial;
      if (d.cell.sealed > 0) {
        const p = 0.5 + 0.5 * Math.sin(t * 6 + d.jitter);
        mat.color.setRGB(0.55 + p * 0.45, 0.09 + p * 0.06, 0.08);
      }
    }
    for (const l of this.lamps) {
      const f = 1 + flicker * Math.sin(t * 13 + l.phase) * (Math.random() < 0.08 ? 0.55 : 0.18);
      const s = 1.5 * Math.max(0.5, f);
      l.spr.scale.set(s, s, 1);
    }
  }
}
