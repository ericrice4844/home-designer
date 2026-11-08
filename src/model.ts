// Core data model. All lengths are in meters, angles in radians.
// Plan coordinates: x to the right, z "down" on the plan (matches three.js X/Z, Y is up).

import { sanitizeStyle } from './itemStyles';

export type Vec2 = { x: number; z: number };

export type CeilingType = 'flat' | 'shed' | 'gable' | 'tray';

export interface Ceiling {
  type: CeilingType;
  /** Height of the high point for shed/gable (m). For tray: height of the raised center. */
  peakHeight: number;
  /** Direction angle (radians) that the ceiling rises toward (shed) or the ridge runs along (gable). */
  angle: number;
  /** Tray inset from walls (m). */
  trayInset: number;
}

/** Every surface pattern (floors, walls, ceilings, cabinets, countertops, furniture). */
export const FINISH_TYPES = [
  // wood
  'hardwood', 'wide-plank', 'laminate', 'vinyl', 'herringbone', 'chevron', 'parquet',
  // tile
  'tile', 'subway', 'hex', 'mosaic', 'penny', 'checker', 'brick',
  // stone & other
  'stone', 'marble', 'granite', 'terrazzo', 'flagstone', 'concrete', 'carpet', 'custom',
] as const;
export type FloorType = (typeof FINISH_TYPES)[number];

export interface Floor {
  type: FloorType;
  color: string;
  /** Secondary color (grout, alternating tile, plank variation). */
  accent: string;
  /** Repeat size of the pattern in meters (plank width, tile size, etc). */
  scale: number;
  /** Pattern rotation (radians). */
  rotation: number;
  /** Asset id of a user-imported pattern image (used when type === 'custom'). */
  imageAsset?: string;
  /** false = no accent detail (grain, seams, grout, veins, chips are drawn in shades of the main color). */
  accents?: boolean;
  /** Name of the material preset it came from (shown in the UI; cleared once colors are changed). */
  preset?: string;
}

/** A surface material: same data as a floor (pattern, colors, size, rotation). */
export type Finish = Floor;

export interface Room {
  id: string;
  name: string;
  /** Floor polygon, clockwise or counter-clockwise. */
  points: Vec2[];
  /** Floor elevation (m) – lets you build sunken rooms or a second story. */
  elevation: number;
  wallHeight: number;
  wallThickness: number;
  wallColor: string;
  /** Optional per-wall color overrides keyed by wall index (accent walls). */
  wallColors: Record<number, string>;
  /** Material for every wall of the room (paneling, tile, brick…); replaces wallColor. */
  wallFinish?: Finish;
  /** Per-wall material overrides keyed by wall index (accent walls). */
  wallFinishes?: Record<number, Finish>;
  /** Walls that should not be built (open-plan edges shared with another room). */
  hiddenWalls: number[];
  ceiling: Ceiling;
  ceilingColor: string;
  /** Material for the ceiling (wood planks, tile…); replaces ceilingColor. */
  ceilingFinish?: Finish;
  floor: Floor;
  baseboard: boolean;
  baseboardColor: string;
}

export type OpeningType = 'door' | 'double-door' | 'sliding-door' | 'window' | 'opening' | 'garage-door';

export interface Opening {
  id: string;
  roomId: string;
  wallIndex: number;
  /** Distance from the wall start point to the opening center (m). */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the opening above the floor (m). 0 for doors. */
  sill: number;
  type: OpeningType;
  /** Swing direction for doors: flips hinge side / which side it opens into. */
  flipHinge: boolean;
  flipSide: boolean;
  frameColor: string;
}

export type ItemCategory =
  | 'furniture'
  | 'kitchen'
  | 'appliance'
  | 'bath'
  | 'lighting'
  | 'decor'
  | 'people'
  | 'custom';

export type ItemShape = 'model' | 'box' | 'cylinder' | 'l-shape' | 'footprint' | 'cutout' | 'gltf';

export interface LightProps {
  kind: 'point' | 'spot';
  color: string;
  intensity: number;
  range: number;
  on: boolean;
}

export interface Item {
  id: string;
  /** Catalog kind (e.g. 'sofa', 'base-cabinet'). Controls procedural model. */
  kind: string;
  name: string;
  category: ItemCategory;
  x: number;
  z: number;
  /** Elevation of the item's bottom above the room floor (m). */
  y: number;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  accent: string;
  shape: ItemShape;
  /** For 'footprint' shape: polygon in normalized coordinates (-0.5..0.5) of width/depth. */
  footprint?: Vec2[];
  /** For 'l-shape': fraction of width/depth used by the short leg. */
  legRatio?: number;
  /** Photo texture (asset id) applied to the front face or as cutout. */
  imageAsset?: string;
  /** Imported glTF/GLB/OBJ model (asset id). */
  modelAsset?: string;
  modelFormat?: 'gltf' | 'obj';
  light?: LightProps;
  /** Kitchen specific: whether a countertop is drawn on top. */
  countertop?: boolean;
  countertopColor?: string;
  /** Prevent accidental dragging. */
  locked?: boolean;
  /** Materials replacing the main color, the accent color and the countertop color (wood, stone…). */
  finish?: Finish;
  accentFinish?: Finish;
  counterFinish?: Finish;
  /** Style & shape choices (door style, pulls, appliance type, arm shape…) – see itemStyles.ts */
  style?: Record<string, string | number>;
}

export interface Settings {
  units: 'imperial' | 'metric';
  gridSize: number;
  snap: boolean;
  snapToWalls: boolean;
  showDimensions: boolean;
  showClearances: boolean;
  showCeilings: boolean;
  cutawayWalls: boolean;
  renderStyle: 'realistic' | 'drawing';
  sunIntensity: number;
  ambientIntensity: number;
  timeOfDay: number; // 0..24
}

export interface Project {
  version: number;
  name: string;
  rooms: Room[];
  openings: Opening[];
  items: Item[];
  settings: Settings;
  /** Last-used kitchen designer options (saved with the project). */
  kitchen?: Record<string, unknown>;
  /** Floor-plan image traced over in the 2D editor. */
  underlay?: Underlay;
}

export interface Underlay {
  assetId: string;
  /** image size in pixels */
  pixelWidth: number;
  pixelHeight: number;
  /** world position (m) of the image's top-left pixel */
  x: number;
  z: number;
  /** meters per image pixel along the image's x and y axes (equal unless corrected for a skewed photo) */
  scaleX: number;
  scaleZ: number;
  /** radians */
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  /** snap drawing to the plan's wall lines */
  snap: boolean;
  calibrated: boolean;
  /** the first calibration dimension, in image pixels (used for the second-dimension check) */
  calibration?: { a: { x: number; y: number }; b: { x: number; y: number }; length: number };
}

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

export const FT = 0.3048;
export const IN = 0.0254;

export function defaultFloor(): Floor {
  return { type: 'hardwood', color: '#b07a4a', accent: '#8a5a32', scale: 0.15, rotation: 0 };
}

export function createRoom(name: string, points: Vec2[], partial: Partial<Room> = {}): Room {
  return {
    id: uid('room'),
    name,
    points,
    elevation: 0,
    wallHeight: 8 * FT,
    wallThickness: 0.12,
    wallColor: '#ece6dc',
    wallColors: {},
    hiddenWalls: [],
    ceiling: { type: 'flat', peakHeight: 10 * FT, angle: 0, trayInset: 0.45 },
    ceilingColor: '#fbfaf7',
    floor: defaultFloor(),
    baseboard: true,
    baseboardColor: '#ffffff',
    ...partial,
  };
}

export function rectPoints(x: number, z: number, w: number, d: number): Vec2[] {
  return [
    { x, z },
    { x: x + w, z },
    { x: x + w, z: z + d },
    { x, z: z + d },
  ];
}

export function defaultSettings(): Settings {
  return {
    units: 'imperial',
    gridSize: 0.5 * FT,
    snap: true,
    snapToWalls: true,
    showDimensions: true,
    showClearances: true,
    showCeilings: false,
    cutawayWalls: true,
    renderStyle: 'realistic',
    sunIntensity: 1.2,
    ambientIntensity: 0.6,
    timeOfDay: 13,
  };
}

export function emptyProject(): Project {
  return { version: 1, name: 'Untitled Home', rooms: [], openings: [], items: [], settings: defaultSettings() };
}

export function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p));
}

export class ProjectError extends Error {
  constructor(public problems: string[]) {
    super(`Not a valid project: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}`);
    this.name = 'ProjectError';
  }
}

const OPENING_TYPES: OpeningType[] = ['door', 'double-door', 'sliding-door', 'window', 'opening', 'garage-door'];
const ITEM_SHAPES: ItemShape[] = ['model', 'box', 'cylinder', 'l-shape', 'footprint', 'cutout', 'gltf'];
const CATEGORIES: ItemCategory[] = ['furniture', 'kitchen', 'appliance', 'bath', 'lighting', 'decor', 'people', 'custom'];
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);
const MAX = 1e4; // anything farther than 10 km is not a house

/**
 * Validate and upgrade older / partial project JSON to the current shape.
 * Throws a ProjectError listing every problem instead of returning a half-broken project.
 */
export function normalizeProject(raw: unknown): Project {
  const problems: string[] = [];
  if (!isObj(raw)) throw new ProjectError(['the file does not contain a project object']);
  for (const key of ['rooms', 'openings', 'items'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) problems.push(`"${key}" must be a list`);
  }
  if (raw.rooms === undefined && raw.items === undefined) problems.push('no "rooms" or "items" found – this is not a Home Design Studio project');
  if (problems.length) throw new ProjectError(problems);

  const base = emptyProject();
  const settings = isObj(raw.settings) ? raw.settings : {};
  const p: Project = {
    version: isNum(raw.version) ? raw.version : base.version,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : base.name,
    rooms: [],
    openings: [],
    items: [],
    settings: { ...base.settings },
  };
  for (const [k, v] of Object.entries(settings)) {
    const def = (base.settings as any)[k];
    if (def !== undefined && typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) (p.settings as any)[k] = v;
  }
  if (p.settings.units !== 'imperial' && p.settings.units !== 'metric') p.settings.units = base.settings.units;
  if (!(p.settings.gridSize > 0)) p.settings.gridSize = base.settings.gridSize;

  const roomIds = new Set<string>();
  const wallCounts = new Map<string, number>();
  (raw.rooms ?? []).forEach((r: unknown, i: number) => {
    const where = `room ${i + 1}`;
    if (!isObj(r)) return problems.push(`${where} is not an object`);
    if (typeof r.id !== 'string' || !r.id) return problems.push(`${where} has no id`);
    if (roomIds.has(r.id)) return problems.push(`${where} repeats id "${r.id}"`);
    if (!Array.isArray(r.points) || r.points.length < 3) return problems.push(`${where} needs at least 3 corner points`);
    if (!r.points.every((q: any) => isObj(q) && isNum(q.x) && isNum(q.z) && Math.abs(q.x) < MAX && Math.abs(q.z) < MAX)) return problems.push(`${where} has a corner that is not a pair of numbers`);
    for (const k of ['wallHeight', 'wallThickness'] as const) if (r[k] !== undefined && !(isNum(r[k]) && r[k] > 0 && r[k] < 100)) problems.push(`${where}: ${k} must be a positive number`);
    const d = createRoom(typeof r.name === 'string' ? r.name : 'Room', r.points.map((q: any) => ({ x: q.x, z: q.z })));
    const room: Room = {
      ...d,
      id: r.id,
      elevation: isNum(r.elevation) ? r.elevation : 0,
      wallHeight: isNum(r.wallHeight) && r.wallHeight > 0 ? r.wallHeight : d.wallHeight,
      wallThickness: isNum(r.wallThickness) && r.wallThickness > 0 ? r.wallThickness : d.wallThickness,
      wallColor: isColor(r.wallColor) ? r.wallColor : d.wallColor,
      ceilingColor: isColor(r.ceilingColor) ? r.ceilingColor : d.ceilingColor,
      baseboard: typeof r.baseboard === 'boolean' ? r.baseboard : d.baseboard,
      baseboardColor: isColor(r.baseboardColor) ? r.baseboardColor : d.baseboardColor,
      wallColors: Object.fromEntries(Object.entries(isObj(r.wallColors) ? r.wallColors : {}).filter(([k, v]) => /^\d+$/.test(k) && isColor(v))) as Record<number, string>,
      hiddenWalls: Array.isArray(r.hiddenWalls) ? r.hiddenWalls.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < r.points.length) : [],
      ceiling: { ...d.ceiling, ...(isObj(r.ceiling) ? pickValid(r.ceiling, d.ceiling) : {}) },
      floor: normalizeFinish(r.floor) ?? d.floor,
    };
    const wf = normalizeFinish(r.wallFinish);
    if (wf) room.wallFinish = wf;
    const cf = normalizeFinish(r.ceilingFinish);
    if (cf) room.ceilingFinish = cf;
    if (isObj(r.wallFinishes)) {
      const per: Record<number, Finish> = {};
      for (const [k, v] of Object.entries(r.wallFinishes)) {
        const f = /^\d+$/.test(k) && Number(k) < r.points.length ? normalizeFinish(v) : undefined;
        if (f) per[Number(k)] = f;
      }
      if (Object.keys(per).length) room.wallFinishes = per;
    }
    roomIds.add(room.id);
    wallCounts.set(room.id, room.points.length);
    p.rooms.push(room);
  });

  (raw.openings ?? []).forEach((o: unknown, i: number) => {
    const where = `opening ${i + 1}`;
    if (!isObj(o)) return problems.push(`${where} is not an object`);
    if (!roomIds.has(o.roomId)) return problems.push(`${where} belongs to a room that does not exist`);
    if (!Number.isInteger(o.wallIndex) || o.wallIndex < 0 || o.wallIndex >= (wallCounts.get(o.roomId) ?? 0)) return problems.push(`${where} is on a wall that does not exist`);
    for (const k of ['offset', 'width', 'height']) if (!isNum(o[k]) || o[k] < 0) return problems.push(`${where}: ${k} must be a non-negative number`);
    if (!(o.width > 0 && o.height > 0)) return problems.push(`${where} has zero size`);
    p.openings.push({
      id: typeof o.id === 'string' ? o.id : uid('op'),
      roomId: o.roomId,
      wallIndex: o.wallIndex,
      offset: o.offset,
      width: o.width,
      height: o.height,
      sill: isNum(o.sill) && o.sill >= 0 ? o.sill : 0,
      type: OPENING_TYPES.includes(o.type) ? o.type : 'door',
      flipHinge: !!o.flipHinge,
      flipSide: !!o.flipSide,
      frameColor: isColor(o.frameColor) ? o.frameColor : '#ffffff',
    });
  });

  (raw.items ?? []).forEach((it: unknown, i: number) => {
    const where = `item ${i + 1}${isObj(it) && typeof it.name === 'string' ? ` (“${it.name.slice(0, 30)}”)` : ''}`;
    if (!isObj(it)) return problems.push(`${where} is not an object`);
    if (!isNum(it.x) || !isNum(it.z) || Math.abs(it.x) > MAX || Math.abs(it.z) > MAX) return problems.push(`${where} has no valid position`);
    for (const k of ['width', 'depth', 'height']) if (!(isNum(it[k]) && it[k] > 0 && it[k] < 1000)) return problems.push(`${where}: ${k} must be a positive number`);
    const item: Item = {
      id: typeof it.id === 'string' && it.id ? it.id : uid('item'),
      kind: typeof it.kind === 'string' ? it.kind : 'box',
      name: typeof it.name === 'string' ? it.name.slice(0, 200) : 'Item',
      category: CATEGORIES.includes(it.category) ? it.category : 'custom',
      x: it.x,
      z: it.z,
      y: isNum(it.y) ? it.y : 0,
      rotation: isNum(it.rotation) ? it.rotation : 0,
      width: it.width,
      depth: it.depth,
      height: it.height,
      color: isColor(it.color) ? it.color : '#9aa7b4',
      accent: isColor(it.accent) ? it.accent : '#666666',
      shape: ITEM_SHAPES.includes(it.shape) ? it.shape : 'box',
    };
    if (Array.isArray(it.footprint) && it.footprint.every((q: any) => isObj(q) && isNum(q.x) && isNum(q.z))) item.footprint = it.footprint.map((q: any) => ({ x: q.x, z: q.z }));
    if (isNum(it.legRatio)) item.legRatio = it.legRatio;
    for (const k of ['imageAsset', 'modelAsset'] as const) if (typeof it[k] === 'string') item[k] = it[k];
    if (it.modelFormat === 'gltf' || it.modelFormat === 'obj') item.modelFormat = it.modelFormat;
    if (typeof it.countertop === 'boolean') item.countertop = it.countertop;
    if (isColor(it.countertopColor)) item.countertopColor = it.countertopColor;
    if (typeof it.locked === 'boolean') item.locked = it.locked;
    for (const k of ['finish', 'accentFinish', 'counterFinish'] as const) {
      const f = normalizeFinish(it[k]);
      if (f) item[k] = f;
    }
    const style = sanitizeStyle(item.kind, it.style);
    if (style) item.style = style;
    if (isObj(it.light)) {
      const L = it.light;
      item.light = {
        kind: L.kind === 'spot' ? 'spot' : 'point',
        color: isColor(L.color) ? L.color : '#ffe2b8',
        intensity: isNum(L.intensity) && L.intensity >= 0 ? L.intensity : 4,
        range: isNum(L.range) && L.range > 0 ? L.range : 6,
        on: L.on !== false,
      };
    }
    if (item.shape === 'gltf' && !item.modelAsset) item.shape = 'box';
    p.items.push(item);
  });

  if (problems.length) throw new ProjectError(problems);
  if (isObj(raw.kitchen)) p.kitchen = raw.kitchen as any;
  const u = raw.underlay;
  if (u !== undefined) {
    const nums = ['pixelWidth', 'pixelHeight', 'x', 'z', 'scaleX', 'scaleZ', 'rotation', 'opacity'];
    const pt = (q: any) => isObj(q) && isNum(q.x) && isNum(q.y);
    if (isObj(u) && typeof u.assetId === 'string' && nums.every((k) => isNum(u[k])) && u.pixelWidth > 0 && u.pixelHeight > 0 && u.scaleX > 0 && u.scaleZ > 0) {
      p.underlay = {
        assetId: u.assetId,
        pixelWidth: u.pixelWidth,
        pixelHeight: u.pixelHeight,
        x: u.x,
        z: u.z,
        scaleX: u.scaleX,
        scaleZ: u.scaleZ,
        rotation: u.rotation,
        opacity: Math.max(0.05, Math.min(1, u.opacity)),
        visible: u.visible !== false,
        locked: !!u.locked,
        snap: u.snap !== false,
        calibrated: !!u.calibrated,
      };
      if (isObj(u.calibration) && pt(u.calibration.a) && pt(u.calibration.b) && isNum(u.calibration.length) && u.calibration.length > 0)
        p.underlay.calibration = { a: { x: u.calibration.a.x, y: u.calibration.a.y }, b: { x: u.calibration.b.x, y: u.calibration.b.y }, length: u.calibration.length };
    }
    // a damaged tracing image is not worth losing the design over: it is simply dropped
  }
  return p;
}

/**
 * A valid surface material from untrusted data, or undefined. Unknown patterns, bad colors and
 * out-of-range sizes are rejected or clamped so a damaged file can't break the renderer.
 */
export function normalizeFinish(raw: unknown): Finish | undefined {
  if (!isObj(raw) || !(FINISH_TYPES as readonly string[]).includes(raw.type as string)) return undefined;
  const d = defaultFloor();
  const f: Finish = {
    type: raw.type as FloorType,
    color: isColor(raw.color) ? raw.color : d.color,
    accent: isColor(raw.accent) ? raw.accent : d.accent,
    scale: isNum(raw.scale) ? Math.max(0.005, Math.min(10, raw.scale)) : d.scale,
    rotation: isNum(raw.rotation) ? raw.rotation : 0,
  };
  if (typeof raw.imageAsset === 'string' && raw.imageAsset) f.imageAsset = raw.imageAsset;
  if (raw.accents === false) f.accents = false;
  if (typeof raw.preset === 'string' && raw.preset.length <= 60) f.preset = raw.preset;
  // an imported pattern without its image falls back to plain planks in the same colors
  if (f.type === 'custom' && !f.imageAsset) f.type = 'hardwood';
  return f;
}

/** Copy keys from src whose type matches the default (finite numbers only). */
function pickValid<T extends object>(src: Record<string, any>, defaults: T): Partial<T> {
  const out: any = {};
  for (const [k, def] of Object.entries(defaults)) {
    const v = src[k];
    if (v === undefined || typeof v !== typeof def) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}
