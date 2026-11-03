/** Purchases: atomic entry (stock + supplier payable + payments), purchase returns. */
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

export interface PurchaseItemInput {
  productId: number; qty: string | number; unitId?: number; unitCost: string | number;
  discountType?: 'none' | 'percent' | 'fixed'; discountValue?: number;
  batchNo?: string; mfgDate?: string | null; expiryDate?: string | null;
}
export interface PaymentSplit { method: 'cash' | 'bank' | 'mobile'; amount: string | number; }

const METHOD_ACCOUNT: Record<string, string> = { cash: '1000', bank: '1010', mobile: '1020' };

export class PurchaseService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService, private inventory: InventoryService, private settings: SettingsService, private catalog: CatalogService) {}

  createPurchase(actor: Actor, input: { supplierId: number; date?: string; items: PurchaseItemInput[]; payments?: PaymentSplit[]; discount?: string | number; notes?: string }): { id: number; invoiceNo: string; total: number; paid: number; due: number } {
    const supplier = this.db.get<any>('SELECT * FROM suppliers WHERE id=? AND archived=0', input.supplierId);
    if (!supplier) throw Errors.notFound('সাপ্লায়ার');
    if (!input.items?.length) throw Errors.validation('কমপক্ষে একটি প্রোডাক্ট যোগ করুন');
    const date = input.date ?? todayISO();
    const invoiceDiscount = parseMoney(input.discount ?? 0);
    if (invoiceDiscount < 0) throw Errors.validation('ডিসকাউন্ট ঋণাত্মক হতে পারে না');

    // Compute lines
    const lines = input.items.map((it) => {
      const p = this.db.get<any>('SELECT * FROM products WHERE id=? AND archived=0', it.productId);
      if (!p) throw Errors.notFound('প্রোডাক্ট');
      const unitId = it.unitId ?? p.base_unit_id;
      const unit = this.db.get<any>('SELECT * FROM units WHERE id=?', unitId);
      if (!unit) throw Errors.validation('সঠিক ইউনিট নির্বাচন করুন');
      const factor = this.catalog.conversionFactor(p.id, unitId);
      const qtyMilli = toBaseQty(parseQty(it.qty), factor);
      if (qtyMilli <= 0) throw Errors.validation('পরিমাণ ধনাত্মক হতে হবে');
      const unitCost = parseMoney(it.unitCost); // per selling unit
      if (unitCost < 0) throw Errors.validation('ক্রয়মূল্য ঋণাত্মক হতে পারে না');
      // gross in poisha for the line (qty in selling units × unitCost). qty_selling = qtyMilli/factor
      const gross = roundHalfUp(qtyMilli * unitCost, factor);
      let discount = 0;
      const dt = it.discountType ?? 'none';
      const dv = Number(it.discountValue ?? 0);
      if (dt === 'percent') discount = percentDiscount(gross, dv);
      else if (dt === 'fixed') discount = Math.min(parseMoney(dv), gross);
      const net = gross - discount;
      return { p, unit, unitId, qtyMilli, unitCost, gross, discount, net, batchNo: it.batchNo, mfgDate: it.mfgDate, expiryDate: it.expiryDate };
    });

    const subtotal = lines.reduce((a, l) => a + l.gross, 0);
    const lineDiscount = lines.reduce((a, l) => a + l.discount, 0);
    if (invoiceDiscount > subtotal - lineDiscount) throw Errors.validation('ইনভয়েস ডিসকাউন্ট মোটের বেশি হতে পারে না');
    // allocate invoice discount pro-rata to line nets
    const alloc = allocateProRata(invoiceDiscount, lines.map((l) => l.net));
    lines.forEach((l, i) => { l.discount += alloc[i]!; l.net -= alloc[i]!; });
    const total = lines.reduce((a, l) => a + l.net, 0);
    const totalDiscount = lineDiscount + invoiceDiscount;

    const payments = (input.payments ?? []).map((pm) => ({ method: pm.method, amount: parseMoney(pm.amount) }));
    for (const pm of payments) { if (!METHOD_ACCOUNT[pm.method]) throw Errors.validation('পেমেন্ট মাধ্যম সঠিক নয়'); if (pm.amount <= 0) throw Errors.validation('পেমেন্ট পরিমাণ ধনাত্মক হতে হবে'); }
    const paid = payments.reduce((a, pm) => a + pm.amount, 0);
    if (paid > total) throw Errors.validation('পেমেন্ট মোটের বেশি হতে পারে না');
    const due = total - paid;

    return this.db.transaction(() => {
      const invoiceNo = this.settings.nextInvoiceNo('purchase');
      const now = nowISO();
      const r = this.db.run('INSERT INTO purchases(invoice_no,supplier_id,purchase_date,subtotal,discount,total,paid,due,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        invoiceNo, supplier.id, date, subtotal, totalDiscount, total, paid, due, input.notes ?? null, actor.userId, now);
      const purchaseId = r.lastInsertRowid;
      for (const l of lines) {
        const effCost = l.qtyMilli > 0 ? roundHalfUp(l.net * 1000, l.qtyMilli) : 0;
        const rec = this.inventory.receive(actor, { productId: l.p.id, qtyMilli: l.qtyMilli, unitCostPoisha: effCost, valueOverride: l.net, batchNo: l.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate, sourceType: 'purchase', sourceId: purchaseId, referenceNo: invoiceNo, date });
        this.db.run('INSERT INTO purchase_items(purchase_id,product_id,product_name,unit_id,unit_name,qty_milli,unit_cost,discount,gross,net,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          purchaseId, l.p.id, l.p.name, l.unitId, l.unit.name, l.qtyMilli, l.unitCost, l.discount, l.gross, l.net, rec.batchId);
      }
      for (const pm of payments) {
        this.db.run('INSERT INTO purchase_payments(purchase_id,account_id,method,amount,paid_at) VALUES (?,?,?,?,?)', purchaseId, this.ledger.accountId(METHOD_ACCOUNT[pm.method]!), pm.method, pm.amount, now);
      }
      // Journal: Dr Inventory (net cost) · Cr payment accounts + Cr A/P (due)
      const jlines: JournalLineInput[] = [{ accountCode: '1200', debit: total, memo: `পারচেজ ${invoiceNo}` }];
      for (const pm of payments) jlines.push({ accountCode: METHOD_ACCOUNT[pm.method]!, credit: pm.amount });
      if (due > 0) jlines.push({ accountCode: '2000', credit: due, partyId: supplier.id, memo: `বাকি ${invoiceNo}` });
      this.ledger.post(actor, { date, description: `পারচেজ ${invoiceNo} — ${supplier.name}`, sourceType: 'purchase', sourceId: purchaseId, lines: jlines });
      this.audit.log(actor, 'purchase.create', 'purchases', purchaseId, { after: { invoiceNo, total, paid, due }, sourceType: 'purchase', sourceId: purchaseId });
      return { id: purchaseId, invoiceNo, total, paid, due };
    });
  }

  getPurchase(id: number) {
    const p = this.db.get<any>('SELECT pu.*, s.name supplier_name FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id WHERE pu.id=?', id);
    if (!p) throw Errors.notFound('পারচেজ');
    p.items = this.db.all('SELECT * FROM purchase_items WHERE purchase_id=?', id);
    p.payments = this.db.all('SELECT * FROM purchase_payments WHERE purchase_id=?', id);
    return p;
  }

  listPurchases(params: { from?: string; to?: string; supplierId?: string | number; search?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('pu.purchase_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('pu.purchase_date <= ?'); args.push(params.to); }
    if (params.supplierId) { where.push('pu.supplier_id=?'); args.push(Number(params.supplierId)); }
    if (params.search) { where.push('(pu.invoice_no LIKE ? OR s.name_norm LIKE ?)'); args.push(`%${params.search}%`, `%${params.search.toLowerCase()}%`); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT pu.*, s.name supplier_name FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id ${w} ORDER BY pu.id DESC LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM purchases pu JOIN suppliers s ON s.id=pu.supplier_id ${w}`, ...args)!.c;
    return { rows, total };
  }

  /** Eligible (not-yet-returned) qty per purchase item. */
  private eligibleQty(purchaseItemId: number): number {
    const item = this.db.get<any>('SELECT * FROM purchase_items WHERE id=?', purchaseItemId);
    if (!item) throw Errors.notFound('পারচেজ আইটেম');
    const returned = this.db.get<{ q: number }>('SELECT COALESCE(SUM(ri.qty_milli),0) q FROM purchase_return_items ri JOIN purchase_returns r ON r.id=ri.return_id WHERE ri.purchase_item_id=? AND r.status=\'completed\'', purchaseItemId)?.q ?? 0;
    return item.qty_milli - returned;
  }

  createPurchaseReturn(actor: Actor, input: { purchaseId: number; date?: string; items: Array<{ purchaseItemId: number; qty: string | number }>; reason?: string; refund?: string | number; credit?: string | number }): { id: number; returnNo: string } {
    const purchase = this.db.get<any>('SELECT * FROM purchases WHERE id=?', input.purchaseId);
    if (!purchase) throw Errors.notFound('পারচেজ');
    if (!input.items?.length) throw Errors.validation('কমপক্ষে একটি আইটেম রিটার্ন করুন');
    const date = input.date ?? todayISO();

    const lines = input.items.map((it) => {
      const item = this.db.get<any>('SELECT * FROM purchase_items WHERE id=? AND purchase_id=?', it.purchaseItemId, purchase.id);
      if (!item) throw Errors.notFound('পারচেজ আইটেম');
      const qtyMilli = parseQty(it.qty);
      if (qtyMilli <= 0) throw Errors.validation('রিটার্ন পরিমাণ ধনাত্মক হতে হবে');
      const eligible = this.eligibleQty(item.id);
      if (qtyMilli > eligible) throw Errors.validation(`রিটার্ন পরিমাণ ক্রয়কৃত পরিমাণের বেশি হতে পারে না (${item.product_name})`);
      const amount = roundHalfUp(item.net * qtyMilli, item.qty_milli);
      return { item, qtyMilli, amount };
    });
    const totalAmount = lines.reduce((a, l) => a + l.amount, 0);
    let refund = input.refund !== undefined ? parseMoney(input.refund) : 0;
    let credit = input.credit !== undefined ? parseMoney(input.credit) : 0;
    if (input.refund === undefined && input.credit === undefined) {
      // default: reduce payable first, remainder refund
      const payable = this.ledger.partyBalance(purchase.supplier_id, 'supplier');
      credit = Math.min(totalAmount, Math.max(0, payable));
      refund = totalAmount - credit;
    }
    if (refund < 0 || credit < 0 || refund + credit !== totalAmount) throw Errors.validation('রিফান্ড + ক্রেডিট মোট রিটার্ন মূল্যের সমান হতে হবে');

    return this.db.transaction(() => {
      const returnNo = this.settings.nextInvoiceNo('purchase_return');
      const now = nowISO();
      const r = this.db.run('INSERT INTO purchase_returns(return_no,purchase_id,supplier_id,return_date,reason,refund_amount,credit_amount,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        returnNo, purchase.id, purchase.supplier_id, date, input.reason ?? null, refund, credit, actor.userId, now);
      const returnId = r.lastInsertRowid;
      let cogsTotal = 0;
      for (const l of lines) {
        const res = this.inventory.consume(actor, { productId: l.item.product_id, qtyMilli: l.qtyMilli, batchId: l.item.batch_id, sourceType: 'purchase_return', sourceId: returnId, referenceNo: returnNo, reason: input.reason, date });
        cogsTotal += res.cogs;
        this.db.run('INSERT INTO purchase_return_items(return_id,purchase_item_id,product_id,qty_milli,amount,batch_id) VALUES (?,?,?,?,?,?)',
          returnId, l.item.id, l.item.product_id, l.qtyMilli, l.amount, l.item.batch_id);
      }
      // Journal: Dr Cash (refund) + Dr A/P (credit) ± variance · Cr Inventory (cogs removed)
      const jlines: JournalLineInput[] = [];
      if (refund > 0) jlines.push({ accountCode: '1000', debit: refund });
      if (credit > 0) jlines.push({ accountCode: '2000', debit: credit, partyId: purchase.supplier_id });
      const variance = cogsTotal - totalAmount;
      if (variance > 0) jlines.push({ accountCode: '5200', debit: variance, memo: 'পারচেজ রিটার্ন ভ্যারিয়েন্স' });
      else if (variance < 0) jlines.push({ accountCode: '5200', credit: -variance, memo: 'পারচেজ রিটার্ন ভ্যারিয়েন্স' });
      jlines.push({ accountCode: '1200', credit: cogsTotal });
      if (cogsTotal > 0 || totalAmount > 0) this.ledger.post(actor, { date, description: `পারচেজ রিটার্ন ${returnNo}`, sourceType: 'purchase_return', sourceId: returnId, lines: jlines });
      this.audit.log(actor, 'purchase.return', 'purchase_returns', returnId, { after: { returnNo, totalAmount, refund, credit }, sourceType: 'purchase_return', sourceId: returnId });
      return { id: returnId, returnNo };
    });
  }

  listPurchaseReturns(params: { from?: string; to?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('r.return_date >= ?'); args.push(params.from); }
    if (params.to) { where.push('r.return_date <= ?'); args.push(params.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.all<any>(`SELECT r.*, p.invoice_no, s.name supplier_name FROM purchase_returns r JOIN purchases p ON p.id=r.purchase_id JOIN suppliers s ON s.id=r.supplier_id ${w} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...args, Math.min(params.limit ?? 50, 500), params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM purchase_returns r ${w}`, ...args)!.c;
    return { rows, total };
  }
}
