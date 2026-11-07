// Page side of the service worker update flow: show a prompt when a new version is waiting,
// activate it on request and reload once it has taken control.

export interface SWLike {
  postMessage(m: unknown): void;
  state?: string;
  addEventListener(type: 'statechange', fn: () => void): void;
}
export interface RegistrationLike {
  waiting: SWLike | null;
  installing: SWLike | null;
  addEventListener(type: 'updatefound', fn: () => void): void;
}

export function watchForUpdates(reg: RegistrationLike, hasController: () => boolean, prompt: (apply: () => void) => void) {
  const offer = (sw: SWLike) => prompt(() => sw.postMessage({ type: 'SKIP_WAITING' }));
  // an update downloaded during an earlier visit
  if (reg.waiting && hasController()) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      // "installed" with an existing controller = a new version is waiting (first install needs no prompt)
      if (sw.state === 'installed' && hasController()) offer(sw);
    });
  });
}
