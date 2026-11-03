/** Business document templates: invoice, thermal receipt, statement, report. Business identity only — no software branding. */
import { PdfDocument, loadFontSet, type FontSet } from './engine.js';
import { formatMoney } from '../util/money.js';
import { formatQty } from '../util/quantity.js';
import { formatDate } from '../util/dates.js';

export interface BusinessIdentity { name: string; address?: string | null; mobile?: string | null; email?: string | null; logoPath?: string | null; }
const GREEN = { r: 0.055, g: 0.42, b: 0.31 };
const DARK = { r: 0.1, g: 0.13, b: 0.2 };
const GRAY = { r: 0.35, g: 0.39, b: 0.45 };

async function newDoc(fonts: FontSet | undefined, title: string, size: 'A4' | 'receipt80' | 'receipt58' = 'A4', margin = 40) {
  const doc = await PdfDocument.create(fonts ?? loadFontSet(), { title });
  doc.addPage(size, margin);
  return doc;
}

function header(doc: PdfDocument, biz: BusinessIdentity, subtitle: string) {
  doc.text(biz.name || 'ব্যবসা', { size: 18, variant: 'bold', color: GREEN, align: 'center' });
  if (biz.address) doc.text(biz.address, { size: 9.5, color: GRAY, align: 'center' });
  const contact = [biz.mobile ? `মোবাইল: ${biz.mobile}` : '', biz.email ?? ''].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact, { size: 9.5, color: GRAY, align: 'center' });
  doc.space(4); doc.line();
  doc.text(subtitle, { size: 13, variant: 'semibold', align: 'center', color: DARK });
  doc.space(2);
}

export async function invoicePdf(sale: any, biz: BusinessIdentity, opts: { digits?: 'bn' | 'en'; fonts?: FontSet } = {}): Promise<Uint8Array> {
  const digits = opts.digits ?? 'bn';
  const doc = await newDoc(opts.fonts, `Invoice ${sale.invoice_no}`);
  header(doc, biz, 'সেলস ইনভয়েস');
  doc.keyValues([
    ['ইনভয়েস নং', sale.invoice_no],
    ['তারিখ', formatDate(sale.sale_date, 'DD/MM/YYYY', digits)],
    ['কাস্টমার', sale.customer_name || 'ওয়াক-ইন কাস্টমার'],
    ['ক্যাশিয়ার', sale.cashier_name || '—'],
  ], { size: 10.5 });
  doc.space(6);
  const rows = sale.items.map((it: any, i: number) => [
    String(i + 1), it.product_name, `${formatQty(it.qty_milli, digits)} ${it.unit_name}`,
    formatMoney(it.unit_price, { digits, symbol: false }), formatMoney(it.discount, { digits, symbol: false }), formatMoney(it.net, { digits, symbol: false }),
  ]);
  doc.table([
    { header: '#', width: 24 }, { header: 'প্রোডাক্ট', width: 150 }, { header: 'পরিমাণ', width: 70 },
    { header: 'দর', width: 60, align: 'right' }, { header: 'ছাড়', width: 55, align: 'right' }, { header: 'মোট', width: 70, align: 'right' },
  ], rows, { size: 9.5 });
  doc.line();
  doc.keyValues([
    ['সাবটোটাল', formatMoney(sale.subtotal, { digits })],
    ['ডিসকাউন্ট', formatMoney(sale.discount, { digits })],
    ['গ্র্যান্ড টোটাল', formatMoney(sale.total, { digits })],
    ['পেইড', formatMoney(sale.paid, { digits })],
    ['বাকি', formatMoney(sale.due, { digits })],
  ], { size: 11, bold: true });
  if (sale.notes) { doc.space(6); doc.text(`নোট: ${sale.notes}`, { size: 9.5, color: GRAY }); }
  doc.space(16);
  doc.text('ধন্যবাদ! আবার আসবেন।', { size: 10, align: 'center', color: GRAY });
  return doc.save();
}

export async function receiptPdf(sale: any, biz: BusinessIdentity, opts: { width?: 'receipt58' | 'receipt80'; digits?: 'bn' | 'en'; fonts?: FontSet } = {}): Promise<Uint8Array> {
  const digits = opts.digits ?? 'bn';
  const width = opts.width ?? 'receipt80';
  const doc = await newDoc(opts.fonts, `Receipt ${sale.invoice_no}`, width, 10);
  doc.text(biz.name || 'ব্যবসা', { size: 13, variant: 'bold', align: 'center', color: DARK });
  if (biz.address) doc.text(biz.address, { size: 8, align: 'center', color: GRAY });
  if (biz.mobile) doc.text(`মোবাইল: ${biz.mobile}`, { size: 8, align: 'center', color: GRAY });
  doc.line();
  doc.text(`ইনভয়েস: ${sale.invoice_no}`, { size: 8.5 });
  doc.text(`তারিখ: ${formatDate(sale.sale_date, 'DD/MM/YYYY', digits)}  ${sale.sale_time ?? ''}`, { size: 8.5 });
  if (sale.customer_name) doc.text(`কাস্টমার: ${sale.customer_name}`, { size: 8.5 });
  doc.line();
  for (const it of sale.items) {
    doc.text(it.product_name, { size: 8.5, variant: 'semibold' });
    const left = `${formatQty(it.qty_milli, digits)} ${it.unit_name} × ${formatMoney(it.unit_price, { digits, symbol: false })}`;
    doc.text(left, { size: 8, color: GRAY });
    const amt = formatMoney(it.net, { digits, symbol: false });
    const w = (doc as any).fonts.regular.measure(amt, 8.5);
    doc.drawText(amt, doc.width - doc.margin - w, doc.cursorY + 8.5 * 1.5 - 8.5, { size: 8.5 });
  }
  doc.line();
  doc.keyValues([
    ['মোট', formatMoney(sale.total, { digits })],
    ['পেইড', formatMoney(sale.paid, { digits })],
    ['বাকি', formatMoney(sale.due, { digits })],
  ], { size: 9.5, bold: true });
  doc.space(6);
  doc.text('ধন্যবাদ!', { size: 9, align: 'center', color: GRAY });
  return doc.save();
}

export async function statementPdf(title: string, partyName: string, statement: { opening: number; rows: any[]; closing: number }, biz: BusinessIdentity, opts: { digits?: 'bn' | 'en'; fonts?: FontSet } = {}): Promise<Uint8Array> {
  const digits = opts.digits ?? 'bn';
  const doc = await newDoc(opts.fonts, title);
  header(doc, biz, title);
  doc.text(partyName, { size: 12, variant: 'semibold' });
  doc.text(`ওপেনিং ব্যালেন্স: ${formatMoney(statement.opening, { digits })}`, { size: 10, color: GRAY });
  doc.space(4);
  const rows = statement.rows.map((r) => [
    formatDate(r.entry_date, 'DD/MM/YY', digits), r.description,
    formatMoney(r.debit, { digits, symbol: false }), formatMoney(r.credit, { digits, symbol: false }), formatMoney(r.balance, { digits, symbol: false }),
  ]);
  doc.table([
    { header: 'তারিখ', width: 60 }, { header: 'বিবরণ', width: 180 }, { header: 'ডেবিট', width: 70, align: 'right' },
    { header: 'ক্রেডিট', width: 70, align: 'right' }, { header: 'ব্যালেন্স', width: 75, align: 'right' },
  ], rows, { size: 9 });
  doc.line();
  doc.keyValues([['বর্তমান ব্যালেন্স', formatMoney(statement.closing, { digits })]], { size: 12, bold: true });
  return doc.save();
}

export async function reportPdf(title: string, columns: Array<{ header: string; width: number; align?: 'left' | 'right' | 'center' }>, rows: string[][], biz: BusinessIdentity, summary: Array<[string, string]> = [], opts: { fonts?: FontSet; subtitle?: string } = {}): Promise<Uint8Array> {
  const doc = await newDoc(opts.fonts, title);
  header(doc, biz, title);
  if (opts.subtitle) doc.text(opts.subtitle, { size: 9.5, color: GRAY, align: 'center' });
  doc.space(4);
  doc.table(columns, rows, { size: 9 });
  if (summary.length) { doc.line(); doc.keyValues(summary, { size: 11, bold: true }); }
  return doc.save();
}
