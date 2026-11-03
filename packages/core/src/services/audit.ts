/** Append-only audit trail. */
import type { Db } from '../db/database.js';
import { nowISO } from '../util/dates.js';

export interface Actor { userId: number | null; username: string; }

export class AuditService {
  constructor(private db: Db) {}

  log(actor: Actor | null, action: string, entity: string, entityId: string | number | null, opts: { before?: unknown; after?: unknown; reason?: string; sourceType?: string; sourceId?: number } = {}): void {
    this.db.run(
      'INSERT INTO audit_logs(user_id,username,action,entity,entity_id,before_json,after_json,reason,source_type,source_id,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      actor?.userId ?? null,
      actor?.username ?? 'system',
      action,
      entity,
      entityId === null ? null : String(entityId),
      opts.before === undefined ? null : JSON.stringify(opts.before),
      opts.after === undefined ? null : JSON.stringify(opts.after),
      opts.reason ?? null,
      opts.sourceType ?? null,
      opts.sourceId ?? null,
      nowISO(),
    );
  }

  list(params: { from?: string; to?: string; action?: string; entity?: string; userId?: number; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const args: any[] = [];
    if (params.from) { where.push('at >= ?'); args.push(params.from + 'T00:00:00.000Z'); }
    if (params.to) { where.push('at <= ?'); args.push(params.to + 'T23:59:59.999Z'); }
    if (params.action) { where.push('action = ?'); args.push(params.action); }
    if (params.entity) { where.push('entity = ?'); args.push(params.entity); }
    if (params.userId) { where.push('user_id = ?'); args.push(params.userId); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const limit = Math.min(params.limit ?? 50, 500);
    const offset = params.offset ?? 0;
    const rows = this.db.all(`SELECT * FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
    const total = this.db.get<{ c: number }>(`SELECT COUNT(*) c FROM audit_logs ${w}`, ...args)!.c;
    return { rows, total };
  }
}
