// Model edits that must keep rooms, walls, openings and items consistent with each other.
// All functions mutate the given project (call them inside store.update) and are unit-tested.
import { bounds, cross, dist, pointInPolygon, sub } from './geometry';
import { uid, type Item, type Opening, type Project, type Room, type Vec2 } from './model';

const room = (p: Project, id: string) => p.rooms.find((r) => r.id === id);

function wallLength(r: Room, i: number) {
  const a = r.points[i];
  const b = r.points[(i + 1) % r.points.length];
  return Math.hypot(b.x - a.x, b.z - a.z);
}

// ---------------------------------------------------------------------------
// Openings

/** Keep an opening fully on its wall (shrinking it if the wall is shorter). */
export function clampOpening(o: Opening, wallLen: number) {
  o.width = Math.min(o.width, Math.max(0.1, wallLen - 0.02));
  o.offset = Math.max(o.width / 2, Math.min(wallLen - o.width / 2, o.offset));
}

export function clampRoomOpenings(p: Project, roomId: string) {
  const r = room(p, roomId);
  if (!r) return;
  for (const o of p.openings) if (o.roomId === roomId && o.wallIndex < r.points.length) clampOpening(o, wallLength(r, o.wallIndex));
}

/**
 * Center of the first stretch of the wall that can take an opening of `width` without overlapping
 * existing openings (with `gap` clearance). Null when the wall is full.
 */
export function freeOpeningOffset(p: Project, r: Room, wallIndex: number, width: number, gap = 0.1): number | null {
  const L = wallLength(r, wallIndex);
  const taken = p.openings
    .filter((o) => o.roomId === r.id && o.wallIndex === wallIndex)
    .map((o) => [o.offset - o.width / 2 - gap, o.offset + o.width / 2 + gap] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  // prefer the middle of the wall when it's free
  const mid = L / 2;
  const fits = (c: number) => c - width / 2 >= 0.05 && c + width / 2 <= L - 0.05 && taken.every(([s, e]) => c + width / 2 <= s || c - width / 2 >= e);
  if (fits(mid)) return mid;
  let start = 0.05;
  for (const [s, e] of [...taken, [L - 0.05, L] as [number, number]]) {
    if (s - start >= width) return start + width / 2;
    start = Math.max(start, e);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Walls

/** Insert a corner in the middle of a wall, keeping per-wall data and openings on the right walls. */
export function splitWall(p: Project, roomId: string, index: number) {
  const r = room(p, roomId);
  if (!r) return;
  const n = r.points.length;
  const L = wallLength(r, index);
  const a = r.points[index];
  const b = r.points[(index + 1) % n];
  r.points.splice(index + 1, 0, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  // per-wall settings above the split move up by one; the new half inherits the split wall's
  const colors: Record<number, string> = {};
  for (const [k, v] of Object.entries(r.wallColors)) {
    const i = Number(k);
    colors[i > index ? i + 1 : i] = v;
    if (i === index) colors[index + 1] = v;
  }
  r.wallColors = colors;
  r.hiddenWalls = r.hiddenWalls.flatMap((i) => (i > index ? [i + 1] : i === index ? [i, i + 1] : [i]));
  const half = L / 2;
  for (const o of p.openings) {
    if (o.roomId !== roomId) continue;
    if (o.wallIndex > index) o.wallIndex++;
    else if (o.wallIndex === index && o.offset > half) {
      o.wallIndex = index + 1;
      o.offset -= half;
    }
    if (o.wallIndex === index || o.wallIndex === index + 1) clampOpening(o, half);
  }
}

/** Only true rectangles (4 right angles) move the opposite wall when a wall's length changes. */
export function isRectangle(pts: Vec2[], tol = 1e-3): boolean {
  if (pts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = sub(pts[(i + 1) % 4], pts[i]);
    const b = sub(pts[(i + 2) % 4], pts[(i + 1) % 4]);
    const la = Math.hypot(a.x, a.z);
    const lb = Math.hypot(b.x, b.z);
    if (la < 1e-6 || lb < 1e-6) return false;
    if (Math.abs((a.x * b.x + a.z * b.z) / (la * lb)) > tol) return false;
  }
  return true;
}

export function setWallLength(p: Project, roomId: string, index: number, L: number) {
  const r = room(p, roomId);
  if (!r) return;
  const n = r.points.length;
  const a = r.points[index];
  const b = r.points[(index + 1) % n];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nb = { x: a.x + ((b.x - a.x) / l) * L, z: a.z + ((b.z - a.z) / l) * L };
  const delta = { x: nb.x - b.x, z: nb.z - b.z };
  if (isRectangle(r.points)) {
    const j = (index + 2) % n;
    r.points[(index + 1) % n] = nb;
    r.points[j] = { x: r.points[j].x + delta.x, z: r.points[j].z + delta.z };
  } else r.points[(index + 1) % n] = nb;
  clampRoomOpenings(p, roomId);
}

// ---------------------------------------------------------------------------
// Rooms

export function itemsInRoom(p: Project, r: Room): Item[] {
  return p.items.filter((i) => pointInPolygon({ x: i.x, z: i.z }, r.points));
}

/** Scale a room from its min corner; furniture inside keeps its relative position; openings stay on their walls. */
export function scaleRoom(p: Project, roomId: string, sx: number, sz: number) {
  const r = room(p, roomId);
  if (!r) return;
  const b = bounds(r.points);
  const inside = itemsInRoom(p, r);
  const map = (q: Vec2) => ({ x: b.minX + (q.x - b.minX) * sx, z: b.minZ + (q.z - b.minZ) * sz });
  const before = r.points.map((q) => ({ ...q }));
  r.points = r.points.map(map);
  for (const it of inside) Object.assign(it, map(it));
  // openings keep their relative position along the wall
  for (const o of p.openings) {
    if (o.roomId !== roomId) continue;
    const oldL = Math.hypot(before[(o.wallIndex + 1) % before.length].x - before[o.wallIndex].x, before[(o.wallIndex + 1) % before.length].z - before[o.wallIndex].z) || 1;
    o.offset *= wallLength(r, o.wallIndex) / oldL;
  }
  clampRoomOpenings(p, roomId);
}

export function moveRoom(p: Project, roomId: string, dx: number, dz: number) {
  const r = room(p, roomId);
  if (!r) return;
  const inside = itemsInRoom(p, r);
  r.points = r.points.map((q) => ({ x: q.x + dx, z: q.z + dz }));
  for (const it of inside) {
    it.x += dx;
    it.z += dz;
  }
}

/** Delete a room together with its openings and the furniture standing in it. */
export function deleteRoom(p: Project, roomId: string) {
  const r = room(p, roomId);
  if (!r) return;
  const inside = new Set(itemsInRoom(p, r).map((i) => i.id));
  p.items = p.items.filter((i) => !inside.has(i.id));
  p.openings = p.openings.filter((o) => o.roomId !== roomId);
  p.rooms = p.rooms.filter((q) => q.id !== roomId);
}

/** Copy a room (with openings and furniture) shifted by dx/dz. Returns the new room. */
export function duplicateRoom(p: Project, roomId: string, dx: number, dz = 0): Room | undefined {
  const r = room(p, roomId);
  if (!r) return undefined;
  const copy: Room = JSON.parse(JSON.stringify(r));
  copy.id = uid('room');
  copy.name = `${r.name} copy`;
  copy.points = copy.points.map((q) => ({ x: q.x + dx, z: q.z + dz }));
  const items = itemsInRoom(p, r).map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: uid('item'), x: i.x + dx, z: i.z + dz }) as Item);
  const openings = p.openings.filter((o) => o.roomId === roomId).map((o) => ({ ...o, id: uid('op'), roomId: copy.id }));
  p.rooms.push(copy);
  p.items.push(...items);
  p.openings.push(...openings);
  return copy;
}

// ---------------------------------------------------------------------------
// Drawing

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Clean up a drawn polygon: drop repeated points (double-click adds one) and a closing point equal to the
 * first; reject fewer than 3 corners, near-zero walls and self-crossing outlines.
 */
export function finishPolygon(input: Vec2[], minWall = 0.05): { points: Vec2[] } | { error: string } {
  const pts: Vec2[] = [];
  for (const q of input) if (!pts.length || dist(pts[pts.length - 1], q) >= minWall) pts.push({ ...q });
  while (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < minWall) pts.pop();
  if (pts.length < 3) return { error: 'A room needs at least 3 corners.' };
  const n = pts.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return { error: 'Walls cross each other – draw the outline without crossings.' };
    }
  // collinear-only outline has no area
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].z - pts[(i + 1) % n].x * pts[i].z;
  if (Math.abs(area) / 2 < 0.05) return { error: 'That outline has no floor area.' };
  return { points: pts };
}

