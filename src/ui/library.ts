import { CATALOG, CATEGORY_LABELS } from '../catalog';
import { bounds } from '../geometry';
import { createRoom, FT, rectPoints, type ItemCategory } from '../model';
import { store, type Tool } from '../state';
import { button, field, h, lengthInput, section } from './dom';
import { traceSection } from './trace';
import { loadLibrary, openModelImport, openPhotoImport, placeLibraryEntry, saveLibrary } from './importers';

let filter = '';
let openCats = new Set<string>(['furniture']);
let newRoom = { w: 12 * FT, d: 12 * FT };

export function libraryPanel(opts: { place: (kind: string) => void; center: () => { x: number; z: number } }): HTMLElement {
  const root = h('div', { class: 'panel library' });
  const tools: [Tool, string, string][] = [
    ['select', '👆', 'Select / move'],
    ['room-rect', '▭', 'Draw room'],
    ['room-poly', '⬠', 'Draw shape'],
    ['measure', '📏', 'Measure'],
  ];
  root.append(
    section(
      'Build',
      h('div', { class: 'tool-grid' }, ...tools.map(([t, icon, label]) => h('button', { class: `tool ${store.ui.tool === t ? 'active' : ''}`, onclick: () => store.setUI({ tool: t, placing: null }), title: label }, h('span', {}, icon), h('small', {}, label)))),
      store.ui.tool === 'room-rect' ? h('p', { class: 'hint' }, store.project.underlay?.visible && store.project.underlay.snap ? 'Drag from corner to corner of a room on the traced plan – corners snap to its walls and to rooms you already drew.' : 'Drag on the plan to draw a rectangular room. Corners snap to the grid and other rooms.') : null,
      store.ui.tool === 'room-poly' ? h('p', { class: 'hint' }, 'Tap to add corners. Tap the first point, double-click or press Enter to finish. Backspace removes the last point.') : null,
      store.ui.tool === 'measure' ? h('p', { class: 'hint' }, 'Drag between two points to measure.') : null,
      h('div', { class: 'quick-room' },
        field('W', lengthInput(newRoom.w, (v) => (newRoom.w = v), { min: 0.5 })),
        field('L', lengthInput(newRoom.d, (v) => (newRoom.d = v), { min: 0.5 })),
        button('+ Add room', () => addRoomBySize(), 'primary'),
      ),
      h('p', { class: 'hint' }, 'New rooms are placed next to your plan — drag to snap them together.'),
    ),
  );

  root.append(traceSection(opts.center));

  root.append(
    section(
      'Import your own',
      h('div', { class: 'import-buttons' },
        button('🖼️ Furniture from photo', () => openPhotoImport(false)),
        button('📷 Take a photo', () => openPhotoImport(true)),
        button('🧊 3D model (.glb / .obj)', () => openModelImport()),
      ),
    ),
  );

  const lib = loadLibrary();
  if (lib.length) {
    root.append(
      section(
        'My items',
        h('div', { class: 'catalog-grid' }, ...lib.map((e) =>
          h('div', { class: 'cat-item mine' },
            h('button', { class: 'cat-main', onclick: () => placeLibraryEntry(e, opts.center()) }, h('span', { class: 'cat-icon' }, e.imageAsset ? '🖼️' : e.modelAsset ? '🧊' : '⬜'), h('span', { class: 'cat-name' }, e.name)),
            h('button', { class: 'cat-remove', title: 'Remove from library', onclick: () => saveLibrary(loadLibrary().filter((x) => x.libId !== e.libId)) }, '×'),
          ),
        )),
      ),
    );
  }

  const search = h('input', { type: 'search', placeholder: 'Search furniture, fixtures, appliances…', value: filter, class: 'search' });
  const list = h('div', {});
  const renderList = () => {
    list.replaceChildren();
    const q = filter.trim().toLowerCase();
    for (const [cat, label] of Object.entries(CATEGORY_LABELS) as [ItemCategory, string][]) {
      const entries = CATALOG.filter((c) => c.category === cat && (!q || c.name.toLowerCase().includes(q) || c.kind.includes(q)));
      if (!entries.length) continue;
      const open = !!q || openCats.has(cat);
      const head = h('button', { class: `cat-head ${open ? 'open' : ''}`, onclick: () => {
        if (openCats.has(cat)) openCats.delete(cat);
        else openCats.add(cat);
        renderList();
      } }, h('span', {}, label), h('span', { class: 'count' }, String(entries.length)));
      list.append(head);
      if (open) {
        list.append(
          h('div', { class: 'catalog-grid' }, ...entries.map((e) => {
            const b = h('button', {
              class: `cat-item ${store.ui.placing === e.kind ? 'active' : ''}`,
              draggable: true,
              title: `${e.name} · ${e.w}" W × ${e.d}" D × ${e.h}" H`,
              onclick: () => opts.place(e.kind),
            }, h('span', { class: 'cat-icon' }, e.icon), h('span', { class: 'cat-name' }, e.name), h('span', { class: 'cat-size' }, `${e.w}×${e.d}"`));
            b.addEventListener('dragstart', (ev) => {
              ev.dataTransfer?.setData('text/x-catalog', e.kind);
              ev.dataTransfer!.effectAllowed = 'copy';
            });
            return b;
          })),
        );
      }
    }
  };
  search.addEventListener('input', () => {
    filter = search.value;
    renderList();
  });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  renderList();
  root.append(section('Catalog', search, list, h('p', { class: 'hint' }, 'Tap to add (it lands in the selected room), or drag onto the plan.')));
  return root;
}

function addRoomBySize() {
  const pts = store.project.rooms.flatMap((r) => r.points);
  let x = 0;
  let z = 0;
  if (pts.length) {
    const b = bounds(pts);
    x = b.maxX;
    z = b.minZ;
  }
  const room = createRoom(`Room ${store.project.rooms.length + 1}`, rectPoints(x, z, newRoom.w, newRoom.d));
  const prev = store.project.rooms[store.project.rooms.length - 1];
  if (prev) {
    room.wallHeight = prev.wallHeight;
    room.wallThickness = prev.wallThickness;
  }
  store.update((p) => p.rooms.push(room));
  store.select({ type: 'room', id: room.id });
}

export function resetLibraryState() {
  openCats = new Set(['furniture']);
}
