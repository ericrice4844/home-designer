import { catalogEntry, createItem } from './catalog';
import { add, dist, openingsForWall, roomWalls, scale, type Wall } from './geometry';
import { IN, type Item, type Project, type Room } from './model';

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

  if (base === 'I') {
    const r = mk(w0, [R('refrigerator', 36), F(0.5), R('range', 30), F(1), R('sink-base', 36), R('dishwasher', 24), F(0.6)]);
    if (r) runs.push(r);
  } else if (base === 'L') {
    const a = mk(w0, [R('refrigerator', 36), F(0.6), R('range', 30), F(1)], 'end');
    const b = mk(next, [F(1), R('sink-base', 36), R('dishwasher', 24), F(0.6)], 'start');
    if (a && b && isAtEnd(a, room) && isAtStart(b, room)) {
      a.cornerEnd = true;
      b.cornerStart = true;
    }
    if (a) runs.push(a);
    if (b) runs.push(b);
  } else if (base === 'U') {
    const a = mk(prev, [R('refrigerator', 36), F(1)], 'end');
    const b = mk(w0, [F(1), R('sink-base', 36), R('dishwasher', 24), F(1)]);
    const c = mk(next, [F(1), R('range', 30), F(1)], 'start');
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
    const a = mk(w0, [F(1), R('sink-base', 36), R('dishwasher', 24), F(1)]);
    const b = mk(opposite, [R('refrigerator', 36), F(1), R('range', 30), F(1)]);
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
  let lengthIn = (u1 - u0) / IN;
  const fixed = run.mods.reduce((s, m) => s + ('w' in m ? m.w : 0), 0);
  // drop appliances that do not fit (keep at least the sink)
  const mods = [...run.mods];
  while (fixed > lengthIn && mods.some((m) => 'w' in m && m.kind !== 'sink-base')) {
    const i = mods.findIndex((m) => 'w' in m && (m.kind === 'dishwasher' || m.kind === 'range' || m.kind === 'refrigerator'));
    if (i < 0) break;
    mods.splice(i, 1);
    lengthIn = (u1 - u0) / IN;
    if (mods.reduce((s, m) => s + ('w' in m ? m.w : 0), 0) <= lengthIn) break;
  }
  const fixed2 = mods.reduce((s, m) => s + ('w' in m ? m.w : 0), 0);
  const weights = mods.reduce((s, m) => s + ('fill' in m ? m.fill : 0), 0) || 1;
  const remaining = Math.max(0, lengthIn - fixed2);
  let u = u0;
  let drawerToggle = false;
  for (const m of mods) {
    if ('w' in m) {
      const it = makeAt(m.kind, m.w, run.wall, room, u + (m.w * IN) / 2, opts);
      items.push(it);
      u += m.w * IN;
    } else {
      const len = (remaining * m.fill) / weights;
      for (const w of splitWidths(len)) {
        const kind = drawerToggle && w <= 24 ? 'drawer-base' : 'base-cabinet';
        drawerToggle = !drawerToggle;
        items.push(makeAt(kind, w, run.wall, room, u + (w * IN) / 2, opts));
        u += w * IN;
      }
    }
  }
  if (cornerEndItem) items.push(cornerEndItem);

  if (opts.wallCabinets) {
    const uppers: Item[] = [];
    for (const it of [...items]) {
      const center = projectU(run.wall, it);
      const half = it.width / 2;
      if (overlapsWindow(run, center - half, center + half, room)) continue;
      if (it.kind === 'range') {
        const hood = makeAt('range-hood', Math.round(it.width / IN), run.wall, room, center, opts, 20);
        hood.y = 60 * IN;
        uppers.push(hood);
        continue;
      }
      if (it.kind === 'refrigerator') {
        const top = it.y + it.height;
        const h = Math.max(0, 84 * IN - top);
        if (h > 0.2) {
          const wc = makeAt('wall-cabinet', Math.round(it.width / IN), run.wall, room, center, opts, 24);
          wc.y = top + 0.01;
          wc.height = h;
          uppers.push(wc);
        }
        continue;
      }
      if (it.kind === 'corner-base') {
        const wc = makeAt('wall-cabinet', 24, run.wall, room, center + 6 * IN, opts, 12);
        uppers.push(wc);
        continue;
      }
      const wc = makeAt('wall-cabinet', Math.round(it.width / IN), run.wall, room, center, opts, 12);
      uppers.push(wc);
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
  }
  if (it.category === 'appliance') it.color = opts.applianceColor;
  if (it.countertop) it.countertopColor = opts.countertopColor;
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

function placeIsland(room: Room, w0: Wall, _opp: Wall, items: Item[], opts: KitchenOptions): Item | null {
  // place island parallel to the main wall, leaving a 42" aisle in front of the counters
  const entry = catalogEntry('island')!;
  const isl = createItem(entry, 0, 0);
  isl.color = opts.islandColor;
  isl.accent = opts.handleColor;
  isl.countertopColor = opts.countertopColor;
  const counterDepth = 25.5 * IN;
  const aisle = 42 * IN;
  const mid = w0.length / 2;
  const off = room.wallThickness / 2 + counterDepth + aisle + isl.depth / 2;
  const p = add(add(w0.a, scale(w0.dir, mid)), scale(w0.inward, off));
  // fit length to the main wall run (at most 8ft, at least 4ft)
  const runLen = Math.max(48 * IN, Math.min(96 * IN, w0.length - 2 * (room.wallThickness + aisle + 24 * IN)));
  isl.width = Math.round(runLen / (6 * IN)) * 6 * IN;
  isl.x = p.x;
  isl.z = p.z;
  // seating overhang faces away from the main run
  isl.rotation = Math.atan2(w0.inward.x, -w0.inward.z);
  void items;
  return isl;
}

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
  // aisle widths: front of every base unit to the nearest obstacle in front
  let minAisle = Infinity;
  for (const it of items) {
    if (!(it.countertop || it.kind === 'range' || it.kind === 'refrigerator')) continue;
    const front = frontCenter(it);
    const dirF = { x: -Math.sin(it.rotation), z: Math.cos(it.rotation) };
    for (const o of items) {
      if (o === it || !(o.countertop || o.kind === 'island' || o.kind === 'range' || o.kind === 'refrigerator')) continue;
      const rel = { x: o.x - front.x, z: o.z - front.z };
      const along = rel.x * dirF.x + rel.z * dirF.z;
      const lateral = Math.abs(-rel.x * dirF.z + rel.z * dirF.x);
      if (along <= 0 || lateral > (o.width + it.width) / 2) continue;
      // approximate the other item's half-extent toward us
      const ext = Math.abs(Math.cos(o.rotation - it.rotation)) * o.depth / 2 + Math.abs(Math.sin(o.rotation - it.rotation)) * o.width / 2;
      minAisle = Math.min(minAisle, along - ext);
    }
  }
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
