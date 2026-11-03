/** Public verification key. SAFE to publish. The matching private key is NEVER in this repo.
 * Production builds inject the owner's real public key via PONNO_PUBLIC_KEY_PEM (CI secret).
 * The embedded default is a DEVELOPMENT key for local preview/testing only. */
import crypto from 'node:crypto';
import { sha256 } from '../util/id.js';

export const PRODUCT_ID = 'ponno-retail-desktop';

const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAS9F0C0odiEoxyFEbM2S3QR46RVOd0IikXYQJUO7sEsc=\n-----END PUBLIC KEY-----\n`;

export function getPublicKeyPem(): string {
  const env = process.env.PONNO_PUBLIC_KEY_PEM;
  if (env && env.includes('BEGIN PUBLIC KEY')) return env.replace(/\\n/g, '\n');
  return DEV_PUBLIC_KEY_PEM;
}

export function isDevelopmentKey(): boolean {
  return getPublicKeyPem().trim() === DEV_PUBLIC_KEY_PEM.trim();
}

export function publicKeyFingerprint(pem: string = getPublicKeyPem()): string {
  const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return sha256(der).slice(0, 16);
}
