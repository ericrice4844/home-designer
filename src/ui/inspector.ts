import { catalogEntry, isCeilingMounted } from '../catalog';
import { area, bounds, ceilingHeightAt, centroid, maxCeilingHeight, roomAt, roomWalls } from '../geometry';
import { FT, IN, uid, type CeilingType, type FloorType, type Item, type ItemShape, type Opening, type OpeningType, type Project, type Room } from '../model';
import { store } from '../state';
import { floorPreview } from '../three/textures';
import { formatArea, formatLength } from '../units';
import { button, checkbox, colorInput, field, h, lengthInput, numberInput, row, section, select, slider, toast } from './dom';
import { addToLibrary, footprintEditor, FOOTPRINTS, importPatternImage } from './importers';

export const WALL_SWATCHES = ['#ffffff', '#f1ede4', '#ece6dc', '#e3e7e1', '#dfe5ec', '#d6cfc4', '#c9b9a3', '#a7b8a8', '#8fa3b8', '#5d7285', '#3f4a59', '#7a4e3a', '#b85c4b', '#e8c872'];
const CABINET_SWATCHES = ['#ffffff', '#f3f1ec', '#d8d3c8', '#9aa3a8', '#6f7f6b', '#33475b', '#2b2b2b', '#8b5e3c', '#c19a6b'];
const FLOOR_TYPES: [FloorType, string][] = [
  ['hardwood', 'Hardwood'],
  ['laminate', 'Laminate'],
  ['vinyl', 'Vinyl plank'],
  ['herringbone', 'Herringbone'],
  ['tile', 'Tile'],
  ['stone', 'Stone'],
  ['checker', 'Checkerboard'],
  ['carpet', 'Carpet'],
  ['concrete', 'Concrete'],
  ['custom', 'Imported pattern'],
];
const FLOOR_PRESETS: Record<FloorType, { color: string; accent: string; scale: number }> = {
  hardwood: { color: '#b07a4a', accent: '#8a5a32', scale: 5 * IN },
  laminate: { color: '#c49a6c', accent: '#9a7650', scale: 7 * IN },
  vinyl: { color: '#a9a39a', accent: '#7f786e', scale: 7 * IN },
  herringbone: { color: '#b48a5e', accent: '#7f5c3a', scale: 4 * IN },
  tile: { color: '#e6e1d8', accent: '#b9b2a5', scale: 12 * IN },
  stone: { color: '#d6d0c4', accent: '#a69f92', scale: 24 * IN },
  checker: { color: '#f4f4f4', accent: '#2d2d2d', scale: 12 * IN },
  carpet: { color: '#c9c0b3', accent: '#a69c8e', scale: 0.2 },
  concrete: { color: '#a6a6a2', accent: '#8c8c88', scale: 0.4 },
  custom: { color: '#cccccc', accent: '#999999', scale: 1 },
};

const fmt = (m: number) => formatLength(m, store.project.settings.units);

function updRoom(id: string, fn: (r: Room, p: Project) => void) {
  store.update((p) => {
    const r = p.rooms.find((q) => q.id === id);
    if (r) fn(r, p);
  });
}
function liveRoom(id: string, fn: (r: Room) => void) {
  const r = store.project.rooms.find((q) => q.id === id);
  if (r) fn(r);
}

// ---------------------------------------------------------------------------

export function roomPanel(room: Room, wallIndex?: number): HTMLElement {
  const b = bounds(room.points);
  const walls = roomWalls(room);
  const units = store.project.settings.units;
  const perim = walls.reduce((s, w) => s + w.length, 0);
  const root = h('div', { class: 'panel' });

  root.append(
    section(
      'Room',
      field('Name', h('input', { type: 'text', value: room.name, onchange: (e: Event) => updRoom(room.id, (r) => (r.name = (e.target as HTMLInputElement).value)) })),
      h('div', { class: 'grid2' },
        field('Width (X)', lengthInput(b.maxX - b.minX, (v) => updRoom(room.id, (r) => scaleRoom(r, v / (b.maxX - b.minX || 1), 1)), { min: 0.3 })),
        field('Length (Z)', lengthInput(b.maxZ - b.minZ, (v) => updRoom(room.id, (r) => scaleRoom(r, 1, v / (b.maxZ - b.minZ || 1))), { min: 0.3 })),
      ),
      h('div', { class: 'stats' }, h('span', {}, `Floor ${formatArea(area(room.points), units)}`), h('span', {}, `Perimeter ${fmt(perim)}`), h('span', {}, `${walls.length} walls`)),
      field('Floor elevation', lengthInput(room.elevation, (v) => updRoom(room.id, (r) => (r.elevation = v))), 'Raise for steps, sunken rooms or an upper floor'),
    ),
  );

  // Walls
  const pitch = room.ceiling.type === 'flat' || room.ceiling.type === 'tray' ? '' : slopeText(room);
  root.append(
    section(
      'Walls',
      h('div', { class: 'grid2' },
        field('Wall height', lengthInput(room.wallHeight, (v) => updRoom(room.id, (r) => {
          r.wallHeight = v;
          if (r.ceiling.peakHeight < v) r.ceiling.peakHeight = v;
        }), { min: 1 })),
        field('Thickness', lengthInput(room.wallThickness, (v) => updRoom(room.id, (r) => (r.wallThickness = v)), { min: 0.03, max: 0.6 })),
      ),
      field('Wall color', colorInput(room.wallColor, (c) => liveRoom(room.id, (r) => (r.wallColor = c)), WALL_SWATCHES)),
      row(
        checkbox(room.baseboard, 'Baseboards', (v) => updRoom(room.id, (r) => (r.baseboard = v))),
        room.baseboard ? colorInput(room.baseboardColor, (c) => liveRoom(room.id, (r) => (r.baseboardColor = c))) : null,
      ),
      h('div', { class: 'wall-list' }, ...walls.map((w) => wallRow(room, w.index, w.length, wallIndex === w.index))),
    ),
  );

  // Ceiling
  const c = room.ceiling;
  const ceilingBody = h('div', {});
  ceilingBody.append(
    field('Ceiling type', select<CeilingType>(c.type, [
      ['flat', 'Flat'],
      ['shed', 'Sloped (single slope / shed)'],
      ['gable', 'Vaulted (cathedral / gable)'],
      ['tray', 'Tray (raised center)'],
    ], (v) => updRoom(room.id, (r) => {
      r.ceiling.type = v;
      if (v !== 'flat' && r.ceiling.peakHeight <= r.wallHeight) r.ceiling.peakHeight = r.wallHeight + (v === 'tray' ? 1 * FT : 3 * FT);
    }))),
  );
  if (c.type !== 'flat') {
    ceilingBody.append(
      field(c.type === 'tray' ? 'Tray height' : 'Peak height', lengthInput(c.peakHeight, (v) => updRoom(room.id, (r) => (r.ceiling.peakHeight = Math.max(v, r.wallHeight))), { min: room.wallHeight })),
    );
    if (c.type === 'shed' || c.type === 'gable')
      ceilingBody.append(
        field(c.type === 'shed' ? 'Slope rises toward' : 'Ridge direction', slider(Math.round((c.angle * 180) / Math.PI), 0, 345, 15, (v) => liveRoom(room.id, (r) => (r.ceiling.angle = (v * Math.PI) / 180)), (v) => compassText(v, c.type === 'gable'))),
        h('p', { class: 'hint' }, pitch),
      );
    if (c.type === 'tray') ceilingBody.append(field('Tray inset from walls', lengthInput(c.trayInset, (v) => updRoom(room.id, (r) => (r.ceiling.trayInset = v)), { min: 0.1 })));
  }
  ceilingBody.append(field('Ceiling color', colorInput(room.ceilingColor, (col) => liveRoom(room.id, (r) => (r.ceilingColor = col)), ['#ffffff', '#fbfaf7', '#f1ede4', '#dfe5ec', '#c9b9a3', '#8b5e3c', '#3f4a59'])));
  root.append(section('Ceiling', ceilingBody));

  // Floor
  const f = room.floor;
  const tiles = h(
    'div',
    { class: 'floor-grid' },
    ...FLOOR_TYPES.filter(([t]) => t !== 'custom' || f.imageAsset).map(([t, label]) => {
      const preset = t === f.type ? f : { ...FLOOR_PRESETS[t], type: t, rotation: 0 };
      return h(
        'button',
        {
          class: `floor-tile ${t === f.type ? 'active' : ''}`,
          title: label,
          onclick: () => updRoom(room.id, (r) => {
            if (r.floor.type === t) return;
            r.floor = { ...r.floor, type: t, ...(t === 'custom' ? {} : FLOOR_PRESETS[t]) };
          }),
        },
        h('img', { src: floorPreview({ ...preset, type: t } as any), alt: '' }),
        h('span', {}, label),
      );
    }),
  );
  root.append(
    section(
      'Flooring',
      tiles,
      h('div', { class: 'grid2' },
        field('Color', colorInput(f.color, (col) => liveRoom(room.id, (r) => (r.floor.color = col)))),
        field(f.type === 'tile' || f.type === 'stone' ? 'Grout' : f.type === 'checker' ? 'Second color' : 'Accent', colorInput(f.accent, (col) => liveRoom(room.id, (r) => (r.floor.accent = col)))),
      ),
      h('div', { class: 'grid2' },
        field(f.type.match(/tile|stone|checker/) ? 'Tile size' : f.type === 'custom' ? 'Pattern repeat' : 'Plank width', lengthInput(f.scale, (v) => updRoom(room.id, (r) => (r.floor.scale = v)), { min: 0.02, max: 5 })),
        field('Rotation', slider(Math.round((f.rotation * 180) / Math.PI), 0, 180, 15, (v) => liveRoom(room.id, (r) => (r.floor.rotation = (v * Math.PI) / 180)), (v) => `${v}°`)),
      ),
      row(
        button('🖼️ Import pattern / photo', async () => {
          const id = await importPatternImage();
          if (id) updRoom(room.id, (r) => (r.floor = { ...r.floor, type: 'custom', imageAsset: id, scale: r.floor.type === 'custom' ? r.floor.scale : 1 }));
        }),
        button('Apply to all rooms', () => store.update((p) => p.rooms.forEach((r) => (r.floor = { ...room.floor })))),
      ),
    ),
  );

  root.append(
    section(
      'Actions',
      row(
        button('🚶 Walk in', () => {
          store.select({ type: 'room', id: room.id });
          store.setUI({ camera: 'walk', view: store.ui.view === 'plan' ? 'split' : store.ui.view });
        }, 'primary'),
        button('Duplicate', () => {
          const copy: Room = JSON.parse(JSON.stringify(room));
          copy.id = uid('room');
          copy.name = room.name + ' copy';
          const dx = b.maxX - b.minX;
          copy.points = copy.points.map((p) => ({ x: p.x + dx, z: p.z }));
          store.update((p) => p.rooms.push(copy));
          store.select({ type: 'room', id: copy.id });
        }),
        button('Delete room', () => {
          if (confirm(`Delete “${room.name}”?`)) store.deleteSelection();
        }, 'danger'),
      ),
    ),
  );
  return root;
}

function slopeText(room: Room) {
  const c = room.ceiling;
  const rise = c.peakHeight - room.wallHeight;
  const b = bounds(room.points);
  const span = c.type === 'shed' ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ) : Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const angle = (Math.atan2(rise, span) * 180) / Math.PI;
  const pitch = (rise / span) * 12;
  return `≈ ${pitch.toFixed(1)}/12 pitch · ${angle.toFixed(0)}° · max height ${fmt(maxCeilingHeight(room))}`;
}

function compassText(deg: number, ridge: boolean) {
  const names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const n = names[Math.round(((deg % 360) + 360) / 45) % 8];
  return ridge ? `${deg}° (${n}–${names[(Math.round(deg / 45) + 4) % 8]})` : `${deg}° (${n})`;
}

function scaleRoom(r: Room, sx: number, sz: number) {
  const b = bounds(r.points);
  r.points = r.points.map((p) => ({ x: b.minX + (p.x - b.minX) * sx, z: b.minZ + (p.z - b.minZ) * sz }));
}

function wallRow(room: Room, index: number, length: number, active: boolean) {
  const color = room.wallColors[index];
  const hidden = room.hiddenWalls.includes(index);
  const el = h(
    'div',
    { class: `wall-row ${active ? 'active' : ''}` },
    h('button', { class: 'wall-name', onclick: () => store.select({ type: 'wall', roomId: room.id, index }) }, `Wall ${index + 1}`),
    lengthInput(length, (v) => updRoom(room.id, (r) => setWallLength(r, index, v)), { min: 0.1 }),
    h('input', {
      type: 'color',
      value: color ?? room.wallColor,
      title: 'Accent color for this wall',
      oninput: (e: Event) => store.live(() => liveRoom(room.id, (r) => (r.wallColors[index] = (e.target as HTMLInputElement).value))),
      onchange: () => store.commit(),
    }),
    color ? button('↺', () => updRoom(room.id, (r) => delete r.wallColors[index]), 'icon ghost', 'Reset to room color') : null,
    button(hidden ? '👁‍🗨' : '👁', () => updRoom(room.id, (r) => (r.hiddenWalls = hidden ? r.hiddenWalls.filter((i) => i !== index) : [...r.hiddenWalls, index])), 'icon ghost', hidden ? 'Show wall' : 'Remove wall (open plan)'),
  );
  if (active) {
    el.append(
      h('div', { class: 'wall-actions' },
        button('+ Door', () => addOpening(room, index, 'door'), 'small'),
        button('+ Window', () => addOpening(room, index, 'window'), 'small'),
        button('+ Opening', () => addOpening(room, index, 'opening'), 'small'),
        button('+ Slider', () => addOpening(room, index, 'sliding-door'), 'small'),
        button('Split wall', () => updRoom(room.id, (r) => {
          const a = r.points[index];
          const bb = r.points[(index + 1) % r.points.length];
          r.points.splice(index + 1, 0, { x: (a.x + bb.x) / 2, z: (a.z + bb.z) / 2 });
          // keep opening indices consistent
          for (const o of store.project.openings) if (o.roomId === r.id && o.wallIndex > index) o.wallIndex++;
        }), 'small'),
      ),
    );
  }
  return el;
}

function setWallLength(r: Room, index: number, L: number) {
  const n = r.points.length;
  const a = r.points[index];
  const b = r.points[(index + 1) % n];
  const d = { x: b.x - a.x, z: b.z - a.z };
  const l = Math.hypot(d.x, d.z) || 1;
  const nb = { x: a.x + (d.x / l) * L, z: a.z + (d.z / l) * L };
  const delta = { x: nb.x - b.x, z: nb.z - b.z };
  // For rectangles move the whole opposite side so the room stays square
  if (n === 4) {
    const j = (index + 2) % n;
    r.points[(index + 1) % n] = nb;
    r.points[j] = { x: r.points[j].x + delta.x, z: r.points[j].z + delta.z };
  } else r.points[(index + 1) % n] = nb;
}

export const OPENING_DEFAULTS: Record<OpeningType, { w: number; h: number; sill: number; label: string }> = {
  door: { w: 32 * IN, h: 80 * IN, sill: 0, label: 'Door' },
  'double-door': { w: 60 * IN, h: 80 * IN, sill: 0, label: 'Double / French door' },
  'sliding-door': { w: 72 * IN, h: 80 * IN, sill: 0, label: 'Sliding glass door' },
  window: { w: 36 * IN, h: 48 * IN, sill: 30 * IN, label: 'Window' },
  opening: { w: 48 * IN, h: 84 * IN, sill: 0, label: 'Open passage / archway' },
  'garage-door': { w: 16 * FT, h: 7 * FT, sill: 0, label: 'Garage door' },
};

export function addOpening(room: Room, wallIndex: number, type: OpeningType) {
  const w = roomWalls(room).find((q) => q.index === wallIndex);
  if (!w) return;
  const d = OPENING_DEFAULTS[type];
  const width = Math.min(d.w, w.length - 0.1);
  const o: Opening = { id: uid('op'), roomId: room.id, wallIndex, offset: w.length / 2, width, height: Math.min(d.h, room.wallHeight - d.sill - 0.05), sill: d.sill, type, flipHinge: false, flipSide: false, frameColor: '#ffffff' };
  store.update((p) => p.openings.push(o));
  store.select({ type: 'opening', id: o.id });
}

// ---------------------------------------------------------------------------

export function openingPanel(o: Opening): HTMLElement {
  const upd = (fn: (q: Opening) => void) =>
    store.update((p) => {
      const q = p.openings.find((x) => x.id === o.id);
      if (q) fn(q);
    });
  const room = store.room(o.roomId);
  const wall = room ? roomWalls(room).find((w) => w.index === o.wallIndex) : undefined;
  const isDoor = o.type === 'door' || o.type === 'double-door';
  return h(
    'div',
    { class: 'panel' },
    section(
      OPENING_DEFAULTS[o.type].label,
      field('Type', select<OpeningType>(o.type, Object.entries(OPENING_DEFAULTS).map(([k, v]) => [k as OpeningType, v.label]), (v) => upd((q) => {
        const d = OPENING_DEFAULTS[v];
        q.type = v;
        q.width = d.w;
        q.height = d.h;
        q.sill = d.sill;
      }))),
      h('div', { class: 'grid2' },
        field('Width', lengthInput(o.width, (v) => upd((q) => (q.width = v)), { min: 0.2 })),
        field('Height', lengthInput(o.height, (v) => upd((q) => (q.height = v)), { min: 0.2 })),
        field(o.type === 'window' ? 'Sill height' : 'Bottom height', lengthInput(o.sill, (v) => upd((q) => (q.sill = v)), { min: 0 })),
        field('From wall start', lengthInput(o.offset - o.width / 2, (v) => upd((q) => (q.offset = v + q.width / 2)), { min: 0, max: wall ? wall.length - o.width : 100 })),
      ),
      wall ? h('p', { class: 'hint' }, `On ${room!.name} · wall ${o.wallIndex + 1} (${fmt(wall.length)}). ${fmt(Math.max(0, wall.length - o.offset - o.width / 2))} to wall end. Drag it in the plan to move it along any wall.`) : null,
      isDoor ? row(checkbox(o.flipHinge, 'Flip hinge side', (v) => upd((q) => (q.flipHinge = v))), checkbox(o.flipSide, 'Swing out', (v) => upd((q) => (q.flipSide = v)))) : null,
      field('Trim / frame color', colorInput(o.frameColor, (c) => {
        const q = store.project.openings.find((x) => x.id === o.id);
        if (q) q.frameColor = c;
      }, ['#ffffff', '#f1ede4', '#2b2b2b', '#8b5e3c', '#5d7285'])),
      row(
        button('Center on wall', () => upd((q) => wall && (q.offset = wall.length / 2))),
        button('Delete', () => store.deleteSelection(), 'danger'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------

export function itemPanel(it: Item): HTMLElement {
  const upd = (fn: (q: Item) => void) =>
    store.update((p) => {
      const q = p.items.find((x) => x.id === it.id);
      if (q) fn(q);
    });
  const live = (fn: (q: Item) => void) => {
    const q = store.project.items.find((x) => x.id === it.id);
    if (q) fn(q);
  };
  const entry = catalogEntry(it.kind);
  const ceiling = isCeilingMounted(it.kind);
  const room = roomAt(store.project, { x: it.x, z: it.z });
  const root = h('div', { class: 'panel' });

  root.append(
    section(
      it.name,
      field('Name', h('input', { type: 'text', value: it.name, onchange: (e: Event) => upd((q) => (q.name = (e.target as HTMLInputElement).value)) })),
      h('div', { class: 'grid3' },
        field('Width', lengthInput(it.width, (v) => upd((q) => (q.width = v)), { min: 0.01 })),
        field('Depth', lengthInput(it.depth, (v) => upd((q) => (q.depth = v)), { min: 0.005 })),
        field('Height', lengthInput(it.height, (v) => upd((q) => (q.height = v)), { min: 0.005 })),
      ),
      entry?.widths
        ? h('div', { class: 'chips' }, h('span', { class: 'chips-label' }, 'Std widths:'), ...entry.widths.map((w) => button(`${w}"`, () => upd((q) => {
            q.width = w * IN;
            q.name = `${entry.name} ${w}"`;
          }), `chip ${Math.abs(it.width / IN - w) < 0.3 ? 'active' : ''}`)))
        : null,
      h('div', { class: 'grid2' },
        ceiling
          ? field('Hangs from ceiling', h('span', { class: 'readout' }, room ? `${fmt(ceilingHeightAt(room, it))} ceiling` : '—'))
          : field('Elevation (bottom)', lengthInput(it.y, (v) => upd((q) => (q.y = Math.max(0, v))), { min: 0 })),
        field('Rotation', numberInput(Math.round(((((it.rotation * 180) / Math.PI) % 360) + 360) % 360), (v) => upd((q) => (q.rotation = (v * Math.PI) / 180)), { step: 1 })),
      ),
      row(
        button('⟲ 90°', () => upd((q) => (q.rotation -= Math.PI / 2)), 'small'),
        button('⟳ 90°', () => upd((q) => (q.rotation += Math.PI / 2)), 'small'),
        button('⟳ 15°', () => upd((q) => (q.rotation += Math.PI / 12)), 'small'),
        button('Swap W/D', () => upd((q) => ([q.width, q.depth] = [q.depth, q.width])), 'small'),
      ),
      h('div', { class: 'grid2' },
        field('Position X', lengthInput(it.x, (v) => upd((q) => (q.x = v)))),
        field('Position Z', lengthInput(it.z, (v) => upd((q) => (q.z = v)))),
      ),
    ),
  );

  const swatches = it.category === 'kitchen' ? CABINET_SWATCHES : it.category === 'appliance' ? ['#c9ccd1', '#2b2b2b', '#f4f4f4', '#3b3f45', '#b08d57'] : ['#6f7d8c', '#a26b4f', '#8b5e3c', '#e8e4dc', '#3d3a36', '#2e4a3f', '#b85c4b', '#e0b25a', '#ffffff', '#222222'];
  const look = section(
    'Look',
    field('Main color', colorInput(it.color, (c) => live((q) => (q.color = c)), swatches)),
    field(it.category === 'kitchen' ? 'Handles' : 'Accent', colorInput(it.accent, (c) => live((q) => (q.accent = c)), ['#888888', '#2b2b2b', '#c8a45a', '#b87333', '#e0e0e0'])),
  );
  if (it.countertop !== undefined || it.category === 'kitchen' || it.kind === 'vanity') {
    look.append(
      checkbox(!!it.countertop, 'Countertop', (v) => upd((q) => {
        q.countertop = v;
        q.countertopColor ??= '#e9e6e1';
      })),
    );
    if (it.countertop || it.kind === 'island')
      look.append(field('Countertop', colorInput(it.countertopColor ?? '#e9e6e1', (c) => live((q) => (q.countertopColor = c)), ['#f2f0eb', '#e9e6e1', '#d9d4cc', '#9b9b98', '#2a2a2a', '#c49a6c', '#7a7f85'])));
  }
  if (it.shape !== 'model' && it.shape !== 'gltf') {
    look.append(
      field('Shape', select<ItemShape>(it.shape, [
        ['box', 'Box'],
        ['cylinder', 'Cylinder / round'],
        ['l-shape', 'L-shape'],
        ['footprint', 'Custom footprint'],
        ...(it.imageAsset ? ([['cutout', 'Photo cut-out']] as [ItemShape, string][]) : []),
      ], (v) => upd((q) => {
        q.shape = v;
        if (v === 'footprint' && !q.footprint) q.footprint = FOOTPRINTS['L-shape'].map((p) => ({ ...p }));
      }))),
    );
    if (it.shape === 'l-shape') look.append(field('Leg size', slider(it.legRatio ?? 0.4, 0.15, 0.85, 0.05, (v) => live((q) => (q.legRatio = v)), (v) => `${Math.round(v * 100)}%`)));
    if (it.shape === 'footprint') look.append(footprintEditor(it.footprint ?? FOOTPRINTS.rectangle, (pts) => upd((q) => (q.footprint = pts))));
  }
  root.append(look);

  if (it.light) {
    const L = it.light;
    root.append(
      section(
        'Light',
        checkbox(L.on, 'Light on', (v) => upd((q) => q.light && (q.light.on = v))),
        field('Brightness', slider(L.intensity, 0.5, 20, 0.5, (v) => live((q) => q.light && (q.light.intensity = v)))),
        field('Reach', lengthInput(L.range, (v) => upd((q) => q.light && (q.light.range = v)), { min: 0.5 })),
        field('Color temperature', h('div', { class: 'chips' }, ...[
          ['2700K warm', '#ffd7a3'],
          ['3000K soft', '#ffe2b8'],
          ['4000K neutral', '#fff1df'],
          ['5000K daylight', '#f4f7ff'],
        ].map(([l, c]) => button(l, () => upd((q) => q.light && (q.light.color = c)), `chip ${L.color === c ? 'active' : ''}`)))),
        select<'point' | 'spot'>(L.kind, [
          ['point', 'Omni (bulb)'],
          ['spot', 'Downlight (spot)'],
        ], (v) => upd((q) => q.light && (q.light.kind = v))),
      ),
    );
  }

  root.append(
    section(
      'Actions',
      row(
        checkbox(!!it.locked, 'Lock position', (v) => upd((q) => (q.locked = v))),
      ),
      row(
        button('Duplicate', () => duplicateItem(it), 'primary'),
        button('Save to My items', () => {
          addToLibrary(it);
          toast('Saved to My items');
        }),
        button('Delete', () => store.deleteSelection(), 'danger'),
      ),
      h('p', { class: 'hint' }, 'Tip: drag in plan or 3D (tap once to select, then drag). Hold Alt to disable snapping. R rotates, Del deletes, Ctrl+D duplicates.'),
    ),
  );
  return root;
}

export function duplicateItem(it: Item) {
  const copy: Item = { ...JSON.parse(JSON.stringify(it)), id: uid('item') };
  const dir = { x: Math.cos(it.rotation), z: Math.sin(it.rotation) };
  copy.x += dir.x * it.width;
  copy.z += dir.z * it.width;
  store.update((p) => p.items.push(copy));
  store.select({ type: 'item', id: copy.id });
}

// ---------------------------------------------------------------------------

export function settingsPanel(onAction: (a: string) => void): HTMLElement {
  const s = store.project.settings;
  const upd = (fn: (p: Project) => void) => store.update(fn);
  return h(
    'div',
    { class: 'panel' },
    section(
      'Project',
      field('Project name', h('input', { type: 'text', value: store.project.name, onchange: (e: Event) => upd((p) => (p.name = (e.target as HTMLInputElement).value)) })),
      h('div', { class: 'grid2' },
        field('Units', select(s.units, [
          ['imperial', 'Feet & inches'],
          ['metric', 'Metric'],
        ], (v) => upd((p) => {
          p.settings.units = v;
          p.settings.gridSize = v === 'imperial' ? 0.5 * FT : 0.1;
        }))),
        field('Snap grid', lengthInput(s.gridSize, (v) => upd((p) => (p.settings.gridSize = v)), { min: 0.005 })),
      ),
      checkbox(s.snap, 'Snap to grid', (v) => upd((p) => (p.settings.snap = v))),
      checkbox(s.snapToWalls, 'Snap cabinets & appliances to walls', (v) => upd((p) => (p.settings.snapToWalls = v))),
    ),
    section(
      'Display',
      checkbox(s.showDimensions, 'Show wall dimensions', (v) => upd((p) => (p.settings.showDimensions = v))),
      checkbox(s.showClearances, 'Show spacing around selected item', (v) => upd((p) => (p.settings.showClearances = v))),
      checkbox(s.showCeilings, 'Show ceilings in 3D overview', (v) => upd((p) => (p.settings.showCeilings = v))),
      checkbox(s.cutawayWalls, 'Cutaway walls facing the camera', (v) => upd((p) => (p.settings.cutawayWalls = v))),
      field('3D style', select(s.renderStyle, [
        ['realistic', 'Realistic'],
        ['drawing', 'Line drawing (white model)'],
      ], (v) => upd((p) => (p.settings.renderStyle = v)))),
      field('Time of day', slider(s.timeOfDay, 5, 21, 0.25, (v) => (store.project.settings.timeOfDay = v), (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`)),
      field('Sunlight', slider(s.sunIntensity, 0, 3, 0.1, (v) => (store.project.settings.sunIntensity = v))),
      field('Ambient light', slider(s.ambientIntensity, 0, 2, 0.05, (v) => (store.project.settings.ambientIntensity = v))),
      checkbox(document.documentElement.dataset.theme === 'dark', 'Dark interface', (v) => onAction(v ? 'theme-dark' : 'theme-light')),
    ),
    section(
      'File',
      row(button('💾 Export project', () => onAction('export')), button('📂 Open project file', () => onAction('import'))),
      row(button('📷 Save 3D snapshot', () => onAction('screenshot')), button('🖨️ Print plan', () => onAction('print'))),
      row(button('🏠 Templates…', () => onAction('templates')), button('🗑️ Clear all', () => onAction('clear'), 'danger')),
      h('p', { class: 'hint' }, 'Your design auto-saves in this browser. Export to move it to another device.'),
    ),
  );
}

export function emptyPanel(): HTMLElement {
  const p = store.project;
  const rooms = p.rooms;
  return h(
    'div',
    { class: 'panel' },
    section(
      'Your home',
      h('div', { class: 'stats' }, h('span', {}, `${rooms.length} rooms`), h('span', {}, `${p.items.length} items`), h('span', {}, formatArea(rooms.reduce((s, r) => s + area(r.points), 0), p.settings.units))),
      h('div', { class: 'room-list' }, ...rooms.map((r) => h('button', { class: 'room-chip', onclick: () => store.select({ type: 'room', id: r.id }) }, h('b', {}, r.name), h('span', {}, formatArea(area(r.points), p.settings.units))))),
      h('p', { class: 'hint' }, 'Tap a room, wall, door or item to edit it. Use “Draw room” to add rooms; snap them edge-to-edge to build a full floor plan.'),
    ),
  );
}

export { centroid };
