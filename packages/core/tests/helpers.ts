import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore, type PonnoCore } from '../src/index.js';

export function tempCore(): { core: PonnoCore; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponno-test-'));
  const core = createCore({ file: path.join(dir, 'test.db') });
  return { core, dir, cleanup: () => { core.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** Create an Owner user + login, returning token + session. */
export function ownerSession(core: PonnoCore) {
  const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Owner')!.id;
  core.auth.createUser({ userId: null, username: 'system' }, { username: 'owner', displayName: 'মালিক', password: 'ownerpass123', roleId });
  return core.auth.login('owner', 'ownerpass123', 'test');
}

export const actor = { userId: 1, username: 'owner' };

/** Ensure a real Owner user exists (FK integrity) and return its actor. */
export function ensureOwner(core: PonnoCore): { userId: number; username: string } {
  let u = core.db.get<{ id: number }>("SELECT id FROM users WHERE username='owner'");
  if (!u) {
    const roleId = core.db.get<{ id: number }>('SELECT id FROM roles WHERE name=?', 'Owner')!.id;
    core.auth.createUser({ userId: null, username: 'system' }, { username: 'owner', displayName: 'মালিক', password: 'ownerpass123', roleId });
    u = core.db.get<{ id: number }>("SELECT id FROM users WHERE username='owner'")!;
  }
  return { userId: u.id, username: 'owner' };
}

/** Assert global financial/stock invariants. */
export function assertInvariants(core: PonnoCore): void {
  core.ledger.assertAllBalanced();
  // inventory qty = sum of movements
  const bad = core.db.all(`
    SELECT i.product_id, i.qty_milli, COALESCE(SUM(CASE WHEN m.direction='in' THEN m.qty_milli ELSE -m.qty_milli END),0) mv
    FROM inventory i LEFT JOIN stock_movements m ON m.product_id=i.product_id
    GROUP BY i.product_id HAVING i.qty_milli != mv`);
  if (bad.length) throw new Error('Inventory != movements: ' + JSON.stringify(bad));
  // batch sums for tracked products
  const badBatch = core.db.all(`
    SELECT p.id, i.qty_milli, COALESCE(SUM(b.qty_milli),0) bq, i.value_poisha, COALESCE(SUM(b.value_poisha),0) bv
    FROM products p JOIN inventory i ON i.product_id=p.id LEFT JOIN product_batches b ON b.product_id=p.id
    WHERE p.track_batches=1 GROUP BY p.id HAVING i.qty_milli != bq OR i.value_poisha != bv`);
  if (badBatch.length) throw new Error('Inventory != batch sums: ' + JSON.stringify(badBatch));
}
