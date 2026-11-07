// @vitest-environment happy-dom
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { describe, expect, it, vi } from 'vitest';
import { LRUCache, throttleLatest } from '../src/lru';
import { clearOverlay } from '../src/three/overlay';
import { resolvePick } from '../src/three/pick';
import { configureSunShadow } from '../src/three/sun';
import { walkCollides, walkStart } from '../src/three/walk';
import { createRoom, rectPoints } from '../src/model';
import { addDoor, addItem, roomProject } from './helpers';

function hit(obj: THREE.Object3D, distance: number): THREE.Intersection {
  return { object: obj, distance, point: new THREE.Vector3(0, 0, 0) } as THREE.Intersection;
}
const box = (mat = new THREE.MeshStandardMaterial()) => new THREE.Mesh(new THREE.BoxGeometry(), mat);

describe('2.1 picking', () => {
  it('skips a mesh whose ancestor (hidden ceiling group) is invisible', () => {
    const ceilingGroup = new THREE.Group();
    ceilingGroup.userData = { type: 'ceiling', roomId: 'r' };
    const ceilingMesh = box();
    ceilingMesh.userData = { type: 'ceiling', roomId: 'r' }; // the mesh itself is visible
    ceilingGroup.add(ceilingMesh);
    ceilingGroup.visible = false;
    const sofaGroup = new THREE.Group();
    sofaGroup.userData = { type: 'item', id: 'sofa' };
    const sofaMesh = box();
    sofaGroup.add(new THREE.Group().add(sofaMesh));
    const res = resolvePick([hit(ceilingMesh, 1), hit(sofaMesh, 2)]);
    expect(res?.data).toEqual({ type: 'item', id: 'sofa' });
  });

  it('clicks pass through faded walls and glass but not through furniture', () => {
    const wall = box(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.12 }));
    wall.userData = { type: 'wall' };
    const glassOwner = new THREE.Group();
    glassOwner.userData = { type: 'opening', id: 'w' };
    const glass = box(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.22 }));
    glassOwner.add(glass);
    const floor = box();
    floor.userData = { type: 'floor', roomId: 'r' };
    expect(resolvePick([hit(wall, 1), hit(glass, 2), hit(floor, 3)])?.data.type).toBe('floor');
    const ghostItem = new THREE.Group();
    ghostItem.userData = { type: 'item', id: 'x' };
    const ghost = box(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.1 }));
    ghostItem.add(ghost);
    expect(resolvePick([hit(ghost, 1), hit(floor, 2)])?.data.id).toBe('x');
  });

  it('ignores edge lines from the drawing style', () => {
    const line = new THREE.LineSegments();
    line.userData.edges = true;
    expect(resolvePick([hit(line, 1)])).toBeNull();
  });
});

describe('2.2 overlay cleanup', () => {
  it('disposes geometry/materials and removes label elements', () => {
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial();
    const geoSpy = vi.spyOn(geo, 'dispose');
    const matSpy = vi.spyOn(mat, 'dispose');
    g.add(new THREE.Line(geo, mat));
    const div = document.createElement('div');
    document.body.appendChild(div);
    g.add(new CSS2DObject(div));
    clearOverlay(g);
    expect(g.children).toHaveLength(0);
    expect(geoSpy).toHaveBeenCalled();
    expect(matSpy).toHaveBeenCalled();
    expect(div.isConnected).toBe(false);
  });
});

describe('2.3 sun shadow', () => {
  it('applies the configured frustum (shadows reach past ±5 m)', () => {
    const sun = new THREE.DirectionalLight();
    configureSunShadow(sun, 20);
    // ortho projection: m[0] = 2 / (right - left)
    expect(sun.shadow.camera.projectionMatrix.elements[0]).toBeCloseTo(2 / 40);
  });
});

describe('2.4 caches', () => {
  it('LRU evicts and disposes the least recently used entry', () => {
    const evicted: string[] = [];
    const c = new LRUCache<string, number>(2, (_v, k) => evicted.push(k));
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(c.size).toBe(2);
    expect(c.has('a')).toBe(true);
  });

  it('color picker updates are throttled but the last color always lands', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const t = throttleLatest((c: string) => calls.push(c), 80);
    for (let i = 0; i < 30; i++) t(`#00000${i % 10}`);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(80);
    expect(calls).toEqual(['#000009']);
    t('#ffffff');
    t.flush();
    expect(calls).toEqual(['#000009', '#ffffff']);
    vi.useRealTimers();
  });
});

describe('2.5 walk start', () => {
  it('double-clicking a floor starts at that point, with that room\'s floor height', () => {
    const { p } = roomProject();
    const upper = createRoom('Loft', rectPoints(5, 0, 4, 3), { elevation: 0.6 });
    p.rooms.push(upper);
    const s = walkStart(p, { point: { x: 6.5, z: 1.2 } });
    expect(s.pos).toEqual({ x: 6.5, z: 1.2 });
    expect(s.floorY).toBeCloseTo(0.6);
    expect(s.room?.id).toBe(upper.id);
  });

  it('without a point it stands on a free spot in the room, facing open space', () => {
    const { p, room } = roomProject();
    addItem(p, 'box', 2, 1.5, { width: 1, depth: 1 }); // blocks the centre
    const s = walkStart(p, { room });
    expect(walkCollides(p, s.pos)).toBe(false);
    expect(s.floorY).toBe(0);
  });

  it('walls block, doors let you through', () => {
    const { p, room } = roomProject();
    expect(walkCollides(p, { x: 2, z: 3 })).toBe(true); // on the south wall
    addDoor(p, room, 2, 2); // south wall runs east→west: offset 2 = x 2
    expect(walkCollides(p, { x: 2, z: 3 })).toBe(false);
  });
});
