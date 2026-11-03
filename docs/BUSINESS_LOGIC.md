# Ponno — Business Logic & Accounting Rules

All amounts are **integer poisha** (1 BDT = 100 poisha). All quantities are **integer milli-units** of the product's base unit (1 unit = 1000 milli-units). No floating-point arithmetic is used for money or stock. Percentages are stored in basis points (1% = 100 bp) where applicable.

## 1. Rounding rules
- Money rounding: half-up to the nearest poisha, implemented with integer math (`roundHalfUp(numerator, denominator)`).
- Line total = roundHalfUp(qty_milli × unit_price_poisha / 1000) − line_discount_poisha.
- Percentage discount = roundHalfUp(line_gross × bp / 10000). Fixed discounts are exact poisha.
- Invoice-level discount is distributed across lines proportionally to line net (largest-remainder allocation) so Σ lines = invoice total exactly.
- COGS consumption = roundHalfUp(total_value_poisha × qty_milli / total_qty_milli); the last unit consumed clears the residual value so valuation never drifts negative.
- Weighted average unit cost is a derived display value (value/qty), never stored as a rounded authority.

## 2. Inventory costing — Moving Weighted Average (ADR-003)
- Each product (per batch when batch tracking is enabled) carries `qty_milli` and `value_poisha`.
- Stock In (purchase/opening/return-in/adjustment-in): value += qty × unit_cost; qty += qty.
- Stock Out (sale/return-out/adjustment-out): cogs = roundHalfUp(value × qty_out / qty_before); value −= cogs; qty −= qty_out. When qty reaches 0, value is forced to 0.
- Purchase discounts reduce the effective unit cost of the incoming layer.
- Sales returns restore stock at the **original sale-time unit cost** recorded on the sale line (cogs_per_unit), capped so valuation stays consistent; the difference vs current average is posted to an inventory adjustment account if nonzero.
- Negative stock is rejected by default (`allow_negative_stock=false`). If enabled by an Owner, stock-outs with zero value record COGS=0 and flag the sale line `cost_incomplete=1`; P&L shows a data-quality warning instead of fabricating cost.

## 3. Double-entry posting model
Chart of accounts (system accounts, fixed codes):
| Code | Account | Type |
|---|---|---|
| 1000 | Cash | asset |
| 1010 | Bank | asset |
| 1020 | Mobile Banking (bKash/Nagad…) | asset |
| 1100 | Accounts Receivable (customers) | asset |
| 1200 | Inventory | asset |
| 2000 | Accounts Payable (suppliers) | liability |
| 3000 | Owner Equity / Opening Balance | equity |
| 4000 | Sales Revenue | income |
| 4100 | Sales Discounts (contra) | income |
| 4200 | Sales Returns (contra) | income |
| 5000 | Cost of Goods Sold | expense |
| 5100 | Purchase (clearing) | expense |
| 5200 | Inventory Adjustment / Shrinkage | expense |
| 6000.. | Operating Expense categories | expense |

Every journal entry: Σ debits = Σ credits (enforced in code and checked by invariant tests). Postings:
- **Sale (cash)**: Dr Cash/Bank/Mobile (paid), Dr A/R (due) · Cr Sales Revenue (net of discount). Plus Dr COGS · Cr Inventory (cost of sold qty). Discounts are recorded as contra-revenue (Dr 4100) with revenue at gross, so gross/discount/net are all reportable.
- **Sale (due)**: same, A/R carries the unpaid portion per customer.
- **Collection**: Dr Cash/Bank/Mobile · Cr A/R (customer).
- **Purchase**: Dr Inventory (net cost) · Cr Cash/Bank/Mobile (paid) + Cr A/P (due). Purchase discounts reduce inventory cost.
- **Supplier payment**: Dr A/P · Cr Cash/Bank/Mobile.
- **Sales return**: Dr Sales Returns (contra) + Cr Cash (refund) or Cr A/R (balance reduction); Dr Inventory · Cr COGS at original cost.
- **Purchase return**: Dr Cash (refund) or Dr A/P (credit) · Cr Inventory at purchase cost.
- **Expense**: Dr Expense category · Cr Cash/Bank/Mobile (or Cr A/P if unpaid — expenses are cash-basis at entry; unpaid expenses post to A/P).
- **Stock adjustment**: increase → Dr Inventory · Cr 5200 (gain); decrease → Dr 5200 · Cr Inventory.
- **Opening balances**: cash → Dr Cash · Cr 3000; customer due → Dr A/R · Cr 3000; supplier payable → Dr 3000 · Cr A/P; opening stock → Dr Inventory · Cr 3000.
- **Reversals**: a new entry with inverted lines referencing the original (`reversal_of`); originals are never deleted or mutated.

## 4. Profit & Loss formulas (period P)
```
Gross Sales      = Σ sale_lines.gross (excluding returned amounts)
Sales Discount   = Σ sale discounts (invoice + line)
Sales Returns    = Σ return line amounts (net of their discounts)
Net Sales        = Gross Sales − Sales Discount − Sales Returns
COGS             = Σ sale line cogs − Σ returned line original cogs ± inventory adjustment expense
Gross Profit     = Net Sales − COGS
Operating Expense= Σ expense entries in P (all categories)
Other Adjustments= inventory shrinkage/gain (5200) if not already in COGS line
Net Profit       = Gross Profit − Operating Expense + Other Adjustments
```
P&L is computed from journal lines (single source of truth), cross-checked against document tables in tests. When any sale line has `cost_incomplete=1`, the report includes a warning and the affected amount; profit is never silently fabricated.

## 5. Transaction flows (atomic)
**Sale**: validate session/permission → validate cart (stock, expiry, prices, discounts) → idempotency key check → BEGIN → insert sale + lines + payments → inventory.consume per line/batch → journal (revenue+COGS) → customer ledger via A/R subledger → audit → COMMIT. Any failure → ROLLBACK (nothing persists).
**Purchase**: validate → BEGIN → purchase + lines + payments → inventory.receive (new/merged batch, cost update) → journal → supplier A/P → audit → COMMIT.
**Sales return**: validate eligible qty (sold − previously returned) → BEGIN → return + lines → inventory.restore at original cost → journal (refund/due reduction) → audit → COMMIT. Duplicate refund impossible: refunds are journal lines tied to the return id.
**Purchase return**: validate eligible qty per batch → BEGIN → return + lines → inventory.deduct at recorded cost → journal → audit → COMMIT.
**Collection / supplier payment / expense / cash movement**: validate → BEGIN → payment/expense record → journal → party subledger → audit → COMMIT.

## 6. Subledgers
Customer/supplier ledgers are views over journal lines on A/R and A/P filtered by party_id (stored on journal lines). Opening balances are real journal entries. Statements show running balance; every row links to its source document.

## 7. Number & date handling
- Input accepts Bengali digits (০-৯) and English digits; normalized for computation, original text preserved where user-entered (names, notes).
- Search normalizes digits on both query and indexed columns via a normalized shadow column.
- Dates stored as ISO `YYYY-MM-DD`; timestamps as ISO UTC. Display format configurable (DD/MM/YYYY default). Business day boundaries use local timezone (Asia/Dhaka default, configurable).
- Number display: default en-IN-style grouping (lakh/crore) with Bengali or English digits per setting.

## 8. Invoice numbering
`{prefix}{YYYY}{sequence}` with per-business sequence counters updated inside the sale transaction (no gaps from failed sales because the counter increments only on commit). Prefix and starting number configurable. Returns use `{prefix}R{sequence}`, purchases `{prefix}P{sequence}`.

## 9. Permissions (backend-enforced)
Permission keys: `dashboard.view, pos.sell, sales.view, sales.return, sales.price_edit, sales.discount_edit, products.view, products.manage, products.import, inventory.view, inventory.adjust, purchase.view, purchase.manage, purchase.return, customers.view, customers.manage, due.collect, suppliers.view, suppliers.manage, supplier.pay, expenses.view, expenses.manage, cash.view, cash.manage, reports.view, reports.financial, reports.profit, users.manage, settings.manage, backup.create, backup.restore, audit.view, license.view, financial.correct`.
Roles seed: Owner (all), Admin (all except license/financial.correct by default), Manager (operations + reports except user management), Cashier (pos.sell, sales.view, products.view, customers.view, due.collect — **no cost/profit/purchase visibility**). Every gateway call checks the session's effective permission set; UI hiding is cosmetic only.
