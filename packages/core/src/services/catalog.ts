/** Catalog: categories, brands, units, conversions, products, barcodes; CSV import/export. */
import type { Db } from '../db/database.js';
import { Errors } from '../errors.js';
import { nowISO } from '../util/dates.js';
import { normalizeName, requireText, optionalText, toCsv } from '../util/text.js';
import { parseMoney } from '../util/money.js';
import { parseQty } from '../util/quantity.js';
import type { Actor, AuditService } from './audit.js';

export class CatalogService {
  constructor(private db: Db, private audit: AuditService) {}

  // ---- Categories ----
  createCategory(actor: Actor, name: string, description?: string): number {
    const n = requireText(name, 'ক্যাটাগরির নাম', 120);
    if (this.db.get('SELECT id FROM categories WHERE name=?', n)) throw Errors.duplicate('এই ক্যাটাগরি');
    const now = nowISO();
    const r = this.db.run('INSERT INTO categories(name,name_norm,description,created_at,updated_at) VALUES (?,?,?,?,?)', n, normalizeName(n), optionalText(description), now, now);
    this.audit.log(actor, 'category.create', 'categories', r.lastInsertRowid, { after: { name: n } });
    return r.lastInsertRowid;
  }
  updateCategory(actor: Actor, id: number, patch: { name?: string; description?: string; archived?: boolean }): void {
    const cat = this.db.get<any>('SELECT * FROM categories WHERE id=?', id);
    if (!cat) throw Errors.notFound('ক্যাটাগরি');
    const name = patch.name !== undefined ? requireText(patch.name, 'ক্যাটাগরির নাম', 120) : cat.name;
    this.db.run('UPDATE categories SET name=?, name_norm=?, description=?, archived=?, updated_at=? WHERE id=?',
      name, normalizeName(name), patch.description !== undefined ? optionalText(patch.description) : cat.description, patch.archived !== undefined ? (patch.archived ? 1 : 0) : cat.archived, nowISO(), id);
    this.audit.log(actor, 'category.update', 'categories', id, { before: cat, after: patch });
  }
  deleteCategory(actor: Actor, id: number): void {
    const deps = this.db.get<{ c: number }>('SELECT COUNT(*) c FROM products WHERE category_id=?', id)!.c;
    if (deps > 0) throw Errors.conflict('এই ক্যাটাগরিতে প্রোডাক্ট আছে; আর্কাইভ করুন');
    this.db.run('DELETE FROM categories WHERE id=?', id);
    this.audit.log(actor, 'category.delete', 'categories', id);
  }
  listCategories(params: { search?: string; includeArchived?: boolean } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (!params.includeArchived) where.push('archived=0');
    if (params.search) { where.push('name_norm LIKE ?'); args.push('%' + normalizeName(params.search) + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return this.db.all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.archived=0) product_count FROM categories c ${w} ORDER BY c.name`, ...args);
  }

  // ---- Brands ----
  createBrand(actor: Actor, name: string): number {
    const n = requireText(name, 'ব্র্যান্ডের নাম', 120);
    if (this.db.get('SELECT id FROM brands WHERE name=?', n)) throw Errors.duplicate('এই ব্র্যান্ড');
    const now = nowISO();
    const r = this.db.run('INSERT INTO brands(name,name_norm,created_at,updated_at) VALUES (?,?,?,?)', n, normalizeName(n), now, now);
    this.audit.log(actor, 'brand.create', 'brands', r.lastInsertRowid, { after: { name: n } });
    return r.lastInsertRowid;
  }
  updateBrand(actor: Actor, id: number, patch: { name?: string; archived?: boolean }): void {
    const b = this.db.get<any>('SELECT * FROM brands WHERE id=?', id);
    if (!b) throw Errors.notFound('ব্র্যান্ড');
    const name = patch.name !== undefined ? requireText(patch.name, 'ব্র্যান্ডের নাম', 120) : b.name;
    this.db.run('UPDATE brands SET name=?, name_norm=?, archived=?, updated_at=? WHERE id=?', name, normalizeName(name), patch.archived !== undefined ? (patch.archived ? 1 : 0) : b.archived, nowISO(), id);
    this.audit.log(actor, 'brand.update', 'brands', id, { before: b, after: patch });
  }
  deleteBrand(actor: Actor, id: number): void {
    const deps = this.db.get<{ c: number }>('SELECT COUNT(*) c FROM products WHERE brand_id=?', id)!.c;
    if (deps > 0) throw Errors.conflict('এই ব্র্যান্ডে প্রোডাক্ট আছে; আর্কাইভ করুন');
    this.db.run('DELETE FROM brands WHERE id=?', id);
    this.audit.log(actor, 'brand.delete', 'brands', id);
  }
  listBrands(params: { search?: string; includeArchived?: boolean } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (!params.includeArchived) where.push('archived=0');
    if (params.search) { where.push('name_norm LIKE ?'); args.push('%' + normalizeName(params.search) + '%'); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return this.db.all(`SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_id=b.id AND p.archived=0) product_count FROM brands b ${w} ORDER BY b.name`, ...args);
  }

  // ---- Units & conversions ----
  listUnits() { return this.db.all('SELECT * FROM units ORDER BY id'); }
  createUnit(actor: Actor, name: string, symbol: string, kind: 'count' | 'weight' | 'volume'): number {
    const n = requireText(name, 'ইউনিটের নাম', 40);
    if (this.db.get('SELECT id FROM units WHERE name=?', n)) throw Errors.duplicate('এই ইউনিট');
    const r = this.db.run('INSERT INTO units(name,symbol,kind,created_at) VALUES (?,?,?,?)', n, requireText(symbol, 'সংকেত', 10), kind, nowISO());
    this.audit.log(actor, 'unit.create', 'units', r.lastInsertRowid, { after: { name: n } });
    return r.lastInsertRowid;
  }
  setConversion(actor: Actor, input: { productId?: number | null; fromUnitId: number; toUnitId: number; factorMilli: number }): number {
    if (input.factorMilli <= 0) throw Errors.validation('কনভার্সন ফ্যাক্টর ধনাত্মক হতে হবে');
    const from = this.db.get('SELECT id FROM units WHERE id=?', input.fromUnitId);
    const to = this.db.get('SELECT id FROM units WHERE id=?', input.toUnitId);
    if (!from || !to) throw Errors.notFound('ইউনিট');
    const r = this.db.run('INSERT INTO unit_conversions(product_id,from_unit_id,to_unit_id,factor_milli) VALUES (?,?,?,?) ON CONFLICT(product_id,from_unit_id,to_unit_id) DO UPDATE SET factor_milli=excluded.factor_milli',
      input.productId ?? null, input.fromUnitId, input.toUnitId, input.factorMilli);
    this.audit.log(actor, 'unit.conversion', 'unit_conversions', r.lastInsertRowid, { after: input });
    return r.lastInsertRowid;
  }
  listConversions(productId?: number | null) {
    return this.db.all(`SELECT uc.*, fu.name from_name, tu.name to_name FROM unit_conversions uc JOIN units fu ON fu.id=uc.from_unit_id JOIN units tu ON tu.id=uc.to_unit_id WHERE uc.product_id IS ? ORDER BY uc.id`, productId ?? null);
  }
  /** Resolve conversion factor (milli) from a unit to the product's base unit. */
  conversionFactor(productId: number, fromUnitId: number): number {
    const p = this.db.get<any>('SELECT base_unit_id FROM products WHERE id=?', productId);
    if (!p) throw Errors.notFound('প্রোডাক্ট');
    if (p.base_unit_id === fromUnitId) return 1000;
    const direct = this.db.get<{ factor_milli: number }>('SELECT factor_milli FROM unit_conversions WHERE from_unit_id=? AND to_unit_id=? AND (product_id=? OR product_id IS NULL) ORDER BY product_id DESC LIMIT 1', fromUnitId, p.base_unit_id, productId);
    if (direct) return direct.factor_milli;
    throw Errors.validation('এই ইউনিট থেকে বেস ইউনিটে কনভার্সন সংজ্ঞায়িত নেই');
  }

  // ---- Products ----
  createProduct(actor: Actor, input: Record<string, any>): number {
    const name = requireText(input.name, 'প্রোডাক্টের নাম', 200);
    const baseUnitId = Number(input.baseUnitId ?? input.base_unit_id);
    if (!this.db.get('SELECT id FROM units WHERE id=?', baseUnitId)) throw Errors.validation('সঠিক বেস ইউনিট নির্বাচন করুন');
    const code = optionalText(input.code, 60);
    const sku = optionalText(input.sku, 60);
    if (code && this.db.get('SELECT id FROM products WHERE code=?', code)) throw Errors.duplicate('এই প্রোডাক্ট কোড');
    if (sku && this.db.get('SELECT id FROM products WHERE sku=?', sku)) throw Errors.duplicate('এই SKU');
    const selling = parseMoney(input.sellingPrice ?? input.selling_price ?? 0);
    const purchase = parseMoney(input.purchasePrice ?? input.purchase_price ?? 0);
    const wholesale = parseMoney(input.wholesalePrice ?? input.wholesale_price ?? 0);
    if (selling < 0 || purchase < 0 || wholesale < 0) throw Errors.validation('দাম ঋণাত্মক হতে পারে না');
    const discountType = input.discountType ?? input.discount_type ?? 'none';
    const discountValue = Number(input.discountValue ?? input.discount_value ?? 0);
    if (!['none', 'percent', 'fixed'].includes(discountType)) throw Errors.validation('ডিসকাউন্টের ধরন সঠিক নয়');
    if (discountType === 'percent' && (discountValue < 0 || discountValue > 10000)) throw Errors.validation('শতকরা ডিসকাউন্ট ০-১০০% এর মধ্যে হতে হবে');
    if (discountType === 'fixed' && discountValue < 0) throw Errors.validation('ডিসকাউন্ট ঋণাত্মক হতে পারে না');
    const now = nowISO();
    const r = this.db.run(`INSERT INTO products(name,name_norm,code,sku,category_id,brand_id,base_unit_id,purchase_price,selling_price,wholesale_price,discount_type,discount_value,min_stock_milli,description,track_batches,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      name, normalizeName(name), code, sku, input.categoryId ?? input.category_id ?? null, input.brandId ?? input.brand_id ?? null, baseUnitId,
      purchase, selling, wholesale, discountType, discountValue, parseQty(input.minStock ?? input.min_stock ?? 0), optionalText(input.description), input.trackBatches ?? input.track_batches ? 1 : 0, now, now);
    const id = r.lastInsertRowid;
    this.db.run('INSERT INTO inventory(product_id,qty_milli,value_poisha,updated_at) VALUES (?,0,0,?)', id, now);
    for (const b of input.barcodes ?? []) this.addBarcode(actor, id, b);
    this.audit.log(actor, 'product.create', 'products', id, { after: { name, code, sku } });
    return id;
  }

  updateProduct(actor: Actor, id: number, patch: Record<string, any>): void {
    const p = this.db.get<any>('SELECT * FROM products WHERE id=?', id);
    if (!p) throw Errors.notFound('প্রোডাক্ট');
    const map: Record<string, string> = { name: 'name', code: 'code', sku: 'sku', categoryId: 'category_id', brandId: 'brand_id', baseUnitId: 'base_unit_id', description: 'description' };
    const before = { ...p };
    const sets: string[] = [];
    const args: any[] = [];
    for (const [k, col] of Object.entries(map)) {
      const v = patch[k] ?? patch[col];
      if (v === undefined) continue;
      if (k === 'name') { sets.push('name=?', 'name_norm=?'); args.push(requireText(v, 'প্রোডাক্টের নাম', 200), normalizeName(String(v))); }
      else if (k === 'code' || k === 'sku') {
        const val = optionalText(v, 60);
        if (val) { const dup = this.db.get<any>(`SELECT id FROM products WHERE ${col}=? AND id!=?`, val, id); if (dup) throw Errors.duplicate(col === 'code' ? 'এই প্রোডাক্ট কোড' : 'এই SKU'); }
        sets.push(`${col}=?`); args.push(val);
      } else { sets.push(`${col}=?`); args.push(v === '' ? null : v); }
    }
    for (const k of ['purchasePrice', 'sellingPrice', 'wholesalePrice']) {
      const col = k === 'purchasePrice' ? 'purchase_price' : k === 'sellingPrice' ? 'selling_price' : 'wholesale_price';
      const v = patch[k] ?? patch[col];
      if (v !== undefined) { sets.push(`${col}=?`); args.push(parseMoney(v)); }
    }
    if (patch.discountType !== undefined || patch.discount_type !== undefined) { sets.push('discount_type=?'); args.push(patch.discountType ?? patch.discount_type); }
    if (patch.discountValue !== undefined || patch.discount_value !== undefined) { sets.push('discount_value=?'); args.push(Number(patch.discountValue ?? patch.discount_value)); }
    if (patch.minStock !== undefined || patch.min_stock !== undefined) { sets.push('min_stock_milli=?'); args.push(parseQty(patch.minStock ?? patch.min_stock)); }
    if (patch.trackBatches !== undefined || patch.track_batches !== undefined) { sets.push('track_batches=?'); args.push((patch.trackBatches ?? patch.track_batches) ? 1 : 0); }
    if (patch.archived !== undefined) { sets.push('archived=?'); args.push(patch.archived ? 1 : 0); }
    if (!sets.length) return;
    sets.push('updated_at=?'); args.push(nowISO());
    this.db.run(`UPDATE products SET ${sets.join(',')} WHERE id=?`, ...args, id);
    this.audit.log(actor, 'product.update', 'products', id, { before, after: patch });
  }

  archiveProduct(actor: Actor, id: number, archived: boolean): void {
    this.updateProduct(actor, id, { archived });
  }

  deleteProduct(actor: Actor, id: number): void {
    const refs = this.db.get<{ c: number }>('SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id=?)+(SELECT COUNT(*) FROM purchase_items WHERE product_id=?) c', id, id)!.c;
    if (refs > 0) throw Errors.conflict('এই প্রোডাক্টের লেনদেন আছে; আর্কাইভ করুন');
    const stock = this.db.get<{ q: number }>('SELECT qty_milli q FROM inventory WHERE product_id=?', id);
    if (stock && stock.q !== 0) throw Errors.conflict('স্টক শূন্য না হলে প্রোডাক্ট মুছে ফেলা যায় না');
    this.db.run('DELETE FROM products WHERE id=?', id);
    this.audit.log(actor, 'product.delete', 'products', id);
  }

  getProduct(id: number) {
    const p = this.db.get<any>(`SELECT p.*, c.name category_name, b.name brand_name, u.name unit_name, u.symbol unit_symbol,
      i.qty_milli, i.value_poisha FROM products p
      LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id
      JOIN units u ON u.id=p.base_unit_id LEFT JOIN inventory i ON i.product_id=p.id WHERE p.id=?`, id);
    if (!p) throw Errors.notFound('প্রোডাক্ট');
    p.barcodes = this.db.all('SELECT * FROM product_barcodes WHERE product_id=?', id);
    return p;
  }

  listProducts(params: { search?: string; categoryId?: number; brandId?: number; includeArchived?: boolean; lowStockOnly?: boolean; limit?: number; offset?: number; sort?: string } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (!params.includeArchived) where.push('p.archived=0');
    if (params.search) {
      const q = normalizeName(params.search);
      where.push('(p.name_norm LIKE ? OR p.code LIKE ? OR p.sku LIKE ? OR EXISTS(SELECT 1 FROM product_barcodes pb WHERE pb.product_id=p.id AND pb.barcode LIKE ?))');
      args.push(`%${q}%`, `%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
    }
    if (params.categoryId) { where.push('p.category_id=?'); args.push(params.categoryId); }
    if (params.brandId) { where.push('p.brand_id=?'); args.push(params.brandId); }
    if (params.lowStockOnly) where.push('i.qty_milli <= p.min_stock_milli');
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sortMap: Record<string, string> = { name: 'p.name', created: 'p.id DESC', stock: 'i.qty_milli', price: 'p.selling_price' };
    const order = sortMap[params.sort ?? 'name'] ?? 'p.name';
    const limit = Math.min(params.limit ?? 50, 500);
    const rows = this.db.all<any>(`SELECT p.*, c.name category_name, b.name brand_name, u.name unit_name, u.symbol unit_symbol, i.qty_milli, i.value_poisha
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id
      JOIN units u ON u.id=p.base_unit_id LEFT JOIN inventory i ON i.product_id=p.id ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, limit, params.offset ?? 0);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM products p LEFT JOIN inventory i ON i.product_id=p.id ${w}`, ...args)!.c;
    return { rows, total };
  }

  /** POS lookup by barcode / code / sku / name. */
  searchForPos(query: string, limit = 20) {
    const q = query.trim();
    if (!q) return [];
    const exact = this.db.get<any>(`SELECT p.* FROM product_barcodes pb JOIN products p ON p.id=pb.product_id WHERE pb.barcode=? AND p.archived=0`, q);
    if (exact) return [this.getProduct(exact.id)];
    const byCode = this.db.get<any>('SELECT * FROM products WHERE (code=? OR sku=?) AND archived=0', q, q);
    if (byCode) return [this.getProduct(byCode.id)];
    return this.listProducts({ search: q, limit }).rows.map((r: any) => this.getProduct(r.id));
  }

  addBarcode(actor: Actor, productId: number, barcode: string, symbology: 'code128' | 'ean13' | 'qr' = 'code128'): number {
    const b = requireText(barcode, 'বারকোড', 80);
    if (this.db.get('SELECT id FROM product_barcodes WHERE barcode=?', b)) throw Errors.duplicate('এই বারকোড');
    const r = this.db.run('INSERT INTO product_barcodes(product_id,barcode,symbology,created_at) VALUES (?,?,?,?)', productId, b, symbology, nowISO());
    this.audit.log(actor, 'product.barcode_add', 'products', productId, { after: { barcode: b } });
    return r.lastInsertRowid;
  }
  removeBarcode(actor: Actor, barcodeId: number): void {
    this.db.run('DELETE FROM product_barcodes WHERE id=?', barcodeId);
    this.audit.log(actor, 'product.barcode_remove', 'product_barcodes', barcodeId);
  }

  // ---- CSV import/export ----
  exportProductsCsv(): string {
    const rows = this.db.all<any>(`SELECT p.name, p.code, p.sku, c.name category, b.name brand, u.name unit, p.purchase_price, p.selling_price, p.wholesale_price, p.min_stock_milli, i.qty_milli
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id JOIN units u ON u.id=p.base_unit_id LEFT JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 ORDER BY p.name`);
    return toCsv(['name', 'code', 'sku', 'category', 'brand', 'unit', 'purchase_price', 'selling_price', 'wholesale_price', 'min_stock', 'stock'],
      rows.map((r) => [r.name, r.code, r.sku, r.category, r.brand, r.unit, (r.purchase_price / 100).toFixed(2), (r.selling_price / 100).toFixed(2), (r.wholesale_price / 100).toFixed(2), r.min_stock_milli / 1000, r.qty_milli / 1000]));
  }

  importProductsCsv(actor: Actor, csvText: string, unitNameToId: Map<string, number>): { created: number; errors: Array<{ line: number; error: string }> } {
    const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw Errors.validation('CSV ফাইলে কমপক্ষে হেডার ও একটি সারি থাকতে হবে');
    const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    let created = 0;
    const errors: Array<{ line: number; error: string }> = [];
    this.db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        try {
          const cells = parseCsvLine(lines[i]!);
          const name = cells[idx('name')]?.trim();
          if (!name) throw new Error('name আবশ্যক');
          const unitName = cells[idx('unit')]?.trim() || 'পিস';
          const unitId = unitNameToId.get(unitName);
          if (!unitId) throw new Error(`ইউনিট পাওয়া যায়নি: ${unitName}`);
          let categoryId: number | null = null;
          const catName = cells[idx('category')]?.trim();
          if (catName) {
            let cat = this.db.get<{ id: number }>('SELECT id FROM categories WHERE name=?', catName);
            if (!cat) { const cid = this.createCategory(actor, catName); cat = { id: cid }; }
            categoryId = cat.id;
          }
          this.createProduct(actor, {
            name, code: cells[idx('code')], sku: cells[idx('sku')], categoryId,
            baseUnitId: unitId, purchasePrice: cells[idx('purchase_price')] || 0, sellingPrice: cells[idx('selling_price')] || 0,
            wholesalePrice: cells[idx('wholesale_price')] || 0, minStock: cells[idx('min_stock')] || 0,
          });
          created++;
        } catch (e: any) {
          errors.push({ line: i + 1, error: e.messageBn ?? e.message });
        }
      }
    });
    this.audit.log(actor, 'product.import', 'products', null, { after: { created, errors: errors.length } });
    return { created, errors };
  }
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
