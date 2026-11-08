// Surface materials on 3D objects: textured materials with UVs in meters, so a pattern keeps its real
// size whatever the part's size (a 3" oak board is 3" on a door and on a tabletop).
import * as THREE from 'three';
import { PATTERNS } from '../materials';
import type { Finish, Item } from '../model';
import { finishTexture } from './textures';

/** A material for a surface finish (shared texture from the cache). */
export function finishMaterial(f: Finish, onAsync: () => void, opts: { side?: THREE.Side; metalness?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const { tex } = finishTexture(f, onAsync);
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: PATTERNS[f.type].roughness,
    metalness: opts.metalness ?? 0,
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.opacity !== undefined && opts.opacity < 1) {
    m.transparent = true;
    m.opacity = opts.opacity;
  }
  return m;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Box-projected UVs in meters, in the coordinates of `space` (the item's own axes), so the pattern
 * runs continuously across the parts of a piece and follows it when it is moved or rotated.
 * Faces looking along ±Z (fronts) get (x, y): boards stand up on doors; ±X sides get (z, y);
 * horizontal faces get (z, x): boards run along the width of tops and counters.
 */
export function boxProjectUVs(geo: THREE.BufferGeometry, toSpace: THREE.Matrix4): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (!nor) {
    geo.computeVertexNormals();
    nor = geo.attributes.normal as THREE.BufferAttribute;
  }
  const normalM = new THREE.Matrix3().getNormalMatrix(toSpace);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(toSpace);
    _n.fromBufferAttribute(nor, i).applyMatrix3(normalM);
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    let u: number;
    let w: number;
    if (ay >= ax && ay >= az) [u, w] = [_v.z, _v.x];
    else if (ax >= az) [u, w] = [_v.z, _v.y];
    else [u, w] = [_v.x, _v.y];
    uv[i * 2] = u;
    uv[i * 2 + 1] = w;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** The countertop color an item is drawn with (see styled.ts). */
export function counterColorOf(it: Item): string {
  return it.countertopColor ?? (it.kind === 'island' ? '#f1efea' : '#e9e6e1');
}

/**
 * Replace the main / accent / countertop colored parts of a built item with its materials.
 * Parts are recognised by the color they were built with, so every builder works unchanged.
 * Returns how many parts were changed.
 */
export function applyItemFinishes(root: THREE.Object3D, it: Item, onAsync: () => void = () => {}): number {
  const targets: [string, Finish][] = [];
  if (it.finish) targets.push([it.color, it.finish]);
  if (it.accentFinish) targets.push([it.accent, it.accentFinish]);
  if (it.counterFinish) targets.push([counterColorOf(it), it.counterFinish]);
  if (!targets.length) return 0;
  const want = targets.map(([c, f]) => [new THREE.Color(c).getHexString(), f] as const);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  let changed = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial || m.map) return; // photos keep their image
    const hit = want.find(([hex]) => hex === m.color.getHexString());
    if (!hit) return;
    const f = hit[1];
    const key = `${targets.indexOf(targets.find(([, g]) => g === f)!)}|${m.metalness > 0.5 ? 1 : 0}|${m.opacity}|${m.side}`;
    let fm = mats.get(key);
    if (!fm) {
      // keep metal parts a little metallic (a steel fridge in a wood panel is still a panel)
      fm = finishMaterial(f, onAsync, { side: m.side, metalness: m.metalness > 0.5 ? 0.2 : 0, opacity: m.opacity });
      mats.set(key, fm);
    }
    const toSpace = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    mesh.geometry = boxProjectUVs(mesh.geometry.clone(), toSpace);
    mesh.material = fm;
    changed++;
  });
  return changed;
}
