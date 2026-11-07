import { catalogEntry } from '../catalog';
import { centroid, pointInPolygon } from '../geometry';
import { ProjectError, type Item, type Vec2 } from '../model';
import { parseProjectFile } from '../projectFile';
import { hideBanner, showBanner } from './banner';
import { buildPrintDocument } from './print';
import { describeError } from './errors';
import { placeCatalogItem } from '../placement';
import { PlanEditor } from '../plan2d';
import { store, type CameraMode, type ViewMode } from '../state';
import { TEMPLATES } from '../templates';
import { Viewer } from '../three/viewer';
import { blobToDataUrl, dataUrlToBlob, storage } from '../storage';
import { button, download, h, modal, pickFile, toast } from './dom';
import { duplicateItem, emptyPanel, itemPanel, openingPanel, roomPanel, settingsPanel } from './inspector';
import { kitchenPanel } from './kitchenPanel';
import { setPlacementCenter } from './importers';
import { libraryPanel } from './library';
import { shortcutFor } from './shortcuts';

type RightTab = 'edit' | 'kitchen' | 'settings';
type MobileSheet = 'none' | 'left' | 'right';

export class App {
  private plan!: PlanEditor;
  private viewer!: Viewer;
  private left!: HTMLElement;
  private right!: HTMLElement;
  private rightTabs!: HTMLElement;
  private views!: HTMLElement;
  private planWrap!: HTMLElement;
  private threeWrap!: HTMLElement;
  private camBar!: HTMLElement;
  private viewSeg!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private nameEl!: HTMLElement;
  private rightTab: RightTab = 'edit';
  private sheet: MobileSheet = 'none';
  private mobileNav!: HTMLElement;
  private lastSelKey = '';

  constructor(private root: HTMLElement) {
    this.build();
    this.plan = new PlanEditor(this.planWrap);
    this.viewer = new Viewer(this.threeWrap);
    setPlacementCenter(() => this.placementPoint());
    store.subscribe((r) => this.onChange(r));
    window.addEventListener('library-changed', () => this.renderLeft());
    this.bindKeys();
    this.applyView();
    this.renderAll();
    if (matchMedia('(max-width: 820px)').matches && store.ui.view === 'split') store.setUI({ view: '3d' });
  }

  // -------------------------------------------------------------------------
  // Layout

  private build() {
    const theme = localStorage.getItem('hds-theme');
    if (theme) document.documentElement.dataset.theme = theme;

    this.undoBtn = button('↶', () => store.undo(), 'icon', 'Undo (Ctrl+Z)');
    this.redoBtn = button('↷', () => store.redo(), 'icon', 'Redo (Ctrl+Shift+Z)');
    this.nameEl = h('span', { class: 'project-name' }, store.project.name);
    const views: [ViewMode, string, string][] = [
      ['plan', '2D', 'Floor plan'],
      ['split', '⧉', 'Plan + 3D'],
      ['3d', '3D', '3D view'],
    ];
    this.viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, ...views.map(([v, l, t]) => h('button', { 'data-view': v, title: t, 'aria-label': t, onclick: () => store.setUI({ view: v }) }, l)));
    const header = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, '⌂'), h('span', { class: 'brand-name' }, 'Home Design Studio')),
      this.nameEl,
      h('div', { class: 'spacer' }),
      this.viewSeg,
      h('div', { class: 'btn-group' }, this.undoBtn, this.redoBtn),
      button('🏠', () => this.templatesModal(), 'icon hide-mobile', 'Templates / new project'),
      button('?', () => this.helpModal(), 'icon', 'Help'),
    );

    this.left = h('aside', { class: 'sidebar left', 'aria-label': 'Build and add items' });
    this.rightTabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Inspector' });
    this.right = h('div', { class: 'sidebar-body', role: 'tabpanel' });
    const rightAside = h('aside', { class: 'sidebar right', 'aria-label': 'Inspector' }, this.rightTabs, this.right);

    this.planWrap = h('div', { class: 'view plan-view' });
    this.planWrap.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('text/x-catalog')) e.preventDefault();
    });
    this.planWrap.addEventListener('drop', (e) => {
      const kind = e.dataTransfer?.getData('text/x-catalog');
      if (!kind) return;
      e.preventDefault();
      const r = this.planWrap.getBoundingClientRect();
      const p = this.plan.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.placeAt(kind, p);
    });
    const planBar = h(
      'div',
      { class: 'view-bar plan-bar' },
      button('−', () => this.plan.zoomBy(0.8), 'icon', 'Zoom out'),
      button('+', () => this.plan.zoomBy(1.25), 'icon', 'Zoom in'),
      button('⟲', () => this.plan.rotateView(-90), 'icon', 'Rotate plan 90° left'),
      button('⟳', () => this.plan.rotateView(90), 'icon', 'Rotate plan 90° right'),
      button('⤢', () => this.plan.fit(), 'icon', 'Fit plan'),
    );
    this.planWrap.append(planBar, h('div', { class: 'view-tag' }, 'PLAN'));

    this.threeWrap = h('div', { class: 'view three-view' });
    const cams: [CameraMode, string, string][] = [
      ['orbit', '🎥', 'Orbit (3D perspective)'],
      ['iso', '◇', 'Isometric'],
      ['top', '⊤', 'Top view'],
      ['front', '▭', 'Front elevation'],
      ['side', '▯', 'Side elevation'],
      ['walk', '🚶', 'Walk-through'],
    ];
    this.camBar = h(
      'div',
      { class: 'view-bar cam-bar' },
      h('div', { class: 'seg small', role: 'group', 'aria-label': 'Camera' }, ...cams.map(([m, l, t]) => h('button', { 'data-cam': m, title: t, 'aria-label': t, onclick: () => store.setUI({ camera: m }) }, h('span', { 'aria-hidden': 'true' }, l), h('small', {}, t.split(' ')[0])))),
      button('⟲', () => this.viewer.rotateView(-45), 'icon', 'Rotate view left'),
      button('⟳', () => this.viewer.rotateView(45), 'icon', 'Rotate view right'),
      button('⤢', () => this.viewer.zoomToFit(), 'icon', 'Fit'),
      button('✎', () => store.update((p) => (p.settings.renderStyle = p.settings.renderStyle === 'drawing' ? 'realistic' : 'drawing')), 'icon', 'Toggle line-drawing style'),
      button('📷', () => this.screenshot(), 'icon', 'Save image'),
    );
    this.threeWrap.append(this.camBar);

    this.actionBar = h('div', { class: 'action-bar hidden', role: 'toolbar', 'aria-label': 'Selected item' });
    this.views = h('main', { class: 'views' }, this.planWrap, this.threeWrap, this.actionBar);

    const navItems: [string, string, () => void][] = [
      ['＋', 'Add', () => this.toggleSheet('left')],
      ['✎', 'Edit', () => this.openRight('edit')],
      ['🍳', 'Kitchen', () => this.openRight('kitchen')],
      ['⚙', 'Settings', () => this.openRight('settings')],
    ];
    this.mobileNav = h('nav', { class: 'mobile-nav', 'aria-label': 'Panels' }, ...navItems.map(([i, l, fn]) => h('button', { onclick: fn, 'data-nav': l }, h('span', { 'aria-hidden': 'true' }, i), h('small', {}, l))));
    const scrim = h('div', { class: 'scrim', onclick: () => this.setSheet('none') });

    this.root.append(header, h('div', { class: 'workspace' }, this.left, this.views, rightAside), scrim, this.mobileNav);
  }

  private toggleSheet(s: MobileSheet) {
    this.setSheet(this.sheet === s ? 'none' : s);
  }

  private openRight(tab: RightTab) {
    if (this.sheet === 'right' && this.rightTab === tab) return this.setSheet('none');
    this.rightTab = tab;
    this.renderRight();
    this.setSheet('right');
  }

  private setSheet(s: MobileSheet) {
    this.sheet = s;
    document.body.dataset.sheet = s;
  }

  private applyView() {
    const v = store.ui.view;
    this.views.dataset.view = v;
    this.plan.setVisible(v !== '3d');
    this.viewer.setVisible(v !== 'plan');
    for (const b of this.viewSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === v);
    for (const b of this.camBar.querySelectorAll<HTMLButtonElement>('[data-cam]')) b.classList.toggle('active', b.dataset.cam === store.ui.camera);
  }

  // -------------------------------------------------------------------------
  // Rendering

  private onChange(reason: string) {
    if (reason === 'live') return;
    if (store.ui.camera === 'walk' && store.ui.view === 'plan') store.ui.view = 'split';
    if (this.viewerMode !== store.ui.camera) {
      this.viewerMode = store.ui.camera;
      this.viewer.setMode(store.ui.camera);
    }
    this.applyView();
    this.undoBtn.disabled = !store.canUndo;
    this.redoBtn.disabled = !store.canRedo;
    this.nameEl.textContent = store.project.name;
    const sel = store.ui.selection;
    const key = sel ? JSON.stringify(sel) : '';
    if (key !== this.lastSelKey) {
      this.lastSelKey = key;
      if (sel && this.rightTab === 'settings') this.rightTab = 'edit';
      this.mobileNav.querySelector('[data-nav="Edit"]')?.classList.toggle('dot', !!sel);
    }
    this.renderAll();
  }
  private viewerMode: CameraMode = 'orbit';
  private pendingRender = false;
  private actionBar!: HTMLElement;

  private renderAll() {
    this.renderLeft();
    this.renderRight();
    this.renderActionBar();
  }

  /** Quick actions for the selected item / opening, always visible over the views. */
  private renderActionBar() {
    const sel = store.ui.selection;
    const it = sel?.type === 'item' ? store.item(sel.id) : undefined;
    const op = sel?.type === 'opening' ? store.opening(sel.id) : undefined;
    const bar = this.actionBar;
    if ((!it && !op) || store.ui.camera === 'walk') {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const rotate = (d: number) =>
      store.update((p) => {
        const q = p.items.find((i) => i.id === it!.id);
        if (q) q.rotation += d;
      });
    const details = () => {
      this.rightTab = 'edit';
      this.renderRight();
      if (matchMedia('(max-width: 820px)').matches) this.setSheet('right');
    };
    const del = button(h('span', {}, '🗑', h('small', {}, 'Delete')), () => store.deleteSelection(), 'act danger', 'Delete (Del)');
    if (it) {
      bar.replaceChildren(
        h('div', { class: 'act-title' }, h('b', {}, it.name), h('small', {}, it.locked ? '🔒 locked' : 'drag to move')),
        button(h('span', {}, '⟲', h('small', {}, '90°')), () => rotate(-Math.PI / 2), 'act', 'Rotate left'),
        button(h('span', {}, '⟳', h('small', {}, '90°')), () => rotate(Math.PI / 2), 'act', 'Rotate right (R)'),
        button(h('span', {}, '⧉', h('small', {}, 'Copy')), () => duplicateItem(it), 'act', 'Duplicate (Ctrl+D)'),
        button(h('span', {}, it.locked ? '🔓' : '🔒', h('small', {}, it.locked ? 'Unlock' : 'Lock')), () => store.update((p) => {
          const q = p.items.find((i) => i.id === it.id);
          if (q) q.locked = !q.locked;
        }), 'act', 'Lock position'),
        button(h('span', {}, '✎', h('small', {}, 'Edit')), details, 'act', 'Size, color & more'),
        del,
        button('✕', () => store.select(null), 'act close', 'Deselect (Esc)'),
      );
    } else if (op) {
      bar.replaceChildren(
        h('div', { class: 'act-title' }, h('b', {}, op.type.replace('-', ' ')), h('small', {}, 'drag along a wall')),
        button(h('span', {}, '✎', h('small', {}, 'Edit')), details, 'act'),
        del,
        button('✕', () => store.select(null), 'act close', 'Deselect (Esc)'),
      );
    }
  }

  private renderLeft() {
    const scroll = this.left.scrollTop;
    this.left.replaceChildren(libraryPanel({ place: (k) => this.placeKind(k), center: () => this.placementPoint() }));
    this.left.scrollTop = scroll;
  }

  private renderRight() {
    const tabs: [RightTab, string][] = [
      ['edit', 'Edit'],
      ['kitchen', 'Kitchen'],
      ['settings', 'Settings'],
    ];
    this.rightTabs.replaceChildren(...tabs.map(([t, l]) => h('button', { class: this.rightTab === t ? 'active' : '', role: 'tab', 'aria-selected': String(this.rightTab === t), onclick: () => ((this.rightTab = t), this.renderRight()) }, l)));
    // don't rebuild while the user is typing in the panel
    const active = document.activeElement as HTMLElement | null;
    if (active && this.right.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && (active as HTMLInputElement).type !== 'range' && (active as HTMLInputElement).type !== 'checkbox' && (active as HTMLInputElement).type !== 'color') {
      if (!this.pendingRender) {
        this.pendingRender = true;
        active.addEventListener('focusout', () => setTimeout(() => {
          this.pendingRender = false;
          this.renderRight();
        }), { once: true });
      }
      return;
    }
    const scroll = this.right.scrollTop;
    let panel: HTMLElement;
    if (this.rightTab === 'kitchen') panel = kitchenPanel((k) => this.placeKind(k));
    else if (this.rightTab === 'settings') panel = settingsPanel((a) => this.action(a));
    else {
      const sel = store.ui.selection;
      if (sel?.type === 'item' && store.item(sel.id)) panel = itemPanel(store.item(sel.id)!);
      else if (sel?.type === 'opening' && store.opening(sel.id)) panel = openingPanel(store.opening(sel.id)!);
      else if (sel?.type === 'room' && store.room(sel.id)) panel = roomPanel(store.room(sel.id)!);
      else if (sel?.type === 'wall' && store.room(sel.roomId)) panel = roomPanel(store.room(sel.roomId)!, sel.index);
      else panel = emptyPanel();
    }
    const close = h('button', { class: 'sheet-close', onclick: () => this.setSheet('none') }, 'Done');
    this.right.replaceChildren(close, panel);
    this.right.scrollTop = scroll;
    if (store.ui.selection?.type === 'wall') this.right.querySelector('.wall-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  // -------------------------------------------------------------------------
  // Placement

  private placementPoint(): Vec2 {
    const room = store.selectedRoom();
    if (room) return centroid(room.points);
    if (store.ui.view === '3d' && store.project.rooms[0]) return centroid(store.project.rooms[0].points);
    return this.plan.center();
  }

  private placeKind(kind: string) {
    this.placeAt(kind, this.placementPoint());
    if (matchMedia('(max-width: 820px)').matches) this.setSheet('none');
  }

  private placeAt(kind: string, p: Vec2) {
    let created: Item | null = null;
    store.update((proj) => {
      created = placeCatalogItem(proj, kind, p.x, p.z);
      if (created) proj.items.push(created);
    });
    if (created) {
      store.select({ type: 'item', id: (created as Item).id });
      toast(`Added ${catalogEntry(kind)?.name ?? kind} — drag to position`, 1600);
    }
  }

  // -------------------------------------------------------------------------
  // Actions

  private async action(a: string) {
    switch (a) {
      case 'theme-dark':
      case 'theme-light': {
        const t = a === 'theme-dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = t;
        localStorage.setItem('hds-theme', t);
        store.setUI({});
        break;
      }
      case 'export':
        await this.exportProject();
        break;
      case 'import':
        await this.importProject();
        break;
      case 'screenshot':
        this.screenshot();
        break;
      case 'print':
        this.printPlan();
        break;
      case 'templates':
        this.templatesModal();
        break;
      case 'clear':
        if (confirm('Remove all rooms and items?')) store.update((p) => ((p.rooms = []), (p.openings = []), (p.items = [])));
        break;
    }
  }

  private async exportProject() {
    // bundle assets (photos, models) so the file is self-contained
    const p = store.project;
    const ids = new Set<string>();
    for (const it of p.items) {
      if (it.imageAsset) ids.add(it.imageAsset);
      if (it.modelAsset) ids.add(it.modelAsset);
    }
    for (const r of p.rooms) if (r.floor.imageAsset) ids.add(r.floor.imageAsset);
    const assets: Record<string, string> = {};
    for (const id of ids) {
      const b = await storage.getAsset(id);
      if (b) assets[id] = await blobToDataUrl(b);
    }
    const data = JSON.stringify({ app: 'home-design-studio', project: p, assets }, null, 1);
    download(`${(p.name || 'home').replace(/[^\w-]+/g, '_')}.home.json`, new Blob([data], { type: 'application/json' }));
  }

  private async importProject() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    let parsed;
    try {
      parsed = parseProjectFile(await f.text());
    } catch (e) {
      const problems = e instanceof ProjectError ? e.problems : [String((e as Error)?.message ?? e)];
      const list = h('ul', {}, ...problems.slice(0, 12).map((t) => h('li', {}, t)));
      modal('Could not open that file', h('div', {}, h('p', {}, `“${f.name}” was not opened and your current design is unchanged.`), list));
      return;
    }
    const { project, assets } = parsed;
    const msg = store.project.rooms.length || store.project.items.length
      ? `Replace the current design “${store.project.name}” with “${project.name}” (${project.rooms.length} rooms, ${project.items.length} items)? Export first if you want to keep the current one.`
      : `Open “${project.name}”?`;
    if (!confirm(msg)) return;
    try {
      for (const [id, url] of Object.entries(assets)) await storage.putAsset(id, await dataUrlToBlob(url));
    } catch (e) {
      showBanner('import', `Photos/models from the file could not be stored (${describeError(e)}). The design was not replaced.`, [{ label: 'Dismiss', run: () => hideBanner('import') }]);
      return;
    }
    store.load(project);
    this.plan.fit();
    this.viewer.zoomToFit();
    toast('Project opened');
  }

  private screenshot() {
    if (store.ui.view === 'plan') return download('plan.png', this.plan.snapshot());
    download('home-3d.png', this.viewer.screenshot());
  }

  private printPlan() {
    const url = this.plan.snapshot();
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print the plan');
    buildPrintDocument(w.document, store.project.name, url);
  }

  templatesModal() {
    const body = h(
      'div',
      { class: 'template-grid' },
      ...TEMPLATES.map((t) =>
        h('button', {
          class: 'template',
          onclick: () => {
            if (store.project.rooms.length && !confirm('Replace the current design? (Export it first if you want to keep it.)')) return;
            store.load(t.make());
            m.close();
            setTimeout(() => {
              this.plan.fit();
              this.viewer.zoomToFit();
            }, 50);
          },
        }, h('b', {}, t.name), h('span', {}, t.desc)),
      ),
    );
    const m = modal('Start a design', body);
  }

  helpModal() {
    const body = h('div', { class: 'help' });
    body.innerHTML = `
      <h4>Build your floor plan</h4>
      <ul>
        <li><b>Draw room</b> – drag a rectangle; <b>Draw shape</b> – tap corners for L-shaped or angled rooms. Or use <b>+ Add room</b> with exact sizes.</li>
        <li>Drag <b>corners</b> or <b>walls</b> to resize. Select a room and drag inside it to move it — corners snap to neighbouring rooms so walls join.</li>
        <li>Select a wall to set its length, accent color, or add <b>doors, windows, openings</b>. Drag doors along walls.</li>
        <li>Room panel: wall height, thickness, colors, <b>sloped / vaulted / tray ceilings</b>, flooring (or import your own pattern).</li>
      </ul>
      <h4>Furnish</h4>
      <ul>
        <li>Tap catalog items to add them. <b>Press and drag any piece to move it</b> (plan or 3D). Tapping a piece shows a bar to rotate, copy, lock or <b>delete</b> it. Tap again to reach a piece stacked underneath (e.g. a cabinet below a wall cabinet). Cabinets and appliances snap to walls and to each other.</li>
        <li><b>Import from photo</b>: remove the background, set real dimensions, and choose a shape (box, cut-out, cylinder, L, or draw a custom footprint).</li>
        <li><b>Import 3D models</b> (.glb/.obj) from manufacturers for exact fixtures and appliances.</li>
        <li>Red dimension lines show the <b>space to walls and other items</b>; blue lines show height above floor / below ceiling.</li>
      </ul>
      <h4>Kitchen</h4>
      <ul><li>The Kitchen tab generates single-wall, L, U, galley and island layouts with appliances, then checks the work triangle, landing areas, aisle widths and backsplash height.</li></ul>
      <h4>View</h4>
      <ul>
        <li>3D views: <b>Orbit, Isometric, Top, Front, Side</b> — drag to rotate, pinch/scroll to zoom, ⟲⟳ to rotate in steps. ✎ toggles a clean line-drawing style.</li>
        <li><b>Walk</b>: WASD/arrow keys + mouse on desktop, joystick + drag on phones. Double-click a floor in 3D to start walking there.</li>
      </ul>
      <h4>Shortcuts</h4>
      <p><kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo · <kbd>Del</kbd> delete · <kbd>R</kbd> rotate 90° (<kbd>Shift</kbd> 15°) · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · arrows nudge · <kbd>Alt</kbd> while dragging disables snapping · <kbd>Esc</kbd> deselect</p>`;
    modal('How to use Home Design Studio', body);
  }

  // -------------------------------------------------------------------------

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.modal-overlay')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (store.ui.camera === 'walk') return;
      const it = store.selectedItem();
      if (mod && e.key.toLowerCase() === 'd' && it) {
        e.preventDefault();
        duplicateItem(it);
        return;
      }
      const action = shortcutFor(e, it);
      if (action === 'locked') {
        toast('This item is locked – unlock it to move, rotate or delete');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selection && store.ui.tool !== 'room-poly') {
        e.preventDefault();
        if (store.ui.selection.type === 'wall') return;
        store.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        store.setUI({ placing: null, tool: 'select' });
        store.select(null);
        return;
      }
      if (action === 'rotate' && it) {
        store.update((p) => {
          const q = p.items.find((i) => i.id === it.id);
          if (q) q.rotation += e.shiftKey ? Math.PI / 12 : Math.PI / 2;
        });
        return;
      }
      if (action === 'nudge' && it) {
        e.preventDefault();
        const step = (e.shiftKey ? 12 : 1) * (store.project.settings.units === 'imperial' ? 0.0254 : 0.01);
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]!;
        store.update((p) => {
          const q = p.items.find((i) => i.id === it.id);
          if (q) {
            q.x += d[0] * step;
            q.z += d[1] * step;
          }
        });
      }
    });
  }
}

export function isInRoom(it: Item) {
  return store.project.rooms.some((r) => pointInPolygon({ x: it.x, z: it.z }, r.points));
}
