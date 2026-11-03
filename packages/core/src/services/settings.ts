/** Business profile + application settings + first-run setup wizard. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO } from '../util/dates.js';
import { normalizeName, requireText, optionalText } from '../util/text.js';
import { parseMoney } from '../util/money.js';
import type { AuditService, Actor } from './audit.js';
import type { LedgerService } from './ledger.js';

export class SettingsService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  profile() {
    return this.db.get<any>('SELECT * FROM business_profile WHERE id=1');
  }

  updateProfile(actor: Actor, patch: Record<string, unknown>): void {
    const allowed = ['name','logo_path','address','mobile','email','currency','date_format','number_format','digit_style','invoice_prefix','invoice_start','return_prefix','purchase_prefix','timezone','low_stock_default_milli','expiry_alert_days','allow_negative_stock','allow_expired_sale'];
    const before = this.profile();
    const sets: string[] = [];
    const args: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k}=?`);
      args.push(k === 'name' ? requireText(v, 'ব্যবসার নাম', 200) : v);
    }
    if (!sets.length) return;
    if (patch.name !== undefined) { sets.push('name_norm=?'); args.push(normalizeName(String(patch.name))); }
    sets.push('updated_at=?'); args.push(nowISO());
    this.db.run(`UPDATE business_profile SET ${sets.join(',')} WHERE id=1`, ...args);
    this.audit.log(actor, 'settings.profile_update', 'business_profile', 1, { before, after: this.profile() });
  }

  getSetting<T = unknown>(key: string, fallback: T): T {
    const r = this.db.get<{ value: string }>('SELECT value FROM application_settings WHERE key=?', key);
    if (!r) return fallback;
    try { return JSON.parse(r.value) as T; } catch { return fallback; }
  }

  setSetting(actor: Actor | null, key: string, value: unknown): void {
    this.db.run('INSERT INTO application_settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(value), nowISO());
    if (actor) this.audit.log(actor, 'settings.update', 'application_settings', key, { after: { key } });
  }

  allSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.all<{ key: string; value: string }>('SELECT key,value FROM application_settings')) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return out;
  }

  /** First-run setup: business info + opening cash + initial admin. Atomic. */
  completeSetup(actor: Actor | null, params: {
    businessName: string; address?: string; mobile?: string; email?: string; logoPath?: string;
    currency?: string; invoicePrefix?: string; invoiceStart?: number; digitStyle?: 'bn' | 'en';
    openingCash?: string | number; adminUsername: string; adminDisplayName: string; adminPassword: string;
    createAdmin: (p: { username: string; displayName: string; password: string; roleId: number }) => number;
  }): void {
    const profile = this.profile();
    if (profile.setup_completed) throw Errors.conflict('সেটআপ আগেই সম্পন্ন হয়েছে');
    const name = requireText(params.businessName, 'ব্যবসার নাম', 200);
    // If licensed, business name must match the license binding.
    const lic = this.db.get<{ business_name: string }>('SELECT business_name FROM license_activations ORDER BY id DESC LIMIT 1');
    if (lic && normalizeName(lic.business_name) !== normalizeName(name)) {
      throw Errors.validation('লাইসেন্সে যে প্রতিষ্ঠানের নাম আছে, সেটাই ব্যবসার নাম হতে হবে');
    }
    this.db.transaction(() => {
      const now = nowISO();
      this.db.run(`UPDATE business_profile SET name=?, name_norm=?, address=?, mobile=?, email=?, logo_path=?, currency=?, invoice_prefix=?, invoice_start=?, digit_style=?, setup_completed=1, updated_at=? WHERE id=1`,
        name, normalizeName(name), optionalText(params.address), optionalText(params.mobile), optionalText(params.email), params.logoPath ?? null,
        params.currency ?? 'BDT', params.invoicePrefix ?? 'INV-', params.invoiceStart ?? 1, params.digitStyle ?? 'bn', now);
      const openingCash = params.openingCash !== undefined ? parseMoney(params.openingCash) : 0;
      if (openingCash > 0) {
        this.ledger.post(actor, { date: now.slice(0, 10), description: 'ওপেনিং ক্যাশ ব্যালেন্স', sourceType: 'opening_cash', lines: [
          { accountCode: '1000', debit: openingCash }, { accountCode: '3000', credit: openingCash },
        ]});
        this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,user_id,created_at) VALUES (?,?,?,?,?,?,?)',
          this.ledger.accountId('1000'), 'in', openingCash, 'ওপেনিং ক্যাশ', 'opening', actor?.userId ?? null, now);
      }
      const ownerRole = this.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Owner')!;
      params.createAdmin({ username: params.adminUsername, displayName: params.adminDisplayName, password: params.adminPassword, roleId: ownerRole.id });
      this.audit.log(actor, 'setup.complete', 'business_profile', 1, { after: { businessName: name } });
    });
  }

  nextInvoiceNo(kind: 'sale' | 'sale_return' | 'purchase' | 'purchase_return'): string {
    const profile = this.profile();
    const counterName = kind;
    const row = this.db.get<{ value: number }>('SELECT value FROM counters WHERE name=?', counterName)!;
    let start = profile.invoice_start ?? 1;
    const next = Math.max(row.value + 1, kind === 'sale' ? start : 1);
    this.db.run('UPDATE counters SET value=? WHERE name=?', next, counterName);
    const year = new Date().getFullYear();
    const prefix = kind === 'sale' ? profile.invoice_prefix : kind === 'sale_return' ? profile.return_prefix : kind === 'purchase' ? profile.purchase_prefix : 'PR-';
    return `${prefix}${year}-${String(next).padStart(5, '0')}`;
  }
}
