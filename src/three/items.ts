import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { Item } from '../model';
import { assetUrl } from '../storage';
import { imageTexture } from './textures';
import { getStyle } from '../itemStyles';
import { B, boxGeo, cylGeo, legs, mat } from './parts';
import * as S from './styled';

// Every builder produces a group whose origin is at the bottom-center of the item's bounding box,
// width along X, depth along Z (front = +Z) and height along Y.

export { mat };











function buildMicrowave(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, h, d, mat(it.color, { metal: 0.6, rough: 0.35 }), 0, 0, 0);
  b.box(w * 0.68, h * 0.75, 0.005, mat(it.accent, { rough: 0.1 }), -w * 0.12, h * 0.12, d / 2 + 0.003);
  b.box(w * 0.18, h * 0.75, 0.005, mat('#333333'), w * 0.38, h * 0.12, d / 2 + 0.003);
  return b.g;
}



function buildWasher(it: Item, dryer: boolean) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, h, d, mat(it.color, { rough: 0.4 }), 0, 0, 0);
  b.box(w, 0.12, 0.01, mat('#dddddd'), 0, h - 0.13, d / 2 + 0.003);
  const door = b.cyl(w * 0.32, 0.03, mat(dryer ? '#bbbbbb' : '#6d7a85', { rough: 0.15, metal: 0.3 }), 0, h * 0.42, d / 2);
  door.rotation.x = Math.PI / 2;
  door.position.y = h * 0.45;
  return b.g;
}






function buildCase(it: Item, drawers: number, doors = false) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const wood = mat(it.color, { rough: 0.5 });
  const knob = mat('#c8a45a', { metal: 0.8, rough: 0.3 });
  const legH = 0.06;
  legs(b, w, d, legH, 0.04, wood, 0.02);
  b.box(w, h - legH, d, wood, 0, legH, 0);
  const front = mat(it.color, { rough: 0.45 });
  if (doors) {
    const dw = w / 2 - 0.01;
    for (const sx of [-1, 1]) {
      b.box(dw, h - legH - 0.04, 0.01, front, (sx * w) / 4, legH + 0.02, d / 2 + 0.003);
      b.box(0.015, 0.2, 0.02, knob, sx * 0.03, h * 0.5, d / 2 + 0.015);
    }
    return b.g;
  }
  const dh = (h - legH - 0.02) / drawers;
  const cols = w > 1.1 ? 2 : 1;
  for (let i = 0; i < drawers; i++)
    for (let c = 0; c < cols; c++) {
      const cx = -w / 2 + (w / cols) * (c + 0.5);
      const cy = legH + 0.01 + i * dh;
      b.box(w / cols - 0.02, dh - 0.015, 0.01, front, cx, cy, d / 2 + 0.003);
      b.sphere(0.012, knob, cx, cy + dh / 2, d / 2 + 0.015);
    }
  return b.g;
}

function buildBookshelf(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const wood = mat(it.color, { rough: 0.5 });
  const t = 0.02;
  b.box(t, h, d, wood, -w / 2 + t / 2);
  b.box(t, h, d, wood, w / 2 - t / 2);
  b.box(w, h, 0.01, wood, 0, 0, -d / 2 + 0.005);
  const shelves = Math.max(2, Math.round(h / 0.35));
  const colors = ['#8c2f39', '#2f5d8c', '#c9a227', '#3a6b35', '#5b4a7a', '#d1d1d1'];
  for (let i = 0; i <= shelves; i++) {
    const y = (i / shelves) * (h - t);
    b.box(w, t, d, wood, 0, y, 0);
    if (i < shelves) {
      let x = -w / 2 + t + 0.01;
      let k = i;
      while (x < w / 2 - 0.1) {
        const bw = 0.02 + ((k * 7) % 5) * 0.008;
        const bh = (h / shelves) * (0.6 + ((k * 3) % 4) * 0.08);
        b.box(bw, bh, d * 0.75, mat(colors[k % colors.length]), x + bw / 2, y + t, 0);
        x += bw + 0.002;
        k++;
        if (k % 9 === 0) x += 0.08;
      }
    }
  }
  return b.g;
}




function buildShower(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, 0.08, d, mat('#ffffff', { rough: 0.2 }));
  const glass = mat(it.color, { rough: 0.05, opacity: 0.25 });
  b.box(w, h - 0.08, 0.01, glass, 0, 0.08, d / 2 - 0.005);
  b.box(0.01, h - 0.08, d, glass, w / 2 - 0.005, 0.08, 0);
  const chrome = mat(it.accent, { metal: 1, rough: 0.2 });
  b.box(0.03, 0.03, 0.25, chrome, 0, h * 0.9, -d / 2 + 0.12);
  b.cyl(0.08, 0.02, chrome, 0, h * 0.88, -d / 2 + 0.24);
  return b.g;
}

function buildMirror(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.accent), 0, 0, 0);
  b.box(it.width - 0.04, it.height - 0.04, 0.002, mat(it.color, { metal: 1, rough: 0.02 }), 0, 0.02, it.depth / 2 + 0.001);
  return b.g;
}

function buildLight(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const on = it.light?.on !== false;
  const glow = mat(on ? '#fff6e0' : '#dddddd', { emissive: on ? it.light?.color ?? '#ffe2b8' : undefined });
  const body = mat(it.color, { metal: 0.5, rough: 0.4 });
  switch (it.kind) {
    case 'recessed':
      b.cyl(w / 2, h, body);
      b.cyl(w / 2 - 0.01, 0.002, glow, 0, -0.001, 0);
      break;
    case 'ceiling-light':
      b.cyl(w / 2, h, glow, 0, 0, 0, d / 2);
      break;
    case 'pendant':
      b.cyl(0.005, h - 0.2, body, 0, 0.2, 0);
      b.cyl(w / 2, 0.18, body, 0, 0.02, 0, d / 2);
      b.sphere(w * 0.15, glow, 0, w * 0.15, 0); // bulb peeking out of the shade, above the item's bottom
      break;
    case 'chandelier': {
      b.cyl(0.006, h * 0.5, body, 0, h * 0.5, 0);
      const arms = 6;
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2;
        b.cyl(0.03, 0.08, glow, Math.cos(a) * w * 0.4, h * 0.3, Math.sin(a) * d * 0.4);
        b.box(w * 0.4, 0.01, 0.01, body, Math.cos(a) * w * 0.2, h * 0.28, Math.sin(a) * d * 0.2).rotation.y = -a;
      }
      b.sphere(0.06, body, 0, h * 0.3, 0);
      break;
    }
    case 'ceiling-fan': {
      b.cyl(0.02, h * 0.6, body, 0, h * 0.4, 0);
      b.cyl(0.1, 0.1, body, 0, h * 0.3, 0);
      b.cyl(0.09, 0.05, glow, 0, h * 0.25, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const blade = b.box(w * 0.42, 0.01, 0.13, mat(it.color, { rough: 0.6 }), Math.cos(a) * w * 0.25, h * 0.33, Math.sin(a) * w * 0.25);
        blade.rotation.y = -a;
      }
      break;
    }
    case 'wall-sconce':
      b.box(0.08, 0.14, 0.02, body, 0, h * 0.3, -d / 2 + 0.01);
      b.cyl(w / 2, h * 0.5, glow, 0, h * 0.4, 0.02);
      break;
    case 'floor-lamp':
      b.cyl(w * 0.4, 0.03, body);
      b.cyl(0.012, h - 0.3, body, 0, 0.03, 0);
      b.cyl(w / 2, 0.3, mat(it.accent, { emissive: on ? '#5a4a30' : undefined, rough: 0.9 }), 0, h - 0.3, 0);
      break;
    case 'table-lamp':
      b.sphere(w * 0.3, body, 0, h * 0.22, 0, h * 0.22);
      b.cyl(w / 2, h * 0.45, mat(it.accent, { emissive: on ? '#5a4a30' : undefined, rough: 0.9 }), 0, h * 0.55, 0);
      break;
    case 'under-cabinet':
      b.box(w, h, d, glow);
      break;
    default:
      b.sphere(Math.min(w, h) / 2, glow, 0, h / 2, 0);
  }
  return b.g;
}

function buildPlant(it: Item) {
  const b = new B();
  const { width: w, height: h } = it;
  b.cyl(w * 0.3, h * 0.25, mat(it.accent, { rough: 0.8 }));
  const leaf = mat(it.color, { rough: 0.8 });
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    b.sphere(w * 0.22, leaf, Math.cos(a) * w * 0.2, h * (0.5 + (i % 3) * 0.13), Math.sin(a) * w * 0.2, h * 0.16);
  }
  return b.g;
}

function buildRug(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.color, { rough: 1 }));
  b.box(it.width * 0.8, 0.001, it.depth * 0.7, mat(it.accent, { rough: 1 }), 0, it.height, 0);
  b.box(it.width * 0.6, 0.0015, it.depth * 0.45, mat(it.color, { rough: 1 }), 0, it.height, 0);
  return b.g;
}

function buildArt(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.accent));
  b.box(it.width - 0.06, it.height - 0.06, 0.003, mat(it.color), 0, 0.03, it.depth / 2);
  b.box(it.width * 0.4, it.height * 0.4, 0.004, mat('#3b6ea5'), -it.width * 0.12, it.height * 0.25, it.depth / 2 + 0.001);
  return b.g;
}

function buildCurtains(it: Item) {
  const b = new B();
  const fab = mat(it.color, { rough: 1 });
  // rod across the top (a rotated cylinder is centred on its position, so place it explicitly)
  const rod = b.cyl(0.012, it.width - 0.02, mat('#444444', { metal: 0.7 }), 0, 0, 0);
  rod.rotation.z = Math.PI / 2;
  rod.position.y = it.height - 0.02;
  const folds = 6;
  const r = Math.min(0.035, it.depth / 2 - 0.01, it.width / 24);
  for (const side of [-1, 1]) {
    for (let i = 0; i < folds; i++) {
      const x = side * (it.width / 2 - r - i * r * 1.4);
      b.cyl(r, it.height - 0.06, fab, x, 0, (i % 2) * Math.min(0.02, it.depth / 2 - r));
    }
  }
  return b.g;
}

function buildTV(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.color, { rough: 0.2 }));
  b.box(it.width - 0.02, it.height - 0.02, 0.002, mat('#0d1b2a', { rough: 0.05, metal: 0.3 }), 0, 0.01, it.depth / 2 + 0.001);
  return b.g;
}

function buildDesk(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const wood = mat(it.color, { rough: 0.5 });
  b.box(w, 0.035, d, wood, 0, h - 0.035, 0);
  b.box(0.4, h - 0.035, d - 0.04, wood, w / 2 - 0.2, 0, 0);
  b.box(0.04, h - 0.035, d - 0.04, wood, -w / 2 + 0.02, 0, 0);
  return b.g;
}

function buildOfficeChair(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const m = mat(it.color, { rough: 0.6 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.box(w * 0.45, 0.03, 0.04, m, (Math.cos(a) * w) / 4.5, 0.04, (Math.sin(a) * w) / 4.5).rotation.y = -a;
  }
  b.cyl(0.03, 0.4, m, 0, 0.05, 0);
  b.box(w * 0.8, 0.08, d * 0.8, m, 0, 0.45, 0);
  b.box(w * 0.75, h - 0.6, 0.06, m, 0, 0.6, -d * 0.35);
  return b.g;
}

function buildStairs(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const steps = Math.max(2, Math.round(h / 0.18));
  const rise = h / steps;
  const run = d / steps;
  const m = mat(it.color, { rough: 0.5 });
  for (let i = 0; i < steps; i++) b.box(w, rise * (i + 1), run, m, 0, 0, d / 2 - run * (i + 0.5));
  return b.g;
}

function buildShelf(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.color, { rough: 0.5 }));
  return b.g;
}

// ---------------------------------------------------------------------------
// Generic shapes (custom/imported pieces)

function frontPhotoMaterials(it: Item, base: THREE.Material, onLoad: () => void): THREE.Material | THREE.Material[] {
  if (!it.imageAsset) return base;
  const tex = imageTexture(it.imageAsset, onLoad);
  const photo = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, transparent: true, alphaTest: 0.05 });
  // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z
  return [base, base, base, base, photo, base];
}

function buildGenericShape(it: Item, onLoad: () => void): THREE.Object3D {
  const base = mat(it.color, { rough: 0.6 });
  const { width: w, depth: d, height: h } = it;
  switch (it.shape) {
    case 'cylinder': {
      const mesh = new THREE.Mesh(cylGeo, it.imageAsset ? new THREE.MeshStandardMaterial({ map: imageTexture(it.imageAsset, onLoad) }) : base);
      mesh.scale.set(w, h, d);
      mesh.position.y = h / 2;
      const g = new THREE.Group();
      g.add(mesh);
      return g;
    }
    case 'cutout': {
      // Photo with removed background shown as a thin standing panel – fast way to place real furniture.
      const g = new THREE.Group();
      const tex = it.imageAsset ? imageTexture(it.imageAsset, onLoad) : null;
      const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? '#ffffff' : it.color, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      plane.position.set(0, h / 2, 0);
      g.add(plane);
      // a second crossed plane so it reads in 3D from the side
      if (d > 0.15) {
        const p2 = new THREE.Mesh(new THREE.PlaneGeometry(d, h), m);
        p2.rotation.y = Math.PI / 2;
        p2.position.set(0, h / 2, 0);
        p2.visible = false; // only used for picking volume
        g.add(p2);
      }
      // invisible picking box
      const pick = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ visible: false }));
      pick.scale.set(w, h, Math.max(d, 0.05));
      pick.position.y = h / 2;
      g.add(pick);
      return g;
    }
    case 'l-shape': {
      if (it.kind === 'sectional') return S.sectional(it);
      const r = it.legRatio ?? 0.4;
      return extrudeFootprint(
        [
          { x: -0.5, z: -0.5 },
          { x: 0.5, z: -0.5 },
          { x: 0.5, z: -0.5 + r },
          { x: -0.5 + r, z: -0.5 + r },
          { x: -0.5 + r, z: 0.5 },
          { x: -0.5, z: 0.5 },
        ],
        w,
        d,
        h,
        base,
      );
    }
    case 'footprint':
      if (it.footprint && it.footprint.length >= 3) return extrudeFootprint(it.footprint, w, d, h, base);
    // fallthrough
    case 'box':
    default: {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(boxGeo, frontPhotoMaterials(it, base, onLoad));
      mesh.scale.set(w, h, d);
      mesh.position.y = h / 2;
      g.add(mesh);
      return g;
    }
  }
}


function extrudeFootprint(fp: { x: number; z: number }[], w: number, d: number, h: number, m: THREE.Material) {
  const shape = new THREE.Shape(fp.map((p) => new THREE.Vector2(p.x * w, -p.z * d)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // Extrude goes along +Z of the shape; rotate so it rises along +Y
  geo.rotateX(-Math.PI / 2);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, m));
  return g;
}

// ---------------------------------------------------------------------------
// Imported 3D models

const modelCache = new Map<string, Promise<THREE.Object3D | null>>();

function loadModel(assetId: string, format: 'gltf' | 'obj'): Promise<THREE.Object3D | null> {
  let p = modelCache.get(assetId);
  if (!p) {
    p = (async () => {
      const url = await assetUrl(assetId);
      if (!url) return null;
      try {
        if (format === 'obj') return await new OBJLoader().loadAsync(url);
        const gltf = await new GLTFLoader().loadAsync(url);
        return gltf.scene;
      } catch (e) {
        console.warn('Model load failed', e);
        return null;
      }
    })();
    modelCache.set(assetId, p);
  }
  return p;
}

/** Fit an arbitrary model into the item's width/depth/height box. */
function fitModel(obj: THREE.Object3D, it: Item) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  obj.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  wrapper.add(obj);
  wrapper.scale.set(it.width / (size.x || 1), it.height / (size.y || 1), it.depth / (size.z || 1));
  return wrapper;
}

function buildImported(it: Item, onLoad: () => void): THREE.Object3D {
  const g = new THREE.Group();
  const placeholder = new THREE.Mesh(boxGeo, mat(it.color, { opacity: 0.4 }));
  placeholder.scale.set(it.width, it.height, it.depth);
  placeholder.position.y = it.height / 2;
  g.add(placeholder);
  if (it.modelAsset) {
    loadModel(it.modelAsset, it.modelFormat ?? 'gltf').then((obj) => {
      if (!obj) return;
      const clone = obj.clone(true);
      clone.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (it.modelFormat === 'obj') mesh.material = mat(it.color, { rough: 0.6 });
        }
      });
      g.remove(placeholder);
      g.add(fitModel(clone, it));
      onLoad();
    });
  }
  return g;
}

// ---------------------------------------------------------------------------

export function buildItemObject(it: Item, onAsyncLoad: () => void = () => {}): THREE.Object3D {
  let g: THREE.Object3D;
  if (it.shape === 'gltf') g = buildImported(it, onAsyncLoad);
  else if (it.shape !== 'model') g = buildGenericShape(it, onAsyncLoad);
  else {
    switch (it.kind) {
      case 'base-cabinet':
        g = S.baseCabinet(it, 'mixed');
        break;
      case 'drawer-base':
        g = S.baseCabinet(it, 'drawers');
        break;
      case 'sink-base':
        g = S.baseCabinet(it, 'sink');
        break;
      case 'corner-base':
        g = S.cornerBase(it);
        break;
      case 'wall-cabinet':
        g = S.wallCabinet(it);
        break;
      case 'tall-pantry':
        g = S.tallCabinet(it);
        break;
      case 'island':
        g = S.island(it);
        break;
      case 'refrigerator':
        g = S.fridge(it);
        break;
      case 'range':
        g = S.range(it);
        break;
      case 'cooktop':
        g = S.cooktop(it);
        break;
      case 'wall-oven':
        g = S.wallOven(it);
        break;
      case 'dishwasher':
        g = S.dishwasher(it);
        break;
      case 'microwave':
        g = buildMicrowave(it);
        break;
      case 'range-hood':
        g = S.hood(it);
        break;
      case 'washer':
        g = buildWasher(it, false);
        break;
      case 'dryer':
        g = buildWasher(it, true);
        break;
      case 'sofa':
      case 'loveseat':
        g = S.sofa(it);
        break;
      case 'armchair':
        g = S.sofa(it);
        break;
      case 'coffee-table':
      case 'side-table':
      case 'dining-table':
        g = S.table(it);
        break;
      case 'round-table':
        g = S.table(it, { top: 'round', base: 'pedestal' });
        break;
      case 'dining-chair':
        g = S.chair(it);
        break;
      case 'bar-stool':
        g = S.chair(it, true);
        break;
      case 'bed':
      case 'bed-king':
      case 'bed-twin':
        g = S.bed(it);
        break;
      case 'nightstand':
        g = S.caseGood(it, 2);
        break;
      case 'dresser':
        g = S.caseGood(it, 4);
        break;
      case 'wardrobe':
        g = buildCase(it, 1, true);
        break;
      case 'tv-stand':
        g = buildCase(it, 1, true);
        break;
      case 'desk':
        g = getStyle(it).base === 'pedestal' ? buildDesk(it) : S.table(it, { top: 'rect' });
        break;
      case 'office-chair':
        g = buildOfficeChair(it);
        break;
      case 'bookshelf':
        g = buildBookshelf(it);
        break;
      case 'tv':
        g = buildTV(it);
        break;
      case 'toilet':
        g = S.toilet(it);
        break;
      case 'vanity':
        g = S.vanity(it);
        break;
      case 'bathtub':
        g = S.tub(it);
        break;
      case 'shower':
        g = buildShower(it);
        break;
      case 'mirror':
        g = buildMirror(it);
        break;
      case 'plant':
        g = buildPlant(it);
        break;
      case 'rug':
        g = buildRug(it);
        break;
      case 'wall-art':
        g = buildArt(it);
        break;
      case 'curtains':
        g = buildCurtains(it);
        break;
      case 'person-man':
      case 'person-woman':
      case 'person-child':
        g = S.person(it, 'standing');
        break;
      case 'person-seated':
        g = S.person(it, 'seated');
        break;
      case 'person-wheelchair':
        g = S.person(it, 'wheelchair');
        break;
      case 'stairs':
        g = buildStairs(it);
        break;
      case 'open-shelf':
      case 'half-wall':
        g = buildShelf(it);
        break;
      default:
        if (it.category === 'lighting') g = buildLight(it);
        else g = buildGenericShape({ ...it, shape: 'box' }, onAsyncLoad);
    }
  }
  if (it.category === 'lighting' && it.shape === 'model') g = buildLight(it);
  g.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = it.category !== 'lighting';
      m.receiveShadow = true;
    }
  });
  return g;
}
