import * as THREE from 'three';
import type { Floor } from '../model';
import { finishKey } from '../materials';
import { chevronCell, herringboneCell, hexCenters, parquetCell, partition, previewSpan, repeatSize } from './patternMath';
import { LRUCache } from '../lru';
import { assetUrl } from '../storage';

/** Bounded cache: editing colors creates a new texture per color, so old ones must be freed. */
export const FLOOR_CACHE_SIZE = 64;
const cache = new LRUCache<string, { tex: THREE.Texture; size: number }>(FLOOR_CACHE_SIZE, (v) => v.tex.dispose());
export function floorCacheSize() {
  return cache.size;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

/** Lighten/darken relative to the color's own lightness, so dark woods vary as subtly as light ones. */
function shadeRel(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const room = Math.min(hsl.l, 1 - hsl.l) * 2; // 0 at black/white, 1 at mid gray
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt * Math.max(0.3, room))));
  return `#${c.getHexString()}`;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number, r: () => number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * strength;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Pattern drawing. Every pattern is drawn on a square canvas of S px that tiles seamlessly; the world
// size of one repeat may differ per axis (long boards), see repeatSize().

type Ctx = CanvasRenderingContext2D;
interface Look {
  color: string;
  /** accent color, or a slightly darker shade of the main color when accents are off */
  acc: string;
  accents: boolean;
  r: () => number;
  S: number;
  /** px per meter across / along */
  pxX: number;
  pxY: number;
}

function wrap(S: number, fn: (dx: number, dy: number) => void) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
}

function hexRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

/** Boards in columns, random lengths, end joints staggered; long boards via a stretched repeat. */
function drawPlanks(ctx: Ctx, L: Look, type: string) {
  const { S, r, color, acc } = L;
  const cols = type === 'wide-plank' ? 3 : 4;
  const pw = S / cols;
  const vary = type === 'vinyl' || type === 'laminate' ? 0.06 : type === 'wide-plank' ? 0.1 : 0.12;
  const endSeam = Math.max(0.6, 1.2 * (L.pxY / L.pxX)); // end joints look as thin as the long seams
  for (let i = 0; i < cols; i++) {
    const n = type === 'wide-plank' ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2);
    let y = r() * S;
    for (const len of partition(S, n, r, 0.5)) {
      const v = (r() - 0.5) * vary;
      const base = shadeRel(color, v);
      for (const dy of [0, -S]) {
        const yy = y + dy;
        if (yy + len < 0 || yy > S) continue;
        ctx.fillStyle = base;
        ctx.fillRect(i * pw, yy, pw, len);
        // grain: long streaks along the board, a few darker growth lines
        ctx.globalAlpha = L.accents ? (type === 'vinyl' ? 0.12 : 0.25) : 0.08;
        ctx.strokeStyle = L.accents ? shadeRel(acc, v * 0.5) : shadeRel(color, v - 0.08);
        for (let g = 0; g < 7; g++) {
          const gx = i * pw + 2 + r() * (pw - 4);
          const wob = pw * 0.12;
          ctx.beginPath();
          ctx.moveTo(gx, yy);
          ctx.bezierCurveTo(gx + (r() - 0.5) * wob, yy + len / 3, gx + (r() - 0.5) * wob, yy + (2 * len) / 3, gx + (r() - 0.5) * wob * 0.5, yy + len);
          ctx.lineWidth = 0.4 + r() * 1.4;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = L.accents ? mix(color, shadeRel(acc, -0.1), 0.75) : shadeRel(color, -0.1);
        ctx.fillRect(i * pw, yy, pw, endSeam);
      }
      y = (y + len) % S;
    }
    ctx.fillStyle = L.accents ? mix(color, shadeRel(acc, -0.15), 0.8) : shadeRel(color, -0.1);
    ctx.fillRect(i * pw, 0, 1.2 * (S / 512), S);
  }
}

/** Per-pixel boards (chevron, parquet): base shade per board, fine streaks, seam lines. */
function drawCells(ctx: Ctx, L: Look, cell: (x: number, y: number) => { id: number; across: number; seam: boolean }) {
  const { S } = L;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const base = hexRgb(L.color);
  const seamC = hexRgb(L.accents ? mix(L.color, shadeRel(L.acc, -0.12), 0.8) : shadeRel(L.color, -0.12));
  const streakC = hexRgb(L.accents ? L.acc : shade(L.color, -0.1));
  const boardShade = new Map<number, number>();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = cell(x + 0.5, y + 0.5);
      let k = boardShade.get(c.id);
      if (k === undefined) boardShade.set(c.id, (k = 1 + (hash(c.id) - 0.5) * 0.16));
      const o = (y * S + x) * 4;
      if (c.seam) {
        d[o] = seamC[0];
        d[o + 1] = seamC[1];
        d[o + 2] = seamC[2];
      } else {
        // streaks run along the board: constant along it, varying across
        const st = hash(c.id * 131 + Math.floor(c.across / 1.7)) < (L.accents ? 0.22 : 0.1) ? (L.accents ? 0.35 : 0.15) : 0;
        for (let ch = 0; ch < 3; ch++) d[o + ch] = Math.max(0, Math.min(255, (base[ch] * (1 - st) + streakC[ch] * st) * k));
      }
      d[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Rectangular tiles / bricks in running bond (half offset every other row). */
function drawBond(ctx: Ctx, L: Look, rows: number, perRow: number, groutM: number, vary: number) {
  const { S, r, color, acc } = L;
  const w = S / perRow;
  const hgt = S / rows;
  const g = Math.max(1, groutM * L.pxX);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < rows; k++) {
    const off = k % 2 ? w / 2 : 0;
    for (let i = -1; i <= perRow; i++) {
      ctx.fillStyle = shade(color, (r() - 0.5) * vary);
      ctx.fillRect(i * w + off + g / 2, k * hgt + g / 2, w - g, hgt - g);
    }
  }
}

function drawSquares(ctx: Ctx, L: Look, n: number, groutM: number, vary: number, checker = false) {
  const { S, r, color, acc } = L;
  const t = S / n;
  const g = checker ? 0 : Math.max(1, groutM * L.pxX);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const base = checker && L.accents && (i + j) % 2 === 1 ? L.acc : color;
      ctx.fillStyle = shade(base, (r() - 0.5) * vary);
      ctx.fillRect(i * t + g / 2, j * t + g / 2, t - g, t - g);
    }
}

function drawStoneVeins(ctx: Ctx, L: Look, n: number) {
  const { S, r, color } = L;
  const t = S / n;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let v = 0; v < 5; v++) {
        ctx.strokeStyle = shade(color, -0.2 + r() * 0.1);
        ctx.beginPath();
        ctx.moveTo(i * t + r() * t, j * t + r() * t);
        ctx.quadraticCurveTo(i * t + r() * t, j * t + r() * t, i * t + r() * t, j * t + r() * t);
        ctx.stroke();
      }
  ctx.globalAlpha = 1;
}

function drawHex(ctx: Ctx, L: Look, groutM: number, scale: number) {
  const { S, r, color, acc } = L;
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, S, S);
  // canvas spans 3 × √3 hex units (circumradius 1 = scale / 2 m)
  ctx.save();
  ctx.setTransform(S / 3, 0, 0, S / Math.sqrt(3), 0, 0);
  const g = Math.min(0.2, groutM / (scale / 2));
  const R = 1 - g / Math.sqrt(3);
  for (const c of hexCenters()) {
    ctx.fillStyle = shadeRel(color, (r() - 0.5) * 0.05);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      const px = c.x + R * Math.cos(a);
      const py = c.y + R * Math.sin(a);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawPenny(ctx: Ctx, L: Look) {
  const { S, r, color, acc } = L;
  const n = 8;
  const cell = S / n;
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++)
    for (let i = -1; i <= n; i++) {
      const cx = (i + 0.5 + (j % 2 ? 0.5 : 0)) * cell;
      const cy = (j + 0.5) * cell;
      ctx.fillStyle = shade(color, (r() - 0.5) * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
}

function drawMarble(ctx: Ctx, L: Look) {
  const { S, r, color, acc } = L;
  const k = S / 512;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  // faint clouds
  for (let i = 0; i < 28; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = S * (0.1 + r() * 0.25);
    const c = shadeRel(color, (r() - 0.5) * 0.05);
    wrap(S, (dx, dy) => {
      const gr = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, c);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  ctx.globalAlpha = 1;
  const vein = L.accents ? acc : shadeRel(color, -0.1);
  // veins drift along one main direction with gentle bends, and fork into finer ones
  const main = Math.PI / 5 + (r() - 0.5) * 0.4;
  const path = (x: number, y: number, a: number, steps: number, step: number, bend: number) => {
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * bend + (main - a) * 0.08;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    return pts;
  };
  const stroke = (pts: [number, number][], width: number, alpha: number, blur: number) => {
    ctx.save();
    if (blur && 'filter' in ctx) ctx.filter = `blur(${blur}px)`;
    wrap(S, (dx, dy) => {
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
      ctx.strokeStyle = vein;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
    ctx.restore();
  };
  for (let i = 0; i < 3; i++) {
    const pts = path(r() * S, r() * S, main + (r() - 0.5) * 0.5, 70, 9 * k, 0.35);
    stroke(pts, (4 + r() * 5) * k, 0.18, 4 * k); // soft halo
    stroke(pts, (1 + r() * 1.4) * k, 0.65, 0.5 * k); // crisp core
    // a couple of forks
    for (let f = 0; f < 3; f++) {
      const [fx, fy] = pts[Math.floor(r() * pts.length)];
      stroke(path(fx, fy, main + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), 18 + Math.floor(r() * 20), 6 * k, 0.5), (0.5 + r() * 0.6) * k, 0.45, 0.3 * k);
    }
  }
  for (let i = 0; i < 8; i++) stroke(path(r() * S, r() * S, main + (r() - 0.5) * 1.2, 15 + Math.floor(r() * 25), 6 * k, 0.6), 0.5 * k, 0.25, 0);
  ctx.globalAlpha = 1;
}

function drawFlecks(ctx: Ctx, L: Look, terrazzo: boolean) {
  const { S, r, color, acc } = L;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);
  grain(ctx, S, S, terrazzo ? 8 : 26, r);
  const k = S / 512;
  const tones = L.accents
    ? [acc, shade(acc, 0.18), shade(acc, -0.18), mix(color, acc, 0.5), shade(color, 0.12)]
    : [shade(color, -0.08), shade(color, 0.06), shade(color, -0.04)];
  const count = terrazzo ? 900 : 5200;
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.fillStyle = tones[Math.floor(r() * tones.length)];
    if (terrazzo) {
      const rad = (2 + r() * 6) * k;
      const n = 3 + Math.floor(r() * 3);
      const pts = Array.from({ length: n }, (_, j) => {
        const a = (j / n) * Math.PI * 2 + r() * 0.8;
        const rr = rad * (0.6 + r() * 0.5);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      });
      wrap(S, (dx, dy) => {
        if (x + dx < -10 || x + dx > S + 10 || y + dy < -10 || y + dy > S + 10) return;
        ctx.beginPath();
        pts.forEach(([px, py], j) => (j ? ctx.lineTo(x + dx + px, y + dy + py) : ctx.moveTo(x + dx + px, y + dy + py)));
        ctx.fill();
      });
    } else {
      const sz = (0.8 + r() * 2.2) * k;
      ctx.globalAlpha = 0.6 + r() * 0.4;
      ctx.fillRect(x, y, sz, sz * (0.6 + r() * 0.8));
    }
  }
  ctx.globalAlpha = 1;
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

function drawFlagstone(ctx: Ctx, L: Look, groutM: number) {
  const { S, r, color, acc } = L;
  const g = Math.max(1.5, groutM * L.pxX);
  ctx.fillStyle = acc;
  ctx.fillRect(0, 0, S, S);
  let y = 0;
  for (const rh of partition(S, 4, r, 0.6)) {
    let x = r() * S;
    for (const w of partition(S, 3 + Math.floor(r() * 2), r, 0.5)) {
      const c = shade(color, (r() - 0.5) * 0.22);
      for (const dx of [0, -S]) {
        ctx.fillStyle = c;
        ctx.fillRect(x + dx + g / 2, y + g / 2, w - g, rh - g);
      }
      x = (x + w) % S;
    }
    y += rh;
  }
  grain(ctx, S, S, 24, r);
}

/** Draw a finish on a fresh S × S canvas. Returns the canvas and the world size of one repeat. */
export function drawFinish(f: Floor, S = 512): { canvas: HTMLCanvasElement; sx: number; sy: number; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const [sx, sy] = repeatSize(f.type, f.scale);
  if (!ctx) return { canvas, sx, sy, ctx }; // no 2D canvas (very old browsers, test DOMs): plain texture
  const accents = f.accents !== false;
  const L: Look = { color: f.color, acc: accents ? f.accent : shade(f.color, -0.07), accents, r: rng(12345), S, pxX: S / sx, pxY: S / sy };
  const r = L.r;
  switch (f.type) {
    case 'hardwood':
    case 'laminate':
    case 'vinyl':
    case 'wide-plank':
      drawPlanks(ctx, L, f.type);
      grain(ctx, S, S, 10, r);
      break;
    case 'herringbone':
      drawCells(ctx, L, (x, y) => herringboneCell(x, y, S, 1.2 * (S / 512)));
      grain(ctx, S, S, 8, r);
      break;
    case 'chevron':
      drawCells(ctx, L, (x, y) => chevronCell(x, y, S, 1.2 * (S / 512)));
      grain(ctx, S, S, 8, r);
      break;
    case 'parquet':
      drawCells(ctx, L, (x, y) => parquetCell(x, y, S, 1 * (S / 512)));
      grain(ctx, S, S, 8, r);
      break;
    case 'tile':
      drawSquares(ctx, L, 2, 0.004, 0.03);
      grain(ctx, S, S, 6, r);
      break;
    case 'stone':
      drawSquares(ctx, L, 2, 0.005, 0.12);
      drawStoneVeins(ctx, L, 2);
      grain(ctx, S, S, 18, r);
      break;
    case 'checker':
      drawSquares(ctx, L, 2, 0, 0.03, true);
      grain(ctx, S, S, 6, r);
      break;
    case 'subway':
      drawBond(ctx, L, 4, 2, 0.003, 0.04);
      grain(ctx, S, S, 5, r);
      break;
    case 'brick':
      drawBond(ctx, L, 6, 2, 0.01, 0.2);
      grain(ctx, S, S, 30, r);
      break;
    case 'mosaic':
      drawSquares(ctx, L, 8, 0.002, 0.16);
      grain(ctx, S, S, 6, r);
      break;
    case 'penny':
      drawPenny(ctx, L);
      grain(ctx, S, S, 5, r);
      break;
    case 'hex':
      drawHex(ctx, L, 0.003, f.scale);
      grain(ctx, S, S, 5, r);
      break;
    case 'marble':
      drawMarble(ctx, L);
      grain(ctx, S, S, 4, r);
      break;
    case 'granite':
      drawFlecks(ctx, L, false);
      break;
    case 'terrazzo':
      drawFlecks(ctx, L, true);
      break;
    case 'flagstone':
      drawFlagstone(ctx, L, 0.008);
      break;
    case 'carpet':
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
      grain(ctx, S, S, 40, r);
      break;
    case 'concrete':
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.08);
        ctx.globalAlpha = 0.25;
        const x = r() * S;
        const y = r() * S;
        const rad = (10 + r() * 60) * (S / 512);
        wrap(S, (dx, dy) => {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;
      grain(ctx, S, S, 20, r);
      break;
    case 'custom':
    default:
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
  }
  return { canvas, sx, sy, ctx };
}

/**
 * Tiling texture for a surface material (floors, walls, ceilings, items). UVs are expected in meters.
 * Returns the texture and the size (m) covered by one repeat across.
 */
export function floorTexture(f: Floor, onUpdate?: () => void): { tex: THREE.Texture; size: number } {
  // rotation is part of the key so the cached texture can be used as-is (no per-rebuild clone)
  const key = finishKey(f);
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const { canvas, sx, sy, ctx } = drawFinish(f, S);
  const tex = new THREE.CanvasTexture(canvas);
  if (f.type === 'custom' && f.imageAsset) {
    assetUrl(f.imageAsset).then((url) => {
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        ctx?.drawImage(img, 0, 0, S, S);
        tex.needsUpdate = true;
        onUpdate?.();
      };
      img.src = url;
    });
  }
  setRepeat(tex, sx, sy, f.rotation);
  const res = { tex, size: sx };
  cache.set(key, res);
  return res;
}
export const finishTexture = floorTexture;

function setRepeat(tex: THREE.Texture, sx: number, sy: number, rotation: number) {
  tex.repeat.set(1 / sx, 1 / sy);
  tex.rotation = rotation;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
}

const previews = new LRUCache<string, string>(300);
/**
 * Small swatch (data URL) of a material at its real proportions: a few tiles / boards across,
 * rotated like the surface.
 */
export function floorPreview(f: Floor, px = 72): string {
  const key = `${finishKey(f)}|${px}`;
  const hit = previews.get(key);
  if (hit) return hit;
  const { canvas: src, sx, sy } = drawFinish(f, 256);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const span = previewSpan(f.type, f.scale);
  const pat = ctx.createPattern(src, 'repeat');
  if (pat && typeof DOMMatrix !== 'undefined') {
    // one repeat (256 px) covers sx × sy meters; the swatch covers `span` meters
    pat.setTransform(new DOMMatrix().translateSelf(px / 2, px / 2).rotateSelf((-f.rotation * 180) / Math.PI).scaleSelf((px * sx) / span / 256, (px * sy) / span / 256));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, px, px);
  } else ctx.drawImage(src, 0, 0, px, px);
  const url = c.toDataURL();
  previews.set(key, url);
  return url;
}
export const finishPreview = floorPreview;

const imageTexCache = new Map<string, THREE.Texture>();
export function imageTexture(assetId: string, onLoad?: () => void): THREE.Texture {
  const hit = imageTexCache.get(assetId);
  if (hit) return hit;
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  imageTexCache.set(assetId, tex);
  assetUrl(assetId).then((url) => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      onLoad?.();
    };
    img.src = url;
  });
  return tex;
}
