// Style-aware procedural models: cabinet doors & hardware, appliance types, furniture shapes, people.
// Every builder returns a group with its origin at the bottom-centre of the item's box
// (width along X, depth along Z with the front at +Z, height along Y) and stays inside that box
// (hardware may stand a few cm proud of the front, as in reality).
import * as THREE from 'three';
import { getStyle } from '../itemStyles';
import type { Item } from '../model';
import { B, legs, mat, pyramidGeo, taperGeo, unitMesh } from './parts';

const IN = 0.0254;
const dark = () => mat('#1d1d1d', { rough: 0.5 });
const glassM = () => mat('#cfe3ea', { rough: 0.05, metal: 0.2, opacity: 0.35 });
const chrome = () => mat('#d8dadd', { metal: 1, rough: 0.2 });

// ---------------------------------------------------------------------------
// Doors, drawer fronts and hardware

type Pull = string;
type Door = string;

/** Hardware centred at (cx, cy) on a front whose face is at z. */
function pull(b: B, kind: Pull, cx: number, cy: number, z: number, vertical: boolean, m: THREE.Material, span = 0.14) {
  switch (kind) {
    case 'knob':
      b.sphere(0.016, m, cx, cy, z + 0.022);
      b.cyl(0.006, 0.012, m, cx, cy - 0.006, z + 0.008).rotation.x = Math.PI / 2;
      break;
    case 'cup':
      // bin pull: a shallow half-round shell, always horizontal
      b.box(0.08, 0.025, 0.018, m, cx, cy - 0.0125, z + 0.009);
      b.box(0.08, 0.004, 0.022, mat('#000000', { opacity: 0.4 }), cx, cy - 0.016, z + 0.011);
      break;
    case 'edge':
      // tab pull on the top edge of the front
      b.box(vertical ? 0.012 : 0.06, vertical ? 0.06 : 0.012, 0.02, m, cx, cy - (vertical ? 0.03 : 0.006), z + 0.006);
      break;
    case 'none':
      break;
    case 'bar':
    default:
      if (vertical) {
        b.box(0.012, span, 0.012, m, cx, cy - span / 2, z + 0.026);
        for (const dy of [-span / 2 + 0.015, span / 2 - 0.015]) b.box(0.008, 0.008, 0.026, m, cx, cy + dy - 0.004, z + 0.013);
      } else {
        b.box(span, 0.012, 0.012, m, cx, cy - 0.006, z + 0.026);
        for (const dx of [-span / 2 + 0.015, span / 2 - 0.015]) b.box(0.008, 0.008, 0.026, m, cx + dx, cy - 0.004, z + 0.013);
      }
  }
}

/** One door or drawer front of the given style; (cx, y) is its bottom-centre, z the cabinet face. */
function front(b: B, style: Door, cx: number, y: number, w: number, h: number, z: number, body: THREE.Material) {
  const t = 0.018;
  const rail = Math.min(0.06, w * 0.18, h * 0.18);
  const frame = () => {
    b.box(w, rail, t, body, cx, y, z + t / 2); // bottom rail
    b.box(w, rail, t, body, cx, y + h - rail, z + t / 2); // top rail
    b.box(rail, h - 2 * rail, t, body, cx - w / 2 + rail / 2, y + rail, z + t / 2); // stiles
    b.box(rail, h - 2 * rail, t, body, cx + w / 2 - rail / 2, y + rail, z + t / 2);
  };
  switch (style) {
    case 'slab':
      b.box(w, h, t, body, cx, y, z + t / 2);
      break;
    case 'raised': {
      frame();
      b.box(w - 2 * rail, h - 2 * rail, t * 0.6, body, cx, y + rail, z + t * 0.3);
      // raised field with a bevel suggested by a slightly darker margin
      b.box(w - 2 * rail - 0.03, h - 2 * rail - 0.03, t * 0.5, body, cx, y + rail + 0.015, z + t * 0.85);
      b.box(w - 2 * rail - 0.006, h - 2 * rail - 0.006, 0.002, mat('#000000', { opacity: 0.12 }), cx, y + rail + 0.003, z + t * 0.62);
      break;
    }
    case 'beadboard': {
      frame();
      b.box(w - 2 * rail, h - 2 * rail, t * 0.5, body, cx, y + rail, z + t * 0.25);
      const groove = mat('#000000', { opacity: 0.18 });
      for (let x = -w / 2 + rail + 0.035; x < w / 2 - rail - 0.01; x += 0.035) b.box(0.003, h - 2 * rail, 0.002, groove, cx + x, y + rail, z + t * 0.5 + 0.001);
      break;
    }
    case 'glass': {
      frame();
      b.box(w - 2 * rail, h - 2 * rail, 0.004, glassM(), cx, y + rail, z + t * 0.5);
      // a shelf seen through the glass
      if (h > 0.35) b.box(w - 2 * rail - 0.01, 0.015, 0.01, mat('#bfb7aa'), cx, y + h / 2, z - 0.01);
      break;
    }
    case 'shaker':
    default:
      frame();
      b.box(w - 2 * rail, h - 2 * rail, t * 0.4, body, cx, y + rail, z + t * 0.2); // recessed centre panel
  }
}

/**
 * A cabinet face: doors and/or drawers with hardware.
 * layout: 'doors' | 'drawers' | 'mixed' (drawer over doors) | 'sink' (false drawer front over doors)
 */
function cabinetFace(b: B, it: Item, w: number, h: number, faceZ: number, y: number, layout: 'doors' | 'drawers' | 'mixed' | 'sink', opts: { door?: Door; pull?: Pull } = {}) {
  const st = getStyle(it);
  const door = (opts.door ?? (st.door as string)) || 'shaker';
  const pk = (opts.pull ?? (st.pull as string)) || 'bar';
  const body = mat(it.color, { rough: 0.55 });
  const hw = mat(it.accent, { metal: 0.8, rough: 0.3 });
  const gap = 0.006;
  // dark reveal behind the fronts: the gaps between doors/drawers read as shadow lines (slab doors need it)
  b.box(w, h, 0.002, mat('#2a2622', { rough: 0.9 }), 0, y, faceZ - 0.001);
  const drawerStyle = door === 'glass' || door === 'beadboard' || door === 'raised' ? 'shaker' : door;
  if (layout === 'drawers') {
    const n = h > 0.6 ? 3 : 2;
    const ph = (h - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const py = y + gap + i * (ph + gap);
      front(b, drawerStyle, 0, py, w - 2 * gap, ph, faceZ, body);
      pull(b, pk, 0, pk === 'edge' ? py + ph : py + ph * 0.7, faceZ + 0.018, false, hw, Math.min(0.2, w * 0.4));
    }
    return;
  }
  let doorH = h;
  if (layout === 'mixed' || layout === 'sink') {
    const dh = Math.min(0.15, h * 0.25);
    front(b, layout === 'sink' ? 'slab' : drawerStyle, 0, y + h - dh, w - 2 * gap, dh - gap, faceZ, body);
    if (layout === 'mixed') pull(b, pk, 0, pk === 'edge' ? y + h - gap : y + h - dh / 2, faceZ + 0.018, false, hw, Math.min(0.2, w * 0.4));
    doorH = h - dh - gap;
  }
  const doors = w > 0.55 ? 2 : 1;
  const dw = (w - gap * (doors + 1)) / doors;
  for (let i = 0; i < doors; i++) {
    const cx = -w / 2 + gap + dw / 2 + i * (dw + gap);
    front(b, door, cx, y + gap, dw, doorH - gap * 2, faceZ, body);
    // handle on the opening edge, near the top for base doors / bottom for wall cabinets (caller decides via y)
    const hx = doors === 2 ? (i === 0 ? cx + dw / 2 - 0.04 : cx - dw / 2 + 0.04) : cx + dw / 2 - 0.04;
    const hy = y > 1 ? y + 0.12 : y + doorH - 0.06;
    if (pk === 'cup') pull(b, 'knob', hx, hy, faceZ + 0.018, true, hw);
    else if (pk === 'edge') pull(b, pk, hx + (i === 0 && doors === 2 ? 0.035 : doors === 2 ? -0.035 : 0.035), hy, faceZ + 0.018, true, hw);
    else pull(b, pk, hx, hy, faceZ + 0.018, true, hw, 0.12);
  }
}

/** Plinth or furniture legs under a base unit; returns the height where the box starts. */
function cabinetBase(b: B, it: Item, w: number, d: number): number {
  const st = getStyle(it);
  const toe = 0.1;
  if (st.base === 'legs') {
    const legM = mat(it.color, { rough: 0.55 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.05, toe, 0.05, legM, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.06) - 0.01);
  } else b.box(w - 0.02, toe, d - 0.08, dark(), 0, 0, -0.04);
  return toe;
}

function countertop(b: B, it: Item, w: number, d: number, h: number, ct = 0.03) {
  b.box(w, ct, d + 0.02, mat(it.countertopColor ?? '#e9e6e1', { rough: 0.25 }), 0, h - ct, 0.01);
}

// ---------------------------------------------------------------------------
// Cabinets

export function baseCabinet(it: Item, layout: 'mixed' | 'drawers' | 'sink') {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const ct = it.countertop ? 0.03 : 0;
  const toe = cabinetBase(b, it, w, d);
  const body = mat(it.color, { rough: 0.55 });
  const boxH = h - toe - ct;
  b.box(w, boxH, d - 0.02, body, 0, toe, -0.01);
  const farmhouse = layout === 'sink' && st.sink === 'farmhouse';
  if (farmhouse) {
    // apron-front sink replaces the false drawer front
    const apronH = Math.min(0.25, boxH * 0.35);
    cabinetFace(b, it, w, boxH - apronH, d / 2 - 0.01, toe, 'doors');
    b.box(Math.min(w - 0.06, 0.84), apronH, 0.03, mat('#f4f4f2', { rough: 0.15 }), 0, toe + boxH - apronH, d / 2 - 0.005);
  } else cabinetFace(b, it, w, boxH, d / 2 - 0.01, toe, layout);
  if (it.countertop) {
    countertop(b, it, w, d, h, ct);
    if (layout === 'sink') sink(b, w, d, h, (st.sink as string) ?? 'undermount');
  }
  return b.g;
}

function sink(b: B, w: number, d: number, h: number, type: string) {
  const steel = mat('#9ea4aa', { metal: 0.9, rough: 0.25 });
  const basinDark = mat('#55595e', { metal: 0.9, rough: 0.3 });
  const bowls = type === 'double' ? 2 : 1;
  const total = Math.min(w - 0.15, 0.84);
  const bw = total / bowls - (bowls > 1 ? 0.02 : 0);
  for (let i = 0; i < bowls; i++) {
    const cx = -total / 2 + (total / bowls) * (i + 0.5);
    if (type === 'vessel') {
      const bowl = b.sphere(Math.min(0.2, bw / 2), mat('#ffffff', { rough: 0.15 }), cx, h + 0.06, 0.02, 0.07);
      bowl.scale.y = 0.13;
    } else {
      b.box(bw, 0.02, d * 0.6, type === 'farmhouse' ? mat('#f4f4f2', { rough: 0.15 }) : steel, cx, h - 0.015, 0.02);
      b.box(bw - 0.04, 0.005, d * 0.55, basinDark, cx, h + 0.006, 0.02);
    }
  }
  const fm = chrome();
  const fh = type === 'vessel' ? 0.32 : 0.3;
  const fz = -d / 2 + 0.05; // faucet at the back of the counter
  const spout = Math.min(0.2, d * 0.35);
  b.cyl(0.015, fh, fm, 0, h, fz);
  b.box(0.03, 0.03, spout, fm, 0, h + fh - 0.03, fz + spout / 2);
}

export function cornerBase(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const leg = Math.min(0.61, w, d);
  const ct = it.countertop ? 0.03 : 0;
  const toe = 0.1;
  b.box(w - 0.02, toe, leg - 0.08, dark(), 0, 0, -d / 2 + leg / 2 - 0.04);
  b.box(leg - 0.08, toe, d - 0.02, dark(), -w / 2 + leg / 2 - 0.04, 0, 0);
  b.box(w, h - ct - toe, leg, body, 0, toe, -d / 2 + leg / 2);
  b.box(leg, h - ct - toe, d, body, -w / 2 + leg / 2, toe, 0);
  // the door that faces the room sits on the inside corner
  const doorW = Math.min(0.38, w - leg - 0.02);
  const sub = new B();
  cabinetFace(sub, it, doorW, h - ct - toe, 0, toe, 'doors');
  sub.g.position.set(-w / 2 + leg + doorW / 2 + 0.01, 0, -d / 2 + leg);
  b.g.add(sub.g);
  if (it.countertop) {
    const ctm = mat(it.countertopColor ?? '#e9e6e1', { rough: 0.25 });
    b.box(w, ct, leg + 0.02, ctm, 0, h - ct, -d / 2 + leg / 2 + 0.01);
    b.box(leg + 0.02, ct, d, ctm, -w / 2 + leg / 2 + 0.01, h - ct, 0);
  }
  return b.g;
}

export function wallCabinet(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, h, d - 0.02, mat(it.color, { rough: 0.55 }), 0, 0, -0.01);
  cabinetFace(b, it, w, h, d / 2 - 0.01, 0, 'doors');
  return b.g;
}

export function tallCabinet(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  b.box(w, h, d - 0.02, mat(it.color, { rough: 0.55 }), 0, 0, -0.01);
  cabinetFace(b, it, w, h * 0.62, d / 2 - 0.01, 0, 'doors');
  cabinetFace(b, it, w, h * 0.38 - 0.004, d / 2 - 0.01, h * 0.62 + 0.004, 'doors');
  return b.g;
}

export function island(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const body = mat(it.color, { rough: 0.55 });
  const over = Math.min(0.25, d * 0.35); // seating overhang on the back
  const bodyD = Math.max(0.3, d - over);
  const sub = new B();
  const toe = cabinetBase(sub, it, w, bodyD);
  sub.g.position.z = over / 2;
  b.g.add(sub.g);
  b.box(w, h - toe - 0.04, bodyD, body, 0, toe, over / 2);
  cabinetFace(b, it, w, h - toe - 0.04, d / 2 - 0.01 - (d - over - bodyD), toe, 'mixed');
  b.box(w, 0.04, d, mat(it.countertopColor ?? '#f1efea', { rough: 0.2 }), 0, h - 0.04, 0);
  return b.g;
}

export function vanity(it: Item) {
  return baseCabinet({ ...it, countertop: true }, 'sink');
}

// ---------------------------------------------------------------------------
// Appliances

const steelOf = (it: Item) => mat(it.color, { metal: 0.6, rough: 0.35 });

export function fridge(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const type = getStyle(it).type as string;
  const panel = type === 'panel';
  const shell = panel ? mat(it.color, { rough: 0.55 }) : steelOf(it);
  const handle = panel ? mat(it.accent, { metal: 0.8, rough: 0.3 }) : chrome();
  b.box(w, h, d - 0.04, shell, 0, 0, -0.02);
  const z = d / 2 - 0.02;
  const doorBox = (x: number, y: number, dw: number, dh: number) => {
    if (panel) front(b, 'shaker', x, y, dw, dh, z, shell);
    else b.box(dw, dh, 0.04, shell, x, y, z);
  };
  const vBar = (x: number, y: number, len: number) => b.box(0.02, len, 0.03, handle, x, y, z + 0.04);
  const hBar = (y: number, len: number) => b.box(len, 0.02, 0.03, handle, 0, y, z + 0.04);
  const g = 0.006;
  switch (type) {
    case 'side': {
      const fw = w * 0.42;
      doorBox(-w / 2 + fw / 2, 0.02, fw - g, h - 0.04);
      doorBox(fw / 2, 0.02, w - fw - g, h - 0.04);
      vBar(-w / 2 + fw - 0.04, h * 0.3, h * 0.45);
      vBar(-w / 2 + fw + 0.04, h * 0.3, h * 0.45);
      b.box(0.12, 0.2, 0.005, dark(), -w / 2 + fw / 2, h * 0.55, z + 0.022); // dispenser
      break;
    }
    case 'top': {
      const split = h * 0.68;
      doorBox(0, split + g, w - 0.01, h - split - 0.02);
      doorBox(0, 0.02, w - 0.01, split - 0.02);
      vBar(w / 2 - 0.06, split + 0.08, 0.25);
      vBar(w / 2 - 0.06, split - 0.45, 0.35);
      break;
    }
    case 'bottom': {
      const split = h * 0.35;
      doorBox(0, split + g, w - 0.01, h - split - 0.02);
      doorBox(0, 0.02, w - 0.01, split - 0.02);
      vBar(w / 2 - 0.06, split + 0.25, 0.6);
      hBar(split - 0.1, w * 0.6);
      break;
    }
    case 'panel':
    case 'french':
    default: {
      const split = h * 0.38;
      doorBox(-w / 4, split + g, w / 2 - g, h - split - 0.02);
      doorBox(w / 4, split + g, w / 2 - g, h - split - 0.02);
      doorBox(0, 0.02, w - 0.01, split - 0.03);
      vBar(-0.03, split + 0.25, 0.6);
      vBar(0.03, split + 0.25, 0.6);
      hBar(split - 0.1, w * 0.6);
      if (!panel) b.box(0.12, 0.2, 0.005, dark(), -w / 4, split + 0.55, z + 0.022);
    }
  }
  return b.g;
}

function burners(b: B, w: number, d: number, y: number, type: string, zOff = 0) {
  if (type === 'electric' || type === 'induction') {
    b.box(w - 0.02, 0.008, d - 0.04, mat('#0d0d0f', { rough: 0.08, metal: 0.3 }), 0, y, zOff);
    const ring = mat(type === 'induction' ? '#3a3a40' : '#5a2b22', { rough: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(type === 'induction' ? 0.085 : 0.075, 0.002, ring, (sx * w) / 4, y + 0.008, zOff + (sz * d) / 4.5);
    return;
  }
  const grate = mat('#111111', { rough: 0.6 });
  const pro = type === 'pro';
  const cols = pro && w > 0.85 ? 3 : 2;
  b.box(w - 0.02, 0.01, d - 0.04, mat('#222222', { rough: 0.6 }), 0, y, zOff);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < 2; j++) {
      const bx = -w / 2 + (w / cols) * (i + 0.5);
      const bz = zOff + (j === 0 ? -1 : 1) * d * 0.2;
      if (pro && cols === 3 && i === 2 && j === 1) {
        b.box(w / cols - 0.04, 0.012, d * 0.36, mat('#3a3a3a', { metal: 0.6, rough: 0.4 }), bx, y + 0.01, bz); // griddle
        continue;
      }
      b.cyl(pro ? 0.07 : 0.06, 0.015, grate, bx, y + 0.01, bz);
      b.box(w / cols - 0.03, 0.012, 0.012, grate, bx, y + 0.02, bz);
      b.box(0.012, 0.012, d * 0.3, grate, bx, y + 0.02, bz);
    }
}

export function range(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const type = getStyle(it).type as string;
  const steel = steelOf(it);
  const pro = type === 'pro';
  b.box(w, h - 0.03, d, steel, 0, 0, 0);
  burners(b, w, d - 0.06, h - 0.03, type, 0.02);
  if (type !== 'induction') b.box(w, pro ? 0.18 : 0.1, 0.05, steel, 0, h - 0.03, -d / 2 + 0.025); // back guard
  // oven door
  const doorTop = h * (pro ? 0.62 : 0.6);
  b.box(w - 0.04, doorTop - 0.1, 0.03, steel, 0, 0.1, d / 2 - 0.015);
  b.box(w - 0.16, (doorTop - 0.1) * 0.55, 0.005, mat('#141414', { rough: 0.1 }), 0, 0.2, d / 2 + 0.002);
  b.box(w - 0.12, 0.025, 0.025, chrome(), 0, doorTop - 0.04, d / 2 + 0.015);
  // knobs on the front panel (touch controls for induction)
  const knobs = type === 'induction' ? 0 : pro ? 6 : 4;
  const knobM = mat(pro ? '#b01e1e' : '#1d1d1d', { rough: 0.4 });
  for (let i = 0; i < knobs; i++) {
    const k = b.cyl(pro ? 0.022 : 0.018, 0.025, knobM, -w / 2 + 0.06 + i * ((w - 0.12) / Math.max(1, knobs - 1)), h - 0.12, d / 2 - 0.005);
    k.rotation.x = Math.PI / 2;
  }
  if (knobs === 0) b.box(w * 0.4, 0.03, 0.004, mat('#0d0d0f', { rough: 0.1 }), 0, h - 0.12, d / 2 + 0.001);
  return b.g;
}

export function cooktop(it: Item) {
  const b = new B();
  burners(b, it.width, it.depth, 0, getStyle(it).type as string);
  return b.g;
}

export function hood(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const type = getStyle(it).type as string;
  const steel = mat(it.color, { metal: 0.7, rough: 0.3 });
  switch (type) {
    case 'insert':
      b.box(w, Math.min(0.12, h), d, steel, 0, 0, 0);
      b.box(w * 0.9, 0.005, d * 0.8, dark(), 0, -0.001, 0.01);
      break;
    case 'canopy':
      unitMesh(b, pyramidGeo, w, Math.min(h * 0.45, 0.35), d, steel, 0, 0.06, 0);
      b.box(w, 0.06, d, steel, 0, 0, 0);
      b.box(w * 0.28, h - Math.min(h * 0.45, 0.35) - 0.06, d * 0.4, steel, 0, Math.min(h * 0.45, 0.35) + 0.06, -d * 0.3);
      break;
    case 'wood': {
      const wood = mat(it.accent && it.accent !== '#666666' ? it.accent : '#efece6', { rough: 0.6 });
      b.box(w, 0.08, d, wood, 0, 0, 0); // mantel shelf
      unitMesh(b, pyramidGeo, w * 0.96, h * 0.55, d * 0.9, wood, 0, 0.08, -d * 0.05);
      b.box(w * 0.55, h - h * 0.55 - 0.08, d * 0.6, wood, 0, h * 0.55 + 0.08, -d * 0.2);
      break;
    }
    case 'chimney':
    default:
      b.box(w, 0.1, d, steel, 0, 0, 0);
      b.box(w * 0.75, 0.12, d * 0.75, steel, 0, 0.1, -d * 0.12);
      b.box(w * 0.3, h - 0.22, d * 0.4, steel, 0, 0.22, -d * 0.3);
  }
  return b.g;
}

export function dishwasher(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const ct = it.countertop ? 0.03 : 0;
  const panel = getStyle(it).front === 'panel';
  const shell = panel ? mat(it.color, { rough: 0.55 }) : steelOf(it);
  b.box(w, 0.1, d - 0.08, dark(), 0, 0, -0.04);
  b.box(w, h - 0.1 - ct, d - 0.02, shell, 0, 0.1, -0.01);
  if (panel) {
    // matches the neighbouring cabinets: a door-style panel with the cabinet hardware
    front(b, 'shaker', 0, 0.1, w - 0.008, h - 0.1 - ct - 0.006, d / 2 - 0.01, shell);
    pull(b, 'bar', 0, h - ct - 0.06, d / 2 + 0.008, false, mat(it.accent, { metal: 0.8, rough: 0.3 }), Math.min(0.3, w * 0.5));
  } else {
    b.box(w - 0.1, 0.02, 0.03, chrome(), 0, h - ct - 0.08, d / 2 + 0.01);
    b.box(w - 0.04, 0.06, 0.005, mat('#333333'), 0, h - ct - 0.06, d / 2 - 0.005);
  }
  if (it.countertop) countertop(b, it, w, d, h, ct);
  return b.g;
}

export function wallOven(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const body = mat(it.color, { rough: 0.55 });
  const steel = mat(it.accent, { metal: 0.6, rough: 0.3 });
  b.box(w, h, d - 0.02, body, 0, 0, -0.01);
  const unit = (y: number, uh: number, kind: 'oven' | 'micro') => {
    b.box(w - 0.06, uh, 0.03, steel, 0, y, d / 2 - 0.01);
    b.box(kind === 'micro' ? w * 0.6 : w - 0.2, uh * 0.6, 0.005, mat('#141414', { rough: 0.1 }), kind === 'micro' ? -w * 0.1 : 0, y + uh * 0.15, d / 2 + 0.006);
    if (kind === 'oven') b.box(w - 0.15, 0.025, 0.03, chrome(), 0, y + uh - 0.06, d / 2 + 0.02);
  };
  const lower = 0.42;
  if (st.config === 'single') {
    unit(lower + 0.2, 0.62, 'oven');
    cabinetFace(b, it, w, h - (lower + 0.86), d / 2 - 0.01, lower + 0.86, 'doors', { door: 'shaker', pull: st.pull as string });
  } else {
    unit(lower + 0.05, 0.62, 'oven');
    unit(lower + 0.72, st.config === 'combo' ? 0.42 : 0.62, st.config === 'combo' ? 'micro' : 'oven');
  }
  cabinetFace(b, it, w, lower, d / 2 - 0.01, 0, 'drawers', { door: 'shaker', pull: st.pull as string });
  return b.g;
}

// ---------------------------------------------------------------------------
// Upholstery

function furnitureLegs(b: B, kind: string, w: number, d: number, h: number, m: THREE.Material, inset = 0.04) {
  if (h <= 0.001) return;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset);
      const z = sz * (d / 2 - inset);
      if (kind === 'block') b.box(0.06, h, 0.06, m, x, 0, z);
      else if (kind === 'metal') b.cyl(0.008, h, mat('#2b2b2b', { metal: 0.8, rough: 0.3 }), x, 0, z);
      else unitMesh(b, taperGeo, 0.04, h, 0.04, m, x, 0, z).rotation.x = Math.PI; // tapered: thick end up
    }
}

/** Sofa / loveseat / armchair with the chosen arms, back, seat height, cushions and legs. */
export function sofa(it: Item, opts: { noRightArm?: boolean; noLeftArm?: boolean } = {}) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const fab = mat(it.color, { rough: 0.95 });
  const wood = mat(it.accent, { rough: 0.6 });
  const legKind = st.legs as string;
  const legH = legKind === 'skirt' ? 0 : 0.1;
  const seatH = Math.min(h - 0.1, Math.max(0.3, (st.seatHeight as number) * IN));
  const arms = st.arms as string;
  const armW = arms === 'none' ? 0 : Math.min(w * 0.2, (st.armWidth as number) * IN);
  const backD = Math.min(0.25, d * 0.25);
  furnitureLegs(b, legKind, w, d, legH, wood);
  const baseTop = seatH - 0.12;
  b.box(w, baseTop - legH, d, fab, 0, legH, 0); // base / skirt
  // back
  if (st.back === 'tight' || st.back === 'channel') {
    b.box(w - 2 * armW, h - baseTop, backD, fab, 0, baseTop, -d / 2 + backD / 2);
    if (st.back === 'channel') {
      const groove = mat('#000000', { opacity: 0.2 });
      for (let x = -w / 2 + armW + 0.12; x < w / 2 - armW - 0.05; x += 0.12) b.box(0.006, h - baseTop - 0.04, 0.004, groove, x, baseTop + 0.02, -d / 2 + backD + 0.002);
    }
  } else {
    b.box(w - 2 * armW, Math.max(0.05, (h - baseTop) * 0.45), backD * 0.7, fab, 0, baseTop, -d / 2 + backD * 0.35);
  }
  // arms
  const armH = Math.min(h, seatH + 0.22) - legH;
  const arm = (x: number) => {
    if (armW <= 0) return;
    if (arms === 'slope') {
      const m = b.box(armW, armH, d, fab, x, legH, 0);
      m.scale.y = armH * 0.85;
      m.position.y = legH + (armH * 0.85) / 2;
    } else b.box(armW, armH, d, fab, x, legH, 0);
    if (arms === 'rolled') {
      const roll = b.cyl(armW / 2, d, fab, x, 0, 0);
      roll.rotation.x = Math.PI / 2;
      roll.position.y = Math.min(h - armW / 2, legH + armH);
    }
  };
  if (!opts.noLeftArm) arm(-w / 2 + armW / 2);
  if (!opts.noRightArm) arm(w / 2 - armW / 2);
  // seat cushions
  const inner = w - 2 * armW;
  const n = (st.cushions as number) > 0 ? (st.cushions as number) : Math.max(1, Math.round(inner / 0.6));
  const cw = inner / n;
  const seatD = d - backD;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + armW + cw * (i + 0.5);
    b.box(cw - 0.012, 0.12, seatD - 0.02, fab, cx, baseTop, -d / 2 + backD + seatD / 2);
    if (st.back === 'cushion') b.box(cw - 0.03, Math.max(0.05, (h - baseTop) * 0.55), 0.14, fab, cx, baseTop + 0.12, -d / 2 + backD + 0.07);
  }
  return b.g;
}

export function sectional(it: Item) {
  const g = new THREE.Group();
  const r = it.legRatio ?? 0.36;
  const seatD = it.depth * r;
  const main = sofa({ ...it, depth: seatD });
  main.position.z = -it.depth / 2 + seatD / 2;
  g.add(main);
  const st = getStyle(it);
  const chaiseW = it.width * 0.33;
  const remaining = it.depth - seatD;
  const b = new B();
  const fab = mat(it.color, { rough: 0.95 });
  const seatH = Math.min(it.height - 0.1, (st.seatHeight as number) * IN);
  const x = -it.width / 2 + chaiseW / 2;
  b.box(chaiseW, seatH, remaining, fab, x, 0, it.depth / 2 - remaining / 2);
  if (st.arms !== 'none') b.box(Math.max(0.06, (st.armWidth as number) * IN), Math.min(it.height, seatH + 0.22), remaining, fab, -it.width / 2 + ((st.armWidth as number) * IN) / 2, 0, it.depth / 2 - remaining / 2);
  g.add(b.g);
  // chaise on the right: mirror the whole piece
  if (st.chaise === 'right') g.scale.x = -1;
  return g;
}

// ---------------------------------------------------------------------------
// Beds

export function bed(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const frameM = mat(it.accent, { rough: 0.6 });
  const linen = mat(it.color, { rough: 0.95 });
  const frame = st.frame as string;
  const gapUnder = frame === 'legs' ? 0.15 : 0.05;
  const railH = frame === 'platform' ? 0.3 : 0.2;
  if (frame === 'legs') legs(b, w, d, gapUnder, 0.06, frameM, 0.02);
  else b.box(w - 0.04, gapUnder, d - 0.04, frameM, 0, 0, 0);
  b.box(w, railH, d, frameM, 0, gapUnder, 0);
  if (frame === 'storage') for (const sx of [-1, 1]) for (const k of [0, 1]) b.box(0.01, railH * 0.7, d * 0.38, mat(it.accent, { rough: 0.45 }), (sx * w) / 2 + sx * 0.003, gapUnder + railH * 0.15, -d * 0.2 + k * d * 0.42);
  const mattressTop = gapUnder + railH + 0.25;
  b.box(w - 0.04, 0.25, d - 0.1, linen, 0, gapUnder + railH, 0.03);
  // headboard
  const hb = st.headboard as string;
  const hbH = Math.min(h, (st.headboardHeight as number) * IN);
  if (hb !== 'none') {
    const hz = -d / 2 + 0.04;
    switch (hb) {
      case 'upholstered':
      case 'tufted': {
        const pad = mat(it.accent === '#8b5e3c' ? '#cfc6b8' : it.accent, { rough: 0.95 });
        b.box(w, hbH, 0.08, pad, 0, 0, hz);
        if (hb === 'tufted') {
          const btn = mat('#000000', { opacity: 0.35 });
          for (let y = mattressTop + 0.12; y < hbH - 0.05; y += 0.12) for (let x = -w / 2 + 0.1; x < w / 2 - 0.1; x += 0.14) b.sphere(0.008, btn, x + (Math.round(y * 10) % 2 ? 0.07 : 0), y, hz + 0.042);
        }
        break;
      }
      case 'slat': {
        b.box(w, 0.06, 0.06, frameM, 0, hbH - 0.06, hz);
        for (const sx of [-1, 1]) b.box(0.06, hbH, 0.06, frameM, sx * (w / 2 - 0.03), 0, hz);
        for (let x = -w / 2 + 0.12; x < w / 2 - 0.08; x += 0.1) b.box(0.04, hbH - mattressTop, 0.03, frameM, x, mattressTop, hz);
        break;
      }
      case 'wingback': {
        const pad = mat(it.accent === '#8b5e3c' ? '#cfc6b8' : it.accent, { rough: 0.95 });
        b.box(w, hbH, 0.08, pad, 0, 0, hz);
        const wingD = Math.min(0.3, d * 0.15);
        for (const sx of [-1, 1]) b.box(0.08, hbH, wingD, pad, sx * (w / 2 - 0.04), 0, -d / 2 + wingD / 2);
        break;
      }
      case 'panel':
      default:
        b.box(w, hbH, 0.06, frameM, 0, 0, hz);
        b.box(w - 0.16, hbH - mattressTop - 0.1, 0.01, mat('#000000', { opacity: 0.08 }), 0, mattressTop + 0.05, hz + 0.031);
    }
  }
  if (st.footboard !== 'none') b.box(w, st.footboard === 'panel' ? Math.min(h, 0.65) : Math.min(h, 0.45), 0.05, frameM, 0, 0, d / 2 - 0.025);
  const pillows = w > 1.2 ? 2 : 1;
  const pw = (w - 0.15) / pillows;
  for (let i = 0; i < pillows; i++) b.box(pw - 0.05, 0.12, 0.35, mat('#ffffff', { rough: 0.95 }), -w / 2 + 0.075 + pw * (i + 0.5), mattressTop, -d / 2 + 0.3);
  b.box(w - 0.02, 0.04, d * 0.6, mat('#c9b9a3', { rough: 0.95 }), 0, mattressTop, d * 0.18);
  return b.g;
}

// ---------------------------------------------------------------------------
// Tables, chairs, case goods

export function table(it: Item, defaults: { top?: string; base?: string } = {}) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const wood = mat(it.color, { rough: 0.5 });
  const top = (st.top as string) ?? defaults.top ?? 'rect';
  const base = (st.base as string) ?? defaults.base ?? 'legs';
  const t = Math.min(h * 0.3, ((st.topThickness as number) ?? 1.5) * IN);
  switch (top) {
    case 'round': {
      const r = Math.min(w, d) / 2; // a true circle, even on a rectangular footprint
      b.cyl(r, t, wood, 0, h - t, 0, r);
      break;
    }
    case 'oval':
      b.cyl(w / 2, t, wood, 0, h - t, 0, d / 2);
      break;
    case 'racetrack': {
      const r = d / 2;
      b.box(Math.max(0.01, w - 2 * r), t, d, wood, 0, h - t, 0);
      for (const sx of [-1, 1]) b.cyl(r, t, wood, sx * (w / 2 - r), h - t, 0);
      break;
    }
    case 'rect':
    default:
      b.box(w, t, d, wood, 0, h - t, 0);
  }
  const lh = h - t;
  const round = top !== 'rect';
  switch (base) {
    case 'pedestal':
      b.cyl(Math.min(w, d) * 0.08, lh, wood, 0, 0, 0);
      b.cyl(Math.min(w, d) * 0.3, 0.04, wood, 0, 0, 0, Math.min(w, d) * 0.3);
      if (w > d * 1.6) for (const sx of [-1, 1]) b.cyl(Math.min(w, d) * 0.07, lh, wood, sx * w * 0.25, 0, 0); // long tables: two pedestals
      break;
    case 'tulip':
      unitMesh(b, taperGeo, Math.min(w, d) * 0.5, lh, Math.min(w, d) * 0.5, wood, 0, 0, 0).rotation.x = Math.PI;
      break;
    case 'trestle':
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - Math.min(0.3, w * 0.15));
        b.box(0.06, lh, 0.08, wood, x, 0, 0);
        b.box(0.08, 0.05, d * 0.8, wood, x, 0, 0);
        b.box(0.08, 0.05, d * 0.8, wood, x, lh - 0.05, 0);
      }
      b.box(w - Math.min(0.6, w * 0.3), 0.05, 0.05, wood, 0, lh * 0.35, 0);
      break;
    case 'hairpin': {
      const metal = mat('#2b2b2b', { metal: 0.8, rough: 0.3 });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = sx * (w / 2 - 0.08);
          const z = sz * (d / 2 - 0.08);
          for (const off of [-0.03, 0.03]) b.cyl(0.005, lh, metal, x + off * sx, 0, z);
        }
      break;
    }
    case 'shelf':
      legs(b, w, d, lh, 0.045, wood, 0.03);
      b.box(w - 0.08, 0.02, d - 0.08, wood, 0, lh * 0.25, 0);
      break;
    case 'legs':
    default:
      if (round) for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        b.box(0.05, lh, 0.05, wood, Math.cos(a) * (w / 2 - 0.12) * 0.75, 0, Math.sin(a) * (d / 2 - 0.12) * 0.75);
      }
      else legs(b, w, d, lh, 0.06, wood, 0.05);
  }
  return b.g;
}

export function chair(it: Item, stool = false) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const wood = mat(it.color, { rough: 0.5 });
  const seat = mat(it.accent, { rough: 0.9 });
  if (stool) {
    // a back adds height: the seat drops so the whole stool stays within its set height
    const seatH = st.back === 'none' ? h : st.back === 'low' ? h - 0.22 : h * 0.62;
    b.cyl(w / 2, 0.06, seat, 0, seatH - 0.06, 0);
    legs(b, w * 0.8, d * 0.8, seatH - 0.06, 0.025, wood, 0);
    b.box(w * 0.7, 0.02, 0.02, wood, 0, seatH * 0.3, d * 0.36);
    if (st.back !== 'none') {
      const top = h;
      b.box(w * 0.8, top - seatH - 0.08, 0.025, wood, 0, seatH + 0.08, -d / 2 + 0.03);
      for (const sx of [-1, 1]) b.box(0.025, top - seatH, 0.025, wood, sx * w * 0.38, seatH, -d / 2 + 0.03);
    }
    return b.g;
  }
  const seatH = Math.min(h - 0.2, 0.46);
  const upholstered = st.back === 'upholstered';
  legs(b, w, d, seatH - 0.05, 0.035, wood, 0.01);
  b.box(w, upholstered ? 0.07 : 0.05, d, seat, 0, seatH - 0.05, 0);
  const bz = -d / 2 + 0.015;
  for (const sx of [-1, 1]) b.box(0.035, h - seatH, 0.03, wood, sx * (w / 2 - 0.0175), seatH, bz);
  const backH = h - seatH;
  switch (st.back) {
    case 'ladder':
      for (let k = 1; k <= 3; k++) b.box(w - 0.07, 0.04, 0.02, wood, 0, seatH + (backH * k) / 3.4, bz);
      break;
    case 'solid':
      b.box(w - 0.07, backH * 0.75, 0.02, wood, 0, seatH + backH * 0.22, bz);
      break;
    case 'upholstered':
      b.box(w, backH, 0.07, seat, 0, seatH, bz + 0.02);
      break;
    case 'slat':
    default:
      b.box(w - 0.07, 0.05, 0.025, wood, 0, h - 0.05, bz);
      for (let x = -w / 2 + 0.07; x <= w / 2 - 0.07 + 1e-6; x += (w - 0.14) / 3) b.box(0.025, backH - 0.12, 0.018, wood, x, seatH + 0.06, bz);
  }
  if (st.arms === 'arms') for (const sx of [-1, 1]) {
    b.box(0.04, 0.025, d * 0.75, wood, sx * (w / 2 - 0.02), seatH + 0.2, -d * 0.1);
    b.box(0.03, 0.2, 0.03, wood, sx * (w / 2 - 0.02), seatH, d * 0.2);
  }
  return b.g;
}

/** Dresser / nightstand with hardware and base choices. */
export function caseGood(it: Item, drawers: number) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const st = getStyle(it);
  const wood = mat(it.color, { rough: 0.5 });
  const hw = mat(it.accent && it.accent !== '#666666' ? it.accent : '#c8a45a', { metal: 0.8, rough: 0.3 });
  const legH = st.base === 'plinth' ? 0.06 : st.base === 'tall-legs' ? Math.min(0.25, h * 0.3) : 0.06;
  if (st.base === 'plinth') b.box(w - 0.02, legH, d - 0.02, wood, 0, 0, 0);
  else furnitureLegs(b, st.base === 'tall-legs' ? 'tapered' : 'block', w, d, legH, wood, 0.03);
  b.box(w, h - legH, d, wood, 0, legH, 0);
  const cols = w > 1.1 ? 2 : 1;
  const dh = (h - legH - 0.02) / drawers;
  for (let i = 0; i < drawers; i++)
    for (let c = 0; c < cols; c++) {
      const cx = -w / 2 + (w / cols) * (c + 0.5);
      const cy = legH + 0.01 + i * dh;
      front(b, 'slab', cx, cy, w / cols - 0.02, dh - 0.015, d / 2, mat(it.color, { rough: 0.45 }));
      const pk = st.pull as string;
      pull(b, pk, cx, pk === 'edge' ? cy + dh - 0.015 : cy + dh / 2, d / 2 + 0.018, false, hw, Math.min(0.16, (w / cols) * 0.35));
    }
  return b.g;
}

// ---------------------------------------------------------------------------
// Bathroom

export function toilet(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const por = mat(it.color, { rough: 0.15 });
  const type = getStyle(it).type as string;
  if (type === 'wall-hung') {
    b.box(w * 0.9, 0.3, 0.06, mat('#dcdcdc', { rough: 0.3 }), 0, h - 0.35, -d / 2 + 0.03); // flush plate
    b.box(0.18, 0.12, 0.01, chrome(), 0, h - 0.3, -d / 2 + 0.065);
    b.cyl(w * 0.32, 0.22, por, 0, 0.2, 0.04, w * 0.42);
    b.cyl(w * 0.42, 0.03, por, 0, 0.42, 0.06, w * 0.52);
    return b.g;
  }
  if (type === 'one-piece') {
    b.box(w * 0.85, h * 0.62, 0.2, por, 0, 0.3, -d / 2 + 0.1);
    b.cyl(w * 0.4, 0.38, por, 0, 0, 0.02, w * 0.48);
  } else {
    b.box(w * 0.9, h - 0.42, 0.2, por, 0, 0.42, -d / 2 + 0.1);
    b.cyl(w * 0.3, 0.38, por, 0, 0, 0.06, w * 0.38);
  }
  b.cyl(w * 0.45, 0.04, por, 0, 0.38, 0.06, w * 0.55);
  return b.g;
}

export function tub(it: Item) {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const type = getStyle(it).type as string;
  const por = mat(it.color, { rough: 0.15 });
  const water = mat('#bfe1ef', { rough: 0.05, opacity: 0.6 });
  if (type === 'alcove') {
    const t = 0.07;
    b.box(w, h, t, por, 0, 0, -d / 2 + t / 2);
    b.box(w, h, t, por, 0, 0, d / 2 - t / 2);
    b.box(t, h, d, por, -w / 2 + t / 2);
    b.box(t, h, d, por, w / 2 - t / 2);
    b.box(w, 0.08, d, por);
    b.box(w - t * 2, 0.002, d - t * 2, water, 0, h * 0.6, 0);
    return b.g;
  }
  const feet = type === 'clawfoot' ? 0.12 : 0;
  if (feet) for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sphere(0.04, mat('#b8913a', { metal: 0.8, rough: 0.3 }), sx * w * 0.35, 0.05, sz * d * 0.3, 0.06);
  // oval shell: outer body with a lighter rim
  b.cyl(w / 2, h - feet, por, 0, feet, 0, d / 2);
  b.cyl(w / 2 - 0.05, 0.004, water, 0, h - 0.12, 0, d / 2 - 0.05);
  b.cyl(w / 2, 0.02, mat('#ffffff', { rough: 0.1 }), 0, h - 0.02, 0, d / 2);
  return b.g;
}

// ---------------------------------------------------------------------------
// People for scale

/** A simple mannequin. pose: standing, seated (on a chair-height seat), wheelchair. */
export function person(it: Item, pose: 'standing' | 'seated' | 'wheelchair') {
  const b = new B();
  const { width: w, depth: d, height: h } = it;
  const cloth = mat(it.color, { rough: 0.9 });
  const skin = mat(it.accent, { rough: 0.8 });
  const pants = mat('#3b4552', { rough: 0.9 });
  if (pose === 'standing') {
    const H = h;
    const head = Math.min(H * 0.065, w / 2);
    b.sphere(head, skin, 0, H - head * 1.1, 0, head * 1.1);
    b.cyl(head * 0.45, H * 0.04, skin, 0, H - head * 2.2 - H * 0.03, 0);
    const armR = Math.min(H * 0.03, w * 0.1);
    const armX = w / 2 - armR; // arms hang inside the figure's width
    const shoulders = Math.max(0.05, w - 4 * armR);
    b.box(shoulders, H * 0.3, Math.min(d, H * 0.13), cloth, 0, H * 0.52, 0); // torso
    for (const sx of [-1, 1]) {
      b.cyl(armR * 0.9, H * 0.34, cloth, sx * armX, H * 0.48, 0); // arms
      b.sphere(armR, skin, sx * armX, H * 0.47, 0);
      b.cyl(H * 0.04, H * 0.5, pants, sx * shoulders * 0.22, 0.02, 0); // legs
      b.box(H * 0.06, 0.04, Math.min(d, H * 0.15), mat('#2a2a2a'), sx * shoulders * 0.22, 0, Math.min(d, H * 0.15) * 0.15);
    }
    return b.g;
  }
  // seated: the figure fits in the item box (h is the seated head height)
  const seatH = pose === 'wheelchair' ? 0.5 : 0.46;
  const torsoH = (h - seatH) * 0.62;
  const head = (h - seatH) * 0.16;
  const sw = Math.min(w - 0.16, 0.46);
  const backZ = pose === 'wheelchair' ? -d / 2 + 0.2 : -d / 2 + 0.1;
  b.sphere(head, skin, 0, h - head * 1.1, backZ + 0.05, head * 1.1);
  b.box(sw, torsoH, 0.24, cloth, 0, seatH, backZ + 0.08);
  for (const sx of [-1, 1]) {
    b.box(0.14, 0.14, Math.min(0.45, d * 0.5), pants, sx * sw * 0.24, seatH, backZ + 0.2 + Math.min(0.45, d * 0.5) / 2 - 0.08); // thighs
    b.box(0.12, seatH, 0.12, pants, sx * sw * 0.24, 0, backZ + 0.12 + Math.min(0.45, d * 0.5));
    b.cyl(0.04, torsoH * 0.8, cloth, sx * (sw / 2 + 0.04), seatH + 0.05, backZ + 0.12);
  }
  if (pose === 'wheelchair') {
    const frame = mat('#3a3f45', { metal: 0.7, rough: 0.4 });
    const tyre = mat('#1b1b1b', { rough: 0.8 });
    const r = Math.min(0.31, h / 2 - 0.01, d / 2 - 0.02);
    for (const sx of [-1, 1]) {
      const wheel = b.cyl(r, 0.03, tyre, sx * (w / 2 - 0.02), r - 0.015, backZ + 0.12, r);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.y = r;
      const caster = b.cyl(0.06, 0.025, tyre, sx * (w / 2 - 0.1), 0.06 - 0.0125, d / 2 - 0.1, 0.06);
      caster.rotation.z = Math.PI / 2;
      caster.position.y = 0.06;
    }
    b.box(w - 0.1, 0.04, 0.45, frame, 0, seatH - 0.04, backZ + 0.25); // seat
    b.box(w - 0.1, 0.45, 0.03, frame, 0, seatH, backZ - 0.02); // back
    b.box(0.25, 0.02, 0.12, frame, 0, 0.08, d / 2 - 0.12); // footrest
  } else {
    // the chair under a seated figure is implied; a stool-height block keeps scale readable
    b.box(sw + 0.04, 0.04, 0.42, mat('#9a8c7a', { rough: 0.6 }), 0, seatH - 0.04, backZ + 0.2);
  }
  return b.g;
}
