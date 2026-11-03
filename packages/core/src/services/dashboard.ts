/** Dashboard: real-data KPIs, alerts, recent activity, charts. No hardcoded numbers. */
import type { Db } from '../db/database.js';
import type { LedgerService } from './ledger.js';
import type { InventoryService } from './inventory.js';
import type { ReportService } from './reports.js';
import { todayISO, addDays, startOfWeek, startOfMonth } from '../util/dates.js';

export class DashboardService {
  constructor(private db: Db, private ledger: LedgerService, private inventory: InventoryService, private reports: ReportService) {}

  overview(refDate?: string) {
    const today = refDate ?? todayISO();
    const yesterday = addDays(today, -1);
    const weekStart = startOfWeek(today);
    const monthStart = startOfMonth(today);

    const salesSum = (from: string, to: string) => this.db.get<{ total: number; c: number }>("SELECT COALESCE(SUM(total),0) total, COUNT(*) c FROM sales WHERE status='completed' AND sale_date BETWEEN ? AND ?", from, to)!;
    const todaySales = salesSum(today, today);
    const yesterdaySales = salesSum(yesterday, yesterday);
    const weekSales = salesSum(weekStart, today);
    const monthSales = salesSum(monthStart, today);
    const todayPurchases = this.db.get<{ total: number }>("SELECT COALESCE(SUM(total),0) total FROM purchases WHERE purchase_date=?", today)!;

    const pl = this.reports.profitAndLoss(today, today);
    const cashBalance = this.ledger.balance('1000') + this.ledger.balance('1010') + this.ledger.balance('1020');
    const customerDue = this.db.get<{ s: number }>("SELECT COALESCE(SUM(d),0) s FROM (SELECT jl.party_id, SUM(jl.debit)-SUM(jl.credit) d FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code='1100' AND jl.party_id IS NOT NULL GROUP BY jl.party_id HAVING d>0)")!.s;
    const supplierPayable = this.db.get<{ s: number }>("SELECT COALESCE(SUM(d),0) s FROM (SELECT jl.party_id, SUM(jl.credit)-SUM(jl.debit) d FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code='2000' AND jl.party_id IS NOT NULL GROUP BY jl.party_id HAVING d>0)")!.s;

    const counts = {
      customers: this.db.get<{ c: number }>('SELECT COUNT(*) c FROM customers WHERE archived=0')!.c,
      suppliers: this.db.get<{ c: number }>('SELECT COUNT(*) c FROM suppliers WHERE archived=0')!.c,
      products: this.db.get<{ c: number }>('SELECT COUNT(*) c FROM products WHERE archived=0')!.c,
    };
    const stock = this.db.get<{ qty: number; value: number }>('SELECT COALESCE(SUM(qty_milli),0) qty, COALESCE(SUM(value_poisha),0) value FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.archived=0')!;

    const lowStock = this.inventory.lowStock();
    const outOfStock = this.inventory.outOfStock();
    const expiring = this.inventory.expiryReport();
    const expired = this.inventory.expiredStock();

    const recentSales = this.db.all<any>("SELECT s.id, s.invoice_no, s.sale_date, s.total, s.due, c.name customer_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 8");
    const recentPayments = this.db.all<any>("SELECT p.id, p.kind, p.amount, p.payment_date, CASE WHEN p.kind='collection' THEN c.name ELSE s.name END party FROM payments p LEFT JOIN customers c ON p.kind='collection' AND c.id=p.party_id LEFT JOIN suppliers s ON p.kind='supplier_payment' AND s.id=p.party_id ORDER BY p.id DESC LIMIT 8");

    // 14-day sales trend for chart
    const trend = this.db.all<any>("SELECT sale_date date, COALESCE(SUM(total),0) total FROM sales WHERE status='completed' AND sale_date BETWEEN ? AND ? GROUP BY sale_date ORDER BY sale_date", addDays(today, -13), today);

    const alerts: Array<{ kind: string; messageBn: string; count: number }> = [];
    if (lowStock.length) alerts.push({ kind: 'low_stock', messageBn: `${lowStock.length}টি প্রোডাক্টে স্টক কম`, count: lowStock.length });
    if (outOfStock.length) alerts.push({ kind: 'out_of_stock', messageBn: `${outOfStock.length}টি প্রোডাক্ট স্টক আউট`, count: outOfStock.length });
    if (expiring.length) alerts.push({ kind: 'expiring', messageBn: `${expiring.length}টি ব্যাচের মেয়াদ শীঘ্রই শেষ`, count: expiring.length });
    if (expired.length) alerts.push({ kind: 'expired', messageBn: `${expired.length}টি ব্যাচের মেয়াদ শেষ`, count: expired.length });
    if (pl.costIncompleteCount) alerts.push({ kind: 'cost_incomplete', messageBn: `${pl.costIncompleteCount}টি বিক্রিতে ক্রয়মূল্যের তথ্য অসম্পূর্ণ`, count: pl.costIncompleteCount });

    return {
      date: today,
      sales: { today: todaySales.total, todayCount: todaySales.c, yesterday: yesterdaySales.total, week: weekSales.total, month: monthSales.total },
      purchases: { today: todayPurchases.total },
      profit: { gross: pl.grossProfit, net: pl.netProfit, costIncomplete: pl.costIncompleteCount > 0 },
      cashBalance, customerDue, supplierPayable, counts,
      stock: { qty: stock.qty, value: stock.value },
      alerts,
      lowStock: lowStock.slice(0, 10), outOfStock: outOfStock.slice(0, 10),
      expiring: expiring.slice(0, 10), expired: expired.slice(0, 10),
      recentSales, recentPayments, trend,
    };
  }
}
