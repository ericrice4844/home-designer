// Wall view: the list of things on the selected wall, a dimensioned elevation drawing, and "view in 3D".
import { anchorToWall, canLift, duplicateOnWall, itemWall, moveOnWall, resizeOnWall, neighbourWall, overlapsOnWall, snapOnWall, wallElevation, wallLabel, wallsByDistance, type Elevation } from '../elevation';
import { roomWalls } from '../geometry';
import type { Room } from '../model';
import { store } from '../state';
import { formatLength } from '../units';
import { catalogEntry } from '../catalog';
import { getStyle, styleOptions } from '../itemStyles';
import { uid, type Item } from '../model';
import { button, fieldGroup, h, lengthInput, modal, section, toast } from './dom';
import { buildPrintDocument } from './print';

const fmt = (m: number) => formatLength(m, store.project.settings.units);

/** Ask the app to point the 3D camera straight at a wall. */
export function viewWallIn3D(roomId: string, index: number) {
  window.dispatchEvent(new CustomEvent('view-wall', { detail: { roomId, index } }));
}

/** "Wall view" section shown in the Edit panel while a wall is selected. */
export function wallViewSection(room: Room, wallIndex: number): HTMLElement {
  const el = wallElevation(store.project, room.id, wallIndex);
  if (!el) return h('div');
  const rows = el.items.map((e) =>
    h(
      'button',
      { class: 'wall-item', onclick: () => store.select({ type: 'item', id: e.item.id }), title: 'Select this item' },
      h('span', { class: 'swatch-dot', style: { background: e.item.color } }),
      h('span', { class: 'wall-item-name' }, e.item.name),
      h('span', { class: 'wall-item-meta' }, `${fmt(e.s1 - e.s0)} wide · ${fmt(e.s0)} from left${e.y0 > 0.05 ? ` · ${fmt(e.y0)} up` : ''}`),
    ),
  );
  const openings = el.openings.map((o) =>
    h(
      'button',
      { class: 'wall-item opening', onclick: () => store.select({ type: 'opening', id: o.id }), title: 'Select this opening' },
      h('span', { class: 'swatch-dot', style: { background: '#ffffff' } }),
      h('span', { class: 'wall-item-name' }, o.type.replace('-', ' ')),
      h('span', { class: 'wall-item-meta' }, `${fmt(o.s1 - o.s0)} wide · ${fmt(o.s0)} from left${o.y0 > 0.05 ? ` · sill ${fmt(o.y0)}` : ''}`),
    ),
  );
  return section(
    `${wallLabel(room, wallIndex)} · ${room.name}`,
    h('p', { class: 'hint' }, `${fmt(el.length)} long · ${el.items.length} item${el.items.length === 1 ? '' : 's'}${el.openings.length ? ` · ${el.openings.length} door/window${el.openings.length > 1 ? 's' : ''}` : ''}. Left to right as seen from inside the room.`),
    h('div', { class: 'row wrap' },
      button('📐 Wall elevation', () => openElevation(room.id, wallIndex), 'primary'),
      button('🎥 View wall in 3D', () => viewWallIn3D(room.id, wallIndex)),
    ),
    rows.length || openings.length ? h('div', { class: 'wall-items' }, ...[...rows, ...openings]) : h('p', { class: 'hint' }, 'Nothing is placed against this wall yet.'),
  );
}

// ---------------------------------------------------------------------------
// Elevation drawing

const PAD_L = 100;
const PAD_R = 24;
const PAD_T = 56;
const PAD_B = 86;

export interface DragView {
  id: string;
  guides: { s?: number; y?: number }[];
  overlap: boolean;
}

/** SVG elevation of a wall. Items carry data-item-id so they can be tapped / dragged. */
export function elevationSvg(el: Elevation, maxWidth: number, selectedId?: string, drag?: DragView, maxHeight = Infinity): SVGSVGElement & { scaleK?: number } {
  const NS = 'http://www.w3.org/2000/svg';
  const maxH = Math.max(...el.ceiling.map(([, y]) => y), ...el.items.map((i) => i.y1), ...el.openings.map((o) => o.y1));
  // fit both the width and the height available (a short, tall bathroom wall must not run off the bottom)
  const k = Math.max(20, Math.min((maxWidth - PAD_L - PAD_R) / Math.max(el.length, 0.5), (maxHeight - PAD_T - PAD_B) / Math.max(maxH, 0.5)));
  const width = Math.round(PAD_L + PAD_R + Math.max(el.length, 0.5) * k);
  const height = PAD_T + maxH * k + PAD_B;
  const X = (s: number) => PAD_L + s * k;
  const Y = (y: number) => PAD_T + (maxH - y) * k;
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement & { scaleK?: number };
  svg.scaleK = k;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(Math.round(height)));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Elevation of wall ${el.wall.index + 1} in ${el.room.name}`);
  svg.setAttribute('font-family', 'system-ui, sans-serif');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(NS, tag);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, String(v));
    if (text !== undefined) n.textContent = text;
    svg.appendChild(n);
    return n;
  };
  add('rect', { x: 0, y: 0, width, height, fill: '#ffffff' });
  // wall face with its ceiling profile
  const wallColor = el.room.wallColors[el.wall.index] ?? el.room.wallColor;
  const outline = [`${X(0)},${Y(0)}`, ...el.ceiling.map(([s, y]) => `${X(s)},${Y(y)}`), `${X(el.length)},${Y(0)}`].join(' ');
  add('polygon', { points: outline, fill: wallColor, stroke: '#333', 'stroke-width': 1.5 });
  add('line', { x1: X(0) - 10, y1: Y(0), x2: X(el.length) + 10, y2: Y(0), stroke: '#333', 'stroke-width': 3 });

  for (const o of el.openings) {
    add('rect', { x: X(o.s0), y: Y(o.y1), width: (o.s1 - o.s0) * k, height: (o.y1 - o.y0) * k, fill: o.type === 'window' || o.type === 'sliding-door' ? '#dceefa' : '#ffffff', stroke: '#555', 'stroke-width': 1.2 });
    if (o.type === 'window') add('line', { x1: X((o.s0 + o.s1) / 2), y1: Y(o.y1), x2: X((o.s0 + o.s1) / 2), y2: Y(o.y0), stroke: '#8aa', 'stroke-width': 1 });
    add('text', { x: X((o.s0 + o.s1) / 2), y: Y(o.y1) + 13, 'font-size': 10, 'text-anchor': 'middle', fill: '#555' }, o.type.replace('-', ' '));
  }

  // tall/floor pieces first, wall-hung on top
  const order = [...el.items].sort((a, b) => (a.row === 'wall' ? 1 : 0) - (b.row === 'wall' ? 1 : 0));
  for (const e of order) {
    const sel = e.item.id === selectedId || e.item.id === drag?.id;
    const bad = drag?.id === e.item.id && drag.overlap;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-item-id', e.item.id);
    g.setAttribute('class', 'el-item');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${e.item.name}, ${fmt(e.s1 - e.s0)} wide`);
    const r = document.createElementNS(NS, 'rect');
    const attrs: Record<string, string | number> = {
      x: X(e.s0),
      y: Y(e.y1),
      width: Math.max(1, (e.s1 - e.s0) * k),
      height: Math.max(1, (e.y1 - e.y0) * k),
      fill: e.item.color,
      'fill-opacity': e.projected ? 0.35 : 0.85,
      stroke: bad ? '#e2574c' : sel ? '#2f80ed' : '#222',
      'stroke-width': sel || bad ? 3 : 1,
    };
    if (e.projected) attrs['stroke-dasharray'] = '6 4';
    if (!e.item.locked) attrs.style = 'cursor: grab';
    for (const [a, v] of Object.entries(attrs)) r.setAttribute(a, String(v));
    g.appendChild(r);
    if (e.item.countertop) {
      const ct = document.createElementNS(NS, 'rect');
      for (const [a, v] of Object.entries({ x: X(e.s0) - 2, y: Y(e.y1) - 1, width: (e.s1 - e.s0) * k + 4, height: Math.max(3, 0.03 * k), fill: e.item.countertopColor ?? '#ddd', stroke: '#333', 'stroke-width': 0.8 })) ct.setAttribute(a, String(v));
      g.appendChild(ct);
    }
    const wPx = (e.s1 - e.s0) * k;
    const hPx = (e.y1 - e.y0) * k;
    if (wPx > 26 && hPx > 14) {
      const label = document.createElementNS(NS, 'text');
      const maxChars = Math.max(3, Math.floor(wPx / 6));
      const name = e.item.name.length > maxChars ? e.item.name.slice(0, maxChars - 1) + '…' : e.item.name;
      for (const [a, v] of Object.entries({ x: X((e.s0 + e.s1) / 2), y: Y((e.y0 + e.y1) / 2) + 4, 'font-size': 10, 'text-anchor': 'middle', fill: luminance(e.item.color) < 0.45 ? '#fff' : '#111' })) label.setAttribute(a, String(v));
      label.textContent = name;
      g.appendChild(label);
      if (e.projected && hPx > 30) {
        const sub = document.createElementNS(NS, 'text');
        for (const [a, v] of Object.entries({ x: X((e.s0 + e.s1) / 2), y: Y((e.y0 + e.y1) / 2) + 17, 'font-size': 9, 'text-anchor': 'middle', fill: '#333' })) sub.setAttribute(a, String(v));
        sub.textContent = `${fmt(e.gap)} out from wall`;
        g.appendChild(sub);
      }
    }
    svg.appendChild(g);
  }

  // dimension chains: floor pieces below the floor line, wall-hung pieces above the wall, overall length at the bottom
  const chain = (segs: [number, number][], y: number, color: string) => {
    for (const [a, b] of segs) {
      if (b - a < 0.01) continue;
      add('line', { x1: X(a), y1: y, x2: X(b), y2: y, stroke: color, 'stroke-width': 1 });
      for (const s of [a, b]) add('line', { x1: X(s), y1: y - 4, x2: X(s), y2: y + 4, stroke: color, 'stroke-width': 1 });
      if ((b - a) * k > 22) add('text', { x: X((a + b) / 2), y: y - 3, 'font-size': 9.5, 'text-anchor': 'middle', fill: color }, fmt(b - a));
    }
  };
  chain(el.floorChain, Y(0) + 22, '#c0392b');
  if (el.items.some((i) => i.row !== 'floor') || el.openings.some((o) => o.y0 >= 0.05)) chain(el.wallChain, PAD_T - 22, '#1d5fbf');
  chain([[0, el.length]], Y(0) + 52, '#222');

  // heights on the left: counter, gap to uppers, uppers, ceiling
  const floorTop = mode(el.items.filter((i) => i.row === 'floor').map((i) => round(i.y1)));
  const wallItems = el.items.filter((i) => i.row === 'wall');
  const levels = [0, floorTop, wallItems.length ? Math.min(...wallItems.map((i) => i.y0)) : undefined, wallItems.length ? Math.max(...wallItems.map((i) => i.y1)) : undefined, el.ceiling[0][1]]
    .filter((v): v is number => v !== undefined && v >= 0)
    .sort((a, b) => a - b)
    .filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.02);
  for (let i = 1; i < levels.length; i++) {
    const [a, b] = [levels[i - 1], levels[i]];
    const x = PAD_L - 30;
    add('line', { x1: x, y1: Y(a), x2: x, y2: Y(b), stroke: '#6a1b9a', 'stroke-width': 1 });
    for (const y of [a, b]) add('line', { x1: x - 4, y1: Y(y), x2: x + 4, y2: Y(y), stroke: '#6a1b9a', 'stroke-width': 1 });
    if ((b - a) * k > 14) add('text', { x: x - 4, y: (Y(a) + Y(b)) / 2 + 3, 'font-size': 9.5, 'text-anchor': 'end', fill: '#6a1b9a' }, fmt(b - a));
  }

  // while dragging: snap guides and live distances to the neighbours / floor
  const d = drag && el.items.find((i) => i.item.id === drag.id);
  if (drag && d) {
    for (const g of drag.guides) {
      if (g.s !== undefined) add('line', { x1: X(g.s), y1: PAD_T - 8, x2: X(g.s), y2: Y(0) + 8, stroke: '#e67e22', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
      if (g.y !== undefined) add('line', { x1: X(0) - 8, y1: Y(g.y), x2: X(el.length) + 8, y2: Y(g.y), stroke: '#e67e22', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
    }
    const same = el.items.filter((o) => o !== d && !o.projected && o.y0 < d.y1 - 0.01 && o.y1 > d.y0 + 0.01);
    const leftEdge = Math.max(0, ...same.filter((o) => o.s1 <= d.s0 + 0.005).map((o) => o.s1));
    const rightEdge = Math.min(el.length, ...same.filter((o) => o.s0 >= d.s1 - 0.005).map((o) => o.s0));
    const yMid = Y((d.y0 + d.y1) / 2);
    const live = (a: number, b: number) => {
      if (b - a < 0.003) return;
      add('line', { x1: X(a), y1: yMid, x2: X(b), y2: yMid, stroke: '#e67e22', 'stroke-width': 1.5 });
      add('rect', { x: X((a + b) / 2) - 26, y: yMid - 9, width: 52, height: 16, rx: 8, fill: '#fff', stroke: '#e67e22' });
      add('text', { x: X((a + b) / 2), y: yMid + 3, 'font-size': 10, 'text-anchor': 'middle', fill: '#b35a00', 'font-weight': 600 }, fmt(b - a));
    };
    live(leftEdge, d.s0);
    live(d.s1, rightEdge);
    if (d.y0 > 0.02) {
      const xm = X((d.s0 + d.s1) / 2);
      add('line', { x1: xm, y1: Y(0), x2: xm, y2: Y(d.y0), stroke: '#e67e22', 'stroke-width': 1.5 });
      add('text', { x: xm + 4, y: (Y(0) + Y(d.y0)) / 2, 'font-size': 10, fill: '#b35a00', 'font-weight': 600 }, `↑ ${fmt(d.y0)}`);
    }
    if (drag.overlap) add('text', { x: X((d.s0 + d.s1) / 2), y: Y(d.y1) - 6, 'font-size': 11, 'text-anchor': 'middle', fill: '#c0392b', 'font-weight': 700 }, 'Overlaps another piece');
  }
  return svg;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
function mode(vals: number[]): number | undefined {
  if (!vals.length) return undefined;
  const count = new Map<number, number>();
  for (const v of vals) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}
function luminance(hex: string) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Full-size elevation dialog: pick/step walls, drag pieces along the wall (and up/down), tap to edit, print. */
export function openElevation(roomId: string, wallIndex: number, opts: { include?: string[]; focus?: string } = {}) {
  let index = wallIndex;
  const include = opts.include ?? [];
  const holder = h('div', { class: 'elevation-holder' });
  const wallSelect = h('select', { 'aria-label': 'Wall' });
  const pushBtn = button('⇥ Push against this wall', () => {
    store.update((p) => include.forEach((id) => anchorToWall(p, id, roomId, index)));
    render();
  });
  const editBar = h('div', { class: 'el-editbar', role: 'region', 'aria-label': 'Selected piece' });
  let selected: string | undefined = opts.focus;
  let drag: (DragView & { start: { x: number; y: number }; s0: number; y0: number; el: Elevation; moved: boolean; pointerId: number; locked: boolean }) | null = null;
  let suppressClick = false;

  const current = () => {
    const room = store.room(roomId);
    return room ? wallElevation(store.project, roomId, index, { include }) : null;
  };
  const render = () => {
    const room = store.room(roomId);
    const el = current();
    if (!room || !el) return;
    wallSelect.replaceChildren(
      ...roomWalls(room).map((w) => h('option', { value: String(w.index), selected: w.index === index }, `${wallLabel(room, w.index)} · ${fmt(w.length - room.wallThickness)}`)),
    );
    const width = Math.max(320, Math.min(1000, window.innerWidth - 60));
    const height = Math.max(260, window.innerHeight - 300); // leave room for the dialog's header and buttons
    if (selected && !el.items.some((i) => i.item.id === selected)) selected = undefined; // deleted / moved off this wall
    holder.replaceChildren(elevationSvg(el, width, selected, drag ?? undefined, height - 110));
    renderEditBar(el);
    if (!el.items.length && !el.openings.length) holder.append(h('p', { class: 'hint' }, 'Nothing is placed against this wall yet.'));
    pushBtn.hidden = !el.items.some((i) => i.projected);
  };
  wallSelect.addEventListener('change', () => {
    index = Number(wallSelect.value);
    store.select({ type: 'wall', roomId, index });
    render();
  });
  const step = (d: 1 | -1) => {
    const room = store.room(roomId);
    if (!room) return;
    index = neighbourWall(room, index, d);
    store.select({ type: 'wall', roomId, index });
    render();
  };

  // drag pieces: left/right along the wall, up/down for wall-hung ones
  holder.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest('[data-item-id]');
    if (!g) return;
    const id = g.getAttribute('data-item-id')!;
    const el = current();
    const it = el?.items.find((i) => i.item.id === id);
    if (!el || !it) return;
    drag = { id, guides: [], overlap: false, start: { x: e.clientX, y: e.clientY }, s0: it.s0, y0: it.y0, el, moved: false, pointerId: e.pointerId, locked: !!it.item.locked };
    holder.setPointerCapture(e.pointerId);
  });
  holder.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const svg = holder.querySelector('svg') as (SVGSVGElement & { scaleK?: number }) | null;
    const rect = svg?.getBoundingClientRect();
    if (!svg || !rect) return;
    // screen px → meters: the SVG may be scaled to fit
    const k = (svg.scaleK ?? 1) * (rect.width / Number(svg.getAttribute('width')));
    const dx = e.clientX - drag.start.x;
    const dy = e.clientY - drag.start.y;
    if (drag.locked || (!drag.moved && Math.hypot(dx, dy) < 5)) return;
    drag.moved = true;
    selected = drag.id;
    const free = { s0: drag.s0 + dx / k, y0: drag.y0 - dy / k };
    const snap = e.altKey ? { ...free, guides: [] } : snapOnWall(drag.el, drag.id, free.s0, free.y0, 8 / k);
    const id = drag.id;
    const startEl = drag.el;
    store.live((p) => moveOnWall(p, startEl, id, snap.s0, snap.y0), 'items');
    drag.guides = snap.guides;
    drag.overlap = overlapsOnWall(startEl, id, snap.s0, canLift(startEl.items.find((i) => i.item.id === id)!) ? snap.y0 : drag.y0);
    render();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { moved, id } = drag;
    drag = null;
    suppressClick = true; // the pointer was captured: handle the tap here, not in the click that follows
    setTimeout(() => (suppressClick = false), 0);
    if (moved) {
      store.commit();
      render();
      return;
    }
    if (e.type === 'pointerup') select(id); // a tap selects the piece right here
  };
  const select = (id: string | undefined) => {
    selected = id;
    if (id) store.select({ type: 'item', id });
    render();
  };
  holder.addEventListener('pointerup', endDrag);
  holder.addEventListener('pointercancel', endDrag);

  holder.addEventListener('click', (e) => {
    if (suppressClick) return;
    const g = (e.target as Element).closest('[data-item-id]');
    select(g ? g.getAttribute('data-item-id')! : undefined); // tapping empty wall clears the selection
  });
  holder.addEventListener('keydown', (e) => {
    const g = (e.target as Element).closest('[data-item-id]');
    if (!g) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(g.getAttribute('data-item-id')!);
      return;
    }
    // keyboard nudging: ← → along the wall (1"), ↑ ↓ for wall-hung pieces; Shift = 1'
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const id = g.getAttribute('data-item-id')!;
    const el = current();
    const it = el?.items.find((i) => i.item.id === id);
    if (!el || !it || it.item.locked) return;
    const stepM = (e.shiftKey ? 12 : 1) * (store.project.settings.units === 'imperial' ? 0.0254 : 0.01);
    store.update((p) => moveOnWall(p, el, id, it.s0 + dir[0] * stepM, it.y0 + dir[1] * stepM));
    render();
    (holder.querySelector(`[data-item-id="${id}"]`) as HTMLElement | null)?.focus();
  });

  /** Controls for the selected piece, under the drawing. */
  const renderEditBar = (el: Elevation) => {
    const e = selected ? el.items.find((i) => i.item.id === selected) : undefined;
    if (!e) {
      editBar.replaceChildren(h('p', { class: 'hint' }, 'Tap a piece in the drawing to edit it here.'));
      return;
    }
    const it = e.item;
    const id = it.id;
    const upd = (fn: (q: Item) => void) =>
      store.update((p) => {
        const q = p.items.find((i) => i.id === id);
        if (q) fn(q);
      });
    const entry = catalogEntry(it.kind);
    const widthBox = h('div', { class: 'el-field' },
      h('span', { class: 'field-label' }, 'Width'),
      lengthInput(e.s1 - e.s0, (v) => store.update((p) => resizeOnWall(p, roomId, index, id, v)), { min: 0.05 }),
    );
    const controls: HTMLElement[] = [widthBox];
    if (entry?.widths)
      controls.push(
        fieldGroup('Standard widths', h('div', { class: 'chips' }, ...entry.widths.map((w) => button(`${w}"`, () => store.update((p) => {
          resizeOnWall(p, roomId, index, id, w * 0.0254);
          const q = p.items.find((i) => i.id === id);
          if (q) q.name = `${entry.name} ${w}"`;
        }), `chip ${Math.abs((e.s1 - e.s0) / 0.0254 - w) < 0.3 ? 'active' : ''}`)))),
      );
    controls.push(h('div', { class: 'el-field' }, h('span', { class: 'field-label' }, 'Height'), lengthInput(it.height, (v) => upd((q) => (q.height = v)), { min: 0.02 })));
    if (canLift(e)) controls.push(h('div', { class: 'el-field' }, h('span', { class: 'field-label' }, 'Off the floor'), lengthInput(e.y0, (v) => store.update((p) => moveOnWall(p, el, id, e.s0, v)), { min: 0 })));
    for (const o of styleOptions(it.kind)) {
      if (o.type !== 'choice') continue;
      const sel = h('select', { 'aria-label': o.label }, ...o.options.map(([v, l]) => h('option', { value: v, selected: getStyle(it)[o.key] === v }, l)));
      sel.addEventListener('change', () => upd((q) => (q.style = { ...(q.style ?? {}), [o.key]: sel.value })));
      controls.push(h('div', { class: 'el-field' }, h('span', { class: 'field-label' }, o.label), sel));
    }
    const color = h('input', { type: 'color', value: it.color, 'aria-label': 'Color' });
    color.addEventListener('change', () => upd((q) => (q.color = color.value)));
    controls.push(h('div', { class: 'el-field' }, h('span', { class: 'field-label' }, 'Color'), color));
    const lockBtn = button(it.locked ? '🔓 Unlock' : '🔒 Lock', () => upd((q) => (q.locked = !q.locked)), 'small');
    editBar.replaceChildren(
      h('div', { class: 'el-edit-head' },
        h('b', {}, it.name),
        h('span', { class: 'hint' }, `${fmt(e.s0)} from left${e.y0 > 0.02 ? ` · ${fmt(e.y0)} up` : ''}${e.projected ? ` · ${fmt(e.gap)} out from the wall` : ''}`),
        h('div', { class: 'row' },
          button('⧉ Copy', () => {
            let newId: string | null = null;
            store.update((p) => (newId = duplicateOnWall(p, roomId, index, id, uid('item'))));
            if (newId) select(newId);
            else toast('No room on this wall for a copy');
          }, 'small', 'Copy next to it on this wall'),
          lockBtn,
          button('🗑 Delete', () => {
            store.update((p) => (p.items = p.items.filter((i) => i.id !== id)));
            select(undefined);
          }, 'small danger'),
          button('✎ More options', () => {
            store.select({ type: 'item', id });
            m.close();
          }, 'small', 'All settings in the Edit panel'),
        ),
      ),
      h('div', { class: 'el-controls' }, ...controls),
    );
  };
  // keep the drawing in step with edits made anywhere (undo, the edit bar, other panels)
  const unsubscribe = store.subscribe((r) => {
    if (r !== 'live' && !drag && document.body.contains(holder)) render();
  });

  const body = h(
    'div',
    { class: 'elevation' },
    h('div', { class: 'row wrap elevation-bar' }, button('◀', () => step(-1), 'icon', 'Previous wall'), wallSelect, button('▶', () => step(1), 'icon', 'Next wall')),
    holder,
    editBar,
    h('p', { class: 'hint' }, 'Seen from inside the room. Tap a piece to edit it below; drag it along the wall (wall-hung pieces also up/down) – it snaps to neighbours, centres and standard heights, hold Alt for free movement. Red: widths along the floor · blue: wall-hung · purple: heights.'),
  );
  const m = modal('Wall elevation', body, [
    pushBtn,
    button('🎥 View in 3D', () => {
      m.close();
      viewWallIn3D(roomId, index);
    }),
    button('🖨️ Print', () => {
      const svg = holder.querySelector('svg');
      if (!svg) return;
      const w = window.open('', '_blank');
      if (!w) return;
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const room = store.room(roomId);
      buildPrintDocument(w.document, `${room?.name ?? ''} · ${room ? wallLabel(room, index) : ''}`, url);
    }),
    button('Done', () => m.close(), 'primary'),
  ]);
  m.el.querySelector('.modal')?.classList.add('wide');
  new MutationObserver((_, obs) => {
    if (!m.el.isConnected) {
      obs.disconnect();
      unsubscribe();
    }
  }).observe(document.body, { childList: true });
  render();
}

/** Choose which wall to show: nearest first for an item, or all walls of a room. */
export function pickWall(choices: { roomId: string; index: number; label: string; length: number; distance?: number }[], title: string, onPick: (c: { roomId: string; index: number }) => void) {
  const list = h(
    'div',
    { class: 'wall-items' },
    ...choices.map((c, i) =>
      h(
        'button',
        { class: 'wall-item', onclick: () => (m.close(), onPick(c)) },
        h('span', { class: 'swatch-dot', style: { background: i === 0 && c.distance !== undefined ? '#2f80ed' : '#ffffff' } }),
        h('span', { class: 'wall-item-name' }, c.label + (i === 0 && c.distance !== undefined ? ' (nearest)' : '')),
        h('span', { class: 'wall-item-meta' }, `${fmt(c.length)} long${c.distance !== undefined ? ` · ${fmt(c.distance)} away` : ''}`),
      ),
    ),
  );
  const m = modal(title, list);
}

/** "Elevation view" for an item: straight to its wall if it is against one, otherwise ask which wall. */
export function elevationForItem(itemId: string) {
  const it = store.item(itemId);
  if (!it) return;
  const anchored = itemWall(store.project, it);
  if (anchored) return openElevation(anchored.roomId, anchored.index, { focus: it.id });
  const walls = wallsByDistance(store.project, it);
  if (!walls.length) return toast('Move the item into a room first');
  pickWall(walls, `Which wall should “${it.name}” be shown against?`, (c) => openElevation(c.roomId, c.index, { include: [it.id], focus: it.id }));
}

/** "Wall elevations" for a room: pick any of its walls. */
export function elevationForRoom(room: Room) {
  pickWall(
    roomWalls(room).map((w) => ({ roomId: room.id, index: w.index, label: wallLabel(room, w.index), length: w.length - room.wallThickness })),
    `Wall elevations · ${room.name}`,
    (c) => openElevation(c.roomId, c.index),
  );
}
