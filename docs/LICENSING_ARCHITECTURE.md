# Ponno — Licensing Architecture

## 1. Model
One-time payment → lifetime usage. A valid activated license never expires by time. No online activation, no periodic checks, no renewals. Internet is never required for business operations.

## 2. Cryptography
- **Ed25519** (node:crypto). License Generator holds the private signing key; the main app embeds only the public verification key.
- Key generation: `crypto.generateKeyPairSync('ed25519')` (CSPRNG). Private key exported as PEM, stored **only** in an owner-controlled encrypted key file (`ponno-signing-key.enc`) protected by an owner passphrase (scrypt-derived key + AES-256-GCM). The generator never displays or logs the key.
- The public key is a build-time constant in `packages/core/src/license/keys.ts` (safe to publish). The matching private key is generated once by the owner and never committed (`.gitignore` blocks key material; CI checks for accidental key leakage).

## 3. License payload (canonical JSON, sorted keys)
```json
{
  "licenseId": "PNO-<128-bit CSPRNG hex>",
  "product": "ponno-retail-desktop",
  "licenseType": "lifetime",
  "businessName": "করিম স্টোর",
  "businessNameNorm": "করিম স্টোর",
  "customerName": "...",
  "customerMobile": "...",
  "issuedAt": "2026-11-03T00:00:00.000Z",
  "versionEntitlement": "1.x",
  "binding": { "type": "business", "businessKey": "<sha256 of normalized business identity>" },
  "generatorVersion": "1.0.0"
}
```
Signature = Ed25519 over `SHA-256(canonical payload bytes)`. License file format: base64url(JSON({payload, signature, publicKeyFingerprint})) with a `PNO1.` prefix. The fingerprint lets the app confirm the expected signer.

## 4. Binding strategy (institution-specific, no silent machine lock)
Primary binding is **business identity**: the payload's `businessNameNorm` must match the activated business profile's normalized name (Unicode NFC, whitespace-collapsed, case-folded for Latin). One institution's license is rejected for another institution. Optional device binding is OFF by default; if the owner enables it at generation time, a machine fingerprint (volume serial + machine GUID salted hash) is included and verified, with a documented reactivation path (owner issues a replacement license). No hidden hardware lock is introduced.

## 5. Activation flow
1. First launch → activation screen (no business modules accessible).
2. User loads `.ponno-license` file or pastes license text.
3. Verify: prefix/format → canonical JSON parse → public-key fingerprint → Ed25519 signature → product id → licenseType=lifetime → version entitlement covers app major → business binding matches entered/created business name → licenseId not revoked/duplicate in local history.
4. On success: store payload+signature in `license_activations`, bind business profile name, show licensed business name + status. On failure: clear Bengali error, no data touched, retry allowed.
5. Every subsequent startup re-verifies the stored activation offline (signature + binding) before unlocking modules.

## 6. License Generator (owner-only EXE)
UI: business name, customer name/mobile, optional device binding, version entitlement → Generate → signs with unlocked private key → preview/validate → export `.ponno-license` → local generation history (SQLite, owner machine only). Key unlock requires passphrase each session; key file path chosen by owner; documented backup procedure (offline copy of key file + passphrase in separate secure locations). Key loss = cannot issue new licenses for existing public key; existing activations keep working; recovery requires issuing a new key pair and re-activating customers (documented honestly).

## 7. Distribution rules
- Customer installer contains **only** Ponno + Ponno Recovery. License Generator is built by CI as an owner-only artifact (workflow artifact + clearly marked owner-only release asset). It is useless without the private key file, which is never distributed.
- No private key, passphrase, or generated customer license is ever committed or uploaded as a public artifact.

## 8. Test matrix (implemented in core tests)
valid license ✓ / tampered payload ✗ / invalid signature ✗ / wrong business ✗ / wrong product ✗ / wrong version entitlement ✗ / corrupted file ✗ / duplicate licenseId handling ✓ / lifetime never expires ✓ / offline re-verification ✓.

## 9. Offline limitations (documented)
Offline licensing cannot stop binary patching or DB copying by a local administrator; it prevents casual license sharing between institutions and forged licenses. This is an accepted, documented trade-off of the required offline lifetime model.
