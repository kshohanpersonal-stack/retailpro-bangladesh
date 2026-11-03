/** SQLite adapter over node:sqlite (zero native modules). ACID transaction service. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, any>;

export class Db {
  readonly raw: DatabaseSync;
  readonly file: string;
  private txDepth = 0;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON');
    if (file !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = FULL');
    }
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    return this.raw.prepare(sql);
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  /** Run fn inside an ACID transaction. Supports nesting via savepoints. */
  transaction<T>(fn: () => T): T {
    if (this.txDepth === 0) {
      this.raw.exec('BEGIN IMMEDIATE');
      this.txDepth++;
      try {
        const result = fn();
        this.raw.exec('COMMIT');
        this.txDepth--;
        return result;
      } catch (e) {
        try { this.raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
        this.txDepth--;
        throw e;
      }
    }
    const name = `sp_${this.txDepth}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    this.txDepth++;
    try {
      const result = fn();
      this.raw.exec(`RELEASE SAVEPOINT ${name}`);
      this.txDepth--;
      return result;
    } catch (e) {
      try { this.raw.exec(`ROLLBACK TO SAVEPOINT ${name}`); this.raw.exec(`RELEASE SAVEPOINT ${name}`); } catch { /* ignore */ }
      this.txDepth--;
      throw e;
    }
  }

  integrityCheck(): boolean {
    const r = this.get<{ integrity_check: string }>('PRAGMA integrity_check');
    return r?.integrity_check === 'ok';
  }

  /** Consistent snapshot of a live DB (safe online backup). */
  vacuumInto(targetFile: string): void {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
    this.raw.exec(`VACUUM INTO '${targetFile.replace(/'/g, "''")}'`);
  }

  checkpoint(): void {
    try { this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  }

  close(): void {
    this.checkpoint();
    this.raw.close();
  }
}
