import { describe, it, expect } from 'vitest';
import { tempCore, ownerSession, assertInvariants, ensureOwner } from '../helpers.js';

function makeProduct(core: any, opts: any = {}) {
  const unit = core.db.get('SELECT id FROM units WHERE name=?', opts.unit ?? 'পিস').id;
  return core.catalog.createProduct(ensureOwner(core), { name: opts.name ?? 'মিনিকেট চাল', baseUnitId: unit, purchasePrice: opts.purchase ?? 50, sellingPrice: opts.sell ?? 65, trackBatches: opts.trackBatches ?? false, minStock: opts.minStock ?? 5, ...opts.extra });
}

describe('inventory engine (weighted average)', () => {
  it('receives stock and computes WAC value', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core);
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000, sourceType: 'opening' }); // 10 @ 50
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 6000, sourceType: 'purchase' }); // 10 @ 60
      const inv = core.inventory.stock(pid);
      expect(inv.qty_milli).toBe(20000);
      expect(inv.value_poisha).toBe(110000); // 10×5000 + 10×6000 = 110000 poisha = ৳1100
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('consumes at weighted average and clears residual at zero', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core);
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000, sourceType: 'opening' });
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 6000, sourceType: 'purchase' });
      const res = core.inventory.consume(actor, { productId: pid, qtyMilli: 5000, sourceType: 'sale' }); // 5 units
      // avg = 110000/20 = 5500/unit → 5 × 5500 = 27500
      expect(res.cogs).toBe(27500);
      expect(res.costIncomplete).toBe(false);
      const inv = core.inventory.stock(pid);
      expect(inv.qty_milli).toBe(15000);
      expect(inv.value_poisha).toBe(82500);
      // consume all remaining
      const res2 = core.inventory.consume(actor, { productId: pid, qtyMilli: 15000, sourceType: 'sale' });
      expect(res2.cogs).toBe(82500);
      expect(core.inventory.stock(pid).value_poisha).toBe(0);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('prevents negative stock by default', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core);
      core.inventory.receive(actor, { productId: pid, qtyMilli: 2000, unitCostPoisha: 5000, sourceType: 'opening' });
      expect(() => core.inventory.consume(actor, { productId: pid, qtyMilli: 3000, sourceType: 'sale' })).toThrow(/stock/i);
      expect(core.inventory.stock(pid).qty_milli).toBe(2000);
    } finally { cleanup(); }
  });

  it('allows negative stock only when configured, flags incomplete cost', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      core.settings.updateProfile(actor, { allow_negative_stock: 1 });
      const pid = makeProduct(core);
      const res = core.inventory.consume(actor, { productId: pid, qtyMilli: 3000, sourceType: 'sale' });
      expect(res.costIncomplete).toBe(true);
      expect(res.cogs).toBe(0);
      expect(core.inventory.stock(pid).qty_milli).toBe(-3000);
    } finally { cleanup(); }
  });

  it('batch FEFO consumption and expiry blocking', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core, { name: 'দুধ ১ লিটার', unit: 'লিটার', trackBatches: true });
      core.inventory.receive(actor, { productId: pid, qtyMilli: 5000, unitCostPoisha: 8000, batchNo: 'B1', expiryDate: '2026-12-01', sourceType: 'purchase' });
      core.inventory.receive(actor, { productId: pid, qtyMilli: 5000, unitCostPoisha: 8500, batchNo: 'B2', expiryDate: '2026-11-10', sourceType: 'purchase' });
      // FEFO: B2 (earlier expiry) consumed first
      const res = core.inventory.consume(actor, { productId: pid, qtyMilli: 3000, sourceType: 'sale', date: '2026-11-03' });
      expect(res.allocations[0]!.batchId).toBe(core.db.get("SELECT id FROM product_batches WHERE batch_no='B2'").id);
      expect(res.cogs).toBe(3 * 8500);
      // expired batch blocked
      core.inventory.receive(actor, { productId: pid, qtyMilli: 2000, unitCostPoisha: 7000, batchNo: 'B0', expiryDate: '2026-10-01', sourceType: 'purchase' });
      expect(() => core.inventory.consume(actor, { productId: pid, qtyMilli: 2000, sourceType: 'sale', batchId: core.db.get("SELECT id FROM product_batches WHERE batch_no='B0'").id, date: '2026-11-03' })).toThrow(/Expired/i);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('adjustment posts balanced journal and audit', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core);
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000, sourceType: 'opening' });
      core.inventory.adjust(actor, { productId: pid, qtyDeltaMilli: -2000, reason: 'নষ্ট পণ্য' });
      expect(core.inventory.stock(pid).qty_milli).toBe(8000);
      const adj = core.db.get('SELECT * FROM stock_adjustments ORDER BY id DESC LIMIT 1');
      expect(adj.reason).toBe('নষ্ট পণ্য');
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('batch transfer preserves total value', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core, { trackBatches: true });
      core.inventory.receive(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000, batchNo: 'A', sourceType: 'purchase' });
      core.inventory.receive(actor, { productId: pid, qtyMilli: 0 + 1, unitCostPoisha: 5000, batchNo: 'B', sourceType: 'purchase' });
      const before = core.inventory.stock(pid).value_poisha;
      const a = core.db.get("SELECT id FROM product_batches WHERE batch_no='A'").id;
      const b = core.db.get("SELECT id FROM product_batches WHERE batch_no='B'").id;
      core.inventory.transfer(actor, { productId: pid, fromBatchId: a, toBatchId: b, qtyMilli: 4000 });
      expect(core.inventory.stock(pid).value_poisha).toBe(before);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});

describe('catalog', () => {
  it('product CRUD, search, barcode, archive, controlled delete', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core, { name: 'প্রাণ জুস ১ লিটার', extra: { code: 'PRAN-J1', sku: 'PJ1' } });
      core.catalog.addBarcode(actor, pid, '8901234567890');
      expect(core.catalog.searchForPos('8901234567890')[0].id).toBe(pid);
      expect(core.catalog.searchForPos('প্রাণ')[0].id).toBe(pid);
      expect(core.catalog.searchForPos('PRAN-J1')[0].id).toBe(pid);
      core.catalog.updateProduct(actor, pid, { sellingPrice: 70 });
      expect(core.catalog.getProduct(pid).selling_price).toBe(7000);
      // delete blocked when stock exists
      core.inventory.receive(actor, { productId: pid, qtyMilli: 1000, unitCostPoisha: 5000, sourceType: 'opening' });
      expect(() => core.catalog.deleteProduct(actor, pid)).toThrow();
      core.catalog.archiveProduct(actor, pid, true);
      expect(core.catalog.listProducts({}).rows.find((r: any) => r.id === pid)).toBeUndefined();
    } finally { cleanup(); }
  });

  it('CSV import/export round-trip with Bengali', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const unitMap = new Map(core.catalog.listUnits().map((u: any) => [u.name, u.id]));
      const csv = 'name,code,category,unit,purchase_price,selling_price,min_stock\nসয়াবিন তেল ৫ লিটার,SOY5,তেল,পিস,600,720,3\nচিনি ১ কেজি,SUG1,মুদি,কেজি,90,110,5';
      const res = core.catalog.importProductsCsv(actor, csv, unitMap);
      expect(res.created).toBe(2);
      expect(res.errors.length).toBe(0);
      const out = core.catalog.exportProductsCsv();
      expect(out).toContain('সয়াবিন তেল ৫ লিটার');
      expect(out).toContain('720.00');
    } finally { cleanup(); }
  });

  it('unit conversion factor resolves', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const pid = makeProduct(core);
      const carton = core.db.get("SELECT id FROM units WHERE name='কার্টন'").id;
      core.catalog.setConversion(actor, { productId: pid, fromUnitId: carton, toUnitId: core.catalog.getProduct(pid).base_unit_id, factorMilli: 12000 });
      expect(core.catalog.conversionFactor(pid, carton)).toBe(12000);
    } finally { cleanup(); }
  });
});

describe('parties', () => {
  it('customer opening balance posts to subledger; statement runs', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const cid = core.parties.createCustomer(actor, { name: 'রহিম উদ্দিন', mobile: '০১৭১২৩৪৫৬৭৮', openingBalance: 500 });
      expect(core.parties.getCustomer(cid).current_due).toBe(50000);
      const st = core.parties.customerStatement(cid);
      expect(st.closing).toBe(50000);
      expect(st.rows.length).toBe(1);
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('supplier opening payable and search', () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const sid = core.parties.createSupplier(actor, { name: 'প্রাণ ফুডস লিমিটেড', openingBalance: 10000 });
      expect(core.parties.getSupplier(sid).current_payable).toBe(1000000);
      expect(core.parties.listSuppliers({ search: 'প্রাণ' }).rows.length).toBe(1);
      assertInvariants(core);
    } finally { cleanup(); }
  });
});
