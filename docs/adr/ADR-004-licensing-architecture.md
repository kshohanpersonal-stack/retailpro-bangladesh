# ADR-004 — Licensing Architecture
**Status:** Accepted (2026-11-03)
**Decision:** Ed25519-signed canonical-JSON license payloads; public key embedded in app; private key only in owner's encrypted key file used by the separate License Generator EXE; business-identity binding (normalized name), optional explicit device binding OFF by default; lifetime, fully offline verification at activation and every startup.
**Rationale:** Meets institution-specific licensing without a hidden machine lock; small fast signatures; no server; clear reactivation story.
**Consequences:** Offline licensing cannot resist local binary patching (documented limitation); key loss prevents new issuance (documented recovery procedure); generator is owner-only and never in the customer installer.
