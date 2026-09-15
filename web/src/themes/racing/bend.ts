import { Vector2, type Material } from 'three';

/**
 * The curved world. Every material in the scene goes through `curved()`, which
 * bends geometry sideways and up/down by the square of its distance ahead of
 * the car. The road is really straight; easing `bend` makes it sweep into
 * corners and over hills far ahead while the car and camera stay put.
 */
export const bend = { value: new Vector2(0, 0) };

const PROJECT = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    mvPosition = batchingMatrix * mvPosition;
  #endif
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  vec4 bendWorld = modelMatrix * mvPosition;
  float bendD = min( 0.0, bendWorld.z );
  bendWorld.x += uBend.x * bendD * bendD;
  bendWorld.y += uBend.y * bendD * bendD;
  mvPosition = viewMatrix * bendWorld;
  gl_Position = projectionMatrix * mvPosition;
`;

export function curved<T extends Material>(
  m: T, key = '', extra?: (vertex: string) => string,
  fragment?: (fragment: string) => string, uniforms?: Record<string, { value: unknown }>,
): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBend = bend;
    if (uniforms) Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uBend;')
      .replace('#include <project_vertex>', PROJECT);
    if (extra) shader.vertexShader = extra(shader.vertexShader);
    if (fragment) shader.fragmentShader = fragment(shader.fragmentShader);
  };
  m.customProgramCacheKey = () => 'curved' + key;
  return m;
}

/** The world-space x/y offset `curved()` applies at distance z (for placing overlays). */
export function bendAt(z: number): { x: number; y: number } {
  const d = Math.min(0, z);
  return { x: bend.value.x * d * d, y: bend.value.y * d * d };
}
