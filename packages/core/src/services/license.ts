/** License activation & offline re-verification. Business-identity binding. */
import type { Db } from '../db/database.js';
import { AppError } from '../errors.js';
import { nowISO } from '../util/dates.js';
import { normalizeName } from '../util/text.js';
import { decodeLicense, verifyLicense, type LicensePayload } from '../license/crypto.js';
import { getPublicKeyPem, isDevelopmentKey, publicKeyFingerprint } from '../license/keys.js';
import type { AuditService } from './audit.js';
import type { Actor } from './audit.js';

export const APP_VERSION = '1.0.0';

export interface LicenseStatus {
  activated: boolean;
  businessName?: string;
  licenseId?: string;
  issuedAt?: string;
  licenseType?: string;
  developmentKey: boolean;
  reasonBn?: string;
}

export class LicenseService {
  constructor(private db: Db, private audit: AuditService) {}

  /** Activate from license text. If expectedBusinessName given, enforce binding against it. */
  activate(actor: Actor | null, licenseText: string, expectedBusinessName?: string, deviceFingerprint?: string): LicenseStatus {
    const file = decodeLicense(licenseText);
    const seen = new Set(this.db.all<{ license_id: string }>('SELECT license_id FROM license_activations').map((r) => r.license_id));
    const result = verifyLicense(file, { publicKeyPem: getPublicKeyPem(), expectedBusinessName, appVersion: APP_VERSION, deviceFingerprint, seenLicenseIds: seen });
    if (!result.ok || !result.payload) throw new AppError('LICENSE_INVALID', `লাইসেন্স গ্রহণযোগ্য নয়: ${result.reasonBn}`, 'Invalid license');
    const p = result.payload;
    this.db.transaction(() => {
      // One active activation per installation; replace prior (re-activation flow).
      this.db.run('DELETE FROM license_activations');
      this.db.run(
        'INSERT INTO license_activations(license_id,business_name,payload_json,signature,activated_at,device_info,app_version) VALUES (?,?,?,?,?,?,?)',
        p.licenseId, p.businessName, JSON.stringify(p), file.signature, nowISO(), deviceFingerprint ?? null, APP_VERSION);
      // Bind business profile name to the licensed name.
      this.db.run('UPDATE business_profile SET name=?, name_norm=?, updated_at=? WHERE id=1', p.businessName, normalizeName(p.businessName), nowISO());
      this.audit.log(actor, 'license.activate', 'license', p.licenseId, { after: { businessName: p.businessName, licenseId: p.licenseId } });
    });
    return this.status();
  }

  /** Current status; re-verifies stored activation offline. */
  status(deviceFingerprint?: string): LicenseStatus {
    const dev = isDevelopmentKey();
    const row = this.db.get<any>('SELECT * FROM license_activations ORDER BY id DESC LIMIT 1');
    if (!row) return { activated: false, developmentKey: dev };
    try {
      const payload: LicensePayload = JSON.parse(row.payload_json);
      const file = { payload, signature: row.signature, publicKeyFingerprint: publicKeyFingerprint() };
      const profile = this.db.get<{ name_norm: string }>('SELECT name_norm FROM business_profile WHERE id=1');
      const result = verifyLicense(file, { publicKeyPem: getPublicKeyPem(), expectedBusinessName: profile?.name_norm ?? payload.businessNameNorm, appVersion: APP_VERSION, deviceFingerprint });
      if (!result.ok) return { activated: false, developmentKey: dev, reasonBn: result.reasonBn };
      return { activated: true, businessName: payload.businessName, licenseId: payload.licenseId, issuedAt: payload.issuedAt, licenseType: payload.licenseType, developmentKey: dev };
    } catch {
      return { activated: false, developmentKey: dev, reasonBn: 'সংরক্ষিত লাইসেন্স যাচাই করা যায়নি' };
    }
  }

  /** Guard used by the gateway: throws if not activated. */
  requireActivated(): void {
    const s = this.status();
    if (!s.activated) throw new AppError('LICENSE_REQUIRED', 'সফটওয়্যারটি অ্যাক্টিভ করা হয়নি। লাইসেন্স দিয়ে অ্যাক্টিভ করুন', 'License activation required', { reason: s.reasonBn });
  }
}
