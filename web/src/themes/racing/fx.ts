import {
  AdditiveBlending, Color, ConeGeometry, DynamicDrawUsage, InstancedMesh, Mesh, MeshBasicMaterial, Object3D,
  PlaneGeometry, type Group, type Scene, type Texture,
} from 'three';
import { curved } from './bend';

const dummy = new Object3D();

interface Spark { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number }

/**
 * Rain, speed lines, nitro exhaust and sparks. Rain and lines live in a box
 * around the camera; sparks are pooled and fade in and out (no pops).
 */
export class Fx {
  private rain: InstancedMesh;
  private rainMat: MeshBasicMaterial;
  private drops: Float32Array;
  private lines: InstancedMesh;
  private lineMat: MeshBasicMaterial;
  private lineData: Float32Array;
  private sparks: InstancedMesh;
  private sparkMat: MeshBasicMaterial;
  private sparkList: Spark[] = [];
  private flames: Mesh[] = [];
  private flameMat: MeshBasicMaterial;
  private maxDrops = 1800;
  density = 1;

  constructor(scene: Scene, player: Group, glowTex: Texture) {
    this.rainMat = curved(new MeshBasicMaterial({ color: new Color(0.55, 0.65, 0.9), transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain = new InstancedMesh(new PlaneGeometry(0.025, 0.9), this.rainMat, this.maxDrops);
    this.rain.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rain.frustumCulled = false;
    this.drops = new Float32Array(this.maxDrops * 3);
    for (let i = 0; i < this.maxDrops; i++) this.resetDrop(i, true);
    scene.add(this.rain);

    this.lineMat = curved(new MeshBasicMaterial({ color: new Color(0.8, 0.95, 1.4), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines = new InstancedMesh(new PlaneGeometry(0.04, 9).rotateX(-Math.PI / 2), this.lineMat, 60);
    this.lines.frustumCulled = false;
    this.lineData = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      this.lineData[i * 3] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 9);
      this.lineData[i * 3 + 1] = 0.3 + Math.random() * 5;
      this.lineData[i * 3 + 2] = -Math.random() * 120;
    }
    scene.add(this.lines);

    this.sparkMat = curved(new MeshBasicMaterial({ map: glowTex, color: new Color(3, 1.6, 0.5), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sparks = new InstancedMesh(new PlaneGeometry(0.35, 0.35), this.sparkMat, 300);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);

    this.flameMat = curved(new MeshBasicMaterial({ color: new Color(0.6, 1.6, 4), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    for (const side of [-0.45, 0.45]) {
      const f = new Mesh(new ConeGeometry(0.11, 1.2, 10).rotateX(Math.PI / 2), this.flameMat);
      f.position.set(side, 0.42, 2.9);
      player.add(f);
      this.flames.push(f);
    }
  }

  private resetDrop(i: number, anywhere: boolean): void {
    this.drops[i * 3] = (Math.random() - 0.5) * 60;
    this.drops[i * 3 + 1] = anywhere ? Math.random() * 22 : 22;
    this.drops[i * 3 + 2] = 10 - Math.random() * 80;
  }

  burst(x: number, y: number, z: number, n = 30, speed = 12): void {
    for (let k = 0; k < n && this.sparkList.length < 300; k++) {
      const a = Math.random() * Math.PI * 2;
      this.sparkList.push({
        x, y, z, vx: Math.cos(a) * speed * Math.random(), vy: 2 + Math.random() * speed * 0.7, vz: Math.sin(a) * speed * Math.random() - 8,
        age: 0, life: 0.5 + Math.random() * 0.6,
      });
    }
  }

  /** `wet` 0..1 rain amount, `nitro` 0..1, `speed` m/s. */
  update(dt: number, wet: number, nitro: number, speed: number, camZ: number): void {
    // rain slants back toward the camera with speed
    const n = Math.floor(this.maxDrops * Math.min(1, wet * this.density));
    this.rain.count = n;
    this.rainMat.opacity = 0.15 + wet * 0.3;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      this.drops[o + 1] -= dt * 26;
      this.drops[o + 2] += dt * speed * 0.9;
      if (this.drops[o + 1] < 0 || this.drops[o + 2] > camZ + 6) this.resetDrop(i, false);
      dummy.position.set(this.drops[o], this.drops[o + 1], this.drops[o + 2]);
      dummy.rotation.set(-0.35 - speed * 0.006, 0, 0);
      dummy.scale.set(1, 1 + speed * 0.02, 1);
      dummy.updateMatrix();
      this.rain.setMatrixAt(i, dummy.matrix);
    }
    this.rain.instanceMatrix.needsUpdate = true;

    // speed lines ease in with nitro
    this.lineMat.opacity += (nitro * 0.55 - this.lineMat.opacity) * Math.min(1, dt * 3);
    this.lines.visible = this.lineMat.opacity > 0.01;
    if (this.lines.visible) {
      for (let i = 0; i < 60; i++) {
        const o = i * 3;
        this.lineData[o + 2] += dt * speed * 2.2;
        if (this.lineData[o + 2] > 12) this.lineData[o + 2] -= 130;
        dummy.position.set(this.lineData[o], this.lineData[o + 1], this.lineData[o + 2]);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.lines.setMatrixAt(i, dummy.matrix);
      }
      this.lines.instanceMatrix.needsUpdate = true;
    }

    // nitro flames
    this.flameMat.opacity += (nitro * 0.9 - this.flameMat.opacity) * Math.min(1, dt * 4);
    for (const f of this.flames) f.scale.set(1, 1, 0.6 + nitro * (1.2 + Math.random() * 0.4));

    // sparks
    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const s = this.sparkList[i];
      s.age += dt;
      if (s.age >= s.life) { this.sparkList.splice(i, 1); continue; }
      s.vy -= 20 * dt;
      s.x += s.vx * dt; s.y = Math.max(0.05, s.y + s.vy * dt); s.z += (s.vz + speed) * dt;
    }
    this.sparks.count = this.sparkList.length;
    this.sparkList.forEach((s, i) => {
      const env = Math.sin(Math.PI * (s.age / s.life));
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.2 + env * 0.8);
      dummy.updateMatrix();
      this.sparks.setMatrixAt(i, dummy.matrix);
    });
    this.sparks.instanceMatrix.needsUpdate = true;
  }
}
