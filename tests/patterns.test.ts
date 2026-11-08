import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// node has no canvas: stand in a plain texture for the pattern drawings
vi.mock('../src/three/textures', async (orig) => {
  const real: any = await orig();
  return { ...real, finishTexture: () => ({ tex: new THREE.Texture(), size: 1 }), floorTexture: () => ({ tex: new THREE.Texture(), size: 1 }) };
});

import { CATALOG, createItem } from '../src/catalog';
import { finishFromPreset, presetById } from '../src/materials';
import { FINISH_TYPES } from '../src/model';
import { applyItemFinishes, boxProjectUVs, counterColorOf } from '../src/three/finishes';
import { buildItemObject } from '../src/three/items';
import { buildHouse } from '../src/three/scene';
import { chevronCell, chevronOffset, herringboneCell, hexCenters, parquetCell, partition, previewSpan, repeatSize } from '../src/three/patternMath';
import { roomProject } from './helpers';

const S = 512;
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

describe('patterns tile seamlessly', () => {
  it('board lengths always fill the repeat exactly', () => {
    const r = rng(7);
    for (let k = 0; k < 50; k++) {
      const n = 1 + (k % 4);
      const parts = partition(S, n, r, 0.5);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(S, 6);
      // no sliver boards
      for (const p of parts) expect(p).toBeGreaterThan((S / n) * 0.3);
    }
  });

  it('chevron boards meet in V points and continue across the texture edge', () => {
    // the 45° offset is continuous everywhere, including across the wrap at x = S
    for (let x = 0; x <= S; x += 0.5) {
      const a = chevronOffset(x, S);
      const b = chevronOffset(x + 0.5, S);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    // the same board continues across the bottom/top edge
    for (let x = 3; x < S; x += 37) expect(chevronCell(x, S - 0.25, S).id).toBe(chevronCell(x, S + 0.25, S).id);
    // both directions are used: neighbouring columns slope opposite ways
    expect(chevronOffset(10, S)).toBeLessThan(chevronOffset(20, S));
    expect(chevronOffset(S / 4 + 10, S)).toBeGreaterThan(chevronOffset(S / 4 + 20, S));
  });

  it('chevron and parquet are periodic and have seam lines', () => {
    for (const cell of [chevronCell, parquetCell]) {
      let seams = 0;
      const ids = new Set<number>();
      for (let y = 0.5; y < S; y += 3)
        for (let x = 0.5; x < S; x += 3) {
          const c = cell(x, y, S);
          expect(cell(x + S, y - S, S)).toEqual(c);
          if (c.seam) seams++;
          ids.add(c.id);
        }
      expect(seams).toBeGreaterThan(0);
      expect(ids.size).toBeGreaterThanOrEqual(16); // many separate boards, each with its own shade
    }
  });

  it('herringbone: every point is on exactly one 2:1 board, half of them each way, tiling at the edges', () => {
    const counts = new Map<number, number>();
    let vertical = 0;
    let total = 0;
    for (let y = 0.5; y < S; y += 2)
      for (let x = 0.5; x < S; x += 2) {
        const c = herringboneCell(x, y, S);
        expect(c.id).toBeGreaterThanOrEqual(0); // never a gap
        counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
        if (c.vertical) vertical++;
        total++;
        expect(herringboneCell(x - S, y + S, S).id).toBe(c.id);
      }
    // 8 boards per repeat (4 each way), all the same size
    expect(counts.size).toBe(8);
    const sizes = [...counts.values()];
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.05);
    expect(vertical / total).toBeCloseTo(0.5, 1);
    // a board is twice as long as it is wide: along a row a horizontal board spans 2 units
    const u = S / 4;
    const h = herringboneCell(0.25 * u, 0.5 * u, S);
    expect(h.vertical).toBe(false);
    expect(herringboneCell(1.75 * u, 0.5 * u, S).id).toBe(h.id);
  });

  it('parquet alternates slat direction block by block', () => {
    const B = S / 4;
    // in block (0,0) slats are horizontal: moving down crosses slats, moving right does not
    expect(parquetCell(10, 10, S).id).toBe(parquetCell(B - 10, 10, S).id);
    expect(parquetCell(10, 10, S).id).not.toBe(parquetCell(10, B - 10, S).id);
    // the block to the right is turned 90°
    expect(parquetCell(B + 10, 10, S).id).toBe(parquetCell(B + 10, B - 10, S).id);
  });

  it('hexagons cover the whole repeat', () => {
    const cs = hexCenters();
    const W = 3;
    const H = Math.sqrt(3);
    for (let y = 0; y <= H; y += H / 20)
      for (let x = 0; x <= W; x += W / 20) {
        const d = Math.min(...cs.map((c) => Math.hypot(c.x - x, c.y - y)));
        expect(d).toBeLessThanOrEqual(1 + 1e-9); // inside some hexagon (circumradius 1)
      }
  });

  it('every pattern has a positive repeat size that grows with its size setting, and a preview span', () => {
    for (const t of FINISH_TYPES) {
      const [a, b] = repeatSize(t, 0.1);
      const [c, d] = repeatSize(t, 0.2);
      expect(a > 0 && b > 0).toBe(true);
      expect(c).toBeGreaterThanOrEqual(a);
      expect(d).toBeGreaterThanOrEqual(b);
      expect(previewSpan(t, 0.1)).toBeGreaterThan(0);
    }
    // long boards: the repeat runs much further along the boards than across
    const [across, along] = repeatSize('hardwood', 0.08);
    expect(along / across).toBeGreaterThanOrEqual(5);
    // subway tiles are twice as wide as tall: 2 tiles across = 4 rows of height
    expect(repeatSize('subway', 0.075)).toEqual([0.3, 0.3]);
  });
});

describe('materials on 3D objects', () => {
  it('box-projected UVs are in meters, so the pattern keeps its size on any part', () => {
    const geo = boxProjectUVs(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().makeScale(2, 0.5, 0.25));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    let maxU = 0;
    for (let i = 0; i < uv.count; i++) {
      if (nor.getZ(i) > 0.9) {
        // front face: u along the 2 m width, v up the 0.5 m height
        maxU = Math.max(maxU, Math.abs(uv.getX(i)));
        expect(Math.abs(uv.getY(i))).toBeCloseTo(0.25);
      }
    }
    expect(maxU).toBeCloseTo(1);
  });

  it('a wood finish replaces the cabinet body, and stone the countertop; handles stay metal', () => {
    const it = createItem(CATALOG.find((c) => c.kind === 'base-cabinet')!, 0, 0);
    it.countertop = true;
    it.finish = finishFromPreset(presetById('walnut')!);
    it.counterFinish = finishFromPreset(presetById('carrara')!);
    const obj = buildItemObject(it);
    const n = applyItemFinishes(obj, it);
    expect(n).toBeGreaterThan(2);
    const maps = new Set<THREE.Material>();
    let plainHandles = 0;
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (!(o as THREE.Mesh).isMesh) return;
      if (m.map) {
        maps.add(m);
        expect((o as THREE.Mesh).geometry.attributes.uv).toBeTruthy();
      } else if (m.color.getHexString() === new THREE.Color(it.accent).getHexString()) plainHandles++;
    });
    expect(maps.size).toBe(2); // one wood, one marble material, shared by the parts
    const rough = [...maps].map((m) => (m as THREE.MeshStandardMaterial).roughness).sort();
    expect(rough[0]).toBeLessThan(0.3); // polished marble
    expect(plainHandles).toBeGreaterThan(0);
    expect(counterColorOf({ ...it, countertopColor: undefined })).toBe('#e9e6e1');
  });

  it('shared unit geometry is never modified (other pieces keep their UVs)', () => {
    const it = createItem(CATALOG.find((c) => c.kind === 'dresser')!, 0, 0);
    it.finish = finishFromPreset(presetById('oak')!);
    const before = buildItemObject({ ...it, finish: undefined });
    let shared: THREE.BufferGeometry | undefined;
    before.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as any;
      if (g?.__shared) shared = g;
    });
    const uv0 = shared ? Array.from((shared.attributes.uv as THREE.BufferAttribute).array) : [];
    const obj = buildItemObject(it);
    applyItemFinishes(obj, it);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) expect((m.geometry as any).__shared).toBeFalsy();
    });
    if (shared) expect(Array.from((shared.attributes.uv as THREE.BufferAttribute).array)).toEqual(uv0);
  });

  it('an accent material only changes accent parts (wood legs on a fabric sofa)', () => {
    const it = createItem(CATALOG.find((c) => c.kind === 'sofa')!, 0, 0);
    it.accentFinish = finishFromPreset(presetById('walnut')!);
    const obj = buildItemObject(it);
    applyItemFinishes(obj, it);
    let fabric = 0;
    let wood = 0;
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (!(o as THREE.Mesh).isMesh) return;
      if (m.map) wood++;
      else if (m.color.getHexString() === new THREE.Color(it.color).getHexString()) fabric++;
    });
    expect(wood).toBeGreaterThan(0);
    expect(fabric).toBeGreaterThan(0);
  });

  it('nothing changes without materials', () => {
    const it = createItem(CATALOG.find((c) => c.kind === 'sofa')!, 0, 0);
    expect(applyItemFinishes(buildItemObject(it), it)).toBe(0);
  });

  it('walls and ceilings use their materials; a painted accent wall keeps its paint', () => {
    const { p, room } = roomProject();
    room.wallFinish = finishFromPreset(presetById('subway-white')!);
    room.wallColors = { 1: '#3f4a59' };
    room.wallFinishes = { 2: finishFromPreset(presetById('brick-red')!) };
    room.ceilingFinish = finishFromPreset(presetById('cedar-ceiling')!);
    const built = buildHouse(p, () => {});
    const inner = built.walls.filter((w) => !w.userData.exterior);
    const byIndex = (i: number) => inner.find((w) => w.userData.index === i)!.material as THREE.MeshStandardMaterial;
    expect(byIndex(0).map).toBeTruthy();
    expect(byIndex(1).map).toBeFalsy();
    expect(byIndex(1).color.getHexString()).toBe('3f4a59');
    expect(byIndex(2).map).toBeTruthy();
    expect(byIndex(2).roughness).toBeGreaterThan(0.7); // brick is matte
    // exterior faces stay siding-colored
    for (const w of built.walls.filter((w) => w.userData.exterior)) expect((w.material as THREE.MeshStandardMaterial).map).toBeFalsy();
    let ceilingMapped = 0;
    built.ceilings[0].traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        expect((m.material as THREE.MeshStandardMaterial).map).toBeTruthy();
        expect(m.geometry.attributes.uv).toBeTruthy();
        ceilingMapped++;
      }
    });
    expect(ceilingMapped).toBeGreaterThan(0);
  });

  it('a tray ceiling band gets UVs too', () => {
    const { p, room } = roomProject();
    room.ceiling = { ...room.ceiling, type: 'tray', peakHeight: room.wallHeight + 0.3, trayInset: 0.5 };
    room.ceilingFinish = finishFromPreset(presetById('cedar-ceiling')!);
    const built = buildHouse(p, () => {});
    built.ceilings[0].traverse((o) => {
      if ((o as THREE.Mesh).isMesh) expect((o as THREE.Mesh).geometry.attributes.uv).toBeTruthy();
    });
  });
});
