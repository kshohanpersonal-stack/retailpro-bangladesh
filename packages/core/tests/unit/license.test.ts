import { describe, it, expect, beforeAll } from 'vitest';
import { tempCore } from '../helpers.js';
import { buildPayload, signPayload, encodeLicense, decodeLicense, verifyLicense, generateSigningKeyPair, encryptPrivateKey, decryptPrivateKey, entitled, businessKey } from '../../src/license/crypto.js';
import { getPublicKeyPem, PRODUCT_ID } from '../../src/license/keys.js';

// Self-contained: generate a fresh keypair and inject the public key via env (no committed secrets).
let privateKeyPem: string;

beforeAll(() => {
  const pair = generateSigningKeyPair();
  privateKeyPem = pair.privateKeyPem;
  process.env.PONNO_PUBLIC_KEY_PEM = pair.publicKeyPem;
});

describe('licensing crypto', () => {
  it('signs and verifies a valid license', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর', customerName: 'করিম', customerMobile: '01712345678' });
    const file = signPayload(payload, privateKeyPem);
    const text = encodeLicense(file);
    const decoded = decodeLicense(text);
    const result = verifyLicense(decoded, { publicKeyPem: getPublicKeyPem(), expectedBusinessName: 'করিম স্টোর', appVersion: '1.0.0' });
    expect(result.ok).toBe(true);
    expect(result.payload?.businessName).toBe('করিম স্টোর');
  });

  it('rejects tampered payload', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, privateKeyPem);
    file.payload.businessName = 'অন্য স্টোর';
    const result = verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0' });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid signature', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, privateKeyPem);
    file.signature = Buffer.from('bad-signature').toString('base64');
    expect(verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0' }).ok).toBe(false);
  });

  it('rejects wrong business identity', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, privateKeyPem);
    const result = verifyLicense(file, { publicKeyPem: getPublicKeyPem(), expectedBusinessName: 'রহিম স্টোর', appVersion: '1.0.0' });
    expect(result.ok).toBe(false);
    expect(result.reasonBn).toContain('অন্য প্রতিষ্ঠান');
  });

  it('rejects wrong product and version', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, privateKeyPem);
    file.payload.product = 'other-product';
    expect(verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0' }).ok).toBe(false);
    const p2 = buildPayload({ businessName: 'করিম স্টোর', versionEntitlement: '2.x' });
    const f2 = signPayload(p2, privateKeyPem);
    expect(verifyLicense(f2, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0' }).ok).toBe(false);
  });

  it('rejects corrupted license text and duplicate ids', () => {
    expect(() => decodeLicense('PNO1.not-base64!!!')).toThrow();
    expect(() => decodeLicense('garbage')).toThrow();
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, privateKeyPem);
    const seen = new Set([payload.licenseId]);
    expect(verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0', seenLicenseIds: seen }).ok).toBe(false);
  });

  it('rejects license signed by a different key', () => {
    const other = generateSigningKeyPair();
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    const file = signPayload(payload, other.privateKeyPem);
    expect(verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.0.0' }).ok).toBe(false);
  });

  it('lifetime license never expires by time', () => {
    const payload = buildPayload({ businessName: 'করিম স্টোর' });
    payload.issuedAt = '2000-01-01T00:00:00.000Z';
    const file = signPayload(payload, privateKeyPem);
    expect(verifyLicense(file, { publicKeyPem: getPublicKeyPem(), appVersion: '1.99.0' }).ok).toBe(true);
  });

  it('entitlement matching', () => {
    expect(entitled('1.x', '1.5.3')).toBe(true);
    expect(entitled('1.x', '2.0.0')).toBe(false);
    expect(entitled('1.2.x', '1.2.9')).toBe(true);
    expect(entitled('1.2.x', '1.3.0')).toBe(false);
  });

  it('encrypts and decrypts owner private key', () => {
    const pair = generateSigningKeyPair();
    const enc = encryptPrivateKey(pair.privateKeyPem, 'owner-passphrase');
    expect(enc).not.toContain('PRIVATE KEY');
    expect(decryptPrivateKey(enc, 'owner-passphrase')).toBe(pair.privateKeyPem);
    expect(() => decryptPrivateKey(enc, 'wrong')).toThrow();
  });

  it('business key is stable and normalized', () => {
    expect(businessKey('করিম  স্টোর')).toBe(businessKey(' করিম স্টোর '));
  });
});

describe('license activation service', () => {
  it('activates, binds business, re-verifies offline, rejects invalid', () => {
    const { core, cleanup } = tempCore();
    try {
      const payload = buildPayload({ businessName: 'করিম স্টোর' });
      const text = encodeLicense(signPayload(payload, privateKeyPem));
      expect(core.license.status().activated).toBe(false);
      const status = core.license.activate({ userId: null, username: 'system' }, text);
      expect(status.activated).toBe(true);
      expect(status.businessName).toBe('করিম স্টোর');
      expect(core.db.get<{ name: string }>('SELECT name FROM business_profile WHERE id=1')!.name).toBe('করিম স্টোর');
      expect(core.license.status().activated).toBe(true); // offline re-verify
      // wrong business rejection
      const other = encodeLicense(signPayload(buildPayload({ businessName: 'রহিম স্টোর' }), privateKeyPem));
      expect(() => core.license.activate({ userId: null, username: 'system' }, other, 'করিম স্টোর')).toThrow();
      // invalid license does not corrupt existing activation
      expect(core.license.status().activated).toBe(true);
    } finally { cleanup(); }
  });
});
