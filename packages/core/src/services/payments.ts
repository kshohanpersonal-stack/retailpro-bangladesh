/** Standalone due collections (customers) and supplier payments. Atomic ledger + subledger. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { parseMoney } from '../util/money.js';
import type { Actor, AuditService } from './audit.js';
import type { LedgerService } from './ledger.js';

const METHOD_ACCOUNT: Record<string, string> = { cash: '1000', bank: '1010', mobile: '1020' };

export class PaymentService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  /** Collect customer due. Dr Cash/Bank/Mobile · Cr A/R. */
  collect(actor: Actor, input: { customerId: number; amount: string | number; method: 'cash' | 'bank' | 'mobile'; date?: string; reference?: string; notes?: string }): { id: number } {
    const customer = this.db.get<any>('SELECT * FROM customers WHERE id=? AND archived=0', input.customerId);
    if (!customer) throw Errors.notFound('কাস্টমার');
    const amount = parseMoney(input.amount);
    if (amount <= 0) throw Errors.validation('আদায়ের পরিমাণ ধনাত্মক হতে হবে');
    if (!METHOD_ACCOUNT[input.method]) throw Errors.validation('পেমেন্ট মাধ্যম সঠিক নয়');
    const due = this.ledger.partyBalance(customer.id, 'customer');
    if (amount > due) throw Errors.validation(`আদায় বাকির বেশি হতে পারে না (বাকি ৳${(due / 100).toFixed(2)})`);
    const date = input.date ?? todayISO();
    return this.db.transaction(() => {
      const now = nowISO();
      const r = this.db.run('INSERT INTO payments(kind,party_id,account_id,method,amount,payment_date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        'collection', customer.id, this.ledger.accountId(METHOD_ACCOUNT[input.method]!), input.method, amount, date, input.reference ?? null, input.notes ?? null, actor.userId, now);
      this.ledger.post(actor, { date, description: `বাকি আদায়: ${customer.name}`, sourceType: 'collection', sourceId: r.lastInsertRowid, lines: [
        { accountCode: METHOD_ACCOUNT[input.method]!, debit: amount },
        { accountCode: '1100', credit: amount, partyId: customer.id },
      ]});
      this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,source_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        this.ledger.accountId(METHOD_ACCOUNT[input.method]!), 'in', amount, `বাকি আদায়: ${customer.name}`, 'collection', r.lastInsertRowid, actor.userId, now);
      this.audit.log(actor, 'payment.collection', 'payments', r.lastInsertRowid, { after: { customerId: customer.id, amount, method: input.method }, sourceType: 'collection', sourceId: r.lastInsertRowid });
      return { id: r.lastInsertRowid };
    });
  }

  /** Pay supplier. Dr A/P · Cr Cash/Bank/Mobile. */
  paySupplier(actor: Actor, input: { supplierId: number; amount: string | number; method: 'cash' | 'bank' | 'mobile'; date?: string; reference?: string; notes?: string }): { id: number } {
    const supplier = this.db.get<any>('SELECT * FROM suppliers WHERE id=? AND archived=0', input.supplierId);
    if (!supplier) throw Errors.notFound('সাপ্লায়ার');
    const amount = parseMoney(input.amount);
    if (amount <= 0) throw Errors.validation('পেমেন্ট পরিমাণ ধনাত্মক হতে হবে');
    if (!METHOD_ACCOUNT[input.method]) throw Errors.validation('পেমেন্ট মাধ্যম সঠিক নয়');
    const payable = this.ledger.partyBalance(supplier.id, 'supplier');
    if (amount > payable) throw Errors.validation(`পেমেন্ট পাওনার বেশি হতে পারে না (পাওনা ৳${(payable / 100).toFixed(2)})`);
    const date = input.date ?? todayISO();
    return this.db.transaction(() => {
      const now = nowISO();
      const r = this.db.run('INSERT INTO payments(kind,party_id,account_id,method,amount,payment_date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        'supplier_payment', supplier.id, this.ledger.accountId(METHOD_ACCOUNT[input.method]!), input.method, amount, date, input.reference ?? null, input.notes ?? null, actor.userId, now);
      this.ledger.post(actor, { date, description: `সাপ্লায়ার পেমেন্ট: ${supplier.name}`, sourceType: 'supplier_payment', sourceId: r.lastInsertRowid, lines: [
        { accountCode: '2000', debit: amount, partyId: supplier.id },
        { accountCode: METHOD_ACCOUNT[input.method]!, credit: amount },
      ]});
      this.db.run('INSERT INTO cash_transactions(account_id,direction,amount,reason,source_type,source_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        this.ledger.accountId(METHOD_ACCOUNT[input.method]!), 'out', amount, `সাপ্লায়ার পেমেন্ট: ${supplier.name}`, 'supplier_payment', r.lastInsertRowid, actor.userId, now);
      this.audit.log(actor, 'payment.supplier', 'payments', r.lastInsertRowid, { after: { supplierId: supplier.id, amount, method: input.method }, sourceType: 'supplier_payment', sourceId: r.lastInsertRowid });
      return { id: r.lastInsertRowid };
    });
  }

  list(params: { kind?: 'collection' | 'supplier_payment'; partyId?: number; from?: string; to?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.kind) { where.push('p.kind=?'); args.push(params.kind); }
    if (params.partyId) { where.push('p.party_id=?'); args.push(params.partyId); }
    if (params.from) { where.push('p.payment_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('p.payment_date <= ?'); args.push(params.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.all<any>(`SELECT p.*, a.name account_name FROM payments p JOIN accounts a ON a.id=p.account_id ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...args, Math.min(params.limit ?? 50, 500), params.offset ?? 0);
    // attach party names
    for (const r of rows) {
      r.party_name = r.kind === 'collection'
        ? this.db.get<any>('SELECT name FROM customers WHERE id=?', r.party_id)?.name
        : this.db.get<any>('SELECT name FROM suppliers WHERE id=?', r.party_id)?.name;
    }
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM payments p ${w}`, ...args)!.c;
    return { rows, total };
  }
}
