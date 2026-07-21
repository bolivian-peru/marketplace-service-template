/**
 * Durable replay + receipt store — the single fix for the four worst v1 money
 * bugs at once:
 *   - Replay across restart/replica: state lives in SQLite (or Redis), not an
 *     in-process Set. A spent tx stays spent everywhere, forever.
 *   - Cross-task replay: a txHash is bound to ONE taskId; reusing it for a
 *     different task is rejected.
 *   - Paid-but-failed: a task that throws after payment leaves the tx in
 *     `failed` state, still redeemable — the same txHash re-runs the work for
 *     free on retry, never a second charge.
 *   - Lost response: a served result is stored and re-served idempotently.
 *
 * Default backend is a SQLite file (durable across restarts, single-box). For
 * multi-replica deploys, front it with a shared Postgres/Redis by implementing
 * the same ReplayStore interface — the gate code does not change.
 */

import { Database } from 'bun:sqlite';
import type { PaymentRecord, ReplayStore } from './types';

class SqliteReplayStore implements ReplayStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        tx_hash          TEXT PRIMARY KEY,
        task_id          TEXT NOT NULL,
        network          TEXT NOT NULL,
        amount_micro     TEXT NOT NULL,
        status           TEXT NOT NULL,
        result           TEXT,
        created_at       INTEGER NOT NULL,
        served_at        INTEGER
      );
    `);
  }

  get(txHash: string): PaymentRecord | null {
    const row = this.db.query('SELECT * FROM payments WHERE tx_hash = ?').get(txHash) as any;
    return row ? rowToRecord(row) : null;
  }

  claim(txHash: string, taskId: string, network: string, amountMicroUsdc: string): { ok: true } | { ok: false; existing: PaymentRecord } {
    // Atomic: INSERT OR IGNORE is a single-statement write under SQLite's
    // single-writer lock. If we inserted (changes === 1) we own the claim; if
    // not, someone else already holds this tx — load and return it.
    const res = this.db.run(
      'INSERT OR IGNORE INTO payments (tx_hash, task_id, network, amount_micro, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [txHash, taskId, network, amountMicroUsdc, 'claimed', Date.now()],
    );
    if (res.changes === 1) return { ok: true };
    return { ok: false, existing: this.get(txHash)! };
  }

  markServed(txHash: string, result: string): void {
    this.db.run('UPDATE payments SET status = ?, result = ?, served_at = ? WHERE tx_hash = ?', ['served', result, Date.now(), txHash]);
  }

  markFailed(txHash: string): void {
    this.db.run('UPDATE payments SET status = ? WHERE tx_hash = ?', ['failed', txHash]);
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(row: any): PaymentRecord {
  return {
    txHash: row.tx_hash,
    taskId: row.task_id,
    network: row.network,
    amountMicroUsdc: row.amount_micro,
    status: row.status,
    result: row.result ?? null,
    createdAt: row.created_at,
    servedAt: row.served_at ?? null,
  };
}

/**
 * Build the replay store from env.
 *   REPLAY_STORE_PATH — SQLite file path (default ./data/payments.sqlite).
 *   REPLAY_STORE=":memory:" — ephemeral, for tests only (NOT production-safe).
 */
export function createReplayStore(): ReplayStore {
  const path = process.env.REPLAY_STORE === ':memory:'
    ? ':memory:'
    : process.env.REPLAY_STORE_PATH || './data/payments.sqlite';
  return new SqliteReplayStore(path);
}
