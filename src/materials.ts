// Surface materials: the patterns, the named material presets (Oak, Carrara marble…) and helpers
// shared by floors, walls, ceilings, cabinets, countertops and furniture.
import { FINISH_TYPES, type Finish, type FloorType, type Room } from './model';

const IN = 0.0254;

export type FinishGroup = 'wood' | 'tile' | 'stone' | 'other';
export type Surface = 'floor' | 'wall' | 'ceiling' | 'item' | 'counter';

export interface PatternInfo {
  label: string;
  group: FinishGroup;
  /** what the size field measures */
  sizeLabel: string;
  /** label of the accent color */
  accentLabel: string;
  /** how shiny it looks (MeshStandardMaterial roughness) */
  roughness: number;
  /** default look when the pattern is picked on its own */
  defaults: { color: string; accent: string; scale: number; rotation?: number };
}

export const PATTERNS: Record<FloorType, PatternInfo> = {
  hardwood: { label: 'Strip plank', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Grain & seams', roughness: 0.5, defaults: { color: '#b07a4a', accent: '#8a5a32', scale: 4 * IN } },
  'wide-plank': { label: 'Wide plank', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Grain & seams', roughness: 0.55, defaults: { color: '#c9a77c', accent: '#9b7a52', scale: 8 * IN } },
  laminate: { label: 'Laminate', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Grain & seams', roughness: 0.45, defaults: { color: '#c49a6c', accent: '#9a7650', scale: 7 * IN } },
  vinyl: { label: 'Vinyl plank', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Grain & seams', roughness: 0.5, defaults: { color: '#a9a39a', accent: '#7f786e', scale: 7 * IN } },
  herringbone: { label: 'Herringbone', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Seams', roughness: 0.5, defaults: { color: '#b48a5e', accent: '#7f5c3a', scale: 4 * IN, rotation: Math.PI / 4 } },
  chevron: { label: 'Chevron', group: 'wood', sizeLabel: 'Board width', accentLabel: 'Seams', roughness: 0.5, defaults: { color: '#a77b52', accent: '#6f4f31', scale: 4 * IN } },
  parquet: { label: 'Parquet', group: 'wood', sizeLabel: 'Slat width', accentLabel: 'Seams', roughness: 0.5, defaults: { color: '#b98a58', accent: '#7c5733', scale: 2.5 * IN } },
  tile: { label: 'Square tile', group: 'tile', sizeLabel: 'Tile size', accentLabel: 'Grout', roughness: 0.3, defaults: { color: '#e6e1d8', accent: '#b9b2a5', scale: 12 * IN } },
  subway: { label: 'Subway', group: 'tile', sizeLabel: 'Tile height', accentLabel: 'Grout', roughness: 0.2, defaults: { color: '#f4f2ee', accent: '#c9c4bb', scale: 3 * IN } },
  hex: { label: 'Hexagon', group: 'tile', sizeLabel: 'Tile width', accentLabel: 'Grout', roughness: 0.3, defaults: { color: '#f1f0ec', accent: '#a9a59e', scale: 4 * IN } },
  mosaic: { label: 'Mosaic', group: 'tile', sizeLabel: 'Chip size', accentLabel: 'Grout', roughness: 0.25, defaults: { color: '#7fa6b8', accent: '#e8e6e0', scale: 1 * IN } },
  penny: { label: 'Penny round', group: 'tile', sizeLabel: 'Round size', accentLabel: 'Grout', roughness: 0.25, defaults: { color: '#f2f1ed', accent: '#a7a39b', scale: 0.75 * IN } },
  checker: { label: 'Checkerboard', group: 'tile', sizeLabel: 'Tile size', accentLabel: 'Second color', roughness: 0.3, defaults: { color: '#f4f4f4', accent: '#2d2d2d', scale: 12 * IN } },
  brick: { label: 'Brick', group: 'tile', sizeLabel: 'Brick height', accentLabel: 'Mortar', roughness: 0.85, defaults: { color: '#a5523c', accent: '#d5cdc0', scale: 2.5 * IN } },
  stone: { label: 'Stone tile', group: 'stone', sizeLabel: 'Tile size', accentLabel: 'Grout', roughness: 0.45, defaults: { color: '#d6d0c4', accent: '#a69f92', scale: 18 * IN } },
  marble: { label: 'Marble', group: 'stone', sizeLabel: 'Slab size', accentLabel: 'Veins', roughness: 0.15, defaults: { color: '#eeeeea', accent: '#8f959c', scale: 0.9 } },
  granite: { label: 'Granite / quartz', group: 'stone', sizeLabel: 'Repeat size', accentLabel: 'Flecks', roughness: 0.2, defaults: { color: '#3a3a3c', accent: '#b9b6b0', scale: 0.6 } },
  terrazzo: { label: 'Terrazzo', group: 'stone', sizeLabel: 'Repeat size', accentLabel: 'Chips', roughness: 0.25, defaults: { color: '#e9e4dc', accent: '#7d848c', scale: 0.6 } },
  flagstone: { label: 'Flagstone', group: 'stone', sizeLabel: 'Stone size', accentLabel: 'Grout', roughness: 0.8, defaults: { color: '#7a7d7a', accent: '#4c4e4b', scale: 14 * IN } },
  concrete: { label: 'Concrete', group: 'other', sizeLabel: 'Repeat size', accentLabel: 'Accent', roughness: 0.6, defaults: { color: '#a6a6a2', accent: '#8c8c88', scale: 0.4 } },
  carpet: { label: 'Carpet', group: 'other', sizeLabel: 'Repeat size', accentLabel: 'Accent', roughness: 1, defaults: { color: '#c9c0b3', accent: '#a69c8e', scale: 0.2 } },
  custom: { label: 'Imported pattern', group: 'other', sizeLabel: 'Pattern repeat', accentLabel: 'Accent', roughness: 0.5, defaults: { color: '#cccccc', accent: '#999999', scale: 1 } },
};

export const GROUPS: [FinishGroup, string][] = [
  ['wood', 'Wood'],
  ['tile', 'Tile & brick'],
  ['stone', 'Stone'],
  ['other', 'Other'],
];

export interface MaterialPreset {
  id: string;
  name: string;
  group: FinishGroup;
  /** surfaces it is offered on (all when omitted) */
  for?: Surface[];
  finish: Omit<Finish, 'preset'>;
}

const P = (id: string, name: string, type: FloorType, color: string, accent: string, scaleIn: number, extra: Partial<MaterialPreset> & { rotation?: number; m?: boolean } = {}): MaterialPreset => ({
  id,
  name,
  group: PATTERNS[type].group,
  ...(extra.for ? { for: extra.for } : {}),
  finish: { type, color, accent, scale: extra.m ? scaleIn : scaleIn * IN, rotation: extra.rotation ?? 0 },
});
const DEG90 = Math.PI / 2;
const FLOORS: Surface[] = ['floor'];
const NOT_COUNTER: Surface[] = ['floor', 'wall', 'ceiling', 'item'];
const SURFACE_ONLY: Surface[] = ['floor', 'wall', 'ceiling'];

/** Named looks: each brings its own pattern, colors and size. */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  // wood
  P('oak', 'Natural oak', 'hardwood', '#c19a6b', '#957047', 3, { for: NOT_COUNTER }),
  P('white-oak', 'White oak, wide', 'wide-plank', '#d2b48c', '#a88b62', 7, { for: NOT_COUNTER }),
  P('walnut', 'Walnut', 'hardwood', '#6b4a33', '#47301f', 5),
  P('maple', 'Maple', 'hardwood', '#e0c9a6', '#c2a47b', 3),
  P('cherry', 'Cherry', 'hardwood', '#9c5a3c', '#713c25', 4, { for: NOT_COUNTER }),
  P('hickory', 'Rustic hickory', 'wide-plank', '#b98b5e', '#77502f', 6, { for: NOT_COUNTER }),
  P('gray-wash', 'Gray-washed oak', 'wide-plank', '#a9a39a', '#80796f', 7, { for: NOT_COUNTER }),
  P('whitewash', 'Whitewashed pine', 'wide-plank', '#e6ddd0', '#c6b8a4', 7, { for: NOT_COUNTER }),
  P('ebony', 'Ebony', 'hardwood', '#3b2f2a', '#211913', 5, { for: NOT_COUNTER }),
  P('teak', 'Teak', 'hardwood', '#a8763e', '#7a5126', 4),
  P('bamboo', 'Bamboo', 'hardwood', '#d9b97a', '#b39050', 2.5, { for: NOT_COUNTER }),
  P('butcher-block', 'Butcher block', 'hardwood', '#c99a64', '#9b6f40', 1.5, { for: ['counter', 'item'] }),
  P('oak-herringbone', 'Oak herringbone', 'herringbone', '#b48a5e', '#7f5c3a', 3.5, { rotation: Math.PI / 4, for: SURFACE_ONLY }),
  P('walnut-herringbone', 'Walnut herringbone', 'herringbone', '#6e4b33', '#3f2a1b', 3.5, { rotation: Math.PI / 4, for: SURFACE_ONLY }),
  P('oak-chevron', 'Oak chevron', 'chevron', '#bf9667', '#86613c', 4, { for: SURFACE_ONLY }),
  P('smoked-chevron', 'Smoked chevron', 'chevron', '#7d6450', '#4f3d2f', 4, { for: SURFACE_ONLY }),
  P('parquet', 'Classic parquet', 'parquet', '#b98a58', '#7c5733', 2.5, { for: SURFACE_ONLY }),
  P('laminate-oak', 'Oak laminate', 'laminate', '#c49a6c', '#9a7650', 7, { for: FLOORS }),
  P('vinyl-gray', 'Gray vinyl plank', 'vinyl', '#a9a39a', '#7f786e', 7, { for: FLOORS }),
  P('shiplap', 'White shiplap', 'wide-plank', '#f2f0ea', '#c9c4b9', 6, { rotation: DEG90, for: ['wall', 'ceiling'] }),
  P('beadboard', 'Beadboard', 'hardwood', '#f4f2ec', '#cfcac0', 2, { for: ['wall', 'ceiling', 'item'] }),
  P('cedar-ceiling', 'Cedar tongue & groove', 'hardwood', '#b8774a', '#86502c', 4, { rotation: DEG90, for: ['wall', 'ceiling'] }),
  // tile & brick
  P('white-tile', 'White square tile', 'tile', '#f0eee9', '#c9c4bb', 12, { for: SURFACE_ONLY }),
  P('porcelain-gray', 'Large gray porcelain', 'tile', '#9d9b97', '#7d7b77', 24, { for: SURFACE_ONLY }),
  P('terracotta', 'Terracotta', 'tile', '#b5653f', '#d8c3a5', 12, { for: SURFACE_ONLY }),
  P('subway-white', 'White subway', 'subway', '#f4f2ee', '#c9c4bb', 3, { for: SURFACE_ONLY }),
  P('subway-sage', 'Sage subway', 'subway', '#a8b5a0', '#e6e3dc', 3, { for: SURFACE_ONLY }),
  P('subway-navy', 'Navy subway', 'subway', '#2f4058', '#d9d6cf', 3, { for: SURFACE_ONLY }),
  P('hex-white', 'White hexagon', 'hex', '#f1f0ec', '#a9a59e', 3, { for: SURFACE_ONLY }),
  P('hex-charcoal', 'Charcoal hexagon', 'hex', '#3d3f42', '#c9c6c0', 8, { for: SURFACE_ONLY }),
  P('mosaic-blue', 'Blue glass mosaic', 'mosaic', '#7fa6b8', '#e8e6e0', 1, { for: SURFACE_ONLY }),
  P('penny-white', 'White penny round', 'penny', '#f2f1ed', '#a7a39b', 0.75, { for: SURFACE_ONLY }),
  P('checker-bw', 'Black & white check', 'checker', '#f4f4f4', '#2d2d2d', 12, { for: SURFACE_ONLY }),
  P('brick-red', 'Red brick', 'brick', '#a5523c', '#d5cdc0', 2.5, { for: SURFACE_ONLY }),
  P('brick-white', 'Painted white brick', 'brick', '#ebe8e2', '#cfcac2', 2.5, { for: SURFACE_ONLY }),
  // stone
  P('carrara', 'Carrara marble', 'marble', '#eeeeea', '#8f959c', 0.9, { m: true }),
  P('calacatta', 'Calacatta marble', 'marble', '#f3efe6', '#a88d5c', 1.1, { m: true }),
  P('nero', 'Nero marquina', 'marble', '#1f1f22', '#d6d6d6', 0.9, { m: true }),
  P('quartz-white', 'White quartz', 'granite', '#f1f0ec', '#c8c5bf', 0.5, { m: true }),
  P('granite-black', 'Black granite', 'granite', '#2b2b2d', '#9c9a96', 0.5, { m: true }),
  P('granite-salt', 'Salt & pepper granite', 'granite', '#b9b6b0', '#3b3a38', 0.5, { m: true }),
  P('terrazzo', 'Terrazzo', 'terrazzo', '#e9e4dc', '#7d848c', 0.6, { m: true }),
  P('travertine', 'Travertine', 'stone', '#d9c7a8', '#b4a283', 18, { for: SURFACE_ONLY }),
  P('slate', 'Slate flagstone', 'flagstone', '#5a5f61', '#3d4143', 14, { for: SURFACE_ONLY }),
  P('limestone', 'Limestone flagstone', 'flagstone', '#cdbfa6', '#9f927a', 16, { for: SURFACE_ONLY }),
  // other
  P('concrete', 'Polished concrete', 'concrete', '#a6a6a2', '#8c8c88', 0.4, { m: true }),
  P('carpet-beige', 'Beige carpet', 'carpet', '#c9c0b3', '#a69c8e', 0.2, { m: true, for: FLOORS }),
  P('carpet-gray', 'Gray carpet', 'carpet', '#8e8f91', '#6f7072', 0.2, { m: true, for: FLOORS }),
];

export function presetsFor(surface: Surface, group?: FinishGroup): MaterialPreset[] {
  return MATERIAL_PRESETS.filter((p) => (!p.for || p.for.includes(surface)) && (!group || p.group === group));
}

export function presetById(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find((p) => p.id === id);
}

/** A finish from a preset: the preset's own pattern, colors and size. */
export function finishFromPreset(p: MaterialPreset): Finish {
  return { ...p.finish, preset: p.id };
}

/**
 * Switch to another pattern: it brings its own colors and size (an imported image is kept so it can be
 * switched back to). Picking the same pattern changes nothing.
 */
export function withPattern(f: Finish | undefined, type: FloorType): Finish {
  if (f && f.type === type) return f;
  const d = PATTERNS[type].defaults;
  const next: Finish = { type, color: d.color, accent: d.accent, scale: d.scale, rotation: d.rotation ?? 0 };
  if (f?.imageAsset) next.imageAsset = f.imageAsset;
  if (f?.accents === false) next.accents = false;
  return next;
}

/** Changing a color by hand makes it a custom mix of the preset. */
export function withColor(f: Finish, key: 'color' | 'accent', color: string): Finish {
  const { preset, ...rest } = f;
  void preset;
  return { ...rest, [key]: color };
}

/** The material a wall is finished in: its own, else the room's (unless it has its own paint color). */
export function wallFinishOf(room: Room, index: number): Finish | undefined {
  return room.wallFinishes?.[index] ?? (room.wallColors[index] ? undefined : room.wallFinish);
}

/** The color a wall reads as (its paint, or the main color of its material). */
export function wallDisplayColor(room: Room, index: number): string {
  return wallFinishOf(room, index)?.color ?? room.wallColors[index] ?? room.wallColor;
}

export function patternGroup(type: FloorType): FinishGroup {
  return PATTERNS[type].group;
}

export function finishLabel(f: Finish): string {
  const p = f.preset ? presetById(f.preset) : undefined;
  return p ? p.name : PATTERNS[f.type].label;
}

export function finishKey(f: Finish): string {
  return `${f.type}|${f.color}|${f.accent}|${f.scale}|${f.imageAsset ?? ''}|${f.rotation}|${f.accents === false ? 0 : 1}`;
}

// ---------------------------------------------------------------------------
// color mixes

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Blend two colors (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

/**
 * A palette that starts from the current color: darker and lighter shades of it, then blends
 * toward the other color of the mix (accent ↔ main), so swatches stay in the same family.
 */
export function shadesOf(color: string, other?: string): string[] {
  const out = [mix(color, '#000000', 0.45), mix(color, '#000000', 0.25), mix(color, '#000000', 0.1), color.toLowerCase(), mix(color, '#ffffff', 0.2), mix(color, '#ffffff', 0.45), mix(color, '#ffffff', 0.7)];
  if (other) out.push(mix(color, other, 0.35), mix(color, other, 0.7), other.toLowerCase());
  return [...new Set(out)];
}

/** Brightness 0..1 (for picking readable text / outline colors). */
export function luminance(color: string): number {
  const [r, g, b] = hexToRgb(color);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export { FINISH_TYPES };
