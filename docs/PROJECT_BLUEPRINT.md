# Ponno — Project Blueprint

## 1. Product
Ponno (পণ্য) is a fully offline, lifetime-licensed Windows desktop retail business management system for Bangladeshi grocery shops, super shops, general stores and wholesale/retail traders. Publisher: MERQO (About section only). Three executables: main app, owner-only License Generator, and a standalone Recovery utility.

## 2. Naming research (performed 2026-11-03)
Candidates checked via web search: Munafa (taken — munafabd.com billing app), Dokan/DokanPOS (taken — many), Nikash (taken — nikash.com.bd), Vendora (taken — YC grocery platform), Bikray (taken — bikraybd.com), Ponno (no software product found; generic Bengali word used by some e-commerce shops: Ponno Ghor, Ponno Bazar). **Selected: Ponno** — short, memorable, retail-appropriate, Bengali-rooted, internationally pronounceable. No trademark clearance is claimed; a formal trademark search is recommended before commercial launch (tracked in KNOWN_ISSUES).

## 3. Technology selection (summary — see ADR-001/002)
| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript end-to-end | One language, strong typing, testability |
| Desktop shell | Electron 39 (Node 22.20) | Windows packaging, Chromium Bengali rendering, printer APIs, mature installer tooling |
| Database | SQLite via built-in `node:sqlite` | Zero native modules (works identically in tests/dev/Electron), ACID, WAL, FK, VACUUM INTO safe backups |
| Renderer | React 19 + Vite 7 | Fast dev, component reuse, custom light design system |
| Money | Integer poisha (BDT×100) | No floating point money |
| Quantity | Integer milli-units (×1000) | kg/g/liter/ml precision |
| Costing | Moving Weighted Average | Consistent, robust with partial returns; see ADR-003 |
| Accounting | Double-entry journal (balanced) | Every transaction posts balanced debit/credit lines |
| Passwords | scrypt (node:crypto, N=16384,r=8,p=1) | Memory-hard, vetted, zero deps |
| Licensing | Ed25519 (node:crypto) | Small fast signatures, offline verification |
| PDF | pdf-lib + HarfBuzz (harfbuzzjs) + Hind Siliguri | Correct Bengali shaping offline; visually verified in sandbox |
| Barcode/QR | JsBarcode (Code128) + qrcode | Offline SVG generation |
| Thermal print | Chromium print pipeline, 58/80mm page sizes, rasterized Bengali | Reliable on Windows GDI printers |
| Tests | Vitest 3 | Fast unit/integration; real SQLite in temp dirs |
| Packaging | electron-builder 26 + NSIS | Installer, shortcuts, uninstaller, 3 app configs |
| CI/CD | GitHub Actions | ubuntu tests; windows-latest build; tag-based release |

**Stack validation performed in sandbox:** node:sqlite CRUD/WAL/VACUUM INTO/integrity_check ✓; harfbuzzjs Bengali shaping (0 notdef glyphs) ✓; pdf-lib font embedding ✓; PDF rendered to image and visually inspected — যুক্তাক্ষর, কার, Bengali digits, mixed Latin all correct ✓.

## 4. Layered architecture
```
┌────────────────────────────────────────────────────────────┐
│ Presentation: React renderer (Bengali, light theme)        │
│   main app UI · license generator UI · recovery UI         │
├────────────────────────────────────────────────────────────┤
│ Transport: Electron IPC (production) / HTTP (dev preview)  │
│   one typed Gateway contract, two adapters                 │
├────────────────────────────────────────────────────────────┤
│ Application: Gateway router, session/auth middleware,      │
│   permission enforcement, input validation, audit          │
├────────────────────────────────────────────────────────────┤
│ Business logic: services (products, inventory, POS, sales, │
│   purchases, returns, parties, payments, expenses, cash,   │
│   ledger, reports, dashboard, settings, users, backup)     │
├────────────────────────────────────────────────────────────┤
│ Data: SQLite (node:sqlite), migrations, repositories,      │
│   transaction service (ACID), safe backup (VACUUM INTO)    │
├────────────────────────────────────────────────────────────┤
│ Platform: licensing (Ed25519), crypto, PDF engine,         │
│   printing, barcode/QR, logging, filesystem                │
└────────────────────────────────────────────────────────────┘
```
`packages/core` contains everything below Presentation and is pure Node TypeScript — fully testable without Electron. `apps/desktop` is a thin shell. `apps/web` is the renderer plus a dev-only HTTP adapter that exposes the same Gateway for browser preview.

## 5. Module dependency rules
- core services depend only on: db, money/units, errors, audit, ledger, licensing primitives.
- ledger is the single posting authority; business services never write balances directly.
- inventory is the single stock authority; sales/purchases/returns call inventory, never UPDATE stock themselves.
- UI never computes financial truth; it displays service results.
- No circular dependencies (enforced by layering + review).

## 6. Implementation phases (mapped to source spec Part 23)
1. Foundation: repo, docs, scaffold, design system → 2. Database: schema/migrations/transactions → 3. Auth+Licensing → 4. Master data → 5. Inventory → 6. Purchases → 7. POS/Sales/Returns → 8. Financials → 9. Reports/Dashboard → 10. Backup/Settings/Audit → 11. Windows integration → 12. Third EXE → 13. QA → 14. Production prep → 15. Release.
Phases overlap where safe; no requirement is dropped. Progress is tracked per-requirement in the matrix.

## 7. Key risks & mitigations
| Risk | Mitigation |
|---|---|
| Native module build failures | Eliminated: node:sqlite built-in (validated) |
| Bengali PDF shaping | HarfBuzz + embedded Hind Siliguri (validated visually) |
| Electron binary download blocked in sandbox | Dev/preview runs as web app; Electron builds on CI with full network |
| Financial drift | Integer money, balanced double-entry, invariant tests after every transaction type |
| Windows-only verification from Linux | CI windows-latest builds + silent-install smoke test; physical hardware tests documented as pending |
| Scope vs session limits | Honest status tracking, resumable NEXT_ACTIONS, milestone pushes |
