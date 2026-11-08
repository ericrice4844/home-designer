// Wall elevation: what is mounted on / standing against one wall, laid out as seen from inside the room.
// Pure (no DOM / three) so it is unit-tested; ui/elevation.ts draws it.
import { isCeilingMounted } from './catalog';
import { add, ceilingHeightAt, dot, itemOutline, openingsForWall, pointInPolygon, roomAt, roomWalls, scale, sub, type Wall } from './geometry';
import type { Item, OpeningType, Project, Room, Vec2 } from './model';

/** How far from the wall face an item may be and still count as "on" the wall (m). */
export const WALL_TOUCH = 0.15;

export interface ElevationItem {
  item: Item;
  /** left/right extent along the wall, measured from the left end as seen from inside the room (m) */
  s0: number;
  s1: number;
  /** bottom / top above the room floor (m) */
  y0: number;
  y1: number;
  /** how far it sticks out from the wall face (m) */
  depth: number;
  /** floor-standing (bases, appliances, toilets…) vs wall-hung (uppers, mirrors, hood…) */
  row: 'floor' | 'wall' | 'tall';
  /** clear distance between the wall face and the item (≈0 when it is against the wall) */
  gap: number;
  /** a free-standing item shown on this wall only because it was asked for (not against the wall) */
  projected: boolean;
  /** the item's plan position/height when this elevation was computed (moves are relative to it) */
  at: { x: number; z: number; y: number };
}

export interface ElevationOpening {
  id: string;
  type: OpeningType;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

export interface Elevation {
  room: Room;
  wall: Wall;
  /** interior length of the wall face (m) */
  length: number;
  /** ceiling height along the wall: [s, height] samples, left to right */
  ceiling: [number, number][];
  items: ElevationItem[];
  openings: ElevationOpening[];
  /** dimension chains (left→right): alternating gaps and pieces, each [s0, s1] */
  floorChain: [number, number][];
  wallChain: [number, number][];
  /** plan-space frame: s = dot(p, right) − sMin; distance from the wall = dot(p − faceA, inward) */
  frame: { right: Vec2; sMin: number; faceA: Vec2 };
}

/**
 * Lay out one wall as seen standing in the room facing it.
 * `s` runs left → right across the wall's interior face (between the neighbouring walls' faces).
 */
export function wallElevation(project: Project, roomId: string, wallIndex: number, opts: { include?: string[] } = {}): Elevation | null {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const walls = roomWalls(room);
  const wall = walls.find((w) => w.index === wallIndex);
  if (!wall) return null;
  const t = room.wallThickness / 2;
  // facing the wall means looking along -inward; "right" is that direction turned clockwise on the plan
  const right = { x: wall.inward.z, z: -wall.inward.x };
  const faceA = add(wall.a, scale(wall.inward, t));
  const faceB = add(wall.b, scale(wall.inward, t));
  // interior face runs between the faces of the neighbouring walls (≈ t in from each end for square corners)
  const sa = dot(faceA, right);
  const sb = dot(faceB, right);
  const sMin = Math.min(sa, sb) + t;
  const sMax = Math.max(sa, sb) - t;
  const length = Math.max(0, sMax - sMin);
  const along = (p: Vec2) => dot(p, right) - sMin;
  const out = (p: Vec2) => dot(sub(p, faceA), wall.inward); // distance in front of the wall face

  const items: ElevationItem[] = [];
  for (const it of project.items) {
    if (isCeilingMounted(it.kind) || it.kind === 'rug') continue;
    const outline = itemOutline(it);
    const outs = outline.map(out);
    const nearest = Math.min(...outs);
    if (Math.max(...outs) < -0.05) continue; // behind the wall
    const projected = nearest > WALL_TOUCH;
    // not against this wall: only shown when asked for, and only if it is in this room
    if (projected && !(opts.include?.includes(it.id) && pointInPolygon({ x: it.x, z: it.z }, room.points))) continue;
    const ss = outline.map(along);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    if (s1 <= 0.01 || s0 >= length - 0.01) continue; // beside the wall, not in front of it
    const y0 = it.y;
    const y1 = it.y + it.height;
    const row: ElevationItem['row'] = y0 > 0.9 ? 'wall' : y1 > 1.6 && y0 < 0.3 ? 'tall' : 'floor';
    items.push({ item: it, s0: Math.max(0, s0), s1: Math.min(length, s1), y0, y1, depth: Math.max(...outs) - Math.max(0, nearest), row, gap: Math.max(0, nearest), projected, at: { x: it.x, z: it.z, y: it.y } });
  }
  items.sort((a, b) => a.s0 - b.s0 || a.y0 - b.y0);

  const openings: ElevationOpening[] = [];
  for (const wo of openingsForWall(project, wall)) {
    // wo.u is along the wall's own direction from wall.a (centerline); convert to the left→right face coordinate
    const pa = add(wall.a, scale(wall.dir, wo.u0));
    const pb = add(wall.a, scale(wall.dir, wo.u1));
    const s0 = Math.min(along(pa), along(pb));
    const s1 = Math.max(along(pa), along(pb));
    openings.push({ id: wo.opening.id, type: wo.opening.type, s0: Math.max(0, s0), s1: Math.min(length, s1), y0: wo.opening.sill, y1: wo.opening.sill + wo.opening.height });
  }
  openings.sort((a, b) => a.s0 - b.s0);

  const ceiling: [number, number][] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const s = (length * i) / N;
    // point on the wall face whose left→right coordinate is s
    const p = add(faceA, scale(wall.dir, (s - along(faceA)) * dot(wall.dir, right)));
    ceiling.push([s, ceilingHeightAt(room, p)]);
  }

  const chain = (pieces: { s0: number; s1: number }[]): [number, number][] => {
    const res: [number, number][] = [];
    let s = 0;
    // merge overlapping pieces (e.g. a cooktop sitting on a base) so the chain stays readable
    const merged: [number, number][] = [];
    for (const p of [...pieces].sort((a, b) => a.s0 - b.s0)) {
      const last = merged[merged.length - 1];
      if (last && p.s0 < last[1] - 0.005) last[1] = Math.max(last[1], p.s1);
      else merged.push([p.s0, p.s1]);
    }
    for (const [a, b] of merged) {
      if (a - s > 0.005) res.push([s, a]);
      res.push([a, b]);
      s = b;
    }
    if (length - s > 0.005) res.push([s, length]);
    return res;
  };
  const onWall = items.filter((i) => !i.projected);
  const floorPieces = [...onWall.filter((i) => i.row !== 'wall'), ...openings.filter((o) => o.y0 < 0.05)];
  const wallPieces = [...onWall.filter((i) => i.row !== 'floor'), ...openings.filter((o) => o.y0 >= 0.05)];
  return { room, wall, length, ceiling, items, openings, floorChain: chain(floorPieces), wallChain: chain(wallPieces), frame: { right, sMin, faceA } };
}

/** Walls of a room in order, for stepping around it in the elevation view. */
export function neighbourWall(room: Room, wallIndex: number, step: 1 | -1): number {
  const walls = roomWalls(room).map((w) => w.index);
  const i = walls.indexOf(wallIndex);
  return walls[(i + step + walls.length) % walls.length];
}

// ---------------------------------------------------------------------------
// Picking a wall and moving pieces on it

/** Compass name of a wall as seen from inside the room ("North wall" is the one you face looking north). */
export function wallLabel(room: Room, wallIndex: number): string {
  const w = roomWalls(room).find((q) => q.index === wallIndex);
  if (!w) return `Wall ${wallIndex + 1}`;
  const out = { x: -w.inward.x, z: -w.inward.z }; // plan: x east, z south
  const deg = (Math.atan2(-out.z, out.x) * 180) / Math.PI; // 0 = east, 90 = north
  const names = ['East', 'North-east', 'North', 'North-west', 'West', 'South-west', 'South', 'South-east'];
  return `${names[(Math.round(((deg + 360) % 360) / 45) % 8)]} wall`;
}

/** The wall an item stands or hangs against (the closest one it touches), if any. */
export function itemWall(project: Project, item: Item): { roomId: string; index: number } | null {
  const room = roomAt(project, { x: item.x, z: item.z });
  if (!room) return null;
  let best: { roomId: string; index: number; gap: number } | null = null;
  for (const w of roomWalls(room)) {
    const el = wallElevation(project, room.id, w.index);
    const e = el?.items.find((i) => i.item.id === item.id);
    if (e && !e.projected && (!best || e.gap < best.gap)) best = { roomId: room.id, index: w.index, gap: e.gap };
  }
  return best && { roomId: best.roomId, index: best.index };
}

/** The room's walls ordered by distance from an item – for "which wall do you want to look at?". */
export function wallsByDistance(project: Project, item: Item): { roomId: string; index: number; label: string; distance: number; length: number }[] {
  const room = roomAt(project, { x: item.x, z: item.z });
  if (!room) return [];
  return roomWalls(room)
    .map((w) => {
      const face = add(w.a, scale(w.inward, room.wallThickness / 2));
      const distance = Math.max(0, Math.min(...itemOutline(item).map((p) => dot(sub(p, face), w.inward))));
      return { roomId: room.id, index: w.index, label: wallLabel(room, w.index), distance, length: w.length - room.wallThickness };
    })
    .sort((a, b) => a.distance - b.distance);
}

export interface WallSnap {
  s0: number;
  y0: number;
  /** guide lines to draw: vertical at s, horizontal at y */
  guides: { s?: number; y?: number }[];
}

const STANDARD_HEIGHTS = [54 * 0.0254, 40 * 0.0254, 36 * 0.0254]; // upper-cabinet bottom, mirror/vanity light, counter

/**
 * Snap a dragged piece (left edge s0, bottom y0): flush against neighbours, aligned with their edges or
 * centres (a mirror over a vanity), to the wall ends and openings; wall-hung pieces also to neighbours'
 * heights and standard heights. `tol` is in meters.
 */
export function snapOnWall(el: Elevation, itemId: string, s0: number, y0: number, tol: number): WallSnap {
  const me = el.items.find((i) => i.item.id === itemId);
  if (!me) return { s0, y0, guides: [] };
  const w = me.s1 - me.s0;
  const h = me.y1 - me.y0;
  const others = el.items.filter((i) => i.item.id !== itemId && !i.projected);
  const vOverlap = (o: { y0: number; y1: number }, yy: number) => o.y0 < yy + h - 0.01 && o.y1 > yy + 0.01;
  // horizontal candidates: [value for s0, guide position]
  const cands: [number, number][] = [
    [0, 0],
    [el.length - w, el.length],
  ];
  for (const o of others) {
    const c = (o.s0 + o.s1) / 2;
    cands.push([c - w / 2, c]); // centred on it
    cands.push([o.s0, o.s0], [o.s1 - w, o.s1]); // edges aligned
    if (vOverlap(o, y0) || me.row === o.row) cands.push([o.s1, o.s1], [o.s0 - w, o.s0]); // butted against it
  }
  for (const o of el.openings) cands.push([o.s0, o.s0], [o.s1 - w, o.s1], [(o.s0 + o.s1) / 2 - w / 2, (o.s0 + o.s1) / 2]);
  let bestS: [number, number] | null = null;
  for (const c of cands) if (Math.abs(c[0] - s0) <= tol && (!bestS || Math.abs(c[0] - s0) < Math.abs(bestS[0] - s0))) bestS = c;
  const guides: WallSnap['guides'] = [];
  let ns = Math.max(0, Math.min(el.length - w, bestS ? bestS[0] : s0));
  if (bestS) guides.push({ s: bestS[1] });
  let ny = me.y0;
  if (canLift(me)) {
    const ycands: [number, number][] = STANDARD_HEIGHTS.map((v) => [v, v]);
    for (const o of others) {
      if (o.row === 'floor') continue;
      ycands.push([o.y0, o.y0], [o.y1 - h, o.y1]);
    }
    let bestY: [number, number] | null = null;
    for (const c of ycands) if (Math.abs(c[0] - y0) <= tol && (!bestY || Math.abs(c[0] - y0) < Math.abs(bestY[0] - y0))) bestY = c;
    ny = bestY ? bestY[0] : y0;
    if (bestY) guides.push({ y: bestY[1] });
    const top = Math.min(...el.ceiling.map(([, c]) => c));
    ny = Math.max(0, Math.min(top - h, ny));
  }
  ns = Math.max(0, Math.min(el.length - w, ns));
  return { s0: ns, y0: ny, guides };
}

/** Wall-hung pieces (and anything already off the floor) can be moved up and down; floor pieces stay down. */
export function canLift(e: ElevationItem): boolean {
  return e.row === 'wall' || e.y0 > 0.05;
}

/** Does the piece at (s0, y0) collide with another piece on the wall? */
export function overlapsOnWall(el: Elevation, itemId: string, s0: number, y0: number): boolean {
  const me = el.items.find((i) => i.item.id === itemId);
  if (!me) return false;
  const w = me.s1 - me.s0;
  const h = me.y1 - me.y0;
  return el.items.some((o) => o.item.id !== itemId && !o.projected && o.s0 < s0 + w - 0.005 && o.s1 > s0 + 0.005 && o.y0 < y0 + h - 0.005 && o.y1 > y0 + 0.005);
}

/**
 * Move a piece to left edge s0 / bottom y0 on the wall (parallel to the wall – its distance from the wall
 * doesn't change). `el` is the elevation from when the drag started. Mutates the project's item.
 */
export function moveOnWall(project: Project, el: Elevation, itemId: string, s0: number, y0?: number) {
  const me = el.items.find((i) => i.item.id === itemId);
  const it = project.items.find((i) => i.id === itemId);
  if (!me || !it) return;
  const w = me.s1 - me.s0;
  const target = Math.max(0, Math.min(el.length - w, s0));
  const ds = target - me.s0;
  const r = el.frame.right;
  // relative to where it was when the drag started (me.item is the live object and changes as we move it)
  it.x = me.at.x + r.x * ds;
  it.z = me.at.z + r.z * ds;
  if (y0 !== undefined && canLift(me)) it.y = Math.max(0, y0);
}

/** Put a free-standing item against a wall: back to the wall, facing into the room, same left/right spot. */
export function anchorToWall(project: Project, itemId: string, roomId: string, index: number) {
  const room = project.rooms.find((r) => r.id === roomId);
  const it = project.items.find((i) => i.id === itemId);
  const w = room && roomWalls(room).find((q) => q.index === index);
  if (!room || !it || !w) return;
  const el = wallElevation(project, roomId, index, { include: [itemId] });
  const me = el?.items.find((i) => i.item.id === itemId);
  if (!el) return;
  it.rotation = Math.atan2(-w.inward.x, w.inward.z); // front (+z local) faces into the room
  // keep its left/right position (centre), clamped so it fits on the wall
  const centre = me ? (me.s0 + me.s1) / 2 : el.length / 2;
  const s = Math.max(it.width / 2, Math.min(el.length - it.width / 2, centre));
  const { right, sMin, faceA } = el.frame;
  const along0 = dot(faceA, right) - sMin;
  const onFace = add(faceA, scale(right, s - along0));
  const p = add(onFace, scale(w.inward, it.depth / 2));
  it.x = p.x;
  it.z = p.z;
}
