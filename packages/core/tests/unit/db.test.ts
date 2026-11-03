import { describe, it, expect } from 'vitest';
import { tempCore, assertInvariants } from '../helpers.js';
import { LATEST_VERSION } from '../../src/db/migrations.js';
import { Db } from '../../src/db/database.js';

describe('database foundation', () => {
  it('migrates and seeds a fresh database', () => {
    const { core, cleanup } = tempCore();
    try {
      expect(core.schemaVersion).toBe(LATEST_VERSION);
      expect(core.db.integrityCheck()).toBe(true);
      const accounts = core.db.get<{ c: number }>('SELECT COUNT(*) c FROM accounts')!.c;
      expect(accounts).toBeGreaterThanOrEqual(12);
      const perms = core.db.get<{ c: number }>('SELECT COUNT(*) c FROM permissions')!.c;
      expect(perms).toBe(34);
      const units = core.db.get<{ c: number }>('SELECT COUNT(*) c FROM units')!.c;
      expect(units).toBe(10);
      const profile = core.db.get<any>('SELECT * FROM business_profile WHERE id=1');
      expect(profile.currency).toBe('BDT');
      assertInvariants(core);
    } finally { cleanup(); }
  });

  it('rolls back failed transactions completely', () => {
    const { core, cleanup } = tempCore();
    try {
      expect(() => core.db.transaction(() => {
        core.db.run("INSERT INTO categories(name,name_norm,created_at,updated_at) VALUES ('x','x','2026-01-01','2026-01-01')");
        throw new Error('boom');
      })).toThrow('boom');
      expect(core.db.get('SELECT * FROM categories')).toBeUndefined();
    } finally { cleanup(); }
  });

  it('enforces foreign keys', () => {
    const { core, cleanup } = tempCore();
    try {
      const unit = core.db.get<{ id: number }>('SELECT id FROM units LIMIT 1')!.id;
      expect(() => core.db.run(
        "INSERT INTO products(name,name_norm,base_unit_id,created_at,updated_at) VALUES ('p','p',99999,'2026-01-01','2026-01-01')")).toThrow();
      expect(unit).toBeGreaterThan(0);
    } finally { cleanup(); }
  });

  it('enforces unique constraints', () => {
    const { core, cleanup } = tempCore();
    try {
      core.db.run("INSERT INTO categories(name,name_norm,created_at,updated_at) VALUES ('দুধ','দুধ','2026-01-01','2026-01-01')");
      expect(() => core.db.run("INSERT INTO categories(name,name_norm,created_at,updated_at) VALUES ('দুধ','দুধ','2026-01-01','2026-01-01')")).toThrow();
    } finally { cleanup(); }
  });

  it('VACUUM INTO produces a valid snapshot', () => {
    const { core, dir, cleanup } = tempCore();
    try {
      core.db.run("INSERT INTO categories(name,name_norm,created_at,updated_at) VALUES ('টেস্ট','টেস্ট','2026-01-01','2026-01-01')");
      const snap = `${dir}/snapshot.db`;
      core.db.vacuumInto(snap);
      const snapDb = new Db(snap);
      expect(snapDb.integrityCheck()).toBe(true);
      expect(snapDb.get("SELECT name FROM categories WHERE name='টেস্ট'")).toBeTruthy();
      snapDb.close();
    } finally { cleanup(); }
  });
});
