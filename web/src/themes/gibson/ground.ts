import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * The floor of the storage cavern: a black plane laced with cyan circuit
 * traces that scroll toward the camera, every cell a random corner, run or
 * pad like the film's etched ground plane, dissolving into black fog.
 */

const VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uOff, uFogD, uPulse;
  uniform vec3 uColor, uCamPos;
  varying vec2 vUv;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    vec2 g = vec2(vUv.x * 60.0, vUv.y * 60.0 + uOff);
    vec2 id = floor(g);
    vec2 p = fract(g) - 0.5;
    float r = h21(id);
    float w = 0.05;
    float line;
    if (r < 0.62) {
      // a routed corner: one horizontal stub and one vertical stub meeting
      float a = floor(r / 0.155);
      float hh = smoothstep(w, 0.0, abs(p.y)) * (a < 1.0 ? step(0.0, p.y) : step(p.y, 0.0));
      float vv = smoothstep(w, 0.0, abs(p.x)) * ((a == 0.0 || a == 2.0) ? step(0.0, p.x) : step(p.x, 0.0));
      line = max(hh, vv);
    } else if (r < 0.82) {
      line = smoothstep(w, 0.0, abs(p.y));
    } else {
      line = smoothstep(0.06, 0.035, length(p));
    }
    float bright = 0.45 + 0.55 * h21(id + 7.0);
    vec3 col = uColor * line * bright * uPulse;
    float d = length(vWorld - uCamPos);
    col *= exp(-uFogD * uFogD * d * d);
    gl_FragColor = vec4(col, 1.0);
  }`;

export class Ground {
  readonly mesh: Mesh;
  private material: ShaderMaterial;

  constructor(scene: import('three').Scene) {
    this.material = new ShaderMaterial({
      uniforms: {
        uOff: { value: 0 },
        uFogD: { value: 0.044 },
        uPulse: { value: 1 },
        uColor: { value: new Color(0x3fd9ff) },
        uCamPos: { value: new Vector3(0, 5.5, 7) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const geo = new PlaneGeometry(90, 120);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, 0, -45 + 7);
    scene.add(this.mesh);
  }

  /** speed: wall scroll units/sec; pulse: music glow; fog: distance fade. */
  update(dt: number, speed: number, pulse: number, fog: number, camPos: Vector3): void {
    // 60 cells over 120 world units: half a cell per world unit, so the
    // traces track the towers exactly and the whole cavern flies past together
    this.material.uniforms.uOff.value += speed * dt * 0.5;
    this.material.uniforms.uPulse.value = pulse;
    this.material.uniforms.uFogD.value = fog;
    this.material.uniforms.uCamPos.value.copy(camPos);
  }
}
