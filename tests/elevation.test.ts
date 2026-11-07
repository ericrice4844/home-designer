import { describe, expect, it } from 'vitest';
import { neighbourWall, wallElevation } from '../src/elevation';
import { createRoom, rectPoints } from '../src/model';
import { generateKitchenSafe } from '../src/kitchen';
import { sampleHouse } from '../src/templates';
import { addDoor, addItem, roomProject } from './helpers';

const IN = 0.0254;
const FT = 0.3048;

describe('which items are on a wall', () => {
  it('collects floor and wall-hung pieces against the wall, not the rest of the room', () => {
    const { p, room } = roomProject(); // 4 × 3 m; wall 0 = north (z = 0)
    const t = room.wallThickness / 2;
    const base = addItem(p, 'base-cabinet', 1, t + (24 * IN) / 2); // against the north wall
    const upper = addItem(p, 'wall-cabinet', 1, t + (12 * IN) / 2);
    const sofa = addItem(p, 'sofa', 2, 2); // middle of the room
    const light = addItem(p, 'recessed', 1, 0.2); // ceiling light near the wall
    const el = wallElevation(p, room.id, 0)!;
    const ids = el.items.map((i) => i.item.id);
    expect(ids).toContain(base.id);
    expect(ids).toContain(upper.id);
    expect(ids).not.toContain(sofa.id);
    expect(ids).not.toContain(light.id);
    expect(el.items.find((i) => i.item.id === upper.id)!.row).toBe('wall');
    expect(el.items.find((i) => i.item.id === base.id)!.row).toBe('floor');
  });

  it('measures left→right as seen standing in the room facing the wall', () => {
    const { p, room } = roomProject(); // inner faces at x = t … 4 − t
    const t = room.wallThickness / 2;
    // north wall: facing north, west is on the left
    const west = addItem(p, 'base-cabinet', t + 0.3048, t + 0.3);
    let el = wallElevation(p, room.id, 0)!;
    expect(el.length).toBeCloseTo(4 - 2 * t, 6);
    let e = el.items.find((i) => i.item.id === west.id)!;
    expect(e.s0).toBeCloseTo(0, 6); // flush with the left (west) corner
    // south wall: facing south, west is on the RIGHT
    const southWest = addItem(p, 'base-cabinet', t + 0.3048, 3 - t - 0.3, { rotation: Math.PI });
    el = wallElevation(p, room.id, 2)!;
    e = el.items.find((i) => i.item.id === southWest.id)!;
    expect(e.s1).toBeCloseTo(el.length, 6);
  });

  it('includes doors/windows with their heights, in the right place', () => {
    const { p, room } = roomProject();
    addDoor(p, room, 0, 1, 'window', 0.9); // north wall, centred 1 m from its start (x = 1)
    const el = wallElevation(p, room.id, 0)!;
    const w = el.openings[0];
    expect((w.s0 + w.s1) / 2).toBeCloseTo(1 - room.wallThickness / 2, 6);
    expect(w.y0).toBeCloseTo(0.9);
    expect(w.y1).toBeCloseTo(0.9 + 1.2);
  });

  it('follows a sloped ceiling along the wall', () => {
    const { p, room } = roomProject();
    room.ceiling = { type: 'shed', peakHeight: room.wallHeight + 1, angle: 0, trayInset: 0.4 }; // rises toward +x (east)
    const el = wallElevation(p, room.id, 0)!; // north wall: west (low) on the left, east (high) on the right
    expect(el.ceiling[0][1]).toBeLessThan(el.ceiling[el.ceiling.length - 1][1]);
  });
});

describe('kitchen elevations', () => {
  it('a generated kitchen wall reads as a continuous run with uppers above', () => {
    const { p, room } = roomProject(16 * FT, 13 * FT);
    const res = generateKitchenSafe(p, room, { layout: 'I', wallIndex: 0, wallCabinets: true, cabinetColor: '#fff', countertopColor: '#eee', applianceColor: '#ccc', handleColor: '#888', islandColor: '#345', replace: true });
    p.items.push(...res.items);
    const el = wallElevation(p, room.id, 0)!;
    const floor = el.items.filter((i) => i.row !== 'wall');
    expect(floor.length).toBeGreaterThan(4);
    expect(el.items.some((i) => i.row === 'wall')).toBe(true);
    // the floor chain covers the whole wall with no overlaps
    const chain = el.floorChain;
    expect(chain[0][0]).toBeCloseTo(0, 6);
    expect(chain[chain.length - 1][1]).toBeCloseTo(el.length, 6);
    for (let i = 1; i < chain.length; i++) expect(chain[i][0]).toBeCloseTo(chain[i - 1][1], 6);
    // sink, range and fridge are all on it, in left-to-right order
    const kinds = floor.map((i) => i.item.kind);
    for (const k of ['sink-base', 'range', 'refrigerator']) expect(kinds).toContain(k);
  });

  it('counters are a standard 36" high, flush with the range, with 18" up to the wall cabinets', () => {
    const { p, room } = roomProject(16 * FT, 13 * FT);
    p.items.push(...generateKitchenSafe(p, room, { layout: 'I', wallIndex: 0, wallCabinets: true, cabinetColor: '#fff', countertopColor: '#eee', applianceColor: '#ccc', handleColor: '#888', islandColor: '#345', replace: true }).items);
    const el = wallElevation(p, room.id, 0)!;
    const counters = el.items.filter((i) => i.item.countertop);
    for (const c of counters) expect(c.y1).toBeCloseTo(36 * IN, 6);
    expect(el.items.find((i) => i.item.kind === 'range')!.y1).toBeCloseTo(36 * IN, 6);
    const uppers = el.items.filter((i) => i.item.kind === 'wall-cabinet' && i.item.depth < 0.4); // not the deep one over the fridge
    expect(uppers.length).toBeGreaterThan(2);
    for (const u of uppers) expect(u.y0 - 36 * IN).toBeCloseTo(18 * IN, 6);
  });

  it('the sample house bath wall shows the vanity and its mirror above it', () => {
    const p = sampleHouse();
    const bath = p.rooms.find((r) => r.name === 'Bath')!;
    const south = wallElevation(p, bath.id, 2)!;
    const kinds = south.items.map((i) => i.item.kind);
    expect(kinds).toContain('vanity');
    expect(kinds).toContain('mirror');
    const v = south.items.find((i) => i.item.kind === 'vanity')!;
    const m = south.items.find((i) => i.item.kind === 'mirror')!;
    expect(m.y0).toBeGreaterThan(v.y1); // mirror hangs above the counter
    expect(Math.abs((m.s0 + m.s1) / 2 - (v.s0 + v.s1) / 2)).toBeLessThan(0.05); // centred over it
  });

  it('an island in the middle of the kitchen is not on any wall', () => {
    const p = sampleHouse();
    const k = p.rooms.find((r) => r.name === 'Kitchen')!;
    for (const w of [0, 1, 2, 3]) expect(wallElevation(p, k.id, w)!.items.some((i) => i.item.kind === 'island')).toBe(false);
  });
});

describe('stepping around a room', () => {
  it('goes to the next / previous wall and wraps', () => {
    const r = createRoom('R', rectPoints(0, 0, 3, 3));
    expect(neighbourWall(r, 0, 1)).toBe(1);
    expect(neighbourWall(r, 3, 1)).toBe(0);
    expect(neighbourWall(r, 0, -1)).toBe(3);
  });
});
