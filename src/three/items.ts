import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { Item } from '../model';
import { assetUrl } from '../storage';
import { imageTexture } from './textures';

// Every builder produces a group whose origin is at the bottom-center of the item's bounding box,
// width along X, depth along Z (front = +Z) and height along Y.

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; opacity?: number } = {}) {
  const key = `${color}|${opts.rough ?? 0.7}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissive ? 1 : 0,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    m.userData.cached = true;
    matCache.set(key, m);
  }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
const sphGeo = new THREE.SphereGeometry(0.5, 24, 16);
for (const g of [boxGeo, cylGeo, sphGeo]) (g as any).__shared = true;

class B {
  g = new THREE.Group();
  /** box with bottom at y; x,z are center */
  box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(boxGeo, m);
    mesh.scale.set(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001));
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, rz = r) {
    const mesh = new THREE.Mesh(cylGeo, m);
    mesh.scale.set(r * 2, h, rz * 2);
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  sphere(r: number, m: THREE.Material, x = 0, y = 0, z = 0, sy = r) {
    const mesh = new THREE.Mesh(sphGeo, m);
    mesh.scale.set(r * 2, sy * 2, r * 2);
    mesh.position.set(x, y, z);
    this.g.add(mesh);
    return mesh;
  }
}

function legs(b: B, w: number, d: number, h: number, t: number, m: THREE.Material, inset = 0.03) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box(t, h, t, m, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2));
}

/** Cabinet front with doors / drawers, handles. */
function cabinetFront(b: B, w: number, h: number, d: number, y: number, body: THREE.Material, handleM: THREE.Material, style: 'doors' | 'drawers' | 'sink' | 'mixed') {
  const z = d / 2 + 0.005;
  const gap = 0.004;
  const panelM = body;
  const addHandle = (cx: number, cy: number, horizontal: boolean) => {
    if (horizontal) b.box(Math.min(0.15, w * 0.4), 0.012, 0.02, handleM, cx, cy, z + 0.012);
    else b.box(0.012, 0.12, 0.02, handleM, cx, cy - 0.06, z + 0.012);
  };
  if (style === 'drawers') {
    const n = 3;
    const ph = (h - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const py = y + gap + i * (ph + gap);
      b.box(w - gap * 2, ph, 0.018, panelM, 0, py, z);
      addHandle(0, py + ph * 0.75, true);
    }
    return;
  }
  let doorH = h;
  if (style === 'mixed') {
    const drawerH = 0.15;
    b.box(w - gap * 2, drawerH - gap, 0.018, panelM, 0, y + h - drawerH, z);
    addHandle(0, y + h - drawerH / 2, true);
    doorH = h - drawerH - gap;
  }
  const doors = w > 0.55 ? 2 : 1;
  const dw = (w - gap * (doors + 1)) / doors;
  for (let i = 0; i < doors; i++) {
    const cx = -w / 2 + gap + dw / 2 + i * (dw + gap);
    b.box(dw, doorH - gap * 2, 0.018, panelM, cx, y + gap, z);
    // shaker rails
    const rail = mat('#000000', { opacity: 0.06 });
    b.box(dw - 0.1, doorH - 0.12, 0.002, rail, cx, y + 0.06, z + 0.01);
    const hx = doors === 2 ? (i === 0 ? cx + dw / 2 - 0.04 : cx - dw / 2 + 0.04) : cx + dw / 2 - 0.04;
    if (style === 'sink') addHandle(cx, y + doorH - 0.05, true);
    else addHandle(hx, y + doorH - 0.05, false);
  }
}

function buildBaseCabinet(it: Item, style: 'mixed' | 'drawers' | 'sink') {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const handle = mat(it.accent, { metal: 0.8, rough: 0.3 });
  const toe = 0.1;
  const ct = it.countertop ? 0.03 : 0;
  b.box(w - 0.02, toe, d - 0.08, mat('#2a2a2a'), 0, 0, -0.04);
  b.box(w, h - toe - ct, d - 0.02, body, 0, toe, -0.01);
  cabinetFront(b, w, h - toe - ct, d - 0.02, toe, body, handle, style);
  if (it.countertop) {
    const ctm = mat(it.countertopColor ?? '#e9e6e1', { rough: 0.25 });
    b.box(w, ct, d + 0.02, ctm, 0, h - ct, 0.01);
    if (style === 'sink') {
      const sinkW = Math.min(w - 0.15, 0.76);
      b.box(sinkW, 0.02, d * 0.6, mat('#9ea4aa', { metal: 0.9, rough: 0.25 }), 0, h - 0.015, 0.02);
      b.box(sinkW - 0.04, 0.005, d * 0.55, mat('#55595e', { metal: 0.9, rough: 0.3 }), 0, h + 0.006, 0.02);
      // faucet
      const fm = mat('#c0c4c8', { metal: 1, rough: 0.2 });
      b.cyl(0.015, 0.3, fm, 0, h, -d * 0.35);
      b.box(0.03, 0.03, 0.2, fm, 0, h + 0.27, -d * 0.27);
    }
  }
  return b.g;
}

function buildCornerBase(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const handle = mat(it.accent, { metal: 0.8, rough: 0.3 });
  const leg = 0.61;
  const ct = it.countertop ? 0.03 : 0;
  // L shaped: back strip full width (depth leg), plus left strip full depth
  b.box(w, h - ct, leg, body, 0, 0, -d / 2 + leg / 2);
  b.box(leg, h - ct, d, body, -w / 2 + leg / 2, 0, 0);
  b.box(0.3, 0.6, 0.02, body, -w / 2 + leg + 0.15, 0.15, -d / 2 + leg + 0.01);
  b.box(0.012, 0.12, 0.02, handle, -w / 2 + leg + 0.25, 0.6, -d / 2 + leg + 0.03);
  if (it.countertop) {
    const ctm = mat(it.countertopColor ?? '#e9e6e1', { rough: 0.25 });
    b.box(w, ct, leg + 0.02, ctm, 0, h - ct, -d / 2 + leg / 2 + 0.01);
    b.box(leg + 0.02, ct, d, ctm, -w / 2 + leg / 2 + 0.01, h - ct, 0);
  }
  return b.g;
}

function buildWallCabinet(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  b.box(w, h, d - 0.02, body, 0, 0, -0.01);
  cabinetFront(b, w, h, d - 0.02, 0, body, mat(it.accent, { metal: 0.8, rough: 0.3 }), 'doors');
  return b.g;
}

function buildTall(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const handle = mat(it.accent, { metal: 0.8, rough: 0.3 });
  b.box(w, h, d - 0.02, body, 0, 0, -0.01);
  cabinetFront(b, w, h * 0.62, d - 0.02, 0, body, handle, 'doors');
  cabinetFront(b, w, h * 0.38 - 0.004, d - 0.02, h * 0.62 + 0.004, body, handle, 'doors');
  return b.g;
}

function buildIsland(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const handle = mat(it.accent, { metal: 0.8, rough: 0.3 });
  const over = 0.25; // seating overhang on the back
  const bodyD = Math.max(0.3, d - over);
  b.box(w - 0.02, 0.1, bodyD - 0.06, mat('#2a2a2a'), 0, 0, over / 2);
  b.box(w, h - 0.13, bodyD, body, 0, 0.1, over / 2);
  cabinetFront(b, w, h - 0.13, bodyD - over, 0.1, body, handle, 'mixed');
  b.box(w + 0.03, 0.04, d + 0.03, mat(it.countertopColor ?? '#f1efea', { rough: 0.2 }), 0, h - 0.04, 0);
  return b.g;
}

function buildFridge(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const steel = mat(it.color, { metal: 0.6, rough: 0.35 });
  const handle = mat('#e0e0e0', { metal: 1, rough: 0.2 });
  b.box(w, h, d - 0.04, steel, 0, 0, -0.02);
  const split = h * 0.38;
  b.box(w / 2 - 0.006, h - split - 0.01, 0.04, steel, -w / 4, split + 0.005, d / 2 - 0.02);
  b.box(w / 2 - 0.006, h - split - 0.01, 0.04, steel, w / 4, split + 0.005, d / 2 - 0.02);
  b.box(w - 0.01, split - 0.03, 0.04, steel, 0, 0.02, d / 2 - 0.02);
  b.box(0.02, 0.6, 0.03, handle, -0.03, split + 0.25, d / 2 + 0.02);
  b.box(0.02, 0.6, 0.03, handle, 0.03, split + 0.25, d / 2 + 0.02);
  b.box(w * 0.6, 0.02, 0.03, handle, 0, split - 0.1, d / 2 + 0.02);
  // water dispenser
  b.box(0.12, 0.2, 0.005, mat('#222222'), -w / 4, split + 0.55, d / 2 + 0.002);
  return b.g;
}

function buildRange(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const steel = mat(it.color, { metal: 0.6, rough: 0.35 });
  const black = mat(it.accent, { rough: 0.3 });
  b.box(w, h - 0.02, d, steel, 0, 0, 0);
  b.box(w, 0.02, d - 0.08, black, 0, h - 0.02, 0.02);
  // back guard + knobs
  b.box(w, 0.12, 0.05, steel, 0, h - 0.02, -d / 2 + 0.025);
  const burners = w > 0.85 ? 6 : 4;
  const cols = burners / 2;
  const grate = mat('#111111', { rough: 0.6 });
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < 2; j++) {
      const bx = -w / 2 + (w / cols) * (i + 0.5);
      const bz = -d / 2 + 0.12 + j * (d - 0.24) * 0.6 + 0.08;
      b.cyl(0.06, 0.012, grate, bx, h, bz);
    }
  // oven door
  b.box(w - 0.04, h * 0.55, 0.03, steel, 0, 0.12, d / 2);
  b.box(w - 0.16, h * 0.28, 0.005, mat('#141414', { rough: 0.1 }), 0, 0.25, d / 2 + 0.017);
  b.box(w - 0.12, 0.025, 0.03, mat('#dddddd', { metal: 1, rough: 0.2 }), 0, h * 0.55 + 0.06, d / 2 + 0.035);
  for (let i = 0; i < burners; i++) b.cyl(0.018, 0.025, black, -w / 2 + 0.06 + i * ((w - 0.12) / Math.max(1, burners - 1)), h - 0.1, d / 2 + 0.01).rotation.x = Math.PI / 2;
  return b.g;
}

function buildCooktop(it: Item) {
  const b = new B();
  b.box(it.width, it.height, it.depth, mat(it.color, { rough: 0.15 }), 0, 0, 0);
  const ring = mat('#444444', { rough: 0.4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.08, 0.002, ring, sx * it.width * 0.25, it.height, sz * it.depth * 0.22);
  return b.g;
}

function buildDishwasher(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const steel = mat(it.color, { metal: 0.6, rough: 0.35 });
  const ct = it.countertop ? 0.03 : 0;
  b.box(w, 0.1, d - 0.08, mat('#2a2a2a'), 0, 0, -0.04);
  b.box(w, h - 0.1 - ct, d - 0.02, steel, 0, 0.1, -0.01);
  b.box(w - 0.1, 0.02, 0.03, mat('#dddddd', { metal: 1, rough: 0.2 }), 0, h - ct - 0.08, d / 2 + 0.01);
  b.box(w - 0.04, 0.06, 0.005, mat(it.accent), 0, h - ct - 0.06, d / 2 - 0.005);
  if (it.countertop) b.box(w, ct, d + 0.02, mat(it.countertopColor ?? '#e9e6e1', { rough: 0.25 }), 0, h - ct, 0.01);
  return b.g;
}

function buildMicrowave(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, h, d, mat(it.color, { metal: 0.6, rough: 0.35 }), 0, 0, 0);
  b.box(w * 0.68, h * 0.75, 0.005, mat(it.accent, { rough: 0.1 }), -w * 0.12, h * 0.12, d / 2 + 0.003);
  b.box(w * 0.18, h * 0.75, 0.005, mat('#333333'), w * 0.38, h * 0.12, d / 2 + 0.003);
  return b.g;
}

function buildHood(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const steel = mat(it.color, { metal: 0.7, rough: 0.3 });
  b.box(w, 0.1, d, steel, 0, 0, 0);
  // tapered canopy approximated by stacked boxes + chimney
  b.box(w * 0.75, 0.12, d * 0.75, steel, 0, 0.1, -d * 0.12);
  b.box(w * 0.3, h - 0.22, d * 0.4, steel, 0, 0.22, -d * 0.3);
  return b.g;
}

function buildWallOven(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const steel = mat(it.accent, { metal: 0.6, rough: 0.3 });
  b.box(w, h, d - 0.02, body, 0, 0, -0.01);
  for (const oy of [0.75, 1.42]) {
    b.box(w - 0.06, 0.6, 0.03, steel, 0, oy - 0.3, d / 2);
    b.box(w - 0.2, 0.35, 0.005, mat('#141414', { rough: 0.1 }), 0, oy - 0.22, d / 2 + 0.017);
    b.box(w - 0.15, 0.025, 0.03, mat('#dddddd', { metal: 1, rough: 0.2 }), 0, oy + 0.22, d / 2 + 0.035);
  }
  cabinetFront(b, w, 0.42, d - 0.02, 0, body, steel, 'drawers');
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

function buildSofa(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const fab = mat(it.color, { rough: 0.95 });
  const leg = mat(it.accent);
  const legH = 0.08;
  const arm = Math.min(0.2, w * 0.12);
  const seatH = h * 0.5;
  legs(b, w, d, legH, 0.04, leg);
  b.box(w, seatH - legH - 0.12, d, fab, 0, legH, 0);
  b.box(w, h - legH, d * 0.25, fab, 0, legH, -d / 2 + d * 0.125);
  b.box(arm, h * 0.7 - legH, d, fab, -w / 2 + arm / 2, legH, 0);
  b.box(arm, h * 0.7 - legH, d, fab, w / 2 - arm / 2, legH, 0);
  const seats = Math.max(1, Math.round((w - arm * 2) / 0.6));
  const cw = (w - arm * 2) / seats;
  for (let i = 0; i < seats; i++) {
    b.box(cw - 0.015, 0.12, d * 0.72, fab, -w / 2 + arm + cw * (i + 0.5), seatH - 0.12, d * 0.12);
    b.box(cw - 0.03, h * 0.42, 0.14, fab, -w / 2 + arm + cw * (i + 0.5), seatH, -d / 2 + d * 0.25 + 0.06);
  }
  return b.g;
}

function buildArmchair(it: Item) {
  return buildSofa(it);
}

function buildTable(it: Item, round: boolean) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const wood = mat(it.color, { rough: 0.5 });
  const top = 0.04;
  if (round) {
    b.cyl(w / 2, top, wood, 0, h - top, 0, d / 2);
    b.cyl(0.05, h - top, wood, 0, 0, 0);
    b.cyl(Math.min(w, d) * 0.25, 0.03, wood, 0, 0, 0);
  } else {
    b.box(w, top, d, wood, 0, h - top, 0);
    legs(b, w, d, h - top, 0.06, wood, 0.05);
  }
  return b.g;
}

function buildChair(it: Item, stool = false) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const wood = mat(it.color, { rough: 0.5 });
  const seat = mat(it.accent, { rough: 0.9 });
  if (stool) {
    b.cyl(w / 2, 0.06, seat, 0, h - 0.06, 0);
    legs(b, w * 0.8, d * 0.8, h - 0.06, 0.025, wood, 0);
    b.box(w * 0.7, 0.02, 0.02, wood, 0, h * 0.3, d * 0.36);
    return b.g;
  }
  const seatH = 0.46;
  legs(b, w, d, seatH - 0.05, 0.035, wood, 0.01);
  b.box(w, 0.05, d, seat, 0, seatH - 0.05, 0);
  b.box(w, h - seatH, 0.03, wood, 0, seatH, -d / 2 + 0.015);
  return b.g;
}

function buildBed(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const frame = mat(it.accent, { rough: 0.6 });
  const linen = mat(it.color, { rough: 0.95 });
  b.box(w, 0.3, d, frame, 0, 0.05, 0);
  legs(b, w, d, 0.05, 0.06, frame, 0);
  b.box(w - 0.04, 0.25, d - 0.08, linen, 0, 0.35, 0.03);
  b.box(w, h, 0.08, frame, 0, 0, -d / 2 + 0.04);
  const pillows = w > 1.2 ? 2 : 1;
  const pw = (w - 0.15) / pillows;
  for (let i = 0; i < pillows; i++) b.box(pw - 0.05, 0.12, 0.35, mat('#ffffff', { rough: 0.95 }), -w / 2 + 0.075 + pw * (i + 0.5), 0.6, -d / 2 + 0.3);
  b.box(w - 0.02, 0.04, d * 0.6, mat('#c9b9a3', { rough: 0.95 }), 0, 0.6, d * 0.2);
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

function buildToilet(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const por = mat(it.color, { rough: 0.15 });
  b.box(w * 0.9, h - 0.4, 0.2, por, 0, 0.4, -d / 2 + 0.1);
  b.cyl(w * 0.3, 0.38, por, 0, 0, 0.06, w * 0.38);
  b.cyl(w * 0.45, 0.04, por, 0, 0.38, 0.06, w * 0.55);
  return b.g;
}

function buildVanity(it: Item) {
  const g = buildBaseCabinet({ ...it, countertop: true }, 'sink');
  return g;
}

function buildTub(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const por = mat(it.color, { rough: 0.15 });
  const t = 0.07;
  b.box(w, h, t, por, 0, 0, -d / 2 + t / 2);
  b.box(w, h, t, por, 0, 0, d / 2 - t / 2);
  b.box(t, h, d, por, -w / 2 + t / 2);
  b.box(t, h, d, por, w / 2 - t / 2);
  b.box(w, 0.08, d, por);
  b.box(w - t * 2, 0.002, d - t * 2, mat('#bfe1ef', { rough: 0.05, opacity: 0.6 }), 0, h * 0.6, 0);
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
      b.cyl(w / 2, 0.2, body, 0, 0, 0, d / 2).scale.x *= 1;
      b.sphere(w * 0.2, glow, 0, 0.02, 0);
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
  b.cyl(0.012, it.width + 0.1, mat('#444444', { metal: 0.7 }), 0, it.height - 0.04, 0).rotation.z = Math.PI / 2;
  const folds = 6;
  for (const side of [-1, 1]) {
    for (let i = 0; i < folds; i++) {
      const x = side * (it.width / 2 - 0.05 - i * 0.05);
      b.cyl(0.035, it.height - 0.06, fab, x, 0, (i % 2) * 0.02);
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
      if (it.kind === 'sectional') return buildSectional(it);
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

function buildSectional(it: Item) {
  const g = new THREE.Group();
  const r = it.legRatio ?? 0.36;
  const seatD = it.depth * r;
  const main = buildSofa({ ...it, depth: seatD, kind: 'sofa' });
  main.position.z = -it.depth / 2 + seatD / 2;
  g.add(main);
  const chaiseW = it.width * 0.33;
  const b = new B();
  const fab = mat(it.color, { rough: 0.95 });
  const remaining = it.depth - seatD;
  b.box(chaiseW, it.height * 0.38, remaining, fab, -it.width / 2 + chaiseW / 2, 0.08, it.depth / 2 - remaining / 2);
  b.box(0.18, it.height * 0.62, remaining, fab, -it.width / 2 + 0.09, 0.08, it.depth / 2 - remaining / 2);
  g.add(b.g);
  return g;
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
        g = buildBaseCabinet(it, 'mixed');
        break;
      case 'drawer-base':
        g = buildBaseCabinet(it, 'drawers');
        break;
      case 'sink-base':
        g = buildBaseCabinet(it, 'sink');
        break;
      case 'corner-base':
        g = buildCornerBase(it);
        break;
      case 'wall-cabinet':
        g = buildWallCabinet(it);
        break;
      case 'tall-pantry':
        g = buildTall(it);
        break;
      case 'island':
        g = buildIsland(it);
        break;
      case 'refrigerator':
        g = buildFridge(it);
        break;
      case 'range':
        g = buildRange(it);
        break;
      case 'cooktop':
        g = buildCooktop(it);
        break;
      case 'wall-oven':
        g = buildWallOven(it);
        break;
      case 'dishwasher':
        g = buildDishwasher(it);
        break;
      case 'microwave':
        g = buildMicrowave(it);
        break;
      case 'range-hood':
        g = buildHood(it);
        break;
      case 'washer':
        g = buildWasher(it, false);
        break;
      case 'dryer':
        g = buildWasher(it, true);
        break;
      case 'sofa':
      case 'loveseat':
        g = buildSofa(it);
        break;
      case 'armchair':
        g = buildArmchair(it);
        break;
      case 'coffee-table':
      case 'side-table':
      case 'dining-table':
        g = buildTable(it, false);
        break;
      case 'round-table':
        g = buildTable(it, true);
        break;
      case 'dining-chair':
        g = buildChair(it);
        break;
      case 'bar-stool':
        g = buildChair(it, true);
        break;
      case 'bed':
      case 'bed-king':
      case 'bed-twin':
        g = buildBed(it);
        break;
      case 'nightstand':
        g = buildCase(it, 2);
        break;
      case 'dresser':
        g = buildCase(it, 4);
        break;
      case 'wardrobe':
        g = buildCase(it, 1, true);
        break;
      case 'tv-stand':
        g = buildCase(it, 1, true);
        break;
      case 'desk':
        g = buildDesk(it);
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
        g = buildToilet(it);
        break;
      case 'vanity':
        g = buildVanity(it);
        break;
      case 'bathtub':
        g = buildTub(it);
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
