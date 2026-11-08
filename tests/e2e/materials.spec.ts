import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.addInitScript(() => localStorage.setItem('hds-help-seen', '1'));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).hds?.store);
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
}

async function selectKitchen(page: Page, isMobile: boolean) {
  const id = await page.evaluate(() => {
    const { store } = (window as any).hds;
    const k = store.project.rooms.find((r: any) => r.name === 'Kitchen');
    store.select({ type: 'room', id: k.id });
    return k.id as string;
  });
  if (isMobile) await page.click('[data-nav="Edit"]');
  return id;
}

/** The 3D materials of a room's inner walls, once the viewer has rebuilt. */
async function wallMaps(page: Page, roomId: string) {
  await page.waitForTimeout(400);
  return page.evaluate((roomId) => {
    const v = (window as any).hds.app.viewer;
    return v.walls.filter((w: any) => w.userData.roomId === roomId && !w.userData.exterior).map((w: any) => !!w.material.map);
  }, roomId);
}

test('floors: pick a tile, colors start from it, accents switch off, undo brings the old floor back', async ({ page, isMobile }) => {
  await open(page);
  const roomId = await selectKitchen(page, isMobile);
  const before = await page.evaluate((id) => (window as any).hds.store.room(id).floor, roomId);
  const floor = page.locator(`[data-finish="floor:${roomId}"]`);
  await floor.getByRole('tab', { name: 'Tile & brick' }).click();
  await floor.locator('[data-preset="subway-sage"]').click();
  const f = await page.evaluate((id) => (window as any).hds.store.room(id).floor, roomId);
  expect(f).toMatchObject({ type: 'subway', preset: 'subway-sage', color: '#a8b5a0', accent: '#e6e3dc' });

  // the color pickers start from the material's own mix, with swatches of that family
  const colors = floor.locator('input[type=color]');
  await expect(colors.nth(0)).toHaveValue('#a8b5a0');
  await expect(colors.nth(1)).toHaveValue('#e6e3dc');
  await expect(floor.locator('.swatch[title="#a8b5a0"]').first()).toBeVisible();
  await expect(floor.locator('.finish-current b')).toHaveText('Sage subway');

  // a different pattern brings its own colors
  await floor.getByRole('combobox', { name: 'Pattern' }).selectOption('hex');
  expect(await page.evaluate((id) => (window as any).hds.store.room(id).floor.type, roomId)).toBe('hex');
  await expect(floor.locator('input[type=color]').nth(0)).toHaveValue('#f1f0ec');

  // accents off: grout follows the tile color, the grout picker goes away
  await floor.getByLabel('Show grout').uncheck();
  expect(await page.evaluate((id) => (window as any).hds.store.room(id).floor.accents, roomId)).toBe(false);
  await expect(floor.locator('input[type=color]')).toHaveCount(1);
  await floor.getByLabel('Show grout').check();
  expect(await page.evaluate((id) => (window as any).hds.store.room(id).floor.accents, roomId)).toBeUndefined();

  // four steps: material, pattern, accents off, accents on
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) (window as any).hds.store.undo();
  });
  expect(await page.evaluate((id) => (window as any).hds.store.room(id).floor, roomId)).toEqual(before);
});

test('walls: tile the whole room, an accent wall in brick, back to paint', async ({ page, isMobile }) => {
  await open(page);
  const roomId = await selectKitchen(page, isMobile);
  expect((await wallMaps(page, roomId)).some(Boolean)).toBe(false);

  const walls = page.locator(`[data-finish="walls:${roomId}"]`);
  await walls.getByRole('tab', { name: 'Tile & brick' }).click();
  await walls.locator('[data-preset="subway-white"]').click();
  expect(await page.evaluate((id) => (window as any).hds.store.room(id).wallFinish?.preset, roomId)).toBe('subway-white');
  expect((await wallMaps(page, roomId)).every(Boolean)).toBe(true);

  // one wall in brick
  await page.evaluate((id) => (window as any).hds.store.select({ type: 'wall', roomId: id, index: 1 }), roomId);
  const one = page.locator(`[data-finish="wall:${roomId}:1"]`);
  await one.getByRole('tab', { name: 'Tile & brick' }).click();
  await one.locator('[data-preset="brick-red"]').click();
  const r = await page.evaluate((id) => (window as any).hds.store.room(id), roomId);
  expect(r.wallFinishes[1].type).toBe('brick');
  expect(r.wallFinish.type).toBe('subway');

  // the room back to paint: the brick accent wall stays
  await page.evaluate((id) => (window as any).hds.store.select({ type: 'room', id }), roomId);
  await page.locator(`[data-finish="walls:${roomId}"]`).getByRole('tab', { name: 'Paint' }).click();
  const after = await page.evaluate((id) => (window as any).hds.store.room(id), roomId);
  expect(after.wallFinish).toBeUndefined();
  expect(after.wallFinishes[1].type).toBe('brick');
  const maps = await wallMaps(page, roomId);
  expect(maps.filter(Boolean)).toHaveLength(1);
});

test('cabinets: walnut doors and marble counters, then on every cabinet in the room', async ({ page, isMobile }) => {
  await open(page);
  const id = await page.evaluate(() => {
    const { store } = (window as any).hds;
    const it = store.project.items.find((i: any) => i.kind === 'base-cabinet' && i.countertop);
    store.select({ type: 'item', id: it.id });
    return it.id as string;
  });
  if (isMobile) await page.click('[data-nav="Edit"]');
  const body = page.locator(`[data-finish="item:${id}:finish"]`);
  await body.getByRole('tab', { name: 'Wood' }).click();
  await body.locator('[data-preset="walnut"]').click();
  const counter = page.locator(`[data-finish="item:${id}:counterFinish"]`);
  await counter.getByRole('tab', { name: 'Stone' }).click();
  await counter.locator('[data-preset="carrara"]').click();
  const it = await page.evaluate((id) => (window as any).hds.store.item(id), id);
  expect(it.finish.preset).toBe('walnut');
  expect(it.color).toBe(it.finish.color);
  expect(it.counterFinish.preset).toBe('carrara');
  // countertops only offer counter materials: no carpet, no subway tile
  await expect(counter.locator('[data-preset="subway-white"]')).toHaveCount(0);

  // the 3D cabinet uses both materials
  await page.waitForTimeout(400);
  const textured = await page.evaluate((id) => {
    const v = (window as any).hds.app.viewer;
    const mats = new Set<any>();
    v.items.get(id).obj.traverse((o: any) => o.isMesh && o.material.map && mats.add(o.material));
    return mats.size;
  }, id);
  expect(textured).toBe(2);

  await page.getByRole('button', { name: 'Use these materials on all cabinets in the room' }).click();
  const all = await page.evaluate(() => {
    const { store } = (window as any).hds;
    const k = store.project.items.filter((i: any) => i.category === 'kitchen');
    return { n: k.length, walnut: k.filter((i: any) => i.finish?.preset === 'walnut').length };
  });
  expect(all.walnut).toBe(all.n);

  // back to a plain color
  await page.locator(`[data-finish="item:${id}:finish"]`).getByRole('tab', { name: 'Color' }).click();
  expect(await page.evaluate((id) => (window as any).hds.store.item(id).finish, id)).toBeUndefined();
});

test('every material swatch renders, and every pattern tiles without a visible seam', async ({ page, isMobile }) => {
  test.skip(isMobile, 'pattern drawing is the same on every device');
  await open(page);
  const res = await page.evaluate(() => {
    const { drawFinish, finishPreview, finishFromPreset, MATERIAL_PRESETS } = (window as any).hds.materials;
    const out: { id: string; blank: boolean; seamX: number; seamY: number; inner: number }[] = [];
    for (const p of MATERIAL_PRESETS) {
      if (!finishPreview(finishFromPreset(p)).startsWith('data:image/png')) out.push({ id: p.id, blank: true, seamX: 0, seamY: 0, inner: 0 });
      const S = 256;
      const { ctx } = drawFinish(finishFromPreset(p), S);
      const d = ctx.getImageData(0, 0, S, S).data;
      const px = (x: number, y: number) => {
        const o = (y * S + x) * 4;
        return d[o] + d[o + 1] + d[o + 2];
      };
      // the wrap must look like any other line inside the pattern: the jump from the last column (row) to the
      // first may be no bigger than the strongest jump between neighbouring columns (rows) inside it
      let seamX = 0;
      let seamY = 0;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < S; i++) {
        seamX += Math.abs(px(S - 1, i) - px(0, i));
        seamY += Math.abs(px(i, S - 1) - px(i, 0));
        min = Math.min(min, px(i, i));
        max = Math.max(max, px(i, i));
      }
      let inner = 0;
      for (let k = 0; k < S - 1; k++) {
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < S; i++) {
          cx += Math.abs(px(k, i) - px(k + 1, i));
          cy += Math.abs(px(i, k) - px(i, k + 1));
        }
        inner = Math.max(inner, cx / S, cy / S);
      }
      out.push({ id: p.id, blank: max - min < 3, seamX: seamX / S, seamY: seamY / S, inner });
    }
    return out;
  });
  for (const r of res) {
    expect(r.blank, `${r.id} is a flat color`).toBe(false);
    const limit = r.inner * 1.15 + 6;
    expect(r.seamX, `${r.id}: seam at the left/right edge`).toBeLessThan(limit);
    expect(r.seamY, `${r.id}: seam at the top/bottom edge`).toBeLessThan(limit);
  }
});
