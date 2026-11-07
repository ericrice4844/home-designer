import * as THREE from 'three';
import { isCeilingMounted } from '../catalog';
import {
  add,
  ceilingHeightAt,
  clipHalfPlane,
  closestPointOnSegment,
  cross,
  insetPolygon,
  openingsForWall,
  projectedRange,
  roomAt,
  roomWalls,
  scale,
  type Wall,
} from '../geometry';
import type { Item, Opening, Project, Room, Vec2 } from '../model';
import { buildItemObject, mat } from './items';
import { floorTexture } from './textures';

export const EXTERIOR_COLOR = '#d8d2c8';

export interface BuiltHouse {
  group: THREE.Group;
  walls: THREE.Mesh[];
  ceilings: THREE.Object3D[];
  itemObjects: Map<string, THREE.Object3D>;
  lights: THREE.Light[];
}

export function itemBaseY(project: Project, it: Item): number {
  const room = roomAt(project, { x: it.x, z: it.z });
  const elev = room?.elevation ?? 0;
  if (isCeilingMounted(it.kind) && room) return elev + ceilingHeightAt(room, { x: it.x, z: it.z }) - it.height;
  return elev + it.y;
}

/** True if another room has a wall lying on top of this one (shared interior wall). */
export function isSharedWall(project: Project, wall: Wall): boolean {
  for (const r of project.rooms) {
    if (r.id === wall.roomId) continue;
    for (const w of roomWalls(r)) {
      if (Math.abs(cross(w.dir, wall.dir)) > 0.02) continue;
      const mid = add(wall.a, scale(wall.dir, wall.length / 2));
      const cp = closestPointOnSegment(mid, w.a, w.b);
      if (cp.dist < 0.05 && cp.t > 0.001 && cp.t < 0.999) return true;
      const cp2 = closestPointOnSegment(add(w.a, scale(w.dir, w.length / 2)), wall.a, wall.b);
      if (cp2.dist < 0.05 && cp2.t > 0.001 && cp2.t < 0.999) return true;
    }
  }
  return false;
}

export function buildHouse(project: Project, onAsync: () => void): BuiltHouse {
  const group = new THREE.Group();
  const walls: THREE.Mesh[] = [];
  const ceilings: THREE.Object3D[] = [];
  const itemObjects = new Map<string, THREE.Object3D>();
  const lights: THREE.Light[] = [];

  for (const room of project.rooms) {
    if (room.points.length < 3) continue;
    const rg = new THREE.Group();
    rg.name = room.name;
    rg.userData = { type: 'room', id: room.id };
    rg.add(buildFloor(room, onAsync));
    const ceil = buildCeiling(room);
    ceilings.push(ceil);
    rg.add(ceil);
    for (const wall of roomWalls(room)) {
      if (room.hiddenWalls.includes(wall.index)) continue;
      const shared = isSharedWall(project, wall);
      const ops = openingsForWall(project, wall);
      const color = room.wallColors[wall.index] ?? room.wallColor;
      const inner = buildWallMesh(room, wall, ops, 0, room.wallThickness / 2, color);
      inner.userData = { type: 'wall', roomId: room.id, index: wall.index, inward: wall.inward };
      walls.push(inner);
      rg.add(inner);
      if (!shared) {
        const outer = buildWallMesh(room, wall, ops, -room.wallThickness / 2, 0, EXTERIOR_COLOR, true);
        outer.userData = { type: 'wall', roomId: room.id, index: wall.index, inward: wall.inward, exterior: true };
        walls.push(outer);
        rg.add(outer);
      }
      if (room.baseboard) rg.add(buildBaseboard(room, wall, ops));
    }
    group.add(rg);
  }

  for (const o of project.openings) {
    const obj = buildOpening(project, o);
    if (obj) group.add(obj);
  }

  for (const it of project.items) {
    const g = buildItemGroup(project, it, onAsync);
    itemObjects.set(it.id, g);
    group.add(g);
  }
  return { group, walls, ceilings, itemObjects, lights };
}

export function buildItemGroup(project: Project, it: Item, onAsync: () => void): THREE.Group {
  const obj = buildItemObject(it, onAsync);
  const g = new THREE.Group();
  g.add(obj);
  placeItemGroup(project, it, g);
  g.userData = { type: 'item', id: it.id };
  if (it.light && it.light.on) {
    // Real light sources are pooled by the viewer (nearest N are lit) to stay fast on phones.
    const ceiling = isCeilingMounted(it.kind);
    g.userData.lightSource = {
      color: it.light.color,
      intensity: it.light.intensity * (it.light.kind === 'spot' ? 9 : 6),
      range: it.light.range,
      offset: [0, ceiling ? -0.05 : it.height * 0.75, it.kind === 'wall-sconce' ? 0.08 : 0],
    };
  }
  return g;
}

export function placeItemGroup(project: Project, it: Item, g: THREE.Object3D) {
  g.position.set(it.x, itemBaseY(project, it), it.z);
  g.rotation.y = -it.rotation;
}

function shapeFromPoints(pts: Vec2[]): THREE.Shape {
  return new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
}

function buildFloor(room: Room, onAsync: () => void): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shapeFromPoints(room.points));
  geo.rotateX(-Math.PI / 2);
  const { tex, size } = floorTexture(room.floor, onAsync);
  void size; // repeat & rotation are baked into the cached texture
  const t = tex;
  const m = new THREE.MeshStandardMaterial({
    map: t,
    roughness: room.floor.type === 'carpet' ? 1 : room.floor.type === 'tile' || room.floor.type === 'stone' ? 0.35 : 0.55,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = room.elevation;
  mesh.receiveShadow = true;
  mesh.userData = { type: 'floor', roomId: room.id };
  return mesh;
}

function liftedShape(pts: Vec2[], heightAt: (p: Vec2) => number, elev: number, holes: Vec2[][] = []): THREE.BufferGeometry {
  const shape = shapeFromPoints(pts);
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), z: pos.getZ(i) };
    pos.setY(i, elev + heightAt(p));
  }
  geo.computeVertexNormals();
  return geo;
}

function buildCeiling(room: Room): THREE.Group {
  const g = new THREE.Group();
  g.userData = { type: 'ceiling', roomId: room.id };
  const m = new THREE.MeshStandardMaterial({ color: room.ceilingColor, side: THREE.DoubleSide, roughness: 0.9 });
  const c = room.ceiling;
  const h = (p: Vec2) => ceilingHeightAt(room, p);
  if (c.type === 'gable') {
    const dir = { x: Math.cos(c.angle), z: Math.sin(c.angle) };
    const perp = { x: -dir.z, z: dir.x };
    const r = projectedRange(room.points, c.angle + Math.PI / 2);
    const mid = (r.min + r.max) / 2;
    for (const piece of [clipHalfPlane(room.points, perp, mid), clipHalfPlane(room.points, scale(perp, -1), -mid)]) {
      if (piece.length >= 3) g.add(new THREE.Mesh(liftedShape(piece, h, room.elevation), m));
    }
  } else if (c.type === 'tray') {
    const inner = insetPolygon(room.points, c.trayInset);
    const peak = Math.max(room.wallHeight + 0.05, c.peakHeight);
    g.add(new THREE.Mesh(liftedShape(room.points, () => room.wallHeight, room.elevation, [inner]), m));
    g.add(new THREE.Mesh(liftedShape(inner, () => peak, room.elevation), m));
    // vertical band
    for (let i = 0; i < inner.length; i++) {
      const a = inner[i];
      const b = inner[(i + 1) % inner.length];
      const geo = new THREE.BufferGeometry();
      const y0 = room.elevation + room.wallHeight;
      const y1 = room.elevation + peak;
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z], 3));
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, m));
    }
  } else {
    g.add(new THREE.Mesh(liftedShape(room.points, h, room.elevation), m));
  }
  g.traverse((o) => {
    o.userData = { type: 'ceiling', roomId: room.id };
    (o as THREE.Mesh).receiveShadow = true;
  });
  return g;
}

/**
 * Build one layer of a wall between offsets [o0, o1] measured along the wall's "right" normal
 * (we build inner layers on the inward side).
 */
function buildWallMesh(room: Room, wall: Wall, ops: ReturnType<typeof openingsForWall>, o0: number, o1: number, color: string, exterior = false): THREE.Mesh {
  const t = room.wallThickness;
  const ext = exterior ? t / 2 : 0;
  const L = wall.length;
  const N = 24;
  const tops: THREE.Vector2[] = [];
  for (let i = N; i >= 0; i--) {
    const u = -ext + ((L + 2 * ext) * i) / N;
    const uc = Math.max(0, Math.min(L, u));
    const p = add(wall.a, scale(wall.dir, uc));
    tops.push(new THREE.Vector2(u, ceilingHeightAt(room, p)));
  }
  const topAt = (u: number) => ceilingHeightAt(room, add(wall.a, scale(wall.dir, Math.max(0, Math.min(L, u)))));
  const pts: THREE.Vector2[] = [new THREE.Vector2(-ext, 0)];
  const holes: THREE.Path[] = [];
  for (const wo of ops) {
    const o = wo.opening;
    const minTop = Math.min(topAt(wo.u0), topAt(wo.u1)) - 0.03;
    const top = Math.min(o.sill + o.height, minTop);
    if (o.sill < 0.02) {
      pts.push(new THREE.Vector2(wo.u0, 0), new THREE.Vector2(wo.u0, top), new THREE.Vector2(wo.u1, top), new THREE.Vector2(wo.u1, 0));
    } else if (top > o.sill + 0.02) {
      holes.push(new THREE.Path([new THREE.Vector2(wo.u0, o.sill), new THREE.Vector2(wo.u1, o.sill), new THREE.Vector2(wo.u1, top), new THREE.Vector2(wo.u0, top)]));
    }
  }
  pts.push(new THREE.Vector2(L + ext, 0));
  pts.push(...tops);
  const shape = new THREE.Shape(pts);
  shape.holes = holes;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: o1 - o0, bevelEnabled: false, curveSegments: 1 });
  // Basis: X along wall, Y up, Z = right of travel direction.
  const right = { x: -wall.dir.z, z: wall.dir.x };
  const inwardIsRight = right.x * wall.inward.x + right.z * wall.inward.z > 0;
  // we want the layer to lie between o0..o1 along inward; map to "right" coordinates
  const zStart = inwardIsRight ? o0 : -o1;
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(wall.dir.x, 0, wall.dir.z), new THREE.Vector3(0, 1, 0), new THREE.Vector3(right.x, 0, right.z));
  basis.setPosition(wall.a.x + right.x * zStart, room.elevation, wall.a.z + right.z * zStart);
  geo.applyMatrix4(basis);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.92, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildBaseboard(room: Room, wall: Wall, ops: ReturnType<typeof openingsForWall>): THREE.Group {
  const g = new THREE.Group();
  const h = 0.09;
  const t = 0.012;
  const m = mat(room.baseboardColor, { rough: 0.5 });
  const doors = ops.filter((o) => o.opening.sill < 0.02);
  let u = 0;
  const segs: [number, number][] = [];
  for (const d of doors) {
    if (d.u0 > u) segs.push([u, d.u0]);
    u = Math.max(u, d.u1);
  }
  if (u < wall.length) segs.push([u, wall.length]);
  const off = room.wallThickness / 2 + t / 2;
  for (const [s, e] of segs) {
    const len = e - s;
    if (len < 0.02) continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), m);
    const c = add(add(wall.a, scale(wall.dir, (s + e) / 2)), scale(wall.inward, off));
    mesh.position.set(c.x, room.elevation + h / 2, c.z);
    mesh.rotation.y = -Math.atan2(wall.dir.z, wall.dir.x);
    g.add(mesh);
  }
  g.userData = { type: 'baseboard' };
  return g;
}

function buildOpening(project: Project, o: Opening): THREE.Object3D | null {
  const room = project.rooms.find((r) => r.id === o.roomId);
  if (!room) return null;
  const wall = roomWalls(room).find((w) => w.index === o.wallIndex);
  if (!wall) return null;
  const g = new THREE.Group();
  g.userData = { type: 'opening', id: o.id };
  const c = add(wall.a, scale(wall.dir, o.offset));
  g.position.set(c.x, room.elevation, c.z);
  // local X along wall, local Z toward room interior
  g.rotation.y = -Math.atan2(wall.dir.z, wall.dir.x);
  const right = { x: -wall.dir.z, z: wall.dir.x };
  const inwardIsRight = right.x * wall.inward.x + right.z * wall.inward.z > 0;
  const inner = new THREE.Group();
  if (!inwardIsRight) inner.scale.z = -1;
  g.add(inner);
  const T = room.wallThickness * 1.0 + 0.02;
  const frameM = mat(o.frameColor || '#ffffff', { rough: 0.5 });
  const w = o.width;
  const topH = Math.min(o.sill + o.height, ceilingHeightAt(room, c) - 0.03);
  const h = topH - o.sill;
  const trim = 0.06;
  const add3 = (geoW: number, geoH: number, geoD: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(geoW, geoH, geoD), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    inner.add(mesh);
    return mesh;
  };
  {
    // casing (both faces)
    for (const side of [-1, 1]) {
      const z = side * (T / 2);
      add3(trim, h + trim, 0.02, frameM, -w / 2 - trim / 2, o.sill + (h + trim) / 2 - (o.sill > 0 ? trim / 2 : 0), z);
      add3(trim, h + trim, 0.02, frameM, w / 2 + trim / 2, o.sill + (h + trim) / 2 - (o.sill > 0 ? trim / 2 : 0), z);
      add3(w + trim * 2, trim, 0.02, frameM, 0, topH + trim / 2, z);
      if (o.sill > 0) add3(w + trim * 2, trim, 0.02, frameM, 0, o.sill - trim / 2, z);
    }
    // jambs
    add3(0.02, h, T, frameM, -w / 2 + 0.01, o.sill + h / 2, 0);
    add3(0.02, h, T, frameM, w / 2 - 0.01, o.sill + h / 2, 0);
    add3(w, 0.02, T, frameM, 0, topH - 0.01, 0);
  }
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe8f5', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const leafM = mat(o.frameColor || '#ffffff', { rough: 0.45 });
  switch (o.type) {
    case 'window': {
      add3(w + 0.1, 0.025, T + 0.06, frameM, 0, o.sill - 0.0125, 0.03);
      add3(w - 0.04, h - 0.04, 0.01, glass, 0, o.sill + h / 2, 0);
      add3(0.03, h, 0.04, frameM, 0, o.sill + h / 2, 0);
      add3(w, 0.03, 0.04, frameM, 0, o.sill + h / 2, 0);
      break;
    }
    case 'door':
    case 'double-door': {
      const leaves = o.type === 'double-door' ? 2 : 1;
      const lw = w / leaves - 0.01;
      for (let i = 0; i < leaves; i++) {
        const hingeLeft = leaves === 2 ? i === 0 : !o.flipHinge;
        const hx = hingeLeft ? -w / 2 + 0.02 : w / 2 - 0.02;
        const pivot = new THREE.Group();
        pivot.position.set(hx, 0, o.flipSide ? -T / 2 + 0.02 : T / 2 - 0.02);
        const angle = (Math.PI / 180) * 80 * (hingeLeft ? -1 : 1) * (o.flipSide ? -1 : 1);
        pivot.rotation.y = angle;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw, h - 0.02, 0.04), leafM);
        leaf.position.set(hingeLeft ? lw / 2 : -lw / 2, (h - 0.02) / 2, 0);
        leaf.castShadow = true;
        pivot.add(leaf);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat('#b39b5e', { metal: 0.9, rough: 0.3 }));
        knob.position.set(hingeLeft ? lw - 0.07 : -lw + 0.07, 0.95, 0.04);
        pivot.add(knob);
        inner.add(pivot);
      }
      break;
    }
    case 'sliding-door': {
      add3(w / 2, h - 0.04, 0.03, glass, -w / 4, h / 2, -0.03);
      add3(w / 2, h - 0.04, 0.03, glass, w / 4 - 0.1, h / 2, 0.03);
      for (const x of [-w / 2 + 0.02, -0.0, w / 2 - 0.12]) add3(0.04, h, 0.05, frameM, x, h / 2, 0);
      break;
    }
    case 'garage-door': {
      const panels = 4;
      for (let i = 0; i < panels; i++) add3(w - 0.04, h / panels - 0.01, 0.04, leafM, 0, (h / panels) * (i + 0.5), -T / 2 + 0.03);
      break;
    }
    case 'opening':
      break;
  }
  return g;
}
