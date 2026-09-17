import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Scene } from 'three';

/**
 * The floating signs of the film: ACCESS GRANTED, ACCESS DENIED, PASSWORD
 * ACCEPTED, hanging on a tower face that looks back down the street, pulsing
 * to be read across the cavern. Each text is drawn once to a cached canvas;
 * signs are nailed to the city at spawn and stay put - the flight sails past
 * them and culls them once they're behind.
 */

export interface SignFace { x: number; y: number; z: number; nx: number; nz: number; }

export class Billboards {
  private group = new Group();
  private active: Array<{ mesh: Mesh; t: number }> = [];
  private cache = new Map<string, CanvasTexture>();

  constructor(scene: Scene) {
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

  /** Hang a sign on a tower face (normal facing the street); caller rate-limits hard. */
  spawn(text: string, color = '#dff2ff', face?: SignFace | null): void {
    if (this.active.length > 2) return;
    const tex = this.texture(text, color);
    const aspect = tex.image.width / tex.image.height;
    const h = 1.15;
    const mesh = new Mesh(
      new PlaneGeometry(h * aspect, h),
      new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    if (face) {
      mesh.position.set(face.x, face.y, face.z);
      mesh.rotation.y = Math.atan2(face.nx, face.nz);
    } else {
      mesh.position.set(0, 9, 0);
    }
    this.group.add(mesh);
    this.active.push({ mesh, t: Math.random() * 6 });
  }

  /** Keep the pulse; drop signs the flight has passed. */
  update(dt: number, camX: number, camZ: number, fx: number, fz: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.t += dt;
      // a slow breathing pulse so the sign reads across the cavern
      const k = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(b.t * 3.2));
      (b.mesh.material as MeshBasicMaterial).opacity = k;
      const dx = b.mesh.position.x - camX, dz = b.mesh.position.z - camZ;
      if (dx * fx + dz * fz > 8 || dx * dx + dz * dz > 90 * 90) {
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
