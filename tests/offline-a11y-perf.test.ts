// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerSource } from '../build/serviceWorker';
import { watchForUpdates, type SWLike } from '../src/swUpdate';
import { renderPixelRatio, structureMayHaveChanged } from '../src/three/perf';
import { button } from '../src/ui/dom';
import { settingsPanel, itemPanel } from '../src/ui/inspector';
import { libraryPanel } from '../src/ui/library';
import { kitchenPanel } from '../src/ui/kitchenPanel';
import { store } from '../src/state';
import { sampleHouse } from '../src/templates';

/** Run the generated worker with fake caches/fetch and capture its event handlers. */
function loadWorker(src: string, existing: string[]) {
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, unknown>>(existing.map((k) => [k, new Map()]));
  const caches = {
    open: async (k: string) => {
      if (!stores.has(k)) stores.set(k, new Map());
      const m = stores.get(k)!;
      return { addAll: async (urls: string[]) => urls.forEach((u) => m.set(u, `body:${u}`)), put: async (r: any, v: unknown) => m.set(typeof r === 'string' ? r : r.url, v) };
    },
    keys: async () => [...stores.keys()],
    delete: async (k: string) => stores.delete(k),
    match: async (r: any) => {
      for (const m of stores.values()) if (m.has(typeof r === 'string' ? r : r.url)) return m.get(typeof r === 'string' ? r : r.url);
    },
  };
  const self: any = { addEventListener: (t: string, fn: any) => (handlers[t] = fn), skipWaiting: vi.fn(), clients: { claim: vi.fn() }, location: { origin: 'https://x.test' } };
  new Function('self', 'caches', 'fetch', src)(self, caches, async () => {
    throw new Error('offline');
  });
  const run = async (type: string, e: any = {}) => {
    let p: Promise<unknown> | undefined;
    handlers[type]({ ...e, waitUntil: (x: Promise<unknown>) => (p = x), respondWith: (x: Promise<unknown>) => (p = x) });
    return p;
  };
  return { handlers, stores, self, run };
}

describe('6.1 service worker', () => {
  const src = serviceWorkerSource('v2', ['assets/index-abc.js', 'assets/index-def.css']);

  it('precaches the built assets under a versioned cache', async () => {
    const w = loadWorker(src, []);
    await w.run('install');
    expect([...w.stores.get('hds-v2')!.keys()]).toEqual(['./', './assets/index-abc.js', './assets/index-def.css']);
  });

  it('activate deletes old app caches but leaves others alone', async () => {
    const w = loadWorker(src, ['hds-v1', 'hds-v2', 'other-app']);
    await w.run('activate');
    expect([...w.stores.keys()].sort()).toEqual(['hds-v2', 'other-app']);
  });

  it('waits for the page before taking over (update prompt), then skips waiting on request', async () => {
    const w = loadWorker(src, []);
    await w.run('install');
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    w.handlers.message({ data: { type: 'SKIP_WAITING' } });
    expect(w.self.skipWaiting).toHaveBeenCalled();
  });

  it('serves the cached app shell when offline', async () => {
    const w = loadWorker(src, []);
    await w.run('install');
    const res = await w.run('fetch', { request: { method: 'GET', url: 'https://x.test/home-designer/', mode: 'navigate' } });
    expect(res).toBe('body:./');
  });

  it('cache names change when the build changes', () => {
    expect(serviceWorkerSource('a', [])).not.toEqual(serviceWorkerSource('b', []));
  });
});

describe('6.1 update prompt', () => {
  const sw = (): SWLike & { fire: () => void } => {
    let fn = () => {};
    return { state: 'installing', postMessage: vi.fn(), addEventListener: (_t, f) => (fn = f), fire: () => fn() };
  };

  it('prompts for a waiting update and activates it on accept', () => {
    const waiting = sw();
    let apply: (() => void) | null = null;
    watchForUpdates({ waiting, installing: null, addEventListener: () => {} }, () => true, (a) => (apply = a));
    expect(apply).not.toBeNull();
    apply!();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('prompts when a new version finishes installing, but not on first install', () => {
    for (const [controlled, expected] of [
      [true, 1],
      [false, 0],
    ] as const) {
      const installing = sw();
      let onFound = () => {};
      const prompts: unknown[] = [];
      watchForUpdates({ waiting: null, installing, addEventListener: (_t, f) => (onFound = f) }, () => controlled, (a) => prompts.push(a));
      onFound();
      installing.state = 'installed';
      installing.fire();
      expect(prompts).toHaveLength(expected);
    }
  });
});

describe('6.2 viewport', () => {
  it('allows pinch-zoom (no user-scalable=no / maximum-scale)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/user-scalable\s*=\s*no/);
    expect(html).not.toMatch(/maximum-scale/);
  });
});

describe('6.3 accessibility', () => {
  it('icon-only buttons get their tooltip as an accessible name', () => {
    expect(button('⟲', () => {}, 'icon', 'Rotate left').getAttribute('aria-label')).toBe('Rotate left');
    expect(button('Delete', () => {}, '', 'Delete item').getAttribute('aria-label')).toBeNull(); // has visible text
  });

  it('every button in the side panels has an accessible name', () => {
    store.load(sampleHouse());
    const item = store.project.items.find((i) => i.kind === 'sofa')!;
    const panels = [
      settingsPanel(() => {}),
      itemPanel(item),
      kitchenPanel(() => {}),
      libraryPanel({ place: () => {}, center: () => ({ x: 0, z: 0 }) }),
    ];
    const unnamed: string[] = [];
    for (const panel of panels)
      for (const b of panel.querySelectorAll('button')) {
        const name = b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '';
        if (!/[a-z0-9]/i.test(name)) unnamed.push(b.outerHTML.slice(0, 80));
      }
    expect(unnamed).toEqual([]);
  });

  it('no <label> lends its text to a button (chip rows use role=group instead)', () => {
    store.load(sampleHouse());
    const items = ['sofa', 'base-cabinet', 'refrigerator', 'pendant'].map((k) => store.project.items.find((i) => i.kind === k)!).filter(Boolean);
    const panels = [settingsPanel(() => {}), kitchenPanel(() => {}), ...items.map((i) => itemPanel(i))];
    const bad: string[] = [];
    for (const panel of panels)
      for (const label of panel.querySelectorAll('label')) {
        const first = label.querySelector('button, input, select, textarea');
        if (first?.tagName === 'BUTTON') bad.push(label.textContent!.slice(0, 60));
      }
    expect(bad).toEqual([]);
  });

  it('styles include a visible focus ring and reduced-motion support', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe('6.4 mobile performance', () => {
  it('caps the pixel ratio lower on touch devices', () => {
    expect(renderPixelRatio(3, true)).toBe(1.5);
    expect(renderPixelRatio(3, false)).toBe(2);
    expect(renderPixelRatio(1, true)).toBe(1);
  });
  it('skips the wall/room comparison while only furniture is being dragged', () => {
    expect(structureMayHaveChanged('live', 'items')).toBe(false);
    expect(structureMayHaveChanged('live', 'structure')).toBe(true);
    expect(structureMayHaveChanged('project', 'items')).toBe(true);
    expect(structureMayHaveChanged('ui', 'structure')).toBe(false);
  });
  it('the 3D renderer no longer keeps the drawing buffer', () => {
    expect(readFileSync('src/three/viewer.ts', 'utf8')).not.toMatch(/preserveDrawingBuffer:\s*true/);
  });
});
