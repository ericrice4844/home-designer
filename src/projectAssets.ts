import type { Project } from './model';

/** Every stored file a project refers to (photos, 3D models, floor patterns, traced plan) – bundled on export. */
export function projectAssetIds(p: Project): string[] {
  const ids = new Set<string>();
  for (const it of p.items) {
    if (it.imageAsset) ids.add(it.imageAsset);
    if (it.modelAsset) ids.add(it.modelAsset);
  }
  for (const r of p.rooms) if (r.floor.imageAsset) ids.add(r.floor.imageAsset);
  if (p.underlay) ids.add(p.underlay.assetId);
  return [...ids];
}
