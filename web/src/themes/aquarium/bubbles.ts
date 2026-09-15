import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, NormalBlending, ShaderMaterial, SphereGeometry, Vector3, type Scene } from 'three';
import { W, WATER_GLSL } from './water';

/**
 * Bubbles: glassy spheres with a bright rim and a sun glint, wobbling as they
 * rise and growing a little as the pressure drops, until they reach the surface.
 */
interface Bubble { pos: Vector3; r: number; vy: number; wob: number; wobF: number; tint: Color; alive: boolean; id: number; }

export class Bubbles {
  readonly mesh: InstancedMesh;
  private list: Bubble[] = [];
  private tint: InstancedBufferAttribute;
  private m = new Matrix4();
  private nextId = 1;
  max: number;
  onPop: (x: number, y: number) => void = () => {};

  constructor(scene: Scene, max = 700) {
    this.max = max;
    const geo = new SphereGeometry(1, 16, 12);
    this.tint = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.tint.setUsage(DynamicDrawUsage);
    geo.setAttribute('aTint', this.tint);
    const mat = new ShaderMaterial({
      uniforms: W,
      vertexShader: /* glsl */`
        attribute vec3 aTint;
        varying vec3 vN, vWp, vTint;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec4 wp = m * vec4(position, 1.0);
          vWp = wp.xyz;
          vN = normalize(mat3(m) * normal);
          vTint = aTint;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        ${WATER_GLSL}
        varying vec3 vN, vWp, vTint;
        void main() {
          vec3 V = normalize(cameraPosition - vWp);
          vec3 N = normalize(vN);
          float facing = abs(dot(N, V));
          float rim = pow(1.0 - facing, 2.2);
          float spec = pow(max(dot(N, normalize(uSunDir + V)), 0.0), 90.0);
          float under = pow(max(dot(N, -uSunDir), 0.0), 3.0) * 0.25;
          vec3 col = mix(vec3(0.75, 0.93, 1.0), vTint, 0.55) * (rim * 1.1 + under) + vec3(1.0) * spec * 2.0;
          float a = clamp(rim * 0.9 + spec + under * 0.5 + 0.04, 0.0, 1.0);
          float dist = length(vWp - cameraPosition);
          a *= exp(-uMurk * uMurk * dist * dist * 0.8);
          gl_FragColor = vec4(col * uLight, a);
        }`,
      transparent: true, depthWrite: false, blending: NormalBlending,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  get count(): number { return this.list.length; }

  /** Release a bubble; returns an id a label can follow (0 if full). */
  emit(at: Vector3, r: number, tint = new Color(0.8, 0.95, 1), spread = 0.3): number {
    if (this.list.length >= this.max) return 0;
    const b: Bubble = {
      pos: at.clone().add(new Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)),
      r, vy: 2 + Math.sqrt(r) * 6, wob: Math.random() * 6, wobF: 3 + Math.random() * 4, tint, alive: true, id: this.nextId++,
    };
    this.list.push(b);
    return b.id;
  }

  position(id: number): Vector3 | null {
    for (const b of this.list) if (b.id === id) return b.pos;
    return null;
  }

  update(dt: number, current: number, surfaceY: number): void {
    const arr = this.tint.array as Float32Array;
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.wob += dt * b.wobF;
      b.pos.y += b.vy * dt;
      b.pos.x += (Math.sin(b.wob) * 0.6 * b.r * 3 + current * 1.5) * dt;
      b.pos.z += Math.cos(b.wob * 0.8) * 0.4 * b.r * 3 * dt;
      b.r *= 1 + dt * 0.012;
      if (b.pos.y > surfaceY - b.r) { this.onPop(b.pos.x, b.pos.y); this.list.splice(i, 1); }
    }
    for (const b of this.list) {
      // a rising bubble flattens a little and jiggles
      const sq = 1 + Math.sin(b.wob * 1.7) * 0.08;
      this.m.makeScale(b.r * sq, b.r * 0.85 / sq, b.r * sq).setPosition(b.pos);
      this.mesh.setMatrixAt(n, this.m);
      arr[n * 3] = b.tint.r; arr[n * 3 + 1] = b.tint.g; arr[n * 3 + 2] = b.tint.b;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }
}
