/** Inventory authority: weighted-average costing, batches (FEFO), expiry control, audited movements. */
import type { Db } from '../db/database.js';
import { AppError, Errors } from '../errors.js';
import { nowISO, todayISO } from '../util/dates.js';
import { roundHalfUp } from '../util/money.js';
import type { Actor } from './audit.js';
import type { AuditService } from './audit.js';
import type { LedgerService } from './ledger.js';

export interface ReceiveInput {
  productId: number; qtyMilli: number; unitCostPoisha: number;
  batchNo?: string; mfgDate?: string | null; expiryDate?: string | null;
  sourceType: string; sourceId?: number | null; referenceNo?: string; reason?: string; date?: string;
}
export interface ConsumeAllocation { batchId: number | null; qtyMilli: number; cogs: number; }
export interface ConsumeResult { cogs: number; costIncomplete: boolean; allocations: ConsumeAllocation[]; }

export class InventoryService {
  constructor(private db: Db, private audit: AuditService, private ledger: LedgerService) {}

  private product(productId: number) {
    const p = this.db.get<any>('SELECT * FROM products WHERE id=?', productId);
    if (!p) throw Errors.notFound('প্রোডাক্ট');
    return p;
  }

  private ensureInventory(productId: number): void {
    this.db.run('INSERT OR IGNORE INTO inventory(product_id,qty_milli,value_poisha,updated_at) VALUES (?,0,0,?)', productId, nowISO());
  }

  private profile() {
    return this.db.get<any>('SELECT * FROM business_profile WHERE id=1');
  }

  /** Add stock (purchase, opening, return-in, adjustment-in). Updates pool + batch + movement. */
  receive(actor: Actor | null, input: ReceiveInput): { batchId: number | null } {
    if (input.qtyMilli <= 0) throw Errors.validation('স্টক ইন পরিমাণ ধনাত্মক হতে হবে');
    if (input.unitCostPoisha < 0) throw Errors.validation('ক্রয়মূল্য ঋণাত্মক হতে পারে না');
    const p = this.product(input.productId);
    this.ensureInventory(p.id);
    // unitCostPoisha is cost per WHOLE base unit; value = qty_milli × cost / 1000.
    const addValue = roundHalfUp(input.qtyMilli * input.unitCostPoisha, 1000);
    let batchId: number | null = null;
    const now = nowISO();
    if (p.track_batches) {
      const batchNo = input.batchNo?.trim() || `B-${Date.now()}`;
      let batch = this.db.get<any>('SELECT * FROM product_batches WHERE product_id=? AND batch_no=?', p.id, batchNo);
      if (!batch) {
        const r = this.db.run('INSERT INTO product_batches(product_id,batch_no,mfg_date,expiry_date,qty_milli,value_poisha,unit_cost_poisha,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?,?)',
          p.id, batchNo, input.mfgDate ?? null, input.expiryDate ?? null, input.unitCostPoisha, now, now);
        batchId = r.lastInsertRowid;
        batch = this.db.get('SELECT * FROM product_batches WHERE id=?', batchId);
      } else {
        batchId = batch.id;
      }
      const newQty = batch.qty_milli + input.qtyMilli;
      const newValue = batch.value_poisha + addValue;
      const newCost = newQty > 0 ? roundHalfUp(newValue * 1000, newQty) : 0;
      this.db.run('UPDATE product_batches SET qty_milli=?, value_poisha=?, unit_cost_poisha=?, mfg_date=COALESCE(?,mfg_date), expiry_date=COALESCE(?,expiry_date), updated_at=? WHERE id=?',
        newQty, newValue, newCost, input.mfgDate ?? null, input.expiryDate ?? null, now, batchId);
    }
    this.db.run('UPDATE inventory SET qty_milli=qty_milli+?, value_poisha=value_poisha+?, updated_at=? WHERE product_id=?', input.qtyMilli, addValue, now, p.id);
    this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,unit_cost_poisha,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      p.id, batchId, 'in', input.qtyMilli, input.unitCostPoisha, addValue, input.sourceType, input.sourceId ?? null, input.referenceNo ?? null, input.reason ?? null, actor?.userId ?? null, now);
    return { batchId };
  }

  /** Remove stock (sale, purchase-return, adjustment-out). WAC consumption; FEFO for batches. */
  consume(actor: Actor | null, input: { productId: number; qtyMilli: number; sourceType: string; sourceId?: number | null; referenceNo?: string; reason?: string; batchId?: number | null; allowExpired?: boolean; date?: string }): ConsumeResult {
    if (input.qtyMilli <= 0) throw Errors.validation('স্টক আউট পরিমাণ ধনাত্মক হতে হবে');
    const p = this.product(input.productId);
    this.ensureInventory(p.id);
    const profile = this.profile();
    const inv = this.db.get<any>('SELECT * FROM inventory WHERE product_id=?', p.id)!;
    if (inv.qty_milli < input.qtyMilli && !profile.allow_negative_stock) {
      throw Errors.insufficientStock(p.name, `${inv.qty_milli / 1000}`);
    }
    const now = nowISO();
    const today = input.date ?? todayISO(profile.timezone);
    let remaining = input.qtyMilli;
    let totalCogs = 0;
    let costIncomplete = false;
    const allocations: ConsumeAllocation[] = [];

    if (p.track_batches) {
      // FEFO: earliest expiry first, then oldest batch. Specific batch if requested.
      const batches = input.batchId
        ? this.db.all<any>('SELECT * FROM product_batches WHERE id=? AND product_id=?', input.batchId, p.id)
        : this.db.all<any>('SELECT * FROM product_batches WHERE product_id=? AND qty_milli>0 ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC', p.id);
      for (const b of batches) {
        if (remaining <= 0) break;
        if (b.expiry_date && b.expiry_date < today && !input.allowExpired && !profile.allow_expired_sale) {
          if (input.batchId) throw Errors.expiredProduct(p.name);
          continue; // skip expired batches in FEFO
        }
        const take = Math.min(remaining, b.qty_milli);
        const cogs = b.qty_milli > 0 ? roundHalfUp(b.value_poisha * take, b.qty_milli) : 0;
        const newQty = b.qty_milli - take;
        const newValue = newQty === 0 ? 0 : b.value_poisha - cogs;
        this.db.run('UPDATE product_batches SET qty_milli=?, value_poisha=?, updated_at=? WHERE id=?', newQty, newValue, now, b.id);
        this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,unit_cost_poisha,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          p.id, b.id, 'out', take, b.unit_cost_poisha, cogs, input.sourceType, input.sourceId ?? null, input.referenceNo ?? null, input.reason ?? null, actor?.userId ?? null, now);
        allocations.push({ batchId: b.id, qtyMilli: take, cogs });
        totalCogs += cogs;
        remaining -= take;
      }
      if (remaining > 0) {
        if (!profile.allow_negative_stock) throw Errors.insufficientStock(p.name);
        // negative-stock allowance: record remainder at zero cost, flagged
        this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,unit_cost_poisha,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          p.id, null, 'out', remaining, 0, 0, input.sourceType, input.sourceId ?? null, input.referenceNo ?? null, 'negative-stock allowance', actor?.userId ?? null, now);
        allocations.push({ batchId: null, qtyMilli: remaining, cogs: 0 });
        costIncomplete = true;
        remaining = 0;
      }
    } else {
      const take = input.qtyMilli;
      const cogs = inv.qty_milli > 0 ? roundHalfUp(inv.value_poisha * take, inv.qty_milli) : 0;
      if (inv.qty_milli <= 0 || inv.value_poisha <= 0) costIncomplete = true;
      this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,unit_cost_poisha,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        p.id, null, 'out', take, inv.qty_milli > 0 ? roundHalfUp(inv.value_poisha * 1000, inv.qty_milli) : 0, cogs, input.sourceType, input.sourceId ?? null, input.referenceNo ?? null, input.reason ?? null, actor?.userId ?? null, now);
      allocations.push({ batchId: null, qtyMilli: take, cogs });
      totalCogs = cogs;
    }

    const newInvQty = inv.qty_milli - input.qtyMilli;
    const newInvValue = newInvQty <= 0 ? 0 : Math.max(0, inv.value_poisha - totalCogs);
    this.db.run('UPDATE inventory SET qty_milli=?, value_poisha=?, updated_at=? WHERE product_id=?', newInvQty, newInvValue, now, p.id);
    return { cogs: totalCogs, costIncomplete, allocations };
  }

  /** Restore stock at a known unit cost (sales return), to the original batch when tracked. Returns value added. */
  restore(actor: Actor | null, input: { productId: number; qtyMilli: number; unitCostPoisha: number; batchId?: number | null; sourceType: string; sourceId?: number | null; referenceNo?: string; reason?: string }): number {
    const p = this.product(input.productId);
    const addValue = roundHalfUp(input.qtyMilli * input.unitCostPoisha, 1000);
    const now = nowISO();
    this.ensureInventory(p.id);
    let batchId: number | null = null;
    if (p.track_batches) {
      let batch = input.batchId ? this.db.get<any>('SELECT * FROM product_batches WHERE id=? AND product_id=?', input.batchId, p.id) : null;
      if (!batch) batch = this.db.get<any>('SELECT * FROM product_batches WHERE product_id=? ORDER BY id DESC LIMIT 1', p.id);
      if (batch) {
        batchId = batch.id;
        const newQty = batch.qty_milli + input.qtyMilli;
        const newValue = batch.value_poisha + addValue;
        this.db.run('UPDATE product_batches SET qty_milli=?, value_poisha=?, unit_cost_poisha=?, updated_at=? WHERE id=?', newQty, newValue, newQty > 0 ? roundHalfUp(newValue * 1000, newQty) : 0, now, batch.id);
      } else {
        const r = this.db.run('INSERT INTO product_batches(product_id,batch_no,qty_milli,value_poisha,unit_cost_poisha,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
          p.id, `RET-${Date.now()}`, input.qtyMilli, addValue, input.unitCostPoisha, now, now);
        batchId = r.lastInsertRowid;
      }
    }
    this.db.run('UPDATE inventory SET qty_milli=qty_milli+?, value_poisha=value_poisha+?, updated_at=? WHERE product_id=?', input.qtyMilli, addValue, now, p.id);
    this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,unit_cost_poisha,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      p.id, batchId, 'in', input.qtyMilli, input.unitCostPoisha, addValue, input.sourceType, input.sourceId ?? null, input.referenceNo ?? null, input.reason ?? null, actor?.userId ?? null, now);
    return addValue;
  }

  /** Stock adjustment (increase/decrease) with reason + journal posting. */
  adjust(actor: Actor, input: { productId: number; qtyDeltaMilli: number; unitCostPoisha?: number; reason: string; batchNo?: string; date?: string }): number {
    if (input.qtyDeltaMilli === 0) throw Errors.validation('অ্যাডজাস্টমেন্ট পরিমাণ শূন্য হতে পারে না');
    if (!input.reason?.trim()) throw Errors.validation('অ্যাডজাস্টমেন্টের কারণ আবশ্যক');
    const p = this.product(input.productId);
    const date = input.date ?? todayISO();
    const now = nowISO();
    let valueDelta = 0;
    if (input.qtyDeltaMilli > 0) {
      const cost = input.unitCostPoisha ?? p.purchase_price;
      this.receive(actor, { productId: p.id, qtyMilli: input.qtyDeltaMilli, unitCostPoisha: cost, batchNo: input.batchNo, sourceType: 'adjustment', referenceNo: 'ADJ', reason: input.reason, date });
      valueDelta = roundHalfUp(input.qtyDeltaMilli * cost, 1000);
      this.ledger.post(actor, { date, description: `স্টক অ্যাডজাস্টমেন্ট (বৃদ্ধি): ${p.name}`, sourceType: 'stock_adjustment', lines: [
        { accountCode: '1200', debit: valueDelta }, { accountCode: '5200', credit: valueDelta },
      ]});
    } else {
      const res = this.consume(actor, { productId: p.id, qtyMilli: -input.qtyDeltaMilli, sourceType: 'adjustment', referenceNo: 'ADJ', reason: input.reason, date });
      valueDelta = -res.cogs;
      this.ledger.post(actor, { date, description: `স্টক অ্যাডজাস্টমেন্ট (হ্রাস): ${p.name}`, sourceType: 'stock_adjustment', lines: [
        { accountCode: '5200', debit: res.cogs }, { accountCode: '1200', credit: res.cogs },
      ]});
    }
    const r = this.db.run('INSERT INTO stock_adjustments(product_id,batch_id,qty_delta_milli,unit_cost_poisha,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)',
      p.id, null, input.qtyDeltaMilli, input.unitCostPoisha ?? 0, input.reason, actor.userId, now);
    this.audit.log(actor, 'inventory.adjust', 'products', p.id, { after: { qtyDeltaMilli: input.qtyDeltaMilli, reason: input.reason } });
    return r.lastInsertRowid;
  }

  /** Transfer qty between batches of the same product (no value change). */
  transfer(actor: Actor, input: { productId: number; fromBatchId: number; toBatchId: number; qtyMilli: number; reason?: string }): number {
    if (input.qtyMilli <= 0) throw Errors.validation('ট্রান্সফার পরিমাণ ধনাত্মক হতে হবে');
    if (input.fromBatchId === input.toBatchId) throw Errors.validation('একই ব্যাচে ট্রান্সফার করা যায় না');
    const from = this.db.get<any>('SELECT * FROM product_batches WHERE id=? AND product_id=?', input.fromBatchId, input.productId);
    const to = this.db.get<any>('SELECT * FROM product_batches WHERE id=? AND product_id=?', input.toBatchId, input.productId);
    if (!from || !to) throw Errors.notFound('ব্যাচ');
    if (from.qty_milli < input.qtyMilli) throw Errors.insufficientStock(from.batch_no);
    const value = from.qty_milli > 0 ? roundHalfUp(from.value_poisha * input.qtyMilli, from.qty_milli) : 0;
    const now = nowISO();
    const fromQty = from.qty_milli - input.qtyMilli;
    this.db.run('UPDATE product_batches SET qty_milli=?, value_poisha=?, updated_at=? WHERE id=?', fromQty, fromQty === 0 ? 0 : from.value_poisha - value, now, from.id);
    const toQty = to.qty_milli + input.qtyMilli;
    const toValue = to.value_poisha + value;
    this.db.run('UPDATE product_batches SET qty_milli=?, value_poisha=?, unit_cost_poisha=?, updated_at=? WHERE id=?', toQty, toValue, toQty > 0 ? roundHalfUp(toValue * 1000, toQty) : 0, now, to.id);
    const r = this.db.run('INSERT INTO stock_transfers(product_id,from_batch_id,to_batch_id,qty_milli,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)',
      input.productId, from.id, to.id, input.qtyMilli, input.reason ?? null, actor.userId, now);
    this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      input.productId, from.id, 'out', input.qtyMilli, value, 'transfer', r.lastInsertRowid, 'TRF', input.reason ?? null, actor.userId, now);
    this.db.run('INSERT INTO stock_movements(product_id,batch_id,direction,qty_milli,value_poisha,source_type,source_id,reference_no,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      input.productId, to.id, 'in', input.qtyMilli, value, 'transfer', r.lastInsertRowid, 'TRF', input.reason ?? null, actor.userId, now);
    this.audit.log(actor, 'inventory.transfer', 'products', input.productId, { after: input });
    return r.lastInsertRowid;
  }

  stock(productId: number) {
    this.ensureInventory(productId);
    return this.db.get<any>('SELECT i.*, p.name, p.min_stock_milli, p.track_batches FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.product_id=?', productId);
  }

  batches(productId: number) {
    return this.db.all<any>('SELECT * FROM product_batches WHERE product_id=? ORDER BY (expiry_date IS NULL), expiry_date, id', productId);
  }

  movements(params: { productId?: number; from?: string; to?: string; sourceType?: string; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.productId) { where.push('m.product_id=?'); args.push(params.productId); }
    if (params.from) { where.push('m.created_at >= ?'); args.push(params.from + 'T00:00:00.000Z'); }
    if (params.to) { where.push('m.created_at <= ?'); args.push(params.to + 'T23:59:59.999Z'); }
    if (params.sourceType) { where.push('m.source_type=?'); args.push(params.sourceType); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT m.*, p.name product_name, b.batch_no FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN product_batches b ON b.id=m.batch_id ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM stock_movements m ${w}`, ...args)!.c;
    return { rows, total };
  }

  valuation() {
    return this.db.all<any>(`SELECT p.id, p.name, p.code, i.qty_milli, i.value_poisha, p.min_stock_milli,
      CASE WHEN i.qty_milli>0 THEN ROUND(i.value_poisha*1000.0/i.qty_milli) ELSE 0 END avg_cost
      FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 ORDER BY p.name`);
  }

  lowStock() {
    return this.db.all<any>(`SELECT p.id, p.name, p.code, i.qty_milli, p.min_stock_milli FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 AND i.qty_milli <= p.min_stock_milli ORDER BY i.qty_milli ASC`);
  }

  outOfStock() {
    return this.db.all<any>(`SELECT p.id, p.name, p.code FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 AND i.qty_milli <= 0 ORDER BY p.name`);
  }

  expiryReport(withinDays?: number) {
    const profile = this.profile();
    const days = withinDays ?? profile.expiry_alert_days;
    const today = todayISO(profile.timezone);
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    return this.db.all<any>(`SELECT b.*, p.name product_name FROM product_batches b JOIN products p ON p.id=b.product_id WHERE b.qty_milli>0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? ORDER BY b.expiry_date`, limit);
  }

  expiredStock() {
    const today = todayISO(this.profile().timezone);
    return this.db.all<any>(`SELECT b.*, p.name product_name FROM product_batches b JOIN products p ON p.id=b.product_id WHERE b.qty_milli>0 AND b.expiry_date < ? ORDER BY b.expiry_date`, today);
  }

  /** Check expiry for a prospective sale (throws unless override permitted). */
  assertSellable(productId: number, qtyMilli: number, allowExpired: boolean): void {
    const p = this.product(productId);
    const profile = this.profile();
    if (!p.track_batches) return;
    const today = todayISO(profile.timezone);
    const available = this.db.get<{ q: number }>('SELECT COALESCE(SUM(qty_milli),0) q FROM product_batches WHERE product_id=? AND qty_milli>0 AND (expiry_date IS NULL OR expiry_date >= ?)', productId, today)?.q ?? 0;
    if (available < qtyMilli && !allowExpired && !profile.allow_expired_sale) {
      const expiredQty = this.db.get<{ q: number }>('SELECT COALESCE(SUM(qty_milli),0) q FROM product_batches WHERE product_id=? AND qty_milli>0 AND expiry_date < ?', productId, today)?.q ?? 0;
      if (expiredQty > 0) throw Errors.expiredProduct(p.name);
    }
  }
}
