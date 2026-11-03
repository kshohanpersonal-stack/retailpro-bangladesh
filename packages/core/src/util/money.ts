/** Integer money helpers. All amounts are poisha (1 BDT = 100 poisha). */
import { normalizeDigits } from './numbers.js';

export const POISHA_PER_TAKA = 100;

/** Half-up rounding of numerator/denominator using pure integer math (both integers, denominator > 0). */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error(`roundHalfUp requires integers, got ${numerator}/${denominator}`);
  }
  const neg = numerator < 0;
  const n = Math.abs(numerator);
  const q = Math.floor(n / denominator);
  const r = n % denominator;
  const rounded = r * 2 >= denominator ? q + 1 : q;
  return neg ? -rounded : rounded;
}

/** Parse a user money string (Bengali or English digits, optional ৳, commas, spaces) into integer poisha. */
export function parseMoney(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid money number');
    return Math.round(input * POISHA_PER_TAKA);
  }
  let s = normalizeDigits(String(input)).trim().replace(/[৳,\s]/g, '');
  if (s === '' || s === '-') throw new Error('Empty money input');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money input: ${input}`);
  const [whole, frac = ''] = s.split('.');
  const poisha = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  const v = neg ? -poisha : poisha;
  if (!Number.isSafeInteger(v)) throw new Error('Money out of range');
  return v;
}

export function formatMoney(poisha: number, opts: { digits?: 'bn' | 'en'; symbol?: boolean; grouping?: 'lakh' | 'west' | 'none' } = {}): string {
  const { digits = 'bn', symbol = true, grouping = 'lakh' } = opts;
  const neg = poisha < 0;
  const abs = Math.abs(poisha);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let w = String(whole);
  if (grouping === 'lakh') w = groupLakh(w);
  else if (grouping === 'west') w = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = frac > 0 ? `${w}.${String(frac).padStart(2, '0')}` : w;
  if (digits === 'bn') out = toBengaliDigits(out);
  if (neg) out = `-${out}`;
  return symbol ? `৳${out}` : out;
}

export function groupLakh(w: string): string {
  if (w.length <= 3) return w;
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

export function toBengaliDigits(s: string): string {
  const map = '০১২৩৪৫৬৭৮৯';
  return s.replace(/\d/g, (d) => map[Number(d)]!);
}

/** Allocate an integer total across weights proportionally, largest-remainder, exact sum. */
export function allocateProRata(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    const base = Math.floor(total / weights.length);
    const out = weights.map(() => base);
    let rem = total - base * weights.length;
    for (let i = 0; rem > 0; i = (i + 1) % weights.length, rem--) out[i]!++;
    return out;
  }
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) floors[order[k % order.length]!.i]!++;
  return floors;
}

/** Percentage discount in basis points applied to an amount. */
export function percentDiscount(amount: number, bp: number): number {
  if (bp < 0 || bp > 10000) throw new Error('Discount bp out of range');
  return roundHalfUp(amount * bp, 10000);
}
