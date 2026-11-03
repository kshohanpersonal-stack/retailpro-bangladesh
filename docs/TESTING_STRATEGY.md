# Ponno — Testing Strategy

## 1. Pyramid
- **Unit (Vitest, packages/core/tests/unit)**: money/quantity math, rounding, digit normalization, discount allocation, validation, scrypt auth, license sign/verify, WAC costing, journal balancing, permission resolution.
- **Integration (tests/integration)**: real SQLite temp DBs through the Gateway/services — full sale/purchase/return/payment/expense/adjustment flows; rollback on injected failures; backup→restore round-trip; migration from empty; idempotency; concurrency (two connections).
- **Financial correctness (tests/financial)**: independently hand-computed scenarios (BDT poisha expectations) covering partial payments, multiple payments, discounts (percent/fixed/invoice-level allocation), sales & purchase returns, cost changes, opening balances, cash adjustments, rounding edges, reversals, P&L daily→custom, ledger invariants after every step.
- **Security (tests/security)**: invalid login, lockout, permission bypass attempts on every sensitive route, SQL injection strings, path traversal in backup/restore, tampered/invalid licenses, secret-leak scan of logs, dependency audit (npm audit in CI).
- **UI (apps/web, Playwright on CI)**: Bengali rendering, navigation, POS flow with realistic data, forms/validation, tables/sort/filter/pagination, resize 1024→1920, empty/error states, receipt preview. Sandbox: manual + scripted HTTP-level UI data checks; Playwright runs on CI (Chromium available there).
- **Performance (tests/performance)**: seeded datasets (5k products, 50k sales lines, 100k+ journal lines) measuring search, dashboard, report queries, sale throughput; results recorded with hardware/dataset in BUILD_STATUS — never invented.
- **Hardware**: HID scanner simulated via keyboard events; thermal printing verified via generated print HTML/PDF + CI Electron print smoke where possible. **Physical printer/scanner verification is explicitly pending** (no devices in sandbox) — tracked in KNOWN_ISSUES.

## 2. Invariant checks
A shared `assertInvariants(db)` runs after every integration scenario: balanced journals, stock=Σmovements, value=Σbatch value, party balances=subledger, cash=journal, no negative stock (default), unique invoice numbers.

## 3. Test data
Realistic Bengali+English mixed names (মোঃ করিম স্টোর, Pran Foods Ltd, মিনিকেট চাল ৫ কেজি), Bengali digits in inputs, mobile numbers, BDT prices. No production data.

## 4. Gates
CI runs unit+integration+financial+security+performance(smoke) on every push; release workflow runs the full suite on windows-latest before packaging; packaging validates EXE metadata + checksums; silent NSIS install smoke test on CI. A release is published only when all gates pass. Results are recorded honestly in BUILD_STATUS/RELEASE_STATUS.

## 5. What "VERIFIED" means
A requirement is VERIFIED only when its tests executed and passed in this environment or CI, with the result recorded. UI existence alone never upgrades status beyond IMPLEMENTED/INTEGRATED.
