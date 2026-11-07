import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).hds?.store);
  await page.locator('.modal-head .btn').click({ timeout: 8000 }).catch(() => {});
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
}

/** Select the kitchen wall that holds the range in the sample house. */
async function selectRangeWall(page: Page) {
  return page.evaluate(() => {
    const { store } = (window as any).hds;
    const k = store.project.rooms.find((r: any) => r.name === 'Kitchen');
    const range = store.project.items.find((i: any) => i.kind === 'range');
    // the wall whose inner face is nearest the range's back
    let best = { index: 0, d: Infinity };
    k.points.forEach((a: any, i: number) => {
      const b = k.points[(i + 1) % k.points.length];
      const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
      const t = Math.max(0, Math.min(1, ((range.x - a.x) * (b.x - a.x) + (range.z - a.z) * (b.z - a.z)) / l2));
      const d = Math.hypot(range.x - a.x - (b.x - a.x) * t, range.z - a.z - (b.z - a.z) * t);
      if (d < best.d) best = { index: i, d };
    });
    store.select({ type: 'wall', roomId: k.id, index: best.index });
    return { roomId: k.id, index: best.index, rangeId: range.id };
  });
}

test('select a kitchen wall, see its items, open the elevation and pick a cabinet', async ({ page, isMobile }) => {
  await open(page);
  const { rangeId } = await selectRangeWall(page);
  if (isMobile) await page.click('[data-nav="Edit"]');

  // the Edit panel leads with the wall's contents, visible without scrolling
  const list = page.locator('.wall-items');
  await expect(list).toBeInViewport();
  await expect(list.locator('.wall-item', { hasText: 'Range / Stove' })).toBeVisible();
  await expect(list.locator('.wall-item', { hasText: 'Range Hood' })).toBeVisible();
  await expect(list.locator('.wall-item', { hasText: 'Wall Cabinet' }).first()).toBeVisible();
  await expect(list.locator('.wall-item', { hasText: 'Island' })).toHaveCount(0);

  // elevation drawing
  await page.getByRole('button', { name: /Wall elevation/ }).click();
  const svg = page.locator('.elevation-holder svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator(`[data-item-id="${rangeId}"]`)).toHaveCount(1);
  await expect(svg.locator('text', { hasText: /^3' 0"$/ }).first()).toBeVisible(); // a dimension

  // step to the next wall and back
  const title = page.locator('.elevation-bar span').first();
  const before = await title.textContent();
  await page.getByRole('button', { name: 'Next wall' }).click();
  await expect(title).not.toHaveText(before!);
  await page.getByRole('button', { name: 'Previous wall' }).click();
  await expect(title).toHaveText(before!);

  // tapping a piece selects it for editing
  await svg.locator(`[data-item-id="${rangeId}"] rect`).first().click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).hds.store.ui.selection)).toEqual({ type: 'item', id: rangeId });
});

test('view a wall square-on in 3D, showing only that room', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await open(page);
  await selectRangeWall(page);
  await page.getByRole('button', { name: /View wall in 3D/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).hds.store.ui.camera)).toBe('front');
  const r = await page.evaluate(() => {
    const v = (window as any).hds.app.viewer;
    const rooms = v.structure.children.filter((o: any) => o.userData.type === 'room');
    return { visible: rooms.filter((o: any) => o.visible).length, total: rooms.length, focus: v.focusRoomId };
  });
  expect(r.total).toBeGreaterThan(1);
  expect(r.visible).toBe(1);
  // choosing another camera brings the whole house back
  await page.click('[data-cam="iso"]');
  await expect.poll(() => page.evaluate(() => (window as any).hds.app.viewer.structure.children.filter((o: any) => o.userData.type === 'room' && !o.visible).length)).toBe(0);
});
