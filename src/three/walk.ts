import { bounds, centroid, openingsForWall, pointInPolygon, roomAt, roomWalls } from '../geometry';
import type { Project, Room, Vec2 } from '../model';

export const WALK_RADIUS = 0.22;

/** Would a person standing at p bump into a wall (except through a door) or furniture? */
export function walkCollides(proj: Project, p: Vec2): boolean {
  const R = WALK_RADIUS;
  for (const r of proj.rooms) {
    for (const w of roomWalls(r)) {
      if (r.hiddenWalls.includes(w.index)) continue;
      const ab = { x: w.b.x - w.a.x, z: w.b.z - w.a.z };
      const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * ab.x + (p.z - w.a.z) * ab.z) / (w.length * w.length)));
      const d = Math.hypot(p.x - (w.a.x + ab.x * t), p.z - (w.a.z + ab.z * t));
      if (d > R + r.wallThickness / 2) continue;
      const u = t * w.length;
      const passable = openingsForWall(proj, w).some((o) => o.opening.sill < 0.05 && o.opening.height > 1.5 && u > o.u0 + 0.05 && u < o.u1 - 0.05);
      if (!passable) return true;
    }
  }
  for (const it of proj.items) {
    if (it.height < 0.25 || it.y > 1.2 || it.category === 'lighting' || it.kind === 'rug') continue;
    const lx = (p.x - it.x) * Math.cos(-it.rotation) - (p.z - it.z) * Math.sin(-it.rotation);
    const lz = (p.x - it.x) * Math.sin(-it.rotation) + (p.z - it.z) * Math.cos(-it.rotation);
    if (Math.abs(lx) < it.width / 2 + R * 0.6 && Math.abs(lz) < it.depth / 2 + R * 0.6) return true;
  }
  return false;
}

export interface WalkStart {
  pos: Vec2;
  yaw: number;
  floorY: number;
  room: Room | undefined;
}

/**
 * Where to stand when entering walk mode: at `point` if given (double-click on a floor), otherwise the
 * free spot nearest the room's centre. Facing the most open direction; floor height of the room stood in.
 */
export function walkStart(proj: Project, opts: { room?: Room; point?: Vec2 }): WalkStart {
  let pos: Vec2;
  let room: Room | undefined;
  if (opts.point) {
    pos = { ...opts.point };
    room = roomAt(proj, pos);
  } else {
    room = opts.room ?? proj.rooms[0];
    pos = { x: 0, z: 0 };
    if (room) {
      const c = centroid(room.points);
      const b = bounds(room.points);
      let best: Vec2 | null = null;
      let bd = Infinity;
      for (let x = b.minX + 0.4; x < b.maxX - 0.3; x += 0.25)
        for (let z = b.minZ + 0.4; z < b.maxZ - 0.3; z += 0.25) {
          const q = { x, z };
          if (!pointInPolygon(q, room.points) || walkCollides(proj, q)) continue;
          const d = (x - c.x) ** 2 + (z - c.z) ** 2;
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
      pos = best ?? c;
    }
  }
  let yaw = 0;
  let bestLen = -1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dir = { x: -Math.sin(a), z: -Math.cos(a) };
    let len = 0;
    while (len < 12 && !walkCollides(proj, { x: pos.x + dir.x * len, z: pos.z + dir.z * len })) len += 0.2;
    if (len > bestLen) {
      bestLen = len;
      yaw = a;
    }
  }
  return { pos, yaw, floorY: room?.elevation ?? 0, room };
}
