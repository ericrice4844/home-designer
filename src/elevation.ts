// Wall elevation: what is mounted on / standing against one wall, laid out as seen from inside the room.
// Pure (no DOM / three) so it is unit-tested; ui/elevation.ts draws it.
import { isCeilingMounted } from './catalog';
import { add, ceilingHeightAt, dot, itemOutline, openingsForWall, roomWalls, scale, sub, type Wall } from './geometry';
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
}

/**
 * Lay out one wall as seen standing in the room facing it.
 * `s` runs left → right across the wall's interior face (between the neighbouring walls' faces).
 */
export function wallElevation(project: Project, roomId: string, wallIndex: number): Elevation | null {
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
    if (nearest > WALL_TOUCH || Math.max(...outs) < -0.05) continue; // not against this wall (or behind it)
    const ss = outline.map(along);
    const s0 = Math.min(...ss);
    const s1 = Math.max(...ss);
    if (s1 <= 0.01 || s0 >= length - 0.01) continue; // beside the wall, not in front of it
    const y0 = it.y;
    const y1 = it.y + it.height;
    const row: ElevationItem['row'] = y0 > 0.9 ? 'wall' : y1 > 1.6 && y0 < 0.3 ? 'tall' : 'floor';
    items.push({ item: it, s0: Math.max(0, s0), s1: Math.min(length, s1), y0, y1, depth: Math.max(...outs) - Math.max(0, nearest), row });
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
  const floorPieces = [...items.filter((i) => i.row !== 'wall'), ...openings.filter((o) => o.y0 < 0.05)];
  const wallPieces = [...items.filter((i) => i.row !== 'floor'), ...openings.filter((o) => o.y0 >= 0.05)];
  return { room, wall, length, ceiling, items, openings, floorChain: chain(floorPieces), wallChain: chain(wallPieces) };
}

/** Walls of a room in order, for stepping around it in the elevation view. */
export function neighbourWall(room: Room, wallIndex: number, step: 1 | -1): number {
  const walls = roomWalls(room).map((w) => w.index);
  const i = walls.indexOf(wallIndex);
  return walls[(i + step + walls.length) % walls.length];
}
