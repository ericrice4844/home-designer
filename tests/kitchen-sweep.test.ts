// Gate from the review ("probe2"): every layout, every main wall, rooms above 12×12 ft must produce
// zero overlapping pieces and zero aisle warnings.
import { describe, expect, it } from 'vitest';
import { itemsOverlap, pointInPolygon } from '../src/geometry';
import { analyzeKitchen, generateKitchenSafe, LAYOUT_LABELS, type KitchenLayout } from '../src/kitchen';
import { createRoom, emptyProject, FT, rectPoints } from '../src/model';

const base = {
  wallCabinets: true,
  cabinetColor: '#fff',
  countertopColor: '#eee',
  applianceColor: '#ccc',
  handleColor: '#888',
  islandColor: '#345',
  replace: true,
};
const sizes: [number, number][] = [];
for (const w of [12.5, 14, 16, 18, 22]) for (const d of [12.5, 14, 17, 20]) sizes.push([w, d]);

describe('kitchen generator sweep', () => {
  for (const layout of Object.keys(LAYOUT_LABELS) as KitchenLayout[]) {
    it(`${layout}: no overlaps, everything inside, aisles ≥ 42"`, () => {
      const failures: string[] = [];
      for (const [w, d] of sizes)
        for (let wall = 0; wall < 4; wall++) {
          const p = emptyProject();
          const r = createRoom('K', rectPoints(0, 0, w * FT, d * FT));
          p.rooms.push(r);
          const { items } = generateKitchenSafe(p, r, { ...base, layout, wallIndex: wall });
          const tag = `${w}×${d} wall ${wall}`;
          if (items.length < 5) failures.push(`${tag}: only ${items.length} items`);
          for (let i = 0; i < items.length; i++) {
            if (!pointInPolygon(items[i], r.points)) failures.push(`${tag}: ${items[i].name} outside`);
            for (let j = i + 1; j < items.length; j++) if (itemsOverlap(items[i], items[j])) failures.push(`${tag}: ${items[i].name} overlaps ${items[j].name}`);
          }
          p.items.push(...items);
          for (const c of analyzeKitchen(p, r, (m) => (m / 0.0254).toFixed(1) + '"').checks) if (c.label === 'Work aisle width' && c.ok === false) failures.push(`${tag}: aisle ${c.detail}`);
        }
      expect(failures.slice(0, 15)).toEqual([]);
    });
  }
});
