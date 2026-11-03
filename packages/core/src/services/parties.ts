/** Customers & suppliers: CRUD, search, archive, opening balances, ledgers/statements via subledger. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { normalizeName, normalizeMobile, requireText, optionalText, toCsv } from '../util/text.js';
import { parseMoney } from '../util/money.js';
import type { Actor, AuditService } from './audit.js';
import type { LedgerService } from './ledger.js';

export class PartyService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  // ---- Customers ----
  createCustomer(actor: Actor, input: Record<string, any>): number {
    const name = requireText(input.name, 'কাস্টমারের নাম', 200);
    const opening = parseMoney(input.openingBalance ?? input.opening_balance ?? 0);
    const now = nowISO();
    const r = this.db.run('INSERT INTO customers(name,name_norm,mobile,mobile_norm,address,type,opening_balance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      name, normalizeName(name), optionalText(input.mobile, 30), normalizeMobile(input.mobile ?? ''), optionalText(input.address), input.type === 'wholesale' ? 'wholesale' : 'regular', opening, now, now);
    const id = r.lastInsertRowid;
    if (opening !== 0) {
      this.ledger.post(actor, { date: todayISO(), description: `ওপেনিং বাকি: ${name}`, sourceType: 'opening_customer', sourceId: id, lines: opening > 0
        ? [{ accountCode: '1100', debit: opening, partyId: id }, { accountCode: '3000', credit: opening }]
        : [{ accountCode: '3000', debit: -opening }, { accountCode: '1100', credit: -opening, partyId: id }] });
    }
    this.audit.log(actor, 'customer.create', 'customers', id, { after: { name, opening } });
    return id;
  }

  updateCustomer(actor: Actor, id: number, patch: Record<string, any>): void {
    const c = this.db.get<any>('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw Errors.notFound('কাস্টমার');
    const name = patch.name !== undefined ? requireText(patch.name, 'কাস্টমারের নাম', 200) : c.name;
    const mobile = patch.mobile !== undefined ? optionalText(patch.mobile, 30) : c.mobile;
    this.db.run('UPDATE customers SET name=?, name_norm=?, mobile=?, mobile_norm=?, address=?, type=?, archived=?, updated_at=? WHERE id=?',
      name, normalizeName(name), mobile, normalizeMobile(mobile ?? ''), patch.address !== undefined ? optionalText(patch.address) : c.address,
      patch.type !== undefined ? (patch.type === 'wholesale' ? 'wholesale' : 'regular') : c.type,
      patch.archived !== undefined ? (patch.archived ? 1 : 0) : c.archived, nowISO(), id);
    this.audit.log(actor, 'customer.update', 'customers', id, { before: c, after: patch });
  }

  deleteCustomer(actor: Actor, id: number): void {
    const refs = this.db.get<{ c: number }>('SELECT (SELECT COUNT(*) FROM sales WHERE customer_id=?)+(SELECT COUNT(*) FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.party_id=? AND a.code=\'1100\') c', id, id)!.c;
    if (refs > 0) throw Errors.conflict('এই কাস্টমারের লেনদেন আছে; আর্কাইভ করুন');
    this.db.run('DELETE FROM customers WHERE id=?', id);
    this.audit.log(actor, 'customer.delete', 'customers', id);
  }

  getCustomer(id: number) {
    const c = this.db.get<any>('SELECT * FROM customers WHERE id=?', id);
    if (!c) throw Errors.notFound('কাস্টমার');
    c.current_due = this.ledger.partyBalance(id, 'customer');
    return c;
  }

  listCustomers(params: { search?: string; includeArchived?: boolean; dueOnly?: boolean; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (!params.includeArchived) where.push('c.archived=0');
    if (params.search) { const q = normalizeName(params.search); where.push('(c.name_norm LIKE ? OR c.mobile_norm LIKE ?)'); args.push(`%${q}%`, `%${normalizeMobile(params.search)}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT c.* FROM customers c ${w} ORDER BY c.name LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    for (const r of rows) r.current_due = this.ledger.partyBalance(r.id, 'customer');
    const filtered = params.dueOnly ? rows.filter((r) => r.current_due > 0) : rows;
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM customers c ${w}`, ...args)!.c;
    return { rows: filtered, total };
  }

  customerStatement(id: number, from?: string, to?: string) {
    const c = this.getCustomer(id);
    const st = this.ledger.partyStatement(id, 'customer', from, to);
    return { customer: c, ...st };
  }

  customerPurchaseHistory(id: number, limit = 50) {
    return this.db.all('SELECT id, invoice_no, sale_date, total, paid, due, status FROM sales WHERE customer_id=? ORDER BY id DESC LIMIT ?', id, limit);
  }

  // ---- Suppliers ----
  createSupplier(actor: Actor, input: Record<string, any>): number {
    const name = requireText(input.name, 'সাপ্লায়ারের নাম', 200);
    const opening = parseMoney(input.openingBalance ?? input.opening_balance ?? 0);
    const now = nowISO();
    const r = this.db.run('INSERT INTO suppliers(name,name_norm,business_name,contact_person,mobile,mobile_norm,address,opening_balance,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, normalizeName(name), optionalText(input.businessName ?? input.business_name), optionalText(input.contactPerson ?? input.contact_person),
      optionalText(input.mobile, 30), normalizeMobile(input.mobile ?? ''), optionalText(input.address), opening, now, now);
    const id = r.lastInsertRowid;
    if (opening !== 0) {
      this.ledger.post(actor, { date: todayISO(), description: `ওপেনিং পাওনা: ${name}`, sourceType: 'opening_supplier', sourceId: id, lines: opening > 0
        ? [{ accountCode: '3000', debit: opening }, { accountCode: '2000', credit: opening, partyId: id }]
        : [{ accountCode: '2000', debit: -opening, partyId: id }, { accountCode: '3000', credit: -opening }] });
    }
    this.audit.log(actor, 'supplier.create', 'suppliers', id, { after: { name, opening } });
    return id;
  }

  updateSupplier(actor: Actor, id: number, patch: Record<string, any>): void {
    const s = this.db.get<any>('SELECT * FROM suppliers WHERE id=?', id);
    if (!s) throw Errors.notFound('সাপ্লায়ার');
    const name = patch.name !== undefined ? requireText(patch.name, 'সাপ্লায়ারের নাম', 200) : s.name;
    const mobile = patch.mobile !== undefined ? optionalText(patch.mobile, 30) : s.mobile;
    this.db.run('UPDATE suppliers SET name=?, name_norm=?, business_name=?, contact_person=?, mobile=?, mobile_norm=?, address=?, archived=?, updated_at=? WHERE id=?',
      name, normalizeName(name), patch.businessName !== undefined ? optionalText(patch.businessName) : s.business_name,
      patch.contactPerson !== undefined ? optionalText(patch.contactPerson) : s.contact_person,
      mobile, normalizeMobile(mobile ?? ''), patch.address !== undefined ? optionalText(patch.address) : s.address,
      patch.archived !== undefined ? (patch.archived ? 1 : 0) : s.archived, nowISO(), id);
    this.audit.log(actor, 'supplier.update', 'suppliers', id, { before: s, after: patch });
  }

  deleteSupplier(actor: Actor, id: number): void {
    const refs = this.db.get<{ c: number }>('SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id=?)+(SELECT COUNT(*) FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.party_id=? AND a.code=\'2000\') c', id, id)!.c;
    if (refs > 0) throw Errors.conflict('এই সাপ্লায়ারের লেনদেন আছে; আর্কাইভ করুন');
    this.db.run('DELETE FROM suppliers WHERE id=?', id);
    this.audit.log(actor, 'supplier.delete', 'suppliers', id);
  }

  getSupplier(id: number) {
    const s = this.db.get<any>('SELECT * FROM suppliers WHERE id=?', id);
    if (!s) throw Errors.notFound('সাপ্লায়ার');
    s.current_payable = this.ledger.partyBalance(id, 'supplier');
    return s;
  }

  listSuppliers(params: { search?: string; includeArchived?: boolean; dueOnly?: boolean; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (!params.includeArchived) where.push('s.archived=0');
    if (params.search) { const q = normalizeName(params.search); where.push('(s.name_norm LIKE ? OR s.mobile_norm LIKE ? OR s.business_name LIKE ?)'); args.push(`%${q}%`, `%${normalizeMobile(params.search)}%`, `%${params.search}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT s.* FROM suppliers s ${w} ORDER BY s.name LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    for (const r of rows) r.current_payable = this.ledger.partyBalance(r.id, 'supplier');
    const filtered = params.dueOnly ? rows.filter((r) => r.current_payable > 0) : rows;
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM suppliers s ${w}`, ...args)!.c;
    return { rows: filtered, total };
  }

  supplierStatement(id: number, from?: string, to?: string) {
    const s = this.getSupplier(id);
    const st = this.ledger.partyStatement(id, 'supplier', from, to);
    return { supplier: s, ...st };
  }

  supplierPurchaseHistory(id: number, limit = 50) {
    return this.db.all('SELECT id, invoice_no, purchase_date, total, paid, due, status FROM purchases WHERE supplier_id=? ORDER BY id DESC LIMIT ?', id, limit);
  }

  exportCustomersCsv(): string {
    const rows = this.db.all<any>('SELECT * FROM customers WHERE archived=0 ORDER BY name');
    return toCsv(['name', 'mobile', 'address', 'type', 'current_due'], rows.map((r) => [r.name, r.mobile, r.address, r.type, (this.ledger.partyBalance(r.id, 'customer') / 100).toFixed(2)]));
  }
  exportSuppliersCsv(): string {
    const rows = this.db.all<any>('SELECT * FROM suppliers WHERE archived=0 ORDER BY name');
    return toCsv(['name', 'business_name', 'contact_person', 'mobile', 'address', 'current_payable'], rows.map((r) => [r.name, r.business_name, r.contact_person, r.mobile, r.address, (this.ledger.partyBalance(r.id, 'supplier') / 100).toFixed(2)]));
  }
}
