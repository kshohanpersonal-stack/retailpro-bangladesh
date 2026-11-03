import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tempCore, ensureOwner } from '../helpers.js';
import { invoicePdf, receiptPdf, reportPdf } from '../../src/pdf/documents.js';
import { loadFontSet } from '../../src/pdf/engine.js';

describe('Bengali PDF engine', () => {
  it('generates a valid invoice PDF with Bengali content', async () => {
    const { core, cleanup } = tempCore();
    try {
      const actor = ensureOwner(core);
      const unit = core.db.get("SELECT id FROM units WHERE name='পিস'").id;
      const pid = core.catalog.createProduct(actor, { name: 'মিনিকেট চাল ৫ কেজি', baseUnitId: unit, purchasePrice: 50, sellingPrice: 65 });
      core.inventory.openingStock(actor, { productId: pid, qtyMilli: 10000, unitCostPoisha: 5000 });
      const sale = core.sales.createSale(actor, { items: [{ productId: pid, qty: 3 }], payments: [{ method: 'cash', amount: 195 }] });
      const full = core.sales.getSale(sale.id);
      const biz = { name: 'করিম স্টোর', address: 'টঙ্গী, গাজীপুর', mobile: '০১৭১২৩৪৫৬৭৮' };
      const bytes = await invoicePdf(full, biz);
      expect(bytes.length).toBeGreaterThan(5000);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
      // write for visual inspection
      const out = path.join(os.tmpdir(), 'ponno-invoice-test.pdf');
      fs.writeFileSync(out, bytes);
      const receipt = await receiptPdf(full, biz, { width: 'receipt80' });
      expect(receipt.length).toBeGreaterThan(3000);
      fs.writeFileSync(path.join(os.tmpdir(), 'ponno-receipt-test.pdf'), receipt);
    } finally { cleanup(); }
  });

  it('generates a report PDF with table and summary', async () => {
    const fonts = loadFontSet();
    const bytes = await reportPdf('সেলস রিপোর্ট', [
      { header: 'তারিখ', width: 70 }, { header: 'ইনভয়েস', width: 90 }, { header: 'মোট', width: 80, align: 'right' },
    ], [['০৩/১১/২৬', 'INV-2026-00001', '৳১৯৫.০০'], ['০৩/১১/২৬', 'INV-2026-00002', '৳৪৫০.০০']],
    { name: 'করিম স্টোর' }, [['মোট বিক্রি', '৳৬৪৫.০০']], { fonts });
    expect(bytes.length).toBeGreaterThan(5000);
    fs.writeFileSync(path.join(os.tmpdir(), 'ponno-report-test.pdf'), bytes);
  });
});
