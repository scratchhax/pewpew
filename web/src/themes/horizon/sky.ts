import {
  BackSide, CubeCamera, HalfFloatType, LinearFilter, Mesh, RGBAFormat, Scene, ShaderMaterial, SphereGeometry,
  WebGLCubeRenderTarget, type WebGLRenderer,
} from 'three';
import { NOISE_GLSL } from './noise';

/**
 * The sky behind the hole, baked once into a cube map at boot: a Milky Way
 * band with a warm core and dark dust lanes, three faint emission nebulae and
 * a pair of distant spiral galaxies. Alpha carries star density, so the
 * tracer's per-pixel stars crowd into the band. Stars themselves are NOT
 * baked: they're evaluated per pixel in the tracer, after lensing, so they
 * stay pin-sharp and smear into arcs only where gravity really stretches them.
 */
const SKY_FRAG = /* glsl */`
  precision highp float;
  ${NOISE_GLSL}
  varying vec3 vDir;

  vec3 galaxy(vec3 d, vec3 at, vec3 tilt, float size, float seed) {
    vec3 e1 = normalize(cross(at, tilt));
    vec3 e2 = cross(at, e1);
    float facing = dot(d, at);
    if (facing < 0.9) return vec3(0.0);
    vec2 p = vec2(dot(d, e1), dot(d, e2)) / size;
    p.y *= 2.6;                                   // seen at an angle
    float r = length(p);
    float a = atan(p.y, p.x);
    float arms = 0.5 + 0.5 * sin(a * 2.0 - log(max(r, 0.02)) * 5.0 + seed);
    float disk = exp(-r * 3.2) * (0.35 + 0.65 * arms);
    float core = exp(-r * r * 60.0);
    return vec3(0.55, 0.65, 1.0) * disk * 0.03 + vec3(1.0, 0.82, 0.6) * core * 0.08;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 nG = normalize(vec3(0.42, 0.78, -0.46));
    vec3 cG = normalize(cross(nG, vec3(0.0, 0.0, 1.0)));
    float lat = dot(d, nG);
    float band = exp(-lat * lat / (0.19 * 0.19));
    float coreAng = acos(clamp(dot(d, cG), -1.0, 1.0));
    float core = exp(-coreAng * coreAng / (0.6 * 0.6));
    float cloud = fbm(d * 3.2, 6) * 0.5 + 0.5;
    float fine = fbm(d * 12.0 + 3.0, 5) * 0.5 + 0.5;
    float lanes = smoothstep(0.5, 0.78, fbm(d * 5.5 + 7.0, 6) * 0.5 + 0.5) * exp(-lat * lat / (0.075 * 0.075));
    float mw = band * pow(max(cloud, 0.0), 1.6) * (0.5 + 0.8 * fine) * (1.0 - 0.9 * lanes) * (1.0 + 3.0 * core);
    vec3 mwCol = mix(vec3(0.5, 0.6, 0.95), vec3(1.0, 0.78, 0.55), clamp(core * 0.9 + 0.25 * cloud, 0.0, 1.0));
    vec3 col = mwCol * mw * 0.045;

    // emission nebulae: hydrogen red, oxygen teal, a cold violet reflection cloud
    vec3 nd[3]; vec3 nc[3];
    nd[0] = normalize(vec3(-0.6, 0.15, -0.8)); nc[0] = vec3(0.95, 0.28, 0.32);
    nd[1] = normalize(vec3(0.7, -0.25, -0.65)); nc[1] = vec3(0.2, 0.75, 0.8);
    nd[2] = normalize(vec3(0.1, 0.55, 0.85));  nc[2] = vec3(0.45, 0.35, 0.95);
    for (int i = 0; i < 3; i++) {
      float k = smoothstep(0.8, 1.0, dot(d, nd[i]));
      if (k <= 0.0) continue;
      float f = fbm(d * 7.0 + float(i) * 13.0, 6) * 0.5 + 0.5;
      float wisps = pow(max(1.0 - abs(gnoise(d * 14.0 + float(i) * 5.0)), 0.0), 5.0);
      col += nc[i] * k * k * (pow(max(f, 0.0), 3.0) * 0.07 + wisps * f * 0.03);
    }

    col += galaxy(d, normalize(vec3(-0.35, -0.3, 0.88)), vec3(0.3, 1.0, 0.1), 0.035, 1.0);
    col += galaxy(d, normalize(vec3(0.82, 0.38, 0.42)), vec3(-0.6, 0.2, 1.0), 0.022, 4.0);

    col += vec3(0.0009, 0.0013, 0.0026);          // the faint glow of everything unresolved
    float density = clamp(0.18 + band * (0.75 + 0.9 * core) * (1.0 - 0.6 * lanes), 0.0, 1.6);
    gl_FragColor = vec4(col, density);
  }`;

export function bakeSky(renderer: WebGLRenderer, size: number): WebGLCubeRenderTarget {
  const target = new WebGLCubeRenderTarget(size, {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false,
  });
  const scene = new Scene();
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG,
    side: BackSide, depthWrite: false, depthTest: false,
  });
  const geo = new SphereGeometry(10, 96, 48);
  scene.add(new Mesh(geo, mat));
  const cam = new CubeCamera(0.1, 100, target);
  cam.update(renderer, scene);
  geo.dispose();
  mat.dispose();
  return target;
}
