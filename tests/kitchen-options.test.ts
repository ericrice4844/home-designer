import { describe, expect, it } from 'vitest';
import { isObstacle, itemOutline, itemsOverlap, pointInPolygon } from '../src/geometry';
import { analyzeKitchen, AISLE, generateKitchenSafe, isReplaceableKitchenItem, kitchenOptionsFrom, narrowestAisle } from '../src/kitchen';
import { createRoom, emptyProject, FT, IN, normalizeProject, rectPoints } from '../src/model';
import { kitchenStarter, sampleHouse } from '../src/templates';
import { addItem, roomProject } from './helpers';

const opts = { wallIndex: 0, wallCabinets: true, cabinetColor: '#fff', countertopColor: '#eee', applianceColor: '#ccc', handleColor: '#888', islandColor: '#345', replace: true };

describe('5.1 aisle check uses real depths', () => {
  it('a 30" deep fridge facing a counter reduces the aisle accordingly', () => {
    const { p } = roomProject(8, 8);
    const fridge = addItem(p, 'refrigerator', 2, 0.06 + (30 * IN) / 2); // against the north wall, facing south
    const counter = addItem(p, 'base-cabinet', 2, 2.0, { rotation: Math.PI }); // facing north
    const expected = counter.z - counter.depth / 2 - (fridge.z + fridge.depth / 2);
    expect(narrowestAisle(p.items)).toBeCloseTo(expected, 6);
  });
});

describe('5.2/5.3 feasibility and island gaps', () => {
  it('falls back to a smaller layout with a warning when the island does not fit', () => {
    const p = emptyProject();
    const r = createRoom('K', rectPoints(0, 0, 11 * FT, 11 * FT));
    p.rooms.push(r);
    const res = generateKitchenSafe(p, r, { ...opts, layout: 'U+island' });
    expect(res.layout).not.toBe('U+island');
    expect(res.warning).toMatch(/doesn’t fit|too small/);
    for (let i = 0; i < res.items.length; i++) for (let j = i + 1; j < res.items.length; j++) expect(itemsOverlap(res.items[i], res.items[j])).toBe(false);
  });
  it('never overlaps even in a tiny room', () => {
    const p = emptyProject();
    const r = createRoom('K', rectPoints(0, 0, 6 * FT, 5 * FT));
    p.rooms.push(r);
    const res = generateKitchenSafe(p, r, { ...opts, layout: 'U+island' });
    expect(res.warning).toBeTruthy();
    for (let i = 0; i < res.items.length; i++) for (let j = i + 1; j < res.items.length; j++) expect(itemsOverlap(res.items[i], res.items[j])).toBe(false);
  });
  it('an island keeps ≥ 36" from every wall and ≥ 42" from counters', () => {
    const p = emptyProject();
    const r = createRoom('K', rectPoints(0, 0, 18 * FT, 17 * FT));
    p.rooms.push(r);
    const res = generateKitchenSafe(p, r, { ...opts, layout: 'L+island' });
    const isl = res.items.find((i) => i.kind === 'island')!;
    expect(isl).toBeTruthy();
    // distance from every island corner to every wall's inner face
    const face = r.wallThickness / 2;
    const xs = itemOutline(isl).map((q) => q.x);
    const zs = itemOutline(isl).map((q) => q.z);
    const gap = Math.min(Math.min(...xs) - face, 18 * FT - face - Math.max(...xs), Math.min(...zs) - face, 17 * FT - face - Math.max(...zs));
    expect(gap).toBeGreaterThanOrEqual(36 * IN - 1e-6);
    expect(narrowestAisle(res.items)).toBeGreaterThanOrEqual(AISLE - 1e-6);
  });
});

describe('5.4 replace existing', () => {
  it('keeps washers, dryers and furniture', () => {
    const { p } = roomProject();
    const w = addItem(p, 'washer', 1, 1);
    const d = addItem(p, 'dryer', 2, 1);
    const sofa = addItem(p, 'sofa', 2, 2);
    const cab = addItem(p, 'base-cabinet', 3, 1);
    const fridge = addItem(p, 'refrigerator', 3, 2);
    expect([w, d, sofa].some(isReplaceableKitchenItem)).toBe(false);
    expect(isReplaceableKitchenItem(cab) && isReplaceableKitchenItem(fridge)).toBe(true);
  });
});

describe('5.5 sample designs pass their own checks', () => {
  for (const [name, make] of [
    ['sample house', sampleHouse],
    ['kitchen starter', kitchenStarter],
  ] as const) {
    it(`${name}: kitchen design check has no warnings`, () => {
      const p = make();
      const kitchen = p.rooms.find((r) => r.name === 'Kitchen')!;
      const failed = analyzeKitchen(p, kitchen, (m) => `${(m / IN).toFixed(1)}"`).checks.filter((c) => c.ok === false);
      expect(failed.map((c) => `${c.label}: ${c.detail}`)).toEqual([]);
    });
    it(`${name}: no furniture overlaps and everything stands in a room`, () => {
      const p = make();
      const solid = p.items.filter(isObstacle);
      const bad: string[] = [];
      for (let i = 0; i < solid.length; i++) {
        if (!p.rooms.some((r) => pointInPolygon(solid[i], r.points))) bad.push(`${solid[i].name} outside`);
        for (let j = i + 1; j < solid.length; j++) if (itemsOverlap(solid[i], solid[j])) bad.push(`${solid[i].name} × ${solid[j].name}`);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('5.6 kitchen options are saved with the project', () => {
  it('round-trips through save/load and falls back to defaults for junk', () => {
    const p = sampleHouse();
    const saved = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(kitchenOptionsFrom(saved).layout).toBe('L+island');
    expect(kitchenOptionsFrom(saved).islandColor).toBe('#3f5468');
    const junk = { ...saved, kitchen: { layout: 'spiral', wallCabinets: 'yes' } };
    expect(kitchenOptionsFrom(junk as any).layout).toBe('L');
    expect(kitchenOptionsFrom(junk as any).wallCabinets).toBe(true);
  });
});
