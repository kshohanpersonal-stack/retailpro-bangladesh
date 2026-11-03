/** Initial schema. Money = INTEGER poisha; quantity = INTEGER milli-units. */
export const SQL_001 = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  name_norm TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  address TEXT,
  mobile TEXT,
  email TEXT,
  currency TEXT NOT NULL DEFAULT 'BDT',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  number_format TEXT NOT NULL DEFAULT 'lakh',
  digit_style TEXT NOT NULL DEFAULT 'bn' CHECK (digit_style IN ('bn','en')),
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  invoice_start INTEGER NOT NULL DEFAULT 1,
  return_prefix TEXT NOT NULL DEFAULT 'RET-',
  purchase_prefix TEXT NOT NULL DEFAULT 'PUR-',
  timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  low_stock_default_milli INTEGER NOT NULL DEFAULT 0,
  expiry_alert_days INTEGER NOT NULL DEFAULT 30,
  allow_negative_stock INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative_stock IN (0,1)),
  allow_expired_sale INTEGER NOT NULL DEFAULT 0 CHECK (allow_expired_sale IN (0,1)),
  setup_completed INTEGER NOT NULL DEFAULT 0 CHECK (setup_completed IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE application_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1))
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  grant INTEGER NOT NULL CHECK (grant IN (0,1)),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE login_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username_attempted TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0,1)),
  source TEXT,
  at TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_norm TEXT NOT NULL,
  description TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_categories_norm ON categories(name_norm);

CREATE TABLE brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_norm TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_brands_norm ON brands(name_norm);

CREATE TABLE units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'count' CHECK (kind IN ('count','weight','volume')),
  created_at TEXT NOT NULL
);

CREATE TABLE unit_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  from_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  to_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  factor_milli INTEGER NOT NULL CHECK (factor_milli > 0),
  UNIQUE (product_id, from_unit_id, to_unit_id)
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  code TEXT UNIQUE,
  sku TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  brand_id INTEGER REFERENCES brands(id) ON DELETE RESTRICT,
  base_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price INTEGER NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  wholesale_price INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none','percent','fixed')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  min_stock_milli INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_milli >= 0),
  description TEXT,
  track_batches INTEGER NOT NULL DEFAULT 0 CHECK (track_batches IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_norm ON products(name_norm);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);

CREATE TABLE product_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL UNIQUE,
  symbology TEXT NOT NULL DEFAULT 'code128' CHECK (symbology IN ('code128','ean13','qr')),
  created_at TEXT NOT NULL
);

CREATE TABLE inventory (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
  qty_milli INTEGER NOT NULL DEFAULT 0,
  value_poisha INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL,
  mfg_date TEXT,
  expiry_date TEXT,
  qty_milli INTEGER NOT NULL DEFAULT 0,
  value_poisha INTEGER NOT NULL DEFAULT 0,
  unit_cost_poisha INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_id, batch_no)
);
CREATE INDEX idx_batches_product ON product_batches(product_id);
CREATE INDEX idx_batches_expiry ON product_batches(expiry_date);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  mobile TEXT,
  mobile_norm TEXT,
  address TEXT,
  type TEXT NOT NULL DEFAULT 'regular' CHECK (type IN ('regular','wholesale')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_norm ON customers(name_norm);
CREATE INDEX idx_customers_mobile ON customers(mobile_norm);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  business_name TEXT,
  contact_person TEXT,
  mobile TEXT,
  mobile_norm TEXT,
  address TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_suppliers_norm ON suppliers(name_norm);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1))
);

CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  reversal_of INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_journal_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_source ON journal_entries(source_type, source_id);

CREATE TABLE journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  party_id INTEGER,
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  line_memo TEXT,
  CHECK (debit = 0 OR credit = 0)
);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_party ON journal_lines(party_id);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  sale_date TEXT NOT NULL,
  sale_time TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due INTEGER NOT NULL DEFAULT 0 CHECK (due >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  payment_summary TEXT,
  cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  idempotency_key TEXT UNIQUE,
  cost_incomplete INTEGER NOT NULL DEFAULT 0 CHECK (cost_incomplete IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  unit_name TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  gross INTEGER NOT NULL CHECK (gross >= 0),
  net INTEGER NOT NULL CHECK (net >= 0),
  cogs INTEGER NOT NULL DEFAULT 0 CHECK (cogs >= 0),
  cogs_per_unit_milli INTEGER NOT NULL DEFAULT 0,
  cost_incomplete INTEGER NOT NULL DEFAULT 0 CHECK (cost_incomplete IN (0,1)),
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash','bank','mobile')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL
);

CREATE TABLE sales_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  return_date TEXT NOT NULL,
  reason TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  due_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (due_adjustment >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sales_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  cogs_restored INTEGER NOT NULL DEFAULT 0 CHECK (cogs_restored >= 0),
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due INTEGER NOT NULL DEFAULT 0 CHECK (due >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_purchases_date ON purchases(purchase_date);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  unit_name TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  gross INTEGER NOT NULL CHECK (gross >= 0),
  net INTEGER NOT NULL CHECK (net >= 0),
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_product ON purchase_items(product_id);

CREATE TABLE purchase_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash','bank','mobile')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL
);

CREATE TABLE purchase_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  return_date TEXT NOT NULL,
  reason TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE purchase_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost_poisha INTEGER,
  value_poisha INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  reference_no TEXT,
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX idx_movements_source ON stock_movements(source_type, source_id);

CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
  qty_delta_milli INTEGER NOT NULL,
  unit_cost_poisha INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  from_batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
  to_batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  method TEXT CHECK (method IN ('cash','bank','mobile','due')),
  description TEXT,
  reference TEXT,
  attachment_path TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('collection','supplier_payment')),
  party_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('cash','bank','mobile')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_payments_party ON payments(kind, party_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

CREATE TABLE cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('in','out','adjustment')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  source_type TEXT,
  source_id INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX idx_audit_at ON audit_logs(at);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual','auto','pre_restore','pre_update')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  schema_version INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE license_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  device_info TEXT,
  app_version TEXT NOT NULL
);

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;
