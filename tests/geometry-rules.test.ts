import { describe, expect, it } from 'vitest';
import { itemClearances, itemOutline, snapItemToWall } from '../src/geometry';
import { FT, IN } from '../src/model';
import { formatLength, parseLength } from '../src/units';
import { addDoor, addItem, roomProject } from './helpers';

describe('4.1 walls: hidden walls and openings (P2, P11)', () => {
  it('does not snap to a hidden (open-plan) wall', () => {
    const { p, room } = roomProject();
    const cab = addItem(p, 'base-cabinet', 2, 0.4);
    expect(snapItemToWall(p, cab)).not.toBeNull();
    room.hiddenWalls = [0];
    expect(snapItemToWall(p, cab)).toBeNull();
  });

  it('does not snap a cabinet in front of a doorway', () => {
    const { p, room } = roomProject();
    addDoor(p, room, 0, 2, 'door', 0.9); // north wall, centred at x = 2
    const cab = addItem(p, 'base-cabinet', 2, 0.4);
    expect(snapItemToWall(p, cab)).toBeNull();
  });

  it('still snaps a base cabinet under a window (sill above the counter)', () => {
    const { p, room } = roomProject();
    addDoor(p, room, 0, 2, 'window', 0.9); // sill 0.9 m > 0.876 m cabinet
    const cab = addItem(p, 'base-cabinet', 2, 0.4);
    expect(snapItemToWall(p, cab)).not.toBeNull();
  });

  it('clearances ignore hidden walls and look through doorways', () => {
    const { p, room } = roomProject();
    const box = addItem(p, 'box', 2, 1.5, { width: 1, depth: 1 });
    const north = () => itemClearances(p, box).find((c) => c.to.z < box.z - 0.4);
    expect(north()?.target).toBe('wall');
    addDoor(p, room, 0, 2, 'opening', 1.2);
    expect(north()).toBeUndefined(); // looks through the opening into nothing
    room.hiddenWalls = [3];
    expect(itemClearances(p, box).find((c) => c.to.x < box.x - 0.4)).toBeUndefined();
  });
});

describe('4.2 obstacles (P1) and real shapes', () => {
  it('rugs, lights and wall art do not count as obstacles', () => {
    const { p } = roomProject();
    const sofa = addItem(p, 'sofa', 2, 2.2);
    addItem(p, 'rug', 2, 1.5);
    addItem(p, 'floor-lamp', 3.4, 2.2);
    addItem(p, 'wall-art', 2, 2.9, { y: 0.5 });
    for (const c of itemClearances(p, sofa)) expect(c.target).toBe('wall');
  });

  it('measures to the real L-shape, not its bounding box', () => {
    const { p } = roomProject(8, 8);
    const sectional = addItem(p, 'sectional', 4, 4); // L opens toward +x/+z
    const probe = addItem(p, 'box', 4 + sectional.width / 2 - 0.3, 4 + sectional.depth / 2 + 0.5, { width: 0.2, depth: 0.2 });
    const up = itemClearances(p, probe).find((c) => c.to.z < probe.z - 0.05)!;
    // the bounding box would say 0.5 m; the chaise is not there, so the gap reaches the back seat
    expect(up.distance).toBeGreaterThan(1);
    expect(itemOutline(sectional).length).toBe(6);
  });
});

describe('4.3 length input (P3)', () => {
  it.each([
    [`5'-6"`, 5 * FT + 6 * IN],
    [`5' - 6`, 5 * FT + 6 * IN],
    ['.5"', 0.5 * IN],
    ['0.5in', 0.5 * IN],
    [`3 ft`, 3 * FT],
    ['36', 36 * IN], // bare imperial number = inches
  ])('imperial %s', (s, v) => expect(parseLength(s, 'imperial')!).toBeCloseTo(v, 6));

  it.each([
    ['3,5 m', 3.5],
    ['2,4', 2.4],
    ['.75', 0.75],
    ['240 cm', 2.4],
  ])('metric %s', (s, v) => expect(parseLength(s, 'metric')!).toBeCloseTo(v, 6));

  it('rejects division by zero and junk', () => {
    expect(parseLength('1/0"', 'imperial')).toBeNull();
    expect(parseLength('5 ft banana', 'imperial')).toBeNull();
  });

  it('metric display rounds before choosing cm vs m', () => {
    expect(formatLength(0.999, 'metric')).toBe('1.00 m');
    expect(formatLength(0.994, 'metric')).toBe('99 cm');
  });

  it('never shows -0', () => {
    expect(formatLength(-0.0001, 'imperial')).toBe('0"');
    expect(formatLength(-0.001, 'metric')).toBe('0 cm');
    expect(formatLength(-0.5 * IN * 3, 'imperial')).toBe('-1 1/2"');
  });
});
