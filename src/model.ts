// Core data model. All lengths are in meters, angles in radians.
// Plan coordinates: x to the right, z "down" on the plan (matches three.js X/Z, Y is up).

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

export type FloorType =
  | 'hardwood'
  | 'laminate'
  | 'tile'
  | 'stone'
  | 'carpet'
  | 'vinyl'
  | 'concrete'
  | 'herringbone'
  | 'checker'
  | 'custom';

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
}

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
  /** Walls that should not be built (open-plan edges shared with another room). */
  hiddenWalls: number[];
  ceiling: Ceiling;
  ceilingColor: string;
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

/** Upgrade older / partial project JSON to the current shape. */
export function normalizeProject(raw: any): Project {
  const base = emptyProject();
  const p: Project = { ...base, ...raw, settings: { ...base.settings, ...(raw?.settings ?? {}) } };
  p.rooms = (raw?.rooms ?? []).map((r: any) => {
    const d = createRoom(r.name ?? 'Room', r.points ?? []);
    return { ...d, ...r, ceiling: { ...d.ceiling, ...(r.ceiling ?? {}) }, floor: { ...d.floor, ...(r.floor ?? {}) }, wallColors: r.wallColors ?? {}, hiddenWalls: r.hiddenWalls ?? [] };
  });
  p.openings = raw?.openings ?? [];
  p.items = raw?.items ?? [];
  return p;
}
