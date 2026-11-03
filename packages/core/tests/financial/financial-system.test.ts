import { describe, it, expect } from 'vitest';
import { tempCore, ensureOwner, assertInvariants } from '../helpers.js';

function setup(core: any) {
  const actor = ensureOwner(core);
  const unit = core.db.get("SELECT id FROM units WHERE name='পিস'").id;
  const pid = core.catalog.createProduct(actor, { name: 'চিনি', baseUnitId: unit, purchasePrice: 90, sellingPrice: 110 });
  core.inventory.openingStock(actor, { productId: pid, qtyMilli: 20000, unitCostPoisha: 9000 }); // 20 @ 90
  const cid = core.parties.createCustomer(actor, { name: 'রহিম', openingBalance: 200 }); // ৳200 due
  const sid = core.parties.createSupplier(actor, { name: 'সাপ্লায়ার', openingBalance: 500 }); // ৳500 payable
  return { actor, pid, cid, sid };
}

describe('collections & supplier payments', () => {
  it('collection reduces due and increases cash; over-collection rejected', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, cid } = setup(core);
      expect(core.parties.getCustomer(cid).current_due).toBe(20000);
      core.payments.collect(actor, { customerId: cid, amount: 150, method: 'cash' });
      expect(core.parties.getCustomer(cid).current_due).toBe(5000);
      expect(core.ledger.balance('1000')).toBe(15000);
      expect(() => core.payments.collect(actor, { customerId: cid, amount: 100, method: 'cash' })).toThrow();
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('supplier payment reduces payable and cash', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, sid } = setup(core);
      core.cash.cashIn(actor, { amount: 1000, reason: 'মূলধন' });
      core.payments.paySupplier(actor, { supplierId: sid, amount: 300, method: 'cash' });
      expect(core.parties.getSupplier(sid).current_payable).toBe(20000);
      expect(core.ledger.balance('1000')).toBe(100000 - 30000);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('expenses & cash', () => {
  it('expense reduces cash and appears in P&L operating expense', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor } = setup(core);
      core.cash.cashIn(actor, { amount: 5000, reason: 'মূলধন' });
      const cat = core.db.get("SELECT id FROM expense_categories WHERE name='দোকান ভাড়া'").id;
      core.expenses.createExpense(actor, { categoryId: cat, amount: 1000, method: 'cash', description: 'নভেম্বর ভাড়া' });
      expect(core.ledger.balance('1000')).toBe(500000 - 100000);
      const pl = core.reports.profitAndLoss('2026-11-03', '2026-11-03');
      expect(pl.operatingExpense).toBe(100000);
      expect(pl.netProfit).toBe(-100000);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('cash in/out/adjustment are traceable and balanced', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor } = setup(core);
      core.cash.cashIn(actor, { amount: 2000, reason: 'বিনিয়োগ' });
      core.cash.cashOut(actor, { amount: 500, reason: 'উত্তোলন' });
      core.cash.adjust(actor, { delta: -100, reason: 'ক্যাশ শর্ট' });
      expect(core.cash.balance('1000')).toBe(200000 - 50000 - 10000);
      expect(core.cash.transactions({}).total).toBeGreaterThanOrEqual(3);
      expect(() => core.cash.cashOut(actor, { amount: 999999, reason: 'x' })).toThrow();
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('P&L full scenario (independently computed)', () => {
  it('computes gross→net profit across sales, discount, return, expense', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, cid } = setup(core);
      // sale 5 @ 110 = 550, 10% discount = 55 → net 495, paid cash
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 5, discountType: 'percent', discountValue: 1000 }], payments: [{ method: 'cash', amount: 495 }] });
      expect(sale.total).toBe(49500);
      // COGS 5×90 = 450
      // return 1 unit → net return 99 (110-10%), cogs restore 90
      const item = core.db.get<any>('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
      core.sales.createSalesReturn(actor, { saleId: sale.id, items: [{ saleItemId: item.id, qty: 1 }] });
      // expense 100
      const cat = core.db.get("SELECT id FROM expense_categories WHERE name='বিদ্যুৎ বিল'").id;
      core.cash.cashIn(actor, { amount: 1000, reason: 'মূলধন' });
      core.expenses.createExpense(actor, { categoryId: cat, amount: 100, method: 'cash' });

      const pl = core.reports.profitAndLoss('2026-11-03', '2026-11-03');
      // gross sales 550; discount 55; return 99; net sales = 550-55-99 = 396
      expect(pl.grossSales).toBe(55000);
      expect(pl.salesDiscount).toBe(5500);
      expect(pl.salesReturn).toBe(9900);
      expect(pl.netSales).toBe(39600);
      // COGS = 450 - 90 = 360
      expect(pl.cogs).toBe(36000);
      // gross profit = 396 - 360 = 36
      expect(pl.grossProfit).toBe(3600);
      expect(pl.operatingExpense).toBe(10000);
      // net profit = 36 - 100 = -64
      expect(pl.netProfit).toBe(-6400);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('dashboard & reports', () => {
  it('dashboard KPIs reflect real data', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid } = setup(core);
      core.sales.createSale(actor, { items: [{ productId: pid, qty: 2 }], payments: [{ method: 'cash', amount: 220 }] });
      const d = core.dashboard.overview('2026-11-03');
      expect(d.sales.today).toBe(22000);
      expect(d.counts.products).toBe(1);
      expect(d.stock.qty).toBe(18000);
      expect(d.cashBalance).toBe(22000);
      expect(d.recentSales.length).toBe(1);
      expect(d.profit.gross).toBe(22000 - 18000);
    } finally { cleanup(); }
  });

  it('empty dashboard shows zeros and empty states (no fake data)', () => {
    const { core, cleanup } = tempCore();
    try {
      const d = core.dashboard.overview('2026-11-03');
      expect(d.sales.today).toBe(0);
      expect(d.recentSales.length).toBe(0);
      expect(d.counts.products).toBe(0);
    } finally { cleanup(); }
  });

  it('stock and due reports return real rows', () => {
    const { core, cleanup } = tempCore();
    try {
      const { actor, pid, cid } = setup(core);
      core.sales.createSale(actor, { customerId: cid, items: [{ productId: pid, qty: 1 }], payments: [{ method: 'cash', amount: 50 }] });
      expect(core.reports.stockReport().rows.length).toBe(1);
      expect(core.reports.customerDue().rows.length).toBe(1);
      expect(core.reports.productPerformance('2026-11-03', '2026-11-03').rows.length).toBe(1);
      expect(core.reports.salesReport('2026-11-03', '2026-11-03').summary.net).toBe(11000);
    } finally { cleanup(); }
  });
});
