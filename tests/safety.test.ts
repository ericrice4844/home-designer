// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeProject, ProjectError } from '../src/model';
import { parseProjectFile } from '../src/projectFile';
import { Store } from '../src/state';
import { _resetStorageForTests, onStorageEvent, storage } from '../src/storage';
import { TabGuard, type TabChannel } from '../src/tabs';
import { showBanner } from '../src/ui/banner';
import { buildPrintDocument } from '../src/ui/print';
import { addCabinet, addDoor, roomProject } from './helpers';

const XSS = `<img src=x onerror="window.__pwned=1">`;

beforeEach(() => {
  _resetStorageForTests();
  (globalThis as any).indexedDB = new IDBFactory();
});
afterEach(() => vi.restoreAllMocks());

describe('1.1 print page', () => {
  it('renders a hostile project name as plain text', () => {
    const doc = document.implementation.createHTMLDocument('');
    buildPrintDocument(doc, XSS, 'data:image/png;base64,AA==', false);
    expect(doc.querySelector('h2')!.textContent).toBe(XSS);
    expect(doc.title).toContain(XSS);
    // only the plan image exists – no element was created from the name
    expect(doc.querySelectorAll('img')).toHaveLength(1);
    expect(doc.querySelector('img')!.getAttribute('onerror')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
  });

  it('banners never interpret their message as HTML', () => {
    const el = showBanner('t', XSS);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});

describe('1.2 restore', () => {
  it('a corrupt saved record blocks autosave and leaves the old data untouched', async () => {
    const corrupt = { rooms: 'oops', items: 5 };
    await storage.saveProject('current', corrupt);
    const s = new Store();
    const res = await s.restore();
    expect(res.status).toBe('corrupt');
    expect(s.saveBlocked).toBe('restore-failed');
    s.update((p) => (p.name = 'edited after failure'));
    expect(await s.saveNow()).toBe(false);
    await s.flush();
    expect(await storage.loadProject('current')).toEqual(corrupt);
  });

  it('a database read error is reported as corrupt, not as "no project"', async () => {
    vi.spyOn(storage, 'loadProject').mockRejectedValueOnce(new Error('boom'));
    const s = new Store();
    expect((await s.restore()).status).toBe('corrupt');
    expect(s.saveBlocked).not.toBeNull();
  });

  it('restores a good project and an empty DB reports empty', async () => {
    const s = new Store();
    expect((await s.restore()).status).toBe('empty');
    const { p } = roomProject();
    await storage.saveProject('current', p);
    expect((await s.restore()).status).toBe('ok');
    expect(s.project.rooms).toHaveLength(1);
  });

  it('"Start fresh" (allowSaves) re-enables saving', async () => {
    await storage.saveProject('current', 42);
    const s = new Store();
    await s.restore();
    s.allowSaves(false);
    s.update((p) => (p.name = 'fresh'));
    expect(await s.saveNow()).toBe(true);
    expect(((await storage.loadProject('current')) as any).name).toBe('fresh');
  });
});

describe('1.3 project validation', () => {
  const cases: [string, unknown, RegExp][] = [
    ['not an object', 'hello', /project object/],
    ['array', [1, 2], /project object/],
    ['no rooms or items', { name: 'x' }, /not a Home Design Studio project/],
    ['rooms not a list', { rooms: {} }, /"rooms" must be a list/],
    ['room with 2 points', { rooms: [{ id: 'r', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] }] }, /at least 3 corner/],
    ['NaN corner', { rooms: [{ id: 'r', points: [{ x: 0, z: 0 }, { x: 'a', z: 0 }, { x: 1, z: 1 }] }] }, /corner that is not a pair of numbers/],
    ['duplicate room id', { rooms: [{ id: 'r', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] }, { id: 'r', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] }] }, /repeats id/],
    ['negative wall height', { rooms: [{ id: 'r', wallHeight: -2, points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] }] }, /wallHeight must be a positive/],
    ['orphan opening', { rooms: [], openings: [{ roomId: 'nope', wallIndex: 0, offset: 1, width: 1, height: 2 }] }, /room that does not exist/],
    ['opening on missing wall', { rooms: [{ id: 'r', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] }], openings: [{ roomId: 'r', wallIndex: 7, offset: 1, width: 1, height: 2 }] }, /wall that does not exist/],
    ['item with negative width', { items: [{ x: 0, z: 0, width: -1, depth: 1, height: 1 }] }, /width must be a positive/],
    ['item without position', { items: [{ width: 1, depth: 1, height: 1 }] }, /no valid position/],
  ];
  for (const [name, raw, msg] of cases) {
    it(`rejects: ${name}`, () => {
      let err: unknown;
      try {
        normalizeProject(raw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ProjectError);
      expect((err as ProjectError).problems.join('\n')).toMatch(msg);
    });
  }

  it('lists every problem, not just the first', () => {
    try {
      normalizeProject({ rooms: [], items: [{ x: 0, z: 0, width: 0, depth: 1, height: 1 }, { x: 'a' }] });
    } catch (e) {
      expect((e as ProjectError).problems).toHaveLength(2);
    }
  });

  it('defaults missing item fields and drops bad colors', () => {
    const p = normalizeProject({ items: [{ x: 1, z: 2, width: 1, depth: 1, height: 1, color: 'javascript:alert(1)' }] });
    const it = p.items[0];
    expect(it.id).toBeTruthy();
    expect(it.kind).toBe('box');
    expect(it.shape).toBe('box');
    expect(it.category).toBe('custom');
    expect(it.color).toMatch(/^#/);
  });

  it('round-trips a real project', () => {
    const { p, room } = roomProject();
    addDoor(p, room);
    addCabinet(p);
    expect(normalizeProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('parseProjectFile reports bad JSON and bad assets clearly', () => {
    expect(() => parseProjectFile('{nope')).toThrow(/not valid JSON/);
    const { p } = roomProject();
    expect(() => parseProjectFile(JSON.stringify({ project: p, assets: { a: 'http://evil/x.png' } }))).toThrow(/not an embedded file/);
    const ok = parseProjectFile(JSON.stringify({ app: 'home-design-studio', project: p, assets: { a: 'data:image/png;base64,AAAA' } }));
    expect(ok.project.rooms).toHaveLength(1);
    expect(ok.assets.a).toMatch(/^data:/);
  });
});

describe('1.4 saves are visible and safe', () => {
  it('a quota error is reported through the save status (banner)', async () => {
    const s = new Store();
    const statuses: string[] = [];
    s.onSaveStatus((st) => statuses.push(st.state));
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota;
    });
    s.update((p) => (p.name = 'x'));
    expect(await s.saveNow()).toBe(false);
    expect(statuses).toContain('error');
    expect((s.saveStatus as any).error.name).toBe('QuotaExceededError');
  });

  it('putAsset writes before caching: a failed write is not cached and throws', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await expect(storage.putAsset('a1', new Blob(['x']))).rejects.toThrow();
    expect(await storage.getAsset('a1')).toBeUndefined();
  });

  it('an asset survives a reload (cache cleared)', async () => {
    // node's Blob is structured-cloneable by fake-indexeddb (happy-dom's is not)
    await storage.putAsset('a2', new NodeBlob(['hello']) as unknown as Blob);
    _resetStorageForTests();
    const b = await storage.getAsset('a2');
    expect(b).toBeDefined();
    expect(await b!.text()).toBe('hello');
  });

  it('flush writes a pending change immediately', async () => {
    const s = new Store();
    s.update((p) => (p.name = 'pending'));
    await s.flush();
    expect(((await storage.loadProject('current')) as any).name).toBe('pending');
  });

  it('a failed DB open is not cached: the next call retries', async () => {
    const real = indexedDB.open.bind(indexedDB);
    let calls = 0;
    vi.spyOn(indexedDB, 'open').mockImplementation((...a: any[]) => {
      calls++;
      if (calls === 1) throw new Error('blocked');
      return real(a[0], a[1]);
    });
    await expect(storage.loadProject('current')).rejects.toThrow();
    await expect(storage.loadProject('current')).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('onversionchange closes the DB and notifies', async () => {
    await storage.loadProject('current');
    const events: string[] = [];
    onStorageEvent((e) => events.push(e.type));
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('home-design-studio', 2);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    expect(events).toContain('versionchange');
  });
});

describe('1.4b edits right before the page closes', () => {
  it('flushOnHide keeps a synchronous copy that restore() uses and then saves', async () => {
    localStorage.clear();
    const a = new Store();
    a.update((p) => (p.name = 'last-second edit')); // autosave still pending (400 ms)
    vi.spyOn(storage, 'saveProject').mockImplementationOnce(() => new Promise(() => {})); // the async write never finishes (page gone)
    a.flushOnHide();
    expect(localStorage.getItem(a.pendingKey)).toContain('last-second edit');
    vi.restoreAllMocks();
    const b = new Store();
    expect((await b.restore()).status).toBe('ok');
    expect(b.project.name).toBe('last-second edit');
    expect(((await storage.loadProject('current')) as any).name).toBe('last-second edit');
    expect(localStorage.getItem(b.pendingKey)).toBeNull();
  });

  it('nothing is written when there is no unsaved change, or saves are blocked', async () => {
    localStorage.clear();
    const s = new Store();
    s.flushOnHide();
    expect(localStorage.getItem(s.pendingKey)).toBeNull();
    s.blockSaves('other-tab');
    s.update((p) => (p.name = 'x'));
    s.flushOnHide();
    expect(localStorage.getItem(s.pendingKey)).toBeNull();
  });

  it('an unreadable pending copy falls back to the last full save', async () => {
    localStorage.clear();
    const { p } = roomProject();
    p.name = 'full save';
    await storage.saveProject('current', p);
    const s = new Store();
    localStorage.setItem(s.pendingKey, JSON.stringify({ rooms: 'broken' }));
    expect((await s.restore()).status).toBe('ok');
    expect(s.project.name).toBe('full save');
  });
});

describe('1.5 cross-tab guard', () => {
  function pair() {
    const chans: (TabChannel & { peer?: TabChannel })[] = [];
    const make = (): TabChannel => {
      const c: any = { onmessage: null, close() {}, postMessage(m: unknown) { for (const o of chans) if (o !== c) o.onmessage?.({ data: m }); } };
      chans.push(c);
      return c;
    };
    return make;
  }

  it('warns when the same design is open in two tabs', () => {
    const make = pair();
    const a: string[] = [];
    const b: string[] = [];
    new TabGuard(new Store(), make(), (k) => a.push(k)).start();
    new TabGuard(new Store(), make(), (k) => b.push(k)).start();
    expect(a).toContain('other-tab-open');
    expect(b).toContain('other-tab-open');
  });

  it('when another tab saves, this tab stops autosaving instead of overwriting', async () => {
    const make = pair();
    const tabA = new Store();
    const tabB = new Store();
    const bEvents: string[] = [];
    new TabGuard(tabA, make(), () => {}).start();
    new TabGuard(tabB, make(), (k) => bEvents.push(k)).start();
    tabA.update((p) => (p.name = 'from A'));
    await tabA.saveNow();
    expect(bEvents).toContain('other-tab-saved');
    expect(tabB.saveBlocked).toBe('other-tab');
    tabB.update((p) => (p.name = 'from B'));
    expect(await tabB.saveNow()).toBe(false);
    expect(((await storage.loadProject('current')) as any).name).toBe('from A');
  });
});
