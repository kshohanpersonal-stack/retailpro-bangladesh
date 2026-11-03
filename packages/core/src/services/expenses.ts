/** Expenses: categories + expense entries integrated with ledger and net profit. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { parseMoney } from '../util/money.js';
import { requireText, optionalText } from '../util/text.js';
import type { Actor, AuditService } from './audit.js';
import type { LedgerService } from './ledger.js';
import { EXPENSE_ACCOUNT_BASE } from '../db/seed.js';

const METHOD_ACCOUNT: Record<string, string> = { cash: '1000', bank: '1010', mobile: '1020' };

export class ExpenseService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  listCategories(includeArchived = false) {
    return this.db.all(`SELECT ec.*, a.code account_code FROM expense_categories ec LEFT JOIN accounts a ON a.id=ec.account_id ${includeArchived ? '' : 'WHERE ec.archived=0'} ORDER BY ec.name`);
  }

  createCategory(actor: Actor, name: string): number {
    const n = requireText(name, 'খরচের ক্যাটাগরি', 120);
    if (this.db.get('SELECT id FROM expense_categories WHERE name=?', n)) throw Errors.duplicate('এই খরচ ক্যাটাগরি');
    const now = nowISO();
    const maxCode = this.db.get<{ m: number | null }>("SELECT MAX(CAST(code AS INTEGER)) m FROM accounts WHERE CAST(code AS INTEGER) >= ?", EXPENSE_ACCOUNT_BASE)?.m ?? EXPENSE_ACCOUNT_BASE;
    const code = String(maxCode + 10);
    const accR = this.db.run('INSERT INTO accounts(code,name,type,is_system) VALUES (?,?,?,1)', code, n, 'expense');
    const r = this.db.run('INSERT INTO expense_categories(name,account_id,created_at) VALUES (?,?,?)', n, accR.lastInsertRowid, now);
    this.audit.log(actor, 'expense_category.create', 'expense_categories', r.lastInsertRowid, { after: { name: n } });
    return r.lastInsertRowid;
  }

  archiveCategory(actor: Actor, id: number, archived: boolean): void {
    this.db.run('UPDATE expense_categories SET archived=? WHERE id=?', archived ? 1 : 0, id);
    this.audit.log(actor, 'expense_category.archive', 'expense_categories', id, { after: { archived } });
  }

  createExpense(actor: Actor, input: { categoryId: number; amount: string | number; date?: string; method: 'cash' | 'bank' | 'mobile' | 'due'; description?: string; reference?: string; attachmentPath?: string }): { id: number } {
    const cat = this.db.get<any>('SELECT ec.*, a.code account_code FROM expense_categories ec JOIN accounts a ON a.id=ec.account_id WHERE ec.id=? AND ec.archived=0', input.categoryId);
    if (!cat) throw Errors.notFound('খরচ ক্যাটাগরি');
    const amount = parseMoney(input.amount);
    if (amount <= 0) throw Errors.validation('খরচের পরিমাণ ধনাত্মক হতে হবে');
    const date = input.date ?? todayISO();
    const method = input.method;
    if (!['cash', 'bank', 'mobile', 'due'].includes(method)) throw Errors.validation('পেমেন্ট মাধ্যম সঠিক নয়');
    return this.db.transaction(() => {
      const now = nowISO();
      const accountId = method === 'due' ? null : this.ledger.accountId(METHOD_ACCOUNT[method]!);
      const r = this.db.run('INSERT INTO expenses(category_id,amount,expense_date,account_id,method,description,reference,attachment_path,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        cat.id, amount, date, accountId, method, optionalText(input.description), optionalText(input.reference), input.attachmentPath ?? null, actor.userId, now);
      const lines = [{ accountCode: cat.account_code, debit: amount, memo: optionalText(input.description) ?? cat.name }];
      if (method === 'due') lines.push({ accountCode: '2000', credit: amount, memo: 'বাকি খরচ' } as any);
      else lines.push({ accountCode: METHOD_ACCOUNT[method]!, credit: amount } as any);
      this.ledger.post(actor, { date, description: `খরচ: ${cat.name}`, sourceType: 'expense', sourceId: r.lastInsertRowid, lines });
      if (method !== 'due') {
        this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,source_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
          accountId!, 'out', amount, `খরচ: ${cat.name}`, 'expense', r.lastInsertRowid, actor.userId, now);
      }
      this.audit.log(actor, 'expense.create', 'expenses', r.lastInsertRowid, { after: { category: cat.name, amount, method }, sourceType: 'expense', sourceId: r.lastInsertRowid });
      return { id: r.lastInsertRowid };
    });
  }

  list(params: { from?: string; to?: string; categoryId?: number; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('e.expense_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('e.expense_date <= ?'); args.push(params.to); }
    if (params.categoryId) { where.push('e.category_id=?'); args.push(params.categoryId); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.all<any>(`SELECT e.*, ec.name category_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id ${w} ORDER BY e.id DESC LIMIT ? OFFSET ?`, ...args, Math.min(params.limit ?? 50, 500), params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM expenses e ${w}`, ...args)!.c;
    const sum = this.db.get<{ s: number }>(`SELECT COALESCE(SUM(e.amount),0) s FROM expenses e ${w}`, ...args)!.s;
    return { rows, total, sum };
  }
}
