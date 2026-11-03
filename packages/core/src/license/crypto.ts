/** Ed25519 license signing/verification + owner key-file encryption. Pure Node crypto. */
import crypto from 'node:crypto';
import { AppError } from '../errors.js';
import { sha256 } from '../util/id.js';
import { normalizeName } from '../util/text.js';
import { PRODUCT_ID, publicKeyFingerprint } from './keys.js';

export interface LicensePayload {
  licenseId: string;
  product: string;
  licenseType: 'lifetime';
  businessName: string;
  businessNameNorm: string;
  customerName?: string;
  customerMobile?: string;
  issuedAt: string;
  versionEntitlement: string; // e.g. "1.x"
  binding: { type: 'business'; businessKey: string } | { type: 'device'; businessKey: string; deviceFingerprint: string };
  generatorVersion: string;
}

export interface LicenseFile {
  payload: LicensePayload;
  signature: string; // base64
  publicKeyFingerprint: string;
}

/** Canonical JSON: sorted keys, no whitespace. Signature covers SHA-256 of these bytes. */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function businessKey(businessName: string): string {
  return sha256(normalizeName(businessName));
}

export function generateLicenseId(): string {
  return `PNO-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

export function buildPayload(input: { businessName: string; customerName?: string; customerMobile?: string; versionEntitlement?: string; deviceFingerprint?: string; generatorVersion?: string }): LicensePayload {
  const norm = normalizeName(input.businessName);
  if (!norm) throw new AppError('VALIDATION', 'ব্যবসার নাম আবশ্যক', 'Business name required');
  const binding: LicensePayload['binding'] = input.deviceFingerprint
    ? { type: 'device', businessKey: businessKey(input.businessName), deviceFingerprint: input.deviceFingerprint }
    : { type: 'business', businessKey: businessKey(input.businessName) };
  return {
    licenseId: generateLicenseId(),
    product: PRODUCT_ID,
    licenseType: 'lifetime',
    businessName: input.businessName,
    businessNameNorm: norm,
    customerName: input.customerName,
    customerMobile: input.customerMobile,
    issuedAt: new Date().toISOString(),
    versionEntitlement: input.versionEntitlement ?? '1.x',
    binding,
    generatorVersion: input.generatorVersion ?? '1.0.0',
  };
}

export function signPayload(payload: LicensePayload, privateKeyPem: string): LicenseFile {
  const digest = Buffer.from(sha256(canonicalJson(payload)), 'hex');
  const sig = crypto.sign(null, digest, crypto.createPrivateKey(privateKeyPem));
  return { payload, signature: sig.toString('base64'), publicKeyFingerprint: fingerprintOfPrivate(privateKeyPem) };
}

function fingerprintOfPrivate(privateKeyPem: string): string {
  const pub = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return sha256(pub).slice(0, 16);
}

const LICENSE_PREFIX = 'PNO1.';

export function encodeLicense(file: LicenseFile): string {
  return LICENSE_PREFIX + Buffer.from(JSON.stringify(file), 'utf8').toString('base64url');
}

export function decodeLicense(text: string): LicenseFile {
  const t = text.trim();
  if (!t.startsWith(LICENSE_PREFIX)) throw new AppError('LICENSE_INVALID', 'লাইসেন্স ফরম্যাট সঠিক নয়', 'Bad license format');
  try {
    const json = Buffer.from(t.slice(LICENSE_PREFIX.length), 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    if (!obj.payload || !obj.signature || !obj.publicKeyFingerprint) throw new Error('missing fields');
    return obj as LicenseFile;
  } catch {
    throw new AppError('LICENSE_INVALID', 'লাইসেন্স ফাইল নষ্ট বা অসম্পূর্ণ', 'Corrupted license file');
  }
}

export interface VerifyResult { ok: boolean; reasonBn?: string; payload?: LicensePayload; }

export function verifyLicense(file: LicenseFile, opts: { publicKeyPem: string; expectedBusinessName?: string; appVersion: string; deviceFingerprint?: string; seenLicenseIds?: Set<string> }): VerifyResult {
  const fail = (reasonBn: string): VerifyResult => ({ ok: false, reasonBn });
  try {
    const p = file.payload;
    if (!p || typeof p !== 'object') return fail('পেলোড নেই');
    if (file.publicKeyFingerprint !== publicKeyFingerprint(opts.publicKeyPem)) return fail('এই লাইসেন্স অন্য সাইনিং কী দিয়ে তৈরি');
    const digest = Buffer.from(sha256(canonicalJson(p)), 'hex');
    const valid = crypto.verify(null, digest, crypto.createPublicKey(opts.publicKeyPem), Buffer.from(file.signature, 'base64'));
    if (!valid) return fail('ডিজিটাল সিগনেচার সঠিক নয় (লাইসেন্স পরিবর্তন করা হয়েছে)');
    if (p.product !== PRODUCT_ID) return fail('এই লাইসেন্স অন্য প্রোডাক্টের জন্য');
    if (p.licenseType !== 'lifetime') return fail('লাইসেন্সের ধরন সমর্থিত নয়');
    if (!p.licenseId || !/^PNO-[0-9A-F]{32}$/.test(p.licenseId)) return fail('লাইসেন্স আইডি সঠিক নয়');
    if (!p.businessName || normalizeName(p.businessName) !== p.businessNameNorm) return fail('ব্যবসার নামের তথ্য অসংগত');
    if (p.binding?.businessKey !== businessKey(p.businessName)) return fail('ব্যবসা বাইন্ডিং সঠিক নয়');
    if (!entitled(p.versionEntitlement, opts.appVersion)) return fail('এই লাইসেন্স এই ভার্সনের জন্য নয়');
    if (opts.expectedBusinessName !== undefined && normalizeName(opts.expectedBusinessName) !== p.businessNameNorm) {
      return fail('লাইসেন্সটি অন্য প্রতিষ্ঠানের নামে ইস্যু করা');
    }
    if (p.binding.type === 'device') {
      if (!opts.deviceFingerprint || p.binding.deviceFingerprint !== opts.deviceFingerprint) return fail('এই লাইসেন্স অন্য ডিভাইসের জন্য বাইন্ড করা');
    }
    if (opts.seenLicenseIds?.has(p.licenseId)) return fail('এই লাইসেন্স আইডি আগেই ব্যবহার হয়েছে');
    return { ok: true, payload: p };
  } catch {
    return fail('লাইসেন্স যাচাই করা যায়নি');
  }
}

/** "1.x" entitles any 1.*; "1.2.x" entitles 1.2.*; exact "1.2.3" entitles only that. */
export function entitled(entitlement: string, appVersion: string): boolean {
  const e = entitlement.split('.');
  const v = appVersion.split('.');
  for (let i = 0; i < e.length; i++) {
    if (e[i] === 'x') return true;
    if (e[i] !== v[i]) return false;
  }
  return true;
}

// ---- Owner key file encryption (AES-256-GCM, scrypt-derived key) ----

export function generateSigningKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

export function encryptPrivateKey(privateKeyPem: string, passphrase: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(privateKeyPem, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, kdf: 'scrypt', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') });
}

export function decryptPrivateKey(encryptedJson: string, passphrase: string): string {
  try {
    const o = JSON.parse(encryptedJson);
    const key = crypto.scryptSync(passphrase, Buffer.from(o.salt, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(o.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(o.data, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('KEY_UNLOCK_FAILED', 'কী ফাইল আনলক করা যায়নি (পাসফ্রেজ ভুল বা ফাইল নষ্ট)', 'Key unlock failed');
  }
}
