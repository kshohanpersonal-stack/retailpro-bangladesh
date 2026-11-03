/** Authentication: scrypt password hashing, sessions, brute-force lockout, login history. */
import crypto from 'node:crypto';
import type { Db } from '../db/database.js';
import { AppError, Errors } from '../errors.js';
import { nowISO } from '../util/dates.js';
import { randomToken, sha256 } from '../util/id.js';
import type { AuditService } from './audit.js';

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 12;

export interface Session {
  userId: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  permissions: Set<string>;
  tokenHash: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, n, r, p, saltHex, hashHex] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const dk = crypto.scryptSync(password, Buffer.from(saltHex!, 'hex'), KEYLEN, { N: Number(n), r: Number(r), p: Number(p) });
    const expected = Buffer.from(hashHex!, 'hex');
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(private db: Db, private audit: AuditService) {}

  createUser(actor: { userId: number | null; username: string }, params: { username: string; displayName: string; password: string; roleId: number; permissionOverrides?: Array<{ key: string; grant: boolean }> }): number {
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(params.username)) throw Errors.validation('ইউজারনেম ৩-৪০ অক্ষরের ইংরেজি অক্ষর/সংখ্যা/._- হতে হবে');
    if (params.password.length < 8) throw Errors.validation('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
    const exists = this.db.get('SELECT id FROM users WHERE username=?', params.username);
    if (exists) throw Errors.duplicate('এই ইউজারনেম');
    const now = nowISO();
    const r = this.db.run(
      'INSERT INTO users(username,display_name,password_hash,role_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      params.username, params.displayName, hashPassword(params.password), params.roleId, now, now);
    const id = r.lastInsertRowid;
    for (const o of params.permissionOverrides ?? []) {
      this.db.run('INSERT OR REPLACE INTO user_permissions(user_id,permission_key,grant) VALUES (?,?,?)', id, o.key, o.grant ? 1 : 0);
    }
    this.audit.log(actor, 'user.create', 'users', id, { after: { username: params.username, roleId: params.roleId } });
    return id;
  }

  login(username: string, password: string, source = 'desktop'): { token: string; session: Session } {
    const user = this.db.get<any>('SELECT u.*, r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username=?', username);
    const now = nowISO();
    if (!user) {
      this.db.run('INSERT INTO login_history(user_id,username_attempted,success,source,at) VALUES (NULL,?,0,?,?)', username, source, now);
      throw Errors.auth();
    }
    if (user.status !== 'active') {
      this.db.run('INSERT INTO login_history(user_id,username_attempted,success,source,at) VALUES (?, ?,0,?,?)', user.id, username, source, now);
      throw new AppError('ACCOUNT_DISABLED', 'এই অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে', 'Account disabled');
    }
    if (user.locked_until && user.locked_until > now) {
      this.db.run('INSERT INTO login_history(user_id,username_attempted,success,source,at) VALUES (?, ?,0,?,?)', user.id, username, source, now);
      throw Errors.locked(user.locked_until);
    }
    if (!verifyPassword(password, user.password_hash)) {
      const failed = (user.failed_attempts ?? 0) + 1;
      const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
      this.db.run('UPDATE users SET failed_attempts=?, locked_until=?, updated_at=? WHERE id=?', failed, lockedUntil, now, user.id);
      this.db.run('INSERT INTO login_history(user_id,username_attempted,success,source,at) VALUES (?, ?,0,?,?)', user.id, username, source, now);
      if (lockedUntil) throw Errors.locked(lockedUntil);
      throw Errors.auth();
    }
    this.db.run('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=?, updated_at=? WHERE id=?', now, now, user.id);
    this.db.run('INSERT INTO login_history(user_id,username_attempted,success,source,at) VALUES (?, ?,1,?,?)', user.id, username, source, now);
    const token = randomToken();
    const tokenHash = sha256(token);
    const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
    this.db.run('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)', tokenHash, user.id, now, expires, now);
    const session = this.buildSession(user, tokenHash);
    this.audit.log({ userId: user.id, username: user.username }, 'auth.login', 'users', user.id, { sourceType: 'session' });
    return { token, session };
  }

  private buildSession(user: any, tokenHash: string): Session {
    const rolePerms = this.db.all<{ permission_key: string }>('SELECT permission_key FROM role_permissions WHERE role_id=?', user.role_id).map((r) => r.permission_key);
    const overrides = this.db.all<{ permission_key: string; grant: number }>('SELECT permission_key, grant FROM user_permissions WHERE user_id=?', user.id);
    const perms = new Set(rolePerms);
    for (const o of overrides) { if (o.grant) perms.add(o.permission_key); else perms.delete(o.permission_key); }
    return { userId: user.id, username: user.username, displayName: user.display_name, roleId: user.role_id, roleName: user.role_name, permissions: perms, tokenHash };
  }

  /** Resolve a token to a session; slides expiry. Returns null if invalid/expired. */
  resolve(token: string): Session | null {
    const tokenHash = sha256(token);
    const s = this.db.get<any>('SELECT * FROM sessions WHERE token_hash=?', tokenHash);
    if (!s) return null;
    const now = nowISO();
    if (s.expires_at < now) { this.db.run('DELETE FROM sessions WHERE token_hash=?', tokenHash); return null; }
    const user = this.db.get<any>('SELECT u.*, r.name role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?', s.user_id);
    if (!user || user.status !== 'active') return null;
    const newExpiry = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
    this.db.run('UPDATE sessions SET last_seen_at=?, expires_at=? WHERE token_hash=?', now, newExpiry, tokenHash);
    return this.buildSession(user, tokenHash);
  }

  logout(token: string): void {
    const tokenHash = sha256(token);
    const s = this.db.get<any>('SELECT user_id FROM sessions WHERE token_hash=?', tokenHash);
    this.db.run('DELETE FROM sessions WHERE token_hash=?', tokenHash);
    if (s) {
      const u = this.db.get<any>('SELECT username FROM users WHERE id=?', s.user_id);
      this.audit.log({ userId: s.user_id, username: u?.username ?? '?' }, 'auth.logout', 'users', s.user_id);
    }
  }

  changePassword(userId: number, oldPassword: string, newPassword: string): void {
    const user = this.db.get<any>('SELECT * FROM users WHERE id=?', userId);
    if (!user || !verifyPassword(oldPassword, user.password_hash)) throw Errors.auth('বর্তমান পাসওয়ার্ড ভুল');
    if (newPassword.length < 8) throw Errors.validation('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
    this.db.run('UPDATE users SET password_hash=?, must_change_password=0, updated_at=? WHERE id=?', hashPassword(newPassword), nowISO(), userId);
    this.audit.log({ userId, username: user.username }, 'user.password_change', 'users', userId);
  }

  resetPassword(actor: { userId: number | null; username: string }, userId: number, newPassword: string): void {
    if (newPassword.length < 8) throw Errors.validation('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে');
    const user = this.db.get<any>('SELECT * FROM users WHERE id=?', userId);
    if (!user) throw Errors.notFound('ইউজার');
    this.db.run('UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?', hashPassword(newPassword), nowISO(), userId);
    this.audit.log(actor, 'user.password_reset', 'users', userId);
  }

  hasPermission(session: Session, key: string): boolean {
    return session.permissions.has(key);
  }
}
