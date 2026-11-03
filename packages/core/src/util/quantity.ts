/** Integer quantity helpers. Quantities are milli-units of the base unit (1 unit = 1000). */
import { normalizeDigits, toBengaliDigits } from './numbers.js';
import { roundHalfUp } from './money.js';

export const MILLI = 1000;

/** Parse a user quantity (Bengali/English digits, up to 3 decimals) into integer milli-units. */
export function parseQty(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('Invalid quantity');
    return Math.round(input * MILLI);
  }
  let s = normalizeDigits(String(input)).trim().replace(/[,\s]/g, '');
  if (s === '') throw new Error('Empty quantity');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error(`Invalid quantity: ${input}`);
  const [whole, frac = ''] = s.split('.');
  const v = parseInt(whole, 10) * MILLI + parseInt((frac + '000').slice(0, 3), 10);
  const out = neg ? -v : v;
  if (!Number.isSafeInteger(out)) throw new Error('Quantity out of range');
  return out;
}

export function formatQty(milli: number, digits: 'bn' | 'en' = 'bn', maxDecimals = 3): string {
  const neg = milli < 0;
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / MILLI);
  let frac = abs % MILLI;
  let out = String(whole);
  if (frac > 0) {
    let f = String(frac).padStart(3, '0');
    f = f.slice(0, maxDecimals).replace(/0+$/, '');
    if (f) out += '.' + f;
  }
  if (digits === 'bn') out = toBengaliDigits(out);
  return neg ? `-${out}` : out;
}

/** Convert a quantity in a selling unit to base milli-units given a conversion factor (milli). */
export function toBaseQty(qtyInUnit: number, factorMilli: number): number {
  return roundHalfUp(qtyInUnit * factorMilli, MILLI);
}

/** Unit cost per base unit from a line: total cost poisha / qty milli → cost per whole unit (rounded). */
export function unitCostFromLine(totalPoisha: number, qtyMilli: number): number {
  if (qtyMilli <= 0) throw new Error('qty must be positive');
  return roundHalfUp(totalPoisha * MILLI, qtyMilli);
}
