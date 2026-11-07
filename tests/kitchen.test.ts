import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../src/geometry';
import { analyzeKitchen, generateKitchenFor, splitWidths, type KitchenLayout } from '../src/kitchen';
import { createRoom, emptyProject, FT, rectPoints } from '../src/model';

const opts = {
  wallIndex: 0,
  wallCabinets: true,
  cabinetColor: '#fff',
  countertopColor: '#eee',
  applianceColor: '#ccc',
  handleColor: '#888',
  islandColor: '#345',
  replace: true,
};

describe('splitWidths', () => {
  it('uses standard cabinet sizes and fills the run exactly', () => {
    for (const len of [9, 30, 47, 63.5, 100, 141]) {
      const parts = splitWidths(len);
      expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(len);
      expect(parts.every((w) => w >= 9 || parts.length === 1)).toBe(true);
    }
  });
});

describe('generateKitchen', () => {
  const layouts: KitchenLayout[] = ['I', 'L', 'U', 'galley', 'L+island', 'U+island'];
  for (const layout of layouts) {
    it(`builds a ${layout} kitchen inside the room`, () => {
      const p = emptyProject();
      const r = createRoom('Kitchen', rectPoints(0, 0, 16 * FT, 14 * FT));
      p.rooms.push(r);
      const items = generateKitchenFor(p, r, { ...opts, layout });
      expect(items.length).toBeGreaterThan(4);
      for (const it of items) expect(pointInPolygon({ x: it.x, z: it.z }, r.points)).toBe(true);
      const kinds = new Set(items.map((i) => i.kind));
      expect(kinds.has('sink-base')).toBe(true);
      expect(kinds.has('refrigerator')).toBe(true);
      expect(kinds.has('range')).toBe(true);
      if (layout.includes('island')) expect(kinds.has('island')).toBe(true);
      p.items.push(...items);
      const res = analyzeKitchen(p, r, (m) => m.toFixed(2));
      expect(res.triangle).toHaveLength(3);
    });
  }
});
