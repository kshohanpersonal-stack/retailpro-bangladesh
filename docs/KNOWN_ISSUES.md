# Known Issues & Limitations

| ID | Severity | Issue | Impact | Mitigation / Next action |
|---|---|---|---|---|
| KI-001 | Info | No formal trademark clearance for "Ponno" | Brand risk at commercial launch | Web conflict research done (no software product found); owner should run a formal trademark search before launch |
| KI-002 | Env | Sandbox cannot download Electron binaries or node-gyp headers (network allowlist) | Cannot run packaged Electron locally | Web preview for UI verification; Electron build/install smoke on CI windows-latest |
| KI-003 | Pending | No physical thermal printer / barcode scanner in sandbox | Hardware compatibility unverified | Simulated HID/print tests; physical verification checklist in RELEASE_CHECKLIST; do not claim hardware tested |
| KI-004 | Design | Offline licensing cannot resist local binary patching by an admin | Casual piracy only deterred | Documented in LICENSING_ARCHITECTURE §9; accepted trade-off of required offline model |
| KI-005 | Pending | node:sqlite is Stability 1 (experimental) in Node 22 | API could shift in future majors | Pinned Electron 39 / Node 22.20; adapter isolates driver; upgrade path documented |
