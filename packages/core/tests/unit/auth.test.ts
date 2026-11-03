import { describe, it, expect } from 'vitest';
import { tempCore } from '../helpers.js';
import { hashPassword, verifyPassword } from '../../src/services/auth.js';

describe('authentication', () => {
  it('hashes and verifies passwords (scrypt, timing-safe)', () => {
    const h = hashPassword('সঠিক-পাসওয়ার্ড-123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('সঠিক-পাসওয়ার্ড-123', h)).toBe(true);
    expect(verifyPassword('ভুল', h)).toBe(false);
    expect(hashPassword('x')).not.toBe(h); // random salt
  });

  it('creates user, logs in, resolves session, logs out', () => {
    const { core, cleanup } = tempCore();
    try {
      const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Cashier')!.id;
      core.auth.createUser({ userId: null, username: 'system' }, { username: 'cashier1', displayName: 'ক্যাশিয়ার', password: 'password123', roleId });
      const { token, session } = core.auth.login('cashier1', 'password123');
      expect(session.username).toBe('cashier1');
      expect(session.permissions.has('pos.sell')).toBe(true);
      expect(session.permissions.has('reports.profit')).toBe(false); // cashier restriction
      const resolved = core.auth.resolve(token);
      expect(resolved?.userId).toBe(session.userId);
      core.auth.logout(token);
      expect(core.auth.resolve(token)).toBeNull();
    } finally { cleanup(); }
  });

  it('rejects wrong password and locks after 5 failures', () => {
    const { core, cleanup } = tempCore();
    try {
      const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Owner')!.id;
      core.auth.createUser({ userId: null, username: 'system' }, { username: 'owner', displayName: 'মালিক', password: 'password123', roleId });
      for (let i = 0; i < 4; i++) expect(() => core.auth.login('owner', 'wrong')).toThrow();
      expect(() => core.auth.login('owner', 'wrong')).toThrow(/locked/i);
      // even correct password is rejected while locked
      expect(() => core.auth.login('owner', 'password123')).toThrow(/locked/i);
      const hist = core.db.get<{ c: number }>('SELECT COUNT(*) c FROM login_history WHERE success=0')!.c;
      expect(hist).toBeGreaterThanOrEqual(5);
    } finally { cleanup(); }
  });

  it('rejects duplicate usernames and weak passwords', () => {
    const { core, cleanup } = tempCore();
    try {
      const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Owner')!.id;
      core.auth.createUser({ userId: null, username: 'system' }, { username: 'owner', displayName: 'মালিক', password: 'password123', roleId });
      expect(() => core.auth.createUser({ userId: null, username: 'system' }, { username: 'OWNER', displayName: 'x', password: 'password123', roleId })).toThrow();
      expect(() => core.auth.createUser({ userId: null, username: 'system' }, { username: 'user2', displayName: 'x', password: 'short', roleId })).toThrow();
    } finally { cleanup(); }
  });

  it('permission overrides grant and revoke', () => {
    const { core, cleanup } = tempCore();
    try {
      const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Cashier')!.id;
      const id = core.auth.createUser({ userId: null, username: 'system' }, { username: 'cash2', displayName: 'x', password: 'password123', roleId, permissionOverrides: [{ key: 'reports.profit', grant: true }, { key: 'due.collect', grant: false }] });
      const { session } = core.auth.login('cash2', 'password123');
      expect(session.permissions.has('reports.profit')).toBe(true);
      expect(session.permissions.has('due.collect')).toBe(false);
      expect(id).toBeGreaterThan(0);
    } finally { cleanup(); }
  });
});
