/** Double-entry ledger: the single posting authority. Every entry must balance. */
import type { Db } from '../db/database.js';
import { AppError } from '../errors.js';
import { nowISO } from '../util/dates.js';
import type { Actor } from './audit.js';

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  partyId?: number | null;
  memo?: string;
}

export class LedgerService {
  constructor(private db: Db) {}

  accountId(code: string): number {
    const a = this.db.get<{ id: number }>('SELECT id FROM accounts WHERE code=?', code);
    if (!a) throw new AppError('ACCOUNT_MISSING', `অ্যাকাউন্ট কোড পাওয়া যায়নি: ${code}`, `Unknown account ${code}`);
    return a.id;
  }

  accountByCode(code: string) {
    return this.db.get('SELECT * FROM accounts WHERE code=?', code);
  }

  /** Post a balanced journal entry. Returns entry id. Throws if unbalanced. */
  post(actor: Actor | null, params: { date: string; description: string; sourceType: string; sourceId?: number | null; lines: JournalLineInput[]; reversalOf?: number | null }): number {
    const lines = params.lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    if (lines.length < 2) throw new AppError('JOURNAL_INVALID', 'জার্নালে কমপক্ষে দুটি লাইন থাকতে হবে', 'Journal needs >= 2 lines');
    let debit = 0, credit = 0;
    for (const l of lines) {
      const d = l.debit ?? 0, c = l.credit ?? 0;
      if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) throw new AppError('JOURNAL_INVALID', 'জার্নাল লাইনের অঙ্ক সঠিক নয়', 'Invalid journal amount');
      if (d > 0 && c > 0) throw new AppError('JOURNAL_INVALID', 'একই লাইনে ডেবিট ও ক্রেডিট হতে পারে না', 'Line cannot have both debit and credit');
      debit += d; credit += c;
    }
    if (debit !== credit) throw new AppError('JOURNAL_UNBALANCED', `জার্নাল ব্যালেন্স হয়নি (ডেবিট ${debit}, ক্রেডিট ${credit})`, `Unbalanced journal ${debit}/${credit}`);
    if (debit === 0) throw new AppError('JOURNAL_INVALID', 'শূন্য জার্নাল পোস্ট করা যাবে না', 'Zero journal');

    const entryNo = this.nextEntryNo();
    const r = this.db.run(
      'INSERT INTO journal_entries(entry_no,entry_date,description,source_type,source_id,reversal_of,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
      entryNo, params.date, params.description, params.sourceType, params.sourceId ?? null, params.reversalOf ?? null, actor?.userId ?? null, nowISO(),
    );
    const entryId = r.lastInsertRowid;
    for (const l of lines) {
      this.db.run(
        'INSERT INTO journal_lines(entry_id,account_id,party_id,debit,credit,line_memo) VALUES (?,?,?,?,?,?)',
        entryId, this.accountId(l.accountCode), l.partyId ?? null, l.debit ?? 0, l.credit ?? 0, l.memo ?? null,
      );
    }
    return entryId;
  }

  private nextEntryNo(): string {
    const r = this.db.get<{ m: number | null }>('SELECT MAX(id) m FROM journal_entries');
    return `JE-${String((r?.m ?? 0) + 1).padStart(6, '0')}`;
  }

  /** Reverse a posted entry with an inverted entry. Original is never modified. */
  reverse(actor: Actor | null, entryId: number, date: string, reason: string): number {
    const entry = this.db.get<any>('SELECT * FROM journal_entries WHERE id=?', entryId);
    if (!entry) throw new AppError('NOT_FOUND', 'জার্নাল এন্ট্রি পাওয়া যায়নি', 'Entry not found');
    if (entry.reversal_of) throw new AppError('JOURNAL_INVALID', 'রিভার্সাল এন্ট্রি আবার রিভার্স করা যায় না', 'Cannot reverse a reversal');
    const existing = this.db.get('SELECT id FROM journal_entries WHERE reversal_of=?', entryId);
    if (existing) throw new AppError('DUPLICATE', 'এই এন্ট্রি আগেই রিভার্স করা হয়েছে', 'Already reversed');
    const lines = this.db.all<any>('SELECT jl.*, a.code FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.entry_id=?', entryId);
    return this.post(actor, {
      date,
      description: `রিভার্সাল: ${entry.description} (${reason})`,
      sourceType: 'reversal',
      sourceId: entryId,
      reversalOf: entryId,
      lines: lines.map((l) => ({ accountCode: l.code, debit: l.credit, credit: l.debit, partyId: l.party_id, memo: l.line_memo })),
    });
  }

  /** Balance of an account (debit-positive for asset/expense; credit-positive for liability/equity/income). */
  balance(accountCode: string, asOf?: string): number {
    const acc = this.accountByCode(accountCode) as any;
    if (!acc) return 0;
    const args: any[] = [acc.id];
    let dateFilter = '';
    if (asOf) { dateFilter = 'AND je.entry_date <= ?'; args.push(asOf); }
    const r = this.db.get<{ d: number; c: number }>(
      `SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=? ${dateFilter}`, ...args)!;
    const net = r.d - r.c;
    return (acc.type === 'asset' || acc.type === 'expense') ? net : -net;
  }

  /** Party subledger balance: receivable (asset 1100) debit-positive; payable (2000) credit-positive. */
  partyBalance(partyId: number, kind: 'customer' | 'supplier', asOf?: string): number {
    const code = kind === 'customer' ? '1100' : '2000';
    const acc = this.accountByCode(code) as any;
    const args: any[] = [acc.id, partyId];
    let dateFilter = '';
    if (asOf) { dateFilter = 'AND je.entry_date <= ?'; args.push(asOf); }
    const r = this.db.get<{ d: number; c: number }>(
      `SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=? AND jl.party_id=? ${dateFilter}`, ...args)!;
    return kind === 'customer' ? r.d - r.c : r.c - r.d;
  }

  /** Statement rows for a party with running balance. */
  partyStatement(partyId: number, kind: 'customer' | 'supplier', from?: string, to?: string) {
    const code = kind === 'customer' ? '1100' : '2000';
    const acc = this.accountByCode(code) as any;
    const where: string[] = ['jl.account_id=?', 'jl.party_id=?'];
    const args: any[] = [acc.id, partyId];
    if (from) { where.push('je.entry_date >= ?'); args.push(from); }
    if (to) { where.push('je.entry_date <= ?'); args.push(to); }
    const rows = this.db.all<any>(
      `SELECT je.id entry_id, je.entry_no, je.entry_date, je.description, je.source_type, je.source_id, jl.debit, jl.credit, jl.line_memo
       FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE ${where.join(' AND ')} ORDER BY je.entry_date, je.id`, ...args);
    let bal = 0;
    // opening balance before 'from'
    if (from) {
      const pre = this.db.get<{ d: number; c: number }>(
        `SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=? AND jl.party_id=? AND je.entry_date < ?`, acc.id, partyId, from)!;
      bal = kind === 'customer' ? pre.d - pre.c : pre.c - pre.d;
    }
    const opening = bal;
    const out = rows.map((r) => {
      bal += kind === 'customer' ? r.debit - r.credit : r.credit - r.debit;
      return { ...r, balance: bal };
    });
    return { opening, rows: out, closing: bal };
  }

  /** Sum of journal activity on an account within a date range (debit/credit totals). */
  activity(accountCode: string, from: string, to: string): { debit: number; credit: number } {
    const acc = this.accountByCode(accountCode) as any;
    if (!acc) return { debit: 0, credit: 0 };
    const r = this.db.get<{ d: number; c: number }>(
      `SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE jl.account_id=? AND je.entry_date BETWEEN ? AND ?`, acc.id, from, to)!;
    return { debit: r.d, credit: r.c };
  }

  /** Assert every journal entry balances (used by tests/invariants). */
  assertAllBalanced(): void {
    const bad = this.db.all<any>(
      `SELECT je.id, SUM(jl.debit) d, SUM(jl.credit) c FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id GROUP BY je.id HAVING d != c`);
    if (bad.length) throw new AppError('JOURNAL_UNBALANCED', `${bad.length}টি জার্নাল আনব্যালান্সড`, `${bad.length} unbalanced entries`, { ids: bad.map((b) => b.id) });
  }
}
