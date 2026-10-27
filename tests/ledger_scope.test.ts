import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { type Receipt, validateReceipt } from "../src/receipt";

const BIN = join(import.meta.dir, "..", "bin/pinga.ts");

function legacy(task: string): Receipt {
  return {
    v: 1, type: "task.receipt", id: `rcpt-${Math.random()}`, task,
    status: "fail", reason_code: "command_failed", attempts: 1, evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null, cost_evidence: "not run",
    author: { model: null, family: null }, verified_by: null,
    summary: "outro repo", created_at: "2026-10-24T20:00:00.000Z",
  } as Receipt;
}

function repoWithPlan(task: string) {
  const dir = mkdtempSync(join(tmpdir(), "pinga-scope-"));
  const sh = (...a: string[]) => Bun.spawnSync(a, { cwd: dir });
  sh("git", "init", "-q", "-b", "main");
  mkdirSync(join(dir, "tasks", task), { recursive: true });
  writeFileSync(join(dir, "tasks", task, "PLAN.md"), [
    "---", "mode: mvp", 'goal: "scope"', 'done_when: "true"',
    'touch: ["a.txt"]', "---", "x", ""].join("\n"));
  sh("git", "add", "."); sh("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i");
  return dir;
}

test("T42: attempts do verify ignoram recibos de mesma task de outro repo", () => {
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-scope-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");
  const l = openLedger(ledgerPath);
  l.append(legacy("T01"));
  l.append(legacy("T01"));
  l.close();
  const dir = repoWithPlan("T01");
  try {
    Bun.spawnSync(["bun", BIN, "verify", join(dir, "tasks/T01/PLAN.md")], {
      cwd: dir, env: { ...process.env, PINGA_LEDGER: ledgerPath },
    });
    const l2 = openLedger(ledgerPath);
    const rows = l2.all();
    l2.close();
    expect(rows.length).toBe(3);
    const r = JSON.parse(rows[2]!.body);
    expect(r.attempts).toBe(1);
    expect(r.repo).toBe(realpathSync(join(dir, ".git")));
    expect(validateReceipt(r).ok).toBe(true);
    expect(validateReceipt(legacy("T01")).ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(ledgerDir, { recursive: true, force: true });
  }
});
