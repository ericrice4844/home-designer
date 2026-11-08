// Pure geometry of the tiling patterns (no canvas / three.js), so tiling can be unit-tested.

/** Split `total` into n random parts, none smaller than `minFrac` of the average. */
export function partition(total: number, n: number, r: () => number, minFrac = 0.4): number[] {
  const w = Array.from({ length: n }, () => minFrac + r());
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => (v / sum) * total);
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export interface Cell {
  /** which board / slat (stable per board, for its color) */
  id: number;
  /** distance across the board from its edge (px), for grain streaks */
  across: number;
  /** on a seam line between boards */
  seam: boolean;
}

/**
 * Chevron: 4 columns of boards cut at 45°, alternating direction, meeting in V points.
 * Periodic in S in both directions.
 */
export function chevronCell(x: number, y: number, S: number, seamPx = 1.2): Cell {
  x = mod(x, S);
  y = mod(y, S);
  const cw = S / 4;
  const ph = S / 8;
  const c = Math.min(3, Math.floor(x / cw));
  const lx = x - c * cw;
  const t = c % 2 === 0 ? lx : cw - lx;
  const yy = y + t;
  const j = Math.floor(yy / ph);
  const within = yy - j * ph;
  return { id: c * 8 + mod(j, 8), across: within, seam: within < seamPx || lx < seamPx * 0.8 };
}

/** The 45° offset used by chevronCell (continuous across column edges and the texture wrap). */
export function chevronOffset(x: number, S: number): number {
  x = mod(x, S);
  const cw = S / 4;
  const c = Math.min(3, Math.floor(x / cw));
  const lx = x - c * cw;
  return c % 2 === 0 ? lx : cw - lx;
}

/** Parquet: 4×4 blocks of 4 slats, alternating direction (basket weave). Periodic in S. */
export function parquetCell(x: number, y: number, S: number, seamPx = 1): Cell {
  x = mod(x, S);
  y = mod(y, S);
  const B = S / 4;
  const bx = Math.min(3, Math.floor(x / B));
  const by = Math.min(3, Math.floor(y / B));
  const lx = x - bx * B;
  const ly = y - by * B;
  const horizontal = (bx + by) % 2 === 0;
  const a = horizontal ? ly : lx;
  const sw = B / 4;
  const slat = Math.min(3, Math.floor(a / sw));
  const within = a - slat * sw;
  return { id: (bx * 4 + by) * 4 + slat, across: within, seam: within < seamPx || lx < seamPx || ly < seamPx };
}

/** Centres of flat-top hexagons (circumradius 1) covering a 3 × √3 period, with margin. */
export function hexCenters(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = -1; i <= 3; i++) for (let j = -1; j <= 2; j++) out.push({ x: 1.5 * i, y: Math.sqrt(3) * (j + (mod(i, 2) === 1 ? 0.5 : 0)) });
  return out;
}

/** World size (m) covered by one repeat of the texture, per axis: [across, along]. */
export function repeatSize(type: string, scale: number): [number, number] {
  const s = Math.max(0.005, scale);
  switch (type) {
    case 'hardwood':
    case 'laminate':
    case 'vinyl':
      return [s * 4, s * 4 * 6];
    case 'wide-plank':
      return [s * 3, s * 3 * 5];
    case 'herringbone':
      return [s * 4, s * 4];
    case 'chevron':
      return [s * 8 * Math.SQRT2, s * 8 * Math.SQRT2];
    case 'parquet':
      return [s * 16, s * 16];
    case 'tile':
    case 'stone':
    case 'checker':
      return [s * 2, s * 2];
    case 'subway':
      return [s * 4, s * 4];
    case 'brick':
      return [s * 6, s * 6];
    case 'hex':
      return [s * 1.5, (s * Math.sqrt(3)) / 2];
    case 'mosaic':
      return [s * 8, s * 8];
    case 'penny':
      return [(s * 8) / 0.9, (s * 8) / 0.9];
    case 'flagstone':
      return [s * 4, s * 4];
    case 'carpet':
      return [Math.max(0.3, s * 3), Math.max(0.3, s * 3)];
    case 'concrete':
      return [Math.max(0.5, s * 8), Math.max(0.5, s * 8)];
    default:
      // marble, granite, terrazzo, custom: one slab / image per repeat
      return [s, s];
  }
}

/** How much of the world a small swatch preview should show (m), so a few tiles / boards are visible. */
export function previewSpan(type: string, scale: number): number {
  const s = Math.max(0.005, scale);
  const k: Record<string, number> = { hardwood: 7, laminate: 5, vinyl: 5, 'wide-plank': 5, herringbone: 4, chevron: 8, parquet: 10, tile: 2.5, stone: 2.5, checker: 3, subway: 7, brick: 9, hex: 3.2, mosaic: 7, penny: 7, flagstone: 3.5 };
  return s * (k[type] ?? 1);
}

/**
 * Herringbone (2:1 boards, square to the texture; turn it 45° for the classic zig-zag).
 * Lattice (1,1)·(2,−2) in board widths: each cell has a horizontal board [0,2)×[0,1) and a vertical
 * board [0,1)×[1,3). The texture spans 4×4 board widths. Returns the board under (x, y).
 */
export function herringboneCell(x: number, y: number, S: number, seamPx = 1.2): Cell & { vertical: boolean } {
  const u = S / 4;
  const px = mod(x, S) / u;
  const py = mod(y, S) / u;
  const i0 = Math.floor((px + py) / 2);
  const j0 = Math.floor((px - py) / 4);
  for (let i = i0 - 2; i <= i0 + 2; i++)
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const ox = i + 2 * j;
      const oy = i - 2 * j;
      const lx = px - ox;
      const ly = py - oy;
      const key = mod(ox, 4) * 4 + mod(oy, 4);
      if (lx >= 0 && lx < 2 && ly >= 0 && ly < 1) {
        const e = Math.min(lx, 2 - lx, ly, 1 - ly) * u;
        return { id: key, across: ly * u, seam: e < seamPx, vertical: false };
      }
      if (lx >= 0 && lx < 1 && ly >= 1 && ly < 3) {
        const e = Math.min(lx, 1 - lx, ly - 1, 3 - ly) * u;
        return { id: 16 + key, across: lx * u, seam: e < seamPx, vertical: true };
      }
    }
  return { id: -1, across: 0, seam: true, vertical: false };
}
