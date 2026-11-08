import type { ChangeReason, LiveScope } from '../state';

/** Pixel ratio to render at: phones/tablets (coarse pointer) are capped lower to save GPU/battery. */
export function renderPixelRatio(devicePixelRatio: number, coarsePointer: boolean): number {
  return Math.min(devicePixelRatio || 1, coarsePointer ? 1.5 : 2);
}

/** Could this change have touched rooms/openings (so the house shell must be compared/rebuilt)? */
export function structureMayHaveChanged(reason: ChangeReason, liveScope: LiveScope): boolean {
  if (reason === 'ui') return false;
  if (reason === 'live') return liveScope !== 'items';
  return true;
}

/**
 * Decides whether the 3D view needs a new frame. Rendering every animation frame keeps the GPU busy
 * (and drains phone batteries) while nothing moves, so frames are drawn only when something changed:
 * the view was invalidated (edit, selection, resize, input), the camera moved, or a continuous mode
 * (walking, dragging) is on — plus a slow idle refresh as a safety net.
 */
export class RenderGate {
  private dirty = true;
  private last = -Infinity;
  private camKey = '';
  constructor(readonly idleMs = 1000) {}

  invalidate() {
    this.dirty = true;
  }

  /** `camKey` is any string that changes whenever the camera does (e.g. its matrices). */
  shouldRender(now: number, camKey: string, continuous = false): boolean {
    if (!continuous && !this.dirty && camKey === this.camKey && now - this.last < this.idleMs) return false;
    this.dirty = false;
    this.camKey = camKey;
    this.last = now;
    return true;
  }
}

/** A compact key that changes when the camera's pose or projection does. */
export function cameraKey(world: ArrayLike<number>, projection: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += world[i].toFixed(5) + ',';
  for (let i = 0; i < 16; i++) s += projection[i].toFixed(5) + ',';
  return s;
}
