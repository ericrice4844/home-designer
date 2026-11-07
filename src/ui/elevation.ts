// Wall view: the list of things on the selected wall, a dimensioned elevation drawing, and "view in 3D".
import { neighbourWall, wallElevation, type Elevation } from '../elevation';
import type { Room } from '../model';
import { store } from '../state';
import { formatLength } from '../units';
import { button, h, modal, section } from './dom';
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
    `Wall ${wallIndex + 1} · ${room.name}`,
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

/** SVG elevation of a wall. Items carry data-item-id so clicks can select them. */
export function elevationSvg(el: Elevation, width: number, selectedId?: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const maxH = Math.max(...el.ceiling.map(([, y]) => y), ...el.items.map((i) => i.y1), ...el.openings.map((o) => o.y1));
  const k = (width - PAD_L - PAD_R) / Math.max(el.length, 0.5);
  const height = PAD_T + maxH * k + PAD_B;
  const X = (s: number) => PAD_L + s * k;
  const Y = (y: number) => PAD_T + (maxH - y) * k;
  const svg = document.createElementNS(NS, 'svg');
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
    const sel = e.item.id === selectedId;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('data-item-id', e.item.id);
    g.setAttribute('class', 'el-item');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${e.item.name}, ${fmt(e.s1 - e.s0)} wide`);
    const r = document.createElementNS(NS, 'rect');
    const attrs: Record<string, string | number> = { x: X(e.s0), y: Y(e.y1), width: Math.max(1, (e.s1 - e.s0) * k), height: Math.max(1, (e.y1 - e.y0) * k), fill: e.item.color, 'fill-opacity': 0.85, stroke: sel ? '#2f80ed' : '#222', 'stroke-width': sel ? 3 : 1 };
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

/** Full-size elevation dialog: step around the room, tap a piece to edit it, print. */
export function openElevation(roomId: string, wallIndex: number) {
  let index = wallIndex;
  const holder = h('div', { class: 'elevation-holder' });
  const title = h('span', {});
  const render = () => {
    const room = store.room(roomId);
    const el = room && wallElevation(store.project, roomId, index);
    if (!room || !el) return;
    title.textContent = `${room.name} · wall ${index + 1} · ${fmt(el.length)}`;
    const width = Math.max(320, Math.min(1000, window.innerWidth - 60));
    const sel = store.ui.selection?.type === 'item' ? store.ui.selection.id : undefined;
    holder.replaceChildren(elevationSvg(el, width, sel));
    if (!el.items.length && !el.openings.length) holder.append(h('p', { class: 'hint' }, 'Nothing is placed against this wall yet.'));
  };
  const step = (d: 1 | -1) => {
    const room = store.room(roomId);
    if (!room) return;
    index = neighbourWall(room, index, d);
    store.select({ type: 'wall', roomId, index });
    render();
  };
  holder.addEventListener('click', (e) => {
    const g = (e.target as Element).closest('[data-item-id]');
    if (!g) return;
    store.select({ type: 'item', id: g.getAttribute('data-item-id')! });
    m.close();
  });
  holder.addEventListener('keydown', (e) => {
    const g = (e.target as Element).closest('[data-item-id]');
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      (g as unknown as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  const body = h(
    'div',
    { class: 'elevation' },
    h('div', { class: 'row wrap elevation-bar' },
      button('◀', () => step(-1), 'icon', 'Previous wall'),
      title,
      button('▶', () => step(1), 'icon', 'Next wall'),
    ),
    holder,
    h('p', { class: 'hint' }, 'Seen from inside the room. Red: widths along the floor · blue: wall-hung pieces · purple: heights. Tap a piece to edit it.'),
  );
  const m = modal('Wall elevation', body, [
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
      buildPrintDocument(w.document, title.textContent ?? 'Wall elevation', url);
    }),
    button('Done', () => m.close(), 'primary'),
  ]);
  m.el.querySelector('.modal')?.classList.add('wide');
  render();
}
