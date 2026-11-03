/** Unicode-safe text normalization for search and business-identity binding. */
import { normalizeDigits } from './numbers.js';

/** Normalize a name for search/binding: NFC, collapse whitespace, case-fold Latin, normalize digits. */
export function normalizeName(s: string): string {
  return normalizeDigits(s.normalize('NFC')).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Normalize a mobile number: digits only (Bengali→English), keep leading +. */
export function normalizeMobile(s: string): string {
  const d = normalizeDigits(s).replace(/[^\d+]/g, '');
  return d;
}

export function isBlank(s: unknown): boolean {
  return s === null || s === undefined || String(s).trim() === '';
}

export function requireText(v: unknown, label: string, maxLen = 500): string {
  if (isBlank(v)) throw new Error(`${label} আবশ্যক`);
  const s = String(v).normalize('NFC').trim();
  if (s.length > maxLen) throw new Error(`${label} খুব বড় (সর্বোচ্চ ${maxLen} অক্ষর)`);
  return s;
}

export function optionalText(v: unknown, maxLen = 2000): string | null {
  if (isBlank(v)) return null;
  const s = String(v).normalize('NFC').trim();
  if (s.length > maxLen) throw new Error(`লেখা খুব বড় (সর্বোচ্চ ${maxLen} অক্ষর)`);
  return s;
}

/** Escape a value for CSV (Excel-compatible). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM for Excel Bengali
}
