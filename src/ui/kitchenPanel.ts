import { CATALOG } from '../catalog';
import { pointInPolygon, roomWalls } from '../geometry';
import { analyzeKitchen, generateKitchenSafe, isReplaceableKitchenItem, kitchenOptionsFrom, LAYOUT_LABELS, type KitchenLayout, type KitchenOptions } from '../kitchen';
import type { Room } from '../model';
import { store } from '../state';
import { formatLength } from '../units';
import { button, checkbox, field, h, row, section, select, toast } from './dom';

const CABINET_STYLES: [string, string][] = [
  ['#ffffff', 'Pure white'],
  ['#f3f1ec', 'Warm white'],
  ['#d8d3c8', 'Greige'],
  ['#9aa3a8', 'Dove gray'],
  ['#6f7f6b', 'Sage'],
  ['#33475b', 'Navy'],
  ['#2b2b2b', 'Matte black'],
  ['#8b5e3c', 'Walnut'],
  ['#c19a6b', 'White oak'],
];
const COUNTERS: [string, string][] = [
  ['#f2f0eb', 'White quartz'],
  ['#e9e6e1', 'Carrara marble'],
  ['#d9d4cc', 'Cream granite'],
  ['#7a7f85', 'Concrete'],
  ['#2a2a2a', 'Black granite'],
  ['#c49a6c', 'Butcher block'],
];
const FINISHES: [string, string][] = [
  ['#c9ccd1', 'Stainless'],
  ['#2b2b2b', 'Black stainless'],
  ['#f4f4f4', 'White'],
  ['#b08d57', 'Brass / champagne'],
];
const HANDLES: [string, string][] = [
  ['#888888', 'Brushed nickel'],
  ['#2b2b2b', 'Matte black'],
  ['#c8a45a', 'Brass'],
  ['#b87333', 'Copper'],
];



export function kitchenPanel(onPlace: (kind: string) => void): HTMLElement {
  // options live in the project so they are saved, undoable and come back after a reload
  const opts: KitchenOptions = kitchenOptionsFrom(store.project);
  const save = () => store.update((p) => (p.kitchen = { ...opts }));
  const room = store.selectedRoom() ?? store.project.rooms.find((r) => /kitchen/i.test(r.name)) ?? store.project.rooms[0];
  const units = store.project.settings.units;
  const root = h('div', { class: 'panel' });
  if (!room) {
    root.append(section('Kitchen designer', h('p', { class: 'hint' }, 'Draw a room first, then come back to lay out a kitchen.')));
    return root;
  }
  const walls = roomWalls(room);
  if (!walls.some((w) => w.index === opts.wallIndex)) opts.wallIndex = walls[0]?.index ?? 0;
  const sel = store.ui.selection;
  if (sel?.type === 'wall' && sel.roomId === room.id) opts.wallIndex = sel.index;

  const swatchRow = (list: [string, string][], value: string, set: (c: string) => void) =>
    h('div', { class: 'swatches labeled' }, ...list.map(([c, l]) => h('button', { class: `swatch ${c === value ? 'active' : ''}`, title: l, style: { background: c }, onclick: () => (set(c), rerender()) })));
  const rerender = save;

  root.append(
    section(
      `Kitchen layout · ${room.name}`,
      field('Room', select(room.id, store.project.rooms.map((r) => [r.id, r.name] as [string, string]), (v) => store.select({ type: 'room', id: v }))),
      field('Layout', select<KitchenLayout>(opts.layout, Object.entries(LAYOUT_LABELS) as [KitchenLayout, string][], (v) => ((opts.layout = v), rerender()))),
      field('Main wall', select(String(opts.wallIndex), walls.map((w) => [String(w.index), `Wall ${w.index + 1} — ${formatLength(w.length, units)}`] as [string, string]), (v) => {
        opts.wallIndex = Number(v);
        save();
        store.select({ type: 'wall', roomId: room.id, index: opts.wallIndex });
      }), 'Tip: tap a wall in the plan to choose it'),
      layoutDiagram(opts.layout),
      field('Cabinets', swatchRow(CABINET_STYLES, opts.cabinetColor, (c) => (opts.cabinetColor = c))),
      field('Countertop', swatchRow(COUNTERS, opts.countertopColor, (c) => (opts.countertopColor = c))),
      field('Appliances', swatchRow(FINISHES, opts.applianceColor, (c) => (opts.applianceColor = c))),
      field('Hardware', swatchRow(HANDLES, opts.handleColor, (c) => (opts.handleColor = c))),
      opts.layout.includes('island') ? field('Island', swatchRow(CABINET_STYLES, opts.islandColor, (c) => (opts.islandColor = c))) : null,
      checkbox(opts.wallCabinets, 'Upper wall cabinets & range hood', (v) => ((opts.wallCabinets = v), save())),
      checkbox(opts.replace, 'Replace existing cabinets/appliances in this room (keeps laundry & furniture)', (v) => ((opts.replace = v), save())),
      row(
        button('✨ Generate kitchen', () => {
          const r = store.room(room.id)!;
          let warning: string | undefined;
          store.update((p) => {
            if (opts.replace) p.items = p.items.filter((i) => !(isReplaceableKitchenItem(i) && pointInPolygon({ x: i.x, z: i.z }, r.points)));
            const res = generateKitchenSafe(p, r, opts);
            warning = res.warning;
            p.items.push(...res.items);
            p.kitchen = { ...opts };
          });
          if (warning) toast(warning, 6000);
        }, 'primary'),
        button('Apply finishes to existing', () => applyFinishes(room, opts)),
      ),
    ),
  );

  // Analysis
  const res = analyzeKitchen(store.project, room, (m) => formatLength(m, units));
  root.append(
    section(
      'Design check',
      h('ul', { class: 'checks' }, ...res.checks.map((c) => h('li', { class: c.ok === null ? 'info' : c.ok ? 'ok' : 'warn' }, h('span', { class: 'check-icon' }, c.ok === null ? 'ℹ' : c.ok ? '✓' : '!'), h('div', {}, h('b', {}, c.label), h('span', {}, c.detail))))),
      h('p', { class: 'hint' }, 'Based on common NKBA kitchen planning guidelines.'),
    ),
  );

  // Quick add
  const groups: [string, string[]][] = [
    ['Cabinets', ['base-cabinet', 'drawer-base', 'sink-base', 'corner-base', 'wall-cabinet', 'tall-pantry', 'island', 'open-shelf']],
    ['Appliances', ['refrigerator', 'range', 'cooktop', 'wall-oven', 'dishwasher', 'microwave', 'range-hood']],
    ['Extras', ['bar-stool', 'pendant', 'under-cabinet', 'recessed']],
  ];
  for (const [title, kinds] of groups) {
    root.append(
      section(
        title,
        h('div', { class: 'catalog-grid compact' }, ...kinds.map((k) => {
          const e = CATALOG.find((c) => c.kind === k)!;
          return h('button', { class: 'cat-item', onclick: () => onPlace(k), title: `${e.w}" × ${e.d}" × ${e.h}"` }, h('span', { class: 'cat-icon' }, e.icon), h('span', { class: 'cat-name' }, e.name));
        })),
      ),
    );
  }
  return root;
}

function applyFinishes(room: Room, opts: KitchenOptions) {
  store.update((p) => {
    p.kitchen = { ...opts };
    for (const it of p.items) {
      if (!pointInPolygon({ x: it.x, z: it.z }, room.points)) continue;
      if (!isReplaceableKitchenItem(it) && it.category !== 'kitchen') continue;
      if (it.category === 'kitchen') {
        it.color = it.kind === 'island' ? opts.islandColor : opts.cabinetColor;
        it.accent = opts.handleColor;
      }
      if (it.category === 'appliance' && it.kind !== 'wall-oven') it.color = opts.applianceColor;
      if (it.kind === 'wall-oven') {
        it.color = opts.cabinetColor;
        it.accent = opts.applianceColor;
      }
      if (it.countertop || it.kind === 'island') it.countertopColor = opts.countertopColor;
    }
  });
}

function layoutDiagram(layout: KitchenLayout) {
  const s = 'stroke="currentColor" stroke-width="7" fill="none" stroke-linecap="square"';
  const base: Record<string, string> = {
    I: `<path d="M10 10 H90" ${s}/>`,
    L: `<path d="M10 90 V10 H90" ${s}/>`,
    U: `<path d="M10 90 V10 H90 V90" ${s}/>`,
    galley: `<path d="M10 10 H90 M10 90 H90" ${s}/>`,
  };
  const key = layout.replace('+island', '');
  const island = layout.includes('island') ? `<rect x="35" y="50" width="30" height="14" fill="currentColor" opacity=".6"/>` : '';
  const el = h('div', { class: 'layout-diagram' });
  el.innerHTML = `<svg viewBox="0 0 100 100" width="70" height="70">${base[key]}${island}</svg>`;
  return el;
}
