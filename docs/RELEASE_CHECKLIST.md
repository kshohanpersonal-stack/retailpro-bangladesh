# Release Checklist (all must pass before publishing)

## Gates
- [ ] G1 Planning complete (requirements, architecture, schema, business logic, testing strategy)
- [ ] G2 Foundation (app starts, DB initializes, navigation, design system, activation)
- [ ] G3 Business modules complete
- [ ] G4 Financial logic verified (stock, ledger, payments, returns, COGS, P&L)
- [ ] G5 Operational systems (printing, barcode/QR, backup/restore, import/export, permissions, audit)
- [ ] G6 Distribution (3 EXEs, installer, uninstaller, metadata)
- [ ] G7 Testing (unit, integration, DB, financial, security, UI, performance, e2e)
- [ ] G8 Release (CI tag build, artifacts, checksums, notes, install verification, publication)

## Final acceptance
- [ ] Unique name + custom icon + light theme + full Bengali UI + Unicode + DPI
- [ ] All core modules functional with real data
- [ ] All 30 reports + CSV + PDF (Bengali embedded)
- [ ] Security: hashing, RBAC backend enforcement, audit, ACID, logs, backup/restore verified
- [ ] Licensing: Ed25519, offline activation, business binding, invalid rejection, generator EXE
- [ ] Windows: installer, shortcuts, uninstaller, data retention, update safety
- [ ] GitHub: public repo, milestone commits, tag-based CI, 3 EXEs, checksums, release notes, release published, download verified
- [ ] QA: install tested, launch tested, activation tested, realistic workflow tested, financials verified, integrity verified, backup/restore verified, UI defects fixed, critical bugs resolved

## Explicitly pending (cannot be claimed without evidence)
- [ ] Physical thermal printer test (58mm & 80mm)
- [ ] Physical USB/Bluetooth/wireless scanner test
- [ ] Windows DPI 100/125/150/200% on real hardware
- [ ] Actual customer-machine installation
