import type { Item, Opening, Project, Room, Vec2 } from './model';

export const EPS = 1e-6;

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}
export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, z: a.z * s };
}
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.z - a.z * b.x;
}
export function len(a: Vec2): number {
  return Math.hypot(a.x, a.z);
}
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function norm(a: Vec2): Vec2 {
  const l = len(a) || 1;
  return { x: a.x / l, z: a.z / l };
}
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
export function rotate(a: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.z * s, z: a.x * s + a.z * c };
}

/** Signed area; positive when points are clockwise on screen (x right, z down) */
export function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function area(pts: Vec2[]): number {
  return Math.abs(signedArea(pts));
}

export function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < EPS) {
    const s = pts.reduce((acc, p) => add(acc, p), { x: 0, z: 0 });
    return scale(s, 1 / Math.max(1, pts.length));
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function bounds(pts: Vec2[]) {
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface Wall {
  roomId: string;
  index: number;
  a: Vec2;
  b: Vec2;
  length: number;
  dir: Vec2;
  /** Unit normal pointing into the room. */
  inward: Vec2;
}

export function roomWalls(room: Room): Wall[] {
  const pts = room.points;
  const cw = signedArea(pts) > 0;
  const walls: Wall[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = sub(b, a);
    const l = len(d);
    if (l < EPS) continue;
    const dir = scale(d, 1 / l);
    // With x right / z down, clockwise polygon => interior is to the right of travel direction.
    const right = { x: -dir.z, z: dir.x };
    const inward = cw ? right : scale(right, -1);
    walls.push({ roomId: room.id, index: i, a, b, length: l, dir, inward });
  }
  return walls;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 < EPS ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = lerp(a, b, t);
  return { point, t, dist: dist(p, point) };
}

/** Ceiling height above the room floor at a given plan point. */
export function ceilingHeightAt(room: Room, p: Vec2): number {
  const c = room.ceiling;
  const H = room.wallHeight;
  const peak = Math.max(H, c.peakHeight);
  if (c.type === 'flat' || c.type === 'tray') return H; // tray raised part is handled separately
  const b = projectedRange(room.points, c.angle);
  const dir = { x: Math.cos(c.angle), z: Math.sin(c.angle) };
  if (c.type === 'shed') {
    const span = b.max - b.min || 1;
    const t = (dot(p, dir) - b.min) / span;
    return H + (peak - H) * Math.max(0, Math.min(1, t));
  }
  // gable: ridge runs along `angle`; height varies across the perpendicular axis
  const perp = { x: -dir.z, z: dir.x };
  const r = projectedRange(room.points, c.angle + Math.PI / 2);
  const mid = (r.min + r.max) / 2;
  const half = (r.max - r.min) / 2 || 1;
  const t = Math.abs(dot(p, perp) - mid) / half;
  return peak - (peak - H) * Math.max(0, Math.min(1, t));
}

export function projectedRange(pts: Vec2[], angle: number) {
  const dir = { x: Math.cos(angle), z: Math.sin(angle) };
  let min = Infinity,
    max = -Infinity;
  for (const p of pts) {
    const d = dot(p, dir);
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
}

export function maxCeilingHeight(room: Room): number {
  if (room.ceiling.type === 'flat') return room.wallHeight;
  return Math.max(room.wallHeight, room.ceiling.peakHeight);
}

/** Clip a polygon against the half plane dot(p, n) <= c (Sutherland–Hodgman). */
export function clipHalfPlane(pts: Vec2[], n: Vec2, c: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dp = dot(p, n) - c;
    const dq = dot(q, n) - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) out.push(lerp(p, q, dp / (dp - dq)));
  }
  return out;
}

/** Inset a simple polygon by a distance (works well for convex / mildly concave rooms). */
export function insetPolygon(pts: Vec2[], d: number): Vec2[] {
  const cw = signedArea(pts) > 0;
  const n = pts.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    const n1 = cw ? { x: -d1.z, z: d1.x } : { x: d1.z, z: -d1.x };
    const n2 = cw ? { x: -d2.z, z: d2.x } : { x: d2.z, z: -d2.x };
    const bis = norm(add(n1, n2));
    const cosHalf = Math.max(0.2, dot(bis, n1));
    out.push(add(cur, scale(bis, d / cosHalf)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Openings

export interface WallOpening {
  opening: Opening;
  /** Start / end along this wall (m from wall.a). */
  u0: number;
  u1: number;
}

/**
 * Collect openings affecting a wall – including openings defined on a coincident wall of
 * another room, so a door between two rooms cuts through both walls.
 */
export function openingsForWall(project: Project, wall: Wall): WallOpening[] {
  const result: WallOpening[] = [];
  for (const o of project.openings) {
    const room = project.rooms.find((r) => r.id === o.roomId);
    if (!room) continue;
    const src = roomWalls(room).find((w) => w.index === o.wallIndex);
    if (!src) continue;
    const center = add(src.a, scale(src.dir, o.offset));
    if (src.roomId === wall.roomId && src.index === wall.index) {
      result.push({ opening: o, u0: o.offset - o.width / 2, u1: o.offset + o.width / 2 });
      continue;
    }
    // coincident & parallel?
    if (Math.abs(cross(src.dir, wall.dir)) > 0.02) continue;
    const cp = closestPointOnSegment(center, wall.a, wall.b);
    const tolerance = Math.max(0.05, (getRoomThickness(project, wall.roomId) + room.wallThickness) / 2 + 0.02);
    if (cp.dist > tolerance) continue;
    const u = cp.t * wall.length;
    if (u < 0.01 || u > wall.length - 0.01) continue;
    result.push({ opening: o, u0: u - o.width / 2, u1: u + o.width / 2 });
  }
  return result
    .map((r) => ({ ...r, u0: Math.max(0, r.u0), u1: Math.min(wall.length, r.u1) }))
    .filter((r) => r.u1 - r.u0 > 0.01)
    .sort((a, b) => a.u0 - b.u0);
}

function getRoomThickness(project: Project, roomId: string): number {
  return project.rooms.find((r) => r.id === roomId)?.wallThickness ?? 0.12;
}

/** World-space position (center bottom) and direction of an opening. */
export function openingFrame(project: Project, o: Opening) {
  const room = project.rooms.find((r) => r.id === o.roomId);
  if (!room) return null;
  const wall = roomWalls(room).find((w) => w.index === o.wallIndex);
  if (!wall) return null;
  const center = add(wall.a, scale(wall.dir, o.offset));
  return { room, wall, center };
}

// ---------------------------------------------------------------------------
// Items

/** Corners of an item's rotated footprint. */
export function itemCorners(it: Pick<Item, 'x' | 'z' | 'width' | 'depth' | 'rotation'>): Vec2[] {
  const hw = it.width / 2;
  const hd = it.depth / 2;
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((c) => add(rotate(c, it.rotation), { x: it.x, z: it.z }));
}

export function itemAABB(it: Pick<Item, 'x' | 'z' | 'width' | 'depth' | 'rotation'>) {
  return bounds(itemCorners(it));
}

export function pointInItem(p: Vec2, it: Item): boolean {
  const local = rotate(sub(p, { x: it.x, z: it.z }), -it.rotation);
  return Math.abs(local.x) <= it.width / 2 && Math.abs(local.z) <= it.depth / 2;
}

export function roomAt(project: Project, p: Vec2): Room | undefined {
  // smallest containing room wins (handles nested rooms such as closets)
  let best: Room | undefined;
  let bestArea = Infinity;
  for (const r of project.rooms) {
    if (r.points.length >= 3 && pointInPolygon(p, r.points)) {
      const a = area(r.points);
      if (a < bestArea) {
        best = r;
        bestArea = a;
      }
    }
  }
  return best;
}

export interface Clearance {
  from: Vec2;
  to: Vec2;
  distance: number;
  /** what the clearance runs to */
  target: 'wall' | 'item';
  targetId?: string;
}

/**
 * Measure free space from an item outward in its 4 local directions (front/back/left/right)
 * to the nearest wall or other item. Uses ray casting from each side's midpoint.
 */
export function itemClearances(project: Project, item: Item, maxDist = 6): Clearance[] {
  const res: Clearance[] = [];
  const sides: { local: Vec2; dir: Vec2 }[] = [
    { local: { x: 0, z: item.depth / 2 }, dir: { x: 0, z: 1 } },
    { local: { x: 0, z: -item.depth / 2 }, dir: { x: 0, z: -1 } },
    { local: { x: item.width / 2, z: 0 }, dir: { x: 1, z: 0 } },
    { local: { x: -item.width / 2, z: 0 }, dir: { x: -1, z: 0 } },
  ];
  const segments: { a: Vec2; b: Vec2; target: 'wall' | 'item'; id?: string; yMin: number; yMax: number }[] = [];
  for (const r of project.rooms) {
    for (const w of roomWalls(r)) {
      const off = scale(w.inward, r.wallThickness / 2);
      segments.push({ a: add(w.a, off), b: add(w.b, off), target: 'wall', id: r.id, yMin: -1, yMax: 99 });
    }
  }
  for (const o of project.items) {
    if (o.id === item.id) continue;
    // only consider items that overlap vertically
    const yMin = o.y;
    const yMax = o.y + o.height;
    if (yMax <= item.y + 0.01 || yMin >= item.y + item.height - 0.01) continue;
    const c = itemCorners(o);
    for (let i = 0; i < 4; i++) segments.push({ a: c[i], b: c[(i + 1) % 4], target: 'item', id: o.id, yMin, yMax });
  }
  for (const s of sides) {
    const origin = add(rotate(s.local, item.rotation), { x: item.x, z: item.z });
    const dir = rotate(s.dir, item.rotation);
    let best = maxDist;
    let hit: (typeof segments)[number] | null = null;
    for (const seg of segments) {
      const t = raySegment(origin, dir, seg.a, seg.b);
      if (t !== null && t > -0.005 && t < best) {
        best = Math.max(0, t);
        hit = seg;
      }
    }
    if (hit) res.push({ from: origin, to: add(origin, scale(dir, best)), distance: best, target: hit.target, targetId: hit.id });
  }
  return res;
}

/** Ray (origin + t*dir) vs segment; returns t or null. */
export function raySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const e = sub(b, a);
  const den = cross(d, e);
  if (Math.abs(den) < EPS) return null;
  const ao = sub(a, o);
  const t = cross(ao, e) / den;
  const u = cross(ao, d) / den;
  if (u < -1e-4 || u > 1 + 1e-4) return null;
  return t;
}

/**
 * Snap an item so its back is flush against the nearest wall (within threshold), rotated
 * to face into the room. Returns null when no wall is close enough.
 */
export function snapItemToWall(project: Project, item: Item, threshold = 0.25): { x: number; z: number; rotation: number } | null {
  let best: { x: number; z: number; rotation: number; d: number } | null = null;
  for (const r of project.rooms) {
    for (const w of roomWalls(r)) {
      const innerA = add(w.a, scale(w.inward, r.wallThickness / 2));
      const innerB = add(w.b, scale(w.inward, r.wallThickness / 2));
      const cp = closestPointOnSegment({ x: item.x, z: item.z }, innerA, innerB);
      // distance from wall to the back of the item if it were facing the room
      const gap = cp.dist - item.depth / 2;
      if (Math.abs(gap) > threshold) continue;
      if (cp.t <= 0 || cp.t >= 1) continue;
      // ensure the item is on the inside of the wall
      if (dot(sub({ x: item.x, z: item.z }, innerA), w.inward) < -0.05) continue;
      const rotation = Math.atan2(-w.inward.x, w.inward.z); // local +z (front) faces inward
      const pos = add(cp.point, scale(w.inward, item.depth / 2));
      // keep the item within the wall length
      const along = dot(sub(pos, innerA), w.dir);
      const clamped = Math.max(item.width / 2, Math.min(w.length - item.width / 2, along));
      const p2 = add(add(innerA, scale(w.dir, clamped)), scale(w.inward, item.depth / 2));
      if (!best || Math.abs(gap) < best.d) best = { x: p2.x, z: p2.z, rotation, d: Math.abs(gap) };
    }
  }
  return best ? { x: best.x, z: best.z, rotation: best.rotation } : null;
}

export function snapValue(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
