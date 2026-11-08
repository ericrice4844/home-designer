import { describe, expect, it } from 'vitest';
import { anchorToWall, canLift, itemWall, moveOnWall, overlapsOnWall, snapOnWall, wallElevation, wallLabel, wallsByDistance } from '../src/elevation';
import { addItem, roomProject } from './helpers';

const IN = 0.0254;

/** 4 × 3 m room; returns helpers to place pieces against the north wall (wall 0). */
function northWall() {
  const { p, room } = roomProject();
  const t = room.wallThickness / 2;
  const onNorth = (kind: string, x: number, patch = {}) => {
    const it = addItem(p, kind, x, 0, patch);
    it.z = t + it.depth / 2;
    return it;
  };
  return { p, room, t, onNorth };
}

describe('which wall', () => {
  it('names walls by compass direction as seen from inside', () => {
    const { room } = roomProject();
    expect([0, 1, 2, 3].map((i) => wallLabel(room, i))).toEqual(['North wall', 'East wall', 'South wall', 'West wall']);
  });

  it('knows the wall an item is anchored to, and that a free-standing one has none', () => {
    const { p, room, onNorth } = northWall();
    const cab = onNorth('base-cabinet', 1);
    const sofa = addItem(p, 'sofa', 2, 1.6);
    expect(itemWall(p, cab)).toEqual({ roomId: room.id, index: 0 });
    expect(itemWall(p, sofa)).toBeNull();
  });

  it('lists the walls nearest first for picking', () => {
    const { p } = northWall();
    const chair = addItem(p, 'armchair', 3.4, 1.5); // near the east wall
    const list = wallsByDistance(p, chair);
    expect(list[0].label).toBe('East wall');
    expect(list.map((w) => w.index).sort()).toEqual([0, 1, 2, 3]);
  });

  it('a free-standing item appears on the chosen wall only when asked for, marked as projected', () => {
    const { p, room } = northWall();
    const sofa = addItem(p, 'sofa', 2, 1.6);
    expect(wallElevation(p, room.id, 0)!.items.some((i) => i.item.id === sofa.id)).toBe(false);
    const el = wallElevation(p, room.id, 0, { include: [sofa.id] })!;
    const e = el.items.find((i) => i.item.id === sofa.id)!;
    expect(e.projected).toBe(true);
    expect(e.gap).toBeGreaterThan(0.5);
    // projected pieces don't count in the wall's dimension chain
    expect(el.floorChain).toEqual([[0, el.length]]);
  });
});

describe('moving on the wall', () => {
  it('slides along the wall without changing its distance from it', () => {
    const { p, room, onNorth } = northWall();
    const cab = onNorth('base-cabinet', 1);
    const z0 = cab.z;
    const el = wallElevation(p, room.id, 0)!;
    moveOnWall(p, el, cab.id, 2);
    const after = wallElevation(p, room.id, 0)!.items.find((i) => i.item.id === cab.id)!;
    expect(after.s0).toBeCloseTo(2, 6);
    expect(cab.z).toBeCloseTo(z0, 9);
  });

  it('repeated moves during one drag are absolute, not cumulative', () => {
    const { p, room, onNorth } = northWall();
    const cab = onNorth('base-cabinet', 1);
    const el = wallElevation(p, room.id, 0)!; // snapshot from the start of the drag
    for (let i = 0; i < 5; i++) moveOnWall(p, el, cab.id, 2); // many pointermove events, same target
    const e = wallElevation(p, room.id, 0)!.items.find((i) => i.item.id === cab.id)!;
    expect(e.s0).toBeCloseTo(2, 6);
    moveOnWall(p, el, cab.id, 1.5); // then back a bit
    expect(wallElevation(p, room.id, 0)!.items.find((i) => i.item.id === cab.id)!.s0).toBeCloseTo(1.5, 6);
  });

  it('is clamped to the wall ends', () => {
    const { p, room, onNorth } = northWall();
    const cab = onNorth('base-cabinet', 1);
    const el = wallElevation(p, room.id, 0)!;
    moveOnWall(p, el, cab.id, 99);
    const e = wallElevation(p, room.id, 0)!.items.find((i) => i.item.id === cab.id)!;
    expect(e.s1).toBeCloseTo(el.length, 6);
  });

  it('wall-hung pieces move up and down; floor pieces stay on the floor', () => {
    const { p, room, onNorth } = northWall();
    const cab = onNorth('base-cabinet', 1);
    const upper = onNorth('wall-cabinet', 1);
    const el = wallElevation(p, room.id, 0)!;
    expect(canLift(el.items.find((i) => i.item.id === upper.id)!)).toBe(true);
    expect(canLift(el.items.find((i) => i.item.id === cab.id)!)).toBe(false);
    moveOnWall(p, el, upper.id, 1, 60 * IN);
    moveOnWall(p, el, cab.id, 1, 0.5);
    expect(upper.y).toBeCloseTo(60 * IN);
    expect(cab.y).toBe(0);
  });

  it('works on every wall direction (left/right as seen from inside)', () => {
    const { p, room, t } = northWall();
    const south = addItem(p, 'base-cabinet', 1, 0, { rotation: Math.PI });
    south.z = 3 - t - south.depth / 2;
    const el = wallElevation(p, room.id, 2)!;
    const before = el.items.find((i) => i.item.id === south.id)!;
    moveOnWall(p, el, south.id, before.s0 + 0.5); // half a metre to the right, facing south = towards west
    expect(south.x).toBeCloseTo(1 - 0.5, 6);
  });
});

describe('snapping on the wall', () => {
  it('butts a cabinet against its neighbour', () => {
    const { p, room, onNorth } = northWall();
    const a = onNorth('base-cabinet', 1);
    const b = onNorth('base-cabinet', 2.5);
    const el = wallElevation(p, room.id, 0)!;
    const ea = el.items.find((i) => i.item.id === a.id)!;
    const snap = snapOnWall(el, b.id, ea.s1 + 0.02, 0, 0.05);
    expect(snap.s0).toBeCloseTo(ea.s1, 9);
    expect(snap.guides).toContainEqual({ s: ea.s1 });
  });

  it('centres a mirror over the vanity, and snaps its height to neighbours / standard heights', () => {
    const { p, room, onNorth } = northWall();
    const vanity = onNorth('vanity', 2);
    const mirror = onNorth('mirror', 1, { y: 40 * IN });
    const el = wallElevation(p, room.id, 0)!;
    const v = el.items.find((i) => i.item.id === vanity.id)!;
    const m = el.items.find((i) => i.item.id === mirror.id)!;
    const w = m.s1 - m.s0;
    const centred = (v.s0 + v.s1) / 2 - w / 2;
    const snap = snapOnWall(el, mirror.id, centred + 0.03, 39.2 * IN, 0.05);
    expect(snap.s0).toBeCloseTo(centred, 9);
    expect(snap.y0).toBeCloseTo(40 * IN, 9);
  });

  it('leaves free movement alone when nothing is within reach', () => {
    const { p, room, onNorth } = northWall();
    const a = onNorth('base-cabinet', 1);
    const el = wallElevation(p, room.id, 0)!;
    expect(snapOnWall(el, a.id, 1.7, 0, 0.02).s0).toBeCloseTo(1.7, 9);
  });

  it('reports collisions', () => {
    const { p, room, onNorth } = northWall();
    const a = onNorth('base-cabinet', 1);
    const b = onNorth('base-cabinet', 2.5);
    const el = wallElevation(p, room.id, 0)!;
    const ea = el.items.find((i) => i.item.id === a.id)!;
    expect(overlapsOnWall(el, b.id, ea.s0 + 0.1, 0)).toBe(true);
    expect(overlapsOnWall(el, b.id, ea.s1, 0)).toBe(false);
  });
});

describe('putting a free-standing item against a wall', () => {
  it('backs it onto the chosen wall, facing the room, keeping its left/right position', () => {
    const { p, room, t } = northWall();
    const sofa = addItem(p, 'sofa', 2, 1.6, { rotation: 0.4 });
    anchorToWall(p, sofa.id, room.id, 0);
    expect(Math.cos(sofa.rotation)).toBeCloseTo(1, 6); // front faces south, into the room
    expect(sofa.z).toBeCloseTo(t + sofa.depth / 2, 6);
    expect(sofa.x).toBeCloseTo(2, 1);
    expect(itemWall(p, sofa)).toEqual({ roomId: room.id, index: 0 });
  });
});
