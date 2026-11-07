import type * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** Remove everything from an overlay group and free its GPU resources and label elements. */
export function clearOverlay(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mt of mats) mt.dispose();
  });
  group.clear();
}
