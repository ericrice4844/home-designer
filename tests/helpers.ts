// Small project builders shared by the tests.
import { catalogEntry, createItem } from '../src/catalog';
import { createRoom, emptyProject, rectPoints, uid, type Item, type Opening, type OpeningType, type Project, type Room } from '../src/model';

/** A project with one 4 × 3 m room (walls: 0 north, 1 east, 2 south, 3 west). */
export function roomProject(w = 4, d = 3): { p: Project; room: Room } {
  const p = emptyProject();
  const room = createRoom('Room', rectPoints(0, 0, w, d));
  p.rooms.push(room);
  return { p, room };
}

export function addDoor(p: Project, room: Room, wallIndex = 2, offset = 1, type: OpeningType = 'door', width = 0.9): Opening {
  const o: Opening = { id: uid('op'), roomId: room.id, wallIndex, offset, width, height: type === 'window' ? 1.2 : 2.03, sill: type === 'window' ? 0.9 : 0, type, flipHinge: false, flipSide: false, frameColor: '#fff' };
  p.openings.push(o);
  return o;
}

export function addItem(p: Project, kind: string, x: number, z: number, patch: Partial<Item> = {}): Item {
  const it = createItem(catalogEntry(kind)!, x, z, patch);
  p.items.push(it);
  return it;
}

export function addCabinet(p: Project, x = 2, z = 0.4): Item {
  return addItem(p, 'base-cabinet', x, z);
}
