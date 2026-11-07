import { expect, test, type Page } from '@playwright/test';

const counts = (page: Page) => page.evaluate(() => ({ rooms: (window as any).hds.store.project.rooms.length, items: (window as any).hds.store.project.items.length }));

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).hds?.store);
  // first visits show the help dialog after a short delay
  await page.locator('.modal-head .btn').click({ timeout: 8000 }).catch(() => {});
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
}

test('draw a room, place an item, undo, and it all survives a reload', async ({ page, isMobile }) => {
  await open(page);
  const before = await counts(page);

  // draw a rectangle room in the plan
  await page.click('[data-view="plan"]');
  if (isMobile) await page.click('[data-nav="Add"]');
  await page.getByRole('button', { name: /Draw room/ }).click();
  // on phones the Add sheet closes by itself once a drawing tool is picked
  if (isMobile) await expect(page.locator('.scrim')).toBeHidden();
  const box = (await page.locator('.plan-canvas').boundingBox())!;
  const x0 = box.x + box.width * 0.1;
  const y0 = box.y + box.height * 0.08;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 70, y0 + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await counts(page)).rooms).toBe(before.rooms + 1);

  // place an item from the catalog
  if (isMobile) await page.click('[data-nav="Add"]');
  await page.locator('.cat-item', { hasText: 'Sofa' }).first().click();
  await expect.poll(async () => (await counts(page)).items).toBe(before.items + 1);

  // undo removes it, redo brings it back
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await counts(page)).items).toBe(before.items);
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect.poll(async () => (await counts(page)).items).toBe(before.items + 1);

  // autosave (the save after the redo, not an earlier one) → reload → still there
  const t = await page.evaluate(() => Date.now());
  await page.waitForFunction((since) => {
    const st = (window as any).hds.store.saveStatus;
    return st.state === 'saved' && st.at >= since;
  }, t);
  await page.reload();
  await page.waitForFunction(() => (window as any).hds?.store);
  expect(await counts(page)).toEqual({ rooms: before.rooms + 1, items: before.items + 1 });
});

test('an edit made right before closing/reloading is not lost (pagehide flush)', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(600); // let the initial autosave settle
  await page.evaluate(() => (window as any).hds.store.update((p: any) => (p.name = 'saved on pagehide')));
  await page.reload(); // well inside the 400 ms autosave delay
  await page.waitForFunction(() => (window as any).hds?.store);
  expect(await page.evaluate(() => (window as any).hds.store.project.name)).toBe('saved on pagehide');
});

test('a bad project file is rejected and the design is unchanged', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await open(page);
  const before = await counts(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Open project file/ }).click()]);
  await chooser.setFiles({ name: 'broken.home.json', mimeType: 'application/json', buffer: Buffer.from('{"project":{"rooms":"nope"}}') });
  await expect(page.getByRole('heading', { name: 'Could not open that file' })).toBeVisible();
  await expect(page.locator('.modal-body')).toContainText('"rooms" must be a list');
  expect(await counts(page)).toEqual(before);
});

test('print shows a hostile project name as text', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await open(page);
  const evil = '<img src=x onerror="window.__pwned=1">';
  await page.evaluate((n) => (window as any).hds.store.update((p: any) => (p.name = n)), evil);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: /Print plan/ }).click()]);
  await popup.waitForLoadState();
  await expect(popup.locator('h2')).toHaveText(evil);
  expect(await popup.locator('img').count()).toBe(1);
  expect(await popup.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test.describe('3D checks (review Phase 2)', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only');

  test('clicking furniture in iso view with ceilings hidden selects the furniture', async ({ page }) => {
    await open(page);
    await page.click('[data-view="3d"]');
    await page.click('[data-cam="iso"]');
    await page.waitForTimeout(800);
    // find a piece whose centre is not hidden behind a wall from this angle, then click it
    const result = await page.evaluate(async () => {
      const { store, app } = (window as any).hds;
      const v = app.viewer;
      const rect = v.renderer.domElement.getBoundingClientRect();
      const tried: string[] = [];
      for (const it of store.project.items.filter((i: any) => ['sofa', 'bed', 'desk', 'dresser', 'island'].includes(i.kind))) {
        const g = v.items.get(it.id).obj;
        const p = g.position.clone();
        p.y += it.height * 0.9;
        p.project(v.camera());
        const x = rect.left + ((p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - p.y) / 2) * rect.height;
        const hit = v.pick({ clientX: x, clientY: y });
        tried.push(`${it.name}:${hit?.data.type}`);
        if (hit?.data.type === 'item' && hit.data.id === it.id) return { ok: true, tried };
      }
      return { ok: false, tried };
    });
    expect(result.ok, result.tried.join(', ')).toBe(true);
  });

  test('dragging an item with clearances shown does not leak memory', async ({ page }) => {
    await open(page);
    await page.click('[data-view="plan"]');
    const target = await page.evaluate(() => {
      const { store, app } = (window as any).hds;
      const it = store.project.items.find((i: any) => i.kind === 'coffee-table');
      store.select({ type: 'item', id: it.id });
      const s = app.plan.toScreen({ x: it.x, z: it.z });
      const r = app.plan.canvas.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    });
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    const drag = async (n: number) => {
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      for (let i = 0; i < n; i++) await page.mouse.move(target.x + 40 * Math.sin(i / 5), target.y + 40 * Math.cos(i / 5));
      await page.mouse.up();
    };
    await drag(40); // warm up caches
    const start = await heap();
    for (let k = 0; k < 4; k++) await drag(100);
    const growth = (await heap()) - start;
    expect(growth).toBeLessThan(15 * 1024 * 1024);
  });

  test('sun shadows cover the whole house, well past ±5 m', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const cam = (window as any).hds.app.viewer.sun.shadow.camera;
      return { right: cam.right, m0: cam.projectionMatrix.elements[0] };
    });
    expect(r.right).toBeGreaterThan(8);
    expect(r.m0).toBeCloseTo(2 / (2 * r.right), 5); // projection matrix really uses that extent
  });
});

test('works offline after the first visit', async ({ page, context }) => {
  await open(page);
  // wait until the service worker controls the page and has finished precaching
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).hds?.store, null, { timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).hds.store.project.rooms.length)).toBeGreaterThan(0);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.plan-canvas, .viewer-canvas').first()).toBeAttached();
  await context.setOffline(false);
});
