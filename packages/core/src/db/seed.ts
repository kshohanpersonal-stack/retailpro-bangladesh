/** Idempotent seed: chart of accounts, roles, permissions, units, profile, counters. */
import type { Db } from './database.js';
import { nowISO } from '../util/dates.js';

export const PERMISSIONS: Array<[string, string]> = [
  ['dashboard.view', 'ড্যাশবোর্ড দেখা'],
  ['pos.sell', 'পিওএসে বিক্রি'],
  ['sales.view', 'সেলস দেখা'],
  ['sales.return', 'সেলস রিটার্ন'],
  ['sales.price_edit', 'বিক্রয়মূল্য পরিবর্তন'],
  ['sales.discount_edit', 'ডিসকাউন্ট পরিবর্তন'],
  ['products.view', 'প্রোডাক্ট দেখা'],
  ['products.manage', 'প্রোডাক্ট ম্যানেজ'],
  ['products.import', 'প্রোডাক্ট ইমপোর্ট'],
  ['inventory.view', 'স্টক দেখা'],
  ['inventory.adjust', 'স্টক অ্যাডজাস্ট'],
  ['purchase.view', 'পারচেজ দেখা'],
  ['purchase.manage', 'পারচেজ এন্ট্রি'],
  ['purchase.return', 'পারচেজ রিটার্ন'],
  ['customers.view', 'কাস্টমার দেখা'],
  ['customers.manage', 'কাস্টমার ম্যানেজ'],
  ['due.collect', 'বাকি আদায়'],
  ['suppliers.view', 'সাপ্লায়ার দেখা'],
  ['suppliers.manage', 'সাপ্লায়ার ম্যানেজ'],
  ['supplier.pay', 'সাপ্লায়ার পেমেন্ট'],
  ['expenses.view', 'খরচ দেখা'],
  ['expenses.manage', 'খরচ এন্ট্রি'],
  ['cash.view', 'ক্যাশ দেখা'],
  ['cash.manage', 'ক্যাশ ম্যানেজ'],
  ['reports.view', 'রিপোর্ট দেখা'],
  ['reports.financial', 'আর্থিক রিপোর্ট'],
  ['reports.profit', 'লাভ-ক্ষতি রিপোর্ট'],
  ['users.manage', 'ইউজার ম্যানেজ'],
  ['settings.manage', 'সেটিংস ম্যানেজ'],
  ['backup.create', 'ব্যাকআপ তৈরি'],
  ['backup.restore', 'ব্যাকআপ রিস্টোর'],
  ['audit.view', 'অডিট ট্রেইল দেখা'],
  ['license.view', 'লাইসেন্স তথ্য দেখা'],
  ['financial.correct', 'আর্থিক সংশোধন/রিভার্সাল'],
];

export const SYSTEM_ACCOUNTS: Array<[string, string, string]> = [
  ['1000', 'ক্যাশ', 'asset'],
  ['1010', 'ব্যাংক', 'asset'],
  ['1020', 'মোবাইল ব্যাংকিং', 'asset'],
  ['1100', 'কাস্টমার বাকি (Receivable)', 'asset'],
  ['1200', 'ইনভেন্টরি', 'asset'],
  ['2000', 'সাপ্লায়ার পাওনা (Payable)', 'liability'],
  ['3000', 'মালিকানা / ওপেনিং ব্যালেন্স', 'equity'],
  ['4000', 'সেলস রেভিনিউ', 'income'],
  ['4100', 'সেলস ডিসকাউন্ট', 'income'],
  ['4200', 'সেলস রিটার্ন', 'income'],
  ['5000', 'বিক্রীত পণ্যের খরচ (COGS)', 'expense'],
  ['5200', 'ইনভেন্টরি অ্যাডজাস্টমেন্ট', 'expense'],
];

export const EXPENSE_ACCOUNT_BASE = 6000;

export const DEFAULT_UNITS: Array<[string, string, string]> = [
  ['পিস', 'pcs', 'count'],
  ['কেজি', 'kg', 'weight'],
  ['গ্রাম', 'g', 'weight'],
  ['লিটার', 'L', 'volume'],
  ['মিলিলিটার', 'mL', 'volume'],
  ['প্যাকেট', 'pkt', 'count'],
  ['কার্টন', 'ctn', 'count'],
  ['ডজন', 'dz', 'count'],
  ['বোতল', 'btl', 'count'],
  ['বক্স', 'box', 'count'],
];

export const DEFAULT_EXPENSE_CATEGORIES = ['দোকান ভাড়া', 'বিদ্যুৎ বিল', 'কর্মচারী বেতন', 'যাতায়াত', 'প্যাকেজিং', 'রক্ষণাবেক্ষণ', 'ইউটিলিটি বিল', 'অন্যান্য খরচ'];

const ROLE_DEFS: Record<string, { desc: string; perms: string[] | '*' }> = {
  Owner: { desc: 'সম্পূর্ণ নিয়ন্ত্রণ', perms: '*' },
  Admin: { desc: 'প্রশাসনিক নিয়ন্ত্রণ', perms: PERMISSIONS.map((p) => p[0]).filter((k) => k !== 'financial.correct') },
  Manager: { desc: 'দৈনন্দিন অপারেশন ও রিপোর্ট', perms: ['dashboard.view','pos.sell','sales.view','sales.return','sales.price_edit','sales.discount_edit','products.view','products.manage','products.import','inventory.view','inventory.adjust','purchase.view','purchase.manage','purchase.return','customers.view','customers.manage','due.collect','suppliers.view','suppliers.manage','supplier.pay','expenses.view','expenses.manage','cash.view','reports.view','reports.financial','reports.profit','backup.create','audit.view'] },
  Cashier: { desc: 'শুধু বিক্রি ও আদায়', perms: ['dashboard.view','pos.sell','sales.view','products.view','customers.view','due.collect'] },
};

export function seed(db: Db): void {
  const now = nowISO();
  db.transaction(() => {
    for (const [key, desc] of PERMISSIONS) {
      db.run('INSERT OR IGNORE INTO permissions(key,description) VALUES (?,?)', key, desc);
    }
    for (const [code, name, type] of SYSTEM_ACCOUNTS) {
      db.run('INSERT OR IGNORE INTO accounts(code,name,type,is_system) VALUES (?,?,?,1)', code, name, type);
    }
    for (const [name, desc, def] of Object.entries(ROLE_DEFS).map(([n, d]) => [n, d.desc, d] as const)) {
      db.run('INSERT OR IGNORE INTO roles(name,description,is_system) VALUES (?,?,1)', name, desc);
      const role = db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', name)!;
      const perms = def.perms === '*' ? PERMISSIONS.map((p) => p[0]) : def.perms;
      for (const p of perms) db.run('INSERT OR IGNORE INTO role_permissions(role_id,permission_key) VALUES (?,?)', role.id, p);
    }
    for (const [name, symbol, kind] of DEFAULT_UNITS) {
      db.run('INSERT OR IGNORE INTO units(name,symbol,kind,created_at) VALUES (?,?,?,?)', name, symbol, kind, now);
    }
    db.run('INSERT OR IGNORE INTO business_profile(id,created_at,updated_at) VALUES (1,?,?)', now, now);
    // Expense categories + accounts
    for (let i = 0; i < DEFAULT_EXPENSE_CATEGORIES.length; i++) {
      const name = DEFAULT_EXPENSE_CATEGORIES[i]!;
      const code = String(EXPENSE_ACCOUNT_BASE + i * 10);
      db.run('INSERT OR IGNORE INTO accounts(code,name,type,is_system) VALUES (?,?,?,1)', code, name, 'expense');
      const acc = db.get<{ id: number }>('SELECT id FROM accounts WHERE code=?', code)!;
      db.run('INSERT OR IGNORE INTO expense_categories(name,account_id,created_at) VALUES (?,?,?)', name, acc.id, now);
    }
    for (const c of ['sale', 'sale_return', 'purchase', 'purchase_return', 'payment']) {
      db.run('INSERT OR IGNORE INTO counters(name,value) VALUES (?,0)', c);
    }
  });
}
