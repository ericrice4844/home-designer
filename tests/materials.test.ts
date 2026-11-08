import { describe, expect, it } from 'vitest';
import { splitWall } from '../src/edits';
import { finishFromPreset, finishKey, GROUPS, MATERIAL_PRESETS, mix, PATTERNS, presetById, presetsFor, shadesOf, withColor, withPattern } from '../src/materials';
import { FINISH_TYPES, normalizeFinish, normalizeProject, type Finish } from '../src/model';
import { projectAssetIds } from '../src/projectAssets';
import { addItem, roomProject } from './helpers';

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

describe('patterns & presets', () => {
  it('every pattern has a group, labels and a sensible default look', () => {
    for (const t of FINISH_TYPES) {
      const p = PATTERNS[t];
      expect(GROUPS.map((g) => g[0])).toContain(p.group);
      expect(p.label.length).toBeGreaterThan(2);
      expect(isHex(p.defaults.color) && isHex(p.defaults.accent)).toBe(true);
      expect(p.defaults.scale).toBeGreaterThan(0.005);
      expect(p.roughness).toBeGreaterThanOrEqual(0);
      expect(p.roughness).toBeLessThanOrEqual(1);
    }
  });

  it('there are plenty of wood, tile and stone patterns', () => {
    const count = (g: string) => FINISH_TYPES.filter((t) => PATTERNS[t].group === g).length;
    expect(count('wood')).toBeGreaterThanOrEqual(6);
    expect(count('tile')).toBeGreaterThanOrEqual(6);
    expect(count('stone')).toBeGreaterThanOrEqual(4);
  });

  it('presets are unique, valid and survive validation unchanged', () => {
    const ids = MATERIAL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MATERIAL_PRESETS) {
      const f = finishFromPreset(p);
      expect(f.preset).toBe(p.id);
      expect(normalizeFinish(f)).toEqual(f);
      expect(presetById(p.id)).toBe(p);
      // a preset sits in the group of its pattern
      expect(p.group).toBe(PATTERNS[p.finish.type].group);
    }
  });

  it('each surface gets a good choice in every group it uses', () => {
    for (const s of ['floor', 'wall', 'ceiling', 'item'] as const) {
      expect(presetsFor(s, 'wood').length).toBeGreaterThanOrEqual(5);
      expect(presetsFor(s, 'stone').length).toBeGreaterThanOrEqual(3);
    }
    for (const s of ['floor', 'wall'] as const) expect(presetsFor(s, 'tile').length).toBeGreaterThanOrEqual(8);
    // countertops: stone and butcher block, but no carpet or grouted tile
    const counter = presetsFor('counter');
    expect(counter.some((p) => p.id === 'carrara')).toBe(true);
    expect(counter.some((p) => p.id === 'butcher-block')).toBe(true);
    expect(counter.some((p) => p.finish.type === 'carpet' || p.finish.type === 'subway')).toBe(false);
    // carpet only on floors
    expect(presetsFor('wall').some((p) => p.finish.type === 'carpet')).toBe(false);
  });
});

describe('picking patterns and colors', () => {
  it('a new pattern brings its own colors and size', () => {
    const oak = finishFromPreset(presetById('oak')!);
    const hex = withPattern(oak, 'hex');
    expect(hex).toMatchObject({ type: 'hex', ...PATTERNS.hex.defaults });
    expect(hex.preset).toBeUndefined();
    // picking the same pattern again keeps the current mix
    expect(withPattern(oak, 'hardwood')).toBe(oak);
  });

  it('keeps an imported image and the accents-off choice when switching pattern', () => {
    const f: Finish = { type: 'custom', color: '#cccccc', accent: '#999999', scale: 1, rotation: 0, imageAsset: 'a1', accents: false };
    expect(withPattern(f, 'tile')).toMatchObject({ type: 'tile', imageAsset: 'a1', accents: false });
  });

  it('changing a color by hand makes it a custom mix', () => {
    const f = withColor(finishFromPreset(presetById('walnut')!), 'accent', '#000000');
    expect(f.accent).toBe('#000000');
    expect(f.preset).toBeUndefined();
    expect(f.color).toBe(presetById('walnut')!.finish.color);
  });

  it('the swatches start from the current color: its own shades, then toward the other color', () => {
    const s = shadesOf('#B07A4A', '#2d2d2d');
    expect(s).toContain('#b07a4a');
    expect(s.every(isHex)).toBe(true);
    expect(s.length).toBeGreaterThanOrEqual(9);
    // ordered dark → light around the current color
    const lum = (c: string) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
    const own = s.slice(0, 7);
    for (let i = 1; i < own.length; i++) expect(lum(own[i])).toBeGreaterThan(lum(own[i - 1]));
    expect(s[s.length - 1]).toBe('#2d2d2d');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(shadesOf('#fff')).toContain('#ffffff');
  });

  it('the texture key changes with every visible property, accents included', () => {
    const f = finishFromPreset(presetById('carrara')!);
    const keys = new Set([f, { ...f, color: '#000000' }, { ...f, accent: '#000000' }, { ...f, scale: 2 }, { ...f, rotation: 1 }, { ...f, accents: false }, { ...f, type: 'tile' as const }].map(finishKey));
    expect(keys.size).toBe(7);
    // the preset name alone does not need a new texture
    expect(finishKey({ ...f, preset: undefined })).toBe(finishKey(f));
  });
});

describe('validation of materials in project files', () => {
  it('rejects unknown patterns and bad values', () => {
    expect(normalizeFinish({ type: 'lava', color: '#fff' })).toBeUndefined();
    expect(normalizeFinish('oak')).toBeUndefined();
    const f = normalizeFinish({ type: 'marble', color: 'red', accent: '#123', scale: 1e9, rotation: NaN, accents: 'no', preset: 7 })!;
    expect(f).toEqual({ type: 'marble', color: '#b07a4a', accent: '#123', scale: 10, rotation: 0 });
    expect(normalizeFinish({ type: 'tile', scale: -1 })!.scale).toBe(0.005);
    expect(normalizeFinish({ type: 'tile', accents: false })!.accents).toBe(false);
  });

  it('an imported pattern whose image is missing falls back to planks', () => {
    expect(normalizeFinish({ type: 'custom', color: '#abcdef' })).toMatchObject({ type: 'hardwood', color: '#abcdef' });
  });

  it('round-trips wall, ceiling, per-wall and item materials; drops broken ones', () => {
    const { p, room } = roomProject();
    room.wallFinish = finishFromPreset(presetById('subway-white')!);
    room.ceilingFinish = finishFromPreset(presetById('cedar-ceiling')!);
    room.wallFinishes = { 1: finishFromPreset(presetById('brick-red')!), 2: { type: 'nope' } as any, 9: finishFromPreset(presetById('oak')!) };
    room.floor = { ...finishFromPreset(presetById('oak-chevron')!), accents: false };
    const it = addItem(p, 'base-cabinet', 1, 0.3, {
      finish: finishFromPreset(presetById('walnut')!),
      accentFinish: { type: 'bogus' } as any,
      counterFinish: finishFromPreset(presetById('carrara')!),
    });
    const q = normalizeProject(JSON.parse(JSON.stringify(p)));
    const r = q.rooms[0];
    expect(r.wallFinish).toEqual(room.wallFinish);
    expect(r.ceilingFinish).toEqual(room.ceilingFinish);
    expect(r.wallFinishes).toEqual({ 1: room.wallFinishes[1] }); // bad pattern and a wall that doesn't exist dropped
    expect(r.floor).toEqual(room.floor);
    const qi = q.items.find((i) => i.id === it.id)!;
    expect(qi.finish).toEqual(it.finish);
    expect(qi.counterFinish).toEqual(it.counterFinish);
    expect(qi.accentFinish).toBeUndefined();
  });

  it('a room with a bad floor gets the default floor instead of failing', () => {
    const { p } = roomProject();
    const raw = JSON.parse(JSON.stringify(p));
    raw.rooms[0].floor = { type: 'quicksand' };
    expect(normalizeProject(raw).rooms[0].floor.type).toBe('hardwood');
  });

  it('imported pattern images used anywhere are bundled with the project', () => {
    const { p, room } = roomProject();
    const img = (id: string): Finish => ({ type: 'custom', color: '#cccccc', accent: '#999999', scale: 1, rotation: 0, imageAsset: id });
    room.floor = img('f');
    room.wallFinish = img('w');
    room.wallFinishes = { 0: img('w0') };
    room.ceilingFinish = img('c');
    addItem(p, 'sofa', 1, 1, { finish: img('i1'), accentFinish: img('i2'), counterFinish: img('i3') });
    expect(projectAssetIds(p).sort()).toEqual(['c', 'f', 'i1', 'i2', 'i3', 'w', 'w0']);
  });

  it('splitting a wall keeps its material on both halves and shifts the ones after it', () => {
    const { p, room } = roomProject();
    const brick = finishFromPreset(presetById('brick-red')!);
    const tile = finishFromPreset(presetById('white-tile')!);
    room.wallFinishes = { 0: brick, 2: tile };
    splitWall(p, room.id, 0);
    expect(room.wallFinishes).toEqual({ 0: brick, 1: brick, 3: tile });
    expect(room.wallFinishes[1]).not.toBe(room.wallFinishes[0]); // independent copies
  });
});

describe('kitchen countertops and cabinet materials', () => {
  it('the generated kitchen gets a real countertop material, or a solid color when none is picked', async () => {
    const { generateKitchenSafe, kitchenOptionsFrom, DEFAULT_KITCHEN_OPTIONS } = await import('../src/kitchen');
    const { emptyProject, createRoom, rectPoints, FT } = await import('../src/model');
    const p = emptyProject();
    const r = createRoom('K', rectPoints(0, 0, 14 * FT, 12 * FT));
    p.rooms.push(r);
    const base = { ...DEFAULT_KITCHEN_OPTIONS, layout: 'L+island' as const };
    const marble = generateKitchenSafe(p, r, { ...base, countertopMaterial: 'carrara' }).items.filter((i) => i.countertop || i.kind === 'island');
    expect(marble.length).toBeGreaterThan(2);
    for (const it of marble) {
      expect(it.counterFinish).toMatchObject({ type: 'marble', preset: 'carrara' });
      expect(it.countertopColor).toBe(it.counterFinish!.color);
    }
    const solid = generateKitchenSafe(p, r, { ...base, countertopMaterial: '', countertopColor: '#2a2a2a' }).items.filter((i) => i.countertop);
    for (const it of solid) {
      expect(it.counterFinish).toBeUndefined();
      expect(it.countertopColor).toBe('#2a2a2a');
    }
    // saved options: an unknown or non-countertop material falls back to the default
    p.kitchen = { countertopMaterial: 'carpet-beige' };
    expect(kitchenOptionsFrom(p).countertopMaterial).toBe(DEFAULT_KITCHEN_OPTIONS.countertopMaterial);
    p.kitchen = { countertopMaterial: '' };
    expect(kitchenOptionsFrom(p).countertopMaterial).toBe('');
  });
});
