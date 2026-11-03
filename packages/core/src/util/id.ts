import crypto from 'node:crypto';

/** Cryptographically secure random hex id. */
export function randomId(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
