import { beforeEach, describe, expect, it } from 'vitest';
import { clampOpening, deleteRoom, duplicateRoom, finishPolygon, freeOpeningOffset, isRectangle, itemsInRoom, moveRoom, scaleRoom, setWallLength, splitWall } from '../src/edits';
import { dragNeedsCommit } from '../src/plan2d';
import { Store } from '../src/state';
import { shortcutFor } from '../src/ui/shortcuts';
import { addDoor, addItem, roomProject } from './helpers';

describe('3.1 split wall (P9)', () => {
  it('shifts colors, hidden walls and openings above the split and moves openings on the far half', () => {
    const { p, room } = roomProject(); // wall 0 is 4 m long
    room.wallColors = { 0: '#111111', 2: '#222222' };
    room.hiddenWalls = [3];
    const near = addDoor(p, room, 0, 1);
    const far = addDoor(p, room, 0, 3.2);
    const later = addDoor(p, room, 2, 2);
    splitWall(p, room.id, 0);
    expect(room.points).toHaveLength(5);
    expect(room.wallColors).toEqual({ 0: '#111111', 1: '#111111', 3: '#222222' });
    expect(room.hiddenWalls).toEqual([4]);
    expect(near).toMatchObject({ wallIndex: 0, offset: 1 });
    expect(far.wallIndex).toBe(1);
    expect(far.offset).toBeCloseTo(1.2);
    expect(later.wallIndex).toBe(3);
  });

  it('keeps an opening that straddles the split inside one half', () => {
    const { p, room } = roomProject();
    const o = addDoor(p, room, 0, 2, 'door', 0.9);
    splitWall(p, room.id, 0);
    expect(o.offset - o.width / 2).toBeGreaterThanOrEqual(0);
    expect(o.offset + o.width / 2).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('3.2 polygon finish (P7)', () => {
  it('drops the duplicate point from a double-click and a closing point', () => {
    const r = finishPolygon([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 4, z: 3 }, { x: 0, z: 3 }, { x: 0, z: 0 }]);
    expect('points' in r && r.points).toHaveLength(4);
  });
  it('rejects self-intersecting outlines', () => {
    const r = finishPolygon([{ x: 0, z: 0 }, { x: 4, z: 3 }, { x: 4, z: 0 }, { x: 0, z: 3 }]);
    expect('error' in r && r.error).toMatch(/cross/);
  });
  it('rejects fewer than 3 distinct corners and zero-area outlines', () => {
    expect('error' in finishPolygon([{ x: 0, z: 0 }, { x: 0.01, z: 0 }, { x: 3, z: 0 }])).toBe(true);
    expect('error' in finishPolygon([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }])).toBe(true);
  });
});

describe('3.3 openings (P8)', () => {
  it('a new opening goes to the first free span, not on top of an existing one', () => {
    const { p, room } = roomProject();
    addDoor(p, room, 0, 2, 'door', 0.9); // middle taken
    const off = freeOpeningOffset(p, room, 0, 0.9)!;
    expect(Math.abs(off - 2)).toBeGreaterThan(0.9);
    expect(off - 0.45).toBeGreaterThanOrEqual(0);
  });
  it('returns null when the wall is full', () => {
    const { p, room } = roomProject();
    addDoor(p, room, 1, 1.5, 'opening', 2.9);
    expect(freeOpeningOffset(p, room, 1, 0.9)).toBeNull();
  });
  it('clamps after a type change makes the opening wider', () => {
    const { p, room } = roomProject();
    const o = addDoor(p, room, 1, 0.5, 'door', 0.8);
    o.width = 4.9; // garage door on a 3 m wall
    clampOpening(o, 3);
    expect(o.width).toBeLessThanOrEqual(3);
    expect(o.offset - o.width / 2).toBeGreaterThanOrEqual(0);
    expect(o.offset + o.width / 2).toBeLessThanOrEqual(3);
  });
});

describe('3.4 room edits', () => {
  it('resizing a room carries its furniture and keeps openings on the walls', () => {
    const { p, room } = roomProject();
    const sofa = addItem(p, 'sofa', 3, 2);
    const door = addDoor(p, room, 0, 3.4);
    scaleRoom(p, room.id, 0.5, 1); // 4 m → 2 m wide
    expect(sofa.x).toBeCloseTo(1.5);
    expect(door.offset + door.width / 2).toBeLessThanOrEqual(2 + 1e-9);
  });
  it('moving a room moves the furniture inside it, not outside', () => {
    const { p, room } = roomProject();
    const inside = addItem(p, 'box', 1, 1);
    const outside = addItem(p, 'box', 10, 10);
    moveRoom(p, room.id, 5, 0);
    expect(inside.x).toBe(6);
    expect(outside.x).toBe(10);
  });
  it('setWallLength moves the opposite side only for true rectangles', () => {
    const rect = roomProject();
    setWallLength(rect.p, rect.room.id, 0, 5);
    expect(isRectangle(rect.room.points)).toBe(true);
    const trap = roomProject();
    trap.room.points[3] = { x: 1, z: 3 }; // trapezoid, still 4 points
    const before = { ...trap.room.points[2] };
    setWallLength(trap.p, trap.room.id, 0, 5);
    expect(trap.room.points[2]).toEqual(before);
    expect(trap.room.points[1]).toEqual({ x: 5, z: 0 });
  });
  it('shortening a wall clamps its openings', () => {
    const { p, room } = roomProject();
    const o = addDoor(p, room, 0, 3.5);
    setWallLength(p, room.id, 0, 2);
    expect(o.offset + o.width / 2).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('3.5 delete / duplicate / shortcuts', () => {
  it('deleting a room removes its openings and furniture', () => {
    const { p, room } = roomProject();
    addDoor(p, room);
    addItem(p, 'sofa', 2, 1.5);
    const elsewhere = addItem(p, 'box', 20, 20);
    deleteRoom(p, room.id);
    expect(p.rooms).toHaveLength(0);
    expect(p.openings).toHaveLength(0);
    expect(p.items).toEqual([elsewhere]);
  });
  it('duplicating a room copies openings and furniture with new ids', () => {
    const { p, room } = roomProject();
    addDoor(p, room);
    addItem(p, 'sofa', 2, 1.5);
    const copy = duplicateRoom(p, room.id, 4)!;
    expect(p.openings.filter((o) => o.roomId === copy.id)).toHaveLength(1);
    const copied = itemsInRoom(p, copy);
    expect(copied).toHaveLength(1);
    expect(copied[0].x).toBe(6);
    expect(new Set(p.items.map((i) => i.id)).size).toBe(2);
  });
  it('the store deletes room contents too', () => {
    const s = new Store();
    const { p, room } = roomProject();
    addItem(p, 'sofa', 2, 1.5);
    s.load(p);
    s.select({ type: 'room', id: room.id });
    s.deleteSelection();
    expect(s.project.items).toHaveLength(0);
  });
  it('locked items ignore rotate/nudge/delete keys; Ctrl+R is left to the browser', () => {
    const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(shortcutFor(key('r'), { locked: true })).toBe('locked');
    expect(shortcutFor(key('ArrowLeft'), { locked: true })).toBe('locked');
    expect(shortcutFor(key('Delete'), { locked: true })).toBe('locked');
    expect(shortcutFor(key('r'), { locked: false })).toBe('rotate');
    expect(shortcutFor(key('r', { ctrlKey: true }), {})).toBeNull();
    expect(shortcutFor(key('r', { metaKey: true }), {})).toBeNull();
  });
});

describe('3.6 undo/redo and drags', () => {
  let s: Store;
  beforeEach(() => {
    s = new Store();
    s.load(roomProject().p);
  });
  it('redo during a live drag commits the drag first instead of losing it', () => {
    s.update((p) => (p.name = 'A'));
    s.undo();
    s.live((p) => (p.rooms[0].points[0] = { x: -1, z: -1 }));
    s.redo(); // drag was committed → it became the latest step, redo stack cleared
    expect(s.project.rooms[0].points[0]).toEqual({ x: -1, z: -1 });
    s.undo();
    expect(s.project.rooms[0].points[0]).toEqual({ x: 0, z: 0 });
  });
  it('vertex, wall and room drags are committed when a pinch interrupts them', () => {
    for (const k of ['vertex', 'wall', 'room', 'item', 'opening', 'rotate', 'resize'] as const) expect(dragNeedsCommit(k)).toBe(true);
    for (const k of ['pan', 'rect', 'measure'] as const) expect(dragNeedsCommit(k)).toBe(false);
  });
});
