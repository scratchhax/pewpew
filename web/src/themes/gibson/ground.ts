import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';

/**
 * The floor of the storage cavern: a black plane wired like a circuit board
 * and scrolling toward the camera at exactly the towers' speed. Traces run
 * in parallel streets along the cavern, in long runs that start and stop at
 * pads, joined now and then by full-width cross buses with via pads at every
 * crossing; 90-degree turns only. Energy pulses with bright heads and short
 * tails race down the copper, and the whole board dissolves into black fog.
 */

const VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uScroll, uTime, uFogD, uPulse, uRot;
  uniform vec2 uPiv;
  uniform vec3 uColor, uCamPos;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    // the board belongs to the city: pattern coords ride with the ground and
    // swing around the intersection pivot with it when the flight turns
    vec2 q = vec2(vWorld.x, vWorld.z) - uPiv;
    float cr = cos(uRot), sr = sin(uRot);
    vec2 r = vec2(q.x * cr + q.y * sr, -q.x * sr + q.y * cr);
    vec2 P = vec2(r.x, r.y - uScroll);
    float w = 0.045;
    float LW = 2.6;
    float SEG = 17.0;
    float mask = 0.0;
    float pulse = 0.0;
    // trace streets run along BOTH axes, so the board looks like home no
    // matter which way down the grid the flight just turned; each run lives
    // in whole blocks and starts or ends at a pad
    for (int a = 0; a < 2; a++) {
      vec2 Q = a == 0 ? P : P.yx;
      float o = float(a) * 31.7;
      float li = floor(Q.x / LW);
      float lf = fract(Q.x / LW);
      float si = floor(Q.y / SEG);
      float sf = fract(Q.y / SEG);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float seed = li * 4.0 + fk + o;
        float on = step(0.42, h21(vec2(seed, si)));
        float d = abs(lf - (0.2 + fk * 0.3)) * LW;
        float tr = smoothstep(w, 0.0, d) * on;
        float endPad = on * step(0.93, sf) * smoothstep(w * 2.4, w * 1.2, d);
        float startPad = on * step(sf, 0.07) * smoothstep(w * 2.4, w * 1.2, d);
        mask = max(mask, max(tr, max(endPad, startPad)));
        float ph = fract(uTime * (0.35 + h21(vec2(seed, 5.0)) * 0.5) + h21(vec2(seed + 0.5, si)));
        float dd = mod(sf - ph, 1.0);
        pulse += tr * exp(-dd * 9.0) * step(dd, 0.3) * (0.55 + 0.45 * h21(vec2(seed, si)));
      }
    }
    // via pads where the lane grids cross
    vec2 lx = vec2(mod(P.x, LW), mod(P.y, LW));
    float pad = 0.0;
    for (int k = 0; k < 3; k++) {
      float ox = abs(lx.x - (0.2 + float(k) * 0.3) * LW);
      pad = max(pad, smoothstep(0.11, 0.07, length(vec2(ox, abs(lx.y - 0.5 * LW) * 0.35))));
      float oz = abs(lx.y - (0.2 + float(k) * 0.3) * LW);
      pad = max(pad, smoothstep(0.11, 0.07, length(vec2(abs(lx.x - 0.5 * LW) * 0.35, oz))));
    }
    mask = max(mask, pad);
    float bright = 0.5 + 0.5 * h21(vec2(floor(P.x / LW), floor(P.y / SEG) * 0.5 + 7.0));
    vec3 col = uColor * mask * bright * uPulse + (uColor + vec3(0.45)) * pulse * 2.4;
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
        uScroll: { value: 0 },
        uTime: { value: 0 },
        uFogD: { value: 0.044 },
        uPulse: { value: 1 },
        uRot: { value: 0 },
        uPiv: { value: new Vector2(0, 7) },
        uColor: { value: new Color(0x3fd9ff) },
        uCamPos: { value: new Vector3(0, 2.4, 7) },
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

  /** Swing the board with the city during a turn (cumulative radians). */
  setRot(r: number): void {
    this.material.uniforms.uRot.value = r;
  }

  /** speed: wall scroll units/sec; pulse: music glow; fog: distance fade. */
  update(dt: number, speed: number, pulse: number, fog: number, camPos: Vector3): void {
    // the board rides toward the camera at exactly the towers' world speed
    this.material.uniforms.uScroll.value += speed * dt;
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uPulse.value = pulse;
    this.material.uniforms.uFogD.value = fog;
    this.material.uniforms.uCamPos.value.copy(camPos);
  }
}
