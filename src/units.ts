import { FT, IN } from './model';

export type Units = 'imperial' | 'metric';

/** Format a length in meters for display. */
export function formatLength(m: number, units: Units, precise = false): string {
  if (!isFinite(m)) return '–';
  const neg = m < 0;
  m = Math.abs(m);
  let s: string;
  if (units === 'metric') {
    s = m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(precise ? 3 : 2)} m`;
  } else {
    const totalIn = m / IN;
    const step = precise ? 8 : 2; // 1/8" or 1/2" precision
    let rounded = Math.round(totalIn * step) / step;
    let ft = Math.floor(rounded / 12);
    let inches = rounded - ft * 12;
    if (inches >= 12) {
      ft += 1;
      inches -= 12;
    }
    const inStr = formatInches(inches, step);
    s = ft > 0 ? `${ft}' ${inStr}"` : `${inStr}"`;
  }
  return neg ? `-${s}` : s;
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
 * Accepts: 10' 6", 10'6, 10ft 6in, 126", 126 in, 3.2m, 320cm, 3200mm, 10.5 (in current unit: ft or m).
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!s) return null;
  const num = '(-?\\d+(?:\\.\\d+)?(?:\\s+\\d+/\\d+)?|-?\\d+/\\d+)';
  const toNum = (t: string): number => {
    t = t.trim();
    const parts = t.split(/\s+/);
    let v = 0;
    for (const part of parts) {
      if (part.includes('/')) {
        const [a, b] = part.split('/').map(Number);
        v += (v < 0 ? -1 : 1) * (a / b);
      } else v += Number(part);
    }
    return v;
  };
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${num}\\s*mm$`)))) return toNum(m[1]) / 1000;
  if ((m = s.match(new RegExp(`^${num}\\s*cm$`)))) return toNum(m[1]) / 100;
  if ((m = s.match(new RegExp(`^${num}\\s*m$`)))) return toNum(m[1]);
  if ((m = s.match(new RegExp(`^${num}\\s*(?:'|ft|feet|foot)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`)))) {
    return toNum(m[1]) * FT + (m[2] ? toNum(m[2]) * IN : 0);
  }
  if ((m = s.match(new RegExp(`^${num}\\s*(?:"|in|inch|inches)$`)))) return toNum(m[1]) * IN;
  if ((m = s.match(new RegExp(`^${num}$`)))) {
    const v = toNum(m[1]);
    return units === 'metric' ? v : v * FT;
  }
  return null;
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
