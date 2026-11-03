/** Bengali↔English digit normalization and numeric parsing. Original text is never mutated in storage. */

const BN = '০১২৩৪৫৬৭৮৯';
const BN_RE = /[০-৯]/g;

export function normalizeDigits(s: string): string {
  return s.replace(BN_RE, (d) => String(BN.indexOf(d)));
}

export function toBengaliDigits(s: string): string {
  return s.replace(/\d/g, (d) => BN[Number(d)]!);
}

/** Parse an integer quantity/money-ish string with Bengali digits; throws on invalid. */
export function parseIntStrict(input: string | number, label = 'সংখ্যা'): number {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input)) throw new Error(`${label} পূর্ণসংখ্যা হতে হবে`);
    return input;
  }
  const s = normalizeDigits(String(input)).trim().replace(/,/g, '');
  if (!/^-?\d+$/.test(s)) throw new Error(`${label} সঠিক নয়`);
  const v = parseInt(s, 10);
  if (!Number.isSafeInteger(v)) throw new Error(`${label} সীমার বাইরে`);
  return v;
}

/** Parse a decimal number (e.g. quantity in units) accepting Bengali digits. */
export function parseDecimal(input: string | number, label = 'সংখ্যা'): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`${label} সঠিক নয়`);
    return input;
  }
  const s = normalizeDigits(String(input)).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`${label} সঠিক নয়`);
  return parseFloat(s);
}

/** Display a number with lakh/crore grouping and chosen digit style. */
export function formatNumber(n: number, digits: 'bn' | 'en' = 'bn', decimals = 0): string {
  const fixed = n.toFixed(decimals);
  const neg = fixed.startsWith('-');
  const body = neg ? fixed.slice(1) : fixed;
  const [w, f] = body.split('.');
  let grouped = w!;
  if (grouped.length > 3) {
    const last3 = grouped.slice(-3);
    const rest = grouped.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  let out = f ? `${grouped}.${f}` : grouped;
  if (digits === 'bn') out = toBengaliDigits(out);
  return neg ? `-${out}` : out;
}
