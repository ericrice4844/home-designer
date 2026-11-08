// "Style & shape" section of the item panel: choice chips and shape sliders from itemStyles.ts.
import { pointInPolygon } from '../geometry';
import { getStyle, hasCabinetStyle, styleOptions, type StyleOption } from '../itemStyles';
import type { Item } from '../model';
import { store } from '../state';
import { formatLength } from '../units';
import { button, field, fieldGroup, h, section, slider, toast } from './dom';

const IN = 0.0254;

function setStyle(it: Item, key: string, value: string | number, live = false) {
  const apply = (q: Item) => {
    q.style = { ...(q.style ?? {}), [key]: value };
    // a taller headboard needs a taller box so it isn't clipped
    if (key === 'headboardHeight' && typeof value === 'number') q.height = Math.max(q.height, value * IN);
  };
  if (live) {
    const q = store.project.items.find((i) => i.id === it.id);
    if (q) apply(q);
  } else
    store.update((p) => {
      const q = p.items.find((i) => i.id === it.id);
      if (q) apply(q);
    });
}

function optionControl(it: Item, o: StyleOption, value: string | number): HTMLElement {
  if (o.type === 'choice')
    return fieldGroup(
      o.label,
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': o.label }, ...o.options.map(([v, l]) => {
        const b = button(l, () => setStyle(it, o.key, v), `chip ${value === v ? 'active' : ''}`);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(value === v));
        return b;
      })),
    );
  const fmt = (v: number) => (o.unit === 'in' ? formatLength(v * IN, store.project.settings.units) : o.unit === 'count' ? (v === 0 ? 'Auto' : String(v)) : `${v}%`);
  const s = slider(Number(value), o.min, o.max, o.step, (v) => setStyle(it, o.key, v, true), fmt);
  s.querySelector('input')?.setAttribute('aria-label', o.label);
  return field(o.label, s);
}

/** Style & shape section for an item, or null when the kind has no options. */
export function styleSection(it: Item): HTMLElement | null {
  const opts = styleOptions(it.kind);
  if (!opts.length) return null;
  const st = getStyle(it);
  const sec = section('Style & shape', ...opts.map((o) => optionControl(it, o, st[o.key])));
  if (it.style && Object.keys(it.style).length)
    sec.append(button('Reset to default style', () => store.update((p) => {
      const q = p.items.find((i) => i.id === it.id);
      if (q) delete q.style;
    }), 'small ghost'));
  if (hasCabinetStyle(it.kind)) {
    sec.append(
      button('Use this door style & hardware on all cabinets in the room', () => {
        const n = applyCabinetStyle(it);
        toast(n ? `Updated ${n} cabinet${n > 1 ? 's' : ''}` : 'No other cabinets in this room');
      }, 'small'),
    );
  }
  return sec;
}

/** Copy door style & hardware from one cabinet to every cabinet-styled piece in the same room. */
export function applyCabinetStyle(src: Item): number {
  const st = getStyle(src);
  const room = store.project.rooms.find((r) => pointInPolygon({ x: src.x, z: src.z }, r.points));
  let n = 0;
  store.update((p) => {
    for (const q of p.items) {
      if (q.id === src.id || !hasCabinetStyle(q.kind)) continue;
      if (room && !pointInPolygon({ x: q.x, z: q.z }, room.points)) continue;
      const keys = styleOptions(q.kind).map((o) => o.key);
      const next = { ...(q.style ?? {}) };
      for (const k of ['door', 'pull']) if (keys.includes(k) && st[k] !== undefined) next[k] = st[k];
      q.style = next;
      n++;
    }
  });
  return n;
}

/**
 * Copy a cabinet's materials (body, handles, countertop) to the other cabinets in its room.
 * Returns how many were changed.
 */
export function applyCabinetFinishes(src: Item): number {
  const room = store.project.rooms.find((r) => pointInPolygon({ x: src.x, z: src.z }, r.points));
  let n = 0;
  store.update((p) => {
    for (const q of p.items) {
      if (q.id === src.id || q.category !== 'kitchen') continue;
      if (room && !pointInPolygon({ x: q.x, z: q.z }, room.points)) continue;
      for (const [k, c] of [['finish', 'color'], ['accentFinish', 'accent']] as const) {
        const f = src[k];
        if (f) {
          q[k] = { ...f };
          q[c] = f.color;
        }
      }
      if (src.counterFinish && (q.countertop || q.kind === 'island')) {
        q.counterFinish = { ...src.counterFinish };
        q.countertopColor = src.counterFinish.color;
      }
      n++;
    }
  });
  return n;
}
