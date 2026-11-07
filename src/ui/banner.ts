// Persistent banners for problems the user must not miss (save failures, other tabs…).

export interface BannerAction {
  label: string;
  run: () => void;
  primary?: boolean;
}

export function showBanner(id: string, message: string, actions: BannerAction[] = [], kind: 'error' | 'warn' | 'info' = 'error', doc: Document = document): HTMLElement {
  let host = doc.getElementById('banners');
  if (!host) {
    host = doc.createElement('div');
    host.id = 'banners';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    doc.body.appendChild(host);
  }
  let el = doc.getElementById(`banner-${id}`);
  if (!el) {
    el = doc.createElement('div');
    el.id = `banner-${id}`;
    host.appendChild(el);
  }
  el.className = `banner ${kind}`;
  el.replaceChildren();
  const text = doc.createElement('span');
  text.textContent = message; // always plain text
  el.appendChild(text);
  for (const a of actions) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `btn small ${a.primary ? 'primary' : ''}`;
    b.textContent = a.label;
    b.addEventListener('click', a.run);
    el.appendChild(b);
  }
  return el;
}

export function hideBanner(id: string, doc: Document = document) {
  doc.getElementById(`banner-${id}`)?.remove();
}
