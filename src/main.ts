import './styles.css';
import { store } from './state';
import { onStorageEvent } from './storage';
import { watchForUpdates } from './swUpdate';
import { createTabChannel, TabGuard } from './tabs';
import { sampleHouse } from './templates';
import { App } from './ui/app';
import { hideBanner, showBanner } from './ui/banner';
import { download } from './ui/dom';
import { describeError } from './ui/errors';

async function start() {
  const result = await store.restore();
  if (result.status === 'empty') store.load(sampleHouse());
  const app = new App(document.getElementById('app')!);
  (window as any).hds = { store, app };
  if (result.status === 'empty') setTimeout(() => app.helpModal(), 600);
  if (result.status === 'corrupt') showRestoreFailure(result.raw, result.error);

  // Save problems are always visible
  store.onSaveStatus((s) => {
    if (s.state === 'error')
      showBanner('save', `Your latest changes are NOT saved: ${describeError(s.error)}.`, [
        { label: 'Retry', run: () => void store.saveNow(), primary: true },
        { label: 'Export project', run: () => (app as any).action('export') },
      ]);
    else if (s.state === 'saved') hideBanner('save');
  });
  // Don't lose the last edits when the tab is closed / backgrounded (mobile)
  window.addEventListener('pagehide', () => void store.flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void store.flush());

  onStorageEvent((e) => {
    if (e.type === 'versionchange')
      showBanner('version', 'A newer version of Home Design Studio was opened in another tab. Reload to continue.', [{ label: 'Reload', run: () => location.reload(), primary: true }], 'warn');
  });

  const channel = createTabChannel();
  if (channel) {
    new TabGuard(store, channel, (kind) => {
      if (kind === 'other-tab-open')
        showBanner('tabs', 'This design is also open in another tab. Edit in one tab at a time to avoid overwriting changes.', [{ label: 'OK', run: () => hideBanner('tabs') }], 'warn');
      else
        showBanner('tabs', 'Another tab saved changes to this design. Autosave is paused here so nothing is overwritten.', [
          { label: 'Reload latest', run: () => location.reload(), primary: true },
          { label: 'Keep this version', run: () => (hideBanner('tabs'), store.allowSaves()) },
        ], 'warn');
    }).start();
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      void store.flush().then(() => location.reload());
    });
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) =>
        watchForUpdates(reg, () => !!navigator.serviceWorker.controller, (apply) =>
          showBanner('update', 'A new version of Home Design Studio is available.', [
            { label: 'Update now', run: apply, primary: true },
            { label: 'Later', run: () => hideBanner('update') },
          ], 'info'),
        ),
      )
      .catch(() => {});
  }
}

function showRestoreFailure(raw: unknown, error: unknown) {
  showBanner('restore', `Your saved design could not be loaded (${describeError(error)}). It has not been changed. Export it to keep a copy, or start fresh.`, [
    {
      label: 'Export raw save',
      run: () => download('home-design-backup.json', new Blob([safeStringify(raw)], { type: 'application/json' })),
      primary: true,
    },
    {
      label: 'Start fresh',
      run: () => {
        if (!confirm('Start a new design? The unreadable save will be replaced. Export it first if you may need it.')) return;
        hideBanner('restore');
        store.allowSaves(false);
        store.load(sampleHouse());
      },
    },
  ]);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 1) ?? 'null';
  } catch {
    return String(v);
  }
}

start();
