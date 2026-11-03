# Ponno — Software Architecture

## 1. Overview
Ponno is a layered, offline-first desktop system. One TypeScript core (`packages/core`) implements all business truth; thin shells present it. The same Gateway contract is exposed over Electron IPC in production and over a local HTTP adapter in the browser dev preview, so the UI code path is identical in both.

```
React renderer (apps/web)
   │  typed client (window.ponno IPC bridge  OR  fetch /api in dev)
   ▼
Gateway (core/gateway.ts) ── session + permission middleware ── validation
   │
   ├─ AuthService ─ scrypt, sessions, lockout, login history
   ├─ LicenseService ─ Ed25519 verify, activation storage, business binding
   ├─ SettingsService / SetupService ─ profile, wizard, counters
   ├─ CatalogService ─ categories, brands, units, conversions, products, barcodes
   ├─ PartyService ─ customers, suppliers, statements (subledger views)
   ├─ InventoryService ─ receive/consume/adjust/transfer, batches, expiry, valuation
   ├─ PurchaseService ─ purchase + payments + returns (atomic)
   ├─ SalesService ─ POS sale, payments, returns (atomic, idempotent)
   ├─ PaymentService ─ collections, supplier payments
   ├─ ExpenseService ─ categories + expenses
   ├─ CashService ─ cash in/out/adjustment, accounts
   ├─ LedgerService ─ chart of accounts, balanced journal posting, reversals
   ├─ ReportService ─ 30 reports, CSV/PDF export
   ├─ DashboardService ─ real-data KPIs, alerts, charts
   ├─ BackupService ─ VACUUM INTO snapshots, verify, restore, scheduler
   ├─ AuditService ─ append-only trail
   └─ UserService ─ users, roles, permissions
```

## 2. Transaction discipline
`db.transaction(fn)` wraps BEGIN IMMEDIATE / COMMIT / ROLLBACK. Every multi-record business operation runs inside one transaction. Services receive a `Session` (user + permissions) and an `ActorContext`; the Gateway enforces permissions before dispatch and writes audit records inside the same transaction for mutations.

## 3. Error model
`AppError(code, messageBn, messageEn, details?)`. Codes are stable (e.g. `INSUFFICIENT_STOCK`, `LICENSE_INVALID`, `PERMISSION_DENIED`, `VALIDATION`). The Gateway converts unexpected errors to a generic Bengali message and logs diagnostics (never passwords/keys) to rotating local logs. The UI renders `messageBn`.

## 4. Licensing boundary
The main app embeds only the **public** Ed25519 key. The License Generator (separate Electron entry) loads the **private** key from an owner-supplied encrypted key file at runtime; it is never bundled, logged, or committed. Activation state is stored in `license_activations` and re-verified locally at startup (signature + business binding), fully offline.

## 5. Printing & PDF
- PDF: core `pdf/` engine shapes text with HarfBuzz (Bengali conjuncts correct), embeds Hind Siliguri via pdf-lib, emits glyph-positioned content streams. Used for invoices, statements, reports, labels. Pure Node — identical output in tests and production.
- Thermal receipts: renderer produces a print-optimized HTML receipt (58/80mm CSS page sizes); Electron `webContents.print()` rasterizes through Chromium (Bengali-safe) to the selected Windows printer; `printToPDF` provides PDF receipts. Dev preview uses `window.print()`.
- Barcode/QR: JsBarcode Code128 SVG + qrcode SVG, generated offline; HID scanners type into the focused POS input (keyboard-wedge), with scan-terminator handling and debounce for repeat scans.

## 6. Filesystem layout (Windows, per-user)
`%APPDATA%/Ponno/` → `data/ponno.db` (+WAL/SHM), `backups/`, `logs/`, `assets/` (business logo), `license/activation.json`. Recovery utility operates on the same paths while the main app is closed (lock file check).

## 7. Three executables, one codebase
Vite builds three HTML entries (`index.html`, `license.html`, `recovery.html`). Electron main has three entry files (`main.ts`, `license-main.ts`, `recovery-main.ts`) sharing window/print/log utilities. electron-builder produces:
- `Ponno-Setup-x.y.z.exe` (NSIS, contains Ponno + Ponno Recovery; **no License Generator**)
- `Ponno-x.y.z-portable.exe` (main, portable)
- `Ponno-LicenseGenerator-x.y.z.exe` (owner-only portable; requires external private key file)
- `Ponno-Recovery-x.y.z.exe` (portable utility)

## 8. Dev preview in restricted sandbox
Electron binaries cannot download in the Arena sandbox; the renderer + a Node HTTP Gateway adapter run as a web app for live preview and UI verification. Production behavior (IPC, printing, filesystem) is exercised on CI windows-latest. This boundary is documented in BUILD_STATUS.

## 9. Logging & crash safety
Rotating JSON-lines logs (app, error). Startup runs `PRAGMA integrity_check` quick check; WAL recovery is automatic in SQLite. Failed migrations abort startup with a Bengali message and preserve the DB. Safe shutdown closes the DB after flushing WAL (`wal_checkpoint(TRUNCATE)`).
