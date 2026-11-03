# Ponno — Requirements Specification

Authoritative requirement catalog derived from the customer's 36-part source specification.
Every requirement has a unique ID used across code, tests, and the traceability matrix.
Statuses: NOT STARTED · PLANNED · IN PROGRESS · IMPLEMENTED · INTEGRATED · TESTED · VERIFIED · BLOCKED.
Live status is tracked in `REQUIREMENT_TRACEABILITY_MATRIX.md`; this file defines the requirements.

## REQ-BRAND — Branding & Identity
| ID | Requirement |
|---|---|
| REQ-BRAND-001 | Unique, commercially suitable software name selected after conflict research; no legal clearance claimed |
| REQ-BRAND-002 | Original application icon (ICO + source artwork) used in EXE, installer, shortcuts, windows |
| REQ-BRAND-003 | Brand identity consistent across all three executables, installer, docs, About |
| REQ-BRAND-004 | MERQO (brand), merqoonline@gmail.com, Founder Shohan Khan shown only in About/software identity; never on receipts, invoices, statements, reports; no MERQO logo |

## REQ-UX — Language, Localization, Theme
| ID | Requirement |
|---|---|
| REQ-UX-001 | Entire UI in natural Bangladeshi business Bengali with consistent terminology (প্রোডাক্ট, স্টক, পারচেজ, সেলস, বাকি, ক্যাশ, লাভ…) |
| REQ-UX-002 | Unicode Bengali/English/mixed input, storage, display, search, sort, filter, CSV, PDF, print, backup, restore |
| REQ-UX-003 | Bengali↔English digit normalization for numeric input/search without losing original text |
| REQ-UX-004 | Premium light theme only; no dark mode or theme switcher |
| REQ-UX-005 | Bengali যুক্তাক্ষর/কার/ফলা render correctly in UI and PDF (embedded font, HarfBuzz shaping) |
| REQ-UX-006 | BDT currency; Bangladeshi lakh/crore number formatting option |

## REQ-OFF — Offline Architecture & Database
| ID | Requirement |
|---|---|
| REQ-OFF-001 | All daily operations work fully offline after activation; no mandatory cloud/API/subscription |
| REQ-OFF-002 | Embedded SQLite with WAL, foreign keys, ACID transactions, parameterized queries |
| REQ-OFF-003 | Schema migrations with version tracking; no unpredictable production schema changes |
| REQ-OFF-004 | Atomic business transactions: sale/purchase/return/payment failures roll back all related records |
| REQ-OFF-005 | Integer minor-unit money (poisha) and integer milli-unit quantities; documented rounding; no float money |
| REQ-OFF-006 | No arbitrary product/customer/invoice limits; capacity bounded only by storage/hardware |
| REQ-OFF-007 | Indexes and database-level search/pagination for large datasets |

## REQ-DASH — Dashboard
| ID | Requirement |
|---|---|
| REQ-DASH-001 | Real-data KPIs: today/yesterday/week/month sales, today purchases, gross & net profit, cash balance, customer due, supplier payable, counts, stock qty & valuation |
| REQ-DASH-002 | Alerts: low stock, out of stock, expiring, expired; recent sales/transactions/payments |
| REQ-DASH-003 | Date filters and meaningful charts computed from actual records; empty states; no hardcoded numbers |
| REQ-DASH-004 | Incomplete cost data is flagged, never shown as zero profit |

## REQ-PROD — Products, Categories, Brands, Units
| ID | Requirement |
|---|---|
| REQ-PROD-001 | Product CRUD + search/filter/sort/archive/controlled delete; all specified fields (name, code, SKU, barcode, QR, category, brand, unit, prices, discount, stock, min stock, description, status, timestamps) |
| REQ-PROD-002 | Percentage and fixed-amount product discounts with validation |
| REQ-PROD-003 | Product bulk import (CSV) and export with Bengali preserved |
| REQ-PROD-004 | Category & brand CRUD/search/archive/controlled delete; deletion blocked when dependents exist |
| REQ-PROD-005 | Units: piece, kg, g, liter, ml, packet, carton, dozen, bottle, box, custom; unit conversion (e.g., 1 carton = 12 pieces) applied across purchase/sale/return/inventory |
| REQ-PROD-006 | Batch & expiry: batch no, mfg/expiry dates, batch qty/cost, expiry alerts, expired identification, batch-wise movement; expired sales blocked by default with audited authorized override |

## REQ-INV — Inventory
| ID | Requirement |
|---|---|
| REQ-INV-001 | Stock In/Out/Adjustment/Transfer/Opening stock with transaction reference + audit; no untracked stock change |
| REQ-INV-002 | Stock history, valuation, low/out-of-stock alerts, batch-wise stock, movement report |
| REQ-INV-003 | Negative stock prevented by default; optional authorized config with documented consequences |
| REQ-INV-004 | Weighted-average costing applied consistently; valuation ties to ledger |

## REQ-POS — POS & Sales
| ID | Requirement |
|---|---|
| REQ-POS-001 | Fast POS: search by name/code/SKU/barcode/QR, manual selection, cart, qty/unit change, permission-gated price & discount edit |
| REQ-POS-002 | Subtotal/discount/grand total/paid/due; customer selection; cash/bank/mobile/partial/due payments; multiple payment splits |
| REQ-POS-003 | Unique invoice numbers; historical invoices preserve sale-time names/prices; full invoice fields stored |
| REQ-POS-004 | Receipt preview, thermal printing (58/80mm), reprint, PDF receipt; keyboard shortcuts; predictable repeated scans |
| REQ-POS-005 | Double-submit protection / idempotent sale submission |
| REQ-POS-006 | Sales history with search/filters; invoice reprint |
| REQ-POS-007 | Sales return: full/partial/item-wise, reason, refund, customer balance adjustment, stock restoration, return invoice, history; returned qty ≤ eligible sold qty; no duplicate refunds |

## REQ-PUR — Purchases
| ID | Requirement |
|---|---|
| REQ-PUR-001 | Purchase entry: supplier, products, qty/unit/cost/discount, totals, invoice, full/partial/due payment; atomic stock + supplier balance update; historical costs preserved |
| REQ-PUR-002 | Purchase history; purchase return (full/partial/product/batch-wise) with reason, supplier credit/refund, stock deduction, history; qty ≤ eligible purchased qty |

## REQ-PARTY — Customers & Suppliers
| ID | Requirement |
|---|---|
| REQ-PARTY-001 | Customer CRUD/search/archive/controlled delete; type, mobile, address, opening balance, due, history, ledger, statement, purchase & payment history |
| REQ-PARTY-002 | Due collection: full/partial/multiple payments, method, date, history, statement, printable/PDF; updates ledger + cash/bank + summaries; corrections via audited reversals only |
| REQ-PARTY-003 | Supplier CRUD/search/archive/controlled delete; business name, contact person, mobile, address, opening balance, payable, ledger, purchase & payment history, statement |

## REQ-FIN — Expenses, Cash, Accounting
| ID | Requirement |
|---|---|
| REQ-FIN-001 | Expense management with categories (rent, electricity, salary, transport, packaging, maintenance, utilities, other), amount/date/method/description/reference/creator/attachment; category management; feeds net profit |
| REQ-FIN-002 | Cash: opening balance, cash in/out/adjustment, payment accounts, transaction history, receivables, payables, cash flow, daily position; every movement traceable; no silent balance edits |
| REQ-FIN-003 | Integrated double-entry ledger: customer, supplier, cash/bank, expense, inventory, sales, purchase, receivable, payable; every posted entry balances; explicit reversals; no deletion of posted entries |
| REQ-FIN-004 | P&L: gross sales, discounts, net sales, returns, COGS (weighted average), gross profit, operating expense, adjustments, net profit; daily/weekly/monthly/yearly/custom; independently verified scenarios |

## REQ-RPT — Reports
| ID | Requirement |
|---|---|
| REQ-RPT-001 | All 30 specified reports (sales daily/weekly/monthly/yearly/custom, purchase, expense, gross/net profit, stock, valuation, movement, low stock, out-of-stock, expiry, customer due, supplier due, customer/supplier ledger, payment history, cash flow, cash balance, sales return, purchase return, discount, product performance, category performance, inventory adjustment, user activity, audit trail) |
| REQ-RPT-002 | Relevant date/search/sort/category/product/customer/supplier/status filters; summary & detail views |
| REQ-RPT-003 | CSV + Excel-compatible CSV export (UTF-8 BOM) and PDF export with embedded Bengali font; no blank/fake reports |

## REQ-BACKUP — Backup & Restore
| ID | Requirement |
|---|---|
| REQ-BACKUP-001 | Manual backup anytime; automatic scheduled local backups with configurable interval/location/retention/max count/naming/verification; offline |
| REQ-BACKUP-002 | Backup includes DB, profile, settings, receipt config, logo/assets, migration metadata; excludes signing keys; SQLite-safe snapshot (VACUUM INTO / online backup) |
| REQ-BACKUP-003 | Verification: integrity check, metadata, version compatibility, corruption detection |
| REQ-BACKUP-004 | Restore: validate → compatibility check → preserve current DB → warn → confirm → atomic restore → verify → rollback on failure; tested with real databases |

## REQ-SET — Settings & Setup
| ID | Requirement |
|---|---|
| REQ-SET-001 | Settings: business identity/logo/address/contacts, currency, date/number format, invoice prefix/start, receipt, printer, barcode, backup, low-stock threshold, expiry alerts, users, security, app info |
| REQ-SET-002 | First-run setup wizard after activation: business info, logo, currency, invoice config, preferences, opening cash, opening inventory, initial admin; review step; persists to DB |

## REQ-SEC — Users, Permissions, Audit, Security
| ID | Requirement |
|---|---|
| REQ-SEC-001 | Multi-user local accounts; Owner/Admin/Manager/Cashier + configurable roles; unique identity, status, timestamps, last login |
| REQ-SEC-002 | Granular permissions (sales, products, purchase, stock adjustment, parties, due, expense, financial/profit reports, users, settings, backup, restore, price/discount edit, financial correction); backend enforcement on every sensitive operation |
| REQ-SEC-003 | Cashiers do not see purchase costs/profit by default |
| REQ-SEC-004 | Secure password hashing (scrypt/Argon2id class), brute-force protection, sessions, login/logout history |
| REQ-SEC-005 | Audit trail for all specified actions with user/time/action/record/before/after/reason; no silent erasure |
| REQ-SEC-006 | Input validation, SQL injection protection, safe file handling, secure config, error logging without secrets, Bengali user-facing errors with diagnostic local logs |

## REQ-LIC — Offline Licensing
| ID | Requirement |
|---|---|
| REQ-LIC-001 | One-time payment lifetime license; no expiry-by-time, no online checks, no renewals |
| REQ-LIC-002 | Ed25519 asymmetric signing: private key only in owner's License Generator; public key embedded in app; private key never in repo/binaries/installer/artifacts |
| REQ-LIC-003 | License payload: unique ID, business name, customer info, product ID, type, issuance, version entitlement, optional binding, signature; institution-specific binding (one institution's license invalid for another) |
| REQ-LIC-004 | License Generator EXE: enter business/customer info, generate unique license, sign, export, view, validate, local history; secure key storage; CSPRNG; no key exposure in UI |
| REQ-LIC-005 | Activation screen on first launch; no business access without valid license; validates structure/signature/product/business/ID/tamper/version/binding; secure activation storage; licensed business name shown |
| REQ-LIC-006 | Invalid licenses rejected with clear Bengali errors without corrupting data; retry flow |
| REQ-LIC-007 | Tested against invalid signatures, modified payloads, wrong business, duplicate IDs, corrupted files, wrong product, invalid entitlements; offline security limitations documented |

## REQ-APP3 — Third Executable
| ID | Requirement |
|---|---|
| REQ-APP3-001 | Third EXE with genuine operational need (standalone Backup/Restore & maintenance utility), independently functional, documented, versioned, tested; no signing material |

## REQ-UI — Design System & Navigation
| ID | Requirement |
|---|---|
| REQ-UI-001 | Unified premium light design system: colors, typography (Bengali font), sizes, spacing, radius, shadows, tables, modals, notifications |
| REQ-UI-002 | Sidebar navigation to all modules with active state; no overlapping/clipped/broken elements; realistic-data verification |
| REQ-UI-003 | All interactive components functional (buttons, inputs, dropdowns, search, date pickers, tables, sort/filter/pagination, modals, confirms, toasts, loading, context menus) |
| REQ-UI-004 | Responsive desktop layout, min window size, resize/maximize/restore, DPI 100–200%, no content loss |
| REQ-UI-005 | Database-level search/filter/sort/pagination across modules; Bengali+English+normalized digit matching |

## REQ-WIN — Windows Distribution
| ID | Requirement |
|---|---|
| REQ-WIN-001 | Professional installer: directory selection, desktop/start-menu shortcuts, icon, runtime, metadata, uninstaller |
| REQ-WIN-002 | First launch: activation check → activation → setup wizard → dashboard |
| REQ-WIN-003 | Uninstall never silently deletes business data; explicit confirmation for data removal |
| REQ-WIN-004 | Update process: compatibility/version check, pre-update backup, migration safety, preserve license/settings/history |

## REQ-DEV — Build, CI/CD, Release
| ID | Requirement |
|---|---|
| REQ-DEV-001 | GitHub Actions: tag-based release pipeline (checkout → env → deps → validate → tests → 3 EXEs → installer → artifact/metadata validation → checksums → notes → publish only if gates pass) |
| REQ-DEV-002 | Least-privilege workflow permissions; secrets in GitHub Secrets; no secrets in workflows/repo |
| REQ-DEV-003 | Release artifacts: main EXE, License Generator EXE (owner-only handling), third EXE, installer, checksums, release notes, version info, install instructions |
| REQ-DEV-004 | Meaningful milestone commits pushed continuously; no secrets/business data committed |
| REQ-DEV-005 | Complete technical docs (20 items), owner/internal guides, Bengali customer manual |
| REQ-DEV-006 | Resumable progress tracking: DEVELOPMENT_PROGRESS, matrix, KNOWN_ISSUES, NEXT_ACTIONS, BUILD_STATUS, RELEASE_STATUS |

## REQ-QA — Testing & Quality
| ID | Requirement |
|---|---|
| REQ-QA-001 | Unit tests: services, calculations, validation, permissions, DB functions, license verification, costing, posting |
| REQ-QA-002 | Integration tests: product↔inventory, purchase↔stock, sales↔stock/payments, due↔collection, supplier↔payment, expense↔cash, returns, P&L, backup/restore |
| REQ-QA-003 | Financial tests with independently computed expectations (partial/multiple payments, discounts, returns, cost changes, valuation, opening balances, adjustments, rounding, reversals, balanced ledgers) |
| REQ-QA-004 | Database tests: rollback, FK, unique, concurrency, migration, integrity, crash recovery, large datasets |
| REQ-QA-005 | UI tests with realistic Bengali/English data, resize/DPI, long names, large tables, empty/error states, dialogs, print preview |
| REQ-QA-006 | Hardware: simulated scanner/printer integration tests; physical verification explicitly pending where no device available |
| REQ-QA-007 | Backup tests: real backup/restore round-trip, corrupted rejection, failed-restore recovery |
| REQ-QA-008 | Security tests: invalid login, brute force, unauthorized actions, permission bypass, invalid/modified license, injection, path attacks, secret leakage, dependency audit |
| REQ-QA-009 | Performance benchmarks with documented hardware/datasets (thousands of products, tens of thousands of transactions); no invented results |
