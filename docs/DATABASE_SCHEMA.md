# Ponno — Database Schema

SQLite (node:sqlite). `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL` (business data safety over raw speed). Money = INTEGER poisha. Quantity = INTEGER milli-units. IDs = INTEGER autoincrement unless noted. All tables have `created_at`/`updated_at` TEXT ISO where mutable.

## Migration strategy
`schema_migrations(version INTEGER PK, name TEXT, applied_at TEXT, checksum TEXT)`. Migrations are ordered, embedded in code, run inside a transaction, and recorded with a SHA-256 checksum. `PRAGMA user_version` mirrors the latest version. Downgrades are refused; recovery is via backup restore.

## Core tables

### business_profile
Single row (id=1): name, logo_path, address, mobile, email, currency ('BDT'), date_format, number_format, digit_style ('bn'|'en'), invoice_prefix, invoice_start, return_prefix, purchase_prefix, timezone, low_stock_default, expiry_alert_days, allow_negative_stock (0/1), allow_expired_sale (0/1), setup_completed (0/1), created_at, updated_at.

### application_settings
key TEXT PK, value TEXT (JSON), updated_at. Receipt config, printer config, backup config, security config, UI prefs.

### users / roles / permissions
- roles(id, name UNIQUE, description, is_system)
- permissions(key TEXT PK, description)
- role_permissions(role_id FK, permission_key FK, PK(role_id,permission_key))
- users(id, username TEXT UNIQUE COLLATE NOCASE, display_name, password_hash, password_salt, role_id FK, status ('active'|'disabled'), must_change_password, failed_attempts, locked_until, last_login_at, created_at, updated_at)
- user_permissions(user_id FK, permission_key FK, grant INTEGER 0/1, PK(user_id,permission_key)) — overrides on top of role
- sessions(token_hash TEXT PK, user_id FK, created_at, expires_at, last_seen_at)
- login_history(id, user_id FK NULL, username_attempted, success, ip_or_source, at)

### catalog
- categories(id, name UNIQUE, name_norm, description, archived, created_at, updated_at)
- brands(id, name UNIQUE, name_norm, archived, created_at, updated_at)
- units(id, name UNIQUE, symbol, kind ('count'|'weight'|'volume'), created_at)
- unit_conversions(id, product_id FK NULL=global, from_unit_id FK, to_unit_id FK, factor_milli INTEGER (1 from = factor/1000 to), UNIQUE(product_id,from_unit_id,to_unit_id))
- products(id, name, name_norm, code TEXT UNIQUE, sku TEXT UNIQUE, category_id FK NULL, brand_id FK NULL, base_unit_id FK, purchase_price INTEGER, selling_price INTEGER, wholesale_price INTEGER, discount_type ('none'|'percent'|'fixed'), discount_value INTEGER (bp or poisha), min_stock_milli INTEGER, description, track_batches INTEGER, archived INTEGER, created_at, updated_at)
- product_barcodes(id, product_id FK, barcode TEXT UNIQUE, symbology ('code128'|'ean13'|'qr'), created_at)
- inventory(id, product_id FK UNIQUE, qty_milli INTEGER, value_poisha INTEGER, updated_at) — WAC authority per product
- product_batches(id, product_id FK, batch_no, mfg_date NULL, expiry_date NULL, qty_milli INTEGER, value_poisha INTEGER, unit_cost_poisha INTEGER, created_at, updated_at, UNIQUE(product_id,batch_no)) — batch stock; Σ batch qty = inventory.qty for tracked products

### parties
- customers(id, name, name_norm, mobile, mobile_norm, address, type ('regular'|'wholesale'), opening_balance INTEGER, archived, created_at, updated_at)
- suppliers(id, name, name_norm, business_name, contact_person, mobile, mobile_norm, address, opening_balance INTEGER, archived, created_at, updated_at)
Party balances are derived from journal subledger lines (A/R, A/P with party_id), never stored as mutable truth.

### sales
- sales(id, invoice_no TEXT UNIQUE, customer_id FK NULL, sale_date TEXT, sale_time TEXT, subtotal INTEGER, discount INTEGER, total INTEGER, paid INTEGER, due INTEGER, status ('completed'|'reversed'), payment_summary TEXT, cashier_id FK, notes, idempotency_key TEXT UNIQUE, cost_incomplete INTEGER, created_at)
- sale_items(id, sale_id FK, product_id FK, product_name, unit_id FK, unit_name, qty_milli INTEGER, unit_price INTEGER, discount INTEGER, gross INTEGER, net INTEGER, cogs INTEGER, cogs_per_unit_milli INTEGER, cost_incomplete INTEGER, batch_id FK NULL)
- sale_payments(id, sale_id FK, account_id FK, method ('cash'|'bank'|'mobile'), amount INTEGER, paid_at)
- sales_returns(id, return_no TEXT UNIQUE, sale_id FK, customer_id FK NULL, return_date, reason, refund_amount INTEGER, due_adjustment INTEGER, status, created_by FK, created_at)
- sales_return_items(id, return_id FK, sale_item_id FK, product_id FK, qty_milli INTEGER, amount INTEGER, cogs_restored INTEGER, batch_id FK NULL)

### purchases
- purchases(id, invoice_no TEXT UNIQUE, supplier_id FK, purchase_date, subtotal, discount, total, paid, due, status, notes, created_by FK, created_at)
- purchase_items(id, purchase_id FK, product_id FK, product_name, unit_id FK, unit_name, qty_milli, unit_cost, discount, gross, net, batch_id FK NULL)
- purchase_payments(id, purchase_id FK, account_id FK, method, amount, paid_at)
- purchase_returns(id, return_no UNIQUE, purchase_id FK, supplier_id FK, return_date, reason, refund_amount, credit_amount, status, created_by, created_at)
- purchase_return_items(id, return_id FK, purchase_item_id FK, product_id FK, qty_milli, amount, batch_id FK NULL)

### inventory movements
- stock_movements(id, product_id FK, batch_id FK NULL, direction ('in'|'out'), qty_milli, unit_cost_poisha NULL, value_poisha, source_type ('sale'|'purchase'|'sale_return'|'purchase_return'|'adjustment'|'transfer'|'opening'), source_id, reference_no, reason, user_id FK, created_at) — append-only, every stock change
- stock_adjustments(id, product_id FK, batch_id FK NULL, qty_delta_milli, unit_cost_poisha, reason, user_id, created_at)
- stock_transfers(id, product_id FK, from_batch_id FK, to_batch_id FK, qty_milli, reason, user_id, created_at)

### finance
- accounts(id, code TEXT UNIQUE, name, type ('asset'|'liability'|'equity'|'income'|'expense'), is_system, party_type NULL, archived)
- journal_entries(id, entry_no TEXT UNIQUE, entry_date TEXT, description, source_type, source_id, reversal_of FK NULL, created_by FK, created_at)
- journal_lines(id, entry_id FK, account_id FK, party_id FK NULL, debit INTEGER, credit INTEGER, line_memo) — CHECK(debit>=0 AND credit>=0 AND (debit=0 OR credit=0)); entry balance enforced in service + trigger
- expenses(id, category_id FK, amount INTEGER, expense_date, account_id FK (paid from), method, description, reference, attachment_path NULL, created_by FK, created_at)
- expense_categories(id, name UNIQUE, account_id FK UNIQUE, archived)
- cash_transactions(id, account_id FK, direction ('in'|'out'|'adjustment'), amount, reason, source_type, source_id, user_id, created_at) — every manual cash movement
- payments(id, kind ('collection'|'supplier_payment'), party_id FK, account_id FK, method, amount, payment_date, reference, notes, created_by, created_at) — standalone collections/payments (sale-embedded payments live in sale_payments)

### operations
- audit_logs(id, user_id FK NULL, username, action, entity, entity_id, before_json, after_json, reason, source_type, source_id, at) — append-only
- backup_history(id, file_path, file_name, size_bytes, sha256, kind ('manual'|'auto'|'pre_restore'|'pre_update'), verified INTEGER, schema_version INTEGER, app_version, created_by NULL, created_at)
- license_activations(id, license_id TEXT UNIQUE, business_name, payload_json, signature, activated_at, device_info, app_version)
- counters(name TEXT PK, value INTEGER) — invoice sequences
- schema_migrations(version, name, applied_at, checksum)

## Indexes (selected)
products(name_norm), products(code), products(sku), product_barcodes(barcode), customers(name_norm), customers(mobile_norm), suppliers(name_norm), sales(sale_date), sales(customer_id), sale_items(sale_id), sale_items(product_id), purchases(purchase_date), journal_lines(account_id, party_id), journal_entries(entry_date, source_type, source_id), stock_movements(product_id, created_at), product_batches(product_id, expiry_date), audit_logs(at), expenses(expense_date).

## Deletion behavior
Master data with dependents → archive only (RESTRICT FKs). Documents (sales/purchases/payments/expenses/journals) are never hard-deleted; corrections are reversals. Catalog FKs are ON DELETE RESTRICT; line-item FKs CASCADE only within their own document aggregate where the parent is itself never deleted in production paths.

## Invariants (tested)
1. Every journal entry balances. 2. inventory.qty = Σ batch qty (tracked) and = Σ movements. 3. inventory.value = Σ batch value. 4. Customer due = Σ A/R lines for party. 5. Supplier payable = Σ A/P lines. 6. Cash account balance = Σ journal lines. 7. Returned qty ≤ sold/purchased qty. 8. No negative stock unless configured. 9. invoice_no unique. 10. idempotency_key unique.
