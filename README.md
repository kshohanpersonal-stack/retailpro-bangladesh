# Ponno (পণ্য)

**সম্পূর্ণ অফলাইন রিটেইল ব্যবসা ম্যানেজমেন্ট সফটওয়্যার** — Offline Retail Business Management Software for Bangladesh.

Ponno is a commercial-grade, fully offline Windows desktop application for grocery shops, super shops, general stores, and wholesale/retail businesses in Bangladesh. One-time payment, lifetime license. Natural Bangladeshi business Bengali UI. Premium light theme.

- **Brand:** Ponno (পণ্য) — an independent product brand
- **Publisher:** MERQO · merqoonline@gmail.com · Founder: Shohan Khan
- **License model:** One-time payment, lifetime usage, offline cryptographic activation (Ed25519)
- **Platform:** Windows 10/11 (x64), fully offline after activation

## Ecosystem

| Application | Purpose | Distribution |
|---|---|---|
| **Ponno** (main) | Complete business management: POS, inventory, purchases, sales, accounting, reports | Customer installer |
| **Ponno Recovery** | Standalone backup/restore & database maintenance utility | Customer installer |
| **Ponno License Generator** | Owner-only tool that signs customer licenses with the private Ed25519 key | Owner only — never bundled for customers |

## Technology

TypeScript · Electron · React · SQLite (`node:sqlite`, zero native modules) · HarfBuzz-shaped Bengali PDF export · Ed25519 licensing · scrypt password hashing.

## Repository layout

```
packages/core      Business logic, database, accounting, licensing, PDF engine (pure TypeScript, fully tested)
apps/web           React renderer (Bengali UI) + dev API server for browser preview
apps/desktop       Electron main/preload for the three executables
assets/            Icons, fonts (Hind Siliguri), brand artwork
installer/         electron-builder + NSIS configuration
scripts/           Build, icon, release tooling
docs/              Architecture, requirements, traceability, guides
.github/workflows  CI and tag-based release pipeline
```

## Development

```bash
npm install            # Electron binary download is skipped automatically where unavailable
npm test               # Core unit + integration tests (Vitest)
npm run dev            # Browser preview (renderer + local API server)
npm run dist:win       # Windows packaging (run on Windows or CI)
```

## Documentation

Start at [docs/PROJECT_BLUEPRINT.md](docs/PROJECT_BLUEPRINT.md). Requirement tracking: [docs/REQUIREMENT_TRACEABILITY_MATRIX.md](docs/REQUIREMENT_TRACEABILITY_MATRIX.md). Bengali user manual: [docs/user/USER_GUIDE_BN.md](docs/user/USER_GUIDE_BN.md).

> Status: under active development. See [docs/DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md) and [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md) for the verified current state. No production release is claimed until all gates in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) pass.
