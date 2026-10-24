import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/canonical";
import { GENESIS, defaultLedgerPath, openLedger } from "../src/ledger";

const ROOT = join(import.meta.dir, "..");

function makeTempLedgerPath(): { dir: string; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pinga-ledger-test-"));
  const dbPath = join(dir, "nested", "ledger.db");
  return {
    dir,
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeValidReceipt(seq = 1): Record<string, unknown> {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-000${seq}`,
    task: `T0${seq}`,
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 15,
        artifact_ref: {
          path: `runs/T0${seq}/1/out.txt`,
          sha256: "b".repeat(64),
        },
      },
    ],
    tokens: {
      in: null,
      out: null,
      cache: null,
      source: null,
    },
    cost_usd: null,
    cost_evidence: "not run",
    author: {
      model: "deepseek-v4-pro",
      family: "deepseek",
    },
    verified_by: null,
    summary: `T0${seq} pass: done_when exit 0 em 0s`,
    created_at: `2026-10-24T17:20:0${seq}.000Z`,
  };
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("T02 — canonicalJson & append-only hash-chained ledger", () => {
  test("1. canonicalJson sorts object keys recursively, preserves array order, no spaces, omits undefined keys", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson({ a: 1, u: undefined })).toBe('{"a":1}');
  });

  test("2. three appends of valid receipts -> seq 1, 2, 3; chained prev_hash; verify() -> { ok: true, count: 3 }", () => {
    const { dbPath, cleanup } = makeTempLedgerPath();
    try {
      expect(GENESIS).toBe("0".repeat(64));
      const ledger = openLedger(dbPath);
      const r1 = makeValidReceipt(1);
      const r2 = makeValidReceipt(2);
      const r3 = makeValidReceipt(3);

      const res1 = ledger.append(r1);
      const res2 = ledger.append(r2);
      const res3 = ledger.append(r3);

      expect(res1.seq).toBe(1);
      expect(res2.seq).toBe(2);
      expect(res3.seq).toBe(3);

      const expectedHash1 = sha256hex(`${GENESIS}\n${canonicalJson(r1)}`);
      const expectedHash2 = sha256hex(`${expectedHash1}\n${canonicalJson(r2)}`);
      const expectedHash3 = sha256hex(`${expectedHash2}\n${canonicalJson(r3)}`);

      expect(res1.hash).toBe(expectedHash1);
      expect(res2.hash).toBe(expectedHash2);
      expect(res3.hash).toBe(expectedHash3);

      const rows = ledger.all();
      expect(rows.length).toBe(3);
      expect(rows[0]!.prev_hash).toBe(GENESIS);
      expect(rows[0]!.hash).toBe(res1.hash);
      expect(rows[1]!.prev_hash).toBe(res1.hash);
      expect(rows[1]!.hash).toBe(res2.hash);
      expect(rows[2]!.prev_hash).toBe(res2.hash);
      expect(rows[2]!.hash).toBe(res3.hash);

      expect(ledger.verify()).toEqual({ ok: true, count: 3 });
      ledger.close();
    } finally {
      cleanup();
    }
  });

  test("3. append of invalid receipt throws and does not change all().length", () => {
    const { dbPath, cleanup } = makeTempLedgerPath();
    try {
      const ledger = openLedger(dbPath);
      ledger.append(makeValidReceipt(1));
      expect(ledger.all().length).toBe(1);

      expect(() => ledger.append({ invalid: true })).toThrow();
      expect(ledger.all().length).toBe(1);
      ledger.close();
    } finally {
      cleanup();
    }
  });

  test("4. direct UPDATE and DELETE on receipts via bun:sqlite throw 'append-only'", () => {
    const { dbPath, cleanup } = makeTempLedgerPath();
    try {
      const ledger = openLedger(dbPath);
      ledger.append(makeValidReceipt(1));
      ledger.close();

      const db = new Database(dbPath);
      expect(() => db.run("UPDATE receipts SET status='fail' WHERE seq=1")).toThrow(/append-only/);
      expect(() => db.run("DELETE FROM receipts WHERE seq=1")).toThrow(/append-only/);
      db.close();
    } finally {
      cleanup();
    }
  });

  test("5. tampering: drop update trigger, alter seq 2 body -> verify() returns { ok: false, brokenAt: 2 }", () => {
    const { dbPath, cleanup } = makeTempLedgerPath();
    try {
      const ledger = openLedger(dbPath);
      ledger.append(makeValidReceipt(1));
      ledger.append(makeValidReceipt(2));
      ledger.append(makeValidReceipt(3));
      ledger.close();

      const db = new Database(dbPath);
      const triggers = db
        .query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='receipts'")
        .all() as Array<{ name: string }>;
      for (const t of triggers) {
        db.run(`DROP TRIGGER "${t.name}"`);
      }
      const tampered = makeValidReceipt(2);
      tampered.summary = "tampered summary";
      db.run("UPDATE receipts SET body = ? WHERE seq = 2", [canonicalJson(tampered)]);
      db.close();

      const ledgerAfter = openLedger(dbPath);
      expect(ledgerAfter.verify()).toEqual({ ok: false, brokenAt: 2 });
      ledgerAfter.close();
    } finally {
      cleanup();
    }
  });

  test("6. defaultLedgerPath resolves PINGA_LEDGER, XDG_STATE_HOME and HOME", () => {
    expect(defaultLedgerPath({ PINGA_LEDGER: "/x/l.db" })).toBe("/x/l.db");
    expect(defaultLedgerPath({ XDG_STATE_HOME: "/s", HOME: "/h" })).toBe("/s/pinga/ledger.db");
    expect(defaultLedgerPath({ HOME: "/h" })).toBe("/h/.local/state/pinga/ledger.db");
  });

  test("7. CLI 'bun bin/pinga.ts ledger verify --ledger PATH': intact -> exit 0 'ok 2'; tampered at 2 -> exit 1 'broken at 2'", () => {
    const { dbPath, cleanup } = makeTempLedgerPath();
    try {
      const ledger = openLedger(dbPath);
      ledger.append(makeValidReceipt(1));
      ledger.append(makeValidReceipt(2));
      ledger.close();

      const okRun = Bun.spawnSync(["bun", "bin/pinga.ts", "ledger", "verify", "--ledger", dbPath], {
        cwd: ROOT,
      });
      expect(okRun.exitCode).toBe(0);
      expect(okRun.stdout.toString().trim()).toBe("ok 2");

      const db = new Database(dbPath);
      const triggers = db
        .query("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='receipts'")
        .all() as Array<{ name: string }>;
      for (const t of triggers) {
        db.run(`DROP TRIGGER "${t.name}"`);
      }
      const tampered = makeValidReceipt(2);
      tampered.summary = "hacked";
      db.run("UPDATE receipts SET body = ? WHERE seq = 2", [canonicalJson(tampered)]);
      db.close();

      const badRun = Bun.spawnSync(
        ["bun", "bin/pinga.ts", "ledger", "verify", "--ledger", dbPath],
        { cwd: ROOT },
      );
      expect(badRun.exitCode).toBe(1);
      expect(`${badRun.stdout.toString()}${badRun.stderr.toString()}`).toContain("broken at 2");
    } finally {
      cleanup();
    }
  });
});
