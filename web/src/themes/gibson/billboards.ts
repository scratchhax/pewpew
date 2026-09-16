import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Scene } from 'three';

/**
 * The floating signs of the film: ACCESS GRANTED, ACCESS DENIED, PASSWORD
 * ACCEPTED, a cookie now and then, gliding over the tops of the towers.
 * Each text is drawn once to a cached canvas; signs scroll with the wall.
 */

const CAM_Z = 7;
const SP_Z = 2.4;

export class Billboards {
  private group = new Group();
  private active: Array<{ mesh: Mesh; z: number }> = [];
  private cache = new Map<string, CanvasTexture>();
  private rows: number;

  constructor(scene: Scene, rows: number) {
    this.rows = rows;
    scene.add(this.group);
  }

  private texture(text: string, color: string): CanvasTexture {
    const key = `${text}|${color}`;
    let tex = this.cache.get(key);
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 90px "Courier New", monospace';
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    canvas.width = w;
    canvas.height = 150;
    const c2 = canvas.getContext('2d')!;
    c2.font = 'bold 90px "Courier New", monospace';
    c2.textBaseline = 'middle';
    c2.fillStyle = 'rgba(10, 6, 20, 0.55)';
    c2.fillRect(0, 0, w, 150);
    c2.strokeStyle = color;
    c2.lineWidth = 5;
    c2.strokeRect(6, 6, w - 12, 138);
    c2.fillStyle = color;
    c2.fillText(text, 24, 78);
    tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  /** Spawn a sign far above the wall; caller rate-limits hard. */
  spawn(text: string, color = '#dff2ff'): void {
    if (this.active.length > 2) return;
    const tex = this.texture(text, color);
    const aspect = tex.image.width / tex.image.height;
    const h = 0.8;
    const mesh = new Mesh(
      new PlaneGeometry(h * aspect, h),
      new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    mesh.position.set((Math.random() - 0.5) * 14, 9 + Math.random() * 2, -this.rows * SP_Z - 4);
    this.group.add(mesh);
    this.active.push({ mesh, z: mesh.position.z });
  }

  update(dt: number, speed: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.z += speed * dt;
      b.mesh.position.z = b.z;
      if (b.z > CAM_Z + 1) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as MeshBasicMaterial).dispose();
        this.active.splice(i, 1);
      }
    }
  }

  get count(): number { return this.active.length; }
}

export const DENIED = new Color(0xff4040);
export const GRANTED = new Color(0x9fb0ff);
