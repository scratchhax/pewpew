import { BoxGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Scene } from 'three';
import { curved } from './bend';
import { ROAD_TILE, ROAD_WIDTH, roadTextures } from './textures';

export const LANES = [-5.4, -1.8, 1.8, 5.4];
export const NEAR = 30;

/** The road surface (scrolling asphalt that gets wetter with the weather), curbs and sidewalks. */
export class Road {
  private mat: MeshStandardMaterial;
  private curbMats: MeshBasicMaterial[] = [];
  private length: number;
  private meshes: Mesh[] = [];
  private travelled = 0;

  constructor(private scene: Scene, far: number) {
    this.length = far + NEAR;
    const { map, rough } = roadTextures();
    this.mat = curved(new MeshStandardMaterial({
      map, roughnessMap: rough, roughness: 1, metalness: 0.15, envMapIntensity: 1.2, color: 0xffffff,
    }));
    this.build(far);
  }

  private build(far: number): void {
    for (const m of this.meshes) { m.geometry.dispose(); m.removeFromParent(); }
    this.meshes = [];
    this.curbMats = [];
    this.length = far + NEAR;
    const segs = Math.ceil(this.length / 5);
    const road = new Mesh(new PlaneGeometry(ROAD_WIDTH, this.length, 1, segs).rotateX(-Math.PI / 2), this.mat);
    road.position.z = NEAR - this.length / 2;
    this.mat.map!.repeat.set(1, this.length / ROAD_TILE);
    this.mat.roughnessMap!.repeat.set(1, this.length / ROAD_TILE);
    this.meshes.push(road);

    // sidewalks
    const walk = curved(new MeshStandardMaterial({ color: 0x1b1a22, roughness: 0.85, metalness: 0.1 }));
    for (const side of [-1, 1]) {
      const w = new Mesh(new BoxGeometry(6, 0.25, this.length, 1, 1, segs), walk);
      w.position.set(side * (ROAD_WIDTH / 2 + 3), 0.12, road.position.z);
      this.meshes.push(w);
      // glowing curb strip, magenta on the left and cyan on the right
      const cm = curved(new MeshBasicMaterial({ color: new Color(side < 0 ? 0xff3fb4 : 0x3ff0ff).multiplyScalar(1.6), toneMapped: false }));
      this.curbMats.push(cm);
      const curb = new Mesh(new BoxGeometry(0.12, 0.08, this.length, 1, 1, segs), cm);
      curb.position.set(side * (ROAD_WIDTH / 2 + 0.05), 0.28, road.position.z);
      this.meshes.push(curb);
    }
    for (const m of this.meshes) this.scene.add(m);
  }

  setFar(far: number): void { if (Math.abs(far + NEAR - this.length) > 1) this.build(far); }

  /** `wet` 0..1: a damp night is already glossy; a monsoon turns the road into a mirror. */
  update(dt: number, speed: number, wet: number, glow: number): void {
    this.travelled += speed * dt;
    const off = (this.travelled / ROAD_TILE) % 1;
    this.mat.map!.offset.y = off;
    this.mat.roughnessMap!.offset.y = off;
    this.mat.roughness = 0.95 - wet * 0.72;
    this.mat.metalness = 0.1 + wet * 0.35;
    this.mat.envMapIntensity = 0.35 + wet * 1.1;
    this.mat.color.setScalar(0.75 - wet * 0.3);
    this.curbMats[0]?.color.set(0xff3fb4).multiplyScalar(1.2 * glow);
    this.curbMats[1]?.color.set(0x3ff0ff).multiplyScalar(1.2 * glow);
  }
}
