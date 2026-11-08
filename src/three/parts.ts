import * as THREE from 'three';

// Shared building blocks for procedural models.

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; opacity?: number } = {}) {
  const key = `${color}|${opts.rough ?? 0.7}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissive ? 1 : 0,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    m.userData.cached = true;
    matCache.set(key, m);
  }
  return m;
}

export const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
export const sphGeo = new THREE.SphereGeometry(0.5, 24, 16);
for (const g of [boxGeo, cylGeo, sphGeo]) (g as any).__shared = true;

export class B {
  g = new THREE.Group();
  /** box with bottom at y; x,z are center */
  box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(boxGeo, m);
    mesh.scale.set(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001));
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, rz = r) {
    const mesh = new THREE.Mesh(cylGeo, m);
    mesh.scale.set(r * 2, h, rz * 2);
    mesh.position.set(x, y + h / 2, z);
    this.g.add(mesh);
    return mesh;
  }
  sphere(r: number, m: THREE.Material, x = 0, y = 0, z = 0, sy = r) {
    const mesh = new THREE.Mesh(sphGeo, m);
    mesh.scale.set(r * 2, sy * 2, r * 2);
    mesh.position.set(x, y, z);
    this.g.add(mesh);
    return mesh;
  }
}

export function legs(b: B, w: number, d: number, h: number, t: number, m: THREE.Material, inset = 0.03) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.box(t, h, t, m, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2));
}


/** Tapered cylinder (cone-ish) and 4-sided pyramid geometries, shared. */
export const taperGeo = new THREE.CylinderGeometry(0.3, 0.5, 1, 24);
// radius √½ so the base is exactly a unit square after the 45° turn
export const pyramidGeo = new THREE.CylinderGeometry(0.25 * Math.SQRT2, 0.5 * Math.SQRT2, 1, 4, 1);
pyramidGeo.rotateY(Math.PI / 4);
for (const g of [taperGeo, pyramidGeo]) (g as any).__shared = true;

/** A mesh from a shared unit geometry, scaled to w × h × d with its bottom at y. */
export function unitMesh(b: B, geo: THREE.BufferGeometry, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.scale.set(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001));
  mesh.position.set(x, y + h / 2, z);
  b.g.add(mesh);
  return mesh;
}
