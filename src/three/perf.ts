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
