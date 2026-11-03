# Ponno — Security Architecture

## 1. Authentication
- Passwords hashed with **scrypt** (node:crypto): N=16384, r=8, p=1, 32-byte random salt, 64-byte derived key, timing-safe comparison. Format: `scrypt$N$r$p$saltHex$hashHex`. No plaintext ever stored or logged.
- Brute-force protection: per-user failed-attempt counter; after 5 failures the account locks for 15 minutes (configurable). All attempts (success/failure) recorded in `login_history`.
- Sessions: 256-bit CSPRNG token, stored **hashed** (SHA-256) server-side; 12-hour sliding expiry; logout invalidates; login/logout history recorded.
- Password policy: minimum 8 chars; admin can force change on next login.

## 2. Authorization
- Effective permissions = role permissions ∪ user grants − user revocations.
- **Every** Gateway method declares a required permission; the middleware rejects unauthorized calls with `PERMISSION_DENIED` before any service logic runs. UI hiding is cosmetic.
- Cashier role has no purchase-cost/profit/financial-report permissions by default.
- Sensitive overrides (expired-stock sale, negative stock, price/discount edits, financial correction) require explicit permissions and are audit-logged with reason.

## 3. Data integrity & injection defense
- 100% parameterized queries; no string interpolation of user input into SQL.
- FK enforcement, CHECK constraints, unique constraints; balanced-journal enforcement in the posting service plus DB trigger.
- All multi-record mutations in ACID transactions (BEGIN IMMEDIATE).
- Input validation layer: types, ranges, lengths, Unicode-safe; money/quantity parsed from normalized digits into integers with bounds checks.

## 4. Filesystem safety
- Backup/restore paths validated (no traversal outside chosen directories); restore writes to temp then atomic rename; pre-restore safety backup always taken.
- Business logo uploads restricted to PNG/JPEG/WEBP, size-capped, stored under app data dir with generated names.
- Logs never contain passwords, session tokens, license private keys, or full license payloads.

## 5. Licensing security
See LICENSING_ARCHITECTURE.md. Private key never enters the main app, repo, installer, or public artifacts. Activation verified offline via Ed25519.

## 6. Error handling & disclosure
Users see stable Bengali messages; diagnostics go to local rotating logs with stack traces but redacted secrets. No internal SQL/paths shown to ordinary users.

## 7. Audit
Append-only `audit_logs` for sales, returns, purchases, payments, expenses, stock adjustments, price/permission/settings changes, user management, backup/restore, license activation. Before/after JSON where meaningful. No UI or service path deletes audit rows.

## 8. Known limitations (honest)
- A fully offline app cannot prevent a determined local attacker with file access from tampering with the SQLite file or patching binaries; licensing raises the bar (signed payloads, business binding) but is not DRM-grade. Documented for the owner.
- No at-rest DB encryption in v1 (Windows per-user ACLs protect the data dir); optional encryption is a future hardening item, not silently promised.
- Physical hardware (printers/scanners) security is out of scope beyond OS integration.
