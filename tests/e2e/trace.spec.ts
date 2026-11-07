import { expect, test, type Page } from '@playwright/test';
const PLAN = 'tests/e2e/fixtures/plan.png';

// fixture: 30' × 20' 1½" outside (wall centerlines), interior wall 15' from the left, 10 px walls
const FT = 0.3048;
const IN = 0.0254;

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).hds?.store);
  await page.locator('.modal-head .btn').click({ timeout: 8000 }).catch(() => {});
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
}

/** Screen position of an image pixel of the traced plan (mirrors underlay.pixelToWorld). */
function screenOf(page: Page, px: number, py: number) {
  return page.evaluate(
    ([x, y]) => {
      const { store, app } = (window as any).hds;
      const u = store.project.underlay;
      const lx = x * u.scaleX;
      const lz = y * u.scaleZ;
      const w = { x: u.x + lx * Math.cos(u.rotation) - lz * Math.sin(u.rotation), z: u.z + lx * Math.sin(u.rotation) + lz * Math.cos(u.rotation) };
      const s = app.plan.toScreen(w);
      const r = app.plan.canvas.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    },
    [px, py],
  );
}

async function dragPx(page: Page, a: [number, number], b: [number, number], jitter = 3) {
  const A = await screenOf(page, ...a);
  const B = await screenOf(page, ...b);
  // deliberately off by a few screen pixels: snapping must find the wall centerline
  await page.mouse.move(A.x + jitter, A.y - jitter);
  await page.mouse.down();
  await page.mouse.move(B.x - jitter, B.y + jitter, { steps: 8 });
  await page.mouse.up();
}

async function enterLength(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Real length' });
  await input.fill(text);
  await input.press('Enter');
}

test('upload a plan, set its scale, verify it and trace rooms that share a wall', async ({ page, isMobile }) => {
  test.skip(isMobile, 'tracing precision is checked on desktop; the phone flow is covered below');
  await open(page);
  await page.click('[data-view="plan"]');
  // start from an empty design so traced rooms are easy to find
  await page.evaluate(() => (window as any).hds.store.update((p: any) => ((p.rooms = []), (p.items = []), (p.openings = []))));

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Upload floor plan/ }).click()]);
  await chooser.setFiles(PLAN);
  await page.waitForFunction(() => (window as any).hds.store.ui.tool === 'calibrate');
  // make the plan fill the view so a screen pixel is small
  await page.evaluate(() => {
    const { store, app } = (window as any).hds;
    const u = store.project.underlay;
    app.plan.view.cx = u.x + (u.pixelWidth * u.scaleX) / 2;
    app.plan.view.cz = u.z + (u.pixelHeight * u.scaleZ) / 2;
    app.plan.view.zoom = Math.min(app.plan.W / (u.pixelWidth * u.scaleX), app.plan.H / (u.pixelHeight * u.scaleZ)) * 0.9;
    app.plan.dirty = true;
  });
  await page.waitForFunction(() => {
    const { store } = (window as any).hds;
    return !!store.project.underlay && document.querySelector('.plan-canvas');
  });
  await page.waitForTimeout(500); // image + wall mask load

  // 1. set the scale along the top wall: 30'
  await dragPx(page, [44.5, 44.5], [954.5, 44.5]);
  await enterLength(page, `30'`);
  await expect(page.getByRole('heading', { name: 'Scale set' })).toBeVisible();
  await page.getByRole('button', { name: 'Check another dimension' }).click();

  // 2. check the left wall: 20' 1½" → within tolerance
  await dragPx(page, [44.5, 44.5], [44.5, 654.5]);
  await enterLength(page, `20' 1 1/2"`);
  await expect(page.getByRole('heading', { name: /Plan checks out/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start tracing' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).hds.store.ui.tool)).toBe('room-rect');

  // 3. trace the left room (to the interior wall) and the right room
  await dragPx(page, [44.5, 44.5], [499.5, 654.5]);
  await page.evaluate(() => (window as any).hds.store.setUI({ tool: 'room-rect' }));
  await dragPx(page, [499.5, 44.5], [954.5, 654.5]);

  const rooms = await page.evaluate(() =>
    (window as any).hds.store.project.rooms.map((r: any) => {
      const xs = r.points.map((p: any) => p.x);
      const zs = r.points.map((p: any) => p.z);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    }),
  );
  expect(rooms).toHaveLength(2);
  const [left, right] = rooms.sort((a: any, b: any) => a.minX - b.minX);
  const tol = 1 * IN; // traced to within an inch
  expect(left.maxX - left.minX).toBeCloseTo(15 * FT, 1);
  expect(Math.abs(left.maxX - left.minX - 15 * FT)).toBeLessThan(tol);
  expect(Math.abs(right.maxX - right.minX - 15 * FT)).toBeLessThan(tol);
  expect(Math.abs(left.maxZ - left.minZ - (20 * FT + 1.5 * IN))).toBeLessThan(tol);
  // the shared wall is exactly the same line, so a door on it connects both rooms
  expect(left.maxX).toBeCloseTo(right.minX, 9);
  expect(left.minZ).toBeCloseTo(right.minZ, 9);

  // 4. the plan image is saved with the project and survives a reload
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => (window as any).hds?.store);
  expect(await page.evaluate(() => (window as any).hds.store.project.underlay?.calibrated)).toBe(true);
});

test('phone: upload a plan and the scale prompt appears', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  await open(page);
  await page.click('[data-nav="Add"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Upload floor plan/ }).click()]);
  await chooser.setFiles(PLAN);
  await page.waitForFunction(() => (window as any).hds.store.ui.tool === 'calibrate');
  // the sheet got out of the way and the plan is visible
  await expect(page.locator('.plan-canvas')).toBeVisible();
  await expect(page.locator('.sidebar.left')).not.toBeInViewport();
});
