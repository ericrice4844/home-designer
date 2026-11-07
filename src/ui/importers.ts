import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { CATEGORY_LABELS } from '../catalog';
import { IN, uid, type Item, type ItemCategory, type ItemShape, type Vec2 } from '../model';
import { moveItem } from '../placement';
import { store } from '../state';
import { storage } from '../storage';
import { button, checkbox, field, h, lengthInput, modal, pickFile, select, toast } from './dom';
import { hideBanner, showBanner } from './banner';
import { describeError } from './errors';

/** Store an imported file; on failure tell the user (it would otherwise vanish on reload). */
async function safePutAsset(id: string, blob: Blob): Promise<boolean> {
  try {
    await storage.putAsset(id, blob);
    return true;
  } catch (e) {
    showBanner('asset', `Could not save the imported file: ${describeError(e)}. It was not added. Free up space or export your project.`, [{ label: 'Dismiss', run: () => hideBanner('asset') }]);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Personal library (saved custom pieces)

const LIB_KEY = 'hds-library';
export type LibraryEntry = Omit<Item, 'id' | 'x' | 'z' | 'rotation'> & { libId: string };

export function loadLibrary(): LibraryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
  } catch {
    return [];
  }
}
export function saveLibrary(lib: LibraryEntry[]) {
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  window.dispatchEvent(new Event('library-changed'));
}

export function placeLibraryEntry(e: LibraryEntry, at: Vec2) {
  const { libId, ...rest } = e;
  void libId;
  const it: Item = { ...JSON.parse(JSON.stringify(rest)), id: uid('item'), x: at.x, z: at.z, rotation: 0 };
  store.update((p) => {
    moveItem(p, it, at.x, at.z);
    p.items.push(it);
  });
  store.select({ type: 'item', id: it.id });
}

let getCenter: () => Vec2 = () => ({ x: 0, z: 0 });
export function setPlacementCenter(fn: () => Vec2) {
  getCenter = fn;
}

// ---------------------------------------------------------------------------
// Footprint presets & editor

export const FOOTPRINTS: Record<string, Vec2[]> = {
  rectangle: [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: 0.5, z: 0.5 },
    { x: -0.5, z: 0.5 },
  ],
  'L-shape': [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: 0.5, z: -0.1 },
    { x: -0.1, z: -0.1 },
    { x: -0.1, z: 0.5 },
    { x: -0.5, z: 0.5 },
  ],
  'U-shape': [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: 0.5, z: 0.5 },
    { x: 0.2, z: 0.5 },
    { x: 0.2, z: -0.1 },
    { x: -0.2, z: -0.1 },
    { x: -0.2, z: 0.5 },
    { x: -0.5, z: 0.5 },
  ],
  trapezoid: [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: 0.3, z: 0.5 },
    { x: -0.3, z: 0.5 },
  ],
  octagon: Array.from({ length: 8 }, (_, i) => ({ x: 0.5 * Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8), z: 0.5 * Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) })),
  'rounded front': [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    ...Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * Math.PI;
      return { x: 0.5 * Math.cos(a), z: 0.5 * Math.sin(a) * 1 };
    }),
  ],
  'curved sofa': [
    ...Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI + (i / 8) * Math.PI;
      return { x: 0.5 * Math.cos(a), z: 0.5 + 0.9 * Math.sin(a) };
    }),
    ...Array.from({ length: 9 }, (_, i) => {
      const a = -(i / 8) * Math.PI;
      return { x: 0.32 * Math.cos(a), z: 0.5 + 0.45 * Math.sin(a) };
    }),
  ],
};

export function footprintEditor(initial: Vec2[], onChange: (pts: Vec2[]) => void) {
  let pts = initial.map((p) => ({ ...p }));
  const S = 220;
  const cv = h('canvas', { width: S * 2, height: S * 2, class: 'fp-canvas', style: { width: `${S}px`, height: `${S}px` } });
  const ctx = cv.getContext('2d')!;
  ctx.scale(2, 2);
  const toS = (p: Vec2) => ({ x: S / 2 + p.x * (S - 30), y: S / 2 + p.z * (S - 30) });
  const toP = (x: number, y: number) => ({ x: clampN((x - S / 2) / (S - 30)), z: clampN((y - S / 2) / (S - 30)) });
  let dragI = -1;
  const draw = () => {
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = '#ddd';
    ctx.strokeRect(15, 15, S - 30, S - 30);
    ctx.fillStyle = '#999';
    ctx.font = '10px system-ui';
    ctx.fillText('back', S / 2 - 10, 11);
    ctx.fillText('front', S / 2 - 12, S - 3);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = toS(p);
      i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(47,128,237,0.2)';
    ctx.fill();
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const p of pts) {
      const s = toS(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
    }
  };
  const local = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  cv.addEventListener('pointerdown', (e) => {
    const l = local(e);
    dragI = pts.findIndex((p) => {
      const s = toS(p);
      return Math.hypot(s.x - l.x, s.y - l.y) < 10;
    });
    if (dragI < 0) {
      // insert on nearest edge
      let best = -1;
      let bd = 14;
      for (let i = 0; i < pts.length; i++) {
        const a = toS(pts[i]);
        const b = toS(pts[(i + 1) % pts.length]);
        const d = segDist(l, a, b);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) {
        pts.splice(best + 1, 0, toP(l.x, l.y));
        dragI = best + 1;
      }
    }
    cv.setPointerCapture(e.pointerId);
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    if (dragI < 0) return;
    const l = local(e);
    pts[dragI] = toP(l.x, l.y);
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (dragI >= 0) onChange(pts.map((p) => ({ ...p })));
    dragI = -1;
  });
  cv.addEventListener('dblclick', (e) => {
    const l = local(e as unknown as PointerEvent);
    const i = pts.findIndex((p) => {
      const s = toS(p);
      return Math.hypot(s.x - l.x, s.y - l.y) < 10;
    });
    if (i >= 0 && pts.length > 3) {
      pts.splice(i, 1);
      draw();
      onChange(pts.map((p) => ({ ...p })));
    }
  });
  draw();
  const presets = h(
    'div',
    { class: 'chips' },
    ...Object.keys(FOOTPRINTS).map((k) =>
      button(k, () => {
        pts = FOOTPRINTS[k].map((p) => ({ ...p }));
        draw();
        onChange(pts.map((p) => ({ ...p })));
      }, 'chip'),
    ),
  );
  return h('div', { class: 'fp-editor' }, cv, h('p', { class: 'hint' }, 'Drag points to reshape · tap an edge to add a point · double-click a point to remove'), presets);
}

function clampN(v: number) {
  return Math.max(-0.5, Math.min(0.5, v));
}
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

// ---------------------------------------------------------------------------
// Photo import

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Erase pixels connected to the seeds whose color is within `tol` of the seed color. */
export function floodErase(data: ImageData, seeds: [number, number][], tol: number) {
  const { width: W, height: H, data: d } = data;
  const visited = new Uint8Array(W * H);
  const tol2 = tol * tol * 3;
  for (const [sx, sy] of seeds) {
    const si = (sy * W + sx) * 4;
    if (d[si + 3] === 0) continue;
    const r0 = d[si];
    const g0 = d[si + 1];
    const b0 = d[si + 2];
    const stack = [sy * W + sx];
    while (stack.length) {
      const p = stack.pop()!;
      if (visited[p]) continue;
      visited[p] = 1;
      const i = p * 4;
      const dr = d[i] - r0;
      const dg = d[i + 1] - g0;
      const db = d[i + 2] - b0;
      if (d[i + 3] !== 0 && dr * dr + dg * dg + db * db > tol2) continue;
      d[i + 3] = 0;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < W - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - W);
      if (y < H - 1) stack.push(p + W);
    }
  }
  // soften the edge a little
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      const n = (d[i - 4 + 3] === 0 ? 1 : 0) + (d[i + 4 + 3] === 0 ? 1 : 0) + (d[i - W * 4 + 3] === 0 ? 1 : 0) + (d[i + W * 4 + 3] === 0 ? 1 : 0);
      if (n >= 2) d[i + 3] = 140;
    }
}

function opaqueBounds(data: ImageData) {
  const { width: W, height: H, data: d } = data;
  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  if (maxX < 0) return { x: 0, y: 0, w: W, h: H };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function averageColor(data: ImageData): string {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const d = data.data;
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 128) continue;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  if (!n) return '#888888';
  const c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
  return `#${c.getHexString()}`;
}

export async function openPhotoImport(capture = false) {
  const file = await pickFile('image/*', capture);
  if (!file) return;
  const img = await loadImage(file);
  const MAX = 900;
  const k = Math.min(1, MAX / Math.max(img.width, img.height));
  const W = Math.round(img.width * k);
  const H = Math.round(img.height * k);
  const work = h('canvas', { width: W, height: H, class: 'photo-canvas' });
  const wctx = work.getContext('2d', { willReadFrequently: true })!;
  wctx.drawImage(img, 0, 0, W, H);
  const original = wctx.getImageData(0, 0, W, H);
  const history: ImageData[] = [];

  const state = {
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'My Item',
    category: 'furniture' as ItemCategory,
    shape: 'box' as ItemShape,
    width: 36 * IN,
    depth: 24 * IN,
    height: 36 * IN,
    y: 0,
    lockAspect: true,
    color: averageColor(original),
    footprint: FOOTPRINTS.rectangle.map((p) => ({ ...p })),
    tolerance: 32,
    eraseMode: false,
    saveToLibrary: true,
  };
  const aspect = () => {
    const ob = opaqueBounds(wctx.getImageData(0, 0, W, H));
    return ob.h / ob.w;
  };
  state.height = state.width * aspect();

  const dimsBox = h('div', { class: 'grid3' });
  const renderDims = () => {
    dimsBox.replaceChildren(
      field('Width', lengthInput(state.width, (v) => {
        state.width = v;
        if (state.lockAspect) state.height = v * aspect();
        renderDims();
      })),
      field('Depth', lengthInput(state.depth, (v) => {
        state.depth = v;
        renderDims();
      })),
      field('Height', lengthInput(state.height, (v) => {
        state.height = v;
        if (state.lockAspect) state.width = v / aspect();
        renderDims();
      })),
      field('Elevation', lengthInput(state.y, (v) => {
        state.y = Math.max(0, v);
        renderDims();
      })),
    );
  };
  renderDims();

  const fpWrap = h('div', { class: 'fp-wrap hidden' }, footprintEditor(state.footprint, (p) => (state.footprint = p)));
  const shapeSel = select<ItemShape>(state.shape, [
    ['box', 'Box – photo on front face'],
    ['cutout', 'Cut-out – standing photo (best with background removed)'],
    ['cylinder', 'Cylinder – photo wrapped around'],
    ['l-shape', 'L-shape (sectional, corner desk)'],
    ['footprint', 'Custom footprint – draw the shape'],
  ], (v) => {
    state.shape = v;
    fpWrap.classList.toggle('hidden', v !== 'footprint');
  });

  const doRemoveBg = () => {
    const data = wctx.getImageData(0, 0, W, H);
    history.push(wctx.getImageData(0, 0, W, H));
    const seeds: [number, number][] = [];
    for (let x = 0; x < W; x += 8) seeds.push([x, 0], [x, H - 1]);
    for (let y = 0; y < H; y += 8) seeds.push([0, y], [W - 1, y]);
    floodErase(data, seeds, state.tolerance);
    wctx.putImageData(data, 0, 0);
    state.color = averageColor(data);
  };

  work.addEventListener('click', (e) => {
    if (!state.eraseMode) return;
    const r = work.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * H);
    history.push(wctx.getImageData(0, 0, W, H));
    const data = wctx.getImageData(0, 0, W, H);
    floodErase(data, [[x, y]], state.tolerance);
    wctx.putImageData(data, 0, 0);
  });

  const eraseBtn = button('🪄 Tap-to-erase: off', () => {
    state.eraseMode = !state.eraseMode;
    eraseBtn.textContent = `🪄 Tap-to-erase: ${state.eraseMode ? 'ON – tap background areas' : 'off'}`;
    eraseBtn.classList.toggle('primary', state.eraseMode);
  });

  const body = h(
    'div',
    { class: 'import-grid' },
    h(
      'div',
      { class: 'import-preview' },
      h('div', { class: 'checker' }, work),
      h(
        'div',
        { class: 'row wrap' },
        button('✂️ Remove background', doRemoveBg, 'primary'),
        eraseBtn,
        button('↺ Undo', () => {
          const prev = history.pop();
          if (prev) wctx.putImageData(prev, 0, 0);
        }),
        button('Reset', () => {
          wctx.putImageData(original, 0, 0);
          history.length = 0;
        }),
      ),
      field('Background tolerance', h('input', { type: 'range', min: 4, max: 120, value: String(state.tolerance), oninput: (e: Event) => (state.tolerance = Number((e.target as HTMLInputElement).value)) })),
    ),
    h(
      'div',
      { class: 'import-form' },
      field('Name', h('input', { type: 'text', value: state.name, oninput: (e: Event) => (state.name = (e.target as HTMLInputElement).value) })),
      field('Category', select<ItemCategory>(state.category, Object.entries(CATEGORY_LABELS) as [ItemCategory, string][], (v) => (state.category = v))),
      field('Shape', shapeSel),
      fpWrap,
      dimsBox,
      checkbox(state.lockAspect, 'Keep photo proportions (width ↔ height)', (v) => (state.lockAspect = v)),
      field('Side / body color', colorInputStandalone(state.color, (c) => (state.color = c)), 'Used for the sides and top of the piece'),
      checkbox(state.saveToLibrary, 'Save to “My items” library for reuse', (v) => (state.saveToLibrary = v)),
    ),
  );

  const m = modal('Import furniture from a photo', body, [
    button('Cancel', () => m.close(), 'ghost'),
    button('Add to design', async () => {
      const data = wctx.getImageData(0, 0, W, H);
      const ob = opaqueBounds(data);
      const out = document.createElement('canvas');
      out.width = ob.w;
      out.height = ob.h;
      out.getContext('2d')!.putImageData(data, -ob.x, -ob.y);
      const blob: Blob = await new Promise((r) => out.toBlob((b) => r(b!), 'image/png'));
      const assetId = uid('img');
      if (!(await safePutAsset(assetId, blob))) return;
      const c = getCenter();
      const it: Item = {
        id: uid('item'),
        kind: 'custom-photo',
        name: state.name || 'Imported item',
        category: state.category,
        x: c.x,
        z: c.z,
        y: state.y,
        rotation: 0,
        width: state.width,
        depth: state.shape === 'cutout' ? Math.min(state.depth, 0.6) : state.depth,
        height: state.height,
        color: state.color,
        accent: '#555555',
        shape: state.shape,
        imageAsset: assetId,
        footprint: state.shape === 'footprint' ? state.footprint : undefined,
        legRatio: 0.4,
      };
      store.update((p) => {
        moveItem(p, it, c.x, c.z);
        p.items.push(it);
      });
      store.select({ type: 'item', id: it.id });
      if (state.saveToLibrary) addToLibrary(it);
      m.close();
      toast(`Added “${it.name}”`);
    }, 'primary'),
  ]);
}

function colorInputStandalone(value: string, onChange: (c: string) => void) {
  const i = h('input', { type: 'color', value });
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

export function addToLibrary(it: Item) {
  const { id, x, z, rotation, ...rest } = it;
  void id;
  void x;
  void z;
  void rotation;
  const lib = loadLibrary();
  lib.push({ ...JSON.parse(JSON.stringify(rest)), libId: uid('lib') });
  saveLibrary(lib);
}

// ---------------------------------------------------------------------------
// 3D model import (fixtures, appliances, furniture from manufacturers / 3D warehouses)

export async function openModelImport() {
  const file = await pickFile('.glb,.gltf,.obj,model/gltf-binary,model/gltf+json');
  if (!file) return;
  const lower = file.name.toLowerCase();
  const format: 'gltf' | 'obj' = lower.endsWith('.obj') ? 'obj' : 'gltf';
  const assetId = uid('model');
  if (!(await safePutAsset(assetId, file))) return;
  const url = URL.createObjectURL(file);
  let obj: THREE.Object3D;
  try {
    obj = format === 'obj' ? await new OBJLoader().loadAsync(url) : (await new GLTFLoader().loadAsync(url)).scene;
  } catch (e) {
    toast('Could not read that model. Use .glb (recommended), self-contained .gltf, or .obj.');
    return;
  }
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  let unitScale = 1;
  if (maxDim > 300) unitScale = 0.001;
  else if (maxDim > 30) unitScale = 0.01;
  else if (maxDim < 0.05) unitScale = 100;
  const state = {
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 30),
    category: 'appliance' as ItemCategory,
    width: Math.max(0.05, size.x * unitScale),
    depth: Math.max(0.05, size.z * unitScale),
    height: Math.max(0.05, size.y * unitScale),
    y: 0,
    color: '#bbbbbb',
    save: true,
  };
  const dims = h('div', { class: 'grid3' });
  const render = () =>
    dims.replaceChildren(
      field('Width', lengthInput(state.width, (v) => ((state.width = v), render()))),
      field('Depth', lengthInput(state.depth, (v) => ((state.depth = v), render()))),
      field('Height', lengthInput(state.height, (v) => ((state.height = v), render()))),
      field('Elevation', lengthInput(state.y, (v) => ((state.y = Math.max(0, v)), render()))),
    );
  render();
  const body = h(
    'div',
    { class: 'import-form' },
    h('p', { class: 'hint' }, `Detected size ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} model units${unitScale !== 1 ? ` (auto-scaled ×${unitScale})` : ''}. Adjust to the real product dimensions — the model is stretched to fit.`),
    field('Name', h('input', { type: 'text', value: state.name, oninput: (e: Event) => (state.name = (e.target as HTMLInputElement).value) })),
    field('Category', select<ItemCategory>(state.category, Object.entries(CATEGORY_LABELS) as [ItemCategory, string][], (v) => (state.category = v))),
    dims,
    format === 'obj' ? field('Color (OBJ has no materials)', colorInputStandalone(state.color, (c) => (state.color = c))) : null,
    checkbox(state.save, 'Save to “My items” library', (v) => (state.save = v)),
  );
  const m = modal('Import 3D model', body, [
    button('Cancel', () => m.close(), 'ghost'),
    button('Add to design', () => {
      const c = getCenter();
      const it: Item = {
        id: uid('item'),
        kind: 'custom-model',
        name: state.name || 'Model',
        category: state.category,
        x: c.x,
        z: c.z,
        y: state.y,
        rotation: 0,
        width: state.width,
        depth: state.depth,
        height: state.height,
        color: state.color,
        accent: '#555555',
        shape: 'gltf',
        modelAsset: assetId,
        modelFormat: format,
      };
      store.update((p) => {
        moveItem(p, it, c.x, c.z);
        p.items.push(it);
      });
      store.select({ type: 'item', id: it.id });
      if (state.save) addToLibrary(it);
      m.close();
    }, 'primary'),
  ]);
}

/** Import an image to use as a floor pattern / texture. Returns asset id. */
export async function importPatternImage(): Promise<string | null> {
  const file = await pickFile('image/*');
  if (!file) return null;
  const img = await loadImage(file);
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  // center-crop to square
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, S, S);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
  const id = uid('pat');
  if (!(await safePutAsset(id, blob))) return null;
  return id;
}

