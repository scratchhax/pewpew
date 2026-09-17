import { AdditiveBlending, Mesh, MeshBasicMaterial, Texture, type Scene } from 'three';
import { sprGun, sprMuzzle, tex } from './art';
import { overlayQuad } from './world';

/**
 * The marine's shotgun: an overlay quad that never goes behind the maze,
 * bobbing with his walk, kicking back when it fires, with a three-frame
 * muzzle flash at the barrel end.
 */

export class Gun {
  private mesh: Mesh;
  private flash: Mesh[];
  private flashT = 0;
  private recoil = 0;
  private bobPhase = 0;
  private aspect = 16 / 9;
  private gunTex: Texture;
  private visible = true;

  constructor(scene: Scene) {
    this.gunTex = tex(sprGun());
    this.mesh = overlayQuad(new MeshBasicMaterial({ map: this.gunTex, transparent: true }), 1.54, 1.0);
    scene.add(this.mesh);
    this.flash = [0, 1, 2].map((k) => {
      const q = overlayQuad(new MeshBasicMaterial({ map: tex(sprMuzzle(k)), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }), 0.9, 0.9);
      scene.add(q);
      return q;
    });
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.mesh.visible = on;
  }

  fire(): void {
    this.recoil = 1;
    this.flashT = 0.09;
  }

  setAspect(aspect: number): void { this.aspect = aspect; }

  /** bob: 0..1 walk-cycle phase energy, swell: music bump. */
  update(dt: number, bobPhase: number, moving: boolean, swell: number): void {
    this.bobPhase = bobPhase;
    this.recoil = Math.max(0, this.recoil - dt * 6.5);
    const h = 0.98 * (1 + swell * 0.02);
    const w = h * 1.54;
    this.mesh.scale.set(w, h, 1);
    const bobX = moving ? Math.sin(this.bobPhase) * 0.035 : 0;
    const bobY = moving ? Math.abs(Math.cos(this.bobPhase)) * 0.045 : 0;
    // the marine holds the shotgun low, a third of the way right of centre,
    // its bottom edge tucked to the frame floor; the ortho camera spans x in
    // [-aspect, aspect], y in [-1, 1]
    const x = this.aspect * 0.34 + bobX;
    const y = -1 + h * 0.38 + bobY - this.recoil * 0.16;
    this.mesh.position.set(x, y, 0);
    this.mesh.rotation.z = (moving ? Math.sin(this.bobPhase * 0.5) * 0.012 : 0) + this.recoil * 0.045;

    this.flashT = Math.max(0, this.flashT - dt);
    const frame = this.flashT > 0.06 ? 0 : this.flashT > 0.03 ? 1 : 2;
    this.flash.forEach((f, k) => {
      const m = f.material as MeshBasicMaterial;
      m.opacity = this.flashT > 0 && k === frame ? 1 : 0;
      f.position.set(x - w * 0.12, y + h * 0.5, 0.01);
      f.scale.set(0.7 + 0.25 * frame, 0.7 + 0.25 * frame, 1);
    });
  }
}
