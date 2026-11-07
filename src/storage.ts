// Small IndexedDB wrapper: projects are JSON, assets (images, 3D models) are Blobs.

const DB_NAME = 'home-design-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const storage = {
  async saveProject(key: string, data: unknown) {
    try {
      await tx('projects', 'readwrite', (s) => s.put(data, key));
    } catch (e) {
      console.warn('saveProject failed', e);
    }
  },
  async loadProject(key: string): Promise<any | undefined> {
    try {
      return await tx('projects', 'readonly', (s) => s.get(key));
    } catch {
      return undefined;
    }
  },
  async listProjects(): Promise<string[]> {
    try {
      return (await tx('projects', 'readonly', (s) => s.getAllKeys())) as string[];
    } catch {
      return [];
    }
  },
  async deleteProject(key: string) {
    await tx('projects', 'readwrite', (s) => s.delete(key));
  },
  async putAsset(id: string, blob: Blob) {
    assetCache.set(id, blob);
    try {
      await tx('assets', 'readwrite', (s) => s.put(blob, id));
    } catch (e) {
      console.warn('putAsset failed', e);
    }
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
