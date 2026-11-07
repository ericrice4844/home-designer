import type * as THREE from 'three';

/** Size the sun's shadow frustum to cover the house (plus margin) and apply it. */
export function configureSunShadow(sun: THREE.DirectionalLight, halfExtent: number) {
  const e = Math.max(5, halfExtent);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -e;
  sc.right = sc.top = e;
  sc.near = 0.5;
  sc.far = 200;
  sc.updateProjectionMatrix(); // without this the default ±5 m frustum stays in effect
}
