import type { Finish, Project } from './model';

/** Every stored file a project refers to (photos, 3D models, floor patterns, traced plan) – bundled on export. */
export function projectAssetIds(p: Project): string[] {
  const ids = new Set<string>();
  const fin = (f?: Finish) => f?.imageAsset && ids.add(f.imageAsset);
  for (const it of p.items) {
    if (it.imageAsset) ids.add(it.imageAsset);
    if (it.modelAsset) ids.add(it.modelAsset);
    fin(it.finish);
    fin(it.accentFinish);
    fin(it.counterFinish);
  }
  for (const r of p.rooms) {
    fin(r.floor);
    fin(r.wallFinish);
    fin(r.ceilingFinish);
    for (const f of Object.values(r.wallFinishes ?? {})) fin(f);
  }
  if (p.underlay) ids.add(p.underlay.assetId);
  return [...ids];
}
