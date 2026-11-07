import type { Item } from '../model';

/**
 * Which item shortcut a key press means. Locked items refuse move/rotate/delete; modifier combos
 * (Ctrl/Cmd+R reload, Ctrl+Arrow…) are left to the browser.
 */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, it: Pick<Item, 'locked'> | undefined): 'rotate' | 'nudge' | 'delete' | 'locked' | null {
  if (!it || e.ctrlKey || e.metaKey || e.altKey) return null;
  const kind = e.key === 'r' || e.key === 'R' ? 'rotate' : e.key.startsWith('Arrow') ? 'nudge' : e.key === 'Delete' || e.key === 'Backspace' ? 'delete' : null;
  if (kind && it.locked) return 'locked';
  return kind;
}
