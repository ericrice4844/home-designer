// Small IndexedDB wrapper: projects are JSON, assets (images, 3D models) are Blobs.
// Writes throw on failure (quota, blocked DB…) so callers can tell the user instead of losing data silently.

const DB_NAME = 'home-design-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
type StorageEvent = { type: 'versionchange' } | { type: 'error'; error: unknown };
const storageListeners = new Set<(e: StorageEvent) => void>();

export function onStorageEvent(fn: (e: StorageEvent) => void) {
  storageListeners.add(fn);
  return () => storageListeners.delete(fn);
}

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets');
      };
      req.onsuccess = () => {
        const d = req.result;
        // A newer version of the app opened the DB in another tab: close so it can upgrade, and tell the UI.
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
          for (const l of storageListeners) l({ type: 'versionchange' });
        };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked by another tab'));
    });
    dbPromise = p;
    // never cache a failed open – the next call retries
    p.catch(() => {
      if (dbPromise === p) dbPromise = null;
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    let result: T;
    const t = d.transaction(store, mode);
    let req: IDBRequest<T>;
    try {
      req = fn(t.objectStore(store));
    } catch (e) {
      reject(e);
      return;
    }
    req.onsuccess = () => {
      result = req.result;
      if (mode === 'readonly') resolve(result);
    };
    req.onerror = () => reject(req.error);
    // for writes, only resolve once the transaction has really committed
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    t.onerror = () => reject(t.error ?? req.error);
  });
}

export const storage = {
  /** Throws if the project could not be written. */
  async saveProject(key: string, data: unknown): Promise<void> {
    await tx('projects', 'readwrite', (s) => s.put(data, key));
  },
  /** Throws if the database cannot be read (so a failed read is never mistaken for "no project"). */
  async loadProject(key: string): Promise<unknown> {
    return tx('projects', 'readonly', (s) => s.get(key));
  },
  async listProjects(): Promise<string[]> {
    return (await tx('projects', 'readonly', (s) => s.getAllKeys())) as string[];
  },
  async deleteProject(key: string) {
    await tx('projects', 'readwrite', (s) => s.delete(key));
  },
  /** Persist first, cache second: a failed write throws and is not cached, so a reload never loses it silently. */
  async putAsset(id: string, blob: Blob): Promise<void> {
    await tx('assets', 'readwrite', (s) => s.put(blob, id));
    assetCache.set(id, blob);
  },
  async getAsset(id: string): Promise<Blob | undefined> {
    if (assetCache.has(id)) return assetCache.get(id);
    try {
      const b = (await tx('assets', 'readonly', (s) => s.get(id))) as Blob | undefined;
      if (b) assetCache.set(id, b);
      return b;
    } catch {
      return undefined;
    }
  },
};

const assetCache = new Map<string, Blob>();
const urlCache = new Map<string, string>();

/** Test hook: forget in-memory caches and the DB connection (simulates a reload). */
export function _resetStorageForTests() {
  assetCache.clear();
  urlCache.clear();
  dbPromise?.then((d) => d.close()).catch(() => {});
  dbPromise = null;
}

/** Object URL for an asset (cached). */
export async function assetUrl(id: string): Promise<string | undefined> {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await storage.getAsset(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}
