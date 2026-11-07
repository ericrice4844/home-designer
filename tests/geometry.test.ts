import { describe, expect, it } from 'vitest';
import { catalogEntry, createItem } from '../src/catalog';
import { area, ceilingHeightAt, clipHalfPlane, itemClearances, openingsForWall, roomWalls, snapItemToWall } from '../src/geometry';
import { createRoom, emptyProject, FT, rectPoints, uid } from '../src/model';

const room = () => createRoom('R', rectPoints(0, 0, 4, 3));

describe('rooms & walls', () => {
  it('computes area and inward normals for either winding', () => {
    const r = room();
    expect(area(r.points)).toBeCloseTo(12);
    for (const pts of [r.points, [...r.points].reverse()]) {
      const walls = roomWalls({ ...r, points: pts });
      for (const w of walls) {
        const mid = { x: (w.a.x + w.b.x) / 2 + w.inward.x * 0.1, z: (w.a.z + w.b.z) / 2 + w.inward.z * 0.1 };
        expect(mid.x > 0 && mid.x < 4 && mid.z > 0 && mid.z < 3).toBe(true);
      }
    }
  });

  it('computes sloped and vaulted ceiling heights', () => {
    const r = room();
    r.wallHeight = 2.4;
    r.ceiling = { type: 'shed', peakHeight: 3.4, angle: 0, trayInset: 0.4 };
    expect(ceilingHeightAt(r, { x: 0, z: 1 })).toBeCloseTo(2.4);
    expect(ceilingHeightAt(r, { x: 4, z: 1 })).toBeCloseTo(3.4);
    expect(ceilingHeightAt(r, { x: 2, z: 1 })).toBeCloseTo(2.9);
    r.ceiling.type = 'gable';
    // ridge runs along x (angle 0) so the height peaks at z = 1.5
    expect(ceilingHeightAt(r, { x: 1, z: 1.5 })).toBeCloseTo(3.4);
    expect(ceilingHeightAt(r, { x: 1, z: 0 })).toBeCloseTo(2.4);
  });

  it('clips polygons by a half plane', () => {
    const half = clipHalfPlane(room().points, { x: 1, z: 0 }, 2);
    expect(area(half)).toBeCloseTo(6);
  });
});

describe('openings', () => {
  it('cuts a door through a coincident wall of a neighbouring room', () => {
    const p = emptyProject();
    const a = createRoom('A', rectPoints(0, 0, 4, 3));
    const b = createRoom('B', rectPoints(4, 0, 4, 3));
    p.rooms.push(a, b);
    p.openings.push({ id: uid(), roomId: a.id, wallIndex: 1, offset: 1.5, width: 0.9, height: 2, sill: 0, type: 'door', flipHinge: false, flipSide: false, frameColor: '#fff' });
    const bWall = roomWalls(b).find((w) => w.index === 3)!; // west wall of B
    const ops = openingsForWall(p, bWall);
    expect(ops).toHaveLength(1);
    expect((ops[0].u0 + ops[0].u1) / 2).toBeCloseTo(1.5);
  });
});

describe('items', () => {
  it('snaps an item flush against the nearest wall, facing the room', () => {
    const p = emptyProject();
    const r = room();
    p.rooms.push(r);
    const it = createItem(catalogEntry('base-cabinet')!, 2, 0.45);
    const s = snapItemToWall(p, it)!;
    expect(s).not.toBeNull();
    expect(s.z).toBeCloseTo(r.wallThickness / 2 + it.depth / 2);
    // front (+z local) faces into the room (toward +z)
    expect(Math.cos(s.rotation)).toBeCloseTo(1);
  });

  it('measures clearances to walls and other items', () => {
    const p = emptyProject();
    const r = room();
    p.rooms.push(r);
    const a = createItem(catalogEntry('box')!, 1, 1.5, { width: 1, depth: 1 });
    const b = createItem(catalogEntry('box')!, 3, 1.5, { width: 1, depth: 1 });
    p.items.push(a, b);
    const c = itemClearances(p, a);
    const right = c.find((x) => x.to.x > a.x + 0.4 && Math.abs(x.to.z - a.z) < 0.01)!;
    expect(right.target).toBe('item');
    expect(right.distance).toBeCloseTo(1);
    const left = c.find((x) => x.to.x < a.x - 0.4)!;
    expect(left.target).toBe('wall');
    expect(left.distance).toBeCloseTo(0.5 - r.wallThickness / 2);
  });
});

void FT;
