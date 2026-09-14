import {
  AdditiveBlending, BoxGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Shape, type Texture,
} from 'three';
import { curved } from './bend';

/**
 * A low tuner coupe built from extruded side profiles: a clear-coated body,
 * dark glass, wheels with glowing rims, head and tail lights, a spoiler and
 * neon underglow. Geometry is shared; materials are cached per colour.
 */

const L = 4.5;          // length (m), the car faces -z

function profile(points: Array<[number, number]>, curves: Array<[number, [number, number], [number, number]]> = []): Shape {
  const s = new Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const c = curves.find(([at]) => at === i);
    if (c) s.quadraticCurveTo(c[1][0], c[1][1], c[2][0], c[2][1]);
    else s.lineTo(points[i][0], points[i][1]);
  }
  s.closePath();
  return s;
}

function extrude(shape: Shape, width: number, bevel: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10,
  });
  // shape x runs along the car (front = +x), extrusion along z: turn it so the nose points -z
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

let geo: {
  body: ExtrudeGeometry; cabin: ExtrudeGeometry; wheel: CylinderGeometry; rim: CylinderGeometry;
  lamp: BoxGeometry; tail: BoxGeometry; spoiler: BoxGeometry; strut: BoxGeometry; glowPlane: PlaneGeometry;
  bar: BoxGeometry; skirt: BoxGeometry;
} | null = null;

function geometry() {
  if (geo) return geo;
  const body = profile(
    [[-2.25, 0.3], [2.2, 0.3], [2.28, 0.58], [1.05, 0.8], [-1.7, 0.86], [-2.28, 0.66]],
    [[2, [2.34, 0.34], [2.28, 0.58]], [5, [-2.3, 0.86], [-2.28, 0.66]]],
  );
  const cabin = profile(
    [[-1.45, 0.78], [0.95, 0.78], [0.1, 1.24], [-0.95, 1.28], [-1.62, 0.84]],
    [[4, [-1.4, 1.22], [-1.62, 0.84]]],
  );
  geo = {
    body: extrude(body, 1.92, 0.1),
    cabin: extrude(cabin, 1.52, 0.08),
    wheel: new CylinderGeometry(0.36, 0.36, 0.3, 24).rotateZ(Math.PI / 2),
    rim: new CylinderGeometry(0.22, 0.22, 0.32, 18).rotateZ(Math.PI / 2),
    lamp: new BoxGeometry(0.46, 0.1, 0.06),
    tail: new BoxGeometry(1.7, 0.08, 0.05),
    spoiler: new BoxGeometry(1.8, 0.05, 0.34),
    strut: new BoxGeometry(0.05, 0.22, 0.12),
    glowPlane: new PlaneGeometry(3.4, 6.2).rotateX(-Math.PI / 2),
    bar: new BoxGeometry(0.5, 0.12, 0.26),
    skirt: new BoxGeometry(0.06, 0.12, 3.2),
  };
  return geo;
}

const paints = new Map<number, MeshPhysicalMaterial>();
function paint(color: number): MeshPhysicalMaterial {
  let m = paints.get(color);
  if (!m) {
    m = curved(new MeshPhysicalMaterial({
      color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4,
    }));
    paints.set(color, m);
  }
  return m;
}

let shared: {
  glass: MeshPhysicalMaterial; tyre: MeshStandardMaterial; dark: MeshStandardMaterial;
  head: MeshBasicMaterial; tail: MeshBasicMaterial;
} | null = null;
function materials() {
  if (shared) return shared;
  shared = {
    glass: curved(new MeshPhysicalMaterial({ color: 0x05070c, metalness: 0.9, roughness: 0.05, clearcoat: 1, envMapIntensity: 2 })),
    tyre: curved(new MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 })),
    dark: curved(new MeshStandardMaterial({ color: 0x111116, metalness: 0.4, roughness: 0.6 })),
    head: curved(new MeshBasicMaterial({ color: new Color(3, 3, 2.7), toneMapped: false })),
    tail: curved(new MeshBasicMaterial({ color: new Color(3.2, 0.12, 0.2), toneMapped: false })),
  };
  return shared;
}

export interface CarRig {
  group: Group;
  wheels: Mesh[];
  underglow: Mesh;
  underglowMat: MeshBasicMaterial;
  rimMat: MeshBasicMaterial;
  bar?: { red: MeshBasicMaterial; blue: MeshBasicMaterial; glow: Mesh; glowMat: MeshBasicMaterial };
}

export interface CarOpts {
  paint: number;
  glow: number;
  glowTex: Texture;
  police?: boolean;
  spoiler?: boolean;
}

export function buildCar(o: CarOpts): CarRig {
  const g = geometry(), m = materials();
  const group = new Group();
  const bodyMat = paint(o.police ? 0x0d0f16 : o.paint);

  const body = new Mesh(g.body, bodyMat);
  const cabin = new Mesh(g.cabin, m.glass);
  group.add(body, cabin);
  if (o.police) {
    // white doors on a black-and-white
    const doors = new Mesh(g.skirt, paint(0xe8ecf2));
    doors.scale.set(1, 3.2, 0.62);
    for (const side of [-1, 1]) {
      const d = doors.clone();
      d.position.set(side * 0.97, 0.52, 0.1);
      group.add(d);
    }
  }

  const rimMat = curved(new MeshBasicMaterial({ color: new Color(o.glow).multiplyScalar(1.6), toneMapped: false }));
  const wheels: Mesh[] = [];
  for (const [x, z] of [[-0.9, -1.38], [0.9, -1.38], [-0.9, 1.42], [0.9, 1.42]]) {
    const w = new Mesh(g.wheel, m.tyre);
    w.position.set(x, 0.36, z);
    const rim = new Mesh(g.rim, rimMat);
    rim.scale.set(1, 1, 1);
    w.add(rim);
    wheels.push(w);
    group.add(w);
  }
  for (const side of [-1, 1]) {
    const head = new Mesh(g.lamp, m.head);
    head.position.set(side * 0.62, 0.58, -L / 2 - 0.02);
    group.add(head);
    const skirt = new Mesh(g.skirt, m.dark);
    skirt.position.set(side * 0.98, 0.3, 0.02);
    group.add(skirt);
  }
  const tail = new Mesh(g.tail, m.tail);
  tail.position.set(0, 0.68, L / 2 + 0.02);
  group.add(tail);

  if (o.spoiler ?? true) {
    const sp = new Mesh(g.spoiler, bodyMat);
    sp.position.set(0, 1.08, 1.95);
    group.add(sp);
    for (const side of [-1, 1]) {
      const st = new Mesh(g.strut, m.dark);
      st.position.set(side * 0.6, 0.96, 1.95);
      group.add(st);
    }
  }

  const underglowMat = curved(new MeshBasicMaterial({
    map: o.glowTex, color: new Color(o.glow).multiplyScalar(1.5), transparent: true, blending: AdditiveBlending,
    depthWrite: false, toneMapped: false, side: DoubleSide,
  }));
  const underglow = new Mesh(g.glowPlane, underglowMat);
  underglow.position.y = 0.04;
  underglow.renderOrder = 2;
  group.add(underglow);

  const rig: CarRig = { group, wheels, underglow, underglowMat, rimMat };

  if (o.police) {
    const red = curved(new MeshBasicMaterial({ color: new Color(3, 0.1, 0.15), toneMapped: false }));
    const blue = curved(new MeshBasicMaterial({ color: new Color(0.15, 0.4, 3.2), toneMapped: false }));
    for (const [side, mat] of [[-1, red], [1, blue]] as const) {
      const b = new Mesh(g.bar, mat);
      b.position.set(side * 0.28, 1.36, -0.35);
      group.add(b);
    }
    const glowMat = curved(new MeshBasicMaterial({
      map: o.glowTex, color: new Color(1, 0.2, 0.3), transparent: true, blending: AdditiveBlending,
      depthWrite: false, toneMapped: false, side: DoubleSide,
    }));
    const glow = new Mesh(g.glowPlane, glowMat);
    glow.scale.set(2.4, 1, 1.6);
    glow.position.y = 0.05;
    group.add(glow);
    rig.bar = { red, blue, glow, glowMat };
  }
  return rig;
}

export function disposeCar(rig: CarRig): void {
  rig.group.removeFromParent();
  rig.underglowMat.dispose();
  rig.rimMat.dispose();
  if (rig.bar) { rig.bar.red.dispose(); rig.bar.blue.dispose(); rig.bar.glowMat.dispose(); }
}
