import { IN, type Item, type ItemCategory, type LightProps, uid } from './model';

export interface CatalogEntry {
  kind: string;
  name: string;
  category: ItemCategory;
  /** inches */
  w: number;
  d: number;
  h: number;
  /** elevation above floor (inches) */
  y?: number;
  color: string;
  accent?: string;
  light?: Partial<LightProps>;
  countertop?: boolean;
  /** Mounts on the ceiling – y is computed from the ceiling height. */
  ceilingMount?: boolean;
  /** Snaps to walls by default (cabinets, appliances). */
  wallSnap?: boolean;
  icon: string;
  /** Size presets in inches (width) for cabinets etc. */
  widths?: number[];
}

const WOOD = '#8b5e3c';
const FABRIC = '#6f7d8c';
const CAB = '#f2efe8';
const STEEL = '#c9ccd1';

export const CATALOG: CatalogEntry[] = [
  // Furniture
  { kind: 'sofa', name: 'Sofa', category: 'furniture', w: 84, d: 36, h: 34, color: FABRIC, accent: '#4b3a2a', icon: '🛋️' },
  { kind: 'loveseat', name: 'Loveseat', category: 'furniture', w: 60, d: 35, h: 34, color: FABRIC, accent: '#4b3a2a', icon: '🛋️' },
  { kind: 'sectional', name: 'Sectional (L)', category: 'furniture', w: 110, d: 84, h: 34, color: FABRIC, accent: '#4b3a2a', icon: '🛋️' },
  { kind: 'armchair', name: 'Armchair', category: 'furniture', w: 34, d: 34, h: 36, color: '#a26b4f', accent: '#4b3a2a', icon: '💺' },
  { kind: 'coffee-table', name: 'Coffee Table', category: 'furniture', w: 48, d: 24, h: 18, color: WOOD, icon: '▭' },
  { kind: 'side-table', name: 'Side Table', category: 'furniture', w: 20, d: 20, h: 24, color: WOOD, icon: '▫' },
  { kind: 'dining-table', name: 'Dining Table', category: 'furniture', w: 72, d: 38, h: 30, color: WOOD, icon: '🍽️' },
  { kind: 'round-table', name: 'Round Table', category: 'furniture', w: 48, d: 48, h: 30, color: WOOD, icon: '⚪' },
  { kind: 'dining-chair', name: 'Dining Chair', category: 'furniture', w: 18, d: 21, h: 36, color: WOOD, accent: '#d8cbb8', icon: '🪑' },
  { kind: 'bar-stool', name: 'Bar Stool', category: 'furniture', w: 17, d: 17, h: 30, color: '#333333', accent: '#c19a6b', icon: '🪑' },
  { kind: 'bed', name: 'Queen Bed', category: 'furniture', w: 64, d: 84, h: 44, color: '#e8e4dc', accent: WOOD, icon: '🛏️' },
  { kind: 'bed-king', name: 'King Bed', category: 'furniture', w: 80, d: 84, h: 46, color: '#e8e4dc', accent: WOOD, icon: '🛏️' },
  { kind: 'bed-twin', name: 'Twin Bed', category: 'furniture', w: 41, d: 79, h: 40, color: '#dfe7ef', accent: WOOD, icon: '🛏️' },
  { kind: 'nightstand', name: 'Nightstand', category: 'furniture', w: 22, d: 16, h: 24, color: WOOD, icon: '▪' },
  { kind: 'dresser', name: 'Dresser', category: 'furniture', w: 60, d: 20, h: 32, color: WOOD, icon: '🗄️', wallSnap: true },
  { kind: 'wardrobe', name: 'Wardrobe', category: 'furniture', w: 40, d: 24, h: 78, color: WOOD, icon: '🚪', wallSnap: true },
  { kind: 'desk', name: 'Desk', category: 'furniture', w: 54, d: 26, h: 30, color: WOOD, icon: '🖥️', wallSnap: true },
  { kind: 'office-chair', name: 'Office Chair', category: 'furniture', w: 26, d: 26, h: 40, color: '#2e2e2e', icon: '💺' },
  { kind: 'bookshelf', name: 'Bookshelf', category: 'furniture', w: 36, d: 12, h: 72, color: WOOD, icon: '📚', wallSnap: true },
  { kind: 'tv-stand', name: 'TV Stand', category: 'furniture', w: 60, d: 18, h: 22, color: '#3d3a36', icon: '📺', wallSnap: true },
  { kind: 'tv', name: 'TV 65"', category: 'furniture', w: 57, d: 3, h: 33, y: 24, color: '#111111', icon: '📺' },

  // Kitchen cabinets
  { kind: 'base-cabinet', name: 'Base Cabinet', category: 'kitchen', w: 24, d: 24, h: 34.5, color: CAB, accent: '#888888', countertop: true, wallSnap: true, icon: '🗄️', widths: [9, 12, 15, 18, 21, 24, 27, 30, 33, 36] },
  { kind: 'drawer-base', name: 'Drawer Base', category: 'kitchen', w: 18, d: 24, h: 34.5, color: CAB, accent: '#888888', countertop: true, wallSnap: true, icon: '🗄️', widths: [12, 15, 18, 21, 24, 30, 36] },
  { kind: 'sink-base', name: 'Sink Base + Sink', category: 'kitchen', w: 36, d: 24, h: 34.5, color: CAB, accent: '#888888', countertop: true, wallSnap: true, icon: '🚰', widths: [30, 33, 36, 42] },
  { kind: 'corner-base', name: 'Corner Base', category: 'kitchen', w: 36, d: 36, h: 34.5, color: CAB, accent: '#888888', countertop: true, wallSnap: true, icon: '◢' },
  { kind: 'wall-cabinet', name: 'Wall Cabinet', category: 'kitchen', w: 30, d: 12, h: 30, y: 54, color: CAB, accent: '#888888', wallSnap: true, icon: '▭', widths: [9, 12, 15, 18, 21, 24, 27, 30, 33, 36] },
  { kind: 'tall-pantry', name: 'Tall Pantry', category: 'kitchen', w: 24, d: 24, h: 84, color: CAB, accent: '#888888', wallSnap: true, icon: '🚪', widths: [18, 24, 30, 36] },
  { kind: 'island', name: 'Kitchen Island', category: 'kitchen', w: 72, d: 36, h: 34.5, color: '#46586b', accent: '#888888', countertop: true, icon: '⬛' },
  { kind: 'open-shelf', name: 'Open Shelf', category: 'kitchen', w: 36, d: 10, h: 2, y: 60, color: WOOD, wallSnap: true, icon: '➖' },

  // Appliances
  { kind: 'refrigerator', name: 'Refrigerator', category: 'appliance', w: 36, d: 30, h: 70, color: STEEL, accent: '#555555', wallSnap: true, icon: '🧊', widths: [30, 33, 36] },
  { kind: 'range', name: 'Range / Stove', category: 'appliance', w: 30, d: 26, h: 36, color: STEEL, accent: '#222222', wallSnap: true, icon: '🔥', widths: [30, 36, 48] },
  { kind: 'cooktop', name: 'Cooktop', category: 'appliance', w: 30, d: 21, h: 1, y: 36, color: '#1b1b1b', wallSnap: true, icon: '♨️' },
  { kind: 'wall-oven', name: 'Wall Oven (double)', category: 'appliance', w: 30, d: 24, h: 84, color: CAB, accent: STEEL, wallSnap: true, icon: '🔲' },
  { kind: 'dishwasher', name: 'Dishwasher', category: 'appliance', w: 24, d: 24, h: 34.5, color: STEEL, accent: '#333333', countertop: true, wallSnap: true, icon: '🍽️' },
  { kind: 'microwave', name: 'Over-Range Microwave', category: 'appliance', w: 30, d: 16, h: 17, y: 66, color: STEEL, accent: '#111111', wallSnap: true, icon: '📦' },
  { kind: 'range-hood', name: 'Range Hood', category: 'appliance', w: 30, d: 20, h: 30, y: 60, color: STEEL, wallSnap: true, icon: '🔺' },
  { kind: 'washer', name: 'Washer', category: 'appliance', w: 27, d: 30, h: 38, color: '#f4f4f4', accent: '#666666', wallSnap: true, icon: '🫧' },
  { kind: 'dryer', name: 'Dryer', category: 'appliance', w: 27, d: 30, h: 38, color: '#f4f4f4', accent: '#666666', wallSnap: true, icon: '🌀' },

  // Bath
  { kind: 'toilet', name: 'Toilet', category: 'bath', w: 20, d: 28, h: 30, color: '#ffffff', wallSnap: true, icon: '🚽' },
  { kind: 'vanity', name: 'Vanity + Sink', category: 'bath', w: 36, d: 21, h: 34, color: '#ffffff', accent: '#999999', countertop: true, wallSnap: true, icon: '🚰', widths: [24, 30, 36, 48, 60, 72] },
  { kind: 'bathtub', name: 'Bathtub', category: 'bath', w: 60, d: 30, h: 20, color: '#ffffff', wallSnap: true, icon: '🛁' },
  { kind: 'shower', name: 'Shower', category: 'bath', w: 36, d: 36, h: 80, color: '#dfeef5', accent: '#c0c0c0', wallSnap: true, icon: '🚿' },
  { kind: 'mirror', name: 'Mirror', category: 'bath', w: 30, d: 1, h: 36, y: 40, color: '#cfe3ea', accent: '#333333', wallSnap: true, icon: '🪞' },

  // Lighting
  { kind: 'ceiling-light', name: 'Flush Ceiling Light', category: 'lighting', w: 14, d: 14, h: 6, color: '#ffffff', ceilingMount: true, light: { kind: 'point', intensity: 6, range: 8 }, icon: '💡' },
  { kind: 'recessed', name: 'Recessed Light', category: 'lighting', w: 6, d: 6, h: 1, color: '#ffffff', ceilingMount: true, light: { kind: 'spot', intensity: 8, range: 7 }, icon: '🔘' },
  { kind: 'pendant', name: 'Pendant', category: 'lighting', w: 12, d: 12, h: 30, color: '#2c2c2c', accent: '#ffe7b0', ceilingMount: true, light: { kind: 'point', intensity: 5, range: 6 }, icon: '🔦' },
  { kind: 'chandelier', name: 'Chandelier', category: 'lighting', w: 28, d: 28, h: 30, color: '#b8913a', ceilingMount: true, light: { kind: 'point', intensity: 9, range: 10 }, icon: '🕯️' },
  { kind: 'ceiling-fan', name: 'Ceiling Fan + Light', category: 'lighting', w: 52, d: 52, h: 14, color: '#6b4f36', accent: '#ffffff', ceilingMount: true, light: { kind: 'point', intensity: 6, range: 8 }, icon: '🌀' },
  { kind: 'wall-sconce', name: 'Wall Sconce', category: 'lighting', w: 6, d: 7, h: 12, y: 66, color: '#b8913a', wallSnap: true, light: { kind: 'point', intensity: 2.5, range: 4 }, icon: '🕯️' },
  { kind: 'floor-lamp', name: 'Floor Lamp', category: 'lighting', w: 16, d: 16, h: 64, color: '#222222', accent: '#f3e9d2', light: { kind: 'point', intensity: 3, range: 5 }, icon: '🪔' },
  { kind: 'table-lamp', name: 'Table Lamp', category: 'lighting', w: 12, d: 12, h: 22, y: 24, color: '#9a8c7a', accent: '#f3e9d2', light: { kind: 'point', intensity: 2, range: 4 }, icon: '🪔' },
  { kind: 'under-cabinet', name: 'Under-Cabinet LED', category: 'lighting', w: 24, d: 2, h: 1, y: 53.5, color: '#eeeeee', wallSnap: true, light: { kind: 'point', intensity: 1.5, range: 2.5 }, icon: '➖' },

  // Decor
  { kind: 'rug', name: 'Area Rug', category: 'decor', w: 96, d: 60, h: 0.5, color: '#a8413a', accent: '#e9d8b4', icon: '🟥' },
  { kind: 'plant', name: 'Potted Plant', category: 'decor', w: 18, d: 18, h: 48, color: '#3f7d3a', accent: '#b5651d', icon: '🪴' },
  { kind: 'wall-art', name: 'Wall Art', category: 'decor', w: 36, d: 1.5, h: 24, y: 54, color: '#e0b25a', accent: '#222222', wallSnap: true, icon: '🖼️' },
  { kind: 'curtains', name: 'Curtains', category: 'decor', w: 72, d: 4, h: 90, y: 2, color: '#d9cdb8', wallSnap: true, icon: '🪟' },

  // Primitive shapes for custom pieces
  { kind: 'box', name: 'Box / Block', category: 'custom', w: 24, d: 24, h: 24, color: '#9aa7b4', icon: '⬜' },
  { kind: 'cylinder', name: 'Cylinder', category: 'custom', w: 24, d: 24, h: 30, color: '#9aa7b4', icon: '⚫' },
  { kind: 'column', name: 'Column', category: 'custom', w: 12, d: 12, h: 96, color: '#ffffff', icon: '🏛️' },
  { kind: 'half-wall', name: 'Half Wall', category: 'custom', w: 60, d: 4.5, h: 42, color: '#ece6dc', icon: '▬' },
  { kind: 'stairs', name: 'Stairs', category: 'custom', w: 36, d: 120, h: 108, color: WOOD, icon: '🪜' },
];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  furniture: 'Furniture',
  kitchen: 'Cabinets',
  appliance: 'Appliances',
  bath: 'Bath',
  lighting: 'Lighting',
  decor: 'Decor',
  custom: 'Shapes & Imports',
};

export function catalogEntry(kind: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.kind === kind);
}

export function createItem(entry: CatalogEntry, x: number, z: number, overrides: Partial<Item> = {}): Item {
  const shape = entry.kind === 'box' ? 'box' : entry.kind === 'cylinder' || entry.kind === 'column' ? 'cylinder' : entry.kind === 'sectional' ? 'l-shape' : 'model';
  const item: Item = {
    id: uid('item'),
    kind: entry.kind,
    name: entry.name,
    category: entry.category,
    x,
    z,
    y: (entry.y ?? 0) * IN,
    rotation: 0,
    width: entry.w * IN,
    depth: entry.d * IN,
    height: entry.h * IN,
    color: entry.color,
    accent: entry.accent ?? '#666666',
    shape,
    legRatio: entry.kind === 'sectional' ? 0.36 : undefined,
    countertop: entry.countertop,
    countertopColor: entry.countertop ? '#e9e6e1' : undefined,
    light: entry.light
      ? { kind: entry.light.kind ?? 'point', color: '#ffe2b8', intensity: entry.light.intensity ?? 4, range: entry.light.range ?? 6, on: true }
      : undefined,
    ...overrides,
  };
  return item;
}

export function isCeilingMounted(kind: string): boolean {
  return !!catalogEntry(kind)?.ceilingMount;
}
