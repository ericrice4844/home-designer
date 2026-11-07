// Loads traced floor-plan images and builds their wall-line masks (once per image).
import { assetUrl } from './storage';
import { buildLineMask, type LineMask } from './underlay';

export interface PlanImage {
  img: HTMLImageElement | null;
  mask: LineMask | null;
  loading: boolean;
}

export const planImages = new Map<string, PlanImage>();
const MASK_MAX = 1600; // analyse a downscaled copy: fast enough on phones, plenty for wall strokes

export function loadPlanImage(assetId: string, onReady: () => void): PlanImage {
  let e = planImages.get(assetId);
  if (e) return e;
  e = { img: null, mask: null, loading: true };
  planImages.set(assetId, e);
  const entry = e;
  assetUrl(assetId).then((url) => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      entry.img = img;
      entry.mask = maskFor(img);
      entry.loading = false;
      onReady();
    };
    img.src = url;
  });
  return e;
}

function maskFor(img: HTMLImageElement): LineMask | null {
  const k = Math.min(1, MASK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return buildLineMask(ctx.getImageData(0, 0, w, h).data, w, h, k);
}
