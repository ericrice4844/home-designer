import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../src/model';
import { projectAssetIds } from '../src/projectAssets';
import { buildLineMask, calibrate, checkDimension, createUnderlay, fixStretch, pixelToWorld, rotateUnderlay, snapToLines, worldToPixel } from '../src/underlay';
import { roomProject } from './helpers';

const FT = 0.3048;

describe('transforms', () => {
  it('pixel ↔ world round-trips at any rotation and stretch', () => {
    const u = createUnderlay('a', 1000, 700, { x: 3, z: 2 });
    u.scaleZ *= 1.07;
    for (const rot of [0, Math.PI / 2, 2.1, Math.PI]) {
      u.rotation = rot;
      for (const p of [{ x: 0, y: 0 }, { x: 812, y: 133 }, { x: 1000, y: 700 }]) {
        const back = worldToPixel(u, pixelToWorld(u, p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('a new plan is centered where it was placed', () => {
    const u = createUnderlay('a', 1000, 500, { x: 10, z: 4 }, 20);
    const c = pixelToWorld(u, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(10);
    expect(c.z).toBeCloseTo(4);
    expect(u.scaleX * 1000).toBeCloseTo(20);
  });

  it('rotating 90° keeps the center and swaps width/height on screen', () => {
    const u = createUnderlay('a', 1000, 500, { x: 0, z: 0 }, 20);
    rotateUnderlay(u, 1);
    const c = pixelToWorld(u, { x: 500, y: 250 });
    expect(c.x).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(0);
    const right = pixelToWorld(u, { x: 1000, y: 250 });
    expect(right.x).toBeCloseTo(0); // image x now points down the plan (+z)
    expect(right.z).toBeCloseTo(10);
  });
});

describe('calibration', () => {
  // a plan drawn at 920 px = 30 ft
  const plan = () => createUnderlay('a', 1000, 700, { x: 0, z: 0 }, 10);
  const px = (u: ReturnType<typeof plan>, x: number, y: number) => pixelToWorld(u, { x, y });

  it('two points + a real length set the scale, anchored at the first point', () => {
    const u = plan();
    const a = px(u, 40, 40);
    const b = px(u, 960, 40);
    calibrate(u, a, b, 30 * FT);
    const a2 = px(u, 40, 40);
    const b2 = px(u, 960, 40);
    expect(a2.x).toBeCloseTo(a.x, 9);
    expect(a2.z).toBeCloseTo(a.z, 9);
    expect(Math.hypot(b2.x - a2.x, b2.z - a2.z)).toBeCloseTo(30 * FT, 9);
    expect(u.calibrated).toBe(true);
    // a 460 px interior span now reads 15 ft
    expect(Math.hypot(px(u, 500, 40).x - a2.x, 0)).toBeCloseTo(15 * FT, 6);
  });

  it('rejects zero / tiny measurements', () => {
    const u = plan();
    expect(() => calibrate(u, px(u, 10, 10), px(u, 11, 10), 3)).toThrow(/farther apart/);
    expect(() => calibrate(u, px(u, 10, 10), px(u, 500, 10), 0)).toThrow(/positive/);
  });

  it('a second dimension reports the error; a squashed photo can be fixed exactly', () => {
    const u = plan();
    // the photo is squashed vertically: 600 px tall in the image represents 22 ft (should be 920 px = 30 ft scale → 19.57 ft)
    calibrate(u, px(u, 40, 40), px(u, 960, 40), 30 * FT);
    const a = px(u, 40, 40);
    const b = px(u, 40, 640);
    const check = checkDimension(u, a, b, 22 * FT);
    expect(check.error).toBeLessThan(-0.05); // plan reads short vertically
    expect(check.canFixStretch).toBe(true);
    expect(fixStretch(u, a, b, 22 * FT)).toBe(true);
    const a2 = px(u, 40, 40);
    expect(Math.hypot(px(u, 960, 40).x - a2.x, px(u, 960, 40).z - a2.z)).toBeCloseTo(30 * FT, 6);
    expect(Math.hypot(px(u, 40, 640).x - a2.x, px(u, 40, 640).z - a2.z)).toBeCloseTo(22 * FT, 6);
    expect(a2.x).toBeCloseTo(a.x, 9);
  });

  it('a second dimension parallel to the first cannot fix stretch (only reports)', () => {
    const u = plan();
    calibrate(u, px(u, 40, 40), px(u, 960, 40), 30 * FT);
    const check = checkDimension(u, px(u, 40, 300), px(u, 500, 300), 15.5 * FT);
    expect(check.canFixStretch).toBe(false);
    expect(check.error).toBeCloseTo(15 / 15.5 - 1, 3);
  });

  it('an absurd second entry (typo) is not applied as a stretch', () => {
    const u = plan();
    calibrate(u, px(u, 40, 40), px(u, 960, 40), 30 * FT);
    expect(checkDimension(u, px(u, 40, 40), px(u, 40, 640), 60 * FT).canFixStretch).toBe(false);
  });
});

describe('wall-line snapping', () => {
  /** white 400×300 image with 10 px black walls: outer box and an interior wall at x = 200 */
  function planImage() {
    const W = 400,
      H = 300;
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([0, 0, 0, 255], (y * W + x) * 4);
    };
    ink(20, 20, 380, 30); // top wall, centerline y = 24.5
    ink(20, 270, 380, 280); // bottom
    ink(20, 20, 30, 280); // left, centerline x = 24.5
    ink(370, 20, 380, 280); // right
    ink(195, 30, 205, 270); // interior, centerline x = 199.5
    // a dimension label (text-like blob) inside the room
    ink(90, 140, 140, 150);
    return buildLineMask(d, W, H);
  }

  it('snaps to the centerline of a nearby wall on each axis', () => {
    const m = planImage();
    expect(snapToLines(m, { x: 205, y: 120 }, 12)).toEqual({ x: 199.5 });
    const corner = snapToLines(m, { x: 30, y: 31 }, 12);
    expect(corner.x).toBeCloseTo(24.5);
    expect(corner.y).toBeCloseTo(24.5);
  });

  it('ignores points far from any wall', () => {
    expect(snapToLines(planImage(), { x: 300, y: 150 }, 12)).toEqual({});
  });

  it('a long dark run (the wall you are moving along) is not a snap target on that axis', () => {
    // standing on the top wall: x must not snap to the middle of the 360 px long wall
    const s = snapToLines(planImage(), { x: 300, y: 26 }, 12);
    expect(s.x).toBeUndefined();
    expect(s.y).toBeCloseTo(24.5);
  });

  it('adapts the threshold to grey paper and faint ink', () => {
    const W = 100,
      H = 40;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) d.set([205, 198, 180, 255], i * 4); // beige paper
    for (let y = 0; y < H; y++) for (let x = 48; x < 54; x++) d.set([120, 115, 105, 255], (y * W + x) * 4); // faint grey wall
    const m = buildLineMask(d, W, H);
    expect(snapToLines(m, { x: 45, y: 20 }, 10).x).toBeCloseTo(50.5);
  });

  it('works on a downscaled mask (big photos)', () => {
    const full = planImage();
    const half = { ...full, scale: 1 }; // treat it as a mask of a 2× larger image
    half.scale = 0.5;
    expect(snapToLines(half, { x: 410, y: 240 }, 24).x).toBeCloseTo(399);
  });
});

describe('saving', () => {
  it('the underlay round-trips through save/load and its image is exported', () => {
    const { p } = roomProject();
    p.underlay = createUnderlay('plan-img', 800, 600, { x: 2, z: 1 });
    calibrate(p.underlay, pixelToWorld(p.underlay, { x: 10, y: 10 }), pixelToWorld(p.underlay, { x: 700, y: 10 }), 9);
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.underlay).toEqual(p.underlay);
    expect(projectAssetIds(back)).toContain('plan-img');
  });

  it('a damaged underlay is dropped without losing the design', () => {
    const { p } = roomProject();
    const raw = { ...JSON.parse(JSON.stringify(p)), underlay: { assetId: 'x', scaleX: -1 } };
    const back = normalizeProject(raw);
    expect(back.underlay).toBeUndefined();
    expect(back.rooms).toHaveLength(1);
  });
});

describe('corner snapping', () => {
  it('snaps both axes at a wall junction, where nearby rows lie inside the perpendicular wall', () => {
    const W = 200,
      H = 200;
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([0, 0, 0, 255], (y * W + x) * 4);
    };
    ink(40, 40, 200, 50); // horizontal wall, centerline y = 44.5
    ink(40, 40, 50, 200); // vertical wall, centerline x = 44.5
    const m = buildLineMask(d, W, H);
    for (const p of [{ x: 41, y: 47 }, { x: 48, y: 42 }, { x: 52, y: 52 }, { x: 38, y: 38 }]) {
      const s = snapToLines(m, p, 12);
      expect(s.x).toBeCloseTo(44.5, 1);
      expect(s.y).toBeCloseTo(44.5, 1);
    }
  });
});
