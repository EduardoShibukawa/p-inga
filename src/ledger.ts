import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical";
import { validateReceipt } from "./receipt";

export const GENESIS = "0".repeat(64);

export type LedgerRow = {
  seq: number;
  task: string;
  status: string;
  body: string;
  prev_hash: string;
  hash: string;
  created_at?: string;
};

export type AppendResult = { seq: number; hash: string };

export type VerifyResult =
  | { ok: true; count: number }
  | { ok: false; brokenAt: number };

export type Ledger = {
  append(r: unknown): AppendResult;
  all(): Array<{
    seq: number;
    task: string;
    status: string;
    body: string;
    prev_hash: string;
    hash: string;
  }>;
  verify(): VerifyResult;
  close(): void;
};

export function defaultLedgerPath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.PINGA_LEDGER !== undefined && env.PINGA_LEDGER !== "") {
    return env.PINGA_LEDGER;
  }
  const stateHome = env.XDG_STATE_HOME ?? `${env.HOME}/.local/state`;
  return `${stateHome}/pinga/ledger.db`;
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS receipts(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT,
  status TEXT,
  body TEXT,
  prev_hash TEXT,
  hash TEXT,
  created_at TEXT
)`;

const CREATE_NO_UPDATE_TRIGGER = `CREATE TRIGGER IF NOT EXISTS receipts_no_update
BEFORE UPDATE ON receipts
BEGIN SELECT RAISE(ABORT, 'append-only'); END`;

const CREATE_NO_DELETE_TRIGGER = `CREATE TRIGGER IF NOT EXISTS receipts_no_delete
BEFORE DELETE ON receipts
BEGIN SELECT RAISE(ABORT, 'append-only'); END`;

export function openLedger(path: string): Ledger {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.run(CREATE_TABLE);
  db.run(CREATE_NO_UPDATE_TRIGGER);
  db.run(CREATE_NO_DELETE_TRIGGER);

  const lastHashStmt = db.query(
    "SELECT hash FROM receipts ORDER BY seq DESC LIMIT 1",
  );
  const insertStmt = db.query(
    "INSERT INTO receipts (task, status, body, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const allStmt = db.query(
    "SELECT seq, task, status, body, prev_hash, hash FROM receipts ORDER BY seq ASC",
  );

  return {
    append(r: unknown): AppendResult {
      const res = validateReceipt(r);
      if (!res.ok) {
        throw new Error(res.errors.join("; "));
      }

      const last = lastHashStmt.get() as { hash: string } | null;
      const prev_hash = last?.hash ?? GENESIS;
      const body = canonicalJson(res.receipt);
      const hash = sha256hex(`${prev_hash}\n${body}`);

      const info = insertStmt.run(
        res.receipt.task,
        res.receipt.status,
        body,
        prev_hash,
        hash,
        res.receipt.created_at,
      );

      return { seq: Number(info.lastInsertRowid), hash };
    },

    all() {
      return allStmt.all() as Array<{
        seq: number;
        task: string;
        status: string;
        body: string;
        prev_hash: string;
        hash: string;
      }>;
    },

    verify(): VerifyResult {
      const rows = allStmt.all() as LedgerRow[];
      let expectedPrevHash = GENESIS;

      for (const row of rows) {
        if (row.prev_hash !== expectedPrevHash) {
          return { ok: false, brokenAt: row.seq };
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(row.body);
        } catch {
          return { ok: false, brokenAt: row.seq };
        }

        const res = validateReceipt(parsed);
        if (!res.ok) {
          return { ok: false, brokenAt: row.seq };
        }

        const canonical = canonicalJson(parsed);
        if (row.body !== canonical) {
          return { ok: false, brokenAt: row.seq };
        }

        const recomputed = sha256hex(`${row.prev_hash}\n${canonical}`);
        if (recomputed !== row.hash) {
          return { ok: false, brokenAt: row.seq };
        }

        expectedPrevHash = row.hash;
      }

      return { ok: true, count: rows.length };
    },

    close(): void {
      db.close();
    },
  };
}
