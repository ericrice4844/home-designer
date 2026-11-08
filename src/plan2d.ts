import { catalogEntry } from './catalog';
import {
  add,
  area,
  bounds,
  centroid,
  closestPointOnSegment,
  dist,
  dot,
  itemClearances,
  itemCorners,
  itemLocalOutline,
  openingFrame,
  pointInItem,
  pointInPolygon,
  roomWalls,
  rotate,
  scale,
  snapValue,
  sub,
} from './geometry';
import { createRoom, rectPoints, type Item, type Room, type Vec2 } from './model';
import { moveItem, placeCatalogItem } from './placement';
import { clampRoomOpenings, finishPolygon } from './edits';
import { getStyle } from './itemStyles';
import { store } from './state';
import { pixelToWorld, snapToLines, worldToPixel } from './underlay';
import { loadPlanImage, planImages } from './planImage';
import { toast } from './ui/dom';
import { formatArea, formatLength } from './units';

export type Drag =
  | { kind: 'pan'; start: Vec2; c0: Vec2 }
  | { kind: 'item'; id: string; offset: Vec2; moved: boolean; cycle: boolean; at: Vec2; locked: boolean }
  | { kind: 'rotate'; id: string }
  | { kind: 'resize'; id: string; corner: number; anchor: Vec2 }
  | { kind: 'vertex'; roomId: string; index: number }
  | { kind: 'wall'; roomId: string; index: number; start: Vec2; a0: Vec2; b0: Vec2 }
  | { kind: 'room'; roomId: string; start: Vec2; pts0: Vec2[]; items0: { id: string; x: number; z: number }[] }
  | { kind: 'opening'; id: string }
  | { kind: 'rect'; start: Vec2; end: Vec2 }
  | { kind: 'measure'; start: Vec2; end: Vec2 }
  | { kind: 'calib'; tool: 'calibrate' | 'check-dim'; start: Vec2; end: Vec2 }
  | { kind: 'move-plan'; start: Vec2; x0: number; z0: number };

export class PlanEditor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view = { cx: 3, cz: 3, zoom: 60, angle: 0 };
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; zoom0: number; a0: number; angle0: number; mid: Vec2 } | null = null;
  private poly: Vec2[] = [];
  private hover: Vec2 | null = null;
  private measure: { a: Vec2; b: Vec2 } | null = null;
  /** Called when a calibration / check line has been drawn on the traced plan. */
  onTwoPoints: ((tool: 'calibrate' | 'check-dim', a: Vec2, b: Vec2) => void) | null = null;
  private calibLine: { a: Vec2; b: Vec2 } | null = null;
  private dirty = true;
  private fitted = false;
  private visible = true;

  constructor(container: HTMLElement) {
    this.el = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Floor plan editor. Use the panels to edit rooms and items.');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(container);
    this.bind();
    store.subscribe((r) => {
      if (r === 'load' && !this.fitted) this.fit();
      if (store.ui.tool !== 'room-poly') this.poly = [];
      this.dirty = true;
    });
    const loop = () => {
      if (this.dirty && this.visible) {
        this.dirty = false;
        this.draw();
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v) this.resize();
  }

  // -------------------------------------------------------------------------
  // Transforms

  private get W() {
    return this.canvas.clientWidth;
  }
  private get H() {
    return this.canvas.clientHeight;
  }

  toScreen(p: Vec2): { x: number; y: number } {
    const r = rotate(sub(p, { x: this.view.cx, z: this.view.cz }), this.view.angle);
    return { x: this.W / 2 + r.x * this.view.zoom, y: this.H / 2 + r.z * this.view.zoom };
  }

  toWorld(x: number, y: number): Vec2 {
    const local = { x: (x - this.W / 2) / this.view.zoom, z: (y - this.H / 2) / this.view.zoom };
    return add(rotate(local, -this.view.angle), { x: this.view.cx, z: this.view.cz });
  }

  /** World point at the center of the visible plan. */
  center(): Vec2 {
    return { x: this.view.cx, z: this.view.cz };
  }

  /** Render the plan to a PNG data URL (for printing / sharing). */
  snapshot(): string {
    this.draw();
    return this.canvas.toDataURL('image/png');
  }

  rotateView(deg: number) {
    this.view.angle += (deg * Math.PI) / 180;
    this.dirty = true;
  }

  zoomBy(f: number) {
    this.view.zoom = Math.max(8, Math.min(600, this.view.zoom * f));
    this.dirty = true;
  }

  fit() {
    const pts = store.project.rooms.flatMap((r) => r.points);
    if (!pts.length || !this.W) return;
    this.fitted = true;
    const b = bounds(pts);
    this.view.cx = (b.minX + b.maxX) / 2;
    this.view.cz = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX + 2;
    const h = b.maxZ - b.minZ + 2;
    this.view.zoom = Math.max(10, Math.min(300, Math.min(this.W / w, this.H / h)));
    this.dirty = true;
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h) return;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.fitted) this.fit();
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Snapping

  private snapPoint(p: Vec2, excludeRoom?: string, excludeIndex?: number): Vec2 {
    const s = store.project.settings;
    const tol = 10 / this.view.zoom;
    for (const r of store.project.rooms) {
      for (let i = 0; i < r.points.length; i++) {
        if (r.id === excludeRoom && i === excludeIndex) continue;
        if (dist(r.points[i], p) < tol) return { ...r.points[i] };
      }
    }
    // tracing a plan: snap to the centerline of the plan's wall strokes instead of the grid
    const u = store.project.underlay;
    if (u?.visible && u.snap) {
      const plan = planImages.get(u.assetId);
      if (plan?.mask) {
        const px = worldToPixel(u, p);
        const radiusPx = 10 / this.view.zoom / Math.min(u.scaleX, u.scaleZ);
        const snapped = snapToLines(plan.mask, px, radiusPx);
        return pixelToWorld(u, { x: snapped.x ?? px.x, y: snapped.y ?? px.y });
      }
      return p;
    }
    if (!s.snap) return p;
    return { x: snapValue(p.x, s.gridSize), z: snapValue(p.z, s.gridSize) };
  }

  // -------------------------------------------------------------------------
  // Hit testing

  private hitItemHandle(sx: number, sy: number): { kind: 'rotate' | 'resize'; corner?: number } | null {
    const it = store.selectedItem();
    if (!it || it.locked) return null;
    const corners = itemCorners(it).map((c) => this.toScreen(c));
    for (let i = 0; i < 4; i++) if (Math.hypot(corners[i].x - sx, corners[i].y - sy) < 11) return { kind: 'resize', corner: i };
    const rh = this.rotateHandlePos(it);
    if (Math.hypot(rh.x - sx, rh.y - sy) < 13) return { kind: 'rotate' };
    return null;
  }

  private rotateHandlePos(it: Item) {
    const front = add(rotate({ x: 0, z: it.depth / 2 }, it.rotation), { x: it.x, z: it.z });
    const s = this.toScreen(front);
    const c = this.toScreen({ x: it.x, z: it.z });
    const dx = s.x - c.x;
    const dy = s.y - c.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: s.x + (dx / l) * 24, y: s.y + (dy / l) * 24 };
  }

  /** Items under a point, smallest first (so lamps on tables / cabinets above counters are reachable). */
  private hitItems(p: Vec2): Item[] {
    const pad = 4 / this.view.zoom; // a few pixels of slack makes small items easier to tap
    const hits = store.project.items.filter((it) => pointInItem(p, { ...it, width: it.width + pad * 2, depth: it.depth + pad * 2 }));
    hits.sort((a, b) => a.width * a.depth - b.width * b.depth);
    return hits;
  }

  private hitItem(p: Vec2): Item | undefined {
    const hits = this.hitItems(p);
    const sel = store.selectedItem();
    // keep the current selection when it is one of the candidates
    return hits.find((h) => h.id === sel?.id) ?? hits[0];
  }

  private hitOpening(p: Vec2) {
    for (const o of store.project.openings) {
      const f = openingFrame(store.project, o);
      if (!f) continue;
      const a = add(f.center, scale(f.wall.dir, -o.width / 2));
      const b = add(f.center, scale(f.wall.dir, o.width / 2));
      if (closestPointOnSegment(p, a, b).dist < Math.max(f.room.wallThickness, 12 / this.view.zoom)) return o;
    }
    return undefined;
  }

  private hitVertex(p: Vec2) {
    const tol = 9 / this.view.zoom;
    const sel = store.ui.selection;
    const rooms = [...store.project.rooms].sort((a) => (sel && 'id' in sel && sel.id === a.id ? -1 : 0));
    for (const r of rooms) for (let i = 0; i < r.points.length; i++) if (dist(r.points[i], p) < tol) return { room: r, index: i };
    return undefined;
  }

  private hitWall(p: Vec2) {
    let best: { room: Room; index: number; d: number } | undefined;
    for (const r of store.project.rooms) {
      for (const w of roomWalls(r)) {
        const d = closestPointOnSegment(p, w.a, w.b).dist;
        if (d < Math.max(r.wallThickness / 2 + 2 / this.view.zoom, 8 / this.view.zoom) && (!best || d < best.d)) best = { room: r, index: w.index, d };
      }
    }
    return best;
  }

  private hitRoom(p: Vec2): Room | undefined {
    let best: Room | undefined;
    let ba = Infinity;
    for (const r of store.project.rooms) {
      if (r.points.length > 2 && pointInPolygon(p, r.points)) {
        const a = area(r.points);
        if (a < ba) {
          ba = a;
          best = r;
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Events

  private bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.toWorld(e.offsetX, e.offsetY);
      if (e.ctrlKey || !e.shiftKey) this.zoomBy(Math.exp(-e.deltaY * 0.0015));
      const after = this.toWorld(e.offsetX, e.offsetY);
      this.view.cx += before.x - after.x;
      this.view.cz += before.z - after.z;
      this.dirty = true;
    }, { passive: false });

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 2) {
        // start pinch, cancel any drag
        if (this.drag && dragNeedsCommit(this.drag.kind)) store.commit();
        this.drag = null;
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          zoom0: this.view.zoom,
          a0: Math.atan2(b.y - a.y, b.x - a.x),
          angle0: this.view.angle,
          mid: this.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2),
        };
        return;
      }
      this.onDown(e);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.view.zoom = Math.max(8, Math.min(600, (this.pinch.zoom0 * d) / this.pinch.d0));
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (store.project.settings && Math.abs(ang - this.pinch.a0) > 0.12) this.view.angle = this.pinch.angle0 + (ang - this.pinch.a0);
        // keep pinch midpoint fixed
        const midNow = this.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.view.cx += this.pinch.mid.x - midNow.x;
        this.view.cz += this.pinch.mid.z - midNow.z;
        this.dirty = true;
        return;
      }
      this.onMove(e);
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        return;
      }
      this.onUp(e);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.dirty = true;
    });
    cv.addEventListener('dblclick', () => {
      if (store.ui.tool === 'room-poly') this.finishPoly();
    });
    window.addEventListener('keydown', (e) => {
      if (store.ui.tool === 'room-poly') {
        if (e.key === 'Enter') this.finishPoly();
        if (e.key === 'Escape') {
          this.poly = [];
          store.setUI({ tool: 'select' });
        }
        if (e.key === 'Backspace' && this.poly.length) {
          this.poly.pop();
          this.dirty = true;
          e.preventDefault();
        }
      }
    });
  }

  private onDown(e: PointerEvent) {
    const p = this.toWorld(e.offsetX, e.offsetY);
    const ui = store.ui;
    const middle = e.button === 1 || e.button === 2;
    if (middle || ui.tool === 'pan') {
      this.drag = { kind: 'pan', start: { x: e.offsetX, z: e.offsetY }, c0: { x: this.view.cx, z: this.view.cz } };
      return;
    }
    if (ui.placing) {
      const kind = ui.placing;
      let created: Item | null = null;
      store.update((proj) => {
        created = placeCatalogItem(proj, kind, p.x, p.z);
        if (created) proj.items.push(created);
      });
      store.setUI({ placing: null });
      if (created) store.select({ type: 'item', id: (created as Item).id });
      return;
    }
    if (ui.tool === 'room-rect') {
      const s = this.snapPoint(p);
      this.drag = { kind: 'rect', start: s, end: s };
      return;
    }
    if (ui.tool === 'room-poly') {
      const s = this.snapPoint(p);
      if (this.poly.length >= 3 && dist(s, this.poly[0]) < 12 / this.view.zoom) this.finishPoly();
      else this.poly.push(s);
      this.dirty = true;
      return;
    }
    if (ui.tool === 'measure') {
      const s = this.snapPoint(p);
      this.drag = { kind: 'measure', start: s, end: s };
      return;
    }
    if (ui.tool === 'calibrate' || ui.tool === 'check-dim') {
      const s = this.snapPoint(p);
      this.calibLine = null;
      this.drag = { kind: 'calib', tool: ui.tool, start: s, end: s };
      return;
    }
    if (ui.tool === 'move-plan') {
      const u = store.project.underlay;
      if (u && !u.locked) this.drag = { kind: 'move-plan', start: p, x0: u.x, z0: u.z };
      return;
    }
    // select tool
    const handle = this.hitItemHandle(e.offsetX, e.offsetY);
    const sel = store.selectedItem();
    if (handle && sel) {
      if (handle.kind === 'rotate') this.drag = { kind: 'rotate', id: sel.id };
      else {
        const corners = itemCorners(sel);
        this.drag = { kind: 'resize', id: sel.id, corner: handle.corner!, anchor: corners[(handle.corner! + 2) % 4] };
      }
      return;
    }
    const it = this.hitItem(p);
    if (it) {
      const wasSelected = store.selectedItem()?.id === it.id;
      store.select({ type: 'item', id: it.id });
      this.drag = { kind: 'item', id: it.id, offset: { x: it.x - p.x, z: it.z - p.z }, moved: false, cycle: wasSelected, at: p, locked: !!it.locked };
      return;
    }
    const op = this.hitOpening(p);
    if (op) {
      store.select({ type: 'opening', id: op.id });
      this.drag = { kind: 'opening', id: op.id };
      return;
    }
    const v = this.hitVertex(p);
    if (v) {
      store.select({ type: 'room', id: v.room.id });
      this.drag = { kind: 'vertex', roomId: v.room.id, index: v.index };
      return;
    }
    const w = this.hitWall(p);
    if (w) {
      store.select({ type: 'wall', roomId: w.room.id, index: w.index });
      const a = w.room.points[w.index];
      const b = w.room.points[(w.index + 1) % w.room.points.length];
      this.drag = { kind: 'wall', roomId: w.room.id, index: w.index, start: p, a0: { ...a }, b0: { ...b } };
      return;
    }
    const r = this.hitRoom(p);
    const selS = store.ui.selection;
    if (r && selS?.type === 'room' && selS.id === r.id) {
      // drag the whole room (and the items inside it)
      const items0 = store.project.items.filter((i) => pointInPolygon({ x: i.x, z: i.z }, r.points)).map((i) => ({ id: i.id, x: i.x, z: i.z }));
      this.drag = { kind: 'room', roomId: r.id, start: p, pts0: r.points.map((q) => ({ ...q })), items0 };
      return;
    }
    if (r) store.select({ type: 'room', id: r.id });
    else store.select(null);
    this.drag = { kind: 'pan', start: { x: e.offsetX, z: e.offsetY }, c0: { x: this.view.cx, z: this.view.cz } };
  }

  private onMove(e: PointerEvent) {
    const p = this.toWorld(e.offsetX, e.offsetY);
    this.hover = p;
    const d = this.drag;
    this.dirty = true;
    if (!d) {
      this.updateCursor(e);
      return;
    }
    switch (d.kind) {
      case 'pan': {
        const dx = (e.offsetX - d.start.x) / this.view.zoom;
        const dy = (e.offsetY - d.start.z) / this.view.zoom;
        const w = rotate({ x: dx, z: dy }, -this.view.angle);
        this.view.cx = d.c0.x - w.x;
        this.view.cz = d.c0.z - w.z;
        break;
      }
      case 'item':
        if (d.locked) break;
        if (!d.moved && dist(p, d.at) * this.view.zoom < 4) break; // ignore jitter so taps stay taps
        d.moved = true;
        store.live((proj) => {
          const it = proj.items.find((i) => i.id === d.id);
          if (it) moveItem(proj, it, p.x + d.offset.x, p.z + d.offset.z, { noSnap: e.altKey });
        }, 'items');
        break;
      case 'rotate':
        store.live((proj) => {
          const it = proj.items.find((i) => i.id === d.id);
          if (!it) return;
          let a = Math.atan2(p.z - it.z, p.x - it.x) - Math.PI / 2;
          if (!e.altKey) a = snapValue(a, Math.PI / (e.shiftKey ? 4 : 12));
          it.rotation = a;
        }, 'items');
        break;
      case 'resize':
        store.live((proj) => {
          const it = proj.items.find((i) => i.id === d.id);
          if (!it) return;
          const local = rotate(sub(p, d.anchor), -it.rotation);
          let w = Math.max(0.05, Math.abs(local.x));
          let dd = Math.max(0.05, Math.abs(local.z));
          const s = proj.settings;
          if (s.snap && !e.altKey) {
            const step = s.units === 'imperial' ? 0.0254 : 0.01;
            w = snapValue(w, step);
            dd = snapValue(dd, step);
          }
          if (e.shiftKey) {
            const ratio = it.width / it.depth;
            dd = w / ratio;
          }
          const sx = Math.sign(local.x) || 1;
          const sz = Math.sign(local.z) || 1;
          const centerLocal = { x: (sx * w) / 2, z: (sz * dd) / 2 };
          const c = add(d.anchor, rotate(centerLocal, it.rotation));
          it.width = w;
          it.depth = dd;
          it.x = c.x;
          it.z = c.z;
        }, 'items');
        break;
      case 'vertex': {
        const s = this.snapPoint(p, d.roomId, d.index);
        store.live((proj) => {
          const r = proj.rooms.find((q) => q.id === d.roomId);
          if (r) r.points[d.index] = s;
          clampRoomOpenings(proj, d.roomId);
        });
        break;
      }
      case 'wall': {
        const room = store.room(d.roomId);
        if (!room) break;
        const dir = sub(d.b0, d.a0);
        const n = { x: -dir.z, z: dir.x };
        const nl = Math.hypot(n.x, n.z) || 1;
        const nn = { x: n.x / nl, z: n.z / nl };
        let off = dot(sub(p, d.start), nn);
        const s = store.project.settings;
        if (s.snap && !e.altKey) off = snapValue(off, s.gridSize);
        store.live((proj) => {
          const r = proj.rooms.find((q) => q.id === d.roomId);
          if (!r) return;
          r.points[d.index] = add(d.a0, scale(nn, off));
          r.points[(d.index + 1) % r.points.length] = add(d.b0, scale(nn, off));
          clampRoomOpenings(proj, d.roomId);
        });
        break;
      }
      case 'room': {
        let delta = sub(p, d.start);
        const s = store.project.settings;
        if (s.snap && !e.altKey) delta = { x: snapValue(delta.x, s.gridSize), z: snapValue(delta.z, s.gridSize) };
        // snap to other rooms' vertices for easy adjacency
        const tol = 12 / this.view.zoom;
        let best: Vec2 | null = null;
        let bd = tol;
        for (const q0 of d.pts0) {
          const q = add(q0, delta);
          for (const r of store.project.rooms) {
            if (r.id === d.roomId) continue;
            for (const v of r.points) {
              const dd = dist(q, v);
              if (dd < bd) {
                bd = dd;
                best = sub(v, q);
              }
            }
          }
        }
        if (best) delta = add(delta, best);
        store.live((proj) => {
          const r = proj.rooms.find((q) => q.id === d.roomId);
          if (!r) return;
          r.points = d.pts0.map((q) => add(q, delta));
          for (const i0 of d.items0) {
            const it = proj.items.find((i) => i.id === i0.id);
            if (it) {
              it.x = i0.x + delta.x;
              it.z = i0.z + delta.z;
            }
          }
        });
        break;
      }
      case 'opening':
        store.live((proj) => {
          const o = proj.openings.find((q) => q.id === d.id);
          if (!o) return;
          // allow moving to another wall of any room
          let best: { roomId: string; index: number; t: number; dd: number; len: number } | null = null;
          for (const r of proj.rooms)
            for (const w of roomWalls(r)) {
              const cp = closestPointOnSegment(p, w.a, w.b);
              if (!best || cp.dist < best.dd) best = { roomId: r.id, index: w.index, t: cp.t, dd: cp.dist, len: w.length };
            }
          if (!best || best.dd > 1) return;
          o.roomId = best.roomId;
          o.wallIndex = best.index;
          let off = best.t * best.len;
          const s = proj.settings;
          if (s.snap && !e.altKey) off = snapValue(off, s.units === 'imperial' ? 0.0254 : 0.01);
          o.offset = Math.max(o.width / 2, Math.min(best.len - o.width / 2, off));
        });
        break;
      case 'rect':
      case 'measure':
      case 'calib':
        d.end = this.snapPoint(p);
        break;
      case 'move-plan':
        store.live((proj) => {
          if (!proj.underlay) return;
          proj.underlay.x = d.x0 + (p.x - d.start.x);
          proj.underlay.z = d.z0 + (p.z - d.start.z);
        });
        break;
    }
  }

  private onUp(_e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'rect') {
      const w = Math.abs(d.end.x - d.start.x);
      const h = Math.abs(d.end.z - d.start.z);
      if (w > 0.3 && h > 0.3) {
        const room = createRoom(`Room ${store.project.rooms.length + 1}`, rectPoints(Math.min(d.start.x, d.end.x), Math.min(d.start.z, d.end.z), w, h));
        inheritDefaults(room);
        store.update((p) => p.rooms.push(room));
        store.setUI({ tool: 'select' });
        store.select({ type: 'room', id: room.id });
      }
    } else if (d.kind === 'item' && !d.moved) {
      // second tap on a selected item cycles to the next item stacked under the pointer
      if (d.cycle) {
        const hits = this.hitItems(d.at);
        if (hits.length > 1) {
          const i = hits.findIndex((h) => h.id === d.id);
          store.select({ type: 'item', id: hits[(i + 1) % hits.length].id });
        }
      }
    } else if (d.kind === 'measure') {
      this.measure = { a: d.start, b: d.end };
    } else if (d.kind === 'calib') {
      if (dist(d.start, d.end) * this.view.zoom > 8) {
        this.calibLine = { a: d.start, b: d.end };
        this.onTwoPoints?.(d.tool, d.start, d.end);
      }
    } else if (d.kind !== 'pan') {
      store.commit();
    }
    this.dirty = true;
  }

  private finishPoly() {
    const res = finishPolygon(this.poly);
    if ('error' in res) {
      // keep drawing so the user can fix it (unless there is nothing to fix)
      toast(res.error);
      if (this.poly.length < 3) {
        this.poly = [];
        store.setUI({ tool: 'select' });
      }
      this.dirty = true;
      return;
    }
    const room = createRoom(`Room ${store.project.rooms.length + 1}`, res.points);
    inheritDefaults(room);
    store.update((p) => p.rooms.push(room));
    store.select({ type: 'room', id: room.id });
    this.poly = [];
    store.setUI({ tool: 'select' });
  }

  private updateCursor(e: PointerEvent) {
    const ui = store.ui;
    let c = 'default';
    if (ui.placing || ui.tool !== 'select') c = 'crosshair';
    else {
      const p = this.toWorld(e.offsetX, e.offsetY);
      if (this.hitItemHandle(e.offsetX, e.offsetY)) c = 'pointer';
      else if (this.hitItem(p) || this.hitOpening(p)) c = 'move';
      else if (this.hitVertex(p)) c = 'crosshair';
      else if (this.hitWall(p)) c = 'ew-resize';
    }
    this.canvas.style.cursor = c;
  }

  // -------------------------------------------------------------------------
  // Drawing

  private draw() {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const proj = store.project;
    const units = proj.settings.units;
    const dark = document.documentElement.dataset.theme === 'dark';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = dark ? '#1a1d22' : '#f7f6f3';
    ctx.fillRect(0, 0, W, H);
    this.drawGrid(dark);
    this.drawUnderlay();

    const sel = store.ui.selection;
    // rooms
    for (const r of proj.rooms) {
      if (r.points.length < 2) continue;
      const pts = r.points.map((p) => this.toScreen(p));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = hexA(r.floor.color, dark ? 0.35 : 0.28);
      ctx.fill();
      const selected = (sel?.type === 'room' && sel.id === r.id) || (sel?.type === 'wall' && sel.roomId === r.id);
      if (selected) {
        ctx.fillStyle = 'rgba(47,128,237,0.07)';
        ctx.fill();
      }
    }
    // walls
    const labelled = new Set<string>();
    for (const r of proj.rooms) {
      const t = Math.max(2, r.wallThickness * this.view.zoom);
      for (const w of roomWalls(r)) {
        const hidden = r.hiddenWalls.includes(w.index);
        const a = this.toScreen(w.a);
        const b = this.toScreen(w.b);
        ctx.lineCap = 'square';
        ctx.lineWidth = hidden ? 1 : t;
        const isSel = sel?.type === 'wall' && sel.roomId === r.id && sel.index === w.index;
        ctx.strokeStyle = isSel ? '#2f80ed' : hidden ? '#9aa' : dark ? '#d9d9d9' : '#3a3d42';
        ctx.setLineDash(hidden ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const midKey = `${Math.round(((w.a.x + w.b.x) / 2) * 50)},${Math.round(((w.a.z + w.b.z) / 2) * 50)}`;
        if (proj.settings.showDimensions && w.length > 0.2 && !labelled.has(midKey)) {
          labelled.add(midKey); // a wall shared by two rooms gets one label, not two on top of each other
          const mid = add(w.a, scale(w.dir, w.length / 2));
          const lp = this.toScreen(add(mid, scale(w.inward, -(r.wallThickness / 2 + 14 / this.view.zoom))));
          this.text(formatLength(w.length, units), lp.x, lp.y, isSel ? '#2f80ed' : dark ? '#bbb' : '#555', 11);
        }
      }
    }
    // openings
    for (const o of proj.openings) {
      const f = openingFrame(proj, o);
      if (!f) continue;
      const { wall, room } = f;
      const a = add(f.center, scale(wall.dir, -o.width / 2));
      const b = add(f.center, scale(wall.dir, o.width / 2));
      const sa = this.toScreen(a);
      const sb = this.toScreen(b);
      const t = Math.max(3, room.wallThickness * this.view.zoom + 2);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = dark ? '#1a1d22' : '#f7f6f3';
      ctx.lineWidth = t;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      const isSel = sel?.type === 'opening' && sel.id === o.id;
      const col = isSel ? '#2f80ed' : dark ? '#ddd' : '#333';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      if (o.type === 'window' || o.type === 'sliding-door') {
        for (const k of [-0.25, 0.25]) {
          const off = scale(wall.inward, room.wallThickness * k);
          const p1 = this.toScreen(add(a, off));
          const p2 = this.toScreen(add(b, off));
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      } else if (o.type === 'door' || o.type === 'double-door') {
        const side = o.flipSide ? -1 : 1;
        const inward = scale(wall.inward, side);
        const leaves = o.type === 'double-door' ? [
          { hinge: a, other: b, lw: o.width / 2 },
          { hinge: b, other: a, lw: o.width / 2 },
        ] : [o.flipHinge ? { hinge: b, other: a, lw: o.width } : { hinge: a, other: b, lw: o.width }];
        for (const l of leaves) {
          const tip = add(l.hinge, scale(inward, l.lw));
          const sh = this.toScreen(l.hinge);
          const st = this.toScreen(tip);
          ctx.beginPath();
          ctx.moveTo(sh.x, sh.y);
          ctx.lineTo(st.x, st.y);
          ctx.stroke();
          // swing arc
          const closed = add(l.hinge, scale(sub(l.other, l.hinge), l.lw / o.width));
          const sc = this.toScreen(closed);
          const a0 = Math.atan2(st.y - sh.y, st.x - sh.x);
          const a1 = Math.atan2(sc.y - sh.y, sc.x - sh.x);
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          let da = a1 - a0;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          ctx.arc(sh.x, sh.y, l.lw * this.view.zoom, a0, a0 + da, da < 0);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (o.type === 'garage-door') {
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isSel || proj.settings.showDimensions) {
        const lp = this.toScreen(add(f.center, scale(wall.inward, room.wallThickness / 2 + 24 / this.view.zoom)));
        this.text(formatLength(o.width, units), lp.x, lp.y, col, 10);
      }
    }
    // items (lower first)
    const items = [...proj.items].sort((a, b) => a.y + a.height - (b.y + b.height));
    for (const it of items) this.drawItem(it, sel?.type === 'item' && sel.id === it.id, dark);

    // room labels
    for (const r of proj.rooms) {
      if (r.points.length < 3) continue;
      const c = this.toScreen(centroid(r.points));
      ctx.font = '600 13px system-ui';
      const tw = Math.max(ctx.measureText(r.name).width, 50) + 12;
      ctx.fillStyle = dark ? 'rgba(20,22,26,0.7)' : 'rgba(255,255,255,0.75)';
      roundRect(ctx, c.x - tw / 2, c.y - 17, tw, 34, 6);
      ctx.fill();
      this.text(r.name, c.x, c.y - 7, dark ? '#eee' : '#222', 13, true);
      this.text(formatArea(area(r.points), units), c.x, c.y + 9, dark ? '#aaa' : '#666', 11);
    }
    // clearances
    const si = store.selectedItem();
    if (si && proj.settings.showClearances) {
      for (const c of itemClearances(proj, si)) {
        if (c.distance < 0.01) continue;
        this.dimLine(c.from, c.to, formatLength(c.distance, units), '#e2574c');
      }
    }
    // selected item handles
    if (si && !si.locked) {
      const corners = itemCorners(si).map((c) => this.toScreen(c));
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#2f80ed';
      ctx.lineWidth = 2;
      for (const c of corners) {
        ctx.beginPath();
        ctx.rect(c.x - 5, c.y - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
      }
      const rh = this.rotateHandlePos(si);
      const front = this.toScreen(add(rotate({ x: 0, z: si.depth / 2 }, si.rotation), { x: si.x, z: si.z }));
      ctx.beginPath();
      ctx.moveTo(front.x, front.y);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2f80ed';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⟳', rh.x, rh.y + 0.5);
    }
    // vertices of selected room
    const sr = sel?.type === 'room' || sel?.type === 'wall' ? store.room(sel.type === 'room' ? sel.id : sel.roomId) : undefined;
    if (sr) {
      for (const p of sr.points) {
        const s = this.toScreen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#2f80ed';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // tool previews
    const d = this.drag;
    if (d?.kind === 'rect') {
      const pts = rectPoints(Math.min(d.start.x, d.end.x), Math.min(d.start.z, d.end.z), Math.abs(d.end.x - d.start.x), Math.abs(d.end.z - d.start.z));
      this.previewPoly(pts, true);
      this.dimLine(pts[0], pts[1], formatLength(Math.abs(d.end.x - d.start.x), units), '#2f80ed', -18);
      this.dimLine(pts[1], pts[2], formatLength(Math.abs(d.end.z - d.start.z), units), '#2f80ed', -18);
    }
    if (store.ui.tool === 'room-poly' && this.poly.length) {
      const pts = [...this.poly];
      if (this.hover) pts.push(this.snapPoint(this.hover));
      this.previewPoly(pts, false);
      for (let i = 0; i < pts.length - 1; i++) this.dimLine(pts[i], pts[i + 1], formatLength(dist(pts[i], pts[i + 1]), units), '#2f80ed', -14);
    }
    const m = d?.kind === 'measure' ? { a: d.start, b: d.end } : this.measure;
    if (m && store.ui.tool === 'measure') this.dimLine(m.a, m.b, formatLength(dist(m.a, m.b), units, true), '#9b51e0', 0);
    const cl = d?.kind === 'calib' ? { a: d.start, b: d.end } : this.calibLine;
    if (cl && (store.ui.tool === 'calibrate' || store.ui.tool === 'check-dim')) this.dimLine(cl.a, cl.b, store.ui.tool === 'calibrate' ? 'known length?' : formatLength(dist(cl.a, cl.b), units, true), '#e67e22', 0);
    if (store.ui.placing && this.hover) {
      const entry = catalogEntry(store.ui.placing);
      if (entry) {
        const ghost = { x: this.hover.x, z: this.hover.z, width: entry.w * 0.0254, depth: entry.d * 0.0254, rotation: 0 };
        const c = itemCorners(ghost).map((q) => this.toScreen(q));
        ctx.beginPath();
        c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(47,128,237,0.2)';
        ctx.fill();
        ctx.strokeStyle = '#2f80ed';
        ctx.stroke();
      }
    }
    // compass / north arrow and scale bar
    this.drawCompass(dark);
  }

  /** Draw the traced floor-plan image (faded) under the rooms. */
  private drawUnderlay() {
    const u = store.project.underlay;
    if (!u || !u.visible) return;
    const plan = loadPlanImage(u.assetId, () => (this.dirty = true));
    if (!plan.img) return;
    const ctx = this.ctx;
    // affine map from image pixels to screen
    const o = this.toScreen(pixelToWorld(u, { x: 0, y: 0 }));
    const ex = this.toScreen(pixelToWorld(u, { x: 1, y: 0 }));
    const ey = this.toScreen(pixelToWorld(u, { x: 0, y: 1 }));
    ctx.save();
    ctx.globalAlpha = u.opacity;
    ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(plan.img, 0, 0, u.pixelWidth, u.pixelHeight);
    ctx.restore();
    if (!u.calibrated) {
      const c = this.toScreen(pixelToWorld(u, { x: u.pixelWidth / 2, y: 0 }));
      this.pill('Not to scale yet – set the scale', c.x, Math.max(20, c.y - 14), '#e67e22');
    }
  }

  private drawGrid(dark: boolean) {
    const ctx = this.ctx;
    const s = store.project.settings;
    const step = s.units === 'imperial' ? 0.3048 : 0.5;
    const major = s.units === 'imperial' ? 5 : 2;
    const tl = this.toWorld(0, 0);
    const corners = [tl, this.toWorld(this.W, 0), this.toWorld(0, this.H), this.toWorld(this.W, this.H)];
    const b = bounds(corners);
    const px = step * this.view.zoom;
    if (px < 4) return;
    const x0 = Math.floor(b.minX / step);
    const x1 = Math.ceil(b.maxX / step);
    const z0 = Math.floor(b.minZ / step);
    const z1 = Math.ceil(b.maxZ / step);
    for (let i = x0; i <= x1; i++) {
      ctx.strokeStyle = i % major === 0 ? (dark ? '#2e333b' : '#dcd9d2') : dark ? '#23272d' : '#ebe9e4';
      ctx.lineWidth = 1;
      const a = this.toScreen({ x: i * step, z: b.minZ });
      const c = this.toScreen({ x: i * step, z: b.maxZ });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    for (let j = z0; j <= z1; j++) {
      ctx.strokeStyle = j % major === 0 ? (dark ? '#2e333b' : '#dcd9d2') : dark ? '#23272d' : '#ebe9e4';
      const a = this.toScreen({ x: b.minX, z: j * step });
      const c = this.toScreen({ x: b.maxX, z: j * step });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
  }

  private drawCompass(dark: boolean) {
    const ctx = this.ctx;
    const x = this.W - 34;
    const y = 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.view.angle);
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 2);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = '#e2574c';
    ctx.fill();
    ctx.fillStyle = dark ? '#ddd' : '#333';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -20);
    ctx.restore();
    // scale bar
    const s = store.project.settings;
    const len = s.units === 'imperial' ? 0.3048 * (this.view.zoom > 40 ? 5 : 10) : this.view.zoom > 40 ? 1 : 5;
    const px = len * this.view.zoom;
    ctx.strokeStyle = dark ? '#ddd' : '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, this.H - 18);
    ctx.lineTo(16 + px, this.H - 18);
    ctx.moveTo(16, this.H - 23);
    ctx.lineTo(16, this.H - 13);
    ctx.moveTo(16 + px, this.H - 23);
    ctx.lineTo(16 + px, this.H - 13);
    ctx.stroke();
    this.text(formatLength(len, s.units), 16 + px / 2, this.H - 30, dark ? '#ddd' : '#333', 10);
  }

  private previewPoly(pts: Vec2[], closed: boolean) {
    const ctx = this.ctx;
    const s = pts.map((p) => this.toScreen(p));
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (closed) ctx.closePath();
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(47,128,237,0.1)';
    if (closed) ctx.fill();
    ctx.stroke();
    for (const p of s) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#2f80ed';
      ctx.fill();
    }
  }

  private dimLine(a: Vec2, b: Vec2, label: string, color: string, offsetPx = 0) {
    const ctx = this.ctx;
    let sa = this.toScreen(a);
    let sb = this.toScreen(b);
    if (offsetPx) {
      const dx = sb.x - sa.x;
      const dy = sb.y - sa.y;
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * offsetPx;
      const ny = (dx / l) * offsetPx;
      sa = { x: sa.x + nx, y: sa.y + ny };
      sb = { x: sb.x + nx, y: sb.y + ny };
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    for (const [p, dir] of [
      [sa, 1],
      [sb, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(ang + 0.4 * dir) * 7 * dir, p.y + Math.sin(ang + 0.4 * dir) * 7 * dir);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(ang - 0.4 * dir) * 7 * dir, p.y + Math.sin(ang - 0.4 * dir) * 7 * dir);
      ctx.stroke();
    }
    const mx = (sa.x + sb.x) / 2;
    const my = (sa.y + sb.y) / 2;
    this.pill(label, mx, my, color);
  }

  private pill(text: string, x: number, y: number, color: string) {
    const ctx = this.ctx;
    ctx.font = '600 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundRect(ctx, x - w / 2, y - 9, w, 18, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private text(t: string, x: number, y: number, color: string, size: number, bold = false) {
    const ctx = this.ctx;
    ctx.font = `${bold ? '600 ' : ''}${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  }

  private drawItem(it: Item, selected: boolean, dark: boolean) {
    const ctx = this.ctx;
    const c = this.toScreen({ x: it.x, z: it.z });
    const z = this.view.zoom;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(this.view.angle + it.rotation);
    const w = it.width * z;
    const d = it.depth * z;
    const elevated = it.y > 1.2 || it.category === 'lighting';
    ctx.globalAlpha = elevated ? 0.65 : 0.95;
    ctx.fillStyle = it.kind === 'rug' ? hexA(it.color, 0.5) : it.color;
    ctx.strokeStyle = selected ? '#2f80ed' : dark ? '#ccc' : '#444';
    ctx.lineWidth = selected ? 2.5 : 1;
    if (elevated) ctx.setLineDash([4, 3]);
    if (it.category === 'lighting' && (it.kind === 'recessed' || it.kind === 'ceiling-light' || it.kind === 'pendant' || it.kind === 'chandelier' || it.kind === 'ceiling-fan' || it.kind === 'floor-lamp' || it.kind === 'table-lamp')) {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(5, w / 2), 0, Math.PI * 2);
      ctx.fillStyle = '#ffe9a8';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      const r = Math.max(5, w / 2);
      ctx.moveTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(r * 0.7, r * 0.7);
      ctx.moveTo(r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.7, r * 0.7);
      ctx.stroke();
    } else if (it.shape !== 'model' || it.category === 'people' || isShapedTop(it) || it.kind === 'corner-base') {
      // anything that isn't a plain box: draw its real outline (shared with the spacing measurements)
      ctx.beginPath();
      itemLocalOutline(it).forEach((q, i) => (i ? ctx.lineTo(q.x * z, q.z * z) : ctx.moveTo(q.x * z, q.z * z)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (it.category === 'people') {
        // head seen from above
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(w, d) * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = it.accent;
        ctx.fill();
        ctx.stroke();
      }
    } else {
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // details
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    switch (it.kind) {
      case 'sink-base':
      case 'vanity':
        roundRect(ctx, -w * 0.35, -d * 0.25, w * 0.7, d * 0.55, 4);
        ctx.stroke();
        break;
      case 'range':
      case 'cooktop':
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.beginPath();
          ctx.arc((sx * w) / 4, (sz * d) / 4, Math.min(w, d) * 0.15, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'bed':
      case 'bed-king':
      case 'bed-twin':
        ctx.strokeRect(-w / 2 + 3, -d / 2 + 3, w - 6, d * 0.18);
        ctx.beginPath();
        ctx.moveTo(-w / 2, -d / 2 + d * 0.3);
        ctx.lineTo(w / 2, -d / 2 + d * 0.3);
        ctx.stroke();
        break;
      case 'sofa':
      case 'loveseat':
      case 'armchair':
        ctx.strokeRect(-w / 2, -d / 2, w, d * 0.25);
        ctx.strokeRect(-w / 2, -d / 2, w * 0.1, d);
        ctx.strokeRect(w / 2 - w * 0.1, -d / 2, w * 0.1, d);
        break;
      case 'toilet':
        ctx.beginPath();
        ctx.ellipse(0, d * 0.12, w * 0.35, d * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'bathtub':
        roundRect(ctx, -w / 2 + 5, -d / 2 + 5, w - 10, d - 10, Math.min(w, d) * 0.3);
        ctx.stroke();
        break;
      case 'refrigerator':
        ctx.beginPath();
        ctx.moveTo(0, -d / 2);
        ctx.lineTo(0, d / 2);
        ctx.stroke();
        break;
    }
    // front indicator
    if (it.category !== 'lighting' && it.kind !== 'rug' && w > 14) {
      ctx.fillStyle = selected ? '#2f80ed' : 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(-4, d / 2 - 1);
      ctx.lineTo(4, d / 2 - 1);
      ctx.lineTo(0, d / 2 - 6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if ((Math.min(it.width, it.depth) * z > 28 && it.category !== 'lighting' && it.kind !== 'rug' && it.y < 1.2) || selected) {
      const name = it.name.length > 18 ? it.name.slice(0, 17) + '…' : it.name;
      ctx.font = '10px system-ui';
      const tw = ctx.measureText(name).width + 6;
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.75)';
      ctx.fillRect(c.x - tw / 2, c.y - 7, tw, 14);
      this.text(name, c.x, c.y, dark ? '#eee' : '#222', 10);
    }
  }
}

/** Drags that change the model through store.live() and must be committed (also when a pinch interrupts them). */
export function dragNeedsCommit(kind: Drag['kind']): boolean {
  return kind !== 'pan' && kind !== 'rect' && kind !== 'measure' && kind !== 'calib';
}

function isShapedTop(it: Item) {
  const top = getStyle(it).top;
  return it.kind === 'round-table' || top === 'round' || top === 'oval' || top === 'racetrack';
}

function inheritDefaults(room: Room) {
  // New rooms copy wall height / thickness from the most recently created room for consistency
  const prev = store.project.rooms[store.project.rooms.length - 1];
  if (prev) {
    room.wallHeight = prev.wallHeight;
    room.wallThickness = prev.wallThickness;
    room.ceiling = { ...prev.ceiling, type: 'flat' };
  }
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
