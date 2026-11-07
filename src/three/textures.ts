import * as THREE from 'three';
import type { Floor } from '../model';
import { LRUCache } from '../lru';
import { assetUrl } from '../storage';

/** Bounded cache: editing colors creates a new texture per color, so old ones must be freed. */
export const FLOOR_CACHE_SIZE = 32;
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

/**
 * Build a tiling floor texture. Returns the texture and the real-world size (m) covered by one repeat.
 */
export function floorTexture(f: Floor, onUpdate?: () => void): { tex: THREE.Texture; size: number } {
  // rotation is part of the key so the cached texture can be used as-is (no per-rebuild clone)
  const key = `${f.type}|${f.color}|${f.accent}|${f.scale}|${f.imageAsset ?? ''}|${f.rotation}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const r = rng(12345);
  let size = 1;
  const scaleM = Math.max(0.02, f.scale);

  switch (f.type) {
    case 'hardwood':
    case 'laminate':
    case 'vinyl': {
      const planks = 4;
      size = scaleM * planks;
      const pw = S / planks;
      for (let i = 0; i < planks; i++) {
        let y = -r() * S;
        while (y < S) {
          const lenPx = pw * (3 + r() * 5);
          const v = (r() - 0.5) * (f.type === 'hardwood' ? 0.12 : 0.06);
          ctx.fillStyle = shade(f.color, v);
          ctx.fillRect(i * pw, y, pw, lenPx);
          // grain streaks
          ctx.strokeStyle = shade(f.accent, v * 0.5);
          ctx.globalAlpha = f.type === 'vinyl' ? 0.1 : 0.22;
          for (let g = 0; g < 6; g++) {
            const gx = i * pw + r() * pw;
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.bezierCurveTo(gx + (r() - 0.5) * 8, y + lenPx / 3, gx + (r() - 0.5) * 8, y + (2 * lenPx) / 3, gx, y + lenPx);
            ctx.lineWidth = 0.5 + r() * 1.5;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = shade(f.accent, -0.15);
          ctx.fillRect(i * pw, y, pw, 1.5);
          y += lenPx;
        }
        ctx.fillStyle = shade(f.accent, -0.2);
        ctx.fillRect(i * pw, 0, 1.5, S);
      }
      // top/bottom wrap: plank layout was generated with wrap-around offsets so seams line up mostly
      grain(ctx, S, S, 10, r);
      break;
    }
    case 'herringbone': {
      // period = 4 plank widths in each direction, planks 2:1
      size = scaleM * 4;
      const u = S / 4;
      for (let sx = -3; sx <= 3; sx++) {
        for (let k = -8; k <= 8; k++) {
          const ox = sx * 2 * u;
          const oy = -sx * 2 * u;
          const hx = ox + k * u;
          const hy = oy + k * u;
          for (const [px, py, pw2, ph] of [
            [hx, hy, 2 * u, u],
            [hx, hy + u, u, 2 * u],
          ]) {
            for (const tx of [-S, 0, S]) {
              for (const ty of [-S, 0, S]) {
                ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.12);
                ctx.fillRect(px + tx, py + ty, pw2, ph);
                ctx.strokeStyle = shade(f.accent, -0.15);
                ctx.lineWidth = 1.5;
                ctx.strokeRect(px + tx, py + ty, pw2, ph);
              }
            }
          }
        }
      }
      grain(ctx, S, S, 10, r);
      break;
    }
    case 'tile':
    case 'stone':
    case 'checker': {
      const n = 2;
      size = scaleM * n;
      const t = S / n;
      const grout = f.type === 'checker' ? 0 : Math.max(2, (S / size) * 0.004);
      ctx.fillStyle = f.accent;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const base = f.type === 'checker' && (i + j) % 2 === 1 ? f.accent : f.color;
          ctx.fillStyle = shade(base, f.type === 'stone' ? (r() - 0.5) * 0.12 : (r() - 0.5) * 0.03);
          ctx.fillRect(i * t + grout / 2, j * t + grout / 2, t - grout, t - grout);
          if (f.type === 'stone') {
            ctx.globalAlpha = 0.25;
            for (let v = 0; v < 5; v++) {
              ctx.strokeStyle = shade(base, -0.2 + r() * 0.1);
              ctx.beginPath();
              ctx.moveTo(i * t + r() * t, j * t + r() * t);
              ctx.quadraticCurveTo(i * t + r() * t, j * t + r() * t, i * t + r() * t, j * t + r() * t);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      grain(ctx, S, S, f.type === 'stone' ? 18 : 6, r);
      break;
    }
    case 'carpet': {
      size = Math.max(0.3, scaleM * 3);
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
      grain(ctx, S, S, 40, r);
      break;
    }
    case 'concrete': {
      size = Math.max(0.5, scaleM * 8);
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = shade(f.color, (r() - 0.5) * 0.08);
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(r() * S, r() * S, 10 + r() * 60, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      grain(ctx, S, S, 20, r);
      break;
    }
    case 'custom': {
      size = scaleM;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, S, S);
      if (f.imageAsset) {
        const tex = new THREE.CanvasTexture(canvas);
        assetUrl(f.imageAsset).then((url) => {
          if (!url) return;
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, S, S);
            tex.needsUpdate = true;
            onUpdate?.();
          };
          img.src = url;
        });
        finish(tex, size, f.rotation);
        const res = { tex, size };
        cache.set(key, res);
        return res;
      }
      break;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  finish(tex, size, f.rotation);
  const res = { tex, size };
  cache.set(key, res);
  return res;
}

function finish(tex: THREE.Texture, size: number, rotation: number) {
  tex.repeat.set(1 / size, 1 / size);
  tex.rotation = rotation;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
}

/** Small canvas preview (data URL) of a floor style, for the UI swatches. */
export function floorPreview(f: Floor): string {
  const { tex } = floorTexture(f);
  const src = tex.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  c.getContext('2d')!.drawImage(src, 0, 0, 64, 64);
  return c.toDataURL();
}

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
