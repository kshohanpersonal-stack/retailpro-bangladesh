/** Reporting engine: P&L from journal + all business reports. Real data only. */
import type { Db } from '../db/database.js';
import type { LedgerService } from './ledger.js';
import { startOfWeek, startOfMonth, startOfYear, todayISO } from '../util/dates.js';

export interface ProfitAndLoss {
  from: string; to: string;
  grossSales: number; salesDiscount: number; salesReturn: number; netSales: number;
  cogs: number; grossProfit: number; operatingExpense: number; otherAdjustments: number; netProfit: number;
  expenseByCategory: Array<{ name: string; amount: number }>;
  costIncompleteCount: number; costIncompleteAmount: number;
}

export class ReportService {
  constructor(private db: Db, private ledger: LedgerService) {}

  private act(code: string, from: string, to: string) { return this.ledger.activity(code, from, to); }

  profitAndLoss(from: string, to: string): ProfitAndLoss {
    const rev = this.act('4000', from, to);
    const disc = this.act('4100', from, to);
    const ret = this.act('4200', from, to);
    const cogs = this.act('5000', from, to);
    const grossSales = rev.credit - rev.debit;
    const salesDiscount = disc.debit - disc.credit;
    const salesReturn = ret.debit - ret.credit;
    const netSales = grossSales - salesDiscount - salesReturn;
    const cogsNet = cogs.debit - cogs.credit;
    const grossProfit = netSales - cogsNet;
    // operating expenses: expense accounts code >= 6000
    const expRows = this.db.all<any>(`SELECT a.name, SUM(jl.debit)-SUM(jl.credit) amount
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE a.type='expense' AND CAST(a.code AS INTEGER) >= 6000 AND je.entry_date BETWEEN ? AND ?
      GROUP BY a.id HAVING amount != 0 ORDER BY amount DESC`, from, to);
    const operatingExpense = expRows.reduce((s, r) => s + r.amount, 0);
    const adj = this.act('5200', from, to);
    const otherAdjustments = adj.debit - adj.credit; // net loss positive
    const netProfit = grossProfit - operatingExpense - otherAdjustments;
    const incomplete = this.db.get<{ c: number; s: number }>('SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM sales WHERE cost_incomplete=1 AND sale_date BETWEEN ? AND ?', from, to)!;
    return { from, to, grossSales, salesDiscount, salesReturn, netSales, cogs: cogsNet, grossProfit, operatingExpense, otherAdjustments, netProfit, expenseByCategory: expRows, costIncompleteCount: incomplete.c, costIncompleteAmount: incomplete.s };
  }

  salesReport(from: string, to: string, groupBy: 'day' | 'week' | 'month' | 'year' | 'none' = 'day') {
    const groupExpr = groupBy === 'day' ? 's.sale_date' : groupBy === 'month' ? "substr(s.sale_date,1,7)" : groupBy === 'year' ? "substr(s.sale_date,1,4)" : groupBy === 'week' ? "date(s.sale_date, 'weekday 6', '-6 days')" : "'all'";
    const rows = this.db.all<any>(`SELECT ${groupExpr} period, COUNT(*) invoices, SUM(s.subtotal) gross, SUM(s.discount) discount, SUM(s.total) net, SUM(s.paid) paid, SUM(s.due) due
      FROM sales s WHERE s.sale_date BETWEEN ? AND ? AND s.status='completed' GROUP BY period ORDER BY period`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) invoices, COALESCE(SUM(subtotal),0) gross, COALESCE(SUM(discount),0) discount, COALESCE(SUM(total),0) net, COALESCE(SUM(paid),0) paid, COALESCE(SUM(due),0) due FROM sales WHERE sale_date BETWEEN ? AND ? AND status=\'completed\'', from, to);
    return { rows, summary };
  }

  purchaseReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT p.purchase_date date, p.invoice_no, s.name supplier, p.subtotal gross, p.discount, p.total net, p.paid, p.due
      FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.purchase_date BETWEEN ? AND ? ORDER BY p.purchase_date, p.id`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) count, COALESCE(SUM(total),0) total, COALESCE(SUM(paid),0) paid, COALESCE(SUM(due),0) due FROM purchases WHERE purchase_date BETWEEN ? AND ?', from, to);
    return { rows, summary };
  }

  expenseReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT e.expense_date date, ec.name category, e.amount, e.method, e.description, e.reference
      FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date, e.id`, from, to);
    const byCategory = this.db.all<any>(`SELECT ec.name, SUM(e.amount) amount FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id WHERE e.expense_date BETWEEN ? AND ? GROUP BY ec.id ORDER BY amount DESC`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) count, COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date BETWEEN ? AND ?', from, to);
    return { rows, byCategory, summary };
  }

  stockReport() {
    const rows = this.db.all<any>(`SELECT p.id, p.name, p.code, c.name category, u.symbol unit, i.qty_milli, p.min_stock_milli, i.value_poisha,
      CASE WHEN i.qty_milli <= 0 THEN 'out' WHEN i.qty_milli <= p.min_stock_milli THEN 'low' ELSE 'ok' END status
      FROM products p JOIN inventory i ON i.product_id=p.id LEFT JOIN categories c ON c.id=p.category_id JOIN units u ON u.id=p.base_unit_id
      WHERE p.archived=0 ORDER BY p.name`);
    const summary = this.db.get<any>('SELECT COUNT(*) products, COALESCE(SUM(i.qty_milli),0) qty, COALESCE(SUM(i.value_poisha),0) value FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0');
    return { rows, summary };
  }

  stockValuation() {
    const rows = this.db.all<any>(`SELECT p.name, p.code, i.qty_milli, i.value_poisha, CASE WHEN i.qty_milli>0 THEN ROUND(i.value_poisha*1000.0/i.qty_milli) ELSE 0 END avg_cost
      FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 AND i.qty_milli>0 ORDER BY i.value_poisha DESC`);
    const total = rows.reduce((s, r) => s + r.value_poisha, 0);
    return { rows, summary: { total } };
  }

  stockMovement(from: string, to: string, productId?: number) {
    const args: any[] = [from + 'T00:00:00.000Z', to + 'T23:59:59.999Z'];
    let pf = '';
    if (productId) { pf = 'AND m.product_id=?'; args.push(productId); }
    const rows = this.db.all<any>(`SELECT m.created_at, p.name product, b.batch_no, m.direction, m.qty_milli, m.value_poisha, m.source_type, m.reference_no, m.reason
      FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN product_batches b ON b.id=m.batch_id
      WHERE m.created_at BETWEEN ? AND ? ${pf} ORDER BY m.id`, ...args);
    return { rows };
  }

  lowStock() { return { rows: this.db.all<any>(`SELECT p.name, p.code, i.qty_milli, p.min_stock_milli FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 AND i.qty_milli <= p.min_stock_milli ORDER BY i.qty_milli`) }; }
  outOfStock() { return { rows: this.db.all<any>(`SELECT p.name, p.code FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.archived=0 AND i.qty_milli <= 0 ORDER BY p.name`) }; }

  expiryReport(days = 30) {
    const today = todayISO();
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const rows = this.db.all<any>(`SELECT p.name product, b.batch_no, b.expiry_date, b.qty_milli, b.value_poisha,
      CASE WHEN b.expiry_date < ? THEN 'expired' ELSE 'expiring' END status
      FROM product_batches b JOIN products p ON p.id=b.product_id WHERE b.qty_milli>0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ? ORDER BY b.expiry_date`, today, limit);
    return { rows };
  }

  customerDue() {
    const rows = this.db.all<any>("SELECT id, name, mobile, address FROM customers WHERE archived=0 ORDER BY name").map((c) => ({ ...c, due: this.ledger.partyBalance(c.id, 'customer') })).filter((c) => c.due > 0);
    return { rows, summary: { total: rows.reduce((s, r) => s + r.due, 0) } };
  }
  supplierDue() {
    const rows = this.db.all<any>('SELECT id, name, business_name, mobile FROM suppliers WHERE archived=0 ORDER BY name').map((s) => ({ ...s, payable: this.ledger.partyBalance(s.id, 'supplier') })).filter((s) => s.payable > 0);
    return { rows, summary: { total: rows.reduce((s, r) => s + r.payable, 0) } };
  }

  customerLedger(customerId: number, from?: string, to?: string) { return this.ledger.partyStatement(customerId, 'customer', from, to); }
  supplierLedger(supplierId: number, from?: string, to?: string) { return this.ledger.partyStatement(supplierId, 'supplier', from, to); }

  paymentHistory(from: string, to: string, kind?: string) {
    const args: any[] = [from, to];
    let kf = '';
    if (kind) { kf = 'AND p.kind=?'; args.push(kind); }
    const rows = this.db.all<any>(`SELECT p.payment_date date, p.kind, p.amount, p.method, p.reference,
      CASE WHEN p.kind='collection' THEN c.name ELSE s.name END party
      FROM payments p LEFT JOIN customers c ON p.kind='collection' AND c.id=p.party_id LEFT JOIN suppliers s ON p.kind='supplier_payment' AND s.id=p.party_id
      WHERE p.payment_date BETWEEN ? AND ? ${kf} ORDER BY p.payment_date, p.id`, ...args);
    const summary = this.db.get<any>(`SELECT COALESCE(SUM(CASE WHEN kind='collection' THEN amount ELSE 0 END),0) collected, COALESCE(SUM(CASE WHEN kind='supplier_payment' THEN amount ELSE 0 END),0) paid FROM payments WHERE payment_date BETWEEN ? AND ?`, from, to);
    return { rows, summary };
  }

  cashFlow(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT je.entry_date date, a.name account, SUM(jl.debit) inflow, SUM(jl.credit) outflow
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE a.code IN ('1000','1010','1020') AND je.entry_date BETWEEN ? AND ? GROUP BY je.entry_date, a.id ORDER BY je.entry_date`, from, to);
    return { rows };
  }
  cashBalance() {
    const rows = this.db.all<any>("SELECT code, name FROM accounts WHERE code IN ('1000','1010','1020')").map((a) => ({ ...a, balance: this.ledger.balance(a.code) }));
    return { rows, summary: { total: rows.reduce((s, r) => s + r.balance, 0) } };
  }

  salesReturnReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT r.return_date date, r.return_no, s.invoice_no, c.name customer, r.refund_amount, r.due_adjustment, r.reason
      FROM sales_returns r JOIN sales s ON s.id=r.sale_id LEFT JOIN customers c ON c.id=r.customer_id WHERE r.return_date BETWEEN ? AND ? ORDER BY r.id`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) count, COALESCE(SUM(refund_amount+due_adjustment),0) total FROM sales_returns WHERE return_date BETWEEN ? AND ?', from, to);
    return { rows, summary };
  }
  purchaseReturnReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT r.return_date date, r.return_no, p.invoice_no, s.name supplier, r.refund_amount, r.credit_amount, r.reason
      FROM purchase_returns r JOIN purchases p ON p.id=r.purchase_id JOIN suppliers s ON s.id=r.supplier_id WHERE r.return_date BETWEEN ? AND ? ORDER BY r.id`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) count, COALESCE(SUM(refund_amount+credit_amount),0) total FROM purchase_returns WHERE return_date BETWEEN ? AND ?', from, to);
    return { rows, summary };
  }

  discountReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT s.sale_date date, s.invoice_no, c.name customer, s.subtotal gross, s.discount, s.total net
      FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.sale_date BETWEEN ? AND ? AND s.discount>0 ORDER BY s.id`, from, to);
    const summary = this.db.get<any>('SELECT COUNT(*) count, COALESCE(SUM(discount),0) total FROM sales WHERE sale_date BETWEEN ? AND ? AND discount>0', from, to);
    return { rows, summary };
  }

  productPerformance(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT si.product_name name, p.code, SUM(si.qty_milli) qty, SUM(si.net) revenue, SUM(si.cogs) cogs, SUM(si.net)-SUM(si.cogs) profit
      FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
      WHERE s.sale_date BETWEEN ? AND ? AND s.status='completed' GROUP BY si.product_id ORDER BY revenue DESC`, from, to);
    return { rows };
  }
  categoryPerformance(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT COALESCE(c.name,'অন্যান্য') name, SUM(si.net) revenue, SUM(si.cogs) cogs, SUM(si.net)-SUM(si.cogs) profit
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id LEFT JOIN categories c ON c.id=p.category_id
      WHERE s.sale_date BETWEEN ? AND ? AND s.status='completed' GROUP BY c.id ORDER BY revenue DESC`, from, to);
    return { rows };
  }
  inventoryAdjustmentReport(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT sa.created_at, p.name product, sa.qty_delta_milli, sa.reason, u.username
      FROM stock_adjustments sa JOIN products p ON p.id=sa.product_id LEFT JOIN users u ON u.id=sa.user_id WHERE sa.created_at BETWEEN ? AND ? ORDER BY sa.id`, from + 'T00:00:00.000Z', to + 'T23:59:59.999Z');
    return { rows };
  }
  userActivity(from: string, to: string) {
    const rows = this.db.all<any>(`SELECT u.username, u.display_name, COUNT(al.id) actions, MAX(al.at) last_action
      FROM users u LEFT JOIN audit_logs al ON al.user_id=u.id AND al.at BETWEEN ? AND ? GROUP BY u.id ORDER BY actions DESC`, from + 'T00:00:00.000Z', to + 'T23:59:59.999Z');
    const logins = this.db.all<any>('SELECT username_attempted, success, at FROM login_history WHERE at BETWEEN ? AND ? ORDER BY id DESC LIMIT 500', from + 'T00:00:00.000Z', to + 'T23:59:59.999Z');
    return { rows, logins };
  }
  auditTrail(from: string, to: string, limit = 500) {
    const rows = this.db.all<any>('SELECT * FROM audit_logs WHERE at BETWEEN ? AND ? ORDER BY id DESC LIMIT ?', from + 'T00:00:00.000Z', to + 'T23:59:59.999Z', limit);
    return { rows };
  }

  /** Period helpers for daily/weekly/monthly/yearly reports. */
  periodRange(kind: 'day' | 'week' | 'month' | 'year', ref = todayISO()): { from: string; to: string } {
    if (kind === 'day') return { from: ref, to: ref };
    if (kind === 'week') return { from: startOfWeek(ref), to: ref };
    if (kind === 'month') return { from: startOfMonth(ref), to: ref };
    return { from: startOfYear(ref), to: ref };
  }
}
