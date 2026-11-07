import type * as THREE from 'three';

/** Raycasting ignores `visible`, so check the whole ancestor chain (hidden ceilings, cut-away openings…). */
export function isVisibleInScene(obj: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = obj; a; a = a.parent) if (!a.visible) return false;
  return true;
}

function ancestorWith(obj: THREE.Object3D, pred: (o: THREE.Object3D) => boolean): THREE.Object3D | null {
  for (let a: THREE.Object3D | null = obj; a; a = a.parent) if (pred(a)) return a;
  return null;
}

export interface PickResult {
  data: Record<string, any>;
  point: THREE.Vector3;
}

/** Choose what a click selects from raycast hits (nearest first). */
export function resolvePick(hits: THREE.Intersection[]): PickResult | null {
  for (const h of hits) {
    const obj = h.object;
    if (obj.userData.edges) continue;
    if (!isVisibleInScene(obj)) continue;
    const owner = ancestorWith(obj, (o) => o.userData.type === 'item' || o.userData.type === 'opening');
    const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
    // see-through things that are not furniture (faded walls, glass) let clicks pass
    if (owner?.userData.type !== 'item' && mat && !Array.isArray(mat) && mat.transparent && mat.opacity < 0.3) continue;
    if (owner) return { data: owner.userData, point: h.point };
    const typed = ancestorWith(obj, (o) => !!o.userData.type);
    if (typed) return { data: typed.userData, point: h.point };
  }
  return null;
}
