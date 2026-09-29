/**
 * Level generation for FRAGNET: the classic corridor-shooter floorplan -
 * a handful of rectangular rooms connected by L-corridors, blast doors
 * where corridors meet rooms, a lit exit room in the far corner. Grid cells
 * are wall or floor (doors count as floor); a BFS validates that the exit
 * and every room are reachable before the level is accepted.
 */

export const WALL = 0, FLOOR = 1, DOOR = 2;
/** world units per cell */
export const CS = 2;
/** eye height as a share of wall height - the game's is 32/128 */
export const EYE = 1;
export const WALL_H = 4;

/**
 * A DOOM sector: one wall texture variant, one flat pair, one light level,
 * per-cell texture offsets. The renderer paints every face and floor from
 * the sector of the cell it belongs to.
 */
export interface CellStyle {
  role: number;                     // 0 tech, 1 brick, 2 hell (door/exit by key)
  texVar: number;                   // texture variant within the role pool
  floorFlat: string; ceilFlat: string;
  flatVar: number;
  light: number;                    // 0-255, straight through COLORMAP
  flicker: boolean;
  offX: number; offY: number;       // texture alignment in [0,1)
}

export interface Room { x: number; y: number; w: number; h: number; cx: number; cy: number; sector: CellStyle }
export interface DoorCell { x: number; y: number; open: number; kind: 'normal' | 'exit'; sealed: number }
export interface Level {
  w: number; h: number;
  grid: Uint8Array;
  rooms: Room[];
  doors: DoorCell[];
  spawn: [number, number];
  exit: [number, number];
  lamps: [number, number][];
  corridor: CellStyle;              // every floor cell outside a room
}

export const idxOf = (l: Level, x: number, y: number): number => y * l.w + x;
export const isFloor = (l: Level, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < l.w && y < l.h && l.grid[y * l.w + x] !== WALL;

export function genLevel(size: number, rand: () => number = Math.random): Level {
  for (let attempt = 0; attempt < 24; attempt++) {
    const l = tryLevel(size, rand);
    if (l && connected(l)) return l;
  }
  return tryLevel(size, rand)!;
}

function tryLevel(size: number, rand: () => number): Level | null {
  const w = size | 0, h = size | 0;
  const grid = new Uint8Array(w * h); // all wall
  const rooms: Room[] = [];
  const want = Math.max(5, Math.round(size / 3.4));
  for (let k = 0; k < want * 12 && rooms.length < want; k++) {
    const rw = 4 + ((rand() * 5) | 0), rh = 4 + ((rand() * 5) | 0);
    const x = 1 + ((rand() * (w - rw - 2)) | 0), y = 1 + ((rand() * (h - rh - 2)) | 0);
    if (rooms.some((o) => x < o.x + o.w + 2 && x + rw + 2 > o.x && y < o.y + o.h + 2 && y + rh + 2 > o.y)) continue;
    // every room its own DOOM sector: role, texture variant, flats, light
    const ri = rooms.length;
    const role = ri % 4 === 3 ? 2 : ri % 2 === 0 ? 0 : 1;
    const sector: CellStyle = {
      role, texVar: (rand() * 3) | 0,
      floorFlat: role === 2 ? 'hellFloor' : role === 0 ? 'techFloor' : 'floor',
      ceilFlat: role === 2 ? 'hellCeil' : 'ceil',
      flatVar: (rand() * 3) | 0,
      light: rand() < 0.12 ? 90 + ((rand() * 40) | 0) : 156 + ((rand() * 60) | 0),
      flicker: false, offX: rand(), offY: rand(),
    };
    rooms.push({ x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1), sector });
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) grid[j * w + i] = FLOOR;
  }
  if (rooms.length < 4) return null;

  const carve = (x: number, y: number) => { if (x > 0 && y > 0 && x < w - 1 && y < h - 1) grid[y * w + x] = FLOOR; };
  const corridor = (a: Room, b: Room) => {
    let x = a.cx, y = a.cy;
    const dx = Math.sign(b.cx - x), dy = Math.sign(b.cy - y);
    const horizontal = rand() < 0.5;
    if (horizontal) { while (x !== b.cx) { carve(x, y); x += dx; } while (y !== b.cy) { carve(x, y); y += dy; } }
    else { while (y !== b.cy) { carve(x, y); y += dy; } while (x !== b.cx) { carve(x, y); x += dx; } }
    carve(b.cx, b.cy);
  };
  for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
  for (let k = 0; k < Math.max(2, rooms.length >> 2); k++) {
    corridor(rooms[(rand() * rooms.length) | 0], rooms[(rand() * rooms.length) | 0]);
  }

  const corridorStyle: CellStyle = {
    role: 0, texVar: (rand() * 3) | 0,
    floorFlat: 'floor', ceilFlat: 'ceil', flatVar: (rand() * 3) | 0,
    light: 150, flicker: false, offX: rand(), offY: 0,
  };
  const l: Level = { w, h, grid, rooms, doors: [], spawn: [rooms[0].cx, rooms[0].cy], exit: [0, 0], lamps: [], corridor: corridorStyle };

  // blast doors: corridor cells that pass between two rooms wall to wall
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y * w + x] !== FLOOR) continue;
      const lr = grid[y * w + x - 1] === WALL && grid[y * w + x + 1] === WALL;
      const tb = grid[(y - 1) * w + x] === WALL && grid[(y + 1) * w + x] === WALL;
      if ((lr && isFloor(l, x, y - 1) && isFloor(l, x, y + 1)) || (tb && isFloor(l, x - 1, y) && isFloor(l, x + 1, y))) {
        if (rand() < 0.16) { l.doors.push({ x, y, open: 1, kind: 'normal', sealed: 0 }); grid[y * w + x] = DOOR; }
      }
    }
  }

  // wide halls: the game's corridors are two blocks across, so flare every
  // corridor cell out one step. Doors keep their pinch (cells touching a
  // door stay shut), rooms keep their footprint (interior cells never dilate)
  const spine: Array<[number, number]> = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y * w + x] !== FLOOR) continue;
      if (rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      spine.push([x, y]);
    }
  }
  for (const [x, y] of spine) {
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      if (grid[ny * w + nx] !== WALL) continue;
      if (l.doors.some((d) => Math.abs(d.x - nx) + Math.abs(d.y - ny) === 1)) continue;
      grid[ny * w + nx] = FLOOR;
    }
  }

  // exit: the room center farthest from spawn
  let best = rooms[rooms.length - 1], bd = -1;
  for (const r of rooms) {
    const d = Math.abs(r.cx - l.spawn[0]) + Math.abs(r.cy - l.spawn[1]);
    if (r !== rooms[0] && d > bd) { bd = d; best = r; }
  }
  l.exit = [best.cx, best.cy];
  best.sector = { role: 1, texVar: 0, floorFlat: 'exitFloor', ceilFlat: 'exitCeil', flatVar: 0, light: 244, flicker: false, offX: 0, offY: 0 };

  // lamps: every so often, a floor cell gets a ceiling light
  let floors = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] !== WALL) floors++;
  const wantLamps = Math.max(4, (floors / 16) | 0);
  for (let k = 0; k < wantLamps * 10 && l.lamps.length < wantLamps; k++) {
    const x = 1 + ((rand() * (w - 2)) | 0), y = 1 + ((rand() * (h - 2)) | 0);
    if (grid[y * w + x] !== FLOOR) continue;
    if (l.lamps.some(([lx, ly]) => Math.abs(lx - x) + Math.abs(ly - y) < 5)) continue;
    l.lamps.push([x, y]);
  }
  return l;
}

/** BFS reachability across floor cells; returns the parent map or null. */
function bfs(l: Level, sx: number, sy: number): Int32Array {
  const seen = new Int32Array(l.w * l.h).fill(-2);
  const q: number[] = [sy * l.w + sx];
  seen[sy * l.w + sx] = -1;
  while (q.length) {
    const c = q.shift()!;
    const x = c % l.w, y = (c / l.w) | 0;
    const around: Array<[number, number]> = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of around) {
      if (!isFloor(l, nx, ny)) continue;
      const n = ny * l.w + nx;
      if (seen[n] !== -2) continue;
      seen[n] = c;
      q.push(n);
    }
  }
  return seen;
}

function connected(l: Level): boolean {
  const seen = bfs(l, l.spawn[0], l.spawn[1]);
  return l.rooms.every((r) => seen[r.cy * l.w + r.cx] !== -2) && seen[l.exit[1] * l.w + l.exit[0]] >= -1;
}

/** Shortest cell path from (sx,sy) to (tx,ty), or null. */
export function findPath(l: Level, sx: number, sy: number, tx: number, ty: number): Array<[number, number]> | null {
  if (!isFloor(l, sx, sy) || !isFloor(l, tx, ty)) return null;
  const seen = bfs(l, sx, sy);
  const goal = ty * l.w + tx;
  if (seen[goal] === -2) return null;
  const out: Array<[number, number]> = [];
  let c = goal;
  while (c >= 0) { out.push([c % l.w, (c / l.w) | 0]); c = seen[c]; }
  out.reverse();
  return out;
}

/** Cell centers in ring order around (cx,cy) at BFS distance in [d0,d1]. */
export function cellsNear(l: Level, cx: number, cy: number, d0: number, d1: number): Array<[number, number]> {
  const seen = bfs(l, cx, cy);
  const dist = (c: number): number => {
    let n = 0, cur = c;
    while (seen[cur] >= 0 && n < 99) { cur = seen[cur]; n++; }
    return cur === cy * l.w + cx ? n : 99;
  };
  const out: Array<[number, number]> = [];
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === -2) continue;
    const d = dist(i);
    if (d >= d0 && d <= d1) out.push([i % l.w, (i / l.w) | 0]);
  }
  return out;
}
