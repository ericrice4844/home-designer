import { throttleLatest } from '../lru';
import { store } from '../state';
import { formatLength, parseLength } from '../units';

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, any> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function row(...children: Child[]) {
  return h('div', { class: 'row' }, ...children);
}

export function section(title: string, ...children: Child[]) {
  return h('section', { class: 'panel-section' }, h('h3', {}, title), ...children);
}

/** Text input that accepts lengths like 10'6", 3.2m, 126in. */
export function lengthInput(value: number, onCommit: (m: number) => void, opts: { min?: number; max?: number } = {}) {
  const units = store.project.settings.units;
  const input = h('input', {
    type: 'text',
    class: 'len',
    value: formatLength(value, units, true),
    inputmode: 'text',
    spellcheck: false,
    title: units === 'metric' ? 'e.g. 2.4 m, 240 cm – a plain number is meters' : `e.g. 10' 6", 34 1/2", 3 ft – a plain number is inches`,
    'aria-label': 'Length',
  });
  const commit = () => {
    const v = parseLength(input.value, store.project.settings.units);
    if (v === null || !isFinite(v)) {
      input.value = formatLength(value, units, true);
      input.classList.add('invalid');
      setTimeout(() => input.classList.remove('invalid'), 600);
      return;
    }
    const c = Math.max(opts.min ?? -1e9, Math.min(opts.max ?? 1e9, v));
    if (Math.abs(c - value) > 1e-6) onCommit(c);
    else input.value = formatLength(value, units, true);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    e.stopPropagation();
  });
  input.addEventListener('focus', () => input.select());
  return input;
}

export function numberInput(value: number, onCommit: (v: number) => void, opts: { min?: number; max?: number; step?: number } = {}) {
  const input = h('input', { type: 'number', value: String(round(value)), min: opts.min, max: opts.max, step: opts.step ?? 'any' });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (isFinite(v)) onCommit(Math.max(opts.min ?? -1e9, Math.min(opts.max ?? 1e9, v)));
  });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return input;
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

/** Color picker with live preview (no history spam) and a few swatches. */
export function colorInput(value: string, onLive: (c: string) => void, swatches: string[] = []) {
  const input = h('input', { type: 'color', value: toHex(value) });
  // dragging across the picker fires dozens of events per second; rebuild the 3D at most every 80 ms
  const apply = throttleLatest((c: string) => store.live(() => onLive(c)), 80);
  input.addEventListener('input', () => apply(input.value));
  input.addEventListener('change', () => {
    apply.flush();
    store.commit();
  });
  const wrap = h('div', { class: 'color-field' }, input);
  if (swatches.length) {
    const sw = h('div', { class: 'swatches' });
    for (const c of swatches) {
      sw.append(
        h('button', {
          class: 'swatch',
          title: c,
          style: { background: c },
          onclick: (e: Event) => {
            e.preventDefault();
            input.value = c;
            store.update(() => onLive(c));
          },
        }),
      );
    }
    wrap.append(sw);
  }
  return wrap;
}

export function toHex(c: string) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  return '#888888';
}

export function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) {
  const s = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

export function checkbox(value: boolean, label: string, onChange: (v: boolean) => void) {
  const c = h('input', { type: 'checkbox', checked: value });
  c.addEventListener('change', () => onChange(c.checked));
  return h('label', { class: 'check' }, c, h('span', {}, label));
}

export function slider(value: number, min: number, max: number, step: number, onLive: (v: number) => void, fmt?: (v: number) => string) {
  const out = h('span', { class: 'slider-val' }, fmt ? fmt(value) : String(value));
  const s = h('input', { type: 'range', min, max, step, value: String(value) });
  s.addEventListener('input', () => {
    const v = Number(s.value);
    out.textContent = fmt ? fmt(v) : String(v);
    store.live(() => onLive(v));
  });
  s.addEventListener('change', () => store.commit());
  return h('div', { class: 'slider' }, s, out);
}

export function button(label: string | Node, onClick: (e: MouseEvent) => void, cls = '', title?: string) {
  // icon-only buttons (⟲, ✕, 📷…) need a spoken name: use the tooltip
  const text = typeof label === 'string' ? label : label.textContent ?? '';
  const iconOnly = !/[a-z0-9]{2,}/i.test(text);
  return h('button', { class: `btn ${cls}`, onclick: onClick, title, type: 'button', 'aria-label': title && iconOnly ? title : undefined }, label);
}

export function toast(msg: string, ms = 2200) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function modal(title: string, body: HTMLElement, actions: HTMLElement[] = []): { close: () => void; el: HTMLElement } {
  const close = () => overlay.remove();
  const overlay = h(
    'div',
    { class: 'modal-overlay', onclick: (e: Event) => e.target === overlay && close() },
    h('div', { class: 'modal' }, h('div', { class: 'modal-head' }, h('h2', {}, title), button('✕', close, 'icon ghost', 'Close')), h('div', { class: 'modal-body' }, body), actions.length ? h('div', { class: 'modal-actions' }, ...actions) : null),
  );
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  });
  document.body.append(overlay);
  return { close, el: overlay };
}

export function pickFile(accept: string, capture = false): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function download(name: string, data: Blob | string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 2000);
}
