import { describe, expect, it } from 'vitest';
import { FT, IN } from '../src/model';
import { formatLength, parseLength } from '../src/units';

describe('parseLength', () => {
  it('parses feet and inches in many forms', () => {
    expect(parseLength(`10' 6"`, 'imperial')).toBeCloseTo(10 * FT + 6 * IN);
    expect(parseLength(`10'6`, 'imperial')).toBeCloseTo(10 * FT + 6 * IN);
    expect(parseLength('10ft 6in', 'imperial')).toBeCloseTo(10 * FT + 6 * IN);
    expect(parseLength('126"', 'imperial')).toBeCloseTo(126 * IN);
    expect(parseLength('34 1/2"', 'imperial')).toBeCloseTo(34.5 * IN);
    expect(parseLength('12', 'imperial')).toBeCloseTo(12 * FT);
  });
  it('parses metric', () => {
    expect(parseLength('3.2m', 'metric')).toBeCloseTo(3.2);
    expect(parseLength('320cm', 'imperial')).toBeCloseTo(3.2);
    expect(parseLength('900 mm', 'metric')).toBeCloseTo(0.9);
    expect(parseLength('2.5', 'metric')).toBeCloseTo(2.5);
  });
  it('rejects garbage', () => {
    expect(parseLength('abc', 'metric')).toBeNull();
    expect(parseLength('', 'metric')).toBeNull();
  });
});

describe('formatLength', () => {
  it('formats imperial with fractions', () => {
    expect(formatLength(10 * FT + 6 * IN, 'imperial')).toBe(`10' 6"`);
    expect(formatLength(34.5 * IN, 'imperial')).toBe(`2' 10 1/2"`);
    expect(formatLength(34.125 * IN, 'imperial', true)).toBe(`2' 10 1/8"`);
    expect(formatLength(5 * IN, 'imperial')).toBe(`5"`);
  });
  it('formats metric', () => {
    expect(formatLength(0.45, 'metric')).toBe('45 cm');
    expect(formatLength(3.2, 'metric')).toBe('3.20 m');
  });
  it('round-trips', () => {
    for (const v of [0.3, 1.234, 4.5, 7.77]) {
      const s = formatLength(v, 'imperial', true);
      expect(parseLength(s, 'imperial')!).toBeCloseTo(v, 2);
    }
  });
});
