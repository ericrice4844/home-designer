import { cloneProject, emptyProject, normalizeProject, type Item, type Opening, type Project, type Room } from './model';
import { deleteRoom } from './edits';
import { storage } from './storage';

export type Selection =
  | { type: 'room'; id: string }
  | { type: 'wall'; roomId: string; index: number }
  | { type: 'opening'; id: string }
  | { type: 'item'; id: string }
  | null;

export type Tool = 'select' | 'room-rect' | 'room-poly' | 'measure' | 'pan' | 'calibrate' | 'check-dim' | 'move-plan';

export type ViewMode = 'plan' | '3d' | 'split';
export type CameraMode = 'orbit' | 'iso' | 'top' | 'front' | 'side' | 'walk';

export interface UIState {
  selection: Selection;
  tool: Tool;
  view: ViewMode;
  camera: CameraMode;
  /** Catalog kind waiting to be placed with the next click on the plan. */
  placing: string | null;
  panel: string;
}

type Listener = (reason: ChangeReason) => void;
export type ChangeReason = 'project' | 'ui' | 'live' | 'load';
export type LiveScope = 'items' | 'structure';

const STORAGE_KEY = 'current';
const MAX_HISTORY = 100;

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; error: unknown }
  | { state: 'blocked'; reason: string };

export type RestoreResult = { status: 'ok' } | { status: 'empty' } | { status: 'corrupt'; raw: unknown; error: unknown };

export class Store {
  project: Project = emptyProject();
  ui: UIState = { selection: null, tool: 'select', view: 'split', camera: 'orbit', placing: null, panel: 'room' };
  private listeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private liveBase: string | null = null;
  private statusListeners = new Set<(s: SaveStatus) => void>();
  /** Why autosave is paused (failed restore, another tab…); null when saving normally. */
  saveBlocked: string | null = null;
  saveStatus: SaveStatus = { state: 'idle' };
  storageKey = STORAGE_KEY;

  onSaveStatus(fn: (s: SaveStatus) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: SaveStatus) {
    this.saveStatus = s;
    for (const l of this.statusListeners) l(s);
  }

  /** Stop autosaving (nothing is written) until allowSaves() is called. */
  blockSaves(reason: string) {
    this.saveBlocked = reason;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.setStatus({ state: 'blocked', reason });
  }

  allowSaves(saveNow = true) {
    this.saveBlocked = null;
    this.setStatus({ state: 'idle' });
    if (saveNow) this.scheduleSave();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: ChangeReason) {
    for (const l of this.listeners) l(reason);
  }

  /** Apply a change as a single undoable step. */
  update(fn: (p: Project) => void) {
    const before = this.liveBase ?? JSON.stringify(this.project);
    this.liveBase = null;
    fn(this.project);
    const after = JSON.stringify(this.project);
    if (after === before) {
      this.emit('project');
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.emit('project');
    this.scheduleSave();
  }

  /**
   * Apply a continuous change (dragging, slider) without recording history for every frame.
   * Call `commit()` when the gesture ends.
   */
  /** What the current live gesture changes: 'items' lets the 3D view skip re-checking walls every frame. */
  liveScope: LiveScope = 'structure';

  live(fn: (p: Project) => void, scope: LiveScope = 'structure') {
    if (this.liveBase === null) this.liveBase = JSON.stringify(this.project);
    this.liveScope = scope;
    fn(this.project);
    this.emit('live');
  }

  commit() {
    if (this.liveBase === null) return;
    const before = this.liveBase;
    this.liveBase = null;
    if (before !== JSON.stringify(this.project)) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this.scheduleSave();
    }
    this.emit('project');
  }

  undo() {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(prev));
    this.validateSelection();
    this.emit('load');
    this.scheduleSave();
  }

  redo() {
    this.commit();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = normalizeProject(JSON.parse(next));
    this.validateSelection();
    this.emit('load');
    this.scheduleSave();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  setUI(patch: Partial<UIState>) {
    Object.assign(this.ui, patch);
    this.emit('ui');
  }

  select(sel: Selection) {
    this.ui.selection = sel;
    if (sel) {
      this.ui.panel = sel.type === 'item' ? 'item' : sel.type === 'opening' ? 'opening' : 'room';
    }
    this.emit('ui');
  }

  load(p: Project, resetHistory = true) {
    this.project = normalizeProject(cloneProject(p));
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.ui.selection = null;
    this.emit('load');
    this.scheduleSave();
  }

  /**
   * Load the autosaved project. A read or parse failure never falls through to "start fresh":
   * saves are blocked so the old record stays untouched until the user decides what to do.
   */
  async restore(): Promise<RestoreResult> {
    // An edit made just before the last page close may only exist in the synchronous pending copy.
    const pending = this.readPending();
    if (pending !== undefined) {
      try {
        this.project = normalizeProject(pending);
        this.emit('load');
        const ok = await this.saveNow(); // move it into IndexedDB
        if (ok) this.clearPending();
        return { status: 'ok' };
      } catch {
        this.clearPending(); // unreadable pending copy: fall back to the last full save
      }
    }
    let raw: unknown;
    try {
      raw = await storage.loadProject(this.storageKey);
    } catch (error) {
      this.blockSaves('restore-failed');
      return { status: 'corrupt', raw: undefined, error };
    }
    if (raw === undefined || raw === null) return { status: 'empty' };
    try {
      this.project = normalizeProject(raw);
    } catch (error) {
      this.blockSaves('restore-failed');
      return { status: 'corrupt', raw, error };
    }
    this.emit('load');
    return { status: 'ok' };
  }

  private scheduleSave() {
    if (this.saveBlocked) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 400);
  }

  /** Write any pending change immediately (used on pagehide). */
  flush(): Promise<boolean> {
    if (this.saveTimer === undefined) return Promise.resolve(true);
    return this.saveNow();
  }

  /**
   * Page is going away: an IndexedDB write may not finish in time, so also keep a synchronous copy
   * of any unsaved change in localStorage. restore() picks it up next time.
   */
  flushOnHide() {
    const unsaved = this.saveTimer !== undefined || this.saveStatus.state === 'saving';
    if (unsaved && !this.saveBlocked) {
      try {
        localStorage.setItem(this.pendingKey, JSON.stringify(this.project));
      } catch {
        /* storage full or unavailable – the async save below is all we can do */
      }
    }
    void this.flush();
  }

  get pendingKey() {
    return `hds-pending-${this.storageKey}`;
  }

  private readPending(): unknown {
    try {
      const s = localStorage.getItem(this.pendingKey);
      return s ? JSON.parse(s) : undefined;
    } catch {
      return undefined;
    }
  }

  private clearPending() {
    try {
      localStorage.removeItem(this.pendingKey);
    } catch {
      /* ignore */
    }
  }

  async saveNow(): Promise<boolean> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.saveBlocked) return false;
    this.setStatus({ state: 'saving' });
    try {
      await storage.saveProject(this.storageKey, JSON.parse(JSON.stringify(this.project)));
      this.clearPending();
      this.setStatus({ state: 'saved', at: Date.now() });
      for (const l of this.savedListeners) l();
      return true;
    } catch (error) {
      this.setStatus({ state: 'error', error });
      return false;
    }
  }

  private savedListeners = new Set<() => void>();
  /** Called after every successful save (used to tell other tabs). */
  onSaved(fn: () => void) {
    this.savedListeners.add(fn);
    return () => this.savedListeners.delete(fn);
  }

  private validateSelection() {
    const s = this.ui.selection;
    if (!s) return;
    if (s.type === 'item' && !this.item(s.id)) this.ui.selection = null;
    if (s.type === 'room' && !this.room(s.id)) this.ui.selection = null;
    if (s.type === 'wall' && !this.room(s.roomId)) this.ui.selection = null;
    if (s.type === 'opening' && !this.opening(s.id)) this.ui.selection = null;
  }

  room(id: string | undefined): Room | undefined {
    return this.project.rooms.find((r) => r.id === id);
  }
  item(id: string | undefined): Item | undefined {
    return this.project.items.find((r) => r.id === id);
  }
  opening(id: string | undefined): Opening | undefined {
    return this.project.openings.find((r) => r.id === id);
  }

  selectedItem(): Item | undefined {
    const s = this.ui.selection;
    return s?.type === 'item' ? this.item(s.id) : undefined;
  }
  selectedRoom(): Room | undefined {
    const s = this.ui.selection;
    if (s?.type === 'room') return this.room(s.id);
    if (s?.type === 'wall') return this.room(s.roomId);
    if (s?.type === 'opening') return this.room(this.opening(s.id)?.roomId);
    if (s?.type === 'item') {
      const it = this.item(s.id);
      if (it) return this.project.rooms.find((r) => r.points.length > 2 && isInside(it.x, it.z, r));
    }
    return undefined;
  }

  deleteSelection() {
    const s = this.ui.selection;
    if (!s) return;
    this.update((p) => {
      if (s.type === 'item') p.items = p.items.filter((i) => i.id !== s.id);
      if (s.type === 'opening') p.openings = p.openings.filter((o) => o.id !== s.id);
      if (s.type === 'room') deleteRoom(p, s.id);
    });
    this.ui.selection = null;
    this.emit('ui');
  }
}

function isInside(x: number, z: number, r: Room) {
  let inside = false;
  const pts = r.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export const store = new Store();
