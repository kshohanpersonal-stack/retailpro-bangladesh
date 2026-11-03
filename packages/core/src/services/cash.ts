/** Cash & payment accounts: manual in/out/adjustment, balances, cash flow. Every movement traceable. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { parseMoney } from '../util/money.js';
import { requireText } from '../util/text.js';
import type { Actor, AuditService } from './audit.js';
import type { LedgerService } from './ledger.js';

const CASH_CODES = ['1000', '1010', '1020'];

export class CashService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  accounts() {
    return this.db.all<any>("SELECT * FROM accounts WHERE code IN ('1000','1010','1020') AND archived=0 ORDER BY code").map((a) => ({ ...a, balance: this.ledger.balance(a.code) }));
  }

  balance(code = '1000'): number { return this.ledger.balance(code); }

  totalCash(): number { return CASH_CODES.reduce((s, c) => s + this.ledger.balance(c), 0); }

  /** Manual cash in (owner contribution / other). Dr Cash · Cr Equity. */
  cashIn(actor: Actor, input: { amount: string | number; reason: string; accountCode?: string; date?: string }): { id: number } {
    return this.movement(actor, 'in', input);
  }
  /** Manual cash out (owner drawing / other). Dr Equity · Cr Cash. */
  cashOut(actor: Actor, input: { amount: string | number; reason: string; accountCode?: string; date?: string }): { id: number } {
    return this.movement(actor, 'out', input);
  }
  /** Cash adjustment (over/short). Posts to inventory/cash adjustment account 5200. */
  adjust(actor: Actor, input: { delta: string | number; reason: string; accountCode?: string; date?: string }): { id: number } {
    const delta = parseMoney(input.delta);
    if (delta === 0) throw Errors.validation('অ্যাডজাস্টমেন্ট শূন্য হতে পারে না');
    const reason = requireText(input.reason, 'কারণ', 300);
    const code = input.accountCode ?? '1000';
    if (!CASH_CODES.includes(code)) throw Errors.validation('সঠিক ক্যাশ অ্যাকাউন্ট নির্বাচন করুন');
    const date = input.date ?? todayISO();
    return this.db.transaction(() => {
      const now = nowISO();
      const lines = delta > 0
        ? [{ accountCode: code, debit: delta }, { accountCode: '5200', credit: delta }]
        : [{ accountCode: '5200', debit: -delta }, { accountCode: code, credit: -delta }];
      this.ledger.post(actor, { date, description: `ক্যাশ অ্যাডজাস্টমেন্ট: ${reason}`, sourceType: 'cash_adjustment', lines });
      const r = this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,user_id,created_at) VALUES (?,?,?,?,?,?,?)',
        this.ledger.accountId(code), 'adjustment', delta, reason, 'manual', actor.userId, now);
      this.audit.log(actor, 'cash.adjust', 'cash', r.lastInsertRowid, { after: { delta, reason } });
      return { id: r.lastInsertRowid };
    });
  }

  private movement(actor: Actor, dir: 'in' | 'out', input: { amount: string | number; reason: string; accountCode?: string; date?: string }): { id: number } {
    const amount = parseMoney(input.amount);
    if (amount <= 0) throw Errors.validation('পরিমাণ ধনাত্মক হতে হবে');
    const reason = requireText(input.reason, 'কারণ', 300);
    const code = input.accountCode ?? '1000';
    if (!CASH_CODES.includes(code)) throw Errors.validation('সঠিক ক্যাশ অ্যাকাউন্ট নির্বাচন করুন');
    const date = input.date ?? todayISO();
    if (dir === 'out' && this.ledger.balance(code) < amount) throw Errors.validation('পর্যাপ্ত ক্যাশ ব্যালেন্স নেই');
    return this.db.transaction(() => {
      const now = nowISO();
      const lines = dir === 'in'
        ? [{ accountCode: code, debit: amount }, { accountCode: '3000', credit: amount }]
        : [{ accountCode: '3000', debit: amount }, { accountCode: code, credit: amount }];
      this.ledger.post(actor, { date, description: `${dir === 'in' ? 'ক্যাশ ইন' : 'ক্যাশ আউট'}: ${reason}`, sourceType: dir === 'in' ? 'cash_in' : 'cash_out', lines });
      const r = this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,user_id,created_at) VALUES (?,?,?,?,?,?,?)',
        this.ledger.accountId(code), dir, amount, reason, 'manual', actor.userId, now);
      this.audit.log(actor, dir === 'in' ? 'cash.in' : 'cash.out', 'cash', r.lastInsertRowid, { after: { amount, reason } });
      return { id: r.lastInsertRowid };
    });
  }

  transactions(params: { accountCode?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.accountCode) { where.push('a.code=?'); args.push(params.accountCode); }
    if (params.from) { where.push('ct.created_at >= ?'); args.push(params.from + 'T00:00:00.000Z'); }
    if (params.to) { where.push('ct.created_at <= ?'); args.push(params.to + 'T23:59:59.999Z'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.all<any>(`SELECT ct.*, a.name account_name, a.code account_code FROM cash_transactions ct JOIN accounts a ON a.id=ct.account_id ${w} ORDER BY ct.id DESC LIMIT ? OFFSET ?`, ...args, Math.min(params.limit ?? 50, 500), params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM cash_transactions ct JOIN accounts a ON a.id=ct.account_id ${w}`, ...args)!.c;
    return { rows, total };
  }

  /** Daily cash position: opening + in − out per day. */
  cashFlow(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT je.entry_date date, a.code, a.name,
      SUM(jl.debit) debit, SUM(jl.credit) credit
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE a.code IN ('1000','1010','1020') AND je.entry_date BETWEEN ? AND ?
      GROUP BY je.entry_date, a.code ORDER BY je.entry_date`, from, to);
    return rows;
  }
}
