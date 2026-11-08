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
  await page.getByRole('button', { name: '📐 Wall elevation', exact: true }).click();
  const svg = page.locator('.elevation-holder svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator(`[data-item-id="${rangeId}"]`)).toHaveCount(1);
  await expect(svg.locator('text', { hasText: /^3' 0"$/ }).first()).toBeVisible(); // a dimension

  // step to the next wall and back
  const wallSelect = page.getByRole('combobox', { name: 'Wall' });
  const before = await wallSelect.inputValue();
  await page.getByRole('button', { name: 'Next wall' }).click();
  await expect(wallSelect).not.toHaveValue(before);
  await page.getByRole('button', { name: 'Previous wall' }).click();
  await expect(wallSelect).toHaveValue(before);

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

/** Screen boxes of every piece in the open elevation. */
async function pieces(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.elevation-holder [data-item-id]')].map((g) => {
      const r = (g.querySelector('rect') as SVGRectElement).getBoundingClientRect();
      const it = (window as any).hds.store.item(g.getAttribute('data-item-id'));
      return { id: g.getAttribute('data-item-id')!, kind: it.kind, x: r.x, y: r.y, w: r.width, h: r.height, wx: it.x, wz: it.z, wy: it.y };
    }),
  );
}

test('drag a wall cabinet along the wall: it snaps against its neighbour, stays on the wall, and undo puts it back', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse drag on desktop');
  await open(page);
  await selectRangeWall(page);
  await page.getByRole('button', { name: '📐 Wall elevation', exact: true }).click();
  const all = await pieces(page);
  const uppers = all.filter((p) => p.kind === 'wall-cabinet' || p.kind === 'range-hood');
  // an upper with a gap to its left neighbour
  let target: (typeof uppers)[number] | undefined;
  let leftEdge = 0;
  for (const u of uppers) {
    const left = uppers.filter((o) => o !== u && o.x + o.w <= u.x + 1 && o.y < u.y + u.h && o.y + o.h > u.y);
    const edge = Math.max(...left.map((o) => o.x + o.w));
    if (left.length && u.x - edge > 15) {
      target = u;
      leftEdge = edge;
      break;
    }
  }
  expect(target, 'sample kitchen has an upper with a gap beside it').toBeTruthy();
  const t = target!;
  // perpendicular distance from the wall before moving (the wall runs along one axis in the sample)
  const before = { x: t.wx, z: t.wz };

  // drag left, stopping a few pixels short: snapping closes the gap
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - (t.x - leftEdge) + 4, cy, { steps: 10 });
  expect(await page.locator('.elevation-holder line[stroke-dasharray="5 4"]').count()).toBeGreaterThan(0); // snap guide shown while dragging
  await page.mouse.up();

  const after = (await pieces(page)).find((p) => p.id === t.id)!;
  expect(Math.abs(after.x - leftEdge)).toBeLessThan(1.5); // butted against the neighbour
  // it slid along the wall only: one plan coordinate changed, the other didn't
  const movedX = Math.abs(after.wx - before.x) > 0.01;
  const movedZ = Math.abs(after.wz - before.z) > 0.01;
  expect(movedX !== movedZ).toBe(true);
  expect(after.wy).toBeCloseTo(t.wy, 6); // a horizontal drag keeps the height

  // the dialog stays open after a drag; Done, then Undo restores it
  await expect(page.locator('.modal-overlay')).toHaveCount(1);
  await page.locator('.modal').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Undo/ }).click();
  const restored = await page.evaluate((id) => (window as any).hds.store.item(id), t.id);
  expect(restored.x).toBeCloseTo(before.x, 6);
  expect(restored.z).toBeCloseTo(before.z, 6);
});

test('floor cabinets cannot be dragged off the floor', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse drag on desktop');
  await open(page);
  const { rangeId } = await selectRangeWall(page);
  await page.getByRole('button', { name: '📐 Wall elevation', exact: true }).click();
  const base = (await pieces(page)).find((p) => p.kind === 'base-cabinet' && p.id !== rangeId)!;
  await page.mouse.move(base.x + base.w / 2, base.y + base.h / 2);
  await page.mouse.down();
  await page.mouse.move(base.x + base.w / 2, base.y + base.h / 2 - 80, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate((id) => (window as any).hds.store.item(id).y, base.id)).toBe(0);
});

test('a free-standing sofa: pick a wall, see it projected, push it against the wall', async ({ page, isMobile }) => {
  await open(page);
  const sofaId = await page.evaluate(() => {
    const { store } = (window as any).hds;
    const sofa = store.project.items.find((i: any) => i.kind === 'sofa');
    store.select({ type: 'item', id: sofa.id });
    return sofa.id;
  });
  await page.locator('.action-bar').getByRole('button', { name: /Wall/ }).click();
  // it is not against a wall, so the app asks which wall – nearest first
  await expect(page.getByRole('heading', { name: /Which wall should/ })).toBeVisible();
  const first = page.locator('.modal .wall-item').first();
  await expect(first).toContainText('(nearest)');
  await first.click();
  // projected (dashed) on the chosen wall
  const g = page.locator(`.elevation-holder [data-item-id="${sofaId}"] rect`).first();
  await expect(g).toHaveAttribute('stroke-dasharray', '6 4');
  await page.getByRole('button', { name: /Push against this wall/ }).click();
  await expect(g).not.toHaveAttribute('stroke-dasharray', '6 4');
  // now anchored: Elevation view opens that wall directly
  await page.locator('.modal').getByRole('button', { name: 'Done' }).click();
  await page.evaluate((id) => (window as any).hds.store.select({ type: 'item', id }), sofaId);
  await page.locator('.action-bar').getByRole('button', { name: /Wall/ }).click();
  await expect(page.getByRole('heading', { name: 'Wall elevation' })).toBeVisible();
  await expect(page.locator(`.elevation-holder [data-item-id="${sofaId}"] rect`).first()).not.toHaveAttribute('stroke-dasharray', '6 4');
});

test('pick any wall of a room from the elevation dropdown', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await open(page);
  await page.evaluate(() => {
    const { store } = (window as any).hds;
    store.select({ type: 'room', id: store.project.rooms.find((r: any) => r.name === 'Bath').id });
  });
  await page.getByRole('button', { name: /Wall elevations/ }).click();
  await page.locator('.modal .wall-item', { hasText: 'South wall' }).click();
  const select = page.getByRole('combobox', { name: 'Wall' });
  await expect(select).toHaveValue('2');
  await expect(page.locator('.elevation-holder text', { hasText: /Vanity/ }).first()).toBeVisible();
  await select.selectOption({ label: /North wall/ as any }).catch(async () => {
    const opts = await select.locator('option').allTextContents();
    await select.selectOption({ label: opts.find((o) => o.startsWith('North wall'))! });
  });
  await expect(select).toHaveValue('0');
  await expect(page.locator('.elevation-holder text', { hasText: /Bathtub/ }).first()).toBeVisible();
});
