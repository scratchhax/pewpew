import { Color, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

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
  uniform float uScroll, uTime, uFogD, uPulse;
  uniform vec3 uColor, uCamPos;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    // pattern coords fixed to the floor: features ride toward the camera
    vec2 P = vec2(vWorld.x, vWorld.z - uScroll);
    float w = 0.045;
    float LW = 2.6;
    float SEG = 17.0;
    float BH = 9.5;
    float li = floor(P.x / LW);
    float lf = fract(P.x / LW);
    float si = floor(P.y / SEG);
    float sf = fract(P.y / SEG);
    float mask = 0.0;
    float pulse = 0.0;
    // up to three parallel traces per street; each run lives in whole blocks
    // and starts or ends at a pad, so runs read long and routed, not noisy
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float seed = li * 4.0 + fk;
      float on = step(0.42, h21(vec2(seed, si)));
      float d = abs(lf - (0.2 + fk * 0.3)) * LW;
      float tr = smoothstep(w, 0.0, d) * on;
      // pads at the ends of each run
      float endPad = on * step(0.93, max(sf, 0.0)) * smoothstep(w * 2.4, w * 1.2, d);
      float startPad = on * step(sf, 0.07) * smoothstep(w * 2.4, w * 1.2, d);
      mask = max(mask, max(tr, max(endPad, startPad)));
      // an energy pulse racing down this run: bright head, short tail
      float ph = fract(uTime * (0.35 + h21(vec2(seed, 5.0)) * 0.5) + h21(vec2(seed + 0.5, si)));
      float dd = mod(sf - ph, 1.0);
      pulse += tr * exp(-dd * 9.0) * step(dd, 0.3) * (0.55 + 0.45 * h21(vec2(seed, si)));
    }
    // full-width cross buses, sparse, with their own pulses
    float bi = floor(P.y / BH);
    float bf = fract(P.y / BH);
    float bus = step(0.45, h21(vec2(bi, 7.3))) * smoothstep(w, 0.0, min(bf, 1.0 - bf) * BH);
    mask = max(mask, bus);
    float phb = fract(uTime * 0.28 + h21(vec2(bi, 2.0)));
    float ddx = mod(P.x / 46.0 + 0.5 - phb, 1.0);
    pulse += bus * exp(-ddx * 8.0) * step(ddx, 0.22);
    // via pads where a bus meets a street, wherever a trace crosses
    for (int k = 0; k < 3; k++) {
      float d = abs(lf - (0.2 + float(k) * 0.3)) * LW;
      float pad = smoothstep(0.11, 0.07, length(vec2(d, min(bf, 1.0 - bf) * BH * 0.5)));
      mask = max(mask, pad * step(0.45, h21(vec2(bi, 7.3))));
    }
    float bright = 0.5 + 0.5 * h21(vec2(li, si * 0.5 + 7.0));
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
