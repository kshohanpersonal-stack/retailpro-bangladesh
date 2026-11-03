import { describe, it, expect } from 'vitest';
import { tempCore, ensureOwner, assertInvariants } from '../helpers.js';

/** Independently hand-computed BDT scenarios. All expectations in poisha. */
function setup(core: any) {
  const actor = ensureOwner(core);
  const unit = core.db.get("SELECT id FROM units WHERE name='পিস'").id;
  const pid = core.catalog.createProduct(actor, { name: 'মিনিকেট চাল ৫ কেজি', baseUnitId: unit, purchasePrice: 50, sellingPrice: 65 });
  core.inventory.openingStock(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000 }); // 10 @ ৳50 = ৳500
  const cid = core.parties.createCustomer(actor, { name: 'করিম মিয়া', mobile: '01711111111' });
  const sid = core.parties.createSupplier(actor, { name: 'প্রাণ ফুডস' });
  return { actor, pid, cid, sid, unit };
}

describe('financial correctness — sales', () => {
  it('cash sale: revenue, COGS, cash, inventory, gross profit', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 3 }], payments: [{ method: 'cash', amount: 195 }] });
      expect(sale.total).toBe(19500); // 3 × 65
      expect(sale.paid).toBe(19500);
      expect(sale.due).toBe(0);
      expect(core.ledger.balance('1000')).toBe(19500); // cash
      expect(core.ledger.balance('4000')).toBe(19500); // revenue (gross, no discount)
      expect(core.ledger.balance('5000')).toBe(15000); // COGS 3×50
      expect(core.ledger.balance('1200')).toBe(35000); // inventory 500-150=350
      const inv = core.inventory.stock(pid);
      expect(inv.qty_milli).toBe(7000);
      expect(inv.value_poisha).toBe(35000);
      // gross profit = 19500 - 15000 = 4500
      expect(core.ledger.balance('4000') - core.ledger.balance('5000')).toBe(4500);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('due sale + partial payment creates receivable; collection clears it', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, cid } = setup(core);
      const sale = core.sales.createSale(actor, { customerId: cid, items: [{ productId: pid, qty: 2 }], payments: [{ method: 'cash', amount: 100 }] });
      expect(sale.total).toBe(13000);
      expect(sale.due).toBe(3000);
      expect(core.parties.getCustomer(cid).current_due).toBe(3000);
      expect(core.ledger.balance('1000')).toBe(10000);
      // collection via ledger (PaymentService tested separately) — simulate collection posting
      core.ledger.post(actor, { date: '2026-11-03', description: 'বাকি আদায়', sourceType: 'collection', lines: [
        { accountCode: '1000', debit: 3000 }, { accountCode: '1100', credit: 3000, partyId: cid },
      ]});
      expect(core.parties.getCustomer(cid).current_due).toBe(0);
      expect(core.ledger.balance('1000')).toBe(13000);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('percentage discount: gross, discount contra, net revenue', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 2, discountType: 'percent', discountValue: 1000 }], payments: [{ method: 'cash', amount: 117 }] });
      expect(sale.total).toBe(11700); // 130 - 10%
      expect(core.ledger.balance('4000')).toBe(13000); // gross revenue
      expect(core.ledger.balance('4100')).toBe(-1300); // discount contra (debit balance → negative natural)
      expect(core.ledger.balance('1000')).toBe(11700);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('invoice-level discount allocates exactly across lines', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 1 }, { productId: pid, qty: 2 }], discount: 10, payments: [{ method: 'cash', amount: 185 }] });
      // gross 65+130=195, discount 10 → 185
      expect(sale.total).toBe(18500);
      const items = core.db.all('SELECT net FROM sale_items WHERE sale_id=?', sale.id);
      expect(items.reduce((a: number, r: any) => a + r.net, 0)).toBe(18500);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('idempotency key prevents duplicate sale', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const a = core.sales.createSale(actor, { items: [{ productId: pid, qty: 1 }], payments: [{ method: 'cash', amount: 65 }], idempotencyKey: 'key-1' });
      const b = core.sales.createSale(actor, { items: [{ productId: pid, qty: 1 }], payments: [{ method: 'cash', amount: 65 }], idempotencyKey: 'key-1' });
      expect(a.id).toBe(b.id);
      expect(core.db.get<{ c: number }>('SELECT COUNT(*) c FROM sales')!.c).toBe(1);
      expect(core.inventory.stock(pid).qty_milli).toBe(9000);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('due sale without customer is rejected', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      expect(() => core.sales.createSale(actor, { items: [{ productId: pid, qty: 1 }], payments: [{ method: 'cash', amount: 30 }] })).toThrow();
    } finally { cleanup(); }
  });

  it('failed sale rolls back stock and ledger completely', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const before = core.inventory.stock(pid).qty_milli;
      const journalsBefore = core.db.get<{ c: number }>('SELECT COUNT(*) c FROM journal_entries')!.c;
      // second item does not exist → whole transaction must roll back
      expect(() => core.sales.createSale(actor, { items: [{ productId: pid, qty: 1 }, { productId: 99999, qty: 1 }], payments: [{ method: 'cash', amount: 65 }] })).toThrow();
      expect(core.inventory.stock(pid).qty_milli).toBe(before);
      expect(core.db.get<{ c: number }>('SELECT COUNT(*) c FROM sales')!.c).toBe(0);
      expect(core.db.get<{ c: number }>('SELECT COUNT(*) c FROM journal_entries')!.c).toBe(journalsBefore);
      expect(core.db.get<{ c: number }>("SELECT COUNT(*) c FROM journal_entries WHERE source_type='sale'")!.c).toBe(0);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('financial correctness — sales returns', () => {
  it('partial return restores stock at original cost and refunds', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 3 }], payments: [{ method: 'cash', amount: 195 }] });
      const item = core.db.get<any>('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
      const ret = core.sales.createSalesReturn(actor, { saleId: sale.id, items: [{ saleItemId: item.id, qty: 1 }], reason: 'ভুল পণ্য' });
      expect(ret.returnNo).toBeTruthy();
      // stock 7+1=8, value 350+50=400
      expect(core.inventory.stock(pid).qty_milli).toBe(8000);
      expect(core.inventory.stock(pid).value_poisha).toBe(40000);
      // cash 195-65=130; sales returns contra 65; COGS 150-50=100
      expect(core.ledger.balance('1000')).toBe(13000);
      expect(core.ledger.balance('4200')).toBe(-6500); // returns contra (debit balance)
      expect(core.ledger.balance('5000')).toBe(10000);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('over-return is rejected; duplicate refund impossible', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 2 }], payments: [{ method: 'cash', amount: 130 }] });
      const item = core.db.get<any>('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
      core.sales.createSalesReturn(actor, { saleId: sale.id, items: [{ saleItemId: item.id, qty: 2 }] });
      expect(() => core.sales.createSalesReturn(actor, { saleId: sale.id, items: [{ saleItemId: item.id, qty: 1 }] })).toThrow();
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('return on due sale reduces receivable', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, cid } = setup(core);
      const sale = core.sales.createSale(actor, { customerId: cid, items: [{ productId: pid, qty: 2 }], payments: [{ method: 'cash', amount: 100 }] });
      const item = core.db.get<any>('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
      core.sales.createSalesReturn(actor, { saleId: sale.id, items: [{ saleItemId: item.id, qty: 1 }] });
      // due was 30, return 65 → due adjustment 30, refund 35
      expect(core.parties.getCustomer(cid).current_due).toBe(0);
      expect(core.ledger.balance('1000')).toBe(10000 - 3500);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('financial correctness — purchases', () => {
  it('purchase updates stock, payable, and WAC; subsequent sale uses new average', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, sid } = setup(core);
      // purchase 10 @ 60, due
      const pur = core.purchases.createPurchase(actor, { supplierId: sid, items: [{ productId: pid, qty: 10, unitCost: 60 }] });
      expect(pur.total).toBe(60000);
      expect(pur.due).toBe(60000);
      expect(core.parties.getSupplier(sid).current_payable).toBe(60000);
      // stock 10+10=20, value 500+600=1100 → avg 55/unit
      expect(core.inventory.stock(pid).qty_milli).toBe(20000);
      expect(core.inventory.stock(pid).value_poisha).toBe(110000);
      // sale 5 → COGS roundHalfUp(110000×5000/20000)=27500
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 5 }], payments: [{ method: 'cash', amount: 325 }] });
      const si = core.db.get<any>('SELECT cogs FROM sale_items WHERE sale_id=?', sale.id);
      expect(si.cogs).toBe(27500);
      expect(core.ledger.balance('1200')).toBe(82500); // 1100-275
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('purchase with partial payment splits cash and payable', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, sid } = setup(core);
      const pur = core.purchases.createPurchase(actor, { supplierId: sid, items: [{ productId: pid, qty: 5, unitCost: 60 }], payments: [{ method: 'cash', amount: 100 }, { method: 'mobile', amount: 50 }] });
      expect(pur.total).toBe(30000);
      expect(pur.paid).toBe(15000);
      expect(pur.due).toBe(15000);
      expect(core.ledger.balance('1000')).toBe(-10000); // cash paid out
      expect(core.ledger.balance('1020')).toBe(-5000);
      expect(core.parties.getSupplier(sid).current_payable).toBe(15000);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('purchase return reduces stock and payable', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, sid } = setup(core);
      const pur = core.purchases.createPurchase(actor, { supplierId: sid, items: [{ productId: pid, qty: 10, unitCost: 60 }] });
      const item = core.db.get<any>('SELECT * FROM purchase_items WHERE purchase_id=?', pur.id);
      const ret = core.purchases.createPurchaseReturn(actor, { purchaseId: pur.id, items: [{ purchaseItemId: item.id, qty: 4 }], reason: 'ক্ষতিগ্রস্ত' });
      expect(ret.returnNo).toBeTruthy();
      // returned 4 @ 60 = 240; payable 600-240=360; stock 20-4=16, value 1100-240=860
      expect(core.parties.getSupplier(sid).current_payable).toBe(36000);
      expect(core.inventory.stock(pid).qty_milli).toBe(16000);
      expect(core.inventory.stock(pid).value_poisha).toBe(88000); // WAC removes 4×55=220, not original 60
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('over purchase-return rejected', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, sid } = setup(core);
      const pur = core.purchases.createPurchase(actor, { supplierId: sid, items: [{ productId: pid, qty: 5, unitCost: 60 }] });
      const item = core.db.get<any>('SELECT * FROM purchase_items WHERE purchase_id=?', pur.id);
      expect(() => core.purchases.createPurchaseReturn(actor, { purchaseId: pur.id, items: [{ purchaseItemId: item.id, qty: 6 }] })).toThrow();
      assertInvariants(core);
    } finally { cleanup(); }
  });
});
