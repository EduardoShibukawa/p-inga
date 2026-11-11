import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import type { Receipt } from "../src/receipt";

/**
 * `pinga gate <T...>` (T901): o gate de merge que o manda chama por
 * `[commands].gate`. 0 = todas as TASKs listadas com receipt done; 12 = alguma
 * pendente (ou ausente da fila). A regra saiu de `manda/src/merge.ts`.
 */
const BIN = join(import.meta.dir, "..", "bin", "pinga.ts");
const dirs: string[] = [];

function receipt(task: string, repo: string): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${task}-${Math.random()}`,
    task,
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: null, family: null },
    verified_by: null,
    summary: `${task} pass`,
    created_at: "2026-11-09T08:00:00.000Z",
    flow: "verify",
    repo,
  } as Receipt;
}

function fixture(): { root: string; ledger: string } {
  const root = mkdtempSync(join(tmpdir(), "pinga-gate-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-gate-ledger-"));
  dirs.push(root, ledgerDir);
  const ledger = join(ledgerDir, "ledger.db");
  Bun.spawnSync(["git", "init", "-q", root]);
  const scope = realpathSync(join(root, ".git"));
  for (const task of ["T1", "T2"]) {
    mkdirSync(join(root, "tasks", task), { recursive: true });
    writeFileSync(
      join(root, "tasks", task, "PLAN.md"),
      ["---", "mode: mvp", `goal: "${task} goal"`, 'done_when: "true"', "---", ""].join("\n"),
    );
  }
  const led = openLedger(ledger);
  led.append(receipt("T1", scope));
  led.close();
  return { root, ledger };
}

function gate(f: { root: string; ledger: string }, tasks: string[]) {
  const r = Bun.spawnSync(["bun", BIN, "gate", "--root", f.root, "--ledger", f.ledger, ...tasks], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let json: { ok?: boolean; pending?: string[] } = {};
  try {
    json = JSON.parse(r.stdout.toString());
  } catch {}
  return { code: r.exitCode, json };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("pinga gate", () => {
  test("todas as TASKs com receipt done → 0 e ok true", () => {
    const r = gate(fixture(), ["T1"]);
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ ok: true, pending: [] });
  });

  test("TASK sem receipt → 12 e a pendente listada", () => {
    const r = gate(fixture(), ["T1", "T2"]);
    expect(r.code).toBe(12);
    expect(r.json).toEqual({ ok: false, pending: ["T2"] });
  });

  test("TASK que não existe na fila conta como pendente", () => {
    const r = gate(fixture(), ["T99"]);
    expect(r.code).toBe(12);
    expect(r.json.pending).toEqual(["T99"]);
  });

  test("sem TASK na linha de comando não há o que checar → 0", () => {
    const r = gate(fixture(), []);
    expect(r.code).toBe(0);
    expect(r.json).toEqual({ ok: true, pending: [] });
  });
});
