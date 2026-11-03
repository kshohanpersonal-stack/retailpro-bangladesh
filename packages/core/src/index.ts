/** Ponno core container: wires database + services. Pure Node, no Electron. */
import { Db } from './db/database.js';
import { migrate, LATEST_VERSION } from './db/migrations.js';
import { seed } from './db/seed.js';
import { AuditService } from './services/audit.js';
import { LedgerService } from './services/ledger.js';
import { AuthService } from './services/auth.js';
import { LicenseService } from './services/license.js';
import { SettingsService } from './services/settings.js';
import { InventoryService } from './services/inventory.js';
import { CatalogService } from './services/catalog.js';
import { PartyService } from './services/parties.js';
import { PurchaseService } from './services/purchases.js';
import { SalesService } from './services/sales.js';

export * from './errors.js';
export * from './util/money.js';
export * from './util/quantity.js';
export * from './util/numbers.js';
export * from './util/text.js';
export * from './util/dates.js';
export * from './util/id.js';
export { Db } from './db/database.js';
export { migrate, LATEST_VERSION } from './db/migrations.js';
export * from './license/crypto.js';
export * from './license/keys.js';
export type { Session } from './services/auth.js';
export type { Actor } from './services/audit.js';

export interface CoreOptions { file?: string; }

export class PonnoCore {
  readonly db: Db;
  readonly audit: AuditService;
  readonly ledger: LedgerService;
  readonly auth: AuthService;
  readonly license: LicenseService;
  readonly settings: SettingsService;
  readonly inventory: InventoryService;
  readonly catalog: CatalogService;
  readonly parties: PartyService;
  readonly purchases: PurchaseService;
  readonly sales: SalesService;
  readonly schemaVersion: number;

  constructor(opts: CoreOptions = {}) {
    this.db = new Db(opts.file ?? ':memory:');
    migrate(this.db);
    seed(this.db);
    this.schemaVersion = LATEST_VERSION;
    this.audit = new AuditService(this.db);
    this.ledger = new LedgerService(this.db);
    this.auth = new AuthService(this.db, this.audit);
    this.license = new LicenseService(this.db, this.audit);
    this.settings = new SettingsService(this.db, this.audit, this.ledger);
    this.inventory = new InventoryService(this.db, this.audit, this.ledger);
    this.catalog = new CatalogService(this.db, this.audit);
    this.parties = new PartyService(this.db, this.audit, this.ledger);
    this.purchases = new PurchaseService(this.db, this.audit, this.ledger, this.inventory, this.settings, this.catalog);
    this.sales = new SalesService(this.db, this.audit, this.ledger, this.inventory, this.settings, this.catalog);
  }

  close(): void { this.db.close(); }
}

export function createCore(opts: CoreOptions = {}): PonnoCore {
  return new PonnoCore(opts);
}
