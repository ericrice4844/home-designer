// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateKitchenSafe, kitchenOptionsFrom } from '../src/kitchen';
import { getStyle } from '../src/itemStyles';
import { store } from '../src/state';
import { applyCabinetStyle } from '../src/ui/stylePanel';
import { addItem, roomProject } from './helpers';

const FT = 0.3048;
const base = { layout: 'L' as const, wallIndex: 0, wallCabinets: true, cabinetColor: '#fff', countertopColor: '#eee', applianceColor: '#ccc', handleColor: '#888', islandColor: '#345', replace: true };

describe('kitchen-wide cabinet styles', () => {
  it('generated cabinets get the chosen door style and hardware; appliances do not', () => {
    const { p, room } = roomProject(16 * FT, 13 * FT);
    const { items } = generateKitchenSafe(p, room, { ...base, door: 'slab', pull: 'edge' });
    const cabs = items.filter((i) => i.category === 'kitchen' && i.kind !== 'open-shelf');
    expect(cabs.length).toBeGreaterThan(5);
    for (const c of cabs) expect(getStyle(c)).toMatchObject({ door: 'slab', pull: 'edge' });
    for (const a of items.filter((i) => i.category === 'appliance')) expect(a.style?.door).toBeUndefined();
  });

  it('saved kitchen options keep valid door/hardware and reset invalid ones', () => {
    const { p } = roomProject();
    p.kitchen = { door: 'raised', pull: 'gold-plated' };
    expect(kitchenOptionsFrom(p)).toMatchObject({ door: 'raised', pull: 'bar' });
  });
});

describe('apply door style & hardware to the whole room', () => {
  it('copies to every cabinet in the same room only, as one undo step', () => {
    const { p } = roomProject();
    const src = addItem(p, 'base-cabinet', 1, 0.4, { style: { door: 'beadboard', pull: 'cup' } });
    const upper = addItem(p, 'wall-cabinet', 1, 0.2);
    const sink = addItem(p, 'sink-base', 2, 0.4, { style: { sink: 'farmhouse' } });
    const elsewhere = addItem(p, 'base-cabinet', 20, 20);
    const sofa = addItem(p, 'sofa', 2, 2);
    store.load(p);
    expect(applyCabinetStyle(store.item(src.id)!)).toBe(2);
    expect(getStyle(store.item(upper.id)!)).toMatchObject({ door: 'beadboard', pull: 'cup' });
    expect(getStyle(store.item(sink.id)!)).toMatchObject({ door: 'beadboard', pull: 'cup', sink: 'farmhouse' }); // other choices kept
    expect(store.item(elsewhere.id)!.style).toBeUndefined();
    expect(store.item(sofa.id)!.style).toBeUndefined();
    store.undo();
    expect(store.item(upper.id)!.style).toBeUndefined();
  });
});

describe('the Kitchen tab works on the kitchen', () => {
  it('a sofa selected in the living room does not redirect it to the living room', async () => {
    const { kitchenRoom } = await import('../src/ui/kitchenPanel');
    const { sampleHouse } = await import('../src/templates');
    store.load(sampleHouse());
    const sofa = store.project.items.find((i) => i.kind === 'sofa')!;
    store.select({ type: 'item', id: sofa.id });
    expect(kitchenRoom()!.name).toBe('Kitchen');
    // selecting something in the kitchen keeps the kitchen
    const range = store.project.items.find((i) => i.kind === 'range')!;
    store.select({ type: 'item', id: range.id });
    expect(kitchenRoom()!.name).toBe('Kitchen');
    // but a room chosen on purpose (to plan a new kitchen there) is respected
    const office = store.project.rooms.find((r) => r.name === 'Office')!;
    store.select({ type: 'room', id: office.id });
    expect(kitchenRoom()!.name).toBe('Office');
  });
});

describe('cabinet materials apply to the whole room', () => {
  it('copies body, handle and countertop materials to the other cabinets in the room only', async () => {
    const { applyCabinetFinishes } = await import('../src/ui/stylePanel');
    const { finishFromPreset, presetById } = await import('../src/materials');
    const { store } = await import('../src/state');
    const { sampleHouse } = await import('../src/templates');
    store.load(sampleHouse());
    const cabs = store.project.items.filter((i) => i.category === 'kitchen');
    const src = cabs.find((i) => i.kind === 'base-cabinet')!;
    const walnut = finishFromPreset(presetById('walnut')!);
    const nero = finishFromPreset(presetById('nero')!);
    store.update((p) => {
      const q = p.items.find((i) => i.id === src.id)!;
      q.finish = walnut;
      q.color = walnut.color;
      q.counterFinish = nero;
    });
    const n = applyCabinetFinishes(store.item(src.id)!);
    expect(n).toBeGreaterThan(3);
    const others = store.project.items.filter((i) => i.category === 'kitchen' && i.id !== src.id);
    for (const q of others) {
      expect(q.finish?.preset).toBe('walnut');
      expect(q.color).toBe(walnut.color);
      if (q.countertop) expect(q.counterFinish?.preset).toBe('nero');
    }
    // non-kitchen items untouched
    expect(store.project.items.filter((i) => i.category !== 'kitchen').some((i) => i.finish)).toBe(false);
    store.undo();
    expect(store.project.items.filter((i) => i.id !== src.id).some((i) => i.finish)).toBe(false);
  });
});
