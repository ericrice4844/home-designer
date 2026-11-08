import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG, createItem } from '../src/catalog';
import { isObstacle, itemClearances, itemLocalOutline } from '../src/geometry';
import { getStyle, sanitizeStyle, styleOptions } from '../src/itemStyles';
import { normalizeProject } from '../src/model';
import { buildItemObject } from '../src/three/items';
import { walkCollides } from '../src/three/walk';
import { addItem, roomProject } from './helpers';

/** Mesh-level bounding box (ignores empty groups), in the item's local frame. */
function bbox(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    box.union(b);
  });
  return box;
}

function variants(kind: string): Record<string, string | number>[] {
  const opts = styleOptions(kind);
  const out: Record<string, string | number>[] = [{}];
  for (const o of opts) {
    const vals = o.type === 'choice' ? o.options.map(([v]) => v) : [o.min, o.default, o.max];
    for (const v of vals) out.push({ [o.key]: v });
  }
  return out;
}

describe('every style of every catalog piece fits its own box', () => {
  for (const entry of CATALOG) {
    it(entry.kind, () => {
      const problems: string[] = [];
      for (const style of variants(entry.kind))
        for (const scale of [0.7, 1, 1.4]) {
          const it = createItem(entry, 0, 0, { style });
          it.width *= scale;
          it.depth *= scale;
          it.y = 0;
          const obj = buildItemObject(it);
          const b = bbox(obj);
          const tag = `${entry.kind} ${JSON.stringify(style)} ×${scale}`;
          if (b.isEmpty()) {
            problems.push(`${tag}: empty`);
            continue;
          }
          const vals = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
          if (vals.some((v) => !Number.isFinite(v))) problems.push(`${tag}: NaN geometry`);
          const tol = 0.012; // 1 cm
          const front = 0.06; // hardware, knobs and faucets stand proud of the front / top
          if (b.min.x < -it.width / 2 - tol || b.max.x > it.width / 2 + tol) problems.push(`${tag}: x ${b.min.x.toFixed(3)}..${b.max.x.toFixed(3)} vs ±${(it.width / 2).toFixed(3)}`);
          if (b.min.z < -it.depth / 2 - tol || b.max.z > it.depth / 2 + front) problems.push(`${tag}: z ${b.min.z.toFixed(3)}..${b.max.z.toFixed(3)} vs ±${(it.depth / 2).toFixed(3)}`);
          if (b.min.y < -tol || b.max.y > it.height + (['kitchen', 'bath', 'appliance'].includes(entry.category) ? 0.35 : tol)) problems.push(`${tag}: y ${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)} vs 0..${it.height.toFixed(3)}`);
        }
      expect(problems.slice(0, 8)).toEqual([]);
    });
  }
});

describe('styles change the model', () => {
  const meshCount = (o: THREE.Object3D) => {
    let n = 0;
    o.traverse((c) => ((c as THREE.Mesh).isMesh ? n++ : 0));
    return n;
  };
  const signature = (kind: string, style: Record<string, string | number>) => {
    const it = createItem(CATALOG.find((c) => c.kind === kind)!, 0, 0, { style });
    const o = buildItemObject(it);
    o.updateMatrixWorld(true);
    // geometric fingerprint: every mesh's geometry type and placement
    const parts: string[] = [];
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) parts.push(`${m.geometry.type}:${m.matrixWorld.elements.map((v) => v.toFixed(3)).join(',')}`);
    });
    return `${meshCount(o)}|${parts.sort().join(';')}`;
  };
  it.each([
    ['base-cabinet', 'door'],
    ['base-cabinet', 'pull'],
    ['wall-cabinet', 'door'],
    ['refrigerator', 'type'],
    ['range', 'type'],
    ['range-hood', 'type'],
    ['sofa', 'arms'],
    ['sofa', 'legs'],
    ['bed', 'headboard'],
    ['dining-table', 'top'],
    ['dining-table', 'base'],
    ['dining-chair', 'back'],
    ['toilet', 'type'],
    ['bathtub', 'type'],
  ])('%s: every %s option looks different', (kind, key) => {
    const opt = styleOptions(kind).find((o) => o.key === key)!;
    expect(opt.type).toBe('choice');
    const sigs = (opt as { options: [string, string][] }).options.map(([v]) => signature(kind, { [key]: v }));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('shape sliders change the model (sofa seat height, table top thickness)', () => {
    expect(signature('sofa', { seatHeight: 15 })).not.toBe(signature('sofa', { seatHeight: 21 }));
    expect(signature('dining-table', { topThickness: 0.75 })).not.toBe(signature('dining-table', { topThickness: 3 }));
  });
});

describe('style data', () => {
  it('defaults are filled in and unknown values dropped when loading', () => {
    expect(getStyle({ kind: 'base-cabinet' })).toEqual({ door: 'shaker', pull: 'bar', base: 'toe-kick' });
    expect(sanitizeStyle('base-cabinet', { door: 'slab', pull: 'gold-plated', evil: '<script>' })).toEqual({ door: 'slab' });
    expect(sanitizeStyle('sofa', { seatHeight: 99 })).toEqual({ seatHeight: 22 }); // clamped
    expect(sanitizeStyle('plant', { door: 'slab' })).toBeUndefined();
  });

  it('styles survive save/load', () => {
    const { p } = roomProject();
    addItem(p, 'refrigerator', 1, 1, { style: { type: 'side' } });
    addItem(p, 'sofa', 2, 2, { style: { arms: 'rolled', seatHeight: 19.5 } });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.items.map((i) => i.style)).toEqual([{ type: 'side' }, { arms: 'rolled', seatHeight: 19.5 }]);
  });
});

describe('people for scale', () => {
  it('are the height they say and never get in the way', () => {
    const { p } = roomProject();
    const man = addItem(p, 'person-man', 2, 1.5);
    expect(man.height).toBeCloseTo(70 * 0.0254);
    const b = bbox(buildItemObject(man));
    expect(b.max.y).toBeCloseTo(man.height, 2);
    expect(isObstacle(man)).toBe(false);
    expect(walkCollides(p, { x: 2, z: 1.5 })).toBe(false);
    const sofa = addItem(p, 'sofa', 2, 2.4);
    expect(itemClearances(p, sofa).every((c) => c.targetId !== man.id)).toBe(true);
  });
});

describe('footprints follow the chosen shape (plan drawing and spacing use the same outline)', () => {
  it('a right-hand chaise mirrors the sectional', () => {
    const { p } = roomProject(8, 8);
    const left = addItem(p, 'sectional', 4, 4);
    const right = addItem(p, 'sectional', 4, 4, { style: { chaise: 'right' } });
    const xs = (i: typeof left) => itemLocalOutline(i).map((q) => q.x);
    expect(xs(right)).toEqual(xs(left).map((x) => -x));
  });
  it('round and racetrack tables measure as their real shapes', () => {
    const { p } = roomProject(8, 8);
    const round = addItem(p, 'dining-table', 4, 4, { style: { top: 'round' } });
    const r = Math.min(round.width, round.depth) / 2;
    for (const q of itemLocalOutline(round)) expect(Math.hypot(q.x, q.z)).toBeCloseTo(r, 6);
    const track = addItem(p, 'dining-table', 4, 4, { style: { top: 'racetrack' } });
    const o = itemLocalOutline(track);
    expect(Math.max(...o.map((q) => q.x))).toBeCloseTo(track.width / 2, 6);
    expect(Math.max(...o.map((q) => q.z))).toBeCloseTo(track.depth / 2, 6);
    // a corner of the bounding box is outside the rounded end
    expect(o.some((q) => Math.abs(q.x) > track.width / 2 - 0.01 && Math.abs(q.z) > track.depth / 2 - 0.01)).toBe(false);
  });
});
