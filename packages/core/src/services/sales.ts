/** Sales/POS: atomic idempotent sale (stock + revenue + COGS + payments + due), sales returns. */
import type { Db } from '../db/database.js';
import { AppError, Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { roundHalfUp, allocateProRata, parseMoney, percentDiscount } from '../util/money.js';
import { parseQty, toBaseQty } from '../util/quantity.js';
import type { Actor, AuditService } from './audit.js';
import type { LedgerService, JournalLineInput } from './ledger.js';
import type { InventoryService } from './inventory.js';
import type { SettingsService } from './settings.js';
import type { CatalogService } from './catalog.js';

export interface SaleItemInput {
  productId: number; qty: string | number; unitId?: number; unitPrice?: string | number;
  discountType?: 'none' | 'percent' | 'fixed'; discountValue?: number; batchId?: number | null;
}
export interface PaymentSplit { method: 'cash' | 'bank' | 'mobile'; amount: string | number; }
const METHOD_ACCOUNT: Record<string, string> = { cash: '1000', bank: '1010', mobile: '1020' };

export class SalesService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService, private inventory: InventoryService, private settings: SettingsService, private catalog: CatalogService) {}

  createSale(actor: Actor, input: { customerId?: number | null; date?: string; items: SaleItemInput[]; payments?: PaymentSplit[]; discount?: string | number; notes?: string; idempotencyKey?: string; allowExpired?: boolean; priceEdited?: boolean }): { id: number; invoiceNo: string; total: number; paid: number; due: number; costIncomplete: boolean } {
    // Idempotency: return existing sale for the same key.
    if (input.idempotencyKey) {
      const existing = this.db.get<any>('SELECT * FROM sales WHERE idempotency_key=?', input.idempotencyKey);
      if (existing) return { id: existing.id, invoiceNo: existing.invoice_no, total: existing.total, paid: existing.paid, due: existing.due, costIncomplete: !!existing.cost_incomplete };
    }
    if (!input.items?.length) throw Errors.validation('কার্টে কমপক্ষে একটি প্রোডাক্ট যোগ করুন');
    const date = input.date ?? todayISO();
    const profile = this.settings.profile();
    const customerId = input.customerId ?? null;
    if (customerId) {
      const c = this.db.get('SELECT id FROM customers WHERE id=? AND archived=0', customerId);
      if (!c) throw Errors.notFound('কাস্টমার');
    }
    const allowExpired = !!input.allowExpired && (profile.allow_expired_sale === 1);
    const invoiceDiscount = parseMoney(input.discount ?? 0);
    if (invoiceDiscount < 0) throw Errors.validation('ডিসকাউন্ট ঋণাত্মক হতে পারে না');

    const lines = input.items.map((it) => {
      const p = this.db.get<any>('SELECT * FROM products WHERE id=? AND archived=0', it.productId);
      if (!p) throw Errors.notFound('প্রোডাক্ট');
      const unitId = it.unitId ?? p.base_unit_id;
      const unit = this.db.get<any>('SELECT * FROM units WHERE id=?', unitId);
      if (!unit) throw Errors.validation('সঠিক ইউনিট নির্বাচন করুন');
      const factor = this.catalog.conversionFactor(p.id, unitId);
      const qtyMilli = toBaseQty(parseQty(it.qty), factor);
      if (qtyMilli <= 0) throw Errors.validation('পরিমাণ ধনাত্মক হতে হবে');
      // unit price per selling unit; default from product (wholesale for wholesale customers)
      let unitPrice: number;
      if (it.unitPrice !== undefined) unitPrice = parseMoney(it.unitPrice);
      else {
        const cust = customerId ? this.db.get<any>('SELECT type FROM customers WHERE id=?', customerId) : null;
        const basePrice = cust?.type === 'wholesale' && p.wholesale_price > 0 ? p.wholesale_price : p.selling_price;
        unitPrice = roundHalfUp(basePrice * factor, 1000); // price per selling unit
      }
      if (unitPrice < 0) throw Errors.validation('দাম ঋণাত্মক হতে পারে না');
      const gross = roundHalfUp(qtyMilli * unitPrice, factor);
      // line discount: explicit or product default
      let discount = 0;
      let dt = it.discountType;
      let dv = it.discountValue;
      if (dt === undefined) { dt = p.discount_type; dv = p.discount_value; }
      if (dt === 'percent') discount = percentDiscount(gross, Number(dv ?? 0));
      else if (dt === 'fixed') discount = Math.min(parseMoney(dv ?? 0), gross);
      const net = gross - discount;
      this.inventory.assertSellable(p.id, qtyMilli, allowExpired);
      return { p, unit, unitId, factor, qtyMilli, unitPrice, gross, discount, net, batchId: it.batchId ?? null };
    });

    const subtotal = lines.reduce((a, l) => a + l.gross, 0);
    const lineDiscount = lines.reduce((a, l) => a + l.discount, 0);
    if (invoiceDiscount > subtotal - lineDiscount) throw Errors.validation('ইনভয়েস ডিসকাউন্ট মোটের বেশি হতে পারে না');
    const alloc = allocateProRata(invoiceDiscount, lines.map((l) => l.net));
    lines.forEach((l, i) => { l.discount += alloc[i]!; l.net -= alloc[i]!; });
    const total = lines.reduce((a, l) => a + l.net, 0);
    const totalDiscount = lineDiscount + invoiceDiscount;

    const payments = (input.payments ?? []).map((pm) => ({ method: pm.method, amount: parseMoney(pm.amount) }));
    for (const pm of payments) { if (!METHOD_ACCOUNT[pm.method]) throw Errors.validation('পেমেন্ট মাধ্যম সঠিক নয়'); if (pm.amount <= 0) throw Errors.validation('পেমেন্ট পরিমাণ ধনাত্মক হতে হবে'); }
    const paid = payments.reduce((a, pm) => a + pm.amount, 0);
    if (paid > total) throw Errors.validation('পেমেন্ট মোটের বেশি হতে পারে না');
    const due = total - paid;
    if (due > 0 && !customerId) throw Errors.validation('বাকি বিক্রির জন্য কাস্টমার নির্বাচন আবশ্যক');

    return this.db.transaction(() => {
      const invoiceNo = this.settings.nextInvoiceNo('sale');
      const now = nowISO();
      const saleTime = new Date().toLocaleTimeString('en-GB', { timeZone: profile.timezone, hour12: false });
      let costIncomplete = false;
      const r = this.db.run('INSERT INTO sales(invoice_no,customer_id,sale_date,sale_time,subtotal,discount,total,paid,due,payment_summary,cashier_id,notes,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        invoiceNo, customerId, date, saleTime, subtotal, totalDiscount, total, paid, due, payments.map((p) => `${p.method}:${p.amount}`).join('|') || null, actor.userId, input.notes ?? null, input.idempotencyKey ?? null, now);
      const saleId = r.lastInsertRowid;
      let cogsTotal = 0;
      for (const l of lines) {
        const res = this.inventory.consume(actor, { productId: l.p.id, qtyMilli: l.qtyMilli, batchId: l.batchId, sourceType: 'sale', sourceId: saleId, referenceNo: invoiceNo, allowExpired, date });
        cogsTotal += res.cogs;
        if (res.costIncomplete) costIncomplete = true;
        const cogsPerUnitMilli = l.qtyMilli > 0 ? roundHalfUp(res.cogs * 1000, l.qtyMilli) : 0;
        const primaryBatch = res.allocations[0]?.batchId ?? null;
        this.db.run('INSERT INTO sale_items(sale_id,product_id,product_name,unit_id,unit_name,qty_milli,unit_price,discount,gross,net,cogs,cogs_per_unit_milli,cost_incomplete,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          saleId, l.p.id, l.p.name, l.unitId, l.unit.name, l.qtyMilli, l.unitPrice, l.discount, l.gross, l.net, res.cogs, cogsPerUnitMilli, res.costIncomplete ? 1 : 0, primaryBatch);
      }
      if (costIncomplete) this.db.run('UPDATE sales SET cost_incomplete=1 WHERE id=?', saleId);
      for (const pm of payments) {
        this.db.run('INSERT INTO sale_payments(sale_id,account_id,method,amount,paid_at) VALUES (?,?,?,?,?)', saleId, this.ledger.accountId(METHOD_ACCOUNT[pm.method]!), pm.method, pm.amount, now);
      }
      // Journal 1: revenue. Dr Cash/Bank/Mobile (paid) + Dr A/R (due) + Dr Discounts · Cr Revenue (gross)
      const j1: JournalLineInput[] = [];
      for (const pm of payments) j1.push({ accountCode: METHOD_ACCOUNT[pm.method]!, debit: pm.amount });
      if (due > 0) j1.push({ accountCode: '1100', debit: due, partyId: customerId, memo: `বাকি ${invoiceNo}` });
      if (totalDiscount > 0) j1.push({ accountCode: '4100', debit: totalDiscount, memo: 'ডিসকাউন্ট' });
      j1.push({ accountCode: '4000', credit: subtotal, memo: `সেলস ${invoiceNo}` });
      this.ledger.post(actor, { date, description: `সেলস ${invoiceNo}`, sourceType: 'sale', sourceId: saleId, lines: j1 });
      // Journal 2: COGS. Dr COGS · Cr Inventory
      if (cogsTotal > 0) {
        this.ledger.post(actor, { date, description: `COGS ${invoiceNo}`, sourceType: 'sale_cogs', sourceId: saleId, lines: [
          { accountCode: '5000', debit: cogsTotal }, { accountCode: '1200', credit: cogsTotal },
        ]});
      }
      this.audit.log(actor, 'sale.create', 'sales', saleId, { after: { invoiceNo, total, paid, due, costIncomplete }, sourceType: 'sale', sourceId: saleId });
      return { id: saleId, invoiceNo, total, paid, due, costIncomplete };
    });
  }

  getSale(id: number) {
    const s = this.db.get<any>('SELECT s.*, c.name customer_name, c.mobile customer_mobile, u.display_name cashier_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.cashier_id WHERE s.id=?', id);
    if (!s) throw Errors.notFound('সেলস');
    s.items = this.db.all('SELECT * FROM sale_items WHERE sale_id=?', id);
    s.payments = this.db.all('SELECT * FROM sale_payments WHERE sale_id=?', id);
    s.returns = this.db.all('SELECT * FROM sales_returns WHERE sale_id=?', id);
    return s;
  }

  listSales(params: { from?: string; to?: string; customerId?: number; search?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('s.sale_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('s.sale_date <= ?'); args.push(params.to); }
    if (params.customerId) { where.push('s.customer_id=?'); args.push(params.customerId); }
    if (params.search) { where.push('(s.invoice_no LIKE ? OR c.name_norm LIKE ?)'); args.push(`%${params.search}%`, `%${params.search.toLowerCase()}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT s.*, c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ${w}`, ...args)!.c;
    return { rows, total };
  }

  private eligibleReturnQty(saleItemId: number): number {
    const item = this.db.get<any>('SELECT * FROM sale_items WHERE id=?', saleItemId);
    if (!item) throw Errors.notFound('সেলস আইটেম');
    const returned = this.db.get<{ q: number }>('SELECT COALESCE(SUM(ri.qty_milli),0) q FROM sales_return_items ri JOIN sales_returns r ON r.id=ri.return_id WHERE ri.sale_item_id=? AND r.status=\'completed\'', saleItemId)?.q ?? 0;
    return item.qty_milli - returned;
  }

  createSalesReturn(actor: Actor, input: { saleId: number; date?: string; items: Array<{ saleItemId: number; qty: string | number }>; reason?: string; refund?: string | number; dueAdjustment?: string | number }): { id: number; returnNo: string } {
    const sale = this.db.get<any>('SELECT * FROM sales WHERE id=?', input.saleId);
    if (!sale) throw Errors.notFound('সেলস');
    if (!input.items?.length) throw Errors.validation('কমপক্ষে একটি আইটেম রিটার্ন করুন');
    const date = input.date ?? todayISO();

    const lines = input.items.map((it) => {
      const item = this.db.get<any>('SELECT * FROM sale_items WHERE id=? AND sale_id=?', it.saleItemId, sale.id);
      if (!item) throw Errors.notFound('সেলস আইটেম');
      const qtyMilli = parseQty(it.qty);
      if (qtyMilli <= 0) throw Errors.validation('রিটার্ন পরিমাণ ধনাত্মক হতে হবে');
      if (qtyMilli > this.eligibleReturnQty(item.id)) throw Errors.validation(`রিটার্ন পরিমাণ বিক্রীত পরিমাণের বেশি হতে পারে না (${item.product_name})`);
      const amount = roundHalfUp(item.net * qtyMilli, item.qty_milli);
      const cogsRestore = roundHalfUp(item.cogs * qtyMilli, item.qty_milli);
      const unitCost = item.qty_milli > 0 ? roundHalfUp(item.cogs * 1000, item.qty_milli) : 0;
      return { item, qtyMilli, amount, cogsRestore, unitCost };
    });
    const totalAmount = lines.reduce((a, l) => a + l.amount, 0);
    const totalCogs = lines.reduce((a, l) => a + l.cogsRestore, 0);
    let refund = input.refund !== undefined ? parseMoney(input.refund) : 0;
    let dueAdjustment = input.dueAdjustment !== undefined ? parseMoney(input.dueAdjustment) : 0;
    if (input.refund === undefined && input.dueAdjustment === undefined) {
      const due = sale.due; // reduce this sale's due first (approx via customer balance)
      const custDue = sale.customer_id ? this.ledger.partyBalance(sale.customer_id, 'customer') : 0;
      dueAdjustment = Math.min(totalAmount, Math.max(0, custDue));
      refund = totalAmount - dueAdjustment;
    }
    if (refund < 0 || dueAdjustment < 0 || refund + dueAdjustment !== totalAmount) throw Errors.validation('রিফান্ড + বাকি সমন্বয় মোট রিটার্ন মূল্যের সমান হতে হবে');
    if (dueAdjustment > 0 && !sale.customer_id) throw Errors.validation('বাকি সমন্বয়ের জন্য কাস্টমার থাকতে হবে');

    return this.db.transaction(() => {
      const returnNo = this.settings.nextInvoiceNo('sale_return');
      const now = nowISO();
      const r = this.db.run('INSERT INTO sales_returns(return_no,sale_id,customer_id,return_date,reason,refund_amount,due_adjustment,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        returnNo, sale.id, sale.customer_id, date, input.reason ?? null, refund, dueAdjustment, actor.userId, now);
      const returnId = r.lastInsertRowid;
      for (const l of lines) {
        this.inventory.restore(actor, { productId: l.item.product_id, qtyMilli: l.qtyMilli, unitCostPoisha: l.unitCost, batchId: l.item.batch_id, sourceType: 'sale_return', sourceId: returnId, referenceNo: returnNo, reason: input.reason });
        this.db.run('INSERT INTO sales_return_items(return_id,sale_item_id,product_id,qty_milli,amount,cogs_restored,batch_id) VALUES (?,?,?,?,?,?,?)',
          returnId, l.item.id, l.item.product_id, l.qtyMilli, l.amount, l.cogsRestore, l.item.batch_id);
      }
      // Journal: Dr Sales Returns (amount) · Cr Cash (refund) + Cr A/R (due adjustment)
      const j1: JournalLineInput[] = [{ accountCode: '4200', debit: totalAmount, memo: `রিটার্ন ${returnNo}` }];
      if (refund > 0) j1.push({ accountCode: '1000', credit: refund });
      if (dueAdjustment > 0) j1.push({ accountCode: '1100', credit: dueAdjustment, partyId: sale.customer_id });
      this.ledger.post(actor, { date, description: `সেলস রিটার্ন ${returnNo}`, sourceType: 'sale_return', sourceId: returnId, lines: j1 });
      // Restore inventory value: Dr Inventory · Cr COGS
      if (totalCogs > 0) {
        this.ledger.post(actor, { date, description: `রিটার্ন স্টক ${returnNo}`, sourceType: 'sale_return_cogs', sourceId: returnId, lines: [
          { accountCode: '1200', debit: totalCogs }, { accountCode: '5000', credit: totalCogs },
        ]});
      }
      this.audit.log(actor, 'sale.return', 'sales_returns', returnId, { after: { returnNo, totalAmount, refund, dueAdjustment }, sourceType: 'sale_return', sourceId: returnId });
      return { id: returnId, returnNo };
    });
  }

  listSalesReturns(params: { from?: string; to?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('r.return_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('r.return_date <= ?'); args.push(params.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.all<any>(`SELECT r.*, s.invoice_no, c.name customer_name FROM sales_returns r JOIN sales s ON s.id=r.sale_id LEFT JOIN customers c ON c.id=r.customer_id ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...args, Math.min(params.limit ?? 50, 500), params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM sales_returns r ${w}`, ...args)!.c;
    return { rows, total };
  }
}
