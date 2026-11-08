// Style & shape options per kind of item (cabinet door styles, pulls, appliance types, furniture shapes…).
// Items store only what differs from the defaults in `item.style`.
import type { Item } from './model';

export type StyleOption =
  | { key: string; label: string; type: 'choice'; options: [string, string][]; default: string }
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; default: number; unit: 'in' | 'count' | '%' };

export type StyleValues = Record<string, string | number>;

const choice = (key: string, label: string, options: [string, string][], def?: string): StyleOption => ({ key, label, type: 'choice', options, default: def ?? options[0][0] });
const range = (key: string, label: string, min: number, max: number, step: number, def: number, unit: 'in' | 'count' | '%' = 'in'): StyleOption => ({ key, label, type: 'range', min, max, step, default: def, unit });

export const DOOR_STYLES: [string, string][] = [
  ['shaker', 'Shaker'],
  ['slab', 'Slab / flat'],
  ['raised', 'Raised panel'],
  ['beadboard', 'Beadboard'],
  ['glass', 'Glass front'],
];
export const PULL_STYLES: [string, string][] = [
  ['bar', 'Bar pull'],
  ['knob', 'Knob'],
  ['cup', 'Cup pull'],
  ['edge', 'Edge / tab pull'],
  ['none', 'No hardware (push)'],
];

const CABINET: StyleOption[] = [choice('door', 'Door style', DOOR_STYLES), choice('pull', 'Hardware', PULL_STYLES), choice('base', 'Base', [['toe-kick', 'Toe kick'], ['legs', 'Furniture legs']])];
const UPPER: StyleOption[] = [choice('door', 'Door style', DOOR_STYLES), choice('pull', 'Hardware', PULL_STYLES)];

const SOFA: StyleOption[] = [
  choice('arms', 'Arms', [['track', 'Track (square)'], ['rolled', 'Rolled'], ['slope', 'Sloped'], ['none', 'Armless']]),
  range('armWidth', 'Arm width', 2, 12, 0.5, 6),
  choice('back', 'Back', [['cushion', 'Loose cushions'], ['tight', 'Tight back'], ['channel', 'Channel tufted']]),
  range('seatHeight', 'Seat height', 14, 22, 0.5, 18),
  range('cushions', 'Seat cushions', 0, 4, 1, 0, 'count'),
  choice('legs', 'Legs', [['tapered', 'Tapered wood'], ['block', 'Block'], ['metal', 'Metal'], ['skirt', 'Skirted (hidden)']]),
];

const STYLES: Record<string, StyleOption[]> = {
  'base-cabinet': CABINET,
  'drawer-base': CABINET,
  'sink-base': [...CABINET, choice('sink', 'Sink', [['undermount', 'Undermount'], ['farmhouse', 'Farmhouse apron'], ['double', 'Double bowl']])],
  'corner-base': CABINET,
  island: CABINET,
  vanity: [...CABINET, choice('sink', 'Basin', [['undermount', 'Undermount'], ['vessel', 'Vessel bowl'], ['double', 'Double sink']])],
  'wall-cabinet': UPPER,
  'tall-pantry': UPPER,
  'wall-oven': [choice('config', 'Configuration', [['double', 'Double oven'], ['combo', 'Oven + microwave'], ['single', 'Single oven']]), choice('pull', 'Cabinet hardware', PULL_STYLES)],
  refrigerator: [choice('type', 'Type', [['french', 'French door'], ['side', 'Side-by-side'], ['bottom', 'Bottom freezer'], ['top', 'Top freezer'], ['panel', 'Panel-ready (matches cabinets)']])],
  range: [choice('type', 'Type', [['gas', 'Gas'], ['electric', 'Electric (smooth top)'], ['induction', 'Induction'], ['pro', 'Pro style (gas, griddle)']])],
  cooktop: [choice('type', 'Type', [['electric', 'Electric'], ['gas', 'Gas'], ['induction', 'Induction']])],
  'range-hood': [choice('type', 'Type', [['chimney', 'Chimney'], ['canopy', 'Canopy / pyramid'], ['insert', 'Under-cabinet insert'], ['wood', 'Wood mantel']])],
  dishwasher: [choice('front', 'Front', [['stainless', 'Appliance finish'], ['panel', 'Panel-ready (matches cabinets)']])],
  sofa: SOFA,
  loveseat: SOFA,
  armchair: SOFA,
  sectional: [...SOFA, choice('chaise', 'Chaise side', [['left', 'Left'], ['right', 'Right']])],
  bed: [
    choice('headboard', 'Headboard', [['panel', 'Wood panel'], ['upholstered', 'Upholstered'], ['tufted', 'Tufted'], ['slat', 'Slatted'], ['wingback', 'Wingback'], ['none', 'None']]),
    range('headboardHeight', 'Headboard height', 30, 66, 1, 44),
    choice('footboard', 'Footboard', [['none', 'None'], ['low', 'Low'], ['panel', 'Panel']]),
    choice('frame', 'Frame', [['platform', 'Platform'], ['legs', 'On legs'], ['storage', 'Storage drawers']]),
  ],
  'dining-table': [
    choice('top', 'Top shape', [['rect', 'Rectangle'], ['oval', 'Oval'], ['racetrack', 'Racetrack'], ['round', 'Round']]),
    choice('base', 'Base', [['legs', 'Four legs'], ['pedestal', 'Pedestal'], ['trestle', 'Trestle'], ['hairpin', 'Hairpin metal']]),
    range('topThickness', 'Top thickness', 0.75, 3, 0.25, 1.5),
  ],
  'coffee-table': [
    choice('top', 'Top shape', [['rect', 'Rectangle'], ['oval', 'Oval'], ['round', 'Round'], ['racetrack', 'Racetrack']]),
    choice('base', 'Base', [['legs', 'Four legs'], ['pedestal', 'Pedestal'], ['hairpin', 'Hairpin metal'], ['shelf', 'With lower shelf']]),
    range('topThickness', 'Top thickness', 0.75, 3, 0.25, 1.5),
  ],
  'side-table': [choice('top', 'Top shape', [['rect', 'Square'], ['round', 'Round']]), choice('base', 'Base', [['legs', 'Four legs'], ['pedestal', 'Pedestal'], ['shelf', 'With lower shelf']])],
  'round-table': [choice('top', 'Top shape', [['round', 'Round'], ['oval', 'Oval']]), choice('base', 'Base', [['pedestal', 'Pedestal'], ['legs', 'Four legs'], ['tulip', 'Tulip']])],
  desk: [choice('base', 'Base', [['pedestal', 'Drawer pedestal'], ['legs', 'Four legs'], ['trestle', 'Trestle']])],
  'dining-chair': [choice('back', 'Back', [['slat', 'Slatted'], ['ladder', 'Ladder'], ['solid', 'Solid'], ['upholstered', 'Upholstered']]), choice('arms', 'Arms', [['none', 'No arms'], ['arms', 'With arms']])],
  'bar-stool': [choice('back', 'Back', [['none', 'Backless'], ['low', 'Low back'], ['full', 'Full back']])],
  toilet: [choice('type', 'Type', [['two-piece', 'Two-piece'], ['one-piece', 'One-piece'], ['wall-hung', 'Wall-hung']])],
  bathtub: [choice('type', 'Type', [['alcove', 'Alcove'], ['freestanding', 'Freestanding'], ['clawfoot', 'Clawfoot']])],
  dresser: [choice('pull', 'Hardware', PULL_STYLES, 'knob'), choice('base', 'Base', [['legs', 'Short legs'], ['plinth', 'Plinth'], ['tall-legs', 'Tall legs']])],
  nightstand: [choice('pull', 'Hardware', PULL_STYLES, 'knob'), choice('base', 'Base', [['legs', 'Short legs'], ['plinth', 'Plinth'], ['tall-legs', 'Tall legs']])],
};

STYLES['bed-king'] = STYLES.bed;
STYLES['bed-twin'] = STYLES.bed;

/** Style & shape options for a kind (empty if it has none). */
export function styleOptions(kind: string): StyleOption[] {
  return STYLES[kind] ?? [];
}

/** All of an item's style values, defaults filled in. */
export function getStyle(it: Pick<Item, 'kind' | 'style'>): StyleValues {
  const out: StyleValues = {};
  for (const o of styleOptions(it.kind)) out[o.key] = o.default;
  for (const [k, v] of Object.entries(it.style ?? {})) if (k in out) out[k] = v;
  return out;
}

/** Keep only known keys with valid values (used when loading files). */
export function sanitizeStyle(kind: string, raw: unknown): StyleValues | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: StyleValues = {};
  for (const o of styleOptions(kind)) {
    const v = (raw as Record<string, unknown>)[o.key];
    if (o.type === 'choice' && typeof v === 'string' && o.options.some(([x]) => x === v)) out[o.key] = v;
    if (o.type === 'range' && typeof v === 'number' && Number.isFinite(v)) out[o.key] = Math.max(o.min, Math.min(o.max, v));
  }
  return Object.keys(out).length ? out : undefined;
}

/** Kinds that share cabinet door/hardware styles (for "apply to the whole kitchen"). */
export function hasCabinetStyle(kind: string): boolean {
  return styleOptions(kind).some((o) => o.key === 'door' || o.key === 'pull');
}
