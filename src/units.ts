import { FT, IN } from './model';

export type Units = 'imperial' | 'metric';

/** Format a length in meters for display. */
export function formatLength(m: number, units: Units, precise = false): string {
  if (!isFinite(m)) return '–';
  let s: string;
  let isZero: boolean;
  if (units === 'metric') {
    const cm = Math.round(Math.abs(m) * 100);
    // decide cm vs m on the rounded value so 0.999 m shows "1.00 m", never "100 cm"
    if (cm < 100) {
      s = `${cm} cm`;
      isZero = cm === 0;
    } else {
      const digits = precise ? 3 : 2;
      s = `${Math.abs(m).toFixed(digits)} m`;
      isZero = false;
    }
  } else {
    const totalIn = Math.abs(m) / IN;
    const step = precise ? 8 : 2; // 1/8" or 1/2" precision
    const rounded = Math.round(totalIn * step) / step;
    let ft = Math.floor(rounded / 12 + 1e-9);
    let inches = rounded - ft * 12;
    if (inches >= 12 - 1e-9) {
      ft += 1;
      inches -= 12;
    }
    const inStr = formatInches(Math.max(0, inches), step);
    s = ft > 0 ? `${ft}' ${inStr}"` : `${inStr}"`;
    isZero = rounded === 0;
  }
  // a tiny negative number that rounds to zero must not show as "-0\""
  return m < 0 && !isZero ? `-${s}` : s;
}

function formatInches(inches: number, step: number): string {
  const whole = Math.floor(inches + 1e-9);
  const frac = inches - whole;
  const n = Math.round(frac * step);
  if (n === 0) return `${whole}`;
  let num = n;
  let den = step;
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
}

/**
 * Parse a user-entered length into meters.
 * Accepts: 10' 6", 10'6, 5'-6", 10ft 6in, 126", 34 1/2", .5", 3.2m, 3,2 m, 320cm, 3200mm.
 * A bare number means inches (imperial) or meters (metric) – the hint next to each field says so.
 */
export function parseLength(input: string, units: Units): number | null {
  let s = input
    .trim()
    .toLowerCase()
    .replace(/[″”“]/g, '"')
    .replace(/[′’‘]/g, "'")
    .replace(/''/g, '"');
  if (!s) return null;
  // decimal comma (3,5 m) – only when it is clearly a decimal separator
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  // feet-inch separator dash: 5'-6"  /  5' - 6
  s = s.replace(/'\s*-\s*(?=\d|\.)/, "' ");
  const num = '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:\\s+\\d+/\\d+)?|-?\\d+/\\d+)';
  const toNum = (t: string): number => {
    t = t.trim();
    const neg = t.startsWith('-');
    let v = 0;
    for (const part of t.replace(/^-/, '').split(/\s+/)) {
      if (part.includes('/')) {
        const [a, b] = part.split('/').map(Number);
        if (!b) return NaN;
        v += a / b;
      } else v += Number(part);
    }
    return neg ? -v : v;
  };
  const done = (v: number) => (Number.isFinite(v) ? v : null);
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${num}\\s*mm$`)))) return done(toNum(m[1]) / 1000);
  if ((m = s.match(new RegExp(`^${num}\\s*cm$`)))) return done(toNum(m[1]) / 100);
  if ((m = s.match(new RegExp(`^${num}\\s*(?:m|meters?|metres?)$`)))) return done(toNum(m[1]));
  if ((m = s.match(new RegExp(`^${num}\\s*(?:'|ft|feet|foot)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`)))) {
    const ft = toNum(m[1]);
    const inch = m[2] ? toNum(m[2]) : 0;
    return done((ft < 0 ? -1 : 1) * (Math.abs(ft) * FT + inch * IN));
  }
  if ((m = s.match(new RegExp(`^${num}\\s*(?:"|in|inch|inches)$`)))) return done(toNum(m[1]) * IN);
  if ((m = s.match(new RegExp(`^${num}$`)))) {
    const v = toNum(m[1]);
    return done(units === 'metric' ? v : v * IN);
  }
  return null;
}

/** Unit a bare number is read in, for input hints. */
export function bareUnitHint(units: Units): string {
  return units === 'metric' ? 'm' : 'in';
}

export function formatArea(m2: number, units: Units): string {
  if (units === 'metric') return `${m2.toFixed(1)} m²`;
  return `${(m2 / (FT * FT)).toFixed(0)} sq ft`;
}

export function formatAngle(rad: number): string {
  let deg = Math.round(((rad * 180) / Math.PI) % 360);
  if (deg < 0) deg += 360;
  return `${deg}°`;
}
