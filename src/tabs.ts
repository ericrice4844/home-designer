// Cross-tab guard: two tabs editing the same autosave would silently overwrite each other.
// Tabs announce themselves on a BroadcastChannel; when another tab saves, this tab stops autosaving
// and asks the user what to do.
import type { Store } from './state';

export interface TabChannel {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: any }) => void) | null;
  close(): void;
}

export type TabConflict = 'other-tab-open' | 'other-tab-saved';

export class TabGuard {
  readonly tabId = Math.random().toString(36).slice(2);
  private off: (() => void) | null = null;

  constructor(
    private store: Store,
    private channel: TabChannel,
    private onConflict: (kind: TabConflict) => void,
  ) {}

  start() {
    this.channel.onmessage = (e) => {
      const m = e.data;
      if (!m || m.tab === this.tabId) return;
      if (m.type === 'hello') {
        this.channel.postMessage({ type: 'here', tab: this.tabId });
        this.onConflict('other-tab-open');
      } else if (m.type === 'here') {
        this.onConflict('other-tab-open');
      } else if (m.type === 'saved') {
        // our in-memory copy is now older than what is stored: never overwrite it silently
        this.store.blockSaves('other-tab');
        this.onConflict('other-tab-saved');
      }
    };
    this.off = this.store.onSaved(() => this.channel.postMessage({ type: 'saved', tab: this.tabId }));
    this.channel.postMessage({ type: 'hello', tab: this.tabId });
  }

  stop() {
    this.off?.();
    this.channel.onmessage = null;
    this.channel.close();
  }
}

export function createTabChannel(): TabChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel('home-design-studio') as unknown as TabChannel);
}
