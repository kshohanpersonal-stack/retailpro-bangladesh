/** Date helpers. Storage: ISO date (YYYY-MM-DD) and UTC ISO timestamps. Display: configurable. */

export function todayISO(tz = 'Asia/Dhaka'): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function requireDate(v: unknown, label = 'তারিখ'): string {
  const s = String(v ?? '').trim();
  if (!isValidDate(s)) throw new Error(`${label} সঠিক নয় (YYYY-MM-DD)`);
  return s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun
  const diff = (dow + 1) % 7; // week starts Saturday (BD)
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function startOfYear(iso: string): string {
  return iso.slice(0, 5) + '01-01';
}

export function formatDate(iso: string, format = 'DD/MM/YYYY', digits: 'bn' | 'en' = 'bn'): string {
  const [y, m, d] = iso.split('-');
  let out = format.replace('YYYY', y!).replace('MM', m!).replace('DD', d!);
  if (digits === 'bn') {
    const map = '০১২৩৪৫৬৭৮৯';
    out = out.replace(/\d/g, (x) => map[Number(x)]!);
  }
  return out;
}

export function formatTime(isoTimestamp: string, tz = 'Asia/Dhaka', digits: 'bn' | 'en' = 'bn'): string {
  let out = new Date(isoTimestamp).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
  if (digits === 'bn') {
    const map = '০১২৩৪৫৬৭৮৯';
    out = out.replace(/\d/g, (x) => map[Number(x)]!);
  }
  return out;
}
