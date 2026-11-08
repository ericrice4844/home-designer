import { catalogEntry, createItem } from './catalog';
import { add, convexParts, dist, itemOutline, itemsOverlap, openingsForWall, pointInPolygon, roomWalls, scale, type Wall } from './geometry';
import { DOOR_STYLES, PULL_STYLES, styleOptions } from './itemStyles';
import { IN, type Item, type Project, type Room, type Vec2 } from './model';
import { finishFromPreset, presetById, presetsFor } from './materials';

export type KitchenLayout = 'I' | 'L' | 'U' | 'galley' | 'I+island' | 'L+island' | 'U+island';

export interface KitchenOptions {
  layout: KitchenLayout;
  /** Wall index the layout starts from (main run). */
  wallIndex: number;
  wallCabinets: boolean;
  cabinetColor: string;
  countertopColor: string;
  applianceColor: string;
  handleColor: string;
  islandColor: string;
  /** Replace existing kitchen items in this room. */
  replace: boolean;
  /** Cabinet door style and hardware (see itemStyles DOOR_STYLES / PULL_STYLES). */
  door?: string;
  pull?: string;
  /** Countertop material preset id (marble, quartz, butcher block…); '' = solid countertopColor. */
  countertopMaterial?: string;
  /** Which appliance arrangement to use (the safe generator picks the best). */
  variant?: number;
}

export const DEFAULT_KITCHEN_OPTIONS: KitchenOptions = {
  layout: 'L',
  wallIndex: 0,
  wallCabinets: true,
  cabinetColor: '#f3f1ec',
  countertopColor: '#f1f0ec',
  applianceColor: '#c9ccd1',
  handleColor: '#888888',
  islandColor: '#33475b',
  replace: true,
  door: 'shaker',
  pull: 'bar',
  countertopMaterial: 'quartz-white',
};

/** Give a cabinet the kitchen's countertop: a real material, or a solid color. */
export function applyCountertop(it: Item, opts: Pick<KitchenOptions, 'countertopColor' | 'countertopMaterial'>) {
  const p = opts.countertopMaterial ? presetById(opts.countertopMaterial) : undefined;
  if (p) {
    it.counterFinish = finishFromPreset(p);
    it.countertopColor = p.finish.color;
  } else {
    delete it.counterFinish;
    it.countertopColor = opts.countertopColor;
  }
}

/** Door style & hardware for a generated cabinet (only keys that kind supports, only if not the default). */
export function cabinetStyleFor(kind: string, opts: Pick<KitchenOptions, 'door' | 'pull'>): Record<string, string> | undefined {
  const keys = styleOptions(kind).map((o) => o.key);
  const st: Record<string, string> = {};
  if (opts.door && keys.includes('door')) st.door = opts.door;
  if (opts.pull && keys.includes('pull')) st.pull = opts.pull;
  return Object.keys(st).length ? st : undefined;
}

/** The kitchen designer options saved with the project (validated, with defaults for anything missing). */
export function kitchenOptionsFrom(project: Project): KitchenOptions {
  const saved = (project.kitchen ?? {}) as Record<string, unknown>;
  const o: KitchenOptions = { ...DEFAULT_KITCHEN_OPTIONS };
  for (const [k, def] of Object.entries(DEFAULT_KITCHEN_OPTIONS)) if (typeof saved[k] === typeof def) (o as any)[k] = saved[k];
  if (!(o.layout in LAYOUT_LABELS)) o.layout = DEFAULT_KITCHEN_OPTIONS.layout;
  if (!DOOR_STYLES.some(([v]) => v === o.door)) o.door = DEFAULT_KITCHEN_OPTIONS.door;
  if (!PULL_STYLES.some(([v]) => v === o.pull)) o.pull = DEFAULT_KITCHEN_OPTIONS.pull;
  if (o.countertopMaterial && !presetsFor('counter').some((q) => q.id === o.countertopMaterial)) o.countertopMaterial = DEFAULT_KITCHEN_OPTIONS.countertopMaterial;
  return o;
}

/** Items "Replace existing" may remove: cabinets & kitchen appliances – never laundry or furniture. */
export function isReplaceableKitchenItem(it: Item): boolean {
  if (it.kind === 'washer' || it.kind === 'dryer') return false;
  return it.category === 'kitchen' || (it.category === 'appliance' && !it.modelAsset);
}

export const LAYOUT_LABELS: Record<KitchenLayout, string> = {
  I: 'Single wall',
  L: 'L-shape',
  U: 'U-shape',
  galley: 'Galley (two walls)',
  'I+island': 'Single wall + island',
  'L+island': 'L-shape + island',
  'U+island': 'U-shape + island',
};

const STD_WIDTHS = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];

type Mod = { kind: string; w: number } | { fill: number };

interface Run {
  wall: Wall;
  /** start/end along the wall centerline (m) */
  u0: number;
  u1: number;
  mods: Mod[];
  cornerStart?: boolean;
  cornerEnd?: boolean;
}

/** Free intervals along a wall's interior face, excluding doors / low windows. */
export function freeIntervals(project: Project, room: Room, wall: Wall): [number, number][] {
  const t = room.wallThickness / 2;
  let ivs: [number, number][] = [[t, wall.length - t]];
  for (const o of openingsForWall(project, wall)) {
    const blocksBase = o.opening.sill < 0.9 || o.opening.type !== 'window';
    if (!blocksBase) continue;
    const a = o.u0 - 0.08;
    const b = o.u1 + 0.08;
    const next: [number, number][] = [];
    for (const [s, e] of ivs) {
      if (b <= s || a >= e) next.push([s, e]);
      else {
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
    }
    ivs = next;
  }
  return ivs.filter(([s, e]) => e - s > 0.3);
}

function longest(ivs: [number, number][]): [number, number] | null {
  let best: [number, number] | null = null;
  for (const iv of ivs) if (!best || iv[1] - iv[0] > best[1] - best[0]) best = iv;
  return best;
}

/** Split a length (inches) into standard cabinet widths. */
export function splitWidths(lengthIn: number): number[] {
  const out: number[] = [];
  let rem = lengthIn;
  while (rem >= 9) {
    const w = STD_WIDTHS.find((s) => s <= rem + 0.01)!;
    // avoid leaving an unusable sliver (< 9") – take a smaller piece instead
    const left = rem - w;
    if (left > 0.5 && left < 9) {
      const alt = STD_WIDTHS.find((s) => s <= rem - 9 + 0.01 && s >= 9);
      if (alt && alt !== w) {
        out.push(alt);
        rem -= alt;
        continue;
      }
    }
    out.push(w);
    rem -= w;
  }
  if (rem > 0.25 && out.length) out[out.length - 1] += rem; // filler absorbed into the last box
  else if (rem > 0.25) out.push(rem);
  return out;
}

export function generateKitchen(project: Project, room: Room, opts: KitchenOptions): Item[] {
  const walls = roomWalls(room);
  if (!walls.length) return [];
  const n = walls.length;
  const idx = walls.findIndex((w) => w.index === opts.wallIndex);
  const w0 = walls[idx >= 0 ? idx : 0];
  const wi = walls.indexOf(w0);
  const next = walls[(wi + 1) % n];
  const prev = walls[(wi - 1 + n) % n];
  const opposite = walls[(wi + Math.floor(n / 2)) % n];
  const base = opts.layout.replace('+island', '') as 'I' | 'L' | 'U' | 'galley';
  const island = opts.layout.includes('island');

  const runs: Run[] = [];
  const mk = (wall: Wall, mods: Mod[], prefer: 'start' | 'end' | 'any' = 'any'): Run | null => {
    const ivs = freeIntervals(project, room, wall);
    let iv: [number, number] | null = null;
    const t = room.wallThickness / 2;
    if (prefer === 'start') iv = ivs.find(([s]) => Math.abs(s - t) < 0.01) ?? longest(ivs);
    else if (prefer === 'end') iv = ivs.find(([, e]) => Math.abs(e - (wall.length - t)) < 0.01) ?? longest(ivs);
    else iv = longest(ivs);
    if (!iv) return null;
    return { wall, u0: iv[0], u1: iv[1], mods };
  };

  const R = (kind: string, w: number): Mod => ({ kind, w });
  const F = (weight = 1): Mod => ({ fill: weight });

  const v = opts.variant ?? 0;
  const fridge = R('refrigerator', 36);
  const range = R('range', 30);
  const sink = R('sink-base', 36);
  const dw = R('dishwasher', 24);
  const pick = <T,>(list: T[]) => list[v % list.length];
  if (base === 'I') {
    const r = mk(w0, pick([
      [fridge, F(0.5), range, F(1), sink, dw, F(0.6)],
      [F(0.4), fridge, F(0.3), sink, dw, F(0.6), range, F(0.5)],
      [F(0.6), sink, dw, F(0.4), range, F(0.3), fridge, F(0.4)],
    ]));
    if (r) runs.push(r);
  } else if (base === 'L') {
    // run a ends in the corner, run b starts there
    const [ma, mb] = pick<[Mod[], Mod[]]>([
      [[fridge, F(0.6), range, F(1)], [F(1), sink, dw, F(0.6)]],
      [[F(1), range, F(0.5)], [F(0.4), sink, dw, F(0.3), fridge, F(0.6)]],
      [[F(1), fridge, F(0.3), range, F(0.4)], [F(0.4), sink, dw, F(1)]],
      [[F(1), range, F(0.4)], [F(0.3), sink, dw, fridge, F(1)]],
      [[F(1), sink, dw, F(0.4)], [F(0.4), range, F(0.3), fridge, F(1)]],
    ]);
    const a = mk(w0, ma, 'end');
    const b = mk(next, mb, 'start');
    if (a && b && isAtEnd(a, room) && isAtStart(b, room)) {
      a.cornerEnd = true;
      b.cornerStart = true;
    }
    if (a) runs.push(a);
    if (b) runs.push(b);
  } else if (base === 'U') {
    const [ma, mb, mc] = pick<[Mod[], Mod[], Mod[]]>([
      [[fridge, F(1)], [F(1), sink, dw, F(1)], [F(1), range, F(1)]],
      [[F(1), fridge, F(0.3)], [F(1), sink, dw, F(1)], [F(0.3), range, F(1)]],
      [[F(1), fridge], [F(1), sink, dw, F(1)], [range, F(1)]],
      [[F(1), range, F(0.3)], [F(1), sink, dw, F(1)], [F(0.3), fridge, F(1)]],
      [[F(1)], [F(0.6), sink, dw, F(0.4), fridge, F(0.1)], [F(0.3), range, F(1)]],
      [[F(1), range, F(0.3)], [F(0.1), fridge, F(0.4), sink, dw, F(0.6)], [F(1)]],
    ]);
    const a = mk(prev, ma, 'end');
    const b = mk(w0, mb);
    const c = mk(next, mc, 'start');
    if (a && b && isAtEnd(a, room) && isAtStart(b, room)) {
      a.cornerEnd = true;
      b.cornerStart = true;
    }
    if (b && c && isAtEnd(b, room) && isAtStart(c, room)) {
      b.cornerEnd = true;
      c.cornerStart = true;
    }
    for (const r of [a, b, c]) if (r) runs.push(r);
  } else {
    const [ma, mb] = pick<[Mod[], Mod[]]>([
      [[F(1), sink, dw, F(1)], [fridge, F(1), range, F(1)]],
      [[F(1), sink, dw, F(1)], [F(1), range, F(0.4), fridge, F(0.6)]],
      [[F(1), sink, dw, F(1)], [F(0.6), fridge, F(0.4), range, F(1)]],
    ]);
    const a = mk(w0, ma);
    const b = mk(opposite, mb);
    for (const r of [a, b]) if (r) runs.push(r);
  }

  const items: Item[] = [];
  for (const run of runs) items.push(...buildRun(run, room, opts));
  if (island) {
    const isl = placeIsland(room, w0, opposite, items, opts);
    if (isl) items.push(isl);
  }
  return items;
}

function isAtEnd(r: Run, room: Room) {
  return Math.abs(r.u1 - (r.wall.length - room.wallThickness / 2)) < 0.02;
}
function isAtStart(r: Run, room: Room) {
  return Math.abs(r.u0 - room.wallThickness / 2) < 0.02;
}

function buildRun(run: Run, room: Room, opts: KitchenOptions): Item[] {
  const items: Item[] = [];
  let u0 = run.u0;
  let u1 = run.u1;
  // corners: the run that ends at a corner gets the corner cabinet; the run starting there skips its depth
  if (run.cornerStart) u0 += 36 * IN;
  let cornerEndItem: Item | null = null;
  if (run.cornerEnd) {
    u1 -= 36 * IN;
    cornerEndItem = makeAt('corner-base', 36, run.wall, room, u1 + 18 * IN, opts);
  }
  const lengthIn = Math.max(0, (u1 - u0) / IN);
  // drop appliances that do not fit, least important first (the sink stays as long as it fits)
  const mods = [...run.mods];
  const fixedSum = () => mods.reduce((sum, m) => sum + ('w' in m ? m.w : 0), 0);
  for (const kind of ['dishwasher', 'range', 'refrigerator', 'sink-base']) {
    if (fixedSum() <= lengthIn) break;
    const i = mods.findIndex((m) => 'w' in m && m.kind === kind);
    if (i >= 0) mods.splice(i, 1);
  }
  const weights = mods.reduce((sum, m) => sum + ('fill' in m ? m.fill : 0), 0) || 1;
  const remaining = Math.max(0, lengthIn - fixedSum());
  // fill lengths; fold slivers (< 9") into another fill so no 5" "cabinets" appear
  const fills = mods.map((m) => ('fill' in m ? (remaining * m.fill) / weights : 0));
  for (let i = 0; i < fills.length; i++) {
    if (fills[i] > 0 && fills[i] < 9) {
      const j = fills.reduce((bi, v, k) => (k !== i && v > (fills[bi] ?? -1) ? k : bi), -1);
      if (j >= 0 && fills[j] > 0) {
        fills[j] += fills[i];
        fills[i] = 0;
      }
    }
  }
  let u = u0;
  let drawerToggle = false;
  mods.forEach((m, i) => {
    if ('w' in m) {
      items.push(makeAt(m.kind, m.w, run.wall, room, u + (m.w * IN) / 2, opts));
      u += m.w * IN;
      return;
    }
    if (fills[i] < 0.25) return;
    for (const w of splitWidths(fills[i])) {
      const kind = w < 9 ? 'base-cabinet' : drawerToggle && w <= 24 ? 'drawer-base' : 'base-cabinet';
      drawerToggle = !drawerToggle;
      const it = makeAt(kind, w, run.wall, room, u + (w * IN) / 2, opts);
      if (w < 9) it.name = `Filler ${Math.round(w * 10) / 10}"`;
      items.push(it);
      u += w * IN;
    }
  });
  if (cornerEndItem) items.push(cornerEndItem);

  if (opts.wallCabinets) {
    const uppers: Item[] = [];
    for (const it of [...items]) {
      const center = projectU(run.wall, it);
      const half = it.width / 2;
      const wIn = it.width / IN; // exact width: rounding made uppers wider than their bases
      if (overlapsWindow(run, center - half, center + half, room)) continue;
      if (it.kind === 'range') {
        const hood = makeAt('range-hood', wIn, run.wall, room, center, opts, 20);
        hood.y = 60 * IN;
        hood.height = Math.min(hood.height, Math.max(0.3, room.wallHeight - hood.y - 0.02));
        uppers.push(hood);
        continue;
      }
      if (it.kind === 'refrigerator') {
        const top = it.y + it.height;
        const h = Math.min(84 * IN, room.wallHeight - 0.02) - top;
        if (h > 0.2) {
          const wc = makeAt('wall-cabinet', wIn, run.wall, room, center, opts, 24);
          wc.y = top + 0.01;
          wc.height = h - 0.01;
          uppers.push(wc);
        }
        continue;
      }
      if (wIn < 9) continue; // no upper over a filler strip
      if (it.kind === 'corner-base') {
        uppers.push(makeAt('wall-cabinet', 24, run.wall, room, center + 6 * IN, opts, 12));
        continue;
      }
      uppers.push(makeAt('wall-cabinet', wIn, run.wall, room, center, opts, 12));
    }
    items.push(...uppers);
  }
  return items;
}

function projectU(wall: Wall, it: Item) {
  return (it.x - wall.a.x) * wall.dir.x + (it.z - wall.a.z) * wall.dir.z;
}

let currentProject: Project | null = null;
function overlapsWindow(run: Run, a: number, b: number, _room: Room): boolean {
  if (!currentProject) return false;
  return openingsForWall(currentProject, run.wall).some((o) => o.opening.type === 'window' && o.u0 < b - 0.02 && o.u1 > a + 0.02 && o.opening.sill + o.opening.height > 54 * IN);
}

function makeAt(kind: string, widthIn: number, wall: Wall, room: Room, u: number, opts: KitchenOptions, depthIn?: number): Item {
  const entry = catalogEntry(kind)!;
  const it = createItem(entry, 0, 0);
  it.width = widthIn * IN;
  if (depthIn) it.depth = depthIn * IN;
  const p = add(add(wall.a, scale(wall.dir, u)), scale(wall.inward, room.wallThickness / 2 + it.depth / 2));
  it.x = p.x;
  it.z = p.z;
  it.y = (entry.y ?? 0) * IN;
  it.rotation = Math.atan2(-wall.inward.x, wall.inward.z);
  if (it.category === 'kitchen') {
    it.color = opts.cabinetColor;
    it.accent = opts.handleColor;
    const style = cabinetStyleFor(kind, opts);
    if (style) it.style = style;
  }
  if (it.category === 'appliance') it.color = opts.applianceColor;
  if (it.countertop) applyCountertop(it, opts);
  if (kind === 'corner-base') {
    // corner piece: its L opens toward the run's start (towards -x local)
    it.depth = 36 * IN;
    const p2 = add(add(wall.a, scale(wall.dir, u)), scale(wall.inward, room.wallThickness / 2 + it.depth / 2));
    it.x = p2.x;
    it.z = p2.z;
    it.width = 36 * IN;
    // rotate so the solid inside corner of the L sits in the room corner (end of this run)
    const localX = { x: wall.inward.z, z: -wall.inward.x };
    if (localX.x * wall.dir.x + localX.z * wall.dir.z > 0) it.rotation = it.rotation + Math.PI / 2;
  }
  it.name = `${entry.name}${entry.widths ? ` ${Math.round(widthIn)}"` : ''}`;
  return it;
}

export const AISLE = 42 * IN;
export const ISLAND_WALL_GAP = 36 * IN;

/** Smallest distance between two non-overlapping convex polygons. */
function polyDistance(a: Vec2[], b: Vec2[]): number {
  let d = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ])
    for (const v of p)
      for (let i = 0; i < q.length; i++) {
        const s0 = q[i];
        const s1 = q[(i + 1) % q.length];
        const ex = s1.x - s0.x;
        const ez = s1.z - s0.z;
        const t = Math.max(0, Math.min(1, ((v.x - s0.x) * ex + (v.z - s0.z) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(v.x - s0.x - ex * t, v.z - s0.z - ez * t));
      }
  return d;
}

/** Is the island at least AISLE from every floor unit and ISLAND_WALL_GAP from every wall face? */
export function islandFits(room: Room, island: Item, items: Item[]): boolean {
  const outline = itemOutline(island);
  if (!outline.every((q) => pointInPolygon(q, room.points))) return false;
  for (const w of roomWalls(room)) {
    const a = add(w.a, scale(w.inward, room.wallThickness / 2));
    const b = add(w.b, scale(w.inward, room.wallThickness / 2));
    if (polyDistance(outline, [a, b]) < ISLAND_WALL_GAP - 1e-6) return false;
  }
  for (const it of items) {
    if (!isFloorUnit(it)) continue;
    for (const part of convexParts(it)) {
      if (polysOverlap(outline, part) || polyDistance(outline, part) < AISLE - 1e-6) return false;
    }
  }
  return true;
}

function polysOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const n = { x: -(q.z - p.z), z: q.x - p.x };
      const proj = (v: Vec2) => v.x * n.x + v.z * n.z;
      const pa = a.map(proj);
      const pb = b.map(proj);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
    }
  return true;
}
function placeIsland(room: Room, w0: Wall, _opp: Wall, items: Item[], opts: KitchenOptions): Item | null {
  const entry = catalogEntry('island')!;
  const isl = createItem(entry, 0, 0);
  isl.color = opts.islandColor;
  isl.accent = opts.handleColor;
  applyCountertop(isl, opts);
  // depth of what actually stands on the main wall (a 30" fridge is deeper than a 24" counter)
  const faceRot = Math.atan2(-w0.inward.x, w0.inward.z);
  const onWall = items.filter((i) => isFloorUnit(i) && Math.abs(Math.sin((i.rotation - faceRot) / 2)) < 0.01);
  const runDepth = onWall.length ? Math.max(...onWall.map((i) => i.depth)) : 0;
  const off = room.wallThickness / 2 + runDepth + AISLE + isl.depth / 2;
  // seating overhang faces away from the main run
  isl.rotation = Math.atan2(w0.inward.x, -w0.inward.z);
  const p = add(add(w0.a, scale(w0.dir, w0.length / 2)), scale(w0.inward, off));
  isl.x = p.x;
  isl.z = p.z;
  for (let wIn = 96; wIn >= 48; wIn -= 6) {
    isl.width = wIn * IN;
    if (islandFits(room, isl, items)) return isl;
  }
  return null;
}

const FALLBACKS: Record<KitchenLayout, KitchenLayout[]> = {
  'U+island': ['U+island', 'U', 'L', 'I'],
  'L+island': ['L+island', 'L', 'I'],
  'I+island': ['I+island', 'I'],
  U: ['U', 'L', 'I'],
  L: ['L', 'I'],
  galley: ['galley', 'I'],
  I: ['I'],
};

/** Everything that would make a generated kitchen unusable. Empty when the layout is sound. */
export function kitchenProblems(room: Room, items: Item[], layout: KitchenLayout): string[] {
  const problems: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!pointInPolygon(items[i], room.points)) problems.push(`${items[i].name} does not fit in the room`);
    for (let j = i + 1; j < items.length; j++) if (itemsOverlap(items[i], items[j])) problems.push(`${items[i].name} overlaps ${items[j].name}`);
  }
  const aisle = narrowestAisle(items);
  if (aisle < AISLE - 1e-6) problems.push(`work aisle only ${(aisle / IN).toFixed(0)}"`);
  if (layout.includes('island') && !items.some((i) => i.kind === 'island')) problems.push('no room for an island with 42" aisles');
  for (const k of ['sink-base', 'range', 'refrigerator']) if (!items.some((i) => i.kind === k)) problems.push(`no room for the ${k.replace('-base', '')}`);
  return problems;
}

/**
 * Generate the requested layout, or – if the room is too small for it – the closest smaller layout that fits.
 * Never returns overlapping cabinets: if even a single wall does not work, the problems are reported.
 */
export function generateKitchenSafe(project: Project, room: Room, opts: KitchenOptions): { items: Item[]; layout: KitchenLayout; warning?: string } {
  let firstProblems: string[] = [];
  for (const layout of FALLBACKS[opts.layout]) {
    // try each appliance arrangement; keep the problem-free one with the best work triangle
    let best: { items: Item[]; score: number } | null = null;
    for (let variant = 0; variant < 6; variant++) {
      const items = generateKitchenFor(project, room, { ...opts, layout, variant });
      const problems = kitchenProblems(room, items, layout);
      if (problems.length) {
        if (!firstProblems.length && layout === opts.layout) firstProblems = problems;
        continue;
      }
      const score = triangleScore(items);
      if (!best || score < best.score - 1e-9) best = { items, score };
      if (score === 0) break;
    }
    if (best)
      return layout === opts.layout
        ? { items: best.items, layout }
        : { items: best.items, layout, warning: `${LAYOUT_LABELS[opts.layout]} doesn’t fit this room (${firstProblems[0] ?? 'not enough space'}), so a ${LAYOUT_LABELS[layout].toLowerCase()} layout was used instead.` };
    if (!firstProblems.length) firstProblems = ['not enough space'];
  }
  // nothing fits cleanly: keep only the pieces that don't collide, and say so
  const items = generateKitchenFor(project, room, { ...opts, layout: 'I' });
  const kept: Item[] = [];
  for (const it of items) if (pointInPolygon(it, room.points) && !kept.some((k) => itemsOverlap(k, it))) kept.push(it);
  return { items: kept, layout: 'I', warning: `This room is too small for a full kitchen: ${firstProblems.slice(0, 2).join('; ')}.` };
}

/** How far the work triangle is outside the guidelines (0 = all legs 4'–9' and total 13'–26'). */
export function triangleScore(items: Item[]): number {
  const sink = items.find((i) => i.kind === 'sink-base');
  const cook = items.find((i) => i.kind === 'range' || i.kind === 'cooktop');
  const fridge = items.find((i) => i.kind === 'refrigerator');
  if (!sink || !cook || !fridge) return 100;
  const legs = [
    [sink, cook],
    [cook, fridge],
    [fridge, sink],
  ].map(([a, b]) => dist(frontCenter(a), frontCenter(b)));
  const out = (v: number, lo: number, hi: number) => Math.max(0, lo - v, v - hi);
  return legs.reduce((sum, l) => sum + out(l, 4 * FT_M, 9 * FT_M), 0) + out(legs[0] + legs[1] + legs[2], 13 * FT_M, 26 * FT_M);
}
const FT_M = 0.3048;

/** Entry point that also remembers the project so window detection works. */
export function generateKitchenFor(project: Project, room: Room, opts: KitchenOptions): Item[] {
  currentProject = project;
  try {
    return generateKitchen(project, room, opts);
  } finally {
    currentProject = null;
  }
}

// ---------------------------------------------------------------------------
// Analysis

export interface Check {
  ok: boolean | null;
  label: string;
  detail: string;
}

const FT = 0.3048;

export function analyzeKitchen(project: Project, room: Room | undefined, fmt: (m: number) => string): { checks: Check[]; triangle: { a: Item; b: Item }[] } {
  const inRoom = (it: Item) => !room || pointIn(room, it);
  const items = project.items.filter(inRoom);
  const sink = items.find((i) => i.kind === 'sink-base');
  const cook = items.find((i) => i.kind === 'range' || i.kind === 'cooktop');
  const fridge = items.find((i) => i.kind === 'refrigerator');
  const checks: Check[] = [];
  const triangle: { a: Item; b: Item }[] = [];
  if (sink && cook && fridge) {
    const legs: [string, Item, Item][] = [
      ['Sink ↔ Cooktop', sink, cook],
      ['Cooktop ↔ Fridge', cook, fridge],
      ['Fridge ↔ Sink', fridge, sink],
    ];
    let total = 0;
    for (const [label, a, b] of legs) {
      const d = dist(frontCenter(a), frontCenter(b));
      total += d;
      triangle.push({ a, b });
      checks.push({ ok: d >= 4 * FT - 0.01 && d <= 9 * FT + 0.01, label: `Work triangle: ${label}`, detail: `${fmt(d)} (recommended 4'–9')` });
    }
    checks.push({ ok: total >= 13 * FT - 0.01 && total <= 26 * FT + 0.01, label: 'Work triangle total', detail: `${fmt(total)} (recommended 13'–26')` });
  } else {
    const missing = [!sink && 'sink', !cook && 'range/cooktop', !fridge && 'refrigerator'].filter(Boolean).join(', ');
    checks.push({ ok: null, label: 'Work triangle', detail: `Add a ${missing} to evaluate.` });
  }
  if (sink) {
    const dw = items.find((i) => i.kind === 'dishwasher');
    if (dw) {
      const gap = edgeGap(sink, dw);
      checks.push({ ok: gap <= 36 * IN, label: 'Dishwasher near sink', detail: `${fmt(gap)} from sink edge (≤ 36")` });
    }
    const [l, r] = landing(items, sink);
    checks.push({ ok: Math.max(l, r) >= 24 * IN - 0.01 && Math.min(l, r) >= 18 * IN - 0.01, label: 'Sink landing area', detail: `${fmt(l)} / ${fmt(r)} counter each side (24" + 18")` });
  }
  if (cook) {
    const [l, r] = landing(items, cook);
    checks.push({ ok: Math.max(l, r) >= 15 * IN - 0.01 && Math.min(l, r) >= 12 * IN - 0.01, label: 'Cooktop landing area', detail: `${fmt(l)} / ${fmt(r)} counter each side (15" + 12")` });
  }
  if (fridge) {
    const [l, r] = landing(items, fridge);
    checks.push({ ok: Math.max(l, r) >= 15 * IN - 0.01, label: 'Refrigerator landing area', detail: `${fmt(Math.max(l, r))} counter beside handle side (≥ 15")` });
  }
  // aisle widths: from the front of every floor unit straight ahead to the nearest floor unit, using
  // real outlines (actual depths – fridges are deeper than counters – and corner cabinets' L shapes)
  const minAisle = narrowestAisle(items);
  if (isFinite(minAisle)) checks.push({ ok: minAisle >= 42 * IN - 0.01, label: 'Work aisle width', detail: `${fmt(minAisle)} narrowest (42" min, 48" for two cooks)` });
  const counterLen = items.filter((i) => i.countertop).reduce((s, i) => s + i.width, 0);
  checks.push({ ok: counterLen >= 13 * FT ? true : null, label: 'Total countertop frontage', detail: `${fmt(counterLen)} (≥ 13' recommended)` });
  const wallCabs = items.filter((i) => i.kind === 'wall-cabinet');
  if (wallCabs.length) {
    const gaps = wallCabs.map((w) => w.y - 36 * IN);
    const minGap = Math.min(...gaps);
    checks.push({ ok: minGap >= 15 * IN - 0.01 && minGap <= 20 * IN + 0.01, label: 'Backsplash height', detail: `${fmt(minGap)} counter to upper cabinets (15"–20")` });
  }
  return { checks, triangle };
}

function pointIn(room: Room, it: Item) {
  let inside = false;
  const pts = room.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > it.z !== b.z > it.z && it.x < ((b.x - a.x) * (it.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function frontCenter(it: Item) {
  return { x: it.x - Math.sin(it.rotation) * (it.depth / 2), z: it.z + Math.cos(it.rotation) * (it.depth / 2) };
}

function edgeGap(a: Item, b: Item) {
  const d = dist({ x: a.x, z: a.z }, { x: b.x, z: b.z });
  return Math.max(0, d - a.width / 2 - b.width / 2);
}

/** Cabinets/appliances standing on the floor that form work surfaces or block an aisle. */
export function isFloorUnit(it: Item): boolean {
  return (it.category === 'kitchen' || it.category === 'appliance') && it.y < 0.3 && it.height > 0.5 && !['washer', 'dryer'].includes(it.kind);
}

/** Narrowest clear distance in front of any floor unit to another floor unit facing it (Infinity if none). */
export function narrowestAisle(items: Item[]): number {
  const units = items.filter(isFloorUnit);
  let min = Infinity;
  for (const it of units) {
    if (it.kind === 'corner-base') continue; // its open face is diagonal; neighbours measure past it
    const f = frontCenter(it);
    const fwd = { x: -Math.sin(it.rotation), z: Math.cos(it.rotation) };
    const side = { x: Math.cos(it.rotation), z: Math.sin(it.rotation) };
    for (const o of units) {
      if (o === it) continue;
      let alongMin = Infinity;
      let latMin = Infinity;
      let latMax = -Infinity;
      for (const q of itemOutline(o)) {
        const rel = { x: q.x - f.x, z: q.z - f.z };
        alongMin = Math.min(alongMin, rel.x * fwd.x + rel.z * fwd.z);
        const lat = rel.x * side.x + rel.z * side.z;
        latMin = Math.min(latMin, lat);
        latMax = Math.max(latMax, lat);
      }
      // only things in front of this unit's face, overlapping its width
      if (alongMin < -0.01 || latMax <= -it.width / 2 + 0.01 || latMin >= it.width / 2 - 0.01) continue;
      min = Math.min(min, Math.max(0, alongMin));
    }
  }
  return min;
}

/** Countertop length immediately to the left / right of an item (contiguous run on the same plane). */
function landing(items: Item[], it: Item): [number, number] {
  const dir = { x: Math.cos(it.rotation), z: Math.sin(it.rotation) };
  const front = { x: -Math.sin(it.rotation), z: Math.cos(it.rotation) };
  const res: [number, number] = [0, 0];
  [-1, 1].forEach((side, k) => {
    let edge = (side * it.width) / 2;
    let total = 0;
    for (let guard = 0; guard < 20; guard++) {
      const nb = items.find((o) => {
        if (o === it || !o.countertop) return false;
        const rel = { x: o.x - it.x, z: o.z - it.z };
        const along = rel.x * dir.x + rel.z * dir.z;
        const across = rel.x * front.x + rel.z * front.z;
        if (Math.abs(across - (o.depth - it.depth) / 2) > 0.1 && Math.abs(across) > 0.1) return false;
        const near = along - (side * o.width) / 2;
        return Math.abs(near - edge) < 0.03;
      });
      if (!nb) break;
      total += nb.kind === 'sink-base' || nb.kind === 'dishwasher' ? (nb.kind === 'dishwasher' ? nb.width : 0) : nb.width;
      const rel = { x: nb.x - it.x, z: nb.z - it.z };
      edge = rel.x * dir.x + rel.z * dir.z + (side * nb.width) / 2;
    }
    res[k] = total;
  });
  return res;
}
