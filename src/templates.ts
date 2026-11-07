import { catalogEntry, createItem } from './catalog';
import { roomWalls } from './geometry';
import { generateKitchenSafe } from './kitchen';
import { createRoom, emptyProject, FT, IN, rectPoints, uid, type Item, type Opening, type OpeningType, type Project, type Room } from './model';

function op(room: Room, wallIndex: number, offsetFt: number, type: OpeningType, widthIn: number, heightIn: number, sillIn = 0): Opening {
  return {
    id: uid('op'),
    roomId: room.id,
    wallIndex,
    offset: offsetFt * FT,
    width: widthIn * IN,
    height: heightIn * IN,
    sill: sillIn * IN,
    type,
    flipHinge: false,
    flipSide: false,
    frameColor: '#ffffff',
  };
}

function put(kind: string, xFt: number, zFt: number, rotDeg = 0, patch: Partial<Item> = {}, ceilingFt?: number): Item {
  const e = catalogEntry(kind)!;
  const it = createItem(e, xFt * FT, zFt * FT, patch);
  it.rotation = (rotDeg * Math.PI) / 180;
  if (e.ceilingMount && ceilingFt) it.y = ceilingFt * FT - it.height;
  return it;
}

export function sampleHouse(): Project {
  const p = emptyProject();
  p.name = 'Sample Home';
  const kitchen = createRoom('Kitchen', rectPoints(0, 0, 14 * FT, 14 * FT), {
    wallColor: '#f1ede4',
    floor: { type: 'tile', color: '#e6e1d8', accent: '#b9b2a5', scale: 18 * IN, rotation: 0 },
  });
  const living = createRoom('Living Room', rectPoints(14 * FT, 0, 18 * FT, 14 * FT), {
    wallColor: '#e3e7e1',
    ceiling: { type: 'gable', peakHeight: 12 * FT, angle: 0, trayInset: 0.45 },
    floor: { type: 'hardwood', color: '#a8774c', accent: '#7a5232', scale: 5 * IN, rotation: Math.PI / 2 },
  });
  const bed = createRoom('Bedroom', rectPoints(0, 14 * FT, 14 * FT, 12 * FT), {
    wallColor: '#dfe5ec',
    wallColors: { 3: '#5d7285' },
    ceiling: { type: 'tray', peakHeight: 9 * FT, angle: 0, trayInset: 0.5 },
    floor: { type: 'carpet', color: '#c9c0b3', accent: '#a69c8e', scale: 0.2, rotation: 0 },
  });
  const bath = createRoom('Bath', rectPoints(14 * FT, 14 * FT, 8 * FT, 12 * FT), {
    wallColor: '#eef3f4',
    floor: { type: 'checker', color: '#f4f4f4', accent: '#2d2d2d', scale: 12 * IN, rotation: Math.PI / 4 },
  });
  const bed2 = createRoom('Office', rectPoints(22 * FT, 14 * FT, 10 * FT, 12 * FT), {
    wallColor: '#efe6d8',
    ceiling: { type: 'shed', peakHeight: 10 * FT, angle: Math.PI / 2, trayInset: 0.45 },
    floor: { type: 'herringbone', color: '#b48a5e', accent: '#7f5c3a', scale: 4 * IN, rotation: 0 },
  });
  p.rooms.push(kitchen, living, bed, bath, bed2);
  p.openings.push(
    op(kitchen, 1, 7, 'opening', 72, 84),
    op(kitchen, 0, 8.5, 'window', 40, 40, 42),
    op(kitchen, 2, 11, 'door', 32, 80),
    op(living, 1, 3, 'door', 36, 80),
    op(living, 0, 4.5, 'window', 48, 54, 24),
    op(living, 0, 13.5, 'window', 48, 54, 24),
    op(living, 1, 9.5, 'sliding-door', 72, 80),
    op(bath, 0, 4, 'door', 30, 80),
    op(bath, 2, 4, 'window', 30, 24, 54),
    op(bed2, 0, 3, 'door', 32, 80),
    op(bed2, 1, 6, 'window', 48, 48, 30),
    op(bed, 3, 6, 'window', 48, 48, 30),
    op(bed, 2, 7, 'window', 36, 48, 30),
  );

  // Kitchen: generated L + island
  const kw = roomWalls(kitchen).find((w) => w.index === 3)!;
  const kitchenOpts = {
    layout: 'L+island' as const,
    wallIndex: kw.index,
    wallCabinets: true,
    cabinetColor: '#f3f1ec',
    countertopColor: '#e4e1db',
    applianceColor: '#c9ccd1',
    handleColor: '#3b3b3b',
    islandColor: '#3f5468',
    replace: true,
  };
  const kitchenItems = generateKitchenSafe(p, kitchen, kitchenOpts).items;
  p.kitchen = { ...kitchenOpts };
  p.items.push(...kitchenItems);
  const island = kitchenItems.find((i) => i.kind === 'island');
  if (island) {
    for (const dx of [-0.6, 0, 0.6]) {
      const cosr = Math.cos(island.rotation);
      const sinr = Math.sin(island.rotation);
      const back = { x: island.x + sinr * (island.depth / 2 + 0.25), z: island.z - cosr * (island.depth / 2 + 0.25) };
      const st = createItem(catalogEntry('bar-stool')!, back.x + cosr * dx, back.z + sinr * dx);
      p.items.push(st);
      const pend = createItem(catalogEntry('pendant')!, island.x + cosr * dx, island.z + sinr * dx);
      pend.y = kitchen.wallHeight - pend.height;
      p.items.push(pend);
    }
  }
  p.items.push(put('recessed', 4, 4, 0, {}, 8), put('recessed', 10, 4, 0, {}, 8), put('recessed', 4, 10, 0, {}, 8), put('recessed', 10, 10, 0, {}, 8));

  // Living room
  p.items.push(
    put('rug', 23, 7.5),
    put('sofa', 23, 11.5, 180),
    put('coffee-table', 23, 7.5),
    put('armchair', 18, 7.5, -90),
    put('tv-stand', 23, 1.3),
    put('tv', 23, 1.15, 0, { y: 26 * IN }),
    put('floor-lamp', 27.5, 12.2),
    put('plant', 31, 13),
    put('ceiling-fan', 23, 7.5, 0, {}, 12),
  );
  // Bedroom
  p.items.push(
    // headboard against the west wall; nightstands just clear of the 64" wide bed
    put('bed', 3.75, 20, -90),
    put('nightstand', 0.9, 16.25, -90),
    put('nightstand', 0.9, 23.75, -90),
    put('table-lamp', 0.9, 23.75, -90, { y: 24 * IN }),
    put('dresser', 10, 25.3, 180),
    put('wall-art', 0.25, 20, -90, { y: 54 * IN }),
    put('ceiling-light', 7, 20, 0, {}, 9),
  );
  // Bath
  p.items.push(put('bathtub', 18, 15.5, 0), put('toilet', 15.4, 21.5, -90), put('vanity', 18, 25.1, 180, { width: 48 * IN }), put('mirror', 18, 25.9, 180, { y: 40 * IN }), put('ceiling-light', 18, 20, 0, {}, 8));
  // Office
  p.items.push(put('desk', 30.65, 20, 90), put('office-chair', 28.4, 20, -90), put('bookshelf', 24, 25.5, 180), put('ceiling-light', 27, 20, 0, {}, 9));
  return p;
}

export function singleRoom(): Project {
  const p = emptyProject();
  p.name = 'My Room';
  const r = createRoom('Room', rectPoints(0, 0, 14 * FT, 12 * FT));
  p.rooms.push(r);
  p.openings.push(op(r, 2, 3, 'door', 32, 80), op(r, 0, 7, 'window', 48, 48, 30));
  return p;
}

export function kitchenStarter(): Project {
  const p = emptyProject();
  p.name = 'Kitchen Design';
  const r = createRoom('Kitchen', rectPoints(0, 0, 16 * FT, 13 * FT), { floor: { type: 'stone', color: '#d6d0c4', accent: '#a69f92', scale: 24 * IN, rotation: 0 } });
  p.rooms.push(r);
  p.openings.push(op(r, 0, 8, 'window', 42, 40, 42), op(r, 2, 12, 'opening', 48, 84));
  const opts = {
    layout: 'U' as const,
    wallIndex: 0,
    wallCabinets: true,
    cabinetColor: '#33475b',
    countertopColor: '#f2f0eb',
    applianceColor: '#c9ccd1',
    handleColor: '#c8a45a',
    islandColor: '#33475b',
    replace: true,
  };
  p.items.push(...generateKitchenSafe(p, r, opts).items);
  p.kitchen = { ...opts };
  return p;
}

export function blank(): Project {
  const p = emptyProject();
  p.name = 'New Home';
  return p;
}

export const TEMPLATES: { id: string; name: string; desc: string; make: () => Project }[] = [
  { id: 'sample', name: 'Sample home', desc: '5 rooms, kitchen with island, vaulted living room', make: sampleHouse },
  { id: 'kitchen', name: 'Kitchen starter', desc: 'U-shaped kitchen ready to customize', make: kitchenStarter },
  { id: 'room', name: 'Single room', desc: 'One 14′ × 12′ room with door & window', make: singleRoom },
  { id: 'blank', name: 'Blank canvas', desc: 'Draw your own floor plan', make: blank },
];
