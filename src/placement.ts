import { catalogEntry, createItem, isCeilingMounted } from './catalog';
import { ceilingHeightAt, roomAt, snapItemToWall, snapValue } from './geometry';
import type { Item, Project } from './model';

/** Move an item to a plan position honoring grid & wall snapping. Mutates item. */
export function moveItem(project: Project, item: Item, x: number, z: number, opts: { noSnap?: boolean } = {}) {
  const s = project.settings;
  let nx = x;
  let nz = z;
  if (s.snap && !opts.noSnap) {
    nx = snapValue(nx, s.gridSize / 2);
    nz = snapValue(nz, s.gridSize / 2);
  }
  item.x = nx;
  item.z = nz;
  const entry = catalogEntry(item.kind);
  const wantsWall = entry?.wallSnap || item.category === 'kitchen' || item.category === 'appliance';
  if (s.snapToWalls && !opts.noSnap && wantsWall && !isCeilingMounted(item.kind) && item.kind !== 'island') {
    const snapped = snapItemToWall(project, { ...item, x, z }, 0.3);
    if (snapped) {
      item.x = snapped.x;
      item.z = snapped.z;
      item.rotation = snapped.rotation;
      // snap to neighbouring cabinets along the wall so runs line up without gaps
      alignToNeighbors(project, item);
    }
  }
}

/** If another item sits next to this one along the same wall within a few cm, close the gap. */
function alignToNeighbors(project: Project, item: Item) {
  const dir = { x: Math.cos(item.rotation), z: Math.sin(item.rotation) }; // local +x in world
  const front = { x: -Math.sin(item.rotation), z: Math.cos(item.rotation) }; // local +z in world
  for (const o of project.items) {
    if (o.id === item.id) continue;
    if (Math.abs(normalizeDiff(o.rotation - item.rotation)) > 0.01) continue;
    const rel = { x: o.x - item.x, z: o.z - item.z };
    const along = rel.x * dir.x + rel.z * dir.z;
    const across = rel.x * front.x + rel.z * front.z;
    // backs against the same plane?
    if (Math.abs(across - o.depth / 2 + item.depth / 2) > 0.03) continue;
    const verticalOverlap = o.y < item.y + item.height && o.y + o.height > item.y;
    if (!verticalOverlap) continue;
    const gap = Math.abs(along) - (o.width + item.width) / 2;
    if (gap > -0.02 && gap < 0.06) {
      const target = Math.sign(along) * ((o.width + item.width) / 2);
      const shift = along - target;
      item.x += dir.x * shift;
      item.z += dir.z * shift;
      return;
    }
  }
}

function normalizeDiff(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Create a catalog item at a plan position (applying snapping and ceiling mounting). */
export function placeCatalogItem(project: Project, kind: string, x: number, z: number): Item | null {
  const entry = catalogEntry(kind);
  if (!entry) return null;
  const item = createItem(entry, x, z);
  if (entry.ceilingMount) {
    const room = roomAt(project, { x, z });
    if (room) item.y = ceilingHeightAt(room, { x, z }) - item.height;
  }
  moveItem(project, item, x, z);
  return item;
}
