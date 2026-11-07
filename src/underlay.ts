// A floor-plan image shown under the 2D editor so rooms can be traced over it.
// Pure math (transforms, calibration, wall-line detection) – no DOM – so it is unit-tested.
import type { Underlay, Vec2 } from './model';

export type Px = { x: number; y: number };

/** Image pixel → world (meters). Image x runs along `rotation`, image y 90° clockwise from it. */
export function pixelToWorld(u: Underlay, p: Px): Vec2 {
  const lx = p.x * u.scaleX;
  const lz = p.y * u.scaleZ;
  const c = Math.cos(u.rotation);
  const s = Math.sin(u.rotation);
  return { x: u.x + lx * c - lz * s, z: u.z + lx * s + lz * c };
}

export function worldToPixel(u: Underlay, w: Vec2): Px {
  const dx = w.x - u.x;
  const dz = w.z - u.z;
  const c = Math.cos(u.rotation);
  const s = Math.sin(u.rotation);
  return { x: (dx * c + dz * s) / u.scaleX, y: (-dx * s + dz * c) / u.scaleZ };
}

/** Move the underlay so image pixel `p` sits exactly at world point `w`. */
function anchor(u: Underlay, p: Px, w: Vec2) {
  const now = pixelToWorld(u, p);
  u.x += w.x - now.x;
  u.z += w.z - now.z;
}

/**
 * Two-point calibration: the user tapped both ends of a dimension (world points as displayed) and typed its
 * real length. Scales the plan uniformly (keeping any existing X/Z stretch ratio) about the first point.
 */
export function calibrate(u: Underlay, a: Vec2, b: Vec2, realLength: number): void {
  if (!(realLength > 0)) throw new Error('Length must be positive');
  const pa = worldToPixel(u, a);
  const pb = worldToPixel(u, b);
  const ratio = u.scaleZ / u.scaleX;
  const dPx = Math.hypot(pb.x - pa.x, (pb.y - pa.y) * ratio);
  if (dPx < 5) throw new Error('Pick two points farther apart');
  u.scaleX = realLength / dPx;
  u.scaleZ = u.scaleX * ratio;
  anchor(u, pa, a);
  u.calibration = { a: pa, b: pb, length: realLength };
  u.calibrated = true;
}

export interface CheckResult {
  /** what the plan currently measures between the two points (m) */
  measured: number;
  /** measured / real − 1 (0.03 = plan reads 3 % long) */
  error: number;
  /** a separate horizontal/vertical scale would make both dimensions exact (photo taken at an angle) */
  canFixStretch: boolean;
}

/** Compare a second known dimension against the calibrated plan. */
export function checkDimension(u: Underlay, a: Vec2, b: Vec2, realLength: number): CheckResult {
  const measured = Math.hypot(b.x - a.x, b.z - a.z);
  const error = measured / realLength - 1;
  return { measured, error, canFixStretch: !!u.calibration && !!solveStretch(u, worldToPixel(u, a), worldToPixel(u, b), realLength) };
}

/**
 * Solve separate meters-per-pixel for image x and y so that both the calibration dimension and this one are exact.
 * Needs the two dimensions to run in clearly different directions.
 */
function solveStretch(u: Underlay, pa: Px, pb: Px, length: number): { sx: number; sz: number } | null {
  const c = u.calibration;
  if (!c) return null;
  const [x1, y1, L1] = [c.b.x - c.a.x, c.b.y - c.a.y, c.length];
  const [x2, y2, L2] = [pb.x - pa.x, pb.y - pa.y, length];
  // (x·sx)² + (y·sz)² = L²  → linear in sx², sz²
  const a11 = x1 * x1,
    a12 = y1 * y1,
    a21 = x2 * x2,
    a22 = y2 * y2;
  const det = a11 * a22 - a12 * a21;
  const scale = Math.max(a11, a12, a21, a22) ** 2;
  if (Math.abs(det) < 0.05 * scale) return null; // nearly parallel: can't separate the axes
  const sx2 = (L1 * L1 * a22 - a12 * L2 * L2) / det;
  const sz2 = (a11 * L2 * L2 - a21 * L1 * L1) / det;
  if (!(sx2 > 0 && sz2 > 0)) return null;
  const sx = Math.sqrt(sx2);
  const sz = Math.sqrt(sz2);
  // reject absurd results (more than 25 % difference between axes is not a photo angle, it's a wrong entry)
  if (Math.max(sx, sz) / Math.min(sx, sz) > 1.25) return null;
  return { sx, sz };
}

/** Apply a separate horizontal/vertical scale so both dimensions are exact; keeps the first calibration point fixed. */
export function fixStretch(u: Underlay, a: Vec2, b: Vec2, realLength: number): boolean {
  const pa = worldToPixel(u, a);
  const pb = worldToPixel(u, b);
  const sol = solveStretch(u, pa, pb, realLength);
  if (!sol || !u.calibration) return false;
  const keep = pixelToWorld(u, u.calibration.a);
  u.scaleX = sol.sx;
  u.scaleZ = sol.sz;
  anchor(u, u.calibration.a, keep);
  return true;
}

// ---------------------------------------------------------------------------
// Wall-line detection

export interface LineMask {
  /** 1 = dark (ink) pixel */
  data: Uint8Array;
  width: number;
  height: number;
  /** mask pixels per image pixel (masks are built from a downscaled copy) */
  scale: number;
}

/** Dark-pixel mask from RGBA data. Threshold adapts to the image (plans on grey/beige paper, faint scans). */
export function buildLineMask(rgba: Uint8ClampedArray, width: number, height: number, scale = 1): LineMask {
  const n = width * height;
  const lum = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // transparent counts as white paper
    const l = Math.round((0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a));
    lum[i] = l;
    hist[l]++;
  }
  // Otsu threshold between ink and paper, clamped so a blank image doesn't turn grey noise into walls
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    best = 0,
    thr = 110;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  thr = Math.min(thr, 160);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = lum[i] <= thr ? 1 : 0;
  return { data, width, height, scale };
}

/** Center of the dark run nearest to `pos` along one row (or column), if it looks like a wall stroke. */
function nearestRunCenter(mask: LineMask, horizontal: boolean, fixed: number, pos: number, radius: number, minRun: number, maxRun: number): number | null {
  const { data, width, height } = mask;
  const len = horizontal ? width : height;
  if (fixed < 0 || fixed >= (horizontal ? height : width)) return null;
  const at = (i: number) => (horizontal ? data[fixed * width + i] : data[i * width + fixed]);
  let best: number | null = null;
  let bestD = Infinity;
  const lo = Math.max(0, Math.floor(pos - radius - maxRun));
  const hi = Math.min(len - 1, Math.ceil(pos + radius + maxRun));
  let i = lo;
  while (i <= hi) {
    if (!at(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < len && at(j + 1)) j++;
    const run = j - i + 1;
    // runs that start before the window may continue beyond it; measure the whole run
    let start = i;
    while (start - 1 >= 0 && at(start - 1)) start--;
    const full = j - start + 1;
    if (full >= minRun && full <= maxRun) {
      const c = (start + j) / 2;
      const d = Math.abs(c - pos);
      if (d <= radius && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    i = j + 1 + (run > 0 ? 0 : 1);
  }
  return best;
}

/**
 * Snap a pixel position to the centerline of nearby wall strokes: the x of a vertical wall and/or the y of a
 * horizontal wall. Long dark runs along the scan direction (the wall itself, text blocks) are ignored.
 */
export function snapToLines(mask: LineMask, p: Px, radius: number, minRun = 2, maxRun = 60): { x?: number; y?: number } {
  const m = mask.scale;
  const mx = p.x * m;
  const my = p.y * m;
  const r = radius * m;
  const res: { x?: number; y?: number } = {};
  // Sample rows/columns across the whole snap radius. Near a corner the rows closest to the point run
  // inside the perpendicular wall (one long dark run, rejected), so the answer comes from rows a little
  // further away; take the position most samples agree on.
  const band = 2 * r; // rows/columns sampled; the snapped position itself must still be within r
  const step = Math.max(1, band / 16);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let off = -band; off <= band + 1e-9; off += step) {
    const cx = nearestRunCenter(mask, true, Math.round(my + off), mx, r, minRun, maxRun * m);
    if (cx !== null) xs.push(cx);
    const cy = nearestRunCenter(mask, false, Math.round(mx + off), my, r, minRun, maxRun * m);
    if (cy !== null) ys.push(cy);
  }
  const consensus = (vals: number[], pos: number): number | undefined => {
    let best: number | undefined;
    let bestSupport = 1; // need at least two agreeing samples
    let bestD = Infinity;
    for (const v of vals) {
      const support = vals.filter((w) => Math.abs(w - v) <= 1.5).length;
      const d = Math.abs(v - pos);
      if (support > bestSupport || (support === bestSupport && d < bestD && best !== undefined)) {
        best = v;
        bestSupport = support;
        bestD = d;
      }
    }
    if (best === undefined) return undefined;
    const close = vals.filter((w) => Math.abs(w - best!) <= 1.5);
    return close.reduce((a, b) => a + b, 0) / close.length;
  };
  const sx = consensus(xs, mx);
  const sy = consensus(ys, my);
  if (sx !== undefined) res.x = sx / m;
  if (sy !== undefined) res.y = sy / m;
  return res;
}

/** A fresh underlay: image centered on `center`, `widthMeters` wide until it is calibrated. */
export function createUnderlay(assetId: string, pixelWidth: number, pixelHeight: number, center: Vec2, widthMeters = 15): Underlay {
  const s = widthMeters / pixelWidth;
  return {
    assetId,
    pixelWidth,
    pixelHeight,
    x: center.x - (pixelWidth * s) / 2,
    z: center.z - (pixelHeight * s) / 2,
    scaleX: s,
    scaleZ: s,
    rotation: 0,
    opacity: 0.55,
    visible: true,
    locked: false,
    snap: true,
    calibrated: false,
  };
}

/** Rotate the plan by 90° steps (scans are often sideways), around its center. */
export function rotateUnderlay(u: Underlay, quarterTurns: number) {
  const center = pixelToWorld(u, { x: u.pixelWidth / 2, y: u.pixelHeight / 2 });
  u.rotation = (((u.rotation + (quarterTurns * Math.PI) / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  anchor(u, { x: u.pixelWidth / 2, y: u.pixelHeight / 2 }, center);
  if (u.calibration) u.calibration = { ...u.calibration }; // pixel coords are rotation-independent
}

/** World-space corners of the image (for drawing / hit-testing). */
export function underlayCorners(u: Underlay): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: u.pixelWidth, y: 0 },
    { x: u.pixelWidth, y: u.pixelHeight },
    { x: 0, y: u.pixelHeight },
  ].map((p) => pixelToWorld(u, p));
}
