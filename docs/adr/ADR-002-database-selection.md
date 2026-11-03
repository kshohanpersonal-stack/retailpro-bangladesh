# ADR-002 — Database Selection
**Status:** Accepted (2026-11-03)
**Context:** Embedded, ACID, FK, migrations, safe online backup, large datasets, zero native build friction (sandbox blocks nodejs.org headers and GitHub release asset CDN).
**Decision:** SQLite via Node's built-in `node:sqlite` (DatabaseSync). Node >=22.13 and Electron >=35 bundle it; Electron 39 ships Node 22.20. WAL + synchronous=FULL + foreign_keys=ON. Safe backups via `VACUUM INTO` (verified in sandbox) and node:sqlite `backup()` where available.
**Alternatives:** better-sqlite3 (native rebuild fails in sandbox; ABI drift between Node/Electron), sql.js (WASM, manual persistence weakens durability), LiteFS/Cloud (violates offline requirement).
**Consequences:** Zero native modules; identical driver in tests/dev/production; experimental API surface accepted (stable since 22.13, widely used in Electron per public migrations); integer money/qty enforced in schema.
