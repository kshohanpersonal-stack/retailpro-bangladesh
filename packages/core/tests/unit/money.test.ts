import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, roundHalfUp, allocateProRata, percentDiscount, groupLakh } from '../../src/util/money.js';
import { parseQty, formatQty, toBaseQty } from '../../src/util/quantity.js';
import { normalizeDigits, parseDecimal, formatNumber } from '../../src/util/numbers.js';
import { normalizeName, normalizeMobile, toCsv } from '../../src/util/text.js';

describe('money', () => {
  it('parses English and Bengali money to integer poisha', () => {
    expect(parseMoney('100')).toBe(10000);
    expect(parseMoney('১০০.৫০')).toBe(10050);
    expect(parseMoney('৳1,234.56')).toBe(123456);
    expect(parseMoney(12.34)).toBe(1234);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('-5.25')).toBe(-525);
  });
  it('rejects invalid money', () => {
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney('1.234')).toThrow();
    expect(() => parseMoney('')).toThrow();
  });
  it('roundHalfUp integer math', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(4, 2)).toBe(2);
    expect(roundHalfUp(1, 3)).toBe(0);
    expect(roundHalfUp(2, 3)).toBe(1);
    expect(roundHalfUp(-5, 2)).toBe(-3);
    expect(roundHalfUp(1000001, 3)).toBe(333334);
  });
  it('formats with lakh grouping and Bengali digits', () => {
    expect(formatMoney(123456789, { digits: 'en', symbol: false })).toBe('12,34,567.89');
    expect(formatMoney(100000, { digits: 'bn', symbol: false })).toBe('১,০০০');
    expect(groupLakh('1234567')).toBe('12,34,567');
  });
  it('pro-rata allocation sums exactly', () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProRata(10, [3, 3, 4])).toEqual([3, 3, 4]);
    const a = allocateProRata(1, [0, 0, 0]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(1);
  });
  it('percent discount in bp', () => {
    expect(percentDiscount(10000, 1000)).toBe(1000); // 10%
    expect(percentDiscount(999, 1500)).toBe(150); // 15% of 9.99 = 1.4985 -> 1.50
  });
});

describe('quantity', () => {
  it('parses to milli-units', () => {
    expect(parseQty('2')).toBe(2000);
    expect(parseQty('১.৫')).toBe(1500);
    expect(parseQty('0.025')).toBe(25);
    expect(parseQty(2.5)).toBe(2500);
  });
  it('formats milli to display', () => {
    expect(formatQty(1500, 'en')).toBe('1.5');
    expect(formatQty(2000, 'bn')).toBe('২');
    expect(formatQty(25, 'en')).toBe('0.025');
  });
  it('unit conversion to base', () => {
    expect(toBaseQty(2000, 12000)).toBe(24000); // 2 carton × 12 = 24 pieces
  });
});

describe('numbers & text', () => {
  it('normalizes Bengali digits', () => {
    expect(normalizeDigits('১২৩৪৫')).toBe('12345');
    expect(parseDecimal('১২.৫')).toBe(12.5);
    expect(formatNumber(1234567, 'bn')).toBe('১২,৩৪,৫৬৭');
  });
  it('normalizes names and mobiles', () => {
    expect(normalizeName('  করিম   স্টোর ')).toBe('করিম স্টোর');
    expect(normalizeName('ABC Store')).toBe('abc store');
    expect(normalizeMobile('+৮৮০ ১৭১২-৩৪৫৬৭৮')).toBe('+8801712345678');
  });
  it('CSV preserves Bengali with BOM', () => {
    const csv = toCsv(['নাম', 'দাম'], [['মিনিকেট চাল', '৬৫']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('মিনিকেট চাল');
  });
});
