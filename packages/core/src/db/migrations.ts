/** Ordered, checksummed migrations run inside a transaction. */
import type { Db } from './database.js';
import { SQL_001 } from './migrations/001_initial.js';
import { sha256 } from '../util/id.js';
import { nowISO } from '../util/dates.js';

export interface Migration { version: number; name: string; sql: string; }

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', sql: SQL_001 },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function migrate(db: Db): { applied: number[]; version: number } {
  const hasTable = db.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
  let current = 0;
  if (hasTable) {
    const row = db.get<{ v: number | null }>('SELECT MAX(version) as v FROM schema_migrations');
    current = row?.v ?? 0;
    // Verify checksums of already-applied migrations
    for (const m of MIGRATIONS) {
      if (m.version <= current) {
        const rec = db.get<{ checksum: string }>('SELECT checksum FROM schema_migrations WHERE version=?', m.version);
        if (rec && rec.checksum !== sha256(m.sql)) {
          throw new Error(`Migration ${m.version} checksum mismatch — refusing to run on a tampered schema history`);
        }
      }
    }
  }
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    if (m.version !== current + 1) throw new Error(`Non-contiguous migration ${m.version} (current ${current})`);
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations(version,name,applied_at,checksum) VALUES (?,?,?,?)', m.version, m.name, nowISO(), sha256(m.sql));
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
    applied.push(m.version);
    current = m.version;
  }
  return { applied, version: current };
}
